import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, notice } from './components.js';
import { toastError } from './toast.js';
import { toLocalInput } from '../format.js';

export function openModal({ title, content, footer, size = 'md', onClose }) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 150);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && backdrop === document.querySelector('.modal-backdrop:last-of-type')) close();
  };
  const titleId = uid('modal-title');
  const dialog = h(
    'div',
    { class: `modal modal-${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal-header' }, h('h3', { id: titleId }, title), h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Fechar', onclick: close }, icon('x', 16))),
    h('div', { class: 'modal-body' }, content),
    footer && h('div', { class: 'modal-footer' }, footer),
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => dialog.querySelector('input:not([type=hidden]), select, textarea')?.focus());
  return { close, dialog };
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const modal = openModal({
      title,
      size: 'sm',
      content: h('p', { class: 'confirm-text' }, message),
      footer: [
        button('Cancelar', { variant: 'ghost', onClick: () => modal.close() }),
        button(confirmLabel, { variant: danger ? 'danger' : 'primary', onClick: () => { answer = true; modal.close(); } }),
      ],
      onClose: () => resolve(answer),
    });
  });
}

/**
 * Formulário em modal a partir de uma lista de campos:
 *   { name, label, type: text|number|select|textarea|checkbox|date|datetime-local|tel,
 *     required, options: [{value,label}] | async () => [...], valueType: 'number', span: 2, help, ... }
 * `onSubmit(values)` pode lançar ApiError; erros 422 com `details` destacam os campos.
 * Resolve com o retorno de onSubmit, ou null se cancelado.
 */
export async function formModal({ title, fields, values = {}, submitLabel = 'Salvar', onSubmit, intro, size }) {
  let resolved;
  try {
    resolved = await Promise.all(fields.map(async (f) => (typeof f.options === 'function' ? { ...f, options: await f.options() } : f)));
  } catch (err) {
    toastError(err);
    return null;
  }

  return new Promise((resolve) => {
    const formId = uid('form');
    const controls = {};
    const wrappers = {};
    const form = h('form', { id: formId, class: 'form-grid' });

    for (const f of resolved) {
      const id = uid('f');
      const control = fieldControl(f, values[f.name], id);
      controls[f.name] = control;
      const wrap = h(
        'div',
        { class: `field${f.span === 2 || f.type === 'textarea' ? ' span-2' : ''}` },
        f.type === 'checkbox'
          ? h('label', { class: 'check' }, control, f.label)
          : [h('label', { for: id }, f.label, f.required && h('span', { class: 'req' }, ' *')), control],
        f.help && h('div', { class: 'field-help' }, f.help),
        h('div', { class: 'field-error' }),
      );
      wrappers[f.name] = wrap;
      form.append(wrap);
    }

    const errorBox = h('div');
    const submit = h('button', { class: 'btn btn-primary', type: 'submit', form: formId }, submitLabel);
    let result = null;

    const collect = () => {
      const out = {};
      for (const f of resolved) {
        const c = controls[f.name];
        if (f.type === 'checkbox') out[f.name] = c.checked;
        else if (f.type === 'number' || f.valueType === 'number') out[f.name] = c.value === '' ? null : Number(c.value);
        else if (f.type === 'datetime-local') out[f.name] = c.value ? new Date(c.value).toISOString() : null;
        else out[f.name] = c.value.trim() === '' ? null : c.value.trim();
      }
      return out;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      errorBox.replaceChildren();
      Object.values(wrappers).forEach((w) => {
        w.classList.remove('invalid');
        w.querySelector('.field-error').textContent = '';
      });
      submit.disabled = true;
      submit.classList.add('loading');
      try {
        result = (await onSubmit(collect())) ?? true;
        modal.close();
      } catch (err) {
        for (const [name, msg] of Object.entries(err?.details ?? {})) {
          const w = wrappers[name];
          if (!w) continue;
          w.classList.add('invalid');
          w.querySelector('.field-error').textContent = msg;
        }
        errorBox.replaceChildren(notice(err?.message ?? String(err), 'danger', err?.source ? 'database' : 'alert'));
      } finally {
        submit.disabled = false;
        submit.classList.remove('loading');
      }
    });

    const modal = openModal({
      title,
      size,
      content: [intro && h('div', { class: 'form-intro' }, intro), errorBox, form],
      footer: [button('Cancelar', { variant: 'ghost', onClick: () => modal.close() }), submit],
      onClose: () => resolve(result),
    });
  });
}

function fieldControl(f, value, id) {
  const common = { id, name: f.name, class: 'input', required: !!f.required, disabled: !!f.disabled };
  if (f.type === 'select') {
    const select = h(
      'select',
      common,
      (!f.required || value == null || value === '') && h('option', { value: '' }, f.placeholder ?? 'Selecione...'),
      (f.options ?? []).map((o) => h('option', { value: String(o.value) }, o.label)),
    );
    if (value != null) select.value = String(value);
    return select;
  }
  if (f.type === 'textarea') return h('textarea', { ...common, rows: f.rows ?? 3, placeholder: f.placeholder }, value ?? '');
  if (f.type === 'checkbox') return h('input', { id, name: f.name, type: 'checkbox', checked: !!value });

  let v = value ?? '';
  if (f.type === 'datetime-local' && value) v = toLocalInput(value);
  return h('input', {
    ...common,
    type: f.type ?? 'text',
    value: String(v),
    min: f.min,
    max: f.max,
    step: f.step,
    placeholder: f.placeholder,
    maxlength: f.maxlength,
    autocomplete: 'off',
  });
}
