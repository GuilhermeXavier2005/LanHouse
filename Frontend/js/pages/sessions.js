import { api } from '../api/index.js';
import { config } from '../config.js';
import { h, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { card, pageHeader, widget, button, badge, empty, table, segmented, select, searchBox, avatar } from '../ui/components.js';
import { startSessionModal, endSessionModal, markPaidModal, estimate, sessionColumns } from '../ui/session-ui.js';
import { ZONES, PAYMENT_STATUS, SESSION_STATUS, toOptions } from '../constants.js';
import { money, clock, time } from '../format.js';

const PAGE = 25;
const PERIODS = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'all', label: 'Tudo' },
];

function periodStart(p) {
  if (p === 'all') return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === '7d') d.setDate(d.getDate() - 6);
  if (p === '30d') d.setDate(d.getDate() - 29);
  return d.toISOString();
}

export default {
  render(root) {
    const filters = { period: '7d', status: '', payment_status: '', q: '' };
    let limit = PAGE;
    const activeEl = h('div');
    const histEl = h('div');

    const refreshAll = () => {
      activeCtl.refresh();
      histCtl.refresh();
    };
    const onEnd = async (s) => (await endSessionModal(s)) && refreshAll();
    const onPay = async (s) => (await markPaidModal(s)) && histCtl.refresh();
    const reloadHistory = () => {
      limit = PAGE;
      histCtl.reload();
    };

    root.append(
      pageHeader('Sessões', 'Controle de uso das máquinas, tempo e pagamentos', [
        button('Nova sessão', { icon: 'play', variant: 'primary', onClick: async () => (await startSessionModal()) && refreshAll() }),
      ]),
      card({ title: 'Sessões ativas', icon: 'timer', source: 'postgres', body: activeEl }),
      h('div', { class: 'spacer' }),
      card({
        title: 'Histórico de sessões',
        icon: 'list',
        source: 'postgres',
        flush: true,
        body: [
          h(
            'div',
            { class: 'toolbar', style: 'padding:14px 16px 0' },
            searchBox('Buscar por usuário, apelido ou máquina', debounce((v) => { filters.q = v; reloadHistory(); }, 250)),
            segmented(PERIODS, filters.period, (v) => { filters.period = v; reloadHistory(); }),
            select([{ value: '', label: 'Todas' }, ...toOptions(SESSION_STATUS)], '', (v) => { filters.status = v; reloadHistory(); }, { label: 'Status da sessão' }),
            select([{ value: '', label: 'Qualquer pagamento' }, ...toOptions(PAYMENT_STATUS)], '', (v) => { filters.payment_status = v; reloadHistory(); }, { label: 'Pagamento' }),
          ),
          histEl,
        ],
      }),
    );

    const activeCtl = widget(activeEl, {
      load: () => api.sessions.list({ status: 'ativa' }),
      render: ({ items }) =>
        items.length
          ? h('div', { class: 'session-grid' }, items.sort((a, b) => a.machine_hostname.localeCompare(b.machine_hostname)).map((s) => sessionCard(s, onEnd)))
          : empty('Nenhuma sessão ativa no momento. Use "Nova sessão" para liberar uma máquina.', 'timer'),
      interval: config.pollMs,
    });

    const histCtl = widget(histEl, {
      load: () => api.sessions.list({ q: filters.q, status: filters.status, payment_status: filters.payment_status, from: periodStart(filters.period), limit }),
      render: (r) => [
        table({ rows: r.items, columns: sessionColumns({ onPay }), emptyText: 'Nenhuma sessão encontrada para esses filtros.' }),
        h(
          'div',
          { class: 'table-footer' },
          h('span', {}, `Mostrando ${r.items.length} de ${r.total} sessões`),
          h('span', {}, 'Recebido: ', h('strong', {}, money(r.total_paid)), r.total_pending ? [' · A receber: ', h('strong', {}, money(r.total_pending))] : null),
          r.items.length < r.total &&
            button('Carregar mais', {
              size: 'sm',
              onClick: () => {
                limit += PAGE;
                histCtl.refresh();
              },
            }),
        ),
      ],
    });

    return () => {
      activeCtl();
      histCtl();
    };
  },
};

function sessionCard(s, onEnd) {
  return h(
    'div',
    { class: 'session-card' },
    h(
      'div',
      { class: 'session-head' },
      h('a', { href: `#/maquinas/${s.machine_id}`, class: 'session-host' }, icon('monitor', 15), s.machine_hostname),
      badge(ZONES[s.machine_zone]?.label ?? '—', s.machine_zone === 'vip' ? 'accent' : 'muted'),
    ),
    h('div', { class: 'session-user' }, avatar(s.user_name), h('div', {}, h('div', { class: 'cell-main' }, s.user_name), h('div', { class: 'cell-sub' }, `@${s.user_nickname}`))),
    h('div', { class: 'session-timer', dataset: { timerSince: s.started_at } }, clock(Date.now() - Date.parse(s.started_at))),
    h('div', { class: 'session-meta' }, h('span', {}, s.plan_name), h('span', {}, `desde ${time(s.started_at)}`)),
    h(
      'div',
      { class: 'session-foot' },
      h('div', {}, h('div', { class: 'cell-sub' }, 'Valor estimado'), h('div', { class: 'session-amount' }, money(estimate(s)))),
      button('Encerrar', { icon: 'stop', variant: 'danger', size: 'sm', onClick: () => onEnd(s) }),
    ),
  );
}
