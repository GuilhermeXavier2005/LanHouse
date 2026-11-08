// Mini "hyperscript" para montar DOM sem framework.
//   h('button', { class: 'btn', onclick: fn }, 'Salvar')
// - chaves `on*` viram addEventListener
// - `class`, `style` (string ou objeto), `dataset` e `html` (innerHTML) têm tratamento especial
// - booleanos e valores não-string viram propriedades; o resto vira atributo

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'html') el.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (typeof value === 'boolean' || (key in el && typeof value !== 'string')) el[key] = value;
      else el.setAttribute(key, value);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

let counter = 0;
export const uid = (prefix = 'id') => `${prefix}-${++counter}`;

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function loadPref(key, fallback) {
  try {
    return localStorage.getItem(`lanhouse-pref:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(`lanhouse-pref:${key}`, value);
  } catch {
    // preferências são opcionais
  }
}
