import time
import random
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from app.database.state import is_simulated_down

# ==============================================================================
# MÓDULO ISOLADO: APACHE CASSANDRA (RESPONSABILIDADE DO INTEGRANTE 3)
# ==============================================================================
# Este arquivo contém a estrutura base e stubs para as métricas de séries temporais
# coletadas dos computadores. Quando o integrante 3 integrar o cluster Cassandra,
# basta substituir os retornos simulados pelas consultas CQL reais.
#
# Tabela sugerida no Cassandra:
# CREATE KEYSPACE IF NOT EXISTS lanhouse WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 3};
# CREATE TABLE IF NOT EXISTS lanhouse.metrics_by_machine (
#     machine_id bigint,
#     day date,
#     ts timestamp,
#     cpu_pct double,
#     gpu_pct double,
#     ram_pct double,
#     ram_used_gb double,
#     ram_total_gb double,
#     disk_pct double,
#     net_in_kbps double,
#     net_out_kbps double,
#     latency_ms double,
#     temp_c double,
#     PRIMARY KEY ((machine_id, day), ts)
# ) WITH CLUSTERING ORDER BY (ts DESC);
# ==============================================================================

def check_cassandra_health() -> Dict[str, Any]:
    if is_simulated_down("cassandra"):
        return {"status": "down", "latency_ms": None, "error": "simulated down"}

    # TODO (Integrante 3): Executar probe real no cluster Cassandra (ex: session.execute("SELECT now() FROM system.local;"))
    return {"status": "up", "latency_ms": 12}

def generate_sample(machine_id: int, hostname: str, ts_iso: Optional[str] = None) -> Dict[str, Any]:
    now_iso = ts_iso or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    # Geração pseudo-aleatória realista baseada no ID para estabilidade
    seed_val = (machine_id * 17) % 100
    cpu = round(30.0 + (seed_val % 40) + random.uniform(0, 10), 1)
    gpu = round(40.0 + (seed_val % 35) + random.uniform(0, 15), 1)
    ram_pct = round(45.0 + (seed_val % 30) + random.uniform(0, 5), 1)
    ram_total = 16.0
    ram_used = round(ram_total * (ram_pct / 100.0), 1)

    return {
        "machine_id": machine_id,
        "hostname": hostname,
        "ts": now_iso,
        "cpu_pct": min(100.0, cpu),
        "gpu_pct": min(100.0, gpu),
        "ram_pct": min(100.0, ram_pct),
        "ram_used_gb": ram_used,
        "ram_total_gb": ram_total,
        "disk_pct": round(60.0 + (seed_val % 25), 1),
        "net_in_kbps": round(1024.0 + random.uniform(200, 3000), 1),
        "net_out_kbps": round(256.0 + random.uniform(50, 800), 1),
        "latency_ms": round(10.0 + random.uniform(1, 15), 1),
        "temp_c": round(50.0 + (cpu * 0.35), 1),
    }

def get_latest_sample(machine_id: int, hostname: str) -> Dict[str, Any]:
    # TODO (Integrante 3): Buscar a amostra mais recente no Cassandra usando CQL
    sample = generate_sample(machine_id, hostname)
    sample["last_seen_at"] = sample["ts"]
    return sample

def get_metrics_series(
    machine_id: int,
    hostname: str,
    from_iso: str,
    to_iso: str,
    step_seconds: int = 60,
) -> Dict[str, Any]:
    # TODO (Integrante 3): Fazer SELECT com range de timestamp no Cassandra
    # Exemplo simulado com pontos espaçados pelo 'step'
    from_dt = datetime.fromisoformat(from_iso.replace("Z", "+00:00"))
    to_dt = datetime.fromisoformat(to_iso.replace("Z", "+00:00"))
    
    total_seconds = int((to_dt - from_dt).total_seconds())
    points_count = min(100, max(2, total_seconds // step_seconds))
    step = total_seconds / points_count

    items = []
    for i in range(points_count):
        pt_dt = datetime.fromtimestamp(from_dt.timestamp() + i * step, tz=timezone.utc)
        items.append(generate_sample(machine_id, hostname, pt_dt.isoformat().replace("+00:00", "Z")))

    return {
        "machine_id": machine_id,
        "from": from_iso,
        "to": to_iso,
        "step_seconds": step_seconds,
        "items": items,
    }
