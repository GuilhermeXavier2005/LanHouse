// Painel de histórico de métricas de uma máquina (consulta por máquina + período no Cassandra).

import { api } from '../api/index.js';
import { h } from './dom.js';
import { segmented, widget, sourceTag, iconButton, empty, stat } from './components.js';
import { lineChart } from './charts.js';
import { num } from '../format.js';

export const PERIODS = [
  { value: '1h', label: '1 h', ms: 3600e3 },
  { value: '6h', label: '6 h', ms: 6 * 3600e3 },
  { value: '24h', label: '24 h', ms: 24 * 3600e3 },
  { value: '7d', label: '7 dias', ms: 7 * 24 * 3600e3 },
];

const COLORS = { cpu: '#22d3ee', gpu: '#c084fc', ram: '#34d399', down: '#60a5fa', up: '#f472b6', lat: '#fbbf24', temp: '#fb7185' };

export function metricsPanel(machineId, { period = '1h' } = {}) {
  let current = period;
  const body = h('div');
  const ctl = widget(body, {
    load: () => {
      const to = Date.now();
      const ms = PERIODS.find((p) => p.value === current).ms;
      return api.machines.metrics(machineId, { from: new Date(to - ms).toISOString(), to: new Date(to).toISOString() });
    },
    render: (res) => renderMetrics(res),
    interval: 30_000,
    loadingText: 'Consultando séries temporais...',
  });
  const el = h(
    'div',
    {},
    h(
      'div',
      { class: 'toolbar' },
      segmented(PERIODS, current, (v) => {
        current = v;
        ctl.reload();
      }),
      h('span', { class: 'grow' }),
      sourceTag('cassandra'),
      iconButton('refresh', 'Atualizar', () => ctl.reload()),
    ),
    body,
  );
  return { el, stop: ctl };
}

function renderMetrics({ items, step_seconds: step }) {
  if (!items.length) return empty('Nenhuma métrica coletada neste período — a máquina pode estar sem comunicação.', 'wifiOff');
  const series = (key, scale = 1) => items.map((i) => ({ t: Date.parse(i.ts), v: i[key] == null ? null : i[key] * scale }));
  const avg = (k) => items.reduce((a, i) => a + i[k], 0) / items.length;
  const max = (k) => Math.max(...items.map((i) => i[k]));
  const pctFmt = (v) => `${Math.round(v)}%`;

  return [
    h(
      'div',
      { class: 'stat-strip' },
      stat('CPU média', `${num(avg('cpu_pct'))}%`),
      stat('Pico de CPU', `${num(max('cpu_pct'))}%`),
      stat('RAM média', `${num(avg('ram_pct'))}%`),
      stat('Temp. máxima', `${num(max('temp_c'))} °C`),
      stat('Latência média', `${num(avg('latency_ms'))} ms`),
      stat('Amostras', `${num(items.length)} · ${step >= 60 ? `${Math.round(step / 60)} min` : `${step} s`}`),
    ),
    h(
      'div',
      { class: 'grid grid-2' },
      chartBox('Processamento', lineChart({ series: [{ name: 'CPU', color: COLORS.cpu, points: series('cpu_pct') }, { name: 'GPU', color: COLORS.gpu, points: series('gpu_pct') }], yMax: 100, format: pctFmt })),
      chartBox('Memória e disco', lineChart({ series: [{ name: 'RAM', color: COLORS.ram, points: series('ram_pct') }, { name: 'Disco', color: COLORS.lat, points: series('disk_pct') }], yMax: 100, format: pctFmt })),
      chartBox('Tráfego de rede (Mbps)', lineChart({ series: [{ name: 'Download', color: COLORS.down, points: series('net_in_kbps', 1 / 1000) }, { name: 'Upload', color: COLORS.up, points: series('net_out_kbps', 1 / 1000) }], format: (v) => num(v, v < 10 ? 1 : 0) })),
      chartBox('Latência (ms) e temperatura (°C)', lineChart({ series: [{ name: 'Latência', color: COLORS.lat, points: series('latency_ms') }, { name: 'Temperatura', color: COLORS.temp, points: series('temp_c') }], format: (v) => num(v) })),
    ),
  ];
}

const chartBox = (title, chart) => h('div', { class: 'chart-box' }, h('div', { class: 'chart-title' }, title), chart);
