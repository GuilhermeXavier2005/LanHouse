// Gráficos leves em SVG/HTML, sem dependências.

import { h, uid, esc } from './dom.js';
import { empty } from './components.js';

const PAD = { l: 44, r: 14, t: 12, b: 26 };

export function levelColor(v, [warn, danger] = [65, 85]) {
  if (v == null) return 'var(--muted)';
  return v >= danger ? 'var(--danger)' : v >= warn ? 'var(--warning)' : 'var(--primary)';
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function medianStep(times) {
  const d = [];
  for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] || 60_000;
}

function nearest(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[lo] - t) <= Math.abs(times[hi] - t) ? lo : hi;
}

/** Quebra a linha onde não há dado ou onde há um buraco no tempo (máquina sem comunicação). */
function segments(points, step) {
  const out = [];
  let cur = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const gap = i > 0 && p.t - points[i - 1].t > step * 2.5;
    if (p.v == null || gap) {
      if (cur.length) out.push(cur);
      cur = [];
    }
    if (p.v != null) cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

const two = (n) => String(n).padStart(2, '0');
function timeLabel(t, span) {
  const d = new Date(t);
  return span <= 36 * 3600e3 ? `${two(d.getHours())}:${two(d.getMinutes())}` : `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
}
const fullTime = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Gráfico de linhas temporal com área e tooltip.
 * series: [{ name, color, points: [{ t: ms, v: number|null }] }] — todas com os mesmos instantes.
 */
export function lineChart({ series, height = 190, yMin = 0, yMax, format = (v) => String(Math.round(v)) }) {
  const root = h('div', { class: 'chart-wrap' });
  const values = series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => v != null);
  if (!values.length) {
    root.append(empty('Sem dados no período selecionado.', 'activity'));
    return root;
  }
  const times = series[0].points.map((p) => p.t);
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const span = t1 - t0 || 1;
  const max = yMax ?? niceMax(Math.max(...values) * 1.1);
  const step = medianStep(times);
  const gid = uid('grad');

  const area = h('div', { class: 'chart', style: `height:${height}px` });
  const svgHost = h('div');
  const cross = h('div', { class: 'chart-cross' });
  const tip = h('div', { class: 'chart-tip' });
  area.append(svgHost, cross, tip);
  root.append(
    h('div', { class: 'chart-legend' }, series.map((s) => h('span', {}, h('i', { class: 'swatch', style: `background:${s.color}` }), s.name))),
    area,
  );

  let geom = null;
  function draw() {
    const W = area.clientWidth;
    if (!W) return;
    const H = height;
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (t) => PAD.l + ((t - t0) / span) * iw;
    const y = (v) => PAD.t + ih - ((Math.min(v, max) - yMin) / (max - yMin)) * ih;
    geom = { x, iw, W };

    let s = `<svg width="${W}" height="${H}" aria-hidden="true"><defs>`;
    series.forEach((se, i) => {
      s += `<linearGradient id="${gid}-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity=".26"/><stop offset="1" stop-color="${se.color}" stop-opacity="0"/></linearGradient>`;
    });
    s += '</defs>';
    for (let i = 0; i <= 4; i++) {
      const v = yMin + ((max - yMin) * i) / 4;
      const yy = y(v).toFixed(1);
      s += `<line class="grid-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}"/><text x="${PAD.l - 8}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end">${esc(format(v))}</text>`;
    }
    const ticks = Math.max(2, Math.min(6, Math.floor(iw / 110)));
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + (span * i) / ticks;
      const anchor = i === 0 ? 'start' : i === ticks ? 'end' : 'middle';
      s += `<text x="${x(t).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${timeLabel(t, span)}</text>`;
    }
    const base = (PAD.t + ih).toFixed(1);
    series.forEach((se, i) => {
      for (const seg of segments(se.points, step)) {
        const line = seg.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
        s += `<path d="${line}L${x(seg.at(-1).t).toFixed(1)},${base}L${x(seg[0].t).toFixed(1)},${base}Z" fill="url(#${gid}-${i})"/>`;
        s += `<path d="${line}" fill="none" stroke="${se.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
    });
    svgHost.innerHTML = `${s}</svg>`;
  }

  area.addEventListener('mousemove', (e) => {
    if (!geom) return;
    const px = e.clientX - area.getBoundingClientRect().left;
    const idx = nearest(times, t0 + ((px - PAD.l) / geom.iw) * span);
    const cx = geom.x(times[idx]);
    cross.style.display = 'block';
    cross.style.left = `${cx}px`;
    tip.replaceChildren(
      h('div', { class: 'tip-time' }, fullTime(times[idx])),
      ...series.map((se) => {
        const v = se.points[idx]?.v;
        return h('div', { class: 'tip-row' }, h('i', { class: 'swatch', style: `background:${se.color}` }), se.name, h('strong', {}, v == null ? '—' : format(v)));
      }),
    );
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    tip.style.left = `${cx + 14 + tw > geom.W ? cx - tw - 14 : cx + 14}px`;
    tip.style.top = `${PAD.t}px`;
  });
  area.addEventListener('mouseleave', () => {
    cross.style.display = 'none';
    tip.style.display = 'none';
  });

  new ResizeObserver(draw).observe(area);
  return root;
}

/** Barras verticais em HTML. items: [{ label, value, title?, highlight? }] */
export function barChart({ items, format = String, height = 170 }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return h(
    'div',
    { class: 'bars', style: `height:${height}px` },
    items.map((i) =>
      h(
        'div',
        { class: `bar-col${i.highlight ? ' highlight' : ''}`, title: i.title ?? `${i.label}: ${format(i.value)}` },
        h('span', { class: 'bar-val' }, format(i.value)),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `height:${(i.value / max) * 100}%` })),
        h('span', { class: 'bar-label' }, i.label),
      ),
    ),
  );
}

/** Medidor circular. */
export function gauge({ value, label, max = 100, unit = '%', sub, thresholds = [65, 85] }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const color = levelColor(value == null ? null : (value / max) * 100, thresholds);
  const text = value == null ? '—' : `${Math.round(value)}${unit}`;
  return h('div', {
    class: 'gauge',
    html:
      `<svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="${esc(label)}: ${esc(text)}">` +
      `<circle cx="48" cy="48" r="${r}" fill="none" class="gauge-track" stroke-width="7"/>` +
      `<circle cx="48" cy="48" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 48 48)" style="filter:drop-shadow(0 0 5px ${color});transition:stroke-dasharray .5s"/>` +
      `<text x="48" y="54" text-anchor="middle" class="gauge-text">${esc(text)}</text></svg>` +
      `<div class="gauge-label">${esc(label)}</div>${sub ? `<div class="gauge-sub">${esc(sub)}</div>` : ''}`,
  });
}
