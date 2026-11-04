import { h } from './dom.js';
import { icon } from './icons.js';
import { errorTitle } from '../api/errors.js';

const ICONS = { success: 'check', danger: 'alert', warning: 'alert', info: 'info' };

export function toast(message, tone = 'info', { title, timeout = 4500 } = {}) {
  const host = document.getElementById('toasts');
  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  const el = h(
    'div',
    { class: `toast tone-${tone}`, role: tone === 'danger' ? 'alert' : 'status' },
    icon(ICONS[tone] ?? 'info', 18),
    h('div', {}, title && h('div', { class: 'toast-title' }, title), h('div', { class: 'toast-msg' }, message)),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Fechar', onclick: remove }, icon('x', 14)),
  );
  host.append(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout) setTimeout(remove, timeout);
}

export const toastError = (err) => toast(err?.message ?? String(err), 'danger', { title: errorTitle(err), timeout: 6500 });
