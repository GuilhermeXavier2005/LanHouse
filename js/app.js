import { createRouter } from './router.js';
import { config } from './config.js';
import { api } from './api/index.js';
import { onWarnings } from './api/client.js';
import { h } from './ui/dom.js';
import { icon, LOGO_SVG } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { DB_SOURCES } from './constants.js';
import { clock, relative } from './format.js';

import dashboard from './pages/dashboard.js';
import machines from './pages/machines.js';
import machineDetail from './pages/machine-detail.js';
import sessions from './pages/sessions.js';
import metrics from './pages/metrics.js';
import events from './pages/events.js';
import system from './pages/system.js';
import { usersPage, plansPage, programsPage, incidentsPage, maintenancesPage } from './pages/resources.js';

const NAV = [
  { group: 'Operação', items: [
    { path: '/dashboard', label: 'Visão geral', icon: 'dashboard', page: dashboard },
    { path: '/maquinas', label: 'Máquinas', icon: 'monitor', page: machines },
    { path: '/sessoes', label: 'Sessões', icon: 'timer', page: sessions },
  ] },
  { group: 'Técnico', items: [
    { path: '/metricas', label: 'Métricas', icon: 'activity', page: metrics },
    { path: '/eventos', label: 'Eventos', icon: 'list', page: events },
    { path: '/incidentes', label: 'Incidentes', icon: 'alert', page: incidentsPage },
    { path: '/manutencoes', label: 'Manutenções', icon: 'wrench', page: maintenancesPage },
  ] },
  { group: 'Cadastros', items: [
    { path: '/usuarios', label: 'Usuários', icon: 'users', page: usersPage },
    { path: '/planos', label: 'Planos & serviços', icon: 'tag', page: plansPage },
    { path: '/programas', label: 'Programas', icon: 'package', page: programsPage },
  ] },
  { group: 'Sistema', items: [
    { path: '/sistema', label: 'Bancos & API', icon: 'database', page: system },
  ] },
];

const ROUTES = [
  ...NAV.flatMap((g) => g.items.map((i) => ({ path: i.path, page: i.page, nav: i, group: g.group }))),
  { path: '/maquinas/:id', page: machineDetail, nav: NAV[0].items[1], group: 'Operação' },
];

const app = document.getElementById('app');
const view = document.getElementById('view');
const sidebar = document.getElementById('sidebar');
const topbar = document.getElementById('topbar');
const navLinks = new Map();

// ------------------------------------------------------------------ sidebar
sidebar.append(
  h('a', { class: 'brand', href: '#/dashboard' },
    h('span', { class: 'brand-logo', html: LOGO_SVG }),
    h('span', {}, h('div', { class: 'brand-name', html: 'LanHouse <span>Monitor</span>' }), h('div', { class: 'brand-sub' }, 'Painel de controle'))),
  ...NAV.map((g) =>
    h('nav', { class: 'nav-group', 'aria-label': g.group },
      h('div', { class: 'nav-group-title' }, g.group),
      g.items.map((i) => {
        const a = h('a', { class: 'nav-link', href: `#${i.path}` }, icon(i.icon, 17), i.label);
        navLinks.set(i.path, a);
        return a;
      }))),
  h('div', { class: 'sidebar-footer' },
    h('div', {}, 'Projeto acadêmico · ', h('strong', {}, 'Tunning de Dados')),
    h('div', {}, 'PostgreSQL · MongoDB · Cassandra')),
);

// ------------------------------------------------------------------ topbar
const crumbs = h('div', { class: 'crumbs' });
const healthEl = h('a', { class: 'health-pill', href: '#/sistema', title: 'Saúde dos bancos de dados' });
const clockEl = h('span', { class: 'clock' });
const modePill = h(
  'a',
  { class: `mode-pill tone-${config.useMock ? 'accent' : 'success'}`, href: '#/sistema', title: config.useMock ? 'Usando API simulada no navegador' : `API: ${config.apiBaseUrl}` },
  icon(config.useMock ? 'zap' : 'server', 13),
  h('span', { class: 'mode-text' }, config.useMock ? 'Modo demonstração' : 'API real'),
);
topbar.append(
  h('button', { class: 'btn btn-ghost btn-icon menu-btn', type: 'button', 'aria-label': 'Abrir menu', onclick: () => app.classList.toggle('nav-open') }, icon('menu', 18)),
  crumbs,
  h('div', { class: 'topbar-right' }, healthEl, modePill, clockEl),
);
document.getElementById('scrim').addEventListener('click', () => app.classList.remove('nav-open'));

let healthTimer = null;
async function pollHealth() {
  clearTimeout(healthTimer);
  try {
    renderHealth(await api.health());
  } catch {
    healthEl.replaceChildren(h('span', { class: 'health-item tone-danger' }, h('span', { class: 'dot pulse' }), 'API offline'));
  }
  healthTimer = setTimeout(pollHealth, 10_000);
}
function renderHealth(res) {
  healthEl.replaceChildren(
    ...Object.entries(res.services).map(([key, s]) =>
      h('span', { class: `health-item tone-${s.status === 'up' ? 'success' : 'danger'}`, title: `${DB_SOURCES[key].label}: ${s.status === 'up' ? `operacional (${s.latency_ms} ms)` : 'indisponível'}` },
        h('span', { class: `dot${s.status === 'up' ? '' : ' pulse'}` }),
        h('span', { class: 'health-label' }, DB_SOURCES[key].short))),
  );
}
window.addEventListener('lanhouse:health', pollHealth);
pollHealth();

// Avisos de sucesso parcial (ex.: MongoDB fora durante uma escrita).
onWarnings((warnings) => warnings.forEach((w) => toast(w, 'warning', { title: 'Operação concluída com ressalvas', timeout: 7000 })));

// Relógio, cronômetros de sessão e tempos relativos ("há 3 min") atualizados a cada segundo.
function tick() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString('pt-BR');
  document.querySelectorAll('[data-timer-since]').forEach((el) => (el.textContent = clock(now - Date.parse(el.dataset.timerSince))));
  document.querySelectorAll('[data-relative]').forEach((el) => (el.textContent = relative(el.dataset.relative)));
}
setInterval(tick, 1000);
tick();

// ------------------------------------------------------------------ rotas
let cleanup = null;
createRouter(ROUTES, {
  fallback: '/dashboard',
  onChange(route, params) {
    cleanup?.();
    cleanup = null;
    navLinks.forEach((a, path) => a.classList.toggle('active', path === route.nav.path));
    crumbs.replaceChildren(h('span', {}, route.group), icon('chevronRight', 13), h('strong', {}, route.nav.label));
    document.title = `${route.nav.label} · LanHouse Monitor`;
    app.classList.remove('nav-open');
    view.replaceChildren();
    window.scrollTo(0, 0);
    const result = route.page.render(view, params);
    cleanup = typeof result === 'function' ? result : null;
  },
});
