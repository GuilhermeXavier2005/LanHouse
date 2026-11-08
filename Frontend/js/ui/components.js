import { h } from './dom.js';
import { icon } from './icons.js';
import { DB_SOURCES } from '../constants.js';
import { errorTitle } from '../api/errors.js';
import { initials } from '../format.js';

export function pageHeader(title, subtitle, actions = []) {
  return h(
    'div',
    { class: 'page-header' },
    h('div', {}, h('h1', { class: 'page-title' }, title), subtitle && h('p', { class: 'page-subtitle' }, subtitle)),
    h('div', { class: 'page-actions' }, actions),
  );
}

export function button(label, { icon: ic, variant = 'secondary', size, onClick, type = 'button', title, disabled } = {}) {
  return h(
    'button',
    { class: `btn btn-${variant}${size ? ` btn-${size}` : ''}`, type, title, 'aria-label': !label ? title : null, disabled, onclick: onClick },
    ic && icon(ic, size === 'sm' ? 14 : 16),
    label && h('span', {}, label),
  );
}

export function iconButton(ic, title, onClick, { danger = false } = {}) {
  return h('button', { class: `btn btn-ghost btn-icon${danger ? ' danger' : ''}`, type: 'button', title, 'aria-label': title, onclick: onClick }, icon(ic, 16));
}

/** Etiqueta que mostra de qual banco vêm os dados de um bloco. */
export function sourceTag(source) {
  return h(
    'span',
    { class: 'source-tags' },
    [source].flat().map((s) => h('span', { class: `source-tag src-${s}`, title: `Fonte: ${DB_SOURCES[s].label} — ${DB_SOURCES[s].role}` }, icon('database', 11), DB_SOURCES[s].short)),
  );
}

export function card({ title, icon: ic, source, actions, body, className = '', flush = false }) {
  return h(
    'section',
    { class: `card ${className}` },
    (title || actions || source) &&
      h(
        'header',
        { class: 'card-header' },
        h('div', { class: 'card-title' }, ic && icon(ic, 16), title && h('h2', {}, title)),
        h('div', { class: 'card-actions' }, source && sourceTag(source), actions),
      ),
    h('div', { class: `card-body${flush ? ' flush' : ''}` }, body),
  );
}

export function badge(text, tone = 'muted', { dot = false } = {}) {
  return h('span', { class: `badge tone-${tone}` }, dot && h('span', { class: 'badge-dot' }), text);
}

export function statusBadge(map, value) {
  const s = map[value] ?? { label: value ?? '—', tone: 'muted' };
  return badge(s.label, s.tone, { dot: true });
}

export function kpi({ label, value, sub, icon: ic, tone = 'primary' }) {
  return h(
    'div',
    { class: `kpi tone-${tone}` },
    h('div', { class: 'kpi-label' }, icon(ic, 14), label),
    h('div', { class: 'kpi-value' }, value),
    sub && h('div', { class: 'kpi-sub' }, sub),
  );
}

export function loading(text = 'Carregando...') {
  return h('div', { class: 'state', role: 'status' }, h('div', { class: 'spinner' }), h('span', {}, text));
}

export function empty(text, ic = 'info') {
  return h('div', { class: 'state' }, icon(ic, 22), h('span', {}, text));
}

export function errorState(err, onRetry) {
  return h(
    'div',
    { class: 'state state-error', role: 'alert' },
    icon(err?.source ? 'database' : 'alert', 22),
    h('strong', {}, errorTitle(err)),
    h('span', {}, err?.message ?? 'Erro inesperado.'),
    onRetry && button('Tentar novamente', { icon: 'refresh', size: 'sm', onClick: onRetry }),
  );
}

export function notice(content, tone = 'info', ic = 'info') {
  return h('div', { class: `notice tone-${tone}` }, icon(ic, 16), h('div', {}, content));
}

export function segmented(options, active, onChange) {
  const root = h('div', { class: 'segmented', role: 'group' });
  const paint = (value) =>
    root.replaceChildren(
      ...options.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: o.value === value ? 'active' : '',
            'aria-pressed': String(o.value === value),
            onclick: () => {
              if (o.value === value) return;
              paint(o.value);
              onChange(o.value);
            },
          },
          o.icon && icon(o.icon, 14),
          o.label,
        ),
      ),
    );
  paint(active);
  return root;
}

export function tabs(items, active, onChange) {
  const root = h('div', { class: 'tabs', role: 'tablist' });
  const paint = (value) =>
    root.replaceChildren(
      ...items.map((t) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `tab${t.value === value ? ' active' : ''}`,
            'aria-selected': String(t.value === value),
            onclick: () => {
              paint(t.value);
              onChange(t.value);
            },
          },
          icon(t.icon, 15),
          t.label,
        ),
      ),
    );
  paint(active);
  return root;
}

export function select(options, value, onChange, { label } = {}) {
  const el = h('select', { class: 'input', 'aria-label': label, onchange: (e) => onChange(e.target.value) }, options.map((o) => h('option', { value: String(o.value) }, o.label)));
  el.value = String(value ?? '');
  return el;
}

export function searchBox(placeholder, onInput, value = '') {
  return h('div', { class: 'search grow' }, icon('search', 16), h('input', { class: 'input', type: 'search', placeholder, value, 'aria-label': placeholder, oninput: (e) => onInput(e.target.value) }));
}

/**
 * Tabela simples. columns: [{ label, key?, render?(row), class? }]
 * Clique na linha chama onRowClick (exceto quando o alvo é um botão/link).
 */
export function table({ columns, rows, onRowClick, rowClass, emptyText = 'Nenhum registro encontrado.' }) {
  if (!rows.length) return empty(emptyText, 'search');
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.class, scope: 'col' }, c.label)))),
      h(
        'tbody',
        {},
        rows.map((r) =>
          h(
            'tr',
            {
              class: [onRowClick && 'clickable', rowClass?.(r)].filter(Boolean).join(' '),
              onclick: onRowClick
                ? (e) => {
                    if (!e.target.closest('button, a, input, select')) onRowClick(r);
                  }
                : null,
            },
            columns.map((c) => h('td', { class: c.class }, c.render ? c.render(r) : (r[c.key] ?? '—'))),
          ),
        ),
      ),
    ),
  );
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '—')]));
}

export function cellStack(main, sub) {
  return h('div', {}, h('div', { class: 'cell-main' }, main), sub && h('div', { class: 'cell-sub' }, sub));
}

export function avatar(name) {
  const hue = [...(name ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return h('div', { class: 'avatar', style: `--hue:${hue}`, 'aria-hidden': 'true' }, initials(name));
}

export function chip(label, value, tone = 'muted', ic) {
  return h('div', { class: `chip tone-${tone}` }, ic && icon(ic, 15), h('strong', {}, value), label);
}

export function stat(label, value) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));
}

/**
 * Bloco que carrega dados, renderiza, trata erro e (opcionalmente) se atualiza sozinho.
 * Cada bloco falha de forma independente — se o Cassandra cair, só os blocos de
 * métricas mostram erro; o resto da tela continua funcionando.
 *
 * Retorna uma função que para o bloco, com .refresh() (silencioso) e .reload() (com spinner).
 */
export function widget(container, { load, render, interval, loadingText }) {
  let stopped = false;
  let timer = null;
  let seq = 0;
  let showSpinner = true;

  async function run() {
    clearTimeout(timer);
    const mine = ++seq;
    if (showSpinner) container.replaceChildren(loading(loadingText));
    try {
      const data = await load();
      if (stopped || mine !== seq) return;
      container.replaceChildren(...[render(data)].flat(Infinity).filter((n) => n != null && n !== false));
    } catch (err) {
      if (stopped || mine !== seq) return;
      console.warn('[widget]', err);
      container.replaceChildren(errorState(err, () => reload()));
    }
    showSpinner = false;
    if (interval && !stopped) timer = setTimeout(run, interval);
  }

  function reload() {
    showSpinner = true;
    run();
  }

  run();
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
  };
  stop.refresh = () => run();
  stop.reload = reload;
  return stop;
}
