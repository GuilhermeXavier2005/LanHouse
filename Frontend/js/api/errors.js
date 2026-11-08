import { DB_SOURCES } from '../constants.js';

/**
 * Erro padronizado da API. O back-end deve responder erros no formato:
 *   { "error": { "code": "DB_UNAVAILABLE", "message": "...", "source": "cassandra", "details": {...} } }
 * `source` indica qual banco falhou (postgres | mongodb | cassandra), quando for o caso.
 */
export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN', message = 'Erro inesperado.', source = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.source = source;
    this.details = details;
  }

  get isDbUnavailable() {
    return this.code === 'DB_UNAVAILABLE';
  }
}

export function errorTitle(err) {
  if (err?.source && DB_SOURCES[err.source]) return `${DB_SOURCES[err.source].label} indisponível`;
  switch (err?.code) {
    case 'NETWORK_ERROR': return 'API inacessível';
    case 'TIMEOUT': return 'Tempo de resposta esgotado';
    case 'NOT_FOUND': return 'Registro não encontrado';
    case 'CONFLICT': return 'Operação não permitida';
    case 'VALIDATION_ERROR': return 'Dados inválidos';
    default: return 'Algo deu errado';
  }
}
