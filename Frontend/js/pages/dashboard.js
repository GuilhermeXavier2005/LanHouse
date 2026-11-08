import { api } from '../api/index.js';
import { config } from '../config.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { card, pageHeader, widget, kpi, empty, statusBadge, notice } from '../ui/components.js';
import { floorMap, isStale } from '../ui/floor.js';
import { barChart, levelColor } from '../ui/charts.js';
import { eventFeed } from '../ui/events-ui.js';
import { money, duration, relative, pct, num, date } from '../format.js';
import { INCIDENT_SEVERITY } from '../constants.js';

const OPEN_INCIDENTS = { status: 'aberto,em_andamento' };

export default {
  render(root) {
    const kpiEl = h('div', { class: 'kpi-grid' });
    const floorEl = h('div');
    const eventsEl = h('div');
    const incidentsEl = h('div');
    const revenueEl = h('div');
    const topEl = h('div');
    const seeAll = (href) => h('a', { class: 'btn btn-ghost btn-sm', href }, 'Ver tudo');

    root.append(
      pageHeader('Visão geral', 'Estado do salão em tempo real', [
        h('span', { class: 'live-tag' }, h('span', { class: 'dot pulse' }), `Ao vivo · atualiza a cada ${config.pollMs / 1000} s`),
      ]),
      kpiEl,
      h(
        'div',
        { class: 'grid grid-dash' },
        card({ title: 'Mapa do salão', icon: 'monitor', source: ['postgres', 'cassandra'], body: floorEl }),
        h(
          'div',
          { class: 'stack' },
          card({ title: 'Atividade recente', icon: 'list', source: 'mongodb', body: eventsEl, actions: seeAll('#/eventos') }),
          card({ title: 'Incidentes abertos', icon: 'alert', source: 'postgres', body: incidentsEl, actions: seeAll('#/incidentes') }),
        ),
      ),
      h(
        'div',
        { class: 'grid grid-2' },
        card({ title: 'Faturamento · últimos 7 dias', icon: 'cash', source: 'postgres', body: revenueEl }),
        card({ title: 'Maior consumo de CPU agora', icon: 'cpu', source: 'cassandra', body: topEl }),
      ),
    );

    const goTo = (m) => (location.hash = `#/maquinas/${m.id}`);
    const stops = [
      widget(kpiEl, { load: loadKpis, render: renderKpis, interval: config.pollMs }),
      widget(floorEl, { load: loadFloor, render: (d) => renderFloor(d, goTo), interval: config.pollMs }),
      widget(eventsEl, { load: () => api.events.list({ limit: 7 }), render: (r) => eventFeed(r.items), interval: config.pollMs }),
      widget(incidentsEl, { load: () => api.incidents.list(OPEN_INCIDENTS), render: renderIncidents, interval: config.pollMs * 3 }),
      widget(revenueEl, { load: () => api.reports.revenue({ days: 7 }), render: renderRevenue, interval: 60_000 }),
      widget(topEl, { load: () => api.metrics.latest(), render: renderTop, interval: config.pollMs }),
    ];
    return () => stops.forEach((stop) => stop());
  },
};

async function loadKpis() {
  const [machines, summary, incidents] = await Promise.all([api.machines.list(), api.reports.summary(), api.incidents.list(OPEN_INCIDENTS)]);
  return { machines: machines.items, summary, openIncidents: incidents.total };
}

function renderKpis({ machines, summary, openIncidents }) {
  const count = (s) => machines.filter((m) => m.status === s).length;
  const total = machines.length;
  const inUse = count('em_uso');
  return [
    kpi({ label: 'Em uso', icon: 'gamepad', tone: 'primary', value: [String(inUse), h('small', {}, ` / ${total}`)], sub: `${total ? Math.round((inUse / total) * 100) : 0}% de ocupação` }),
    kpi({ label: 'Disponíveis', icon: 'monitor', tone: 'success', value: String(count('disponivel')), sub: 'prontas para uso' }),
    kpi({ label: 'Indisponíveis', icon: 'wrench', tone: 'warning', value: String(count('manutencao') + count('offline')), sub: `${count('manutencao')} em manutenção · ${count('offline')} offline` }),
    kpi({ label: 'Sessões hoje', icon: 'timer', tone: 'accent', value: String(summary.sessions_today), sub: summary.avg_duration_minutes ? `duração média ${duration(summary.avg_duration_minutes)}` : 'nenhuma encerrada ainda' }),
    kpi({ label: 'Faturamento hoje', icon: 'cash', tone: 'success', value: money(summary.revenue_today), sub: summary.pending_amount ? `${money(summary.pending_amount)} a receber` : 'nada pendente' }),
    kpi({ label: 'Incidentes abertos', icon: 'alert', tone: openIncidents ? 'danger' : 'success', value: String(openIncidents), sub: openIncidents ? 'precisam de atenção' : 'tudo em ordem' }),
  ];
}

/** O mapa depende do PostgreSQL; sessões e métricas são complementos opcionais. */
async function loadFloor() {
  const [machines, sessions, metrics] = await Promise.allSettled([api.machines.list(), api.sessions.list({ status: 'ativa' }), api.metrics.latest()]);
  if (machines.status === 'rejected') throw machines.reason;
  return {
    machines: machines.value.items,
    sessions: sessions.status === 'fulfilled' ? sessions.value.items : [],
    metrics: metrics.status === 'fulfilled' ? metrics.value.items : null,
    metricsError: metrics.status === 'rejected' ? metrics.reason : null,
  };
}

function renderFloor(d, onSelect) {
  return [
    d.metricsError && notice(`Telemetria em tempo real indisponível: ${d.metricsError.message}`, 'warning', 'database'),
    floorMap({ machines: d.machines, sessions: d.sessions, metrics: d.metrics, onSelect }),
  ];
}

function renderIncidents({ items }) {
  if (!items.length) return empty('Nenhum incidente em aberto.', 'check');
  const rank = (i) => INCIDENT_SEVERITY[i.severity]?.rank ?? 0;
  const sorted = [...items].sort((a, b) => rank(b) - rank(a) || b.opened_at.localeCompare(a.opened_at));
  return h(
    'ul',
    { class: 'mini-list' },
    sorted.slice(0, 5).map((i) =>
      h(
        'li',
        {},
        h(
          'a',
          { class: 'mini-row', href: `#/maquinas/${i.machine_id}` },
          h('div', { class: 'mini-main' }, h('div', { class: 'cell-main' }, i.title), h('div', { class: 'cell-sub' }, h('span', { class: 'mono' }, i.machine_hostname), ' · ', h('span', { dataset: { relative: i.opened_at } }, relative(i.opened_at)))),
          statusBadge(INCIDENT_SEVERITY, i.severity),
        ),
      ),
    ),
  );
}

function renderRevenue({ items }) {
  const total = items.reduce((a, i) => a + i.total, 0);
  const sessions = items.reduce((a, i) => a + i.sessions, 0);
  const today = items.at(-1)?.date;
  const weekday = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return [
    h(
      'div',
      { class: 'rev-summary' },
      h('div', {}, h('div', { class: 'kpi-label' }, 'Total no período'), h('div', { class: 'rev-total' }, money(total))),
      h('div', {}, h('div', { class: 'kpi-label' }, 'Sessões pagas'), h('div', { class: 'rev-total' }, num(sessions))),
      h('div', {}, h('div', { class: 'kpi-label' }, 'Ticket médio'), h('div', { class: 'rev-total' }, money(sessions ? total / sessions : 0))),
    ),
    barChart({
      items: items.map((i) => ({ label: i.date === today ? 'hoje' : weekday(i.date), value: i.total, highlight: i.date === today, title: `${date(i.date)} — ${money(i.total)} em ${i.sessions} sessões` })),
      format: (v) => `R$ ${Math.round(v)}`,
    }),
  ];
}

function renderTop({ items }) {
  const online = items.filter((i) => !isStale(i)).sort((a, b) => b.cpu_pct - a.cpu_pct).slice(0, 6);
  if (!online.length) return empty('Nenhuma máquina enviando métricas.', 'wifiOff');
  return h(
    'div',
    { class: 'top-list' },
    online.map((i) =>
      h(
        'a',
        { class: 'top-row', href: `#/maquinas/${i.machine_id}` },
        h('span', { class: 'mono top-host' }, i.hostname),
        h('div', { class: 'mini-track lg' }, h('div', { class: 'mini-fill', style: `width:${i.cpu_pct}%;background:${levelColor(i.cpu_pct)}` })),
        h('span', { class: 'top-val mono' }, pct(i.cpu_pct)),
        h('span', { class: 'top-meta', title: 'Temperatura' }, icon('thermo', 13), `${num(i.temp_c)} °C`),
        h('span', { class: 'top-meta', title: 'Latência' }, icon('wifi', 13), `${num(i.latency_ms)} ms`),
      ),
    ),
  );
}
