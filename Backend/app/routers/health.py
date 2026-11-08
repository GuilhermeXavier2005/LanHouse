from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel

from app.database.postgres import check_postgres_health
from app.database.mongodb import check_mongodb_health
from app.services.cassandra_service import check_cassandra_health
from app.database.state import set_simulated_down, get_simulated_state

router = APIRouter(tags=["Saúde"])

class SimulateBody(BaseModel):
    service: str
    down: bool

@router.get("/health")
def get_health():
    pg = check_postgres_health()
    mg = check_mongodb_health()
    cs = check_cassandra_health()

    services = {
        "postgres": pg,
        "mongodb": mg,
        "cassandra": cs,
    }

    is_degraded = any(s.get("status") != "up" for s in services.values())

    return {
        "status": "degraded" if is_degraded else "ok",
        "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "services": services,
    }

@router.post("/health/simulate")
def simulate_downtime(body: SimulateBody):
    set_simulated_down(body.service, body.down)
    return {
        "message": f"Simulação de {body.service} atualizada para down={body.down}",
        "simulated_state": get_simulated_state(),
    }
