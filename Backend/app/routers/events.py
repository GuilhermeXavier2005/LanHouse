import json
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query
from pydantic import BaseModel
from bson import ObjectId

from app.database.mongodb import get_mongo_db
from app.errors import NotFoundError, DatabaseUnavailableError

router = APIRouter(tags=["Eventos (MongoDB)"])

def format_event(doc: dict) -> dict:
    doc_id = str(doc.get("_id"))
    res = {
        "_id": doc_id,
        "type": doc.get("type"),
        "machine_id": doc.get("machine_id"),
        "machine_hostname": doc.get("machine_hostname"),
        "timestamp": doc.get("timestamp"),
        "payload": doc.get("payload") or {},
    }
    if "session_id" in doc and doc["session_id"] is not None:
        res["session_id"] = doc["session_id"]
    return res

def _build_id_query(id: str) -> dict:
    if ObjectId.is_valid(id):
        return {"$or": [{"_id": ObjectId(id)}, {"_id": id}]}
    return {"_id": id}

class EventCreate(BaseModel):
    type: str
    machine_id: int
    machine_hostname: Optional[str] = None
    session_id: Optional[int] = None
    timestamp: Optional[str] = None
    payload: Dict[str, Any] = {}

class EventUpdate(BaseModel):
    type: Optional[str] = None
    machine_id: Optional[int] = None
    machine_hostname: Optional[str] = None
    session_id: Optional[int] = None
    timestamp: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None

@router.get("/events")
def list_events(
    type: Optional[str] = None,
    machine_id: Optional[int] = None,
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    q: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    db = get_mongo_db()
    query: Dict[str, Any] = {}

    if type:
        types = type.split(",")
        query["type"] = {"$in": types} if len(types) > 1 else types[0]

    if machine_id:
        query["machine_id"] = machine_id

    if from_date or to_date:
        ts_filter: Dict[str, Any] = {}
        if from_date:
            ts_filter["$gte"] = from_date
        if to_date:
            ts_filter["$lte"] = to_date
        query["timestamp"] = ts_filter

    coll = db["events"]
    cursor = coll.find(query).sort("timestamp", -1)

    items = []
    for doc in cursor:
        item = format_event(doc)
        if q:
            term = q.lower()
            doc_str = json.dumps(item, ensure_ascii=False).lower()
            if term not in doc_str:
                continue
        items.append(item)

    total = len(items)
    paginated = items[offset : offset + limit]

    return {"items": paginated, "total": total}

@router.get("/events/{id}")
def get_event(id: str):
    db = get_mongo_db()
    coll = db["events"]

    doc = coll.find_one(_build_id_query(id))
    if not doc:
        raise NotFoundError("Evento")
    return format_event(doc)

@router.post("/events")
def create_event(data: EventCreate):
    db = get_mongo_db()
    coll = db["events"]

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    doc = {
        "type": data.type,
        "machine_id": data.machine_id,
        "machine_hostname": data.machine_hostname or f"PC-{data.machine_id:02d}",
        "timestamp": data.timestamp or now_iso,
        "payload": data.payload,
    }
    if data.session_id is not None:
        doc["session_id"] = data.session_id

    res = coll.insert_one(doc)
    doc["_id"] = res.inserted_id
    return format_event(doc)

@router.put("/events/{id}")
@router.patch("/events/{id}")
def update_event(id: str, data: EventUpdate):
    db = get_mongo_db()
    coll = db["events"]

    query = _build_id_query(id)
    doc = coll.find_one(query)
    if not doc:
        raise NotFoundError("Evento")

    updates = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if updates:
        coll.update_one({"_id": doc["_id"]}, {"$set": updates})
        doc.update(updates)

    return format_event(doc)

@router.delete("/events/{id}")
def delete_event(id: str):
    db = get_mongo_db()
    coll = db["events"]

    query = _build_id_query(id)
    doc = coll.find_one(query)
    if not doc:
        raise NotFoundError("Evento")

    coll.delete_one({"_id": doc["_id"]})
    return None

@router.get("/machines/{id}/events")
def get_machine_events(id: int, type: Optional[str] = None, limit: int = 20):
    db = get_mongo_db()
    coll = db["events"]

    query: Dict[str, Any] = {"machine_id": id}
    if type:
        types = type.split(",")
        query["type"] = {"$in": types} if len(types) > 1 else types[0]

    docs = list(coll.find(query).sort("timestamp", -1).limit(limit))
    items = [format_event(d) for d in docs]
    return {"items": items, "total": len(items)}
