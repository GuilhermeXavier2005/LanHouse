// Telas de cadastro (CRUD) montadas a partir de uma configuração comum.

import { api } from '../api/index.js';
import { h, append, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { card, pageHeader, widget, button, iconButton, select, searchBox, table, cellStack, statusBadge, badge, notice, empty, avatar, chip } from '../ui/components.js';
import { formModal, confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { priceSuffix } from '../pricing.js';
import {
  INCIDENT_SEVERITY, INCIDENT_STATUS, MAINTENANCE_TYPE, MAINTENANCE_STATUS, PLAN_KIND, PLAN_BILLING,
  PROGRAM_CATEGORY, PROGRAM_LICENSE, toOptions,
} from '../constants.js';
import { money, date, relative, num } from '../format.js';

/**
 * cfg: {
 *   title, subtitle, icon, newLabel, api, labelOf(item),
 *   fields(item) → campos do formulário, defaults() → valores iniciais,
 *   columns(ctx) | renderItems(items, ctx), rowActions?(item, ctx),
 *   filters?: [{ name, label, options }], searchPlaceholder, intro?(), summary?(allItems), bare?
 * }
 */
function crudPage(cfg) {
  return {
    render(root) {
      const filters = { q: '' };
      const body = h('div');

      const ctx = {
        edit: async (item) => {
          const result = await cfg.openForm(item);
          if (result) ctl.refresh();
        },
        remove: async (item) => {
          const ok = await confirmDialog({
            title: `Excluir ${cfg.entity}?`,
            message: `"${cfg.labelOf(item)}" será removido(a) permanentemente.`,
            confirmLabel: 'Excluir',
            danger: true,
          });
          if (!ok) return;
          try {
            await cfg.api.remove(item.id);
            toast(`${cfg.labelOf(item)} excluído(a).`, 'success');
            ctl.refresh();
          } catch (err) {
            toastError(err);
          }
        },
        update: async (item, patch, message) => {
          try {
            await cfg.api.patch(item.id, patch);
            toast(message, 'success');
            ctl.refresh();
          } catch (err) {
            toastError(err);
          }
        },
        refresh: () => ctl.refresh(),
      };

      const toolbar = h(
        'div',
        { class: 'toolbar' },
        searchBox(cfg.searchPlaceholder ?? 'Buscar...', debounce((v) => { filters.q = v; ctl.reload(); }, 250)),
        (cfg.filters ?? []).map((f) => select([{ value: '', label: f.label }, ...f.options], '', (v) => { filters[f.name] = v; ctl.reload(); }, { label: f.label })),
      );

      const listBody = cfg.bare ? body : card({ title: cfg.listTitle ?? cfg.title, icon: cfg.icon, source: 'postgres', body, flush: !cfg.renderItems });
      append(root, [
        pageHeader(cfg.title, cfg.subtitle, [button(cfg.newLabel, { icon: 'plus', variant: 'primary', onClick: () => ctx.edit(null) })]),
        cfg.intro?.(),
        toolbar,
        listBody,
      ]);

      const ctl = widget(body, {
        load: async () => {
          const [list, all] = await Promise.all([cfg.api.list(filters), cfg.summary ? cfg.api.list() : null]);
          return { items: list.items, all: all?.items };
        },
        render: ({ items, all }) => {
          const parts = [];
          if (cfg.summary) parts.push(cfg.summary(all));
          if (cfg.renderItems) {
            parts.push(cfg.renderItems(items, ctx));
          } else {
            const columns = [
              ...cfg.columns(ctx),
              {
                label: '',
                class: 'actions',
                render: (item) => [
                  cfg.rowActions?.(item, ctx),
                  iconButton('edit', 'Editar', () => ctx.edit(item)),
                  iconButton('trash', 'Excluir', () => ctx.remove(item), { danger: true }),
                ],
              },
            ];
            parts.push(table({ rows: items, columns, emptyText: `Nenhum registro encontrado.` }));
          }
          return parts;
        },
      });
      return ctl;
    },
  };
}

const machineOptions = async () => (await api.machines.list()).items.map((m) => ({ value: m.id, label: m.hostname }));
const machineLink = (row) => h('a', { href: `#/maquinas/${row.machine_id}`, class: 'mono link' }, row.machine_hostname);

// ------------------------------------------------------------------ usuários
async function openUserForm(user) {
  const result = await formModal({
    title: user ? `Editar ${user.name}` : 'Novo usuário',
    fields: [
      { name: 'name', label: 'Nome', required: true, span: 2 },
      { name: 'nickname', label: 'Apelido (nick)', required: true, help: 'Aparece no mapa do salão.' },
      { name: 'phone', label: 'Telefone (opcional)', type: 'tel', placeholder: '(11) 90000-0000' },
    ],
    values: user ?? {},
    onSubmit: (v) => (user ? api.users.update(user.id, v) : api.users.create(v)),
  });
  if (result) toast(user ? 'Usuário atualizado.' : `@${result.nickname} cadastrado(a).`, 'success');
  return result;
}

export const usersPage = crudPage({
  title: 'Usuários',
  subtitle: 'Cadastro básico para identificar quem usou cada máquina',
  icon: 'users',
  entity: 'usuário',
  newLabel: 'Novo usuário',
  api: api.users,
  openForm: openUserForm,
  labelOf: (u) => u.name,
  searchPlaceholder: 'Buscar por nome, apelido ou telefone',
  intro: () => notice('Por decisão de projeto, guardamos apenas o necessário para identificar o usuário nas sessões: nome, apelido e um contato opcional.', 'info', 'info'),
  columns: () => [
    { label: 'Usuário', render: (u) => h('div', { class: 'user-cell' }, avatar(u.name), cellStack(u.name, `@${u.nickname}`)) },
    { label: 'Telefone', render: (u) => u.phone || h('span', { class: 'muted' }, '—') },
    { label: 'Sessões', class: 'num', render: (u) => num(u.sessions_count) },
    { label: 'Último acesso', render: (u) => (u.in_session ? badge('Em sessão', 'primary', { dot: true }) : u.last_session_at ? relative(u.last_session_at) : h('span', { class: 'muted' }, 'nunca')) },
    { label: 'Cadastro', render: (u) => date(u.created_at) },
  ],
});

// ------------------------------------------------------------------ planos e serviços
async function openPlanForm(plan) {
  const result = await formModal({
    title: plan ? `Editar ${plan.name}` : 'Novo plano ou serviço',
    fields: [
      { name: 'name', label: 'Nome', required: true, span: 2 },
      { name: 'kind', label: 'Tipo', type: 'select', required: true, options: toOptions(PLAN_KIND) },
      { name: 'billing', label: 'Cobrança', type: 'select', required: true, options: toOptions(PLAN_BILLING) },
      { name: 'price', label: 'Preço (R$)', type: 'number', required: true, min: 0, step: 0.01 },
      { name: 'hours', label: 'Horas incluídas', type: 'number', min: 1, step: 1, help: 'Somente para pacotes.' },
      { name: 'description', label: 'Descrição', type: 'textarea' },
      { name: 'active', label: 'Disponível para venda', type: 'checkbox' },
    ],
    values: plan ?? { kind: 'plano', billing: 'hora', active: true },
    onSubmit: (v) => (plan ? api.plans.update(plan.id, v) : api.plans.create(v)),
  });
  if (result) toast(plan ? 'Plano atualizado.' : `${result.name} criado.`, 'success');
  return result;
}

function planCard(p, ctx) {
  return h(
    'div',
    { class: `plan-card${p.active ? '' : ' inactive'}` },
    h('div', { class: 'plan-top' }, badge(PLAN_BILLING[p.billing], p.kind === 'plano' ? 'primary' : 'accent'), !p.active && badge('Inativo', 'muted')),
    h('h4', { class: 'plan-name' }, p.name),
    h('div', { class: 'plan-price' }, money(p.price), h('small', {}, priceSuffix(p))),
    h('p', { class: 'plan-desc' }, p.description || '—'),
    h('div', { class: 'plan-actions' }, button('Editar', { icon: 'edit', size: 'sm', onClick: () => ctx.edit(p) }), iconButton('trash', 'Excluir', () => ctx.remove(p), { danger: true })),
  );
}

export const plansPage = crudPage({
  title: 'Planos & serviços',
  subtitle: 'Tabela de preços usada para calcular o valor das sessões',
  icon: 'tag',
  entity: 'plano',
  newLabel: 'Novo plano',
  api: api.plans,
  openForm: openPlanForm,
  labelOf: (p) => p.name,
  searchPlaceholder: 'Buscar plano ou serviço',
  filters: [{ name: 'kind', label: 'Todos os tipos', options: toOptions(PLAN_KIND) }],
  bare: true,
  intro: () => notice('Sessões são cobradas em blocos de 15 minutos. Em pacotes, o tempo excedente é cobrado proporcionalmente ao valor/hora do pacote.', 'info', 'cash'),
  renderItems: (items, ctx) => {
    const group = (kind, title) => {
      const list = items.filter((p) => p.kind === kind);
      return list.length ? h('div', { class: 'plan-section' }, h('h3', { class: 'section-title' }, title), h('div', { class: 'plan-grid' }, list.map((p) => planCard(p, ctx)))) : null;
    };
    const out = [group('plano', 'Planos de uso das máquinas'), group('servico', 'Serviços avulsos')].filter(Boolean);
    return out.length ? out : empty('Nenhum plano encontrado.', 'tag');
  },
});

// ------------------------------------------------------------------ programas
async function openProgramForm(program) {
  const result = await formModal({
    title: program ? `Editar ${program.name}` : 'Novo programa',
    fields: [
      { name: 'name', label: 'Nome', required: true, span: 2 },
      { name: 'category', label: 'Categoria', type: 'select', required: true, options: toOptions(PROGRAM_CATEGORY) },
      { name: 'license', label: 'Licença', type: 'select', options: toOptions(PROGRAM_LICENSE) },
      { name: 'publisher', label: 'Desenvolvedora' },
      { name: 'version', label: 'Versão' },
    ],
    values: program ?? { category: 'jogo', license: 'gratuito' },
    onSubmit: (v) => (program ? api.programs.update(program.id, v) : api.programs.create(v)),
  });
  if (result) toast(program ? 'Programa atualizado.' : `${result.name} adicionado ao catálogo.`, 'success');
  return result;
}

export const programsPage = crudPage({
  title: 'Programas',
  subtitle: 'Catálogo de software e em quantas máquinas cada um está instalado',
  icon: 'package',
  entity: 'programa',
  newLabel: 'Novo programa',
  api: api.programs,
  openForm: openProgramForm,
  labelOf: (p) => p.name,
  searchPlaceholder: 'Buscar por nome ou desenvolvedora',
  filters: [
    { name: 'category', label: 'Todas as categorias', options: toOptions(PROGRAM_CATEGORY) },
    { name: 'license', label: 'Qualquer licença', options: toOptions(PROGRAM_LICENSE) },
  ],
  intro: () => notice('Para instalar ou remover programas de uma máquina, abra a máquina e use a aba "Programas".', 'info', 'monitor'),
  columns: () => [
    {
      label: 'Programa',
      render: (p) => {
        const c = PROGRAM_CATEGORY[p.category] ?? PROGRAM_CATEGORY.utilitario;
        return h('div', { class: `user-cell tone-${c.tone}` }, h('div', { class: 'prog-icon' }, icon(c.icon, 16)), cellStack(p.name, p.publisher));
      },
    },
    { label: 'Categoria', render: (p) => statusBadge(PROGRAM_CATEGORY, p.category) },
    { label: 'Versão', render: (p) => h('span', { class: 'mono' }, p.version ?? '—') },
    { label: 'Licença', render: (p) => PROGRAM_LICENSE[p.license] ?? '—' },
    { label: 'Instalado em', class: 'num', render: (p) => `${p.machines_count} máquina${p.machines_count === 1 ? '' : 's'}` },
  ],
});

// ------------------------------------------------------------------ incidentes
export async function openIncidentForm(incident, preset = {}) {
  const result = await formModal({
    title: incident ? `Incidente #${incident.id}` : 'Abrir incidente',
    fields: [
      { name: 'machine_id', label: 'Máquina', type: 'select', required: true, valueType: 'number', options: machineOptions },
      { name: 'severity', label: 'Severidade', type: 'select', required: true, options: toOptions(INCIDENT_SEVERITY) },
      { name: 'title', label: 'Título', required: true, span: 2, placeholder: 'Ex.: mouse com duplo clique' },
      { name: 'description', label: 'Descrição', type: 'textarea' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: toOptions(INCIDENT_STATUS) },
      { name: 'reported_by', label: 'Relatado por', placeholder: 'Cliente, atendente...' },
    ],
    values: incident ?? { severity: 'media', status: 'aberto', ...preset },
    onSubmit: (v) => (incident ? api.incidents.update(incident.id, v) : api.incidents.create(v)),
  });
  if (result) toast(incident ? 'Incidente atualizado.' : `Incidente #${result.id} aberto para ${result.machine_hostname}.`, 'success');
  return result;
}

export const incidentsPage = crudPage({
  title: 'Incidentes',
  subtitle: 'Problemas técnicos relatados e o andamento de cada um',
  icon: 'alert',
  entity: 'incidente',
  newLabel: 'Abrir incidente',
  api: api.incidents,
  openForm: openIncidentForm,
  labelOf: (i) => i.title,
  searchPlaceholder: 'Buscar por título, máquina ou relator',
  filters: [
    { name: 'status', label: 'Todos os status', options: toOptions(INCIDENT_STATUS) },
    { name: 'severity', label: 'Todas as severidades', options: toOptions(INCIDENT_SEVERITY) },
  ],
  summary: (all) => {
    const c = (s) => all.filter((i) => i.status === s).length;
    return h('div', { class: 'chips', style: 'padding:16px 16px 0' }, chip('abertos', c('aberto'), 'danger', 'flag'), chip('em andamento', c('em_andamento'), 'warning', 'wrench'), chip('resolvidos', c('resolvido'), 'success', 'check'));
  },
  columns: () => [
    { label: '#', render: (i) => h('span', { class: 'mono muted' }, `#${i.id}`) },
    { label: 'Incidente', class: 'wrap', render: (i) => cellStack(i.title, h('span', { class: 'clamp' }, i.description || '—')) },
    { label: 'Máquina', render: machineLink },
    { label: 'Severidade', render: (i) => statusBadge(INCIDENT_SEVERITY, i.severity) },
    { label: 'Status', render: (i) => statusBadge(INCIDENT_STATUS, i.status) },
    { label: 'Aberto', render: (i) => cellStack(h('span', { dataset: { relative: i.opened_at } }, relative(i.opened_at)), i.reported_by) },
    { label: 'Resolvido', render: (i) => (i.resolved_at ? date(i.resolved_at) : h('span', { class: 'muted' }, '—')) },
  ],
  rowActions: (i, ctx) => [
    i.status === 'aberto' && button('Atender', { size: 'sm', icon: 'wrench', onClick: () => ctx.update(i, { status: 'em_andamento' }, `Incidente #${i.id} em andamento.`) }),
    i.status !== 'resolvido' && button('Resolver', { size: 'sm', icon: 'check', onClick: () => ctx.update(i, { status: 'resolvido' }, `Incidente #${i.id} resolvido.`) }),
    i.status !== 'resolvido' &&
      iconButton('tool', 'Registrar manutenção', async () => {
        if (await openMaintenanceForm(null, { machine_id: i.machine_id, incident_id: i.id, type: 'corretiva', status: 'em_andamento', description: i.title })) ctx.refresh();
      }),
  ],
});

// ------------------------------------------------------------------ manutenções
export async function openMaintenanceForm(maintenance, preset = {}) {
  const incidentOptions = async () =>
    (await api.incidents.list()).items.map((i) => ({ value: i.id, label: `#${i.id} · ${i.machine_hostname} · ${i.title}` }));
  const result = await formModal({
    title: maintenance ? `Manutenção #${maintenance.id}` : 'Registrar manutenção',
    fields: [
      { name: 'machine_id', label: 'Máquina', type: 'select', required: true, valueType: 'number', options: machineOptions },
      { name: 'type', label: 'Tipo', type: 'select', required: true, options: toOptions(MAINTENANCE_TYPE) },
      { name: 'description', label: 'Serviço realizado / a realizar', type: 'textarea', required: true },
      { name: 'technician', label: 'Técnico responsável' },
      { name: 'scheduled_for', label: 'Data', type: 'date', required: true },
      { name: 'cost', label: 'Custo (R$)', type: 'number', min: 0, step: 0.01 },
      { name: 'status', label: 'Status', type: 'select', required: true, options: toOptions(MAINTENANCE_STATUS) },
      { name: 'incident_id', label: 'Incidente relacionado', type: 'select', valueType: 'number', span: 2, placeholder: 'Nenhum (preventiva)', options: incidentOptions },
    ],
    values: maintenance ?? { type: 'preventiva', status: 'agendada', cost: 0, scheduled_for: new Date().toISOString().slice(0, 10), ...preset },
    onSubmit: (v) => (maintenance ? api.maintenances.update(maintenance.id, v) : api.maintenances.create(v)),
  });
  if (result) toast(maintenance ? 'Manutenção atualizada.' : `Manutenção registrada para ${result.machine_hostname}.`, 'success');
  return result;
}

export const maintenancesPage = crudPage({
  title: 'Manutenções',
  subtitle: 'Serviços preventivos e corretivos, técnicos e custos de reparo',
  icon: 'wrench',
  entity: 'manutenção',
  newLabel: 'Registrar manutenção',
  api: api.maintenances,
  openForm: openMaintenanceForm,
  labelOf: (m) => `Manutenção #${m.id}`,
  searchPlaceholder: 'Buscar por serviço, técnico ou máquina',
  filters: [
    { name: 'type', label: 'Todos os tipos', options: toOptions(MAINTENANCE_TYPE) },
    { name: 'status', label: 'Todos os status', options: toOptions(MAINTENANCE_STATUS) },
  ],
  summary: (all) => {
    const month = new Date().toISOString().slice(0, 7);
    const spent = all.filter((m) => m.status === 'concluida' && (m.completed_at ?? '').slice(0, 7) === month).reduce((a, m) => a + (m.cost || 0), 0);
    return h(
      'div',
      { class: 'chips', style: 'padding:16px 16px 0' },
      chip('agendadas', all.filter((m) => m.status === 'agendada').length, 'info', 'calendar'),
      chip('em andamento', all.filter((m) => m.status === 'em_andamento').length, 'warning', 'wrench'),
      chip('gasto no mês', money(spent), 'accent', 'cash'),
    );
  },
  columns: () => [
    { label: 'Máquina', render: machineLink },
    { label: 'Serviço', class: 'wrap', render: (m) => cellStack(m.description, m.incident_id ? `Incidente #${m.incident_id}` : 'Sem incidente vinculado') },
    { label: 'Tipo', render: (m) => statusBadge(MAINTENANCE_TYPE, m.type) },
    { label: 'Técnico', render: (m) => m.technician ?? '—' },
    { label: 'Data', render: (m) => cellStack(date(m.scheduled_for), m.completed_at ? `concluída ${date(m.completed_at)}` : null) },
    { label: 'Custo', class: 'num', render: (m) => money(m.cost) },
    { label: 'Status', render: (m) => statusBadge(MAINTENANCE_STATUS, m.status) },
  ],
  rowActions: (m, ctx) => m.status !== 'concluida' && button('Concluir', { size: 'sm', icon: 'check', onClick: () => ctx.update(m, { status: 'concluida' }, 'Manutenção concluída.') }),
});
