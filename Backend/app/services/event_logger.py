from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from app.database.mongodb import get_mongo_db
from app.database.state import is_simulated_down

def log_event(
    event_type: str,
    machine_id: int,
    machine_hostname: Optional[str],
    payload: Dict[str, Any],
    session_id: Optional[int] = None,
    warnings: Optional[List[str]] = None,
) -> bool:
    """
    Grava um documento de evento no MongoDB.
    Se o MongoDB estiver offline (ou simulado como offline):
    - NÃO falha a transação principal (PostgreSQL).
    - Adiciona uma mensagem de aviso no array 'warnings'.
    """
    warning_msg = "Evento não registrado: MongoDB indisponível. O registro principal foi salvo no PostgreSQL."

    if is_simulated_down("mongodb"):
        if warnings is not None and warning_msg not in warnings:
            warnings.append(warning_msg)
        return False

    try:
        db = get_mongo_db()
        events_coll = db["events"]
        doc = {
            "type": event_type,
            "machine_id": machine_id,
            "machine_hostname": machine_hostname,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "payload": payload,
        }
        if session_id is not None:
            doc["session_id"] = session_id

        events_coll.insert_one(doc)
        return True
    except Exception:
        if warnings is not None and warning_msg not in warnings:
            warnings.append(warning_msg)
        return False
