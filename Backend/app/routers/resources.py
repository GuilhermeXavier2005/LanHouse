from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel

from app.database.postgres import get_db_cursor
from app.services.event_logger import log_event
from app.errors import NotFoundError, ConflictError, ValidationError

router = APIRouter(tags=["Cadastros"])

# ==============================================================================
# USUÁRIOS (/users)
# ==============================================================================

class UserCreate(BaseModel):
    name: str
    nickname: str
    phone: Optional[str] = None

class UserPatch(BaseModel):
    name: Optional[str] = None
    nickname: Optional[str] = None
    phone: Optional[str] = None

@router.get("/users")
def list_users(q: Optional[str] = None, limit: Optional[int] = None, offset: int = 0):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT u.id, u.nome as name, u.nickname, u.telefone as phone, u.criado_em as created_at,
                   COUNT(s.id) as sessions_count,
                   MAX(s.inicio) as last_session_at,
                   BOOL_OR(s.fim IS NULL AND s.id IS NOT NULL) as in_session
            FROM usuarios u
            LEFT JOIN sessoes_uso s ON s.usuario_id = u.id
            GROUP BY u.id
            ORDER BY u.nome ASC;
        """)
        rows = cur.fetchall()

    items = []
    for r in rows:
        item = {
            "id": r["id"],
            "name": r["name"],
            "nickname": r["nickname"],
            "phone": r["phone"],
            "sessions_count": int(r["sessions_count"] or 0),
            "last_session_at": r["last_session_at"].isoformat() if r["last_session_at"] else None,
            "in_session": bool(r["in_session"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        if q:
            term = q.lower()
            if term not in item["name"].lower() and term not in item["nickname"].lower() and term not in (item["phone"] or "").lower():
                continue
        items.append(item)

    total = len(items)
    if limit is not None:
        items = items[offset : offset + limit]
    return {"items": items, "total": total}

@router.get("/users/{id}")
def get_user(id: int):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT u.id, u.nome as name, u.nickname, u.telefone as phone, u.criado_em as created_at,
                   COUNT(s.id) as sessions_count,
                   MAX(s.inicio) as last_session_at,
                   BOOL_OR(s.fim IS NULL AND s.id IS NOT NULL) as in_session
            FROM usuarios u
            LEFT JOIN sessoes_uso s ON s.usuario_id = u.id
            WHERE u.id = %s
            GROUP BY u.id;
        """, (id,))
        r = cur.fetchone()
        if not r:
            raise NotFoundError("Usuário")
        return {
            "id": r["id"],
            "name": r["name"],
            "nickname": r["nickname"],
            "phone": r["phone"],
            "sessions_count": int(r["sessions_count"] or 0),
            "last_session_at": r["last_session_at"].isoformat() if r["last_session_at"] else None,
            "in_session": bool(r["in_session"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }

@router.post("/users")
def create_user(data: UserCreate):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM usuarios WHERE LOWER(nickname) = LOWER(%s);", (data.nickname.strip(),))
        if cur.fetchone():
            raise ValidationError({"nickname": "Apelido já está em uso."})

        cur.execute("""
            INSERT INTO usuarios (nome, nickname, telefone)
            VALUES (%s, %s, %s)
            RETURNING id;
        """, (data.name.strip(), data.nickname.strip(), data.phone))
        new_id = cur.fetchone()["id"]

    return get_user(new_id)

@router.put("/users/{id}")
@router.patch("/users/{id}")
def update_user(id: int, data: UserPatch):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM usuarios WHERE id = %s;", (id,))
        current = cur.fetchone()
        if not current:
            raise NotFoundError("Usuário")

        name = data.name.strip() if data.name is not None else current["nome"]
        nickname = data.nickname.strip() if data.nickname is not None else current["nickname"]
        phone = data.phone if data.phone is not None else current["telefone"]

        cur.execute("SELECT id FROM usuarios WHERE LOWER(nickname) = LOWER(%s) AND id != %s;", (nickname, id))
        if cur.fetchone():
            raise ValidationError({"nickname": "Apelido já está em uso."})

        cur.execute("""
            UPDATE usuarios
            SET nome = %s, nickname = %s, telefone = %s
            WHERE id = %s;
        """, (name, nickname, phone, id))

    return get_user(id)

@router.delete("/users/{id}")
def delete_user(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM usuarios WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Usuário")

        cur.execute("SELECT id FROM sessoes_uso WHERE usuario_id = %s AND fim IS NULL;", (id,))
        if cur.fetchone():
            raise ConflictError("Usuário está em uma sessão ativa.")

        cur.execute("DELETE FROM usuarios WHERE id = %s;", (id,))
    return None

# ==============================================================================
# PLANOS (/plans)
# ==============================================================================

class PlanCreate(BaseModel):
    name: str
    kind: str  # plano | servico
    billing: str  # hora | pacote | unidade
    price: float
    hours: Optional[float] = None
    description: Optional[str] = ""
    active: Optional[bool] = True

class PlanPatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    billing: Optional[str] = None
    price: Optional[float] = None
    hours: Optional[float] = None
    description: Optional[str] = None
    active: Optional[bool] = None

def format_plan(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["nome"],
        "kind": row["tipo"],
        "billing": row["cobranca"],
        "price": float(row["preco"]),
        "hours": float(row["horas"]) if row.get("horas") is not None else None,
        "description": row.get("descricao") or "",
        "active": bool(row["ativo"]),
        "created_at": row["criado_em"].isoformat() if row.get("criado_em") else None,
    }

@router.get("/plans")
def list_plans(
    kind: Optional[str] = None,
    billing: Optional[str] = None,
    active: Optional[bool] = None,
    q: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM planos ORDER BY id ASC;")
        rows = cur.fetchall()

    items = []
    for r in rows:
        p = format_plan(r)
        if kind and p["kind"] not in kind.split(","):
            continue
        if billing and p["billing"] not in billing.split(","):
            continue
        if active is not None and p["active"] != active:
            continue
        if q:
            term = q.lower()
            if term not in p["name"].lower() and term not in (p["description"] or "").lower():
                continue
        items.append(p)

    total = len(items)
    if limit is not None:
        items = items[offset : offset + limit]
    return {"items": items, "total": total}

@router.get("/plans/{id}")
def get_plan(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM planos WHERE id = %s;", (id,))
        r = cur.fetchone()
        if not r:
            raise NotFoundError("Plano")
        return format_plan(r)

@router.post("/plans")
def create_plan(data: PlanCreate):
    if data.billing == "pacote" and not (data.hours and data.hours > 0):
        raise ValidationError({"hours": "Informe as horas do pacote."}, "Pacotes precisam da quantidade de horas.")

    with get_db_cursor() as cur:
        cur.execute("""
            INSERT INTO planos (nome, tipo, cobranca, preco, horas, descricao, ativo)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id;
        """, (data.name, data.kind, data.billing, data.price, data.hours, data.description, data.active))
        new_id = cur.fetchone()["id"]

    return get_plan(new_id)

@router.put("/plans/{id}")
@router.patch("/plans/{id}")
def update_plan(id: int, data: PlanPatch):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM planos WHERE id = %s;", (id,))
        current = cur.fetchone()
        if not current:
            raise NotFoundError("Plano")

        name = data.name if data.name is not None else current["nome"]
        kind = data.kind if data.kind is not None else current["tipo"]
        billing = data.billing if data.billing is not None else current["cobranca"]
        price = data.price if data.price is not None else float(current["preco"])
        hours = data.hours if data.hours is not None else (float(current["horas"]) if current.get("horas") is not None else None)
        description = data.description if data.description is not None else current.get("descricao")
        active = data.active if data.active is not None else bool(current["ativo"])

        if billing == "pacote" and not (hours and hours > 0):
            raise ValidationError({"hours": "Informe as horas do pacote."}, "Pacotes precisam da quantidade de horas.")

        cur.execute("""
            UPDATE planos
            SET nome = %s, tipo = %s, cobranca = %s, preco = %s, horas = %s, descricao = %s, ativo = %s
            WHERE id = %s;
        """, (name, kind, billing, price, hours, description, active, id))

    return get_plan(id)

@router.delete("/plans/{id}")
def delete_plan(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM planos WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Plano")

        cur.execute("SELECT id FROM sessoes_uso WHERE plano_id = %s AND fim IS NULL;", (id,))
        if cur.fetchone():
            raise ConflictError("Há sessões ativas usando este plano. Desative-o em vez de excluir.")

        cur.execute("DELETE FROM planos WHERE id = %s;", (id,))
    return None

# ==============================================================================
# PROGRAMAS (/programs)
# ==============================================================================

class ProgramCreate(BaseModel):
    name: str
    category: str
    publisher: Optional[str] = ""
    version: Optional[str] = ""
    license: Optional[str] = "gratuito"

class ProgramPatch(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    publisher: Optional[str] = None
    version: Optional[str] = None
    license: Optional[str] = None

def format_program(row: dict) -> dict:
    cat = row["categoria"].lower() if row.get("categoria") else "utilitario"
    if cat in ["jogos", "jogo"]:
        cat = "jogo"
    elif cat in ["navegadores", "navegador"]:
        cat = "navegador"
    elif cat in ["desenvolvimento", "produtividade"]:
        cat = "produtividade"
    elif cat in ["comunicacao"]:
        cat = "comunicacao"
    elif cat in ["launcher"]:
        cat = "launcher"
    else:
        cat = "utilitario"

    return {
        "id": row["id"],
        "name": row["nome"],
        "category": cat,
        "publisher": row.get("fabricante") or "",
        "version": row.get("versao") or "",
        "license": row.get("licenca") or "gratuito",
        "machines_count": int(row.get("machines_count") or 0),
    }

@router.get("/programs")
def list_programs(
    category: Optional[str] = None,
    license: Optional[str] = None,
    q: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT s.*, COUNT(ms.maquina_id) as machines_count
            FROM softwares s
            LEFT JOIN maquina_software ms ON ms.software_id = s.id
            GROUP BY s.id
            ORDER BY s.nome ASC;
        """)
        rows = cur.fetchall()

    items = []
    for r in rows:
        p = format_program(r)
        if category and p["category"] not in category.split(","):
            continue
        if license and p["license"] not in license.split(","):
            continue
        if q:
            term = q.lower()
            if term not in p["name"].lower() and term not in (p["publisher"] or "").lower():
                continue
        items.append(p)

    total = len(items)
    if limit is not None:
        items = items[offset : offset + limit]
    return {"items": items, "total": total}

@router.get("/programs/{id}")
def get_program(id: int):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT s.*, COUNT(ms.maquina_id) as machines_count
            FROM softwares s
            LEFT JOIN maquina_software ms ON ms.software_id = s.id
            WHERE s.id = %s
            GROUP BY s.id;
        """, (id,))
        r = cur.fetchone()
        if not r:
            raise NotFoundError("Programa")
        return format_program(r)

@router.post("/programs")
def create_program(data: ProgramCreate):
    with get_db_cursor() as cur:
        cur.execute(
            "SELECT id FROM softwares WHERE LOWER(nome) = LOWER(%s) AND COALESCE(versao, '') = COALESCE(%s, '');",
            (data.name.strip(), data.version),
        )
        if cur.fetchone():
            raise ValidationError({"name": "Já existe este programa com a mesma versão."})

        cur.execute("""
            INSERT INTO softwares (nome, versao, categoria, fabricante, licenca)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id;
        """, (data.name.strip(), data.version, data.category, data.publisher, data.license))
        new_id = cur.fetchone()["id"]
    return get_program(new_id)

@router.put("/programs/{id}")
@router.patch("/programs/{id}")
def update_program(id: int, data: ProgramPatch):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM softwares WHERE id = %s;", (id,))
        current = cur.fetchone()
        if not current:
            raise NotFoundError("Programa")

        name = data.name.strip() if data.name is not None else current["nome"]
        version = data.version if data.version is not None else current.get("versao")
        category = data.category if data.category is not None else current.get("categoria")
        publisher = data.publisher if data.publisher is not None else current.get("fabricante")
        license_val = data.license if data.license is not None else current.get("licenca")

        cur.execute("""
            UPDATE softwares
            SET nome = %s, versao = %s, categoria = %s, fabricante = %s, licenca = %s
            WHERE id = %s;
        """, (name, version, category, publisher, license_val, id))
    return get_program(id)

@router.delete("/programs/{id}")
def delete_program(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM softwares WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Programa")

        cur.execute("DELETE FROM maquina_software WHERE software_id = %s;", (id,))
        cur.execute("DELETE FROM softwares WHERE id = %s;", (id,))
    return None

# ==============================================================================
# INCIDENTES (/incidents)
# ==============================================================================

class IncidentCreate(BaseModel):
    machine_id: int
    title: str
    description: Optional[str] = ""
    severity: str  # baixa, media, alta, critica
    status: Optional[str] = "aberto"  # aberto, em_andamento, resolvido
    reported_by: Optional[str] = None

class IncidentPatch(BaseModel):
    machine_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    reported_by: Optional[str] = None

def format_incident(row: dict) -> dict:
    st = row["status"]
    if st == "em_atendimento":
        st = "em_andamento"

    return {
        "id": row["id"],
        "machine_id": row["maquina_id"],
        "machine_hostname": row.get("machine_hostname") or f"#{row['maquina_id']}",
        "title": row["titulo"],
        "description": row.get("descricao") or "",
        "severity": row["severidade"],
        "status": st,
        "reported_by": row.get("reportado_por") or "Atendente",
        "opened_at": row["aberto_em"].isoformat() if row.get("aberto_em") else None,
        "resolved_at": row["resolvido_em"].isoformat() if row.get("resolvido_em") else None,
    }

@router.get("/incidents")
def list_incidents(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    machine_id: Optional[int] = None,
    q: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT i.*, m.codigo as machine_hostname
            FROM incidentes i
            JOIN maquinas m ON m.id = i.maquina_id
            ORDER BY i.aberto_em DESC;
        """)
        rows = cur.fetchall()

    items = []
    for r in rows:
        inc = format_incident(r)
        if status and inc["status"] not in status.split(","):
            continue
        if severity and inc["severity"] not in severity.split(","):
            continue
        if machine_id and inc["machine_id"] != machine_id:
            continue
        if q:
            term = q.lower()
            match = (
                term in inc["title"].lower()
                or term in (inc["description"] or "").lower()
                or term in inc["machine_hostname"].lower()
                or term in (inc["reported_by"] or "").lower()
            )
            if not match:
                continue
        items.append(inc)

    total = len(items)
    if limit is not None:
        items = items[offset : offset + limit]
    return {"items": items, "total": total}

@router.get("/incidents/{id}")
def get_incident(id: int):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT i.*, m.codigo as machine_hostname
            FROM incidentes i
            JOIN maquinas m ON m.id = i.maquina_id
            WHERE i.id = %s;
        """, (id,))
        r = cur.fetchone()
        if not r:
            raise NotFoundError("Incidente")
        return format_incident(r)

@router.post("/incidents")
def create_incident(data: IncidentCreate):
    db_status = "em_atendimento" if data.status == "em_andamento" else (data.status or "aberto")

    with get_db_cursor() as cur:
        cur.execute("SELECT codigo FROM maquinas WHERE id = %s;", (data.machine_id,))
        m = cur.fetchone()
        if not m:
            raise ValidationError({"machine_id": "Máquina inexistente."})

        resolved_at = datetime.now(timezone.utc) if db_status == "resolvido" else None

        cur.execute("""
            INSERT INTO incidentes (maquina_id, titulo, descricao, severidade, status, reportado_por, aberto_em, resolvido_em)
            VALUES (%s, %s, %s, %s, %s, %s, NOW(), %s)
            RETURNING id;
        """, (data.machine_id, data.title, data.description, data.severity, db_status, data.reported_by, resolved_at))
        new_id = cur.fetchone()["id"]

    warnings = []
    # Dispara evento incident_opened no MongoDB
    log_event(
        event_type="incident_opened",
        machine_id=data.machine_id,
        machine_hostname=m["codigo"],
        payload={
            "incident_id": new_id,
            "title": data.title,
            "severity": data.severity,
        },
        warnings=warnings,
    )

    res = get_incident(new_id)
    if warnings:
        res["_warnings"] = warnings
    return res

@router.put("/incidents/{id}")
@router.patch("/incidents/{id}")
def update_incident(id: int, data: IncidentPatch):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM incidentes WHERE id = %s;", (id,))
        prev = cur.fetchone()
        if not prev:
            raise NotFoundError("Incidente")

        machine_id = data.machine_id if data.machine_id is not None else prev["maquina_id"]
        title = data.title if data.title is not None else prev["titulo"]
        description = data.description if data.description is not None else prev.get("descricao")
        severity = data.severity if data.severity is not None else prev["severidade"]
        reported_by = data.reported_by if data.reported_by is not None else prev.get("reportado_por")

        if data.status is not None:
            db_status = "em_atendimento" if data.status == "em_andamento" else data.status
        else:
            db_status = prev["status"]

        resolved_clause = ""
        if db_status == "resolvido" and prev["status"] != "resolvido":
            resolved_clause = ", resolvido_em = NOW()"
        elif db_status != "resolvido":
            resolved_clause = ", resolvido_em = NULL"

        cur.execute(f"""
            UPDATE incidentes
            SET maquina_id = %s, titulo = %s, descricao = %s, severidade = %s, status = %s, reportado_por = %s {resolved_clause}
            WHERE id = %s;
        """, (machine_id, title, description, severity, db_status, reported_by, id))

    return get_incident(id)

@router.delete("/incidents/{id}")
def delete_incident(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM incidentes WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Incidente")
        cur.execute("DELETE FROM incidentes WHERE id = %s;", (id,))
    return None

# ==============================================================================
# MANUTENÇÕES (/maintenances)
# ==============================================================================

class MaintenanceCreate(BaseModel):
    machine_id: int
    incident_id: Optional[int] = None
    type: str  # preventiva, corretiva
    description: str
    technician: Optional[str] = "Equipe técnica"
    cost: Optional[float] = 0.0
    scheduled_for: Optional[str] = None
    status: Optional[str] = "agendada"  # agendada, em_andamento, concluida

class MaintenancePatch(BaseModel):
    machine_id: Optional[int] = None
    incident_id: Optional[int] = None
    type: Optional[str] = None
    description: Optional[str] = None
    technician: Optional[str] = None
    cost: Optional[float] = None
    scheduled_for: Optional[str] = None
    status: Optional[str] = None

def format_maintenance(row: dict) -> dict:
    return {
        "id": row["id"],
        "machine_id": row["maquina_id"],
        "machine_hostname": row.get("machine_hostname") or f"#{row['maquina_id']}",
        "incident_id": row.get("incidente_id"),
        "type": row["tipo"],
        "description": row["descricao"],
        "technician": row.get("responsavel_tecnico") or "Equipe técnica",
        "cost": float(row.get("custo") or 0.0),
        "scheduled_for": str(row["agendada_para"]) if row.get("agendada_para") else (row["inicio"].date().isoformat() if row.get("inicio") else None),
        "completed_at": row["fim"].isoformat() if row.get("fim") else None,
        "status": row.get("status") or ("concluida" if row.get("fim") else "em_andamento"),
    }

@router.get("/maintenances")
def list_maintenances(
    type: Optional[str] = None,
    status: Optional[str] = None,
    machine_id: Optional[int] = None,
    incident_id: Optional[int] = None,
    q: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT m.*, mac.codigo as machine_hostname
            FROM manutencoes m
            JOIN maquinas mac ON mac.id = m.maquina_id
            ORDER BY m.inicio DESC;
        """)
        rows = cur.fetchall()

    items = []
    for r in rows:
        mt = format_maintenance(r)
        if type and mt["type"] not in type.split(","):
            continue
        if status and mt["status"] not in status.split(","):
            continue
        if machine_id and mt["machine_id"] != machine_id:
            continue
        if incident_id and mt["incident_id"] != incident_id:
            continue
        if q:
            term = q.lower()
            match = (
                term in (mt["description"] or "").lower()
                or term in (mt["technician"] or "").lower()
                or term in mt["machine_hostname"].lower()
            )
            if not match:
                continue
        items.append(mt)

    total = len(items)
    if limit is not None:
        items = items[offset : offset + limit]
    return {"items": items, "total": total}

@router.get("/maintenances/{id}")
def get_maintenance(id: int):
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT m.*, mac.codigo as machine_hostname
            FROM manutencoes m
            JOIN maquinas mac ON mac.id = m.maquina_id
            WHERE m.id = %s;
        """, (id,))
        r = cur.fetchone()
        if not r:
            raise NotFoundError("Manutenção")
        return format_maintenance(r)

@router.post("/maintenances")
def create_maintenance(data: MaintenanceCreate):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM maquinas WHERE id = %s;", (data.machine_id,))
        if not cur.fetchone():
            raise ValidationError({"machine_id": "Máquina inexistente."})

        if data.incident_id is not None:
            cur.execute("SELECT id FROM incidentes WHERE id = %s;", (data.incident_id,))
            if not cur.fetchone():
                raise ValidationError({"incident_id": "Incidente inexistente."})

        completed_at = datetime.now(timezone.utc) if data.status == "concluida" else None

        cur.execute("""
            INSERT INTO manutencoes (maquina_id, incidente_id, tipo, descricao, responsavel_tecnico, custo, agendada_para, status, fim)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id;
        """, (data.machine_id, data.incident_id, data.type, data.description, data.technician, data.cost or 0.0, data.scheduled_for or None, data.status, completed_at))
        new_id = cur.fetchone()["id"]

    return get_maintenance(new_id)

@router.put("/maintenances/{id}")
@router.patch("/maintenances/{id}")
def update_maintenance(id: int, data: MaintenancePatch):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM manutencoes WHERE id = %s;", (id,))
        prev = cur.fetchone()
        if not prev:
            raise NotFoundError("Manutenção")

        machine_id = data.machine_id if data.machine_id is not None else prev["maquina_id"]
        incident_id = data.incident_id if "incident_id" in data.model_fields_set else prev.get("incidente_id")
        mt_type = data.type if data.type is not None else prev["tipo"]
        description = data.description if data.description is not None else prev["descricao"]
        technician = data.technician if data.technician is not None else prev.get("responsavel_tecnico")
        cost = data.cost if data.cost is not None else float(prev.get("custo") or 0.0)
        scheduled_for = data.scheduled_for if data.scheduled_for is not None else prev.get("agendada_para")
        status = data.status if data.status is not None else prev.get("status")

        fim_clause = ""
        if status == "concluida" and prev.get("status") != "concluida":
            fim_clause = ", fim = NOW()"
        elif status != "concluida":
            fim_clause = ", fim = NULL"

        cur.execute(f"""
            UPDATE manutencoes
            SET maquina_id = %s, incidente_id = %s, tipo = %s, descricao = %s,
                responsavel_tecnico = %s, custo = %s, agendada_para = %s, status = %s {fim_clause}
            WHERE id = %s;
        """, (machine_id, incident_id, mt_type, description, technician, cost, scheduled_for or None, status, id))

    return get_maintenance(id)

@router.delete("/maintenances/{id}")
def delete_maintenance(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM manutencoes WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Manutenção")
        cur.execute("DELETE FROM manutencoes WHERE id = %s;", (id,))
    return None
