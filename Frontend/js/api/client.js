// Cliente HTTP único da aplicação. Todas as telas passam por aqui,
// então trocar mock ⇄ back-end real não exige mudar nenhuma tela.

import { config } from '../config.js';
import { ApiError } from './errors.js';
import { mockFetch } from './mock/server.js';

const warningListeners = new Set();

/**
 * Escritas podem ter sucesso parcial (ex.: sessão salva no PostgreSQL, mas o evento
 * não foi gravado no MongoDB). Nesses casos a API devolve `_warnings: string[]`.
 */
export function onWarnings(fn) {
  warningListeners.add(fn);
  return () => warningListeners.delete(fn);
}

function toQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function httpFetch(method, url, body) {
  let res;
  try {
    res = await fetch(config.apiBaseUrl.replace(/\/$/, '') + url, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError';
    throw new ApiError({
      code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: timeout ? 'A API demorou demais para responder.' : `Não foi possível conectar à API em ${config.apiBaseUrl}.`,
    });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError({
      status: res.status,
      code: e.code ?? `HTTP_${res.status}`,
      message: e.message ?? res.statusText,
      source: e.source ?? null,
      details: e.details ?? null,
    });
  }
  return data;
}

export async function request(method, path, { query, body } = {}) {
  const url = path + toQuery(query);
  const data = config.useMock ? await mockFetch(method, url, body) : await httpFetch(method, url, body);
  if (data && Array.isArray(data._warnings) && data._warnings.length) {
    warningListeners.forEach((fn) => fn(data._warnings));
  }
  return data;
}

export const get = (path, query) => request('GET', path, { query });
export const post = (path, body = {}) => request('POST', path, { body });
export const put = (path, body = {}) => request('PUT', path, { body });
export const patch = (path, body = {}) => request('PATCH', path, { body });
export const del = (path) => request('DELETE', path);
