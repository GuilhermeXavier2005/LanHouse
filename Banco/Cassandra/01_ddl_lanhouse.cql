-- ============================================================================
-- LanHouse Monitor — Modelagem Wide-Column (Apache Cassandra / CQL)
-- ============================================================================
-- Keyspace com NetworkTopologyStrategy e fator de replicação 3 (RF = 3).
-- Com 3 nós no cluster e operações em nível de consistência QUORUM,
-- são exigidas 2 réplicas para leitura e escrita, tolerando a falha de 1 nó.
-- ============================================================================

CREATE KEYSPACE IF NOT EXISTS lanhouse
WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'replication_factor': 3
};

-- 1. Série temporal de telemetria particionada por (machine_id, day)
--    e ordenada pela clustering column ts DESC (mais recentes primeiro).
CREATE TABLE IF NOT EXISTS lanhouse.metrics_by_machine (
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

-- 2. Tabela de leitura rápida da última amostra recebida de cada máquina
--    (mantida sincronizada nas escritas, atualizações e exclusões).
CREATE TABLE IF NOT EXISTS lanhouse.latest_metrics_by_machine (
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
