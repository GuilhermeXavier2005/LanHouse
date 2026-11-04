// Mapa do salão: cada máquina como um "card" colorido pelo estado, agrupado por área.

import { h } from './dom.js';
import { icon } from './icons.js';
import { empty } from './components.js';
import { levelColor } from './charts.js';
import { MACHINE_STATUS, ZONES } from '../constants.js';
import { clock, relative, pct } from '../format.js';

const STALE_MS = 2 * 60_000;
export const isStale = (metric) => !metric || Date.now() - Date.parse(metric.last_seen_at) > STALE_MS;

/**
 * machines: lista do PostgreSQL · sessions: sessões ativas · metrics: últimas amostras do Cassandra
 * (null quando o Cassandra está indisponível — o mapa continua funcionando sem as barras).
 */
export function floorMap({ machines, sessions = [], metrics = null, onSelect }) {
  if (!machines.length) return empty('Nenhuma máquina encontrada com esses filtros.', 'monitor');
  const sessionBy = new Map(sessions.map((s) => [s.machine_id, s]));
  const metricBy = metrics ? new Map(metrics.map((m) => [m.machine_id, m])) : null;
  const counts = {};
  machines.forEach((m) => (counts[m.status] = (counts[m.status] ?? 0) + 1));

  const legend = h(
    'div',
    { class: 'floor-legend' },
    Object.entries(MACHINE_STATUS).map(([k, s]) => h('span', { class: `legend-item tone-${s.tone}` }, h('span', { class: 'dot' }), s.label, h('strong', {}, counts[k] ?? 0))),
  );

  const zones = Object.entries(ZONES).map(([key, z]) => {
    const list = machines.filter((m) => m.zone === key);
    if (!list.length) return null;
    const busy = list.filter((m) => m.status === 'em_uso').length;
    return h(
      'div',
      { class: 'zone' },
      h('div', { class: 'zone-header' }, icon(z.icon, 15), z.label, h('span', { class: 'zone-line' }), h('span', { class: 'zone-count' }, `${busy}/${list.length} em uso`)),
      h('div', { class: 'pc-grid' }, list.map((m) => pcTile(m, sessionBy.get(m.id), metricBy?.get(m.id), metricBy !== null, onSelect))),
    );
  });

  return h('div', { class: 'floor' }, legend, zones);
}

function pcTile(m, session, metric, hasMetrics, onSelect) {
  const st = MACHINE_STATUS[m.status] ?? MACHINE_STATUS.offline;
  let middle;
  if (m.status === 'em_uso') {
    const nick = session?.user_nickname ?? m.last_user?.nickname;
    middle = [
      h('div', { class: 'pc-user' }, icon('user', 13), nick ? `@${nick}` : 'Em uso'),
      session && h('div', { class: 'pc-timer', dataset: { timerSince: session.started_at } }, clock(Date.now() - Date.parse(session.started_at))),
    ];
  } else if (m.status === 'disponivel') {
    middle = h('div', { class: 'pc-user muted' }, 'Livre para uso');
  } else if (m.status === 'manutencao') {
    middle = h('div', { class: 'pc-user muted' }, icon('wrench', 13), 'Em manutenção');
  } else {
    middle = h('div', { class: 'pc-user muted' }, icon('wifiOff', 13), metric ? `Sinal ${relative(metric.last_seen_at)}` : 'Sem sinal');
  }

  let bars;
  if (!hasMetrics) bars = h('div', { class: 'pc-bars pc-bars-empty' }, 'métricas indisponíveis');
  else if (isStale(metric)) bars = h('div', { class: 'pc-bars pc-bars-empty' }, 'sem telemetria');
  else bars = h('div', { class: 'pc-bars' }, miniBar('CPU', metric.cpu_pct), miniBar('RAM', metric.ram_pct));

  return h(
    'button',
    {
      type: 'button',
      class: `pc tone-${st.tone} status-${m.status}`,
      title: `${m.hostname} — ${st.label}`,
      onclick: () => onSelect?.(m),
    },
    h('div', { class: 'pc-head' }, h('span', { class: 'pc-name' }, m.hostname), h('span', { class: 'pc-status' }, h('span', { class: 'dot' }), st.label)),
    middle,
    bars,
  );
}

export function miniBar(label, value) {
  return h(
    'div',
    { class: 'mini-bar' },
    h('span', {}, label),
    h('div', { class: 'mini-track' }, h('div', { class: 'mini-fill', style: `width:${value}%;background:${levelColor(value)}` })),
    h('span', {}, pct(value)),
  );
}
