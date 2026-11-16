// Configuração do front-end.
// Padrão: API real do back-end FastAPI (http://localhost:8000/api), ligada aos
// três bancos (PostgreSQL, MongoDB e Cassandra).
// `useMock: true` usa a API simulada em js/api/mock (sem back-end, dados só no navegador).
// A escolha pode ser trocada na tela "Bancos & API" e fica salva no navegador.

const STORAGE_KEY = 'lanhouse-config';

const defaults = {
  useMock: false,
  apiBaseUrl: 'http://localhost:8000/api',
  timeoutMs: 8000,
  pollMs: 5000,
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export const config = load();

export function saveConfig(patch) {
  Object.assign(config, patch);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ useMock: config.useMock, apiBaseUrl: config.apiBaseUrl }));
  } catch {
    // armazenamento indisponível: a configuração vale só para esta aba
  }
}
