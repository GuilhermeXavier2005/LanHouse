// Ações e colunas de sessões reutilizadas em várias telas.

import { api } from '../api/index.js';
import { h } from './dom.js';
import { button, kv, cellStack, statusBadge, notice } from './components.js';
import { formModal } from './modal.js';
import { toast, toastError } from './toast.js';
import { sessionAmount, planPriceLabel } from '../pricing.js';
import { ZONES, PAYMENT_METHODS, PAYMENT_STATUS, SESSION_STATUS, toOptions } from '../constants.js';
import { money, duration, dateTime, time, clock } from '../format.js';

/** Valor estimado de uma sessão ativa (o valor oficial é calculado pela API ao encerrar). */
export function estimate(session) {
  const minutes = (Date.now() - Date.parse(session.started_at)) / 60000;
  return sessionAmount({ billing: session.plan_billing, price: session.plan_price, hours: session.plan_hours }, minutes);
}

export async function startSessionModal({ machineId } = {}) {
  let machines;
  let users;
  let plans;
  try {
    [machines, users, plans] = await Promise.all([api.machines.list({ status: 'disponivel' }), api.users.list(), api.plans.list({ kind: 'plano', active: 'true' })]);
  } catch (err) {
    toastError(err);
    return null;
  }
  if (!machines.items.length) {
    toast('Nenhuma máquina disponível no momento.', 'warning');
    return null;
  }
  const result = await formModal({
    title: 'Iniciar sessão',
    intro: notice('A sessão é registrada no PostgreSQL e o início gera um evento no MongoDB.', 'info', 'database'),
    fields: [
      { name: 'machine_id', label: 'Máquina', type: 'select', required: true, valueType: 'number', options: machines.items.map((m) => ({ value: m.id, label: `${m.hostname} — ${ZONES[m.zone]?.label ?? m.zone}` })) },
      { name: 'user_id', label: 'Usuário', type: 'select', required: true, valueType: 'number', options: users.items.map((u) => ({ value: u.id, label: `${u.name} (@${u.nickname})${u.in_session ? ' · em sessão' : ''}` })), help: 'Cliente novo? Cadastre em Usuários.' },
      { name: 'plan_id', label: 'Plano', type: 'select', required: true, valueType: 'number', span: 2, options: plans.items.map((p) => ({ value: p.id, label: `${p.name} — ${planPriceLabel(p)}` })) },
    ],
    values: { machine_id: machineId },
    submitLabel: 'Iniciar sessão',
    onSubmit: (v) => api.sessions.start(v),
  });
  if (result) toast(`${result.machine_hostname} liberada para @${result.user_nickname}.`, 'success', { title: 'Sessão iniciada' });
  return result;
}

export async function endSessionModal(session) {
  const minutes = (Date.now() - Date.parse(session.started_at)) / 60000;
  const result = await formModal({
    title: `Encerrar sessão — ${session.machine_hostname}`,
    intro: kv([
      ['Usuário', `${session.user_name} (@${session.user_nickname})`],
      ['Plano', session.plan_name],
      ['Início', dateTime(session.started_at)],
      ['Duração', duration(minutes)],
      ['Valor estimado', h('strong', { class: 'text-primary' }, money(estimate(session)))],
    ]),
    fields: [
      { name: 'payment_method', label: 'Forma de pagamento', type: 'select', required: true, options: toOptions(PAYMENT_METHODS) },
      { name: 'payment_status', label: 'Situação', type: 'select', required: true, options: [{ value: 'pago', label: 'Pago agora' }, { value: 'pendente', label: 'Pagar depois (pendente)' }] },
    ],
    values: { payment_method: 'pix', payment_status: 'pago' },
    submitLabel: 'Encerrar e registrar',
    onSubmit: (v) => api.sessions.end(session.id, v),
  });
  if (result) toast(`${duration(result.duration_minutes)} · ${money(result.amount)} (${PAYMENT_STATUS[result.payment_status].label.toLowerCase()})`, 'success', { title: `${result.machine_hostname} liberada` });
  return result;
}

export async function markPaidModal(session) {
  const result = await formModal({
    title: `Registrar pagamento — sessão #${session.id}`,
    size: 'sm',
    intro: kv([['Usuário', `@${session.user_nickname}`], ['Valor', h('strong', { class: 'text-primary' }, money(session.amount))]]),
    fields: [{ name: 'payment_method', label: 'Forma de pagamento', type: 'select', required: true, span: 2, options: toOptions(PAYMENT_METHODS) }],
    values: { payment_method: session.payment_method ?? 'pix' },
    submitLabel: 'Confirmar pagamento',
    onSubmit: (v) => api.sessions.patch(session.id, { ...v, payment_status: 'pago' }),
  });
  if (result) toast(`Sessão #${session.id} marcada como paga.`, 'success');
  return result;
}

export function sessionColumns({ showMachine = true, onPay } = {}) {
  return [
    { label: '#', render: (s) => h('span', { class: 'mono muted' }, `#${s.id}`) },
    showMachine && { label: 'Máquina', render: (s) => h('a', { href: `#/maquinas/${s.machine_id}`, class: 'mono link' }, s.machine_hostname) },
    { label: 'Usuário', render: (s) => cellStack(s.user_name, `@${s.user_nickname}`) },
    { label: 'Plano', key: 'plan_name' },
    { label: 'Início', render: (s) => cellStack(dateTime(s.started_at), s.ended_at ? `até ${time(s.ended_at)}` : 'em andamento') },
    {
      label: 'Duração',
      class: 'num',
      render: (s) => (s.status === 'ativa' ? h('span', { class: 'mono text-primary', dataset: { timerSince: s.started_at } }, clock(Date.now() - Date.parse(s.started_at))) : duration(s.duration_minutes)),
    },
    { label: 'Valor', class: 'num', render: (s) => (s.status === 'ativa' ? h('span', { class: 'muted', title: 'Estimado' }, `~ ${money(estimate(s))}`) : money(s.amount)) },
    {
      label: 'Pagamento',
      render: (s) =>
        s.status === 'ativa'
          ? statusBadge(SESSION_STATUS, 'ativa')
          : h('div', { class: 'pay-cell' }, statusBadge(PAYMENT_STATUS, s.payment_status), s.payment_method && h('span', { class: 'cell-sub' }, PAYMENT_METHODS[s.payment_method])),
    },
    onPay && {
      label: '',
      class: 'actions',
      render: (s) => (s.status === 'encerrada' && s.payment_status === 'pendente' ? button('Receber', { size: 'sm', icon: 'cash', onClick: () => onPay(s) }) : null),
    },
  ].filter(Boolean);
}
