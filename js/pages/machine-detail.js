import { api } from '../api/index.js';
import { config } from '../config.js';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { card, widget, button, iconButton, tabs, table, kv, badge, statusBadge, notice, empty, stat, cellStack } from '../ui/components.js';
import { formModal, openModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { gauge } from '../ui/charts.js';
import { isStale } from '../ui/floor.js';
import { metricsPanel } from '../ui/metrics-panel.js';
import { eventFeed } from '../ui/events-ui.js';
import { startSessionModal, endSessionModal, estimate, sessionColumns, markPaidModal } from '../ui/session-ui.js';
import { openMachineForm, deleteMachine } from './machines.js';
import { openIncidentForm, openMaintenanceForm } from './resources.js';
import { MACHINE_STATUS, ZONES, PROGRAM_CATEGORY, INCIDENT_SEVERITY, INCIDENT_STATUS, MAINTENANCE_TYPE, MAINTENANCE_STATUS, toOptions } from '../constants.js';
import { money, dateTime, date, relative, clock, kbps, num, storage, time } from '../format.js';

const TABS = [
  { value: 'overview', label: 'Visão geral', icon: 'dashboard' },
  { value: 'metrics', label: 'Métricas', icon: 'activity' },
  { value: 'sessions', label: 'Sessões', icon: 'timer' },
  { value: 'programs', label: 'Programas', icon: 'package' },
  { value: 'maintenance', label: 'Incidentes & manutenção', icon: 'wrench' },
  { value: 'events', label: 'Eventos', icon: 'list' },
];

export default {
  render(root, { id }) {
    const machineId = Number(id);
    let tab = 'overview';
    let stopTab = null;
    const hero = h('div');
    const content = h('div');

    const refreshAll = () => {
      heroCtl.refresh();
      showTab();
    };
    const actions = (m) => {
      const out = [];
      if (m.status === 'disponivel') {
        out.push(button('Iniciar sessão', { icon: 'play', variant: 'primary', onClick: async () => (await startSessionModal({ machineId })) && refreshAll() }));
      }
      if (m.active_session_id) {
        out.push(
          button('Encerrar sessão', {
            icon: 'stop',
            variant: 'danger',
            onClick: async () => {
              try {
                const s = await api.sessions.get(m.active_session_id);
                if (await endSessionModal(s)) refreshAll();
              } catch (err) {
                toastError(err);
              }
            },
          }),
        );
      }
      out.push(
        button('Alterar estado', { icon: 'power', disabled: m.status === 'em_uso', title: m.status === 'em_uso' ? 'Encerre a sessão antes' : null, onClick: async () => (await statusModal(m)) && refreshAll() }),
        iconButton('edit', 'Editar cadastro', async () => (await openMachineForm(m)) && refreshAll()),
        iconButton('trash', 'Excluir máquina', async () => {
          if (await deleteMachine(m)) location.hash = '#/maquinas';
        }, { danger: true }),
      );
      return out;
    };

    const heroCtl = widget(hero, { load: () => api.machines.get(machineId), render: (m) => renderHero(m, actions(m)), interval: config.pollMs * 2 });

    function showTab() {
      stopTab?.();
      content.replaceChildren();
      stopTab = TAB_RENDER[tab](content, machineId, refreshAll);
    }

    root.append(
      h('a', { href: '#/maquinas', class: 'back-link' }, icon('arrowLeft', 15), 'Voltar para máquinas'),
      hero,
      tabs(TABS, tab, (v) => {
        tab = v;
        showTab();
      }),
      content,
    );
    showTab();

    return () => {
      heroCtl();
      stopTab?.();
    };
  },
};

function renderHero(m, actions) {
  const st = MACHINE_STATUS[m.status] ?? MACHINE_STATUS.offline;
  const zone = ZONES[m.zone];
  return h(
    'div',
    { class: `detail-hero tone-${st.tone}` },
    h('div', { class: 'hero-icon' }, icon(zone?.icon ?? 'monitor', 28)),
    h(
      'div',
      { class: 'hero-info' },
      h('div', { class: 'hero-title-row' }, h('h1', { class: 'hero-title' }, m.hostname), statusBadge(MACHINE_STATUS, m.status)),
      h('div', { class: 'hero-meta' }, zone?.label, ' · ', m.cpu, ' · ', `${m.ram_gb} GB RAM`, m.ip && [' · ', h('span', { class: 'mono' }, m.ip)]),
    ),
    h('div', { class: 'hero-actions' }, actions),
  );
}

async function statusModal(m) {
  const result = await formModal({
    title: `Alterar estado — ${m.hostname}`,
    size: 'sm',
    intro: notice('O estado atual fica no PostgreSQL; a mudança também é registrada como evento no MongoDB (histórico de estados).', 'info', 'database'),
    fields: [
      { name: 'status', label: 'Novo estado', type: 'select', required: true, span: 2, options: toOptions(MACHINE_STATUS).filter((o) => o.value !== 'em_uso') },
      { name: 'reason', label: 'Motivo', type: 'textarea', placeholder: 'Ex.: troca de periférico, sem conexão de rede...' },
    ],
    values: { status: m.status === 'disponivel' ? 'manutencao' : 'disponivel' },
    submitLabel: 'Aplicar',
    onSubmit: (v) => api.machines.setStatus(m.id, v.status, v.reason),
  });
  if (result) toast(`${result.hostname} agora está ${MACHINE_STATUS[result.status].label.toLowerCase()}.`, 'success');
  return result;
}

// ------------------------------------------------------------------ abas
const TAB_RENDER = {
  overview(el, id) {
    const live = h('div');
    const usage = h('div');
    const specs = h('div');
    const recent = h('div');
    el.append(
      h(
        'div',
        { class: 'grid grid-dash' },
        card({ title: 'Telemetria em tempo real', icon: 'activity', source: 'cassandra', body: live }),
        card({ title: 'Uso atual', icon: 'user', source: 'postgres', body: usage }),
      ),
      h(
        'div',
        { class: 'grid grid-dash' },
        card({ title: 'Especificações', icon: 'cpu', source: 'postgres', body: specs }),
        card({ title: 'Últimos eventos', icon: 'list', source: 'mongodb', body: recent }),
      ),
    );
    const stops = [
      widget(live, { load: () => api.machines.latestMetrics(id), render: renderLive, interval: config.pollMs }),
      widget(usage, {
        load: async () => {
          const m = await api.machines.get(id);
          return { m, active: m.active_session_id ? await api.sessions.get(m.active_session_id) : null };
        },
        render: renderUsage,
        interval: config.pollMs * 2,
      }),
      widget(specs, { load: () => api.machines.get(id), render: renderSpecs }),
      widget(recent, { load: () => api.machines.events(id, { limit: 6 }), render: (r) => eventFeed(r.items, { showMachine: false }), interval: config.pollMs * 2 }),
    ];
    return () => stops.forEach((s) => s());
  },

  metrics(el, id) {
    const panel = metricsPanel(id);
    el.append(card({ title: 'Histórico de métricas', icon: 'activity', body: panel.el }));
    return panel.stop;
  },

  sessions(el, id) {
    const body = h('div');
    el.append(card({ title: 'Sessões nesta máquina', icon: 'timer', source: 'postgres', body, flush: true }));
    const ctl = widget(body, {
      load: () => api.sessions.list({ machine_id: id, limit: 40 }),
      render: (r) => [
        table({ rows: r.items, columns: sessionColumns({ showMachine: false, onPay: async (s) => (await markPaidModal(s)) && ctl.refresh() }), emptyText: 'Nenhuma sessão registrada nesta máquina.' }),
        r.items.length && h('div', { class: 'table-footer' }, h('span', {}, `Mostrando ${r.items.length} de ${r.total} sessões`), h('span', {}, 'Recebido: ', h('strong', {}, money(r.total_paid)))),
      ],
    });
    return ctl;
  },

  programs(el, id) {
    const body = h('div');
    const manage = button('Gerenciar', { icon: 'edit', size: 'sm', onClick: () => manageProgramsModal(id, () => ctl.refresh()) });
    el.append(card({ title: 'Programas instalados', icon: 'package', source: 'postgres', actions: manage, body }));
    const ctl = widget(body, { load: () => api.machines.programs(id), render: renderPrograms });
    return ctl;
  },

  maintenance(el, id) {
    const incBody = h('div');
    const mtBody = h('div');
    el.append(
      h(
        'div',
        { class: 'grid grid-2' },
        card({
          title: 'Incidentes',
          icon: 'alert',
          source: 'postgres',
          body: incBody,
          flush: true,
          actions: button('Abrir incidente', { icon: 'plus', size: 'sm', onClick: async () => (await openIncidentForm(null, { machine_id: id })) && incCtl.refresh() }),
        }),
        card({
          title: 'Manutenções',
          icon: 'wrench',
          source: 'postgres',
          body: mtBody,
          flush: true,
          actions: button('Registrar', { icon: 'plus', size: 'sm', onClick: async () => (await openMaintenanceForm(null, { machine_id: id })) && mtCtl.refresh() }),
        }),
      ),
    );
    const incCtl = widget(incBody, {
      load: () => api.incidents.list({ machine_id: id }),
      render: (r) =>
        table({
          rows: r.items,
          emptyText: 'Nenhum incidente registrado.',
          columns: [
            { label: 'Incidente', class: 'wrap', render: (i) => cellStack(i.title, `${relative(i.opened_at)} · ${i.reported_by ?? '—'}`) },
            { label: 'Severidade', render: (i) => statusBadge(INCIDENT_SEVERITY, i.severity) },
            { label: 'Status', render: (i) => statusBadge(INCIDENT_STATUS, i.status) },
            { label: '', class: 'actions', render: (i) => iconButton('edit', 'Editar', async () => (await openIncidentForm(i)) && incCtl.refresh()) },
          ],
        }),
    });
    const mtCtl = widget(mtBody, {
      load: () => api.maintenances.list({ machine_id: id }),
      render: (r) =>
        table({
          rows: r.items,
          emptyText: 'Nenhuma manutenção registrada.',
          columns: [
            { label: 'Serviço', class: 'wrap', render: (m) => cellStack(m.description, `${date(m.scheduled_for)} · ${m.technician ?? '—'}`) },
            { label: 'Tipo', render: (m) => statusBadge(MAINTENANCE_TYPE, m.type) },
            { label: 'Custo', class: 'num', render: (m) => money(m.cost) },
            { label: 'Status', render: (m) => statusBadge(MAINTENANCE_STATUS, m.status) },
            { label: '', class: 'actions', render: (m) => iconButton('edit', 'Editar', async () => (await openMaintenanceForm(m)) && mtCtl.refresh()) },
          ],
        }),
    });
    return () => {
      incCtl();
      mtCtl();
    };
  },

  events(el, id) {
    const body = h('div');
    el.append(
      card({
        title: 'Linha do tempo de eventos',
        icon: 'list',
        source: 'mongodb',
        body: [notice('Cada evento é um documento JSON no MongoDB — clique em "JSON" para ver a estrutura completa.', 'info', 'code'), body],
      }),
    );
    return widget(body, { load: () => api.machines.events(id, { limit: 60 }), render: (r) => eventFeed(r.items, { showMachine: false, expandable: true }) });
  },
};

// ------------------------------------------------------------------ renderizadores
function renderLive(x) {
  if (!x) return empty('Esta máquina nunca enviou métricas.', 'wifiOff');
  const stale = isStale(x);
  return [
    stale
      ? notice(['Última comunicação ', h('strong', { dataset: { relative: x.last_seen_at } }, relative(x.last_seen_at)), ' — os valores abaixo são da última coleta recebida.'], 'warning', 'wifiOff')
      : notice(['Coleta recebida ', h('strong', { dataset: { relative: x.last_seen_at } }, relative(x.last_seen_at)), ` · ${time(x.ts)}`], 'success', 'wifi'),
    h(
      'div',
      { class: 'gauges' },
      gauge({ value: x.cpu_pct, label: 'CPU' }),
      gauge({ value: x.gpu_pct, label: 'GPU' }),
      gauge({ value: x.ram_pct, label: 'RAM', sub: `${num(x.ram_used_gb, 1)} / ${x.ram_total_gb} GB` }),
      gauge({ value: x.disk_pct, label: 'Disco', thresholds: [80, 92] }),
      gauge({ value: x.temp_c, label: 'Temp.', unit: '°', thresholds: [70, 85] }),
    ),
    h('div', { class: 'net-strip' }, stat('Download', kbps(x.net_in_kbps)), stat('Upload', kbps(x.net_out_kbps)), stat('Latência', `${num(x.latency_ms)} ms`)),
  ];
}

function renderUsage({ m, active }) {
  if (active) {
    return h(
      'div',
      { class: 'current-session' },
      h('div', {}, h('div', { class: 'kpi-label' }, 'Tempo de sessão'), h('div', { class: 'big-timer', dataset: { timerSince: active.started_at } }, clock(Date.now() - Date.parse(active.started_at)))),
      kv([
        ['Usuário', `${active.user_name} (@${active.user_nickname})`],
        ['Plano', active.plan_name],
        ['Início', dateTime(active.started_at)],
        ['Valor estimado', h('strong', { class: 'text-primary' }, money(estimate(active)))],
      ]),
    );
  }
  const st = MACHINE_STATUS[m.status];
  return [
    h('div', { style: 'margin-bottom:14px' }, badge(m.status === 'disponivel' ? 'Livre para uma nova sessão' : st.label, st.tone, { dot: true })),
    kv([
      ['Último usuário', m.last_user ? `${m.last_user.name} (@${m.last_user.nickname})` : 'Nenhum registro'],
      ['Última sessão', m.last_user ? h('span', { dataset: { relative: m.last_user.at } }, relative(m.last_user.at)) : '—'],
      m.notes && ['Observações', m.notes],
    ]),
  ];
}

function renderSpecs(m) {
  return kv([
    ['Hostname', h('span', { class: 'mono' }, m.hostname)],
    ['Área', ZONES[m.zone]?.label],
    ['Processador', m.cpu],
    ['Placa de vídeo', m.gpu],
    ['Memória RAM', `${m.ram_gb} GB`],
    ['Armazenamento', storage(m.storage_gb)],
    ['Sistema', m.os],
    ['IP / MAC', h('span', { class: 'mono' }, `${m.ip ?? '—'} · ${m.mac ?? '—'}`)],
    ['Cadastrada em', date(m.created_at)],
  ]);
}

function renderPrograms({ items }) {
  if (!items.length) return empty('Nenhum programa associado a esta máquina.', 'package');
  return h(
    'div',
    { class: 'prog-grid' },
    items.map((p) => {
      const c = PROGRAM_CATEGORY[p.category] ?? PROGRAM_CATEGORY.utilitario;
      return h(
        'div',
        { class: `prog tone-${c.tone}` },
        h('div', { class: 'prog-icon' }, icon(c.icon, 17)),
        h('div', { style: 'min-width:0' }, h('div', { class: 'cell-main' }, p.name), h('div', { class: 'cell-sub' }, `${c.label} · v${p.version ?? '?'} · desde ${date(p.installed_at)}`)),
      );
    }),
  );
}

async function manageProgramsModal(machineId, onSaved) {
  let all;
  let installed;
  try {
    [all, installed] = await Promise.all([api.programs.list(), api.machines.programs(machineId)]);
  } catch (err) {
    toastError(err);
    return;
  }
  const checked = new Set(installed.items.map((p) => p.id));
  const groups = Object.entries(PROGRAM_CATEGORY)
    .map(([key, c]) => {
      const list = all.items.filter((p) => p.category === key);
      if (!list.length) return null;
      return h(
        'div',
        { style: 'margin-bottom:14px' },
        h('div', { class: 'section-title', style: 'margin-bottom:4px' }, c.label),
        h('div', { class: 'prog-list-check' }, list.map((p) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: String(p.id), checked: checked.has(p.id) }), p.name))),
      );
    });
  const content = h('div', {}, groups);
  const save = button('Salvar', {
    variant: 'primary',
    onClick: async () => {
      const ids = [...content.querySelectorAll('input:checked')].map((i) => Number(i.value));
      save.classList.add('loading');
      try {
        await api.machines.setPrograms(machineId, ids);
        toast(`${ids.length} programas associados.`, 'success');
        modal.close();
        onSaved();
      } catch (err) {
        toastError(err);
      } finally {
        save.classList.remove('loading');
      }
    },
  });
  const modal = openModal({ title: 'Programas instalados', size: 'lg', content, footer: [button('Cancelar', { variant: 'ghost', onClick: () => modal.close() }), save] });
}
