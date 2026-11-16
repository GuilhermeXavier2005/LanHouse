// Gerador de métricas técnicas (simula a tabela de séries temporais do Cassandra).
// Os valores são função determinística de (máquina, instante), então consultas
// repetidas ao mesmo período retornam a mesma série — como num banco real.

const MIN = 60_000;

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Ruído suave em [0, 1] com período aproximado `period` (ms). */
function smooth(seed, t, period) {
  const x = t / period;
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(seed * 7919 + i) * (1 - u) + hash(seed * 7919 + i + 1) * u;
}

const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));

function intervalsFor(machine, sessions) {
  const now = Date.now();
  return sessions
    .filter((s) => s.machine_id === machine.id && s.status !== 'cancelada')
    .map((s) => [Date.parse(s.started_at), s.ended_at ? Date.parse(s.ended_at) : now]);
}

function sampleAt(machine, intervals, t) {
  const id = machine.id;
  const active = intervals.some(([a, b]) => a <= t && t <= b);
  const n1 = smooth(id, t, 40_000);
  const n2 = smooth(id + 101, t, 7 * MIN);
  const n3 = smooth(id + 211, t, 9_000);
  const n4 = smooth(id + 307, t, 50 * MIN);
  const heavy = machine.zone !== 'navegacao';

  let cpu;
  let gpu;
  let ram;
  if (active && heavy) {
    cpu = 34 + 38 * n1 + 14 * n3;
    gpu = 50 + 38 * n2 + 9 * n3;
    ram = 50 + 28 * n2 + 6 * n3;
  } else if (active) {
    cpu = 14 + 30 * n1 + 10 * n3;
    gpu = 4 + 12 * n1;
    ram = 48 + 22 * n2 + 5 * n3;
  } else {
    cpu = 2 + 6 * n1 + 3 * n3;
    gpu = 1 + 3 * n3;
    ram = 20 + 8 * n2;
  }
  let temp = 33 + cpu * 0.3 + (heavy ? gpu * 0.17 : 0) + 3 * n3;
  if (machine.status === 'manutencao') temp += 14;

  const disk = 35 + ((id * 37) % 50) + 1.5 * n4;
  const netIn = active ? (heavy ? 900 : 400) + 7000 * n1 * n2 + 600 * n3 : 4 + 40 * n3;
  const netOut = active ? 120 + 900 * n3 : 2 + 12 * n1;
  const latency = 8 + 12 * n3 + (n1 > 0.93 ? 55 * n2 : 0);
  const ramPct = clamp(ram);

  return {
    machine_id: id,
    hostname: machine.hostname,
    ts: new Date(t).toISOString(),
    cpu_pct: r1(clamp(cpu)),
    gpu_pct: r1(clamp(gpu)),
    ram_pct: r1(ramPct),
    ram_used_gb: r1((machine.ram_gb * ramPct) / 100),
    ram_total_gb: machine.ram_gb,
    disk_pct: r1(clamp(disk)),
    net_in_kbps: Math.round(netIn),
    net_out_kbps: Math.round(netOut),
    latency_ms: r1(latency),
    temp_c: r1(temp),
  };
}

/** Série de um período. Sem pontos após a última comunicação da máquina. */
export function metricsRange(machine, sessions, from, to, stepMs) {
  const until = machine.last_seen_at ? Math.min(to, Date.parse(machine.last_seen_at)) : to;
  const intervals = intervalsFor(machine, sessions);
  const step = stepMs || Math.max(10_000, Math.ceil((to - from) / 240 / 10_000) * 10_000);
  const items = [];
  for (let t = Math.ceil(from / step) * step; t <= until; t += step) items.push(sampleAt(machine, intervals, t));
  return { step, items };
}

/** Última amostra recebida da máquina. */
export function latestSample(machine, sessions) {
  const lastSeen = machine.last_seen_at ? Date.parse(machine.last_seen_at) : Date.now() - (1 + Math.floor(Math.random() * 6)) * 1000;
  return { ...sampleAt(machine, intervalsFor(machine, sessions), lastSeen), last_seen_at: new Date(lastSeen).toISOString() };
}
