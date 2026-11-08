from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict
from fastapi import APIRouter, Query

from app.database.postgres import get_db_cursor
from app.database.state import is_simulated_down
from app.services.cassandra_service import get_latest_sample, get_metrics_series
from app.errors import DatabaseUnavailableError, NotFoundError, ValidationError

router = APIRouter(tags=["Métricas (Cassandra)"])

# ==============================================================================
# ROTAS DE MÉTRICAS (RESPONSABILIDADE DO INTEGRANTE 3 - CASSANDRA)
# ==============================================================================

# Cache em memória das máquinas para que a telemetria do Cassandra continue
# funcionando normalmente mesmo quando o PostgreSQL estiver indisponível (Teorema CAP).
_machines_cache: List[Dict] = [
    {"id": 1, "hostname": "PC-01"},
    {"id": 2, "hostname": "PC-02"},
    {"id": 3, "hostname": "PC-03"},
    {"id": 4, "hostname": "PC-04"},
]

def _get_machines_resilient() -> List[Dict]:
    global _machines_cache
    if not is_simulated_down("postgres"):
        try:
            with get_db_cursor() as cur:
                cur.execute("SELECT id, codigo as hostname FROM maquinas ORDER BY id ASC;")
                rows = cur.fetchall()
                if rows:
                    _machines_cache = [{"id": r["id"], "hostname": r["hostname"]} for r in rows]
        except Exception:
            pass
    return _machines_cache

def _get_machine_by_id_resilient(machine_id: int) -> Dict:
    machines = _get_machines_resilient()
    for m in machines:
        if m["id"] == machine_id:
            return m
    raise NotFoundError("Máquina")

@router.get("/metrics/latest")
def get_all_latest_metrics():
    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    machines = _get_machines_resilient()
    items = [get_latest_sample(m["id"], m["hostname"]) for m in machines]
    return {"items": items, "total": len(items)}

@router.get("/machines/{id}/metrics/latest")
def get_machine_latest_metrics(id: int):
    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    m = _get_machine_by_id_resilient(id)
    return get_latest_sample(m["id"], m["hostname"])

@router.get("/machines/{id}/metrics")
def get_machine_metrics_range(
    id: int,
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    step: Optional[int] = None,
):
    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    m = _get_machine_by_id_resilient(id)

    now = datetime.now(timezone.utc)
    to_iso = to_date or now.isoformat().replace("+00:00", "Z")
    from_iso = from_date or (now - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    step_seconds = step or 60

    return get_metrics_series(
        machine_id=m["id"],
        hostname=m["hostname"],
        from_iso=from_iso,
        to_iso=to_iso,
        step_seconds=step_seconds,
    )
