// Mapa de endpoints da API REST. O contrato completo está em frontend/API.md.
// Comentários indicam qual banco é a fonte de cada recurso.

import { get, post, put, patch, del } from './client.js';

const crud = (base) => ({
  list: (query) => get(base, query),
  get: (id) => get(`${base}/${id}`),
  create: (body) => post(base, body),
  update: (id, body) => put(`${base}/${id}`, body),
  patch: (id, body) => patch(`${base}/${id}`, body),
  remove: (id) => del(`${base}/${id}`),
});

export const api = {
  health: () => get('/health'),

  // PostgreSQL (cadastro e estado atual) + rotas auxiliares de Mongo/Cassandra por máquina
  machines: {
    ...crud('/machines'),
    setStatus: (id, status, reason) => patch(`/machines/${id}/status`, { status, reason }),
    lastUser: (id) => get(`/machines/${id}/last-user`),
    programs: (id) => get(`/machines/${id}/programs`),
    setPrograms: (id, programIds) => put(`/machines/${id}/programs`, { program_ids: programIds }),
    metrics: (id, query) => get(`/machines/${id}/metrics`, query), // Cassandra
    latestMetrics: (id) => get(`/machines/${id}/metrics/latest`), // Cassandra
    events: (id, query) => get(`/machines/${id}/events`, query), // MongoDB
  },

  // Cassandra
  metrics: {
    latest: () => get('/metrics/latest'),
  },

  // PostgreSQL
  sessions: {
    list: (query) => get('/sessions', query),
    get: (id) => get(`/sessions/${id}`),
    start: (body) => post('/sessions', body),
    end: (id, body) => post(`/sessions/${id}/end`, body),
    patch: (id, body) => patch(`/sessions/${id}`, body),
  },
  users: crud('/users'),
  plans: crud('/plans'),
  programs: crud('/programs'),
  incidents: crud('/incidents'),
  maintenances: crud('/maintenances'),
  reports: {
    summary: () => get('/reports/summary'),
    revenue: (query) => get('/reports/revenue', query),
  },
  internet: {
    get: () => get('/internet-service'),
    update: (body) => put('/internet-service', body),
  },

  // MongoDB
  events: {
    list: (query) => get('/events', query),
    get: (id) => get(`/events/${id}`),
  },
};
