// API REST simulada no navegador. Implementa o mesmo contrato de frontend/API.md,
// incluindo validações, conflitos (409) e indisponibilidade de cada banco (503),
// para que o front-end já seja testado contra os cenários que o back-end terá.

import { ApiError } from '../errors.js';
import { getDb, persist, getDown } from './store.js';
import { metricsRange, latestSample } from './metrics.js';
import { sessionAmount } from '../../pricing.js';
import { DB_SOURCES, MACHINE_STATUS, ZONES, PAYMENT_METHODS, INCIDENT_SEVERITY, INCIDENT_STATUS, MAINTENANCE_TYPE, MAINTENANCE_STATUS, PLAN_KIND, PLAN_BILLING, PROGRAM_CATEGORY, PROGRAM_LICENSE } from '../../constants.js';
import { localDateKey } from '../../format.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LATENCY_MS = [90, 380];

// ------------------------------------------------------------------ roteador
const routes = [];
function on(method, pattern, source, handler) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, regex, keys, source, handler });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export async function mockFetch(method, url, body) {
  const [path, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  await sleep(LATENCY_MS[0] + Math.random() * (LATENCY_MS[1] - LATENCY_MS[0]));

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.regex);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const down = getDown();
    if (r.source && down[r.source]) {
      throw new ApiError({ status: 503, code: 'DB_UNAVAILABLE', source: r.source, message: `Não foi possível consultar o ${DB_SOURCES[r.source].label}. Tente novamente em instantes.` });
    }
    const ctx = { params, query, body: clone(body) ?? {}, db: getDb(), down, warnings: [] };
    const out = clone(r.handler(ctx)) ?? null;
    if (ctx.warnings.length && out && typeof out === 'object' && !Array.isArray(out)) out._warnings = ctx.warnings;
    return out;
  }
  throw new ApiError({ status: 404, code: 'ROUTE_NOT_FOUND', message: `Rota ${method} ${path} não existe.` });
}

// ------------------------------------------------------------------ utilidades
const nowIso = () => new Date().toISOString();
const round2 = (v) => Math.round(v * 100) / 100;
const byId = (list, id) => list.find((x) => x.id === Number(id));
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function fail(status, code, message, extra = {}) {
  throw new ApiError({ status, code, message, ...extra });
}
const notFound = (what) => fail(404, 'NOT_FOUND', `${what} não encontrado(a).`);
const conflict = (message) => fail(409, 'CONFLICT', message);

function nextId(db, table) {
  db.seq[table] = (db.seq[table] ?? Math.max(0, ...db[table].map((x) => x.id))) + 1;
  return db.seq[table];
}

function objectId() {
  const rnd = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return Math.floor(Date.now() / 1000).toString(16) + rnd;
}

/** Regras: { campo: { required, oneOf: [], number, min, check: (v) => msg|null } } */
function validate(body, rules) {
  const details = {};
  for (const [field, rule] of Object.entries(rules)) {
    const v = body[field];
    const isEmpty = v === undefined || v === null || v === '';
    if (isEmpty) {
      if (rule.required) details[field] = 'Campo obrigatório.';
      continue;
    }
    if (rule.oneOf && !rule.oneOf.includes(v)) details[field] = 'Valor inválido.';
    else if (rule.number && (typeof v !== 'number' || Number.isNaN(v))) details[field] = 'Informe um número.';
    else if (rule.min != null && v < rule.min) details[field] = `Valor mínimo: ${rule.min}.`;
    else if (rule.check) {
      const msg = rule.check(v);
      if (msg) details[field] = msg;
    }
  }
  if (Object.keys(details).length) fail(422, 'VALIDATION_ERROR', 'Verifique os campos destacados.', { details });
}

/** Filtros por igualdade; aceita lista separada por vírgula (?status=aberto,em_andamento). */
function applyFilters(items, query, keys) {
  return items.filter((item) =>
    keys.every((k) => {
      const q = query[k];
      if (q == null || q === '') return true;
      return q.split(',').includes(String(item[k]));
    }),
  );
}

function search(items, q, fields) {
  if (!q) return items;
  const t = norm(q);
  return items.filter((i) => fields.some((f) => norm(i[f]).includes(t)));
}

function paginate(items, query) {
  const offset = Number(query.offset) || 0;
  const limit = query.limit ? Number(query.limit) : items.length;
  return { items: items.slice(offset, offset + limit), total: items.length };
}

/** Grava evento no "MongoDB". Se ele estiver fora, a operação principal segue e devolve um aviso. */
function logEvent(ctx, event) {
  if (ctx.down.mongodb) {
    const msg = 'Evento não registrado: MongoDB indisponível. O registro principal foi salvo no PostgreSQL.';
    if (!ctx.warnings.includes(msg)) ctx.warnings.push(msg);
    return;
  }
  const machine = byId(ctx.db.machines, event.machine_id);
  ctx.db.events.unshift({ _id: objectId(), type: event.type, machine_id: event.machine_id, machine_hostname: machine?.hostname ?? null, timestamp: nowIso(), ...(event.session_id ? { session_id: event.session_id } : {}), payload: event.payload });
}

// ------------------------------------------------------------------ "joins"
function machineOut(m, db) {
  const { last_seen_at: _ignored, ...rest } = m;
  let active = null;
  let last = null;
  for (const s of db.sessions) {
    if (s.machine_id !== m.id || s.status === 'cancelada') continue;
    if (s.status === 'ativa') active = s;
    if (!last || s.started_at > last.started_at) last = s;
  }
  const ref = active ?? last;
  const u = ref && byId(db.users, ref.user_id);
  return {
    ...rest,
    active_session_id: active?.id ?? null,
    last_user: u ? { id: u.id, name: u.name, nickname: u.nickname, session_id: ref.id, at: ref.ended_at ?? ref.started_at, in_session: !!active } : null,
  };
}

function sessionOut(s, db) {
  const m = byId(db.machines, s.machine_id);
  const u = byId(db.users, s.user_id);
  const p = byId(db.plans, s.plan_id);
  return {
    ...s,
    machine_hostname: m?.hostname ?? `#${s.machine_id} (removida)`,
    machine_zone: m?.zone ?? null,
    user_name: u?.name ?? 'Usuário removido',
    user_nickname: u?.nickname ?? '—',
    plan_name: p?.name ?? '—',
    plan_billing: p?.billing ?? null,
    plan_price: p?.price ?? null,
    plan_hours: p?.hours ?? null,
  };
}

function userOut(u, db) {
  const mine = db.sessions.filter((s) => s.user_id === u.id);
  const last = mine.reduce((acc, s) => (!acc || s.started_at > acc ? s.started_at : acc), null);
  return { ...u, sessions_count: mine.length, last_session_at: last, in_session: mine.some((s) => s.status === 'ativa') };
}

const withHostname = (x, db) => ({ ...x, machine_hostname: byId(db.machines, x.machine_id)?.hostname ?? `#${x.machine_id}` });
const programOut = (p, db) => ({ ...p, machines_count: db.machine_programs.filter((mp) => mp.program_id === p.id).length });

// ------------------------------------------------------------------ CRUD genérico (PostgreSQL)
function resource(path, table, { label, fields, rules, out = (x) => x, filters = [], searchFields = [], sort, defaults = {}, onCreate, onUpdate, beforeDelete }) {
  on('GET', path, 'postgres', ({ db, query }) => {
    let items = db[table].map((x) => out(x, db));
    items = applyFilters(items, query, filters);
    items = search(items, query.q, searchFields);
    if (sort) items.sort(sort);
    return paginate(items, query);
  });

  on('GET', `${path}/:id`, 'postgres', ({ db, params }) => out(byId(db[table], params.id) ?? notFound(label), db));

  on('POST', path, 'postgres', (ctx) => {
    const { db, body } = ctx;
    const data = { ...defaults, ...pick(body, fields) };
    validate(data, rules(db, null));
    const item = { id: nextId(db, table), ...data, created_at: nowIso() };
    onCreate?.(item, ctx);
    db[table].push(item);
    persist();
    return out(item, db);
  });

  const update = (ctx) => {
    const { db, body, params } = ctx;
    const item = byId(db[table], params.id) ?? notFound(label);
    const next = { ...item, ...pick(body, fields), updated_at: nowIso() };
    validate(next, rules(db, item));
    onUpdate?.(next, { ...item }, ctx);
    Object.assign(item, next);
    persist();
    return out(item, db);
  };
  on('PUT', `${path}/:id`, 'postgres', update);
  on('PATCH', `${path}/:id`, 'postgres', update);

  on('DELETE', `${path}/:id`, 'postgres', (ctx) => {
    const { db, params } = ctx;
    const item = byId(db[table], params.id) ?? notFound(label);
    beforeDelete?.(item, ctx);
    db[table] = db[table].filter((x) => x !== item);
    persist();
    return null;
  });
}

const keys = (map) => Object.keys(map);
const machineExists = (db) => ({ required: true, check: (v) => (byId(db.machines, v) ? null : 'Máquina inexistente.') });

// ------------------------------------------------------------------ health
on('GET', '/health', null, ({ down }) => {
  const services = Object.fromEntries(
    Object.keys(DB_SOURCES).map((s) => [
      s,
      down[s] ? { status: 'down', latency_ms: null, error: 'connection refused' } : { status: 'up', latency_ms: Math.round(2 + Math.random() * (s === 'cassandra' ? 14 : 8)) },
    ]),
  );
  return { status: Object.values(down).some(Boolean) ? 'degraded' : 'ok', checked_at: nowIso(), services };
});

// ------------------------------------------------------------------ máquinas
const MACHINE_FIELDS = ['hostname', 'zone', 'cpu', 'gpu', 'ram_gb', 'storage_gb', 'os', 'ip', 'mac', 'notes'];
const machineRules = (db, current) => ({
  hostname: {
    required: true,
    check: (v) => (db.machines.some((m) => norm(m.hostname) === norm(v) && m.id !== current?.id) ? 'Já existe uma máquina com esse hostname.' : null),
  },
  zone: { required: true, oneOf: keys(ZONES) },
  cpu: { required: true },
  ram_gb: { required: true, number: true, min: 1 },
  storage_gb: { required: true, number: true, min: 1 },
  ip: { check: (v) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) ? null : 'IPv4 inválido.') },
});
const hasActiveSession = (db, field, id) => db.sessions.some((s) => s[field] === id && s.status === 'ativa');

on('GET', '/machines', 'postgres', ({ db, query }) => {
  let items = db.machines.map((m) => machineOut(m, db));
  items = applyFilters(items, query, ['zone', 'status']);
  items = search(items, query.q, ['hostname', 'cpu', 'gpu', 'ip', 'os']);
  return paginate(items, query);
});

on('GET', '/machines/:id', 'postgres', ({ db, params }) => machineOut(byId(db.machines, params.id) ?? notFound('Máquina'), db));

on('POST', '/machines', 'postgres', (ctx) => {
  const { db, body } = ctx;
  const data = pick(body, MACHINE_FIELDS);
  data.status = body.status || 'disponivel';
  validate(data, { ...machineRules(db, null), status: { oneOf: ['disponivel', 'manutencao', 'offline'] } });
  const m = { id: nextId(db, 'machines'), ...data, hostname: data.hostname.trim().toUpperCase(), created_at: nowIso(), updated_at: nowIso(), last_seen_at: data.status === 'offline' ? nowIso() : null };
  db.machines.push(m);
  logEvent(ctx, { type: 'state_changed', machine_id: m.id, payload: { from: null, to: m.status, reason: 'Máquina cadastrada' } });
  persist();
  return machineOut(m, db);
});

on('PUT', '/machines/:id', 'postgres', ({ db, body, params }) => {
  const m = byId(db.machines, params.id) ?? notFound('Máquina');
  const next = { ...m, ...pick(body, MACHINE_FIELDS) };
  validate(next, machineRules(db, m));
  Object.assign(m, next, { hostname: next.hostname.trim().toUpperCase(), updated_at: nowIso() });
  persist();
  return machineOut(m, db);
});

on('PATCH', '/machines/:id/status', 'postgres', (ctx) => {
  const { db, body, params } = ctx;
  const m = byId(db.machines, params.id) ?? notFound('Máquina');
  validate(body, { status: { required: true, oneOf: ['disponivel', 'manutencao', 'offline'] } });
  if (hasActiveSession(db, 'machine_id', m.id)) conflict('A máquina possui uma sessão ativa. Encerre a sessão antes de alterar o estado.');
  if (m.status !== body.status) {
    const from = m.status;
    m.status = body.status;
    m.updated_at = nowIso();
    m.last_seen_at = body.status === 'offline' ? nowIso() : null;
    logEvent(ctx, { type: 'state_changed', machine_id: m.id, payload: { from, to: m.status, reason: body.reason || 'Alteração manual' } });
    persist();
  }
  return machineOut(m, db);
});

on('DELETE', '/machines/:id', 'postgres', ({ db, params }) => {
  const m = byId(db.machines, params.id) ?? notFound('Máquina');
  if (hasActiveSession(db, 'machine_id', m.id)) conflict('Não é possível excluir uma máquina com sessão ativa.');
  db.machines = db.machines.filter((x) => x !== m);
  db.machine_programs = db.machine_programs.filter((x) => x.machine_id !== m.id);
  persist();
  return null;
});

on('GET', '/machines/:id/last-user', 'postgres', ({ db, params }) => ({ last_user: machineOut(byId(db.machines, params.id) ?? notFound('Máquina'), db).last_user }));

on('GET', '/machines/:id/programs', 'postgres', ({ db, params }) => {
  const m = byId(db.machines, params.id) ?? notFound('Máquina');
  const items = db.machine_programs
    .filter((mp) => mp.machine_id === m.id)
    .map((mp) => ({ ...byId(db.programs, mp.program_id), installed_at: mp.installed_at }))
    .filter((p) => p.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items, total: items.length };
});

on('PUT', '/machines/:id/programs', 'postgres', ({ db, body, params }) => {
  const m = byId(db.machines, params.id) ?? notFound('Máquina');
  if (!Array.isArray(body.program_ids)) fail(422, 'VALIDATION_ERROR', 'program_ids deve ser uma lista.');
  const ids = [...new Set(body.program_ids.map(Number))].filter((id) => byId(db.programs, id));
  const current = new Map(db.machine_programs.filter((mp) => mp.machine_id === m.id).map((mp) => [mp.program_id, mp]));
  db.machine_programs = db.machine_programs.filter((mp) => mp.machine_id !== m.id);
  for (const id of ids) db.machine_programs.push(current.get(id) ?? { machine_id: m.id, program_id: id, installed_at: nowIso() });
  persist();
  return { machine_id: m.id, program_ids: ids };
});

// métricas (Cassandra)
on('GET', '/machines/:id/metrics', 'cassandra', ({ db, params, query }) => {
  const m = byId(db.machines, params.id) ?? notFound('Máquina');
  const to = query.to ? Date.parse(query.to) : Date.now();
  const from = query.from ? Date.parse(query.from) : to - 60 * MIN;
  if (!(from < to)) fail(422, 'VALIDATION_ERROR', 'Período inválido.');
  if (to - from > 31 * DAY) fail(422, 'VALIDATION_ERROR', 'Período máximo de 31 dias.');
  const { step, items } = metricsRange(m, db.sessions, from, to, query.step ? Number(query.step) * 1000 : null);
  return { machine_id: m.id, from: new Date(from).toISOString(), to: new Date(to).toISOString(), step_seconds: step / 1000, items };
});

on('GET', '/machines/:id/metrics/latest', 'cassandra', ({ db, params }) => latestSample(byId(db.machines, params.id) ?? notFound('Máquina'), db.sessions));

on('GET', '/metrics/latest', 'cassandra', ({ db }) => {
  const items = db.machines.map((m) => latestSample(m, db.sessions));
  return { items, total: items.length };
});

// eventos (MongoDB)
on('GET', '/machines/:id/events', 'mongodb', ({ db, params, query }) => {
  const id = Number(params.id);
  let items = db.events.filter((e) => e.machine_id === id);
  items = applyFilters(items, query, ['type']);
  return paginate(items, { limit: 20, ...query });
});

on('GET', '/events', 'mongodb', ({ db, query }) => {
  let items = applyFilters(db.events, query, ['type', 'machine_id']);
  if (query.from) items = items.filter((e) => e.timestamp >= new Date(query.from).toISOString());
  if (query.to) items = items.filter((e) => e.timestamp <= new Date(query.to).toISOString());
  if (query.q) {
    const t = norm(query.q);
    items = items.filter((e) => norm(JSON.stringify(e)).includes(t));
  }
  return paginate(items, { limit: 50, ...query });
});

on('GET', '/events/:id', 'mongodb', ({ db, params }) => db.events.find((e) => e._id === params.id) ?? notFound('Evento'));

// ------------------------------------------------------------------ sessões
on('GET', '/sessions', 'postgres', ({ db, query }) => {
  let items = applyFilters(db.sessions, query, ['status', 'payment_status', 'machine_id', 'user_id', 'plan_id']);
  if (query.from) items = items.filter((s) => s.started_at >= new Date(query.from).toISOString());
  if (query.to) items = items.filter((s) => s.started_at <= new Date(query.to).toISOString());
  items = items.map((s) => sessionOut(s, db));
  items = search(items, query.q, ['user_name', 'user_nickname', 'machine_hostname', 'plan_name']);
  items.sort((a, b) => b.started_at.localeCompare(a.started_at));
  const totalPaid = round2(items.reduce((acc, s) => acc + (s.payment_status === 'pago' ? s.amount || 0 : 0), 0));
  const totalPending = round2(items.reduce((acc, s) => acc + (s.status === 'encerrada' && s.payment_status === 'pendente' ? s.amount || 0 : 0), 0));
  return { ...paginate(items, query), total_paid: totalPaid, total_pending: totalPending };
});

on('GET', '/sessions/:id', 'postgres', ({ db, params }) => sessionOut(byId(db.sessions, params.id) ?? notFound('Sessão'), db));

on('POST', '/sessions', 'postgres', (ctx) => {
  const { db, body } = ctx;
  validate(body, { machine_id: machineExists(db), user_id: { required: true }, plan_id: { required: true } });
  const m = byId(db.machines, body.machine_id);
  if (m.status !== 'disponivel') conflict(`${m.hostname} não está disponível (${MACHINE_STATUS[m.status].label.toLowerCase()}).`);
  const u = byId(db.users, body.user_id) ?? fail(422, 'VALIDATION_ERROR', 'Usuário inexistente.', { details: { user_id: 'Usuário inexistente.' } });
  if (hasActiveSession(db, 'user_id', u.id)) conflict(`@${u.nickname} já está em uma sessão ativa.`);
  const plan = byId(db.plans, body.plan_id);
  if (!plan || plan.kind !== 'plano' || !plan.active) fail(422, 'VALIDATION_ERROR', 'Plano inválido para sessões.', { details: { plan_id: 'Escolha um plano de uso ativo.' } });

  const s = { id: nextId(db, 'sessions'), machine_id: m.id, user_id: u.id, plan_id: plan.id, started_at: nowIso(), ended_at: null, duration_minutes: null, amount: null, payment_method: null, payment_status: 'pendente', status: 'ativa' };
  db.sessions.push(s);
  m.status = 'em_uso';
  m.updated_at = nowIso();
  logEvent(ctx, { type: 'session_started', machine_id: m.id, session_id: s.id, payload: { session_id: s.id, user_id: u.id, user_nickname: u.nickname, plan_id: plan.id, plan_name: plan.name } });
  logEvent(ctx, { type: 'state_changed', machine_id: m.id, session_id: s.id, payload: { from: 'disponivel', to: 'em_uso', reason: 'Início de sessão' } });
  persist();
  return sessionOut(s, db);
});

on('POST', '/sessions/:id/end', 'postgres', (ctx) => {
  const { db, body, params } = ctx;
  const s = byId(db.sessions, params.id) ?? notFound('Sessão');
  if (s.status !== 'ativa') conflict('Esta sessão já foi encerrada.');
  const status = body.payment_status || 'pago';
  validate({ ...body, payment_status: status }, { payment_status: { oneOf: ['pago', 'pendente'] }, payment_method: { required: status === 'pago', oneOf: keys(PAYMENT_METHODS) } });

  const end = Date.now();
  const minutes = Math.max(1, Math.round((end - Date.parse(s.started_at)) / MIN));
  Object.assign(s, {
    ended_at: new Date(end).toISOString(),
    duration_minutes: minutes,
    amount: sessionAmount(byId(db.plans, s.plan_id), minutes),
    payment_method: body.payment_method || null,
    payment_status: status,
    status: 'encerrada',
  });
  const m = byId(db.machines, s.machine_id);
  const u = byId(db.users, s.user_id);
  logEvent(ctx, { type: 'session_ended', machine_id: s.machine_id, session_id: s.id, payload: { session_id: s.id, user_nickname: u?.nickname, duration_minutes: minutes, amount: s.amount } });
  if (m?.status === 'em_uso') {
    m.status = 'disponivel';
    m.updated_at = nowIso();
    logEvent(ctx, { type: 'state_changed', machine_id: m.id, session_id: s.id, payload: { from: 'em_uso', to: 'disponivel', reason: 'Fim de sessão' } });
  }
  persist();
  return sessionOut(s, db);
});

on('PATCH', '/sessions/:id', 'postgres', ({ db, body, params }) => {
  const s = byId(db.sessions, params.id) ?? notFound('Sessão');
  if (s.status !== 'encerrada') conflict('Só é possível alterar o pagamento de sessões encerradas.');
  const next = { ...s, ...pick(body, ['payment_status', 'payment_method']) };
  validate(next, { payment_status: { required: true, oneOf: ['pago', 'pendente', 'cancelado'] }, payment_method: { required: next.payment_status === 'pago', oneOf: keys(PAYMENT_METHODS) } });
  Object.assign(s, next);
  persist();
  return sessionOut(s, db);
});

// ------------------------------------------------------------------ cadastros
resource('/users', 'users', {
  label: 'Usuário',
  fields: ['name', 'nickname', 'phone'],
  rules: (db, current) => ({
    name: { required: true },
    nickname: { required: true, check: (v) => (db.users.some((u) => norm(u.nickname) === norm(v) && u.id !== current?.id) ? 'Apelido já está em uso.' : null) },
  }),
  out: userOut,
  searchFields: ['name', 'nickname', 'phone'],
  sort: (a, b) => a.name.localeCompare(b.name),
  beforeDelete: (u, { db }) => {
    if (hasActiveSession(db, 'user_id', u.id)) conflict('Usuário está em uma sessão ativa.');
  },
});

resource('/plans', 'plans', {
  label: 'Plano',
  fields: ['name', 'kind', 'billing', 'price', 'hours', 'description', 'active'],
  defaults: { active: true, hours: null },
  rules: () => ({
    name: { required: true },
    kind: { required: true, oneOf: keys(PLAN_KIND) },
    billing: { required: true, oneOf: keys(PLAN_BILLING) },
    price: { required: true, number: true, min: 0 },
  }),
  filters: ['kind', 'billing', 'active'],
  searchFields: ['name', 'description'],
  onCreate: (p) => {
    if (p.billing === 'pacote' && !(p.hours > 0)) fail(422, 'VALIDATION_ERROR', 'Pacotes precisam da quantidade de horas.', { details: { hours: 'Informe as horas do pacote.' } });
  },
  onUpdate: (p) => {
    if (p.billing === 'pacote' && !(p.hours > 0)) fail(422, 'VALIDATION_ERROR', 'Pacotes precisam da quantidade de horas.', { details: { hours: 'Informe as horas do pacote.' } });
  },
  beforeDelete: (p, { db }) => {
    if (db.sessions.some((s) => s.plan_id === p.id && s.status === 'ativa')) conflict('Há sessões ativas usando este plano. Desative-o em vez de excluir.');
  },
});

resource('/programs', 'programs', {
  label: 'Programa',
  fields: ['name', 'category', 'publisher', 'version', 'license'],
  rules: () => ({ name: { required: true }, category: { required: true, oneOf: keys(PROGRAM_CATEGORY) }, license: { oneOf: keys(PROGRAM_LICENSE) } }),
  out: programOut,
  filters: ['category', 'license'],
  searchFields: ['name', 'publisher'],
  sort: (a, b) => a.name.localeCompare(b.name),
  beforeDelete: (p, { db }) => {
    db.machine_programs = db.machine_programs.filter((mp) => mp.program_id !== p.id);
  },
});

resource('/incidents', 'incidents', {
  label: 'Incidente',
  fields: ['machine_id', 'title', 'description', 'severity', 'status', 'reported_by'],
  defaults: { status: 'aberto', severity: 'media' },
  rules: (db) => ({ machine_id: machineExists(db), title: { required: true }, severity: { required: true, oneOf: keys(INCIDENT_SEVERITY) }, status: { required: true, oneOf: keys(INCIDENT_STATUS) } }),
  out: withHostname,
  filters: ['status', 'severity', 'machine_id'],
  searchFields: ['title', 'description', 'machine_hostname', 'reported_by'],
  sort: (a, b) => b.opened_at.localeCompare(a.opened_at),
  onCreate: (inc, ctx) => {
    inc.machine_id = Number(inc.machine_id);
    inc.opened_at = nowIso();
    inc.resolved_at = inc.status === 'resolvido' ? nowIso() : null;
    logEvent(ctx, { type: 'incident_opened', machine_id: inc.machine_id, payload: { incident_id: inc.id, title: inc.title, severity: inc.severity } });
  },
  onUpdate: (inc, prev) => {
    inc.machine_id = Number(inc.machine_id);
    if (inc.status === 'resolvido' && prev.status !== 'resolvido') inc.resolved_at = nowIso();
    if (inc.status !== 'resolvido') inc.resolved_at = null;
  },
});

resource('/maintenances', 'maintenances', {
  label: 'Manutenção',
  fields: ['machine_id', 'incident_id', 'type', 'description', 'technician', 'cost', 'scheduled_for', 'status'],
  defaults: { status: 'agendada', cost: 0, incident_id: null },
  rules: (db) => ({
    machine_id: machineExists(db),
    type: { required: true, oneOf: keys(MAINTENANCE_TYPE) },
    description: { required: true },
    status: { required: true, oneOf: keys(MAINTENANCE_STATUS) },
    cost: { number: true, min: 0 },
    incident_id: { check: (v) => (byId(db.incidents, v) ? null : 'Incidente inexistente.') },
  }),
  out: withHostname,
  filters: ['type', 'status', 'machine_id', 'incident_id'],
  searchFields: ['description', 'technician', 'machine_hostname'],
  sort: (a, b) => String(b.scheduled_for).localeCompare(String(a.scheduled_for)),
  onCreate: (mt) => {
    mt.machine_id = Number(mt.machine_id);
    mt.completed_at = mt.status === 'concluida' ? nowIso() : null;
  },
  onUpdate: (mt, prev) => {
    mt.machine_id = Number(mt.machine_id);
    if (mt.status === 'concluida' && prev.status !== 'concluida') mt.completed_at = nowIso();
    if (mt.status !== 'concluida') mt.completed_at = null;
  },
});

// ------------------------------------------------------------------ relatórios e internet
on('GET', '/reports/summary', 'postgres', ({ db }) => {
  const today = localDateKey(Date.now());
  const started = db.sessions.filter((s) => localDateKey(Date.parse(s.started_at)) === today);
  const ended = db.sessions.filter((s) => s.ended_at && localDateKey(Date.parse(s.ended_at)) === today);
  const paid = ended.filter((s) => s.payment_status === 'pago');
  return {
    date: today,
    sessions_today: started.length,
    active_sessions: db.sessions.filter((s) => s.status === 'ativa').length,
    revenue_today: round2(paid.reduce((a, s) => a + s.amount, 0)),
    pending_amount: round2(db.sessions.filter((s) => s.status === 'encerrada' && s.payment_status === 'pendente').reduce((a, s) => a + s.amount, 0)),
    avg_duration_minutes: ended.length ? Math.round(ended.reduce((a, s) => a + s.duration_minutes, 0) / ended.length) : null,
  };
});

on('GET', '/reports/revenue', 'postgres', ({ db, query }) => {
  const days = Math.min(90, Math.max(1, Number(query.days) || 7));
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) buckets.set(localDateKey(Date.now() - i * DAY), { total: 0, sessions: 0 });
  for (const s of db.sessions) {
    if (!s.ended_at || s.payment_status !== 'pago') continue;
    const b = buckets.get(localDateKey(Date.parse(s.ended_at)));
    if (b) {
      b.total += s.amount;
      b.sessions += 1;
    }
  }
  return { items: [...buckets].map(([date, b]) => ({ date, total: round2(b.total), sessions: b.sessions })) };
});

on('GET', '/internet-service', 'postgres', ({ db }) => db.internet);

on('PUT', '/internet-service', 'postgres', ({ db, body }) => {
  const next = { ...db.internet, ...pick(body, ['provider', 'plan_name', 'download_mbps', 'upload_mbps', 'monthly_cost', 'contract_start', 'public_ip', 'static_ip', 'support_phone']) };
  validate(next, { provider: { required: true }, download_mbps: { required: true, number: true, min: 1 }, upload_mbps: { required: true, number: true, min: 1 }, monthly_cost: { number: true, min: 0 } });
  db.internet = next;
  persist();
  return db.internet;
});
