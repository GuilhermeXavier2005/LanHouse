// Regra de cobrança das sessões. O back-end é a fonte oficial do valor final;
// o front usa a mesma regra apenas para mostrar o valor estimado das sessões ativas.

import { money } from './format.js';

/** Cobrança por blocos de 15 minutos. */
export const BILLING_BLOCK_MIN = 15;

const round2 = (v) => Math.round(v * 100) / 100;

export function sessionAmount(plan, minutes) {
  if (!plan) return 0;
  const m = Math.max(0, minutes);
  const blocks = (mins) => Math.ceil(mins / BILLING_BLOCK_MIN);

  if (plan.billing === 'pacote') {
    // Pacote: valor fixo; o excedente é cobrado pelo valor/hora do próprio pacote.
    const included = (plan.hours || 0) * 60;
    const hourly = plan.hours ? plan.price / plan.hours : plan.price;
    const extra = blocks(Math.max(0, m - included)) * (BILLING_BLOCK_MIN / 60) * hourly;
    return round2(plan.price + extra);
  }
  if (plan.billing === 'hora') {
    return round2(Math.max(1, blocks(m)) * (BILLING_BLOCK_MIN / 60) * plan.price);
  }
  return round2(plan.price);
}

export function priceSuffix(plan) {
  if (plan.billing === 'hora') return '/ hora';
  if (plan.billing === 'pacote') return `· ${plan.hours ?? '?'}h`;
  return '/ unidade';
}

export const planPriceLabel = (plan) => `${money(plan.price)} ${priceSuffix(plan)}`;
