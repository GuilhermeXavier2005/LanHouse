// Domínios (enums) compartilhados entre telas e a API.
// Os valores (chaves) são os que trafegam na API; os rótulos são só de exibição.

export const MACHINE_STATUS = {
  disponivel: { label: 'Disponível', tone: 'success' },
  em_uso: { label: 'Em uso', tone: 'primary' },
  manutencao: { label: 'Manutenção', tone: 'warning' },
  offline: { label: 'Offline', tone: 'offline' },
};

export const ZONES = {
  arena: { label: 'Arena Gamer', icon: 'gamepad' },
  vip: { label: 'Sala VIP', icon: 'crown' },
  navegacao: { label: 'Navegação & Serviços', icon: 'globe' },
};

export const SESSION_STATUS = {
  ativa: { label: 'Ativa', tone: 'primary' },
  encerrada: { label: 'Encerrada', tone: 'muted' },
  cancelada: { label: 'Cancelada', tone: 'danger' },
};

export const PAYMENT_STATUS = {
  pago: { label: 'Pago', tone: 'success' },
  pendente: { label: 'Pendente', tone: 'warning' },
  cancelado: { label: 'Cancelado', tone: 'danger' },
};

export const PAYMENT_METHODS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_debito: 'Cartão de débito',
  cartao_credito: 'Cartão de crédito',
};

export const INCIDENT_SEVERITY = {
  baixa: { label: 'Baixa', tone: 'info', rank: 1 },
  media: { label: 'Média', tone: 'warning', rank: 2 },
  alta: { label: 'Alta', tone: 'danger', rank: 3 },
  critica: { label: 'Crítica', tone: 'critical', rank: 4 },
};

export const INCIDENT_STATUS = {
  aberto: { label: 'Aberto', tone: 'danger' },
  em_andamento: { label: 'Em andamento', tone: 'warning' },
  resolvido: { label: 'Resolvido', tone: 'success' },
};

export const MAINTENANCE_TYPE = {
  preventiva: { label: 'Preventiva', tone: 'info' },
  corretiva: { label: 'Corretiva', tone: 'accent' },
};

export const MAINTENANCE_STATUS = {
  agendada: { label: 'Agendada', tone: 'info' },
  em_andamento: { label: 'Em andamento', tone: 'warning' },
  concluida: { label: 'Concluída', tone: 'success' },
};

export const PLAN_KIND = { plano: 'Plano de uso', servico: 'Serviço avulso' };
export const PLAN_BILLING = { hora: 'Por hora', pacote: 'Pacote', unidade: 'Por unidade' };

export const PROGRAM_CATEGORY = {
  jogo: { label: 'Jogo', tone: 'accent', icon: 'gamepad' },
  launcher: { label: 'Launcher', tone: 'primary', icon: 'rocket' },
  navegador: { label: 'Navegador', tone: 'info', icon: 'globe' },
  comunicacao: { label: 'Comunicação', tone: 'success', icon: 'chat' },
  produtividade: { label: 'Produtividade', tone: 'warning', icon: 'file' },
  utilitario: { label: 'Utilitário', tone: 'muted', icon: 'tool' },
};
export const PROGRAM_LICENSE = { gratuito: 'Gratuito', pago: 'Pago / assinatura' };

export const EVENT_TYPES = {
  session_started: { label: 'Sessão iniciada', tone: 'primary', icon: 'play' },
  session_ended: { label: 'Sessão encerrada', tone: 'muted', icon: 'stop' },
  state_changed: { label: 'Mudança de estado', tone: 'accent', icon: 'refresh' },
  program_started: { label: 'Programa executado', tone: 'info', icon: 'package' },
  error: { label: 'Erro', tone: 'danger', icon: 'alert' },
  diagnostic: { label: 'Diagnóstico', tone: 'warning', icon: 'wrench' },
  incident_opened: { label: 'Incidente aberto', tone: 'danger', icon: 'flag' },
};

export const DB_SOURCES = {
  postgres: { label: 'PostgreSQL', short: 'PostgreSQL', kind: 'Relacional · RDB', role: 'Cadastros, sessões e financeiro' },
  mongodb: { label: 'MongoDB', short: 'MongoDB', kind: 'Documental · DB1', role: 'Eventos e registros detalhados' },
  cassandra: { label: 'Apache Cassandra', short: 'Cassandra', kind: 'Colunas largas · DB2', role: 'Métricas técnicas (séries temporais)' },
};

/** Converte um mapa { valor: rótulo | {label} } em opções de <select>. */
export function toOptions(map) {
  return Object.entries(map).map(([value, v]) => ({ value, label: typeof v === 'string' ? v : v.label }));
}
