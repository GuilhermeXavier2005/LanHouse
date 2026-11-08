from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.database.postgres import get_db_cursor
from app.services.event_logger import log_event
from app.pricing import calculate_session_amount
from app.errors import NotFoundError, ConflictError, ValidationError

router = APIRouter(prefix="/sessions", tags=["Sessões"])

def format_session(row: dict) -> dict:
    from app.routers.machines import map_zone_to_api
    return {
        "id": row["id"],
        "machine_id": row["maquina_id"],
        "user_id": row.get("usuario_id"),
        "plan_id": row.get("plano_id"),
        "started_at": row["inicio"].isoformat() if row.get("inicio") else None,
        "ended_at": row["fim"].isoformat() if row.get("fim") else None,
        "duration_minutes": row.get("duracao_minutos"),
        "amount": float(row["valor"]) if row.get("valor") is not None else None,
        "payment_method": row.get("metodo_pagamento"),
        "payment_status": row.get("status_pagamento") or "pendente",
        "status": row.get("status") or ("ativa" if not row.get("fim") else "encerrada"),
        "machine_hostname": row.get("machine_hostname") or f"#{row['maquina_id']}",
        "machine_zone": map_zone_to_api(row.get("machine_zone")),
        "user_name": row.get("user_name") or "Usuário",
        "user_nickname": row.get("user_nickname") or "—",
        "plan_name": row.get("plan_name") or "—",
        "plan_billing": row.get("plan_billing"),
        "plan_price": float(row["plan_price"]) if row.get("plan_price") is not None else None,
        "plan_hours": float(row["plan_hours"]) if row.get("plan_hours") is not None else None,
    }

class StartSessionBody(BaseModel):
    machine_id: int
    user_id: int
    plan_id: int

class EndSessionBody(BaseModel):
    payment_method: Optional[str] = None
    payment_status: Optional[str] = "pago"

class PatchSessionBody(BaseModel):
    payment_status: Optional[str] = None
    payment_method: Optional[str] = None

@router.get("")
def list_sessions(
    status: Optional[str] = None,
    payment_status: Optional[str] = None,
    machine_id: Optional[int] = None,
    user_id: Optional[int] = None,
    plan_id: Optional[int] = None,
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    q: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT s.*,
                   m.codigo as machine_hostname, m.grupo as machine_zone,
                   u.nome as user_name, u.nickname as user_nickname,
                   p.nome as plan_name, p.cobranca as plan_billing, p.preco as plan_price, p.horas as plan_hours
            FROM sessoes_uso s
            LEFT JOIN maquinas m ON m.id = s.maquina_id
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            LEFT JOIN planos p ON p.id = s.plano_id
            ORDER BY s.inicio DESC;
        """)
        rows = cur.fetchall()

    items = []
    total_paid = 0.0
    total_pending = 0.0

    for r in rows:
        sess = format_session(r)

        # Filtros
        if status and sess["status"] not in status.split(","):
            continue
        if payment_status and sess["payment_status"] not in payment_status.split(","):
            continue
        if machine_id and sess["machine_id"] != machine_id:
            continue
        if user_id and sess["user_id"] != user_id:
            continue
        if plan_id and sess["plan_id"] != plan_id:
            continue
        if from_date and sess["started_at"] and sess["started_at"] < from_date:
            continue
        if to_date and sess["started_at"] and sess["started_at"] > to_date:
            continue
        if q:
            term = q.lower()
            match = (
                term in sess["user_name"].lower()
                or term in sess["user_nickname"].lower()
                or term in sess["machine_hostname"].lower()
                or term in sess["plan_name"].lower()
            )
            if not match:
                continue

        # Totais acumulados
        amt = sess["amount"] or 0.0
        if sess["payment_status"] == "pago":
            total_paid += amt
        elif sess["status"] == "encerrada" and sess["payment_status"] == "pendente":
            total_pending += amt

        items.append(sess)

    total_count = len(items)
    if limit is not None:
        items = items[offset : offset + limit]

    return {
        "items": items,
        "total": total_count,
        "total_paid": round(total_paid, 2),
        "total_pending": round(total_pending, 2),
    }

@router.get("/{id}")
def get_session(id: int):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT s.*,
                   m.codigo as machine_hostname, m.grupo as machine_zone,
                   u.nome as user_name, u.nickname as user_nickname,
                   p.nome as plan_name, p.cobranca as plan_billing, p.preco as plan_price, p.horas as plan_hours
            FROM sessoes_uso s
            LEFT JOIN maquinas m ON m.id = s.maquina_id
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            LEFT JOIN planos p ON p.id = s.plano_id
            WHERE s.id = %s;
        """, (id,))
        row = cur.fetchone()
        if not row:
            raise NotFoundError("Sessão")
        return format_session(row)

@router.post("")
def start_session(body: StartSessionBody):
    with get_db_cursor() as cur:
        # 1. Valida máquina
        cur.execute("SELECT * FROM maquinas WHERE id = %s;", (body.machine_id,))
        m = cur.fetchone()
        if not m:
            raise ValidationError({"machine_id": "Máquina inexistente."})

        cur.execute("SELECT id FROM sessoes_uso WHERE maquina_id = %s AND fim IS NULL;", (body.machine_id,))
        if cur.fetchone() or m["status"] != "online":
            # se estiver offline ou manutenção ou já com sessão aberta
            motivo = "ocupada" if m["status"] == "online" else m["status"]
            raise ConflictError(f"{m.get('codigo')} não está disponível ({motivo}).")

        # 2. Valida usuário
        cur.execute("SELECT * FROM usuarios WHERE id = %s;", (body.user_id,))
        u = cur.fetchone()
        if not u:
            raise ValidationError({"user_id": "Usuário inexistente."})

        cur.execute("SELECT id FROM sessoes_uso WHERE usuario_id = %s AND fim IS NULL;", (body.user_id,))
        if cur.fetchone():
            raise ConflictError(f"@{u.get('nickname')} já está em uma sessão ativa.")

        # 3. Valida plano
        cur.execute("SELECT * FROM planos WHERE id = %s;", (body.plan_id,))
        p = cur.fetchone()
        if not p or p.get("tipo") != "plano" or not p.get("ativo"):
            raise ValidationError({"plan_id": "Escolha um plano de uso ativo."})

        # Cria sessão ativa
        cur.execute("""
            INSERT INTO sessoes_uso (maquina_id, usuario_id, plano_id, inicio, fim, status, status_pagamento)
            VALUES (%s, %s, %s, NOW(), NULL, 'ativa', 'pendente')
            RETURNING id;
        """, (body.machine_id, body.user_id, body.plan_id))
        sess_id = cur.fetchone()["id"]

    warnings = []
    # Grava eventos no MongoDB
    log_event(
        event_type="session_started",
        machine_id=body.machine_id,
        machine_hostname=m.get("codigo"),
        session_id=sess_id,
        payload={
            "session_id": sess_id,
            "user_id": u["id"],
            "user_nickname": u["nickname"],
            "plan_id": p["id"],
            "plan_name": p["nome"],
        },
        warnings=warnings,
    )
    log_event(
        event_type="state_changed",
        machine_id=body.machine_id,
        machine_hostname=m.get("codigo"),
        session_id=sess_id,
        payload={"from": "disponivel", "to": "em_uso", "reason": "Início de sessão"},
        warnings=warnings,
    )

    res = get_session(sess_id)
    if warnings:
        res["_warnings"] = warnings
    return res

@router.post("/{id}/end")
def end_session(id: int, body: EndSessionBody):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT s.*, p.cobranca, p.preco, p.horas, m.codigo as machine_hostname, u.nickname as user_nickname
            FROM sessoes_uso s
            LEFT JOIN planos p ON p.id = s.plano_id
            LEFT JOIN maquinas m ON m.id = s.maquina_id
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.id = %s;
        """, (id,))
        s = cur.fetchone()
        if not s:
            raise NotFoundError("Sessão")
        if s.get("status") == "encerrada" or s.get("fim") is not None:
            raise ConflictError("Esta sessão já foi encerrada.")

        # Cálculo de tempo
        now_dt = datetime.now(timezone.utc)
        inicio_dt = s["inicio"]
        if inicio_dt.tzinfo is None:
            inicio_dt = inicio_dt.replace(tzinfo=timezone.utc)

        duration_sec = (now_dt - inicio_dt).total_seconds()
        duration_minutes = max(1, round(duration_sec / 60))

        plan_dict = {
            "billing": s.get("cobranca"),
            "price": s.get("preco"),
            "hours": s.get("horas"),
        }
        amount = calculate_session_amount(plan_dict, duration_minutes)

        pay_status = body.payment_status or "pago"
        pay_method = body.payment_method

        cur.execute("""
            UPDATE sessoes_uso
            SET fim = NOW(),
                duracao_minutos = %s,
                valor = %s,
                metodo_pagamento = %s,
                status_pagamento = %s,
                status = 'encerrada'
            WHERE id = %s;
        """, (duration_minutes, amount, pay_method, pay_status, id))

    warnings = []
    # Eventos no MongoDB
    log_event(
        event_type="session_ended",
        machine_id=s["maquina_id"],
        machine_hostname=s.get("machine_hostname"),
        session_id=id,
        payload={
            "session_id": id,
            "user_nickname": s.get("user_nickname"),
            "duration_minutes": duration_minutes,
            "amount": amount,
        },
        warnings=warnings,
    )
    log_event(
        event_type="state_changed",
        machine_id=s["maquina_id"],
        machine_hostname=s.get("machine_hostname"),
        session_id=id,
        payload={"from": "em_uso", "to": "disponivel", "reason": "Fim de sessão"},
        warnings=warnings,
    )

    res = get_session(id)
    if warnings:
        res["_warnings"] = warnings
    return res

@router.patch("/{id}")
def patch_session(id: int, body: PatchSessionBody):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM sessoes_uso WHERE id = %s;", (id,))
        s = cur.fetchone()
        if not s:
            raise NotFoundError("Sessão")
        if s.get("status") != "encerrada":
            raise ConflictError("Só é possível alterar o pagamento de sessões encerradas.")

        updates = []
        params = []
        if body.payment_status is not None:
            updates.append("status_pagamento = %s")
            params.append(body.payment_status)
        if body.payment_method is not None:
            updates.append("metodo_pagamento = %s")
            params.append(body.payment_method)

        if updates:
            params.append(id)
            cur.execute(f"UPDATE sessoes_uso SET {', '.join(updates)} WHERE id = %s;", tuple(params))

    return get_session(id)
