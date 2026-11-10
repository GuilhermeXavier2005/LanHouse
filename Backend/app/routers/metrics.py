from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict
from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.database.postgres import get_db_cursor
from app.database.state import is_simulated_down
from app.services.cassandra_service import (
    get_all_latest_samples,
    get_latest_sample,
    get_metrics_series,
    create_or_update_metric,
    delete_metric,
)
from app.errors import DatabaseUnavailableError, NotFoundError

router = APIRouter(tags=["Métricas (Cassandra)"])

# ==============================================================================
# ROTAS DE MÉTRICAS E TELEMETRIA (APACHE CASSANDRA — QUORUM)
# ==============================================================================

class MetricPayload(BaseModel):
    ts: Optional[str] = None
    cpu_pct: float = 0.0
    gpu_pct: float = 0.0
    ram_pct: float = 0.0
    ram_used_gb: Optional[float] = None
    ram_total_gb: float = 16.0
    disk_pct: float = 0.0
    net_in_kbps: int = 0
    net_out_kbps: int = 0
    latency_ms: float = 10.0
    temp_c: float = 45.0

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
    items = get_all_latest_samples(machines)
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

    return get_metrics_series(
        machine_id=m["id"],
        hostname=m["hostname"],
        from_iso=from_iso,
        to_iso=to_iso,
        step_seconds=step,
    )

@router.post("/machines/{id}/metrics", status_code=201)
def create_machine_metric(id: int, body: MetricPayload):
    """[CRUD - Create] Registra manualmente uma nova amostra de telemetria no Cassandra com QUORUM."""
    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    m = _get_machine_by_id_resilient(id)
    return create_or_update_metric(m["id"], m["hostname"], body.model_dump())

@router.put("/machines/{id}/metrics")
def update_machine_metric(id: int, body: MetricPayload):
    """[CRUD - Update] Atualiza uma amostra de telemetria existente no Cassandra e sincroniza latest_metrics_by_machine."""
    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    m = _get_machine_by_id_resilient(id)
    return create_or_update_metric(m["id"], m["hostname"], body.model_dump())

@router.delete("/machines/{id}/metrics")
def delete_machine_metric(
    id: int,
    day: str = Query(..., description="Data da partição no formato AAAA-MM-DD"),
    ts: Optional[str] = Query(None, description="Timestamp ISO 8601 específico da amostra (opcional)"),
):
    """[CRUD - Delete] Remove uma amostra específica ou partição diária no Cassandra e ressincroniza latest_metrics_by_machine."""
    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    m = _get_machine_by_id_resilient(id)
    return delete_metric(m["id"], m["hostname"], day_str=day, ts_iso=ts)
