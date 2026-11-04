// Configuração do front-end.
// `useMock: true` usa a API simulada em js/api/mock (nenhum back-end necessário).
// Quando o back-end estiver pronto, troque para a API real na tela "Bancos & API"
// ou altere os valores padrão abaixo.

const STORAGE_KEY = 'lanhouse-config';

const defaults = {
  useMock: true,
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
