// Estado do mock, persistido no localStorage para sobreviver a recarregamentos.

import { createSeed } from './seed.js';

const DB_KEY = 'lanhouse-mock-db-v1';
const DOWN_KEY = 'lanhouse-mock-down';

let db = null;

export function getDb() {
  if (!db) {
    try {
      db = JSON.parse(localStorage.getItem(DB_KEY));
    } catch {
      db = null;
    }
    if (!db) {
      db = createSeed();
      persist();
    }
  }
  return db;
}

export function persist() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (err) {
    console.warn('[mock] não foi possível salvar no localStorage', err);
  }
}

export function resetDb() {
  db = createSeed();
  persist();
}

/** Bancos marcados como "fora do ar" na simulação de falhas. */
export function getDown() {
  try {
    return { postgres: false, mongodb: false, cassandra: false, ...JSON.parse(localStorage.getItem(DOWN_KEY) || '{}') };
  } catch {
    return { postgres: false, mongodb: false, cassandra: false };
  }
}

export function setDown(source, value) {
  const down = { ...getDown(), [source]: value };
  try {
    localStorage.setItem(DOWN_KEY, JSON.stringify(down));
  } catch {
    // ignora
  }
  return down;
}
