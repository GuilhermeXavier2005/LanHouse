import time
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from pymongo import MongoClient
from pymongo.errors import PyMongoError, ServerSelectionTimeoutError

from app import config
from app.database.state import is_simulated_down
from app.errors import DatabaseUnavailableError

# Candidatos do Replica Set mapeados para o host (mongo1: 27017, mongo2: 27018, mongo3: 27019)
_DEFAULT_NODES = [
    "mongodb://127.0.0.1:27017/?directConnection=true",
    "mongodb://127.0.0.1:27018/?directConnection=true",
    "mongodb://127.0.0.1:27019/?directConnection=true",
]

_clients: Dict[str, MongoClient] = {}
_active_uri: Optional[str] = None

def _get_client_for_uri(uri: str) -> MongoClient:
    if uri not in _clients:
        _clients[uri] = MongoClient(
            uri,
            serverSelectionTimeoutMS=1500,
            connectTimeoutMS=1500,
            socketTimeoutMS=1500,
        )
    return _clients[uri]

def get_primary_client() -> MongoClient:
    """
    Localiza o nó Primário ativo do Replica Set (ou instância standalone)
    dentre os nós configurados. Se 1 nó cair (ex: mongo1), faz failover
    automático para o novo primário eleito (mongo2 ou mongo3).
    Se 2 nós caírem (perda de maioria/quórum no Replica Set de 3 nós),
    nenhum nó será 'isWritablePrimary', levantando DatabaseUnavailableError.
    """
    global _active_uri

    candidates: List[str] = []
    if _active_uri:
        candidates.append(_active_uri)
    if config.MONGO_URI not in candidates:
        candidates.append(config.MONGO_URI)
    for node_uri in _DEFAULT_NODES:
        if node_uri not in candidates:
            candidates.append(node_uri)

    last_err = None
    for uri in candidates:
        try:
            client = _get_client_for_uri(uri)
            hello = client.admin.command("hello")
            # Aceita se for primário gravável do Replica Set ou instância standalone
            if hello.get("isWritablePrimary") or hello.get("ismaster") or "setName" not in hello:
                _active_uri = uri
                return client
        except Exception as e:
            last_err = e
            continue

    raise DatabaseUnavailableError(
        "mongodb",
        f"MongoDB indisponível ou sem quórum de primário no Replica Set ({last_err}).",
    )

def get_mongo_db():
    if is_simulated_down("mongodb"):
        raise DatabaseUnavailableError("mongodb")
    client = get_primary_client()
    return client[config.MONGO_DB]

def check_mongodb_health() -> Dict[str, Any]:
    if is_simulated_down("mongodb"):
        return {"status": "down", "latency_ms": None, "error": "simulated down"}

    t0 = time.perf_counter()
    try:
        get_primary_client()
        latency = round((time.perf_counter() - t0) * 1000)
        return {"status": "up", "latency_ms": max(1, latency)}
    except (DatabaseUnavailableError, ServerSelectionTimeoutError, PyMongoError, Exception) as e:
        err_msg = getattr(e, "message", str(e))
        return {"status": "down", "latency_ms": None, "error": err_msg}

def seed_initial_events():
    """
    Popula documentos iniciais na coleção 'events' do MongoDB se estiver vazia.
    """
    try:
        db = get_mongo_db()
        events_coll = db["events"]
        if events_coll.count_documents({}) == 0:
            print("[MongoDB] Criando eventos iniciais de demonstração...")
            now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            sample_events = [
                {
                    "type": "session_started",
                    "machine_id": 1,
                    "machine_hostname": "PC-01",
                    "timestamp": now_iso,
                    "session_id": 3,
                    "payload": {
                        "session_id": 3,
                        "user_id": 3,
                        "user_nickname": "anabia",
                        "plan_id": 2,
                        "plan_name": "Hora Gamer",
                    },
                },
                {
                    "type": "state_changed",
                    "machine_id": 1,
                    "machine_hostname": "PC-01",
                    "timestamp": now_iso,
                    "session_id": 3,
                    "payload": {
                        "from": "disponivel",
                        "to": "em_uso",
                        "reason": "Início de sessão",
                    },
                },
                {
                    "type": "incident_opened",
                    "machine_id": 3,
                    "machine_hostname": "PC-03",
                    "timestamp": now_iso,
                    "payload": {
                        "incident_id": 1,
                        "title": "Falha de inicializacao",
                        "severity": "alta",
                    },
                },
                {
                    "type": "state_changed",
                    "machine_id": 4,
                    "machine_hostname": "PC-04",
                    "timestamp": now_iso,
                    "payload": {
                        "from": "online",
                        "to": "manutencao",
                        "reason": "Temperatura elevada",
                    },
                },
            ]
            events_coll.insert_many(sample_events)
            # Cria índice de busca por timestamp decrescente
            events_coll.create_index([("timestamp", -1)])
            events_coll.create_index([("machine_id", 1)])
            print("[MongoDB] Eventos iniciais inseridos com sucesso!")
    except Exception as e:
        print(f"[MongoDB] Aviso ao criar seed de eventos (MongoDB pode estar offline): {e}")
