import math

BILLING_BLOCK_MIN = 15

def round2(val: float) -> float:
    return round(val + 1e-9, 2)

def calculate_session_amount(plan: dict, minutes: int) -> float:
    """
    Regra de cobrança oficial da LanHouse:
    - Blocos de 15 minutos (mínimo de 1 bloco para plano por hora).
    - Plano 'hora': ceil(minutos / 15) * (15 / 60) * preco
    - Plano 'pacote': preco fixo + excedente calculado pela taxa horária do pacote
    - Outros: preco fixo
    """
    if not plan:
        return 0.0

    m = max(0, minutes)
    blocks = lambda mins: math.ceil(mins / BILLING_BLOCK_MIN)
    billing = plan.get("billing") or plan.get("cobranca")
    price = float(plan.get("price") or plan.get("preco") or 0.0)
    hours = float(plan.get("hours") or plan.get("horas") or 0.0)

    if billing == "pacote":
        included = hours * 60
        hourly = (price / hours) if hours > 0 else price
        extra_minutes = max(0, m - included)
        extra = blocks(extra_minutes) * (BILLING_BLOCK_MIN / 60.0) * hourly
        return round2(price + extra)

    if billing == "hora":
        return round2(max(1, blocks(m)) * (BILLING_BLOCK_MIN / 60.0) * price)

    return round2(price)
