// Formatadores de exibição (pt-BR).

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const money = (v) => (v == null ? '—' : brl.format(v));

export const num = (v, digits = 0) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);

const parse = (iso) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);

export const date = (iso) => (iso ? parse(iso).toLocaleDateString('pt-BR') : '—');

export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function relative(iso) {
  if (!iso) return '—';
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const future = diff < 0;
  const s = Math.abs(diff);
  let text;
  if (s < 10) return 'agora';
  if (s < 60) text = `${s} s`;
  else if (s < 3600) text = `${Math.floor(s / 60)} min`;
  else if (s < 86400) text = `${Math.floor(s / 3600)} h`;
  else text = `${Math.floor(s / 86400)} d`;
  return future ? `em ${text}` : `há ${text}`;
}

/** Duração a partir de minutos: "1h 05min" / "42 min". */
export function duration(minutes) {
  if (minutes == null) return '—';
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}min` : `${m} min`;
}

/** Cronômetro a partir de milissegundos: "01:23:45". */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':');
}

export const kbps = (v) => (v == null ? '—' : v >= 1000 ? `${num(v / 1000, 1)} Mbps` : `${num(v)} kbps`);

export const storage = (gb) => (gb == null ? '—' : gb >= 1000 ? `${num(gb / 1000, gb % 1000 ? 1 : 0)} TB` : `${gb} GB`);

/** ISO → valor de <input type="datetime-local"> no fuso local. */
export function toLocalInput(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Chave de dia local "AAAA-MM-DD". */
export function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
}
