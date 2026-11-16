import asyncio
import math
import threading
import time
from datetime import datetime, date, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple

from cassandra import ConsistencyLevel, Unavailable, OperationTimedOut, ReadTimeout, WriteTimeout
from cassandra.cluster import Cluster, Session, NoHostAvailable, ExecutionProfile, EXEC_PROFILE_DEFAULT
from cassandra.policies import WhiteListRoundRobinPolicy
from cassandra.query import SimpleStatement, BatchStatement, BatchType, dict_factory

from app import config
from app.database.state import is_simulated_down
from app.errors import DatabaseUnavailableError, NotFoundError, ValidationError

# ==============================================================================
# SERVIÇO APACHE CASSANDRA — CLUSTER 3 NÓS (RF = 3, CONSISTÊNCIA QUORUM)
# ==============================================================================
# Ajustes técnicos implementados:
# 1. Failover explícito nas portas do Host (9042, 9043, 9044) usando
#    WhiteListRoundRobinPolicy(['127.0.0.1']) para evitar que o driver tente
#    conectar nos IPs internos da bridge Docker (172.x.x.x) inacessíveis no Windows.
#    O nó conectado atua como coordenador CQL e conversa internamente via rede
#    Docker com os demais nós para atingir ConsistencyLevel.QUORUM (2 de 3 réplicas).
# 2. Seed histórico de 7 dias particionado por (machine_id, day) em lotes de no
#    máximo 20 linhas por BatchStatement da mesma partição (evitando 'Batch too large').
# 3. Retry automático no startup aguardando o quórum (2 nós ativos) antes de rodar o seed.
# 4. Keyspace com NetworkTopologyStrategy (replication_factor: 3) e sincronização
#    automática de latest_metrics_by_machine em POST, PUT e DELETE.
# ==============================================================================

_clusters: Dict[int, Cluster] = {}
_sessions: Dict[int, Session] = {}
_active_port: Optional[int] = None
_schema_ready: bool = False
_seeded: bool = False
_seed_lock = threading.Lock()
_bg_task: Optional[asyncio.Task] = None

def _norm_ts(dt: datetime) -> datetime:
    """Normaliza timestamps para UTC com precisão de milissegundos (padrão CQL timestamp)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.replace(microsecond=(dt.microsecond // 1000) * 1000)

def _close_port(port: int) -> None:
    global _active_port
    sess = _sessions.pop(port, None)
    cluster = _clusters.pop(port, None)
    if _active_port == port:
        _active_port = None
    try:
        if sess:
            sess.shutdown()
    except Exception:
        pass
    try:
        if cluster:
            cluster.shutdown()
    except Exception:
        pass

def _connect_to_port(port: int) -> Session:
    if port in _sessions and not _sessions[port].is_shutdown:
        return _sessions[port]

    _close_port(port)

    profile = ExecutionProfile(
        load_balancing_policy=WhiteListRoundRobinPolicy([config.CASSANDRA_HOST]),
        request_timeout=4.0,
        consistency_level=ConsistencyLevel.QUORUM,
        row_factory=dict_factory,
    )
    cluster = Cluster(
        contact_points=[config.CASSANDRA_HOST],
        port=port,
        execution_profiles={EXEC_PROFILE_DEFAULT: profile},
        connect_timeout=2.5,
        control_connection_timeout=2.5,
        idle_heartbeat_interval=15,
    )
    session = cluster.connect()
    _clusters[port] = cluster
    _sessions[port] = session
    return session

def get_cassandra_session(require_keyspace: bool = True) -> Session:
    """
    Obtém uma sessão CQL ativa testando as portas do host [9042, 9043, 9044].
    Se o nó atual (ex: cassandra1 na 9042) cair, faz failover imediato para
    9043 (cassandra2) ou 9044 (cassandra3).
    """
    global _active_port

    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    candidates: List[int] = []
    if _active_port is not None:
        candidates.append(_active_port)
    for p in config.CASSANDRA_PORTS:
        if p not in candidates:
            candidates.append(p)

    last_err = None
    for port in candidates:
        try:
            session = _connect_to_port(port)
            # Testa se a conexão está viva no coordenador
            session.execute(SimpleStatement("SELECT release_version FROM system.local;", consistency_level=ConsistencyLevel.ONE), timeout=2.0)
            if require_keyspace and _schema_ready:
                session.set_keyspace(config.CASSANDRA_KEYSPACE)
            _active_port = port
            return session
        except Exception as e:
            last_err = e
            _close_port(port)
            continue

    raise DatabaseUnavailableError(
        "cassandra",
        f"Não foi possível conectar a nenhum nó do Apache Cassandra nas portas {config.CASSANDRA_PORTS} ({last_err}).",
    )

def execute_quorum(query: str, params: Optional[tuple] = None, consistency: int = ConsistencyLevel.QUORUM):
    """
    Executa uma instrução CQL com ConsistencyLevel.QUORUM e failover automático de porta
    caso o coordenador atual tenha sido derrubado.
    Se menos de 2 réplicas estiverem ativas no anel, captura Unavailable e levanta 503.
    """
    if is_simulated_down("cassandra"):
        raise DatabaseUnavailableError("cassandra")

    if not _schema_ready:
        ensure_cassandra_schema()

    last_err = None
    # Tenta em todas as portas candidatas permitindo trocar de coordenador se o atual caiu
    for _ in range(len(config.CASSANDRA_PORTS)):
        try:
            session = get_cassandra_session(require_keyspace=True)
            stmt = SimpleStatement(query, consistency_level=consistency)
            return session.execute(stmt, params or (), timeout=4.0)
        except Unavailable as e:
            # Quórum perdido (ex.: 2 de 3 nós desligados -> alive_replicas < required_replicas)
            raise DatabaseUnavailableError(
                "cassandra",
                f"Quórum do Apache Cassandra indisponível (necessárias {e.required_replicas} réplicas, ativas: {e.alive_replicas}).",
            )
        except (NoHostAvailable, OperationTimedOut, ReadTimeout, WriteTimeout) as e:
            last_err = e
            # Verifica se algum erro interno do NoHostAvailable foi por falta de QUORUM (Unavailable)
            if isinstance(e, NoHostAvailable):
                for sub_err in getattr(e, "errors", {}).values():
                    if isinstance(sub_err, Unavailable):
                        raise DatabaseUnavailableError(
                            "cassandra",
                            f"Quórum do Apache Cassandra indisponível (necessárias {sub_err.required_replicas} réplicas, ativas: {sub_err.alive_replicas}).",
                        )
            if _active_port is not None:
                _close_port(_active_port)
            continue
        except DatabaseUnavailableError:
            raise
        except Exception as e:
            last_err = e
            if _active_port is not None:
                _close_port(_active_port)
            continue

    raise DatabaseUnavailableError("cassandra", f"Falha ao consultar o Apache Cassandra com QUORUM: {last_err}")

def check_cassandra_health() -> Dict[str, Any]:
    """
    Verifica a saúde do cluster Cassandra exigindo ConsistencyLevel.QUORUM.
    - 3 nós ativos ou 2 nós ativos (1 parado): QUORUM responde 'up' com latência real.
    - 2 ou 3 nós parados (ou simulação ativa): QUORUM falha e responde 'down'.
    """
    if is_simulated_down("cassandra"):
        return {"status": "down", "latency_ms": None, "error": "simulated down"}

    t0 = time.perf_counter()
    try:
        if not _schema_ready:
            ensure_cassandra_schema()
        execute_quorum(
            f"SELECT machine_id FROM {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine LIMIT 1;",
            consistency=ConsistencyLevel.QUORUM,
        )
        latency = round((time.perf_counter() - t0) * 1000)
        return {"status": "up", "latency_ms": max(1, latency)}
    except Exception as e:
        err_msg = getattr(e, "message", str(e))
        return {"status": "down", "latency_ms": None, "error": err_msg}

# ==============================================================================
# GERADOR DETERMINÍSTICO / REALISTA DE AMOSTRAS (PARIDADE COM FRONTEND)
# ==============================================================================

def _hash(n: float) -> float:
    x = math.sin(n * 12.9898) * 43758.5453
    return x - math.floor(x)

def _smooth(seed: int, t_ms: float, period_ms: float) -> float:
    x = t_ms / period_ms
    i = math.floor(x)
    f = x - i
    u = f * f * (3.0 - 2.0 * f)
    return _hash(seed * 7919 + i) * (1.0 - u) + _hash(seed * 7919 + i + 1) * u

def _clamp(v: float, a: float = 0.0, b: float = 100.0) -> float:
    return min(b, max(a, v))

def compute_sample_values(
    machine_id: int,
    hostname: str,
    dt: datetime,
    in_session: bool = False,
    status: str = "disponivel",
    zone: str = "arena",
    ram_total_gb: float = 16.0,
) -> Dict[str, Any]:
    t_ms = dt.timestamp() * 1000.0
    n1 = _smooth(machine_id, t_ms, 40_000.0)
    n2 = _smooth(machine_id + 101, t_ms, 420_000.0)
    n3 = _smooth(machine_id + 211, t_ms, 9_000.0)
    n4 = _smooth(machine_id + 307, t_ms, 3_000_000.0)
    heavy = zone != "navegacao"

    if in_session and heavy:
        cpu = 34.0 + 38.0 * n1 + 14.0 * n3
        gpu = 50.0 + 38.0 * n2 + 9.0 * n3
        ram = 50.0 + 28.0 * n2 + 6.0 * n3
    elif in_session:
        cpu = 14.0 + 30.0 * n1 + 10.0 * n3
        gpu = 4.0 + 12.0 * n1
        ram = 48.0 + 22.0 * n2 + 5.0 * n3
    else:
        cpu = 4.0 + 8.0 * n1 + 3.0 * n3
        gpu = 2.0 + 4.0 * n3
        ram = 22.0 + 8.0 * n2

    temp = 34.0 + cpu * 0.3 + (gpu * 0.17 if heavy else 0.0) + 3.0 * n3
    if status == "manutencao":
        temp += 14.0

    disk = 35.0 + ((machine_id * 37) % 50) + 1.5 * n4
    net_in = (900.0 if heavy else 400.0) + 7000.0 * n1 * n2 + 600.0 * n3 if in_session else 8.0 + 40.0 * n3
    net_out = 120.0 + 900.0 * n3 if in_session else 3.0 + 12.0 * n1
    latency = 8.0 + 12.0 * n3 + (55.0 * n2 if n1 > 0.93 else 0.0)

    cpu_pct = round(_clamp(cpu), 1)
    gpu_pct = round(_clamp(gpu), 1)
    ram_pct = round(_clamp(ram), 1)
    ram_used_gb = round((ram_total_gb * ram_pct) / 100.0, 1)

    norm_dt = _norm_ts(dt)
    return {
        "machine_id": int(machine_id),
        "hostname": hostname,
        "day": norm_dt.date(),
        "ts": norm_dt,
        "cpu_pct": cpu_pct,
        "gpu_pct": gpu_pct,
        "ram_pct": ram_pct,
        "ram_used_gb": ram_used_gb,
        "ram_total_gb": float(ram_total_gb),
        "disk_pct": round(_clamp(disk), 1),
        "net_in_kbps": int(round(net_in)),
        "net_out_kbps": int(round(net_out)),
        "latency_ms": round(latency, 1),
        "temp_c": round(temp, 1),
    }

# ==============================================================================
# CRIAÇÃO DE SCHEMA, SEED DE 7 DIAS (BATCH <= 20) E COLETOR EM TEMPO REAL
# ==============================================================================

def ensure_cassandra_schema() -> bool:
    """
    Cria o Keyspace 'lanhouse' com NetworkTopologyStrategy (replication_factor: 3)
    e as tabelas 'metrics_by_machine' e 'latest_metrics_by_machine'.
    """
    global _schema_ready
    try:
        session = get_cassandra_session(require_keyspace=False)
        session.execute(
            SimpleStatement(
                f"""
                CREATE KEYSPACE IF NOT EXISTS {config.CASSANDRA_KEYSPACE}
                WITH replication = {{
                    'class': 'NetworkTopologyStrategy',
                    'replication_factor': 3
                }};
                """,
                consistency_level=ConsistencyLevel.ONE,
            ),
            timeout=10.0,
        )
        session.set_keyspace(config.CASSANDRA_KEYSPACE)

        session.execute(
            SimpleStatement(
                f"""
                CREATE TABLE IF NOT EXISTS {config.CASSANDRA_KEYSPACE}.metrics_by_machine (
                    machine_id bigint,
                    day date,
                    ts timestamp,
                    hostname text,
                    cpu_pct double,
                    gpu_pct double,
                    ram_pct double,
                    ram_used_gb double,
                    ram_total_gb double,
                    disk_pct double,
                    net_in_kbps bigint,
                    net_out_kbps bigint,
                    latency_ms double,
                    temp_c double,
                    PRIMARY KEY ((machine_id, day), ts)
                ) WITH CLUSTERING ORDER BY (ts DESC);
                """,
                consistency_level=ConsistencyLevel.ONE,
            ),
            timeout=10.0,
        )

        session.execute(
            SimpleStatement(
                f"""
                CREATE TABLE IF NOT EXISTS {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine (
                    machine_id bigint PRIMARY KEY,
                    hostname text,
                    ts timestamp,
                    last_seen_at timestamp,
                    cpu_pct double,
                    gpu_pct double,
                    ram_pct double,
                    ram_used_gb double,
                    ram_total_gb double,
                    disk_pct double,
                    net_in_kbps bigint,
                    net_out_kbps bigint,
                    latency_ms double,
                    temp_c double
                );
                """,
                consistency_level=ConsistencyLevel.ONE,
            ),
            timeout=10.0,
        )
        _schema_ready = True
        return True
    except Exception as e:
        print(f"[Cassandra] Aguardando cluster para aplicar schema: {e}")
        return False

def _fetch_machines_snapshot() -> List[Dict[str, Any]]:
    """
    Obtém snapshot das máquinas e sessões ativas no PostgreSQL, ou usa fallback
    das 4 máquinas padrão se o PostgreSQL estiver indisponível.
    """
    default_machines = [
        {"id": 1, "hostname": "PC-01", "status": "em_uso", "zone": "arena", "ram_gb": 16.0, "in_session": True},
        {"id": 2, "hostname": "PC-02", "status": "disponivel", "zone": "arena", "ram_gb": 16.0, "in_session": False},
        {"id": 3, "hostname": "PC-03", "status": "offline", "zone": "navegacao", "ram_gb": 8.0, "in_session": False},
        {"id": 4, "hostname": "PC-04", "status": "manutencao", "zone": "arena", "ram_gb": 32.0, "in_session": False},
    ]
    if is_simulated_down("postgres"):
        return default_machines

    try:
        from app.database.postgres import get_db_cursor
        from app.routers.machines import map_zone_to_api
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT m.id, m.codigo as hostname, m.status, m.grupo, m.memoria_gb,
                       EXISTS(SELECT 1 FROM sessoes_uso s WHERE s.maquina_id = m.id AND s.fim IS NULL) as in_session
                FROM maquinas m
                ORDER BY m.id ASC;
            """)
            rows = cur.fetchall()
            if not rows:
                return default_machines
            result = []
            for r in rows:
                in_sess = bool(r["in_session"])
                db_st = r["status"]
                api_st = ("em_uso" if in_sess else "disponivel") if db_st == "online" else db_st
                result.append({
                    "id": int(r["id"]),
                    "hostname": r["hostname"],
                    "status": api_st,
                    "zone": map_zone_to_api(r.get("grupo")),
                    "ram_gb": float(r.get("memoria_gb") or 16.0),
                    "in_session": in_sess,
                })
            return result
    except Exception:
        return default_machines

def seed_historical_metrics_if_empty() -> bool:
    """
    Verifica se o Cassandra já possui dados em latest_metrics_by_machine (usando QUORUM).
    Se estiver vazio, popula 7 dias de histórico para cada máquina usando batches
    de no máximo 20 registros da mesma partição (machine_id, day).
    """
    global _seeded
    if _seeded:
        return True

    with _seed_lock:
        if _seeded:
            return True

        if not _schema_ready and not ensure_cassandra_schema():
            return False

        try:
            rows = list(
                execute_quorum(
                    f"SELECT machine_id FROM {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine LIMIT 1;",
                    consistency=ConsistencyLevel.QUORUM,
                )
            )
            if rows:
                _seeded = True
                print("[Cassandra] Dados históricos já existentes (QUORUM OK).")
                return True

            print("[Cassandra] Populando seed histórico de 7 dias com ConsistencyLevel.QUORUM...")
            session = get_cassandra_session(require_keyspace=True)

            insert_series_cql = session.prepare(f"""
                INSERT INTO {config.CASSANDRA_KEYSPACE}.metrics_by_machine (
                    machine_id, day, ts, hostname, cpu_pct, gpu_pct, ram_pct,
                    ram_used_gb, ram_total_gb, disk_pct, net_in_kbps, net_out_kbps,
                    latency_ms, temp_c
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """)
            insert_latest_cql = session.prepare(f"""
                INSERT INTO {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine (
                    machine_id, hostname, ts, last_seen_at, cpu_pct, gpu_pct, ram_pct,
                    ram_used_gb, ram_total_gb, disk_pct, net_in_kbps, net_out_kbps,
                    latency_ms, temp_c
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """)
            insert_latest_cql.consistency_level = ConsistencyLevel.QUORUM

            now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
            machines = _fetch_machines_snapshot()

            # Gera timestamps dos últimos 7 dias:
            # - De 7 dias atrás até 24h atrás: a cada 30 min
            # - De 24h atrás até 1h atrás: a cada 5 min
            # - Última 1h: a cada 1 min
            timestamps: List[datetime] = []
            t_cursor = now - timedelta(days=7)
            t_24h = now - timedelta(hours=24)
            t_1h = now - timedelta(hours=1)

            while t_cursor < t_24h:
                timestamps.append(t_cursor)
                t_cursor += timedelta(minutes=30)
            while t_cursor < t_1h:
                timestamps.append(t_cursor)
                t_cursor += timedelta(minutes=5)
            while t_cursor <= now:
                timestamps.append(t_cursor)
                t_cursor += timedelta(minutes=1)

            for m in machines:
                mid = m["id"]
                # Se a máquina estiver offline (ex: PC-03), a última comunicação parou há 3 horas
                cutoff_dt = (now - timedelta(hours=3)) if m["status"] == "offline" else now

                by_day: Dict[date, List[Dict[str, Any]]] = {}
                latest_sample: Optional[Dict[str, Any]] = None

                for ts_dt in timestamps:
                    if ts_dt > cutoff_dt:
                        break
                    # Simula períodos em uso durante o dia (10h às 22h) ou sessão ativa atual
                    hour_utc = ts_dt.hour
                    simulated_active = m["in_session"] if (now - ts_dt) < timedelta(minutes=45) else (12 <= hour_utc <= 23 and (mid + ts_dt.day) % 2 == 0)
                    sample = compute_sample_values(
                        machine_id=mid,
                        hostname=m["hostname"],
                        dt=ts_dt,
                        in_session=simulated_active,
                        status=m["status"],
                        zone=m["zone"],
                        ram_total_gb=m["ram_gb"],
                    )
                    by_day.setdefault(sample["day"], []).append(sample)
                    latest_sample = sample

                # Insere em lotes de no máximo 20 linhas por partição (machine_id, day)
                for day_key, day_samples in by_day.items():
                    for i in range(0, len(day_samples), 20):
                        chunk = day_samples[i : i + 20]
                        batch = BatchStatement(
                            batch_type=BatchType.UNLOGGED,
                            consistency_level=ConsistencyLevel.QUORUM,
                        )
                        for s in chunk:
                            batch.add(
                                insert_series_cql,
                                (
                                    s["machine_id"], s["day"], s["ts"], s["hostname"],
                                    s["cpu_pct"], s["gpu_pct"], s["ram_pct"],
                                    s["ram_used_gb"], s["ram_total_gb"], s["disk_pct"],
                                    s["net_in_kbps"], s["net_out_kbps"], s["latency_ms"], s["temp_c"],
                                ),
                            )
                        session.execute(batch, timeout=10.0)

                if latest_sample:
                    session.execute(
                        insert_latest_cql,
                        (
                            latest_sample["machine_id"], latest_sample["hostname"],
                            latest_sample["ts"], latest_sample["ts"],
                            latest_sample["cpu_pct"], latest_sample["gpu_pct"], latest_sample["ram_pct"],
                            latest_sample["ram_used_gb"], latest_sample["ram_total_gb"], latest_sample["disk_pct"],
                            latest_sample["net_in_kbps"], latest_sample["net_out_kbps"],
                            latest_sample["latency_ms"], latest_sample["temp_c"],
                        ),
                        timeout=5.0,
                    )

            _seeded = True
            print("[Cassandra] Seed histórico de 7 dias concluído com sucesso (QUORUM)!")
            return True
        except Exception as e:
            print(f"[Cassandra] Aguardando quórum (2/3 réplicas) para concluir o seed inicial: {e}")
            return False

def collect_live_metrics_once() -> None:
    """
    Coleta e grava uma nova amostra em tempo real no Cassandra (com QUORUM)
    para todas as máquinas que não estão 'offline'.
    """
    if is_simulated_down("cassandra") or not _seeded:
        return

    now = datetime.now(timezone.utc)
    machines = _fetch_machines_snapshot()

    for m in machines:
        if m["status"] == "offline":
            continue
        sample = compute_sample_values(
            machine_id=m["id"],
            hostname=m["hostname"],
            dt=now,
            in_session=m["in_session"],
            status=m["status"],
            zone=m["zone"],
            ram_total_gb=m["ram_gb"],
        )
        _write_sample_to_cassandra(sample, update_latest=True)

async def _cassandra_lifecycle_loop():
    """
    Loop assíncrono em background:
    1. Aguarda o cluster formar quórum e aplica o schema + seed de 7 dias (retry a cada 5s).
    2. Após o seed, grava novas amostras de telemetria a cada 10s com QUORUM.
    """
    while True:
        try:
            if not _seeded:
                await asyncio.to_thread(seed_historical_metrics_if_empty)
                await asyncio.sleep(5)
            else:
                await asyncio.to_thread(collect_live_metrics_once)
                await asyncio.sleep(10)
        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(5)

def start_cassandra_background_worker() -> asyncio.Task:
    global _bg_task
    _bg_task = asyncio.create_task(_cassandra_lifecycle_loop())
    return _bg_task

def stop_cassandra_background_worker() -> None:
    global _bg_task
    if _bg_task and not _bg_task.done():
        _bg_task.cancel()
    for p in list(_sessions.keys()):
        _close_port(p)

# ==============================================================================
# OPERAÇÕES DE LEITURA E CRUD COMPLETO COM QUORUM E SINCRONIA DE TABELAS
# ==============================================================================

def _format_ts(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(val)

def _format_metric_row(row: Dict[str, Any], include_last_seen: bool = False) -> Dict[str, Any]:
    ts_iso = _format_ts(row.get("ts"))
    out = {
        "machine_id": int(row["machine_id"]),
        "hostname": row.get("hostname") or f"PC-{int(row['machine_id']):02d}",
        "ts": ts_iso,
        "cpu_pct": round(float(row.get("cpu_pct") or 0.0), 1),
        "gpu_pct": round(float(row.get("gpu_pct") or 0.0), 1),
        "ram_pct": round(float(row.get("ram_pct") or 0.0), 1),
        "ram_used_gb": round(float(row.get("ram_used_gb") or 0.0), 1),
        "ram_total_gb": round(float(row.get("ram_total_gb") or 16.0), 1),
        "disk_pct": round(float(row.get("disk_pct") or 0.0), 1),
        "net_in_kbps": int(row.get("net_in_kbps") or 0),
        "net_out_kbps": int(row.get("net_out_kbps") or 0),
        "latency_ms": round(float(row.get("latency_ms") or 0.0), 1),
        "temp_c": round(float(row.get("temp_c") or 0.0), 1),
    }
    if include_last_seen:
        out["last_seen_at"] = _format_ts(row.get("last_seen_at") or row.get("ts"))
    return out

def _write_sample_to_cassandra(sample: Dict[str, Any], update_latest: bool = True) -> None:
    execute_quorum(
        f"""
        INSERT INTO {config.CASSANDRA_KEYSPACE}.metrics_by_machine (
            machine_id, day, ts, hostname, cpu_pct, gpu_pct, ram_pct,
            ram_used_gb, ram_total_gb, disk_pct, net_in_kbps, net_out_kbps,
            latency_ms, temp_c
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """,
        (
            sample["machine_id"], sample["day"], sample["ts"], sample["hostname"],
            sample["cpu_pct"], sample["gpu_pct"], sample["ram_pct"],
            sample["ram_used_gb"], sample["ram_total_gb"], sample["disk_pct"],
            sample["net_in_kbps"], sample["net_out_kbps"], sample["latency_ms"], sample["temp_c"],
        ),
        consistency=ConsistencyLevel.QUORUM,
    )

    if update_latest:
        # Verifica se esta amostra é mais recente ou igual à registrada em latest_metrics_by_machine
        current_latest = list(
            execute_quorum(
                f"SELECT ts FROM {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine WHERE machine_id = %s;",
                (sample["machine_id"],),
                consistency=ConsistencyLevel.QUORUM,
            )
        )
        should_update = True
        if current_latest and current_latest[0].get("ts"):
            prev_ts = current_latest[0]["ts"]
            if prev_ts.tzinfo is None:
                prev_ts = prev_ts.replace(tzinfo=timezone.utc)
            if sample["ts"] < prev_ts:
                should_update = False

        if should_update:
            execute_quorum(
                f"""
                INSERT INTO {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine (
                    machine_id, hostname, ts, last_seen_at, cpu_pct, gpu_pct, ram_pct,
                    ram_used_gb, ram_total_gb, disk_pct, net_in_kbps, net_out_kbps,
                    latency_ms, temp_c
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    sample["machine_id"], sample["hostname"], sample["ts"], sample["ts"],
                    sample["cpu_pct"], sample["gpu_pct"], sample["ram_pct"],
                    sample["ram_used_gb"], sample["ram_total_gb"], sample["disk_pct"],
                    sample["net_in_kbps"], sample["net_out_kbps"], sample["latency_ms"], sample["temp_c"],
                ),
                consistency=ConsistencyLevel.QUORUM,
            )

def _resync_latest_for_machine(machine_id: int, hostname: str) -> None:
    """
    Recalcula a amostra mais recente da máquina varrendo os últimos 8 dias em
    metrics_by_machine e sincroniza latest_metrics_by_machine.
    """
    today = datetime.now(timezone.utc).date()
    for d_offset in range(0, 8):
        day_check = today - timedelta(days=d_offset)
        rows = list(
            execute_quorum(
                f"""
                SELECT * FROM {config.CASSANDRA_KEYSPACE}.metrics_by_machine
                WHERE machine_id = %s AND day = %s
                LIMIT 1;
                """,
                (machine_id, day_check),
                consistency=ConsistencyLevel.QUORUM,
            )
        )
        if rows:
            r = rows[0]
            execute_quorum(
                f"""
                INSERT INTO {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine (
                    machine_id, hostname, ts, last_seen_at, cpu_pct, gpu_pct, ram_pct,
                    ram_used_gb, ram_total_gb, disk_pct, net_in_kbps, net_out_kbps,
                    latency_ms, temp_c
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    machine_id, r.get("hostname") or hostname, r["ts"], r["ts"],
                    r["cpu_pct"], r["gpu_pct"], r["ram_pct"],
                    r["ram_used_gb"], r["ram_total_gb"], r["disk_pct"],
                    r["net_in_kbps"], r["net_out_kbps"], r["latency_ms"], r["temp_c"],
                ),
                consistency=ConsistencyLevel.QUORUM,
            )
            return

    # Se não restou nenhuma amostra nos últimos 8 dias, remove de latest_metrics_by_machine
    execute_quorum(
        f"DELETE FROM {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine WHERE machine_id = %s;",
        (machine_id,),
        consistency=ConsistencyLevel.QUORUM,
    )

def get_all_latest_samples(machines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not _seeded:
        seed_historical_metrics_if_empty()
    rows = list(
        execute_quorum(
            f"SELECT * FROM {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine;",
            consistency=ConsistencyLevel.QUORUM,
        )
    )
    by_id = {int(r["machine_id"]): r for r in rows}
    items = []
    for m in machines:
        mid = int(m["id"])
        if mid in by_id:
            r = by_id[mid]
            r["hostname"] = m["hostname"]
            items.append(_format_metric_row(r, include_last_seen=True))
    return items

def get_latest_sample(machine_id: int, hostname: str) -> Dict[str, Any]:
    if not _seeded:
        seed_historical_metrics_if_empty()
    rows = list(
        execute_quorum(
            f"SELECT * FROM {config.CASSANDRA_KEYSPACE}.latest_metrics_by_machine WHERE machine_id = %s;",
            (machine_id,),
            consistency=ConsistencyLevel.QUORUM,
        )
    )
    if not rows:
        raise NotFoundError("Amostra de telemetria")
    r = rows[0]
    r["hostname"] = hostname
    return _format_metric_row(r, include_last_seen=True)

def get_metrics_series(
    machine_id: int,
    hostname: str,
    from_iso: str,
    to_iso: str,
    step_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    if not _seeded:
        seed_historical_metrics_if_empty()
    try:
        from_dt = datetime.fromisoformat(from_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
        to_dt = datetime.fromisoformat(to_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        raise ValidationError({"from": "Formato de data ISO 8601 inválido."})

    if from_dt >= to_dt:
        raise ValidationError({"from": "O início do período deve ser anterior ao fim."})
    if (to_dt - from_dt).days > 31:
        raise ValidationError({"to": "Período máximo de consulta é de 31 dias."})

    total_sec = max(1, int((to_dt - from_dt).total_seconds()))
    auto_step = max(10, int(math.ceil(total_sec / 240.0 / 10.0) * 10))
    step = int(step_seconds) if (step_seconds and step_seconds > 0) else auto_step

    # Percorre todas as partições diárias (machine_id, day) dentro do intervalo [from_dt, to_dt]
    cur_date = from_dt.date()
    end_date = to_dt.date()
    raw_rows: List[Dict[str, Any]] = []

    while cur_date <= end_date:
        part_rows = list(
            execute_quorum(
                f"""
                SELECT * FROM {config.CASSANDRA_KEYSPACE}.metrics_by_machine
                WHERE machine_id = %s AND day = %s AND ts >= %s AND ts <= %s;
                """,
                (machine_id, cur_date, from_dt, to_dt),
                consistency=ConsistencyLevel.QUORUM,
            )
        )
        raw_rows.extend(part_rows)
        cur_date += timedelta(days=1)

    # Ordena cronologicamente (ts ASC) para renderização nos gráficos do Front-end
    for r in raw_rows:
        if r["ts"].tzinfo is None:
            r["ts"] = r["ts"].replace(tzinfo=timezone.utc)
    raw_rows.sort(key=lambda r: r["ts"])

    # Downsampling por janela 'step' para não sobrecarregar o SVG do Front-end em janelas longas (ex: 7 dias)
    sampled: List[Dict[str, Any]] = []
    last_bucket: Optional[int] = None
    for r in raw_rows:
        bucket = int(r["ts"].timestamp()) // max(1, step)
        if step <= 60 or bucket != last_bucket:
            r["hostname"] = hostname
            sampled.append(_format_metric_row(r, include_last_seen=False))
            last_bucket = bucket

    return {
        "machine_id": machine_id,
        "from": from_dt.isoformat().replace("+00:00", "Z"),
        "to": to_dt.isoformat().replace("+00:00", "Z"),
        "step_seconds": step,
        "items": sampled,
    }

def create_or_update_metric(machine_id: int, hostname: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    [CRUD - Create / Update] Insere ou atualiza uma amostra em metrics_by_machine
    e sincroniza latest_metrics_by_machine caso seja a mais recente.
    """
    ts_str = data.get("ts")
    if ts_str:
        dt = _norm_ts(datetime.fromisoformat(ts_str.replace("Z", "+00:00")))
    else:
        dt = _norm_ts(datetime.now(timezone.utc))

    ram_total = float(data.get("ram_total_gb") or 16.0)
    ram_pct = float(data.get("ram_pct") or 0.0)
    ram_used = float(data.get("ram_used_gb") if data.get("ram_used_gb") is not None else round((ram_total * ram_pct) / 100.0, 1))

    sample = {
        "machine_id": int(machine_id),
        "hostname": hostname,
        "day": dt.date(),
        "ts": dt,
        "cpu_pct": round(float(data.get("cpu_pct") or 0.0), 1),
        "gpu_pct": round(float(data.get("gpu_pct") or 0.0), 1),
        "ram_pct": round(ram_pct, 1),
        "ram_used_gb": round(ram_used, 1),
        "ram_total_gb": round(ram_total, 1),
        "disk_pct": round(float(data.get("disk_pct") or 0.0), 1),
        "net_in_kbps": int(data.get("net_in_kbps") or 0),
        "net_out_kbps": int(data.get("net_out_kbps") or 0),
        "latency_ms": round(float(data.get("latency_ms") or 10.0), 1),
        "temp_c": round(float(data.get("temp_c") or 45.0), 1),
    }

    _write_sample_to_cassandra(sample, update_latest=True)
    return _format_metric_row(sample, include_last_seen=True)

def delete_metric(machine_id: int, hostname: str, day_str: str, ts_iso: Optional[str] = None) -> Dict[str, Any]:
    """
    [CRUD - Delete] Remove uma amostra específica (machine_id, day, ts) ou toda a
    partição diária (machine_id, day) e ressincroniza latest_metrics_by_machine.
    """
    try:
        day_val = date.fromisoformat(day_str)
    except Exception:
        raise ValidationError({"day": "Informe a data no formato AAAA-MM-DD."})

    if ts_iso:
        try:
            ts_dt = _norm_ts(datetime.fromisoformat(ts_iso.replace("Z", "+00:00")))
        except Exception:
            raise ValidationError({"ts": "Informe o timestamp no formato ISO 8601."})

        execute_quorum(
            f"DELETE FROM {config.CASSANDRA_KEYSPACE}.metrics_by_machine WHERE machine_id = %s AND day = %s AND ts = %s;",
            (machine_id, day_val, ts_dt),
            consistency=ConsistencyLevel.QUORUM,
        )
    else:
        execute_quorum(
            f"DELETE FROM {config.CASSANDRA_KEYSPACE}.metrics_by_machine WHERE machine_id = %s AND day = %s;",
            (machine_id, day_val),
            consistency=ConsistencyLevel.QUORUM,
        )

    _resync_latest_for_machine(machine_id, hostname)
    return {"deleted": True, "machine_id": machine_id, "day": day_str, "ts": ts_iso}
