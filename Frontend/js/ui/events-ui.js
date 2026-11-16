// Exibição dos eventos (documentos do MongoDB).

import { h, esc } from './dom.js';
import { icon } from './icons.js';
import { empty } from './components.js';
import { EVENT_TYPES, MACHINE_STATUS } from '../constants.js';
import { duration, money, relative, dateTime } from '../format.js';

const stateLabel = (s) => (s ? (MACHINE_STATUS[s]?.label ?? s) : 'novo cadastro');

export function describeEvent(e) {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'session_started': return `@${p.user_nickname ?? '?'} iniciou uma sessão${p.plan_name ? ` · ${p.plan_name}` : ''}`;
    case 'session_ended': return `Sessão de @${p.user_nickname ?? '?'} encerrada · ${duration(p.duration_minutes)} · ${money(p.amount)}`;
    case 'state_changed': return `${stateLabel(p.from)} → ${stateLabel(p.to)}${p.reason ? ` · ${p.reason}` : ''}`;
    case 'program_started': return `Executou ${p.program}`;
    case 'error': return p.message ?? p.code ?? 'Erro registrado';
    case 'diagnostic': return `Diagnóstico: ${p.summary ?? 'sem resumo'}`;
    case 'incident_opened': return `Incidente aberto: ${p.title}`;
    default: return e.type;
  }
}

export function eventFeed(events, { showMachine = true, expandable = false } = {}) {
  if (!events.length) return empty('Nenhum evento registrado.', 'list');
  return h('ul', { class: 'feed' }, events.map((e) => eventItem(e, { showMachine, expandable })));
}

export function eventItem(e, { showMachine = true, expandable = false } = {}) {
  const t = EVENT_TYPES[e.type] ?? { label: e.type, tone: 'muted', icon: 'info' };
  const doc = expandable ? h('pre', { class: 'json', hidden: true, html: jsonHighlight(e) }) : null;
  const toggle = expandable
    ? h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          title: 'Ver documento JSON',
          onclick: () => {
            doc.hidden = !doc.hidden;
            toggle.classList.toggle('active', !doc.hidden);
          },
        },
        icon('code', 14),
        'JSON',
      )
    : null;

  return h(
    'li',
    { class: `feed-item tone-${t.tone}` },
    h('span', { class: 'feed-icon' }, icon(t.icon, 15)),
    h(
      'div',
      { class: 'feed-text' },
      h('div', {}, describeEvent(e)),
      h('div', { class: 'feed-meta' }, showMachine && e.machine_hostname && [h('a', { href: `#/maquinas/${e.machine_id}`, class: 'mono' }, e.machine_hostname), ' · '], t.label),
      doc,
    ),
    h('div', { class: 'feed-side' }, h('span', { class: 'feed-time', title: dateTime(e.timestamp), dataset: { relative: e.timestamp } }, relative(e.timestamp)), toggle),
  );
}

/** JSON com realce de sintaxe (escapado). */
export function jsonHighlight(obj) {
  const raw = JSON.stringify(obj, null, 2);
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(re)) {
    const [all, str, colon, kw] = m;
    out += esc(raw.slice(last, m.index));
    if (str) out += colon ? `<span class="k">${esc(str)}</span>${colon}` : `<span class="s">${esc(str)}</span>`;
    else if (kw) out += `<span class="b">${kw}</span>`;
    else out += `<span class="n">${all}</span>`;
    last = m.index + all.length;
  }
  return out + esc(raw.slice(last));
}
