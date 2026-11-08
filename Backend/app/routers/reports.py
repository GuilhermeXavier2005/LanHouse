from datetime import datetime, date, timedelta, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel

from app.database.postgres import get_db_cursor
from app.errors import NotFoundError, ValidationError

router = APIRouter(tags=["Relatórios e Internet"])

@router.get("/reports/summary")
def get_summary():
    today = date.today().isoformat()

    with get_db_cursor() as cur:
        # Sessões iniciadas hoje
        cur.execute("SELECT COUNT(*) AS cnt FROM sessoes_uso WHERE inicio::date = CURRENT_DATE;")
        sessions_today = int(cur.fetchone()["cnt"] or 0)

        # Sessões ativas agora
        cur.execute("SELECT COUNT(*) AS cnt FROM sessoes_uso WHERE fim IS NULL;")
        active_sessions = int(cur.fetchone()["cnt"] or 0)

        # Faturamento de hoje (sessões pagas encerradas hoje)
        cur.execute("""
            SELECT COALESCE(SUM(valor), 0.0) AS rev
            FROM sessoes_uso
            WHERE fim::date = CURRENT_DATE AND status_pagamento = 'pago';
        """)
        revenue_today = float(cur.fetchone()["rev"] or 0.0)

        # Duração média das sessões encerradas hoje
        cur.execute("""
            SELECT AVG(duracao_minutos) AS avg_dur
            FROM sessoes_uso
            WHERE fim::date = CURRENT_DATE AND fim IS NOT NULL;
        """)
        avg_row = cur.fetchone()
        avg_dur = round(float(avg_row["avg_dur"])) if avg_row and avg_row["avg_dur"] is not None else None

        # Valor pendente de sessões encerradas
        cur.execute("""
            SELECT COALESCE(SUM(valor), 0.0) AS pending
            FROM sessoes_uso
            WHERE fim IS NOT NULL AND status_pagamento = 'pendente';
        """)
        pending_amount = float(cur.fetchone()["pending"] or 0.0)

    return {
        "date": today,
        "sessions_today": sessions_today,
        "active_sessions": active_sessions,
        "revenue_today": round(revenue_today, 2),
        "pending_amount": round(pending_amount, 2),
        "avg_duration_minutes": avg_dur,
    }

@router.get("/reports/revenue")
def get_revenue(days: int = 7):
    days = min(90, max(1, days))
    today = date.today()

    # Cria dicionário para todos os dias do período
    buckets = {}
    for i in range(days - 1, -1, -1):
        d_str = (today - timedelta(days=i)).isoformat()
        buckets[d_str] = {"total": 0.0, "sessions": 0}

    with get_db_cursor() as cur:
        cur.execute("""
            SELECT fim::date as dt, COUNT(*) as qtd, SUM(valor) as total
            FROM sessoes_uso
            WHERE fim IS NOT NULL AND status_pagamento = 'pago' AND fim::date >= CURRENT_DATE - %s
            GROUP BY fim::date;
        """, (days,))
        rows = cur.fetchall()

    for r in rows:
        d_str = str(r["dt"])
        if d_str in buckets:
            buckets[d_str]["total"] = round(float(r["total"] or 0.0), 2)
            buckets[d_str]["sessions"] = int(r["qtd"] or 0)

    items = [{"date": d, "total": v["total"], "sessions": v["sessions"]} for d, v in buckets.items()]
    return {"items": items}

class InternetServiceUpdate(BaseModel):
    provider: str
    plan_name: Optional[str] = ""
    download_mbps: int
    upload_mbps: int
    monthly_cost: Optional[float] = 0.0
    contract_start: Optional[str] = None
    public_ip: Optional[str] = None
    static_ip: Optional[bool] = True
    support_phone: Optional[str] = None

@router.get("/internet-service")
def get_internet_service():
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM contratos_internet ORDER BY id ASC LIMIT 1;")
        row = cur.fetchone()
        if not row:
            return {
                "provider": "FibraMax Telecom",
                "plan_name": "Empresarial 1 Giga",
                "download_mbps": 1000,
                "upload_mbps": 500,
                "monthly_cost": 449.9,
                "contract_start": "2025-03-01",
                "public_ip": "200.155.32.18",
                "static_ip": True,
                "support_phone": "0800 000 1234",
            }
        return {
            "provider": row["provedor"],
            "plan_name": row["identificacao"] or "",
            "download_mbps": row["velocidade_mbps"] or 600,
            "upload_mbps": row.get("upload_mbps") or 300,
            "monthly_cost": float(row.get("valor_mensal") or 0.0),
            "contract_start": str(row["inicio_vigencia"]) if row.get("inicio_vigencia") else None,
            "public_ip": row.get("ip_publico") or "200.155.32.18",
            "static_ip": bool(row.get("ip_fixo", True)),
            "support_phone": row.get("telefone_suporte") or "0800 000 1234",
        }

@router.put("/internet-service")
def update_internet_service(data: InternetServiceUpdate):
    if data.download_mbps < 1:
        raise ValidationError({"download_mbps": "Valor mínimo: 1."})
    if data.upload_mbps < 1:
        raise ValidationError({"upload_mbps": "Valor mínimo: 1."})

    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM contratos_internet ORDER BY id ASC LIMIT 1;")
        row = cur.fetchone()
        if row:
            cur.execute("""
                UPDATE contratos_internet
                SET provedor = %s, identificacao = %s, velocidade_mbps = %s, upload_mbps = %s,
                    valor_mensal = %s, inicio_vigencia = %s, ip_publico = %s, ip_fixo = %s, telefone_suporte = %s
                WHERE id = %s;
            """, (
                data.provider,
                data.plan_name,
                data.download_mbps,
                data.upload_mbps,
                data.monthly_cost,
                data.contract_start or None,
                data.public_ip,
                data.static_ip,
                data.support_phone,
                row["id"],
            ))
        else:
            cur.execute("""
                INSERT INTO contratos_internet (provedor, identificacao, velocidade_mbps, upload_mbps, valor_mensal, inicio_vigencia, ip_publico, ip_fixo, telefone_suporte)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
            """, (
                data.provider,
                data.plan_name,
                data.download_mbps,
                data.upload_mbps,
                data.monthly_cost,
                data.contract_start or None,
                data.public_ip,
                data.static_ip,
                data.support_phone,
            ))
    return get_internet_service()
