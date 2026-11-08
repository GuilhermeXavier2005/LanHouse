from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query, Body
from pydantic import BaseModel

from app.database.postgres import get_db_cursor
from app.services.event_logger import log_event
from app.errors import NotFoundError, ConflictError, ValidationError

router = APIRouter(prefix="/machines", tags=["Máquinas"])

# Mapeamento de Zonas (Banco ⇄ API)
ZONE_TO_DB = {"arena": "Gamer", "vip": "VIP", "navegacao": "Basico"}
DB_TO_ZONE = {"gamer": "arena", "vip": "vip", "basico": "navegacao"}

def map_zone_to_api(db_group: Optional[str]) -> str:
    if not db_group:
        return "arena"
    return DB_TO_ZONE.get(db_group.lower(), "arena")

def map_zone_to_db(api_zone: Optional[str]) -> str:
    if not api_zone:
        return "Gamer"
    return ZONE_TO_DB.get(api_zone.lower(), "Gamer")

def format_machine(row: dict, active_session: Optional[dict] = None, last_session: Optional[dict] = None) -> dict:
    db_status = row.get("status")
    api_status = db_status

    active_id = active_session.get("id") if active_session else None

    # Mapeamento de status: online -> 'em_uso' se tiver sessão ativa, senão 'disponivel'
    if db_status == "online":
        api_status = "em_uso" if active_id else "disponivel"
    elif db_status not in ["manutencao", "offline"]:
        api_status = "disponivel"

    # Last user
    ref_sess = active_session or last_session
    last_user_obj = None
    if ref_sess and ref_sess.get("user_id"):
        last_user_obj = {
            "id": ref_sess["user_id"],
            "name": ref_sess.get("user_name"),
            "nickname": ref_sess.get("user_nickname"),
            "session_id": ref_sess["id"],
            "at": (ref_sess.get("fim") or ref_sess.get("inicio")).isoformat() if (ref_sess.get("fim") or ref_sess.get("inicio")) else None,
            "in_session": bool(active_session),
        }

    return {
        "id": row["id"],
        "hostname": row.get("codigo") or row.get("nome"),
        "zone": map_zone_to_api(row.get("grupo")),
        "status": api_status,
        "cpu": row.get("processador") or "",
        "gpu": row.get("gpu") or "Integrada",
        "ram_gb": int(row.get("memoria_gb") or 16),
        "storage_gb": int(row.get("armazenamento_gb") or 512),
        "os": row.get("sistema_operacional") or "Windows 11",
        "ip": str(row.get("endereco_ip") or ""),
        "mac": row.get("mac") or "",
        "notes": row.get("observacoes") or "",
        "created_at": row["criada_em"].isoformat() if row.get("criada_em") else None,
        "updated_at": row["atualizada_em"].isoformat() if row.get("atualizada_em") else None,
        "active_session_id": active_id,
        "last_user": last_user_obj,
    }

class MachineCreateUpdate(BaseModel):
    hostname: str
    zone: str
    cpu: str
    gpu: Optional[str] = None
    ram_gb: int
    storage_gb: int
    os: Optional[str] = "Windows 11"
    ip: Optional[str] = None
    mac: Optional[str] = None
    notes: Optional[str] = ""
    status: Optional[str] = "disponivel"

class StatusUpdate(BaseModel):
    status: str
    reason: Optional[str] = "Alteração manual"

@router.get("")
def list_machines(
    zone: Optional[str] = None,
    status: Optional[str] = None,
    q: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM maquinas ORDER BY id ASC;")
        machines = cur.fetchall()

        # Buscar sessões ativas
        cur.execute("""
            SELECT s.id, s.maquina_id, s.inicio, s.fim, s.usuario_id as user_id, u.nome as user_name, u.nickname as user_nickname
            FROM sessoes_uso s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.fim IS NULL;
        """)
        active_sessions = {s["maquina_id"]: s for s in cur.fetchall()}

        # Buscar últimas sessões encerradas por máquina
        cur.execute("""
            SELECT DISTINCT ON (s.maquina_id) s.id, s.maquina_id, s.inicio, s.fim, s.usuario_id as user_id, u.nome as user_name, u.nickname as user_nickname
            FROM sessoes_uso s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            ORDER BY s.maquina_id, s.inicio DESC;
        """)
        last_sessions = {s["maquina_id"]: s for s in cur.fetchall()}

    items = []
    for m in machines:
        formatted = format_machine(m, active_sessions.get(m["id"]), last_sessions.get(m["id"]))
        
        # Filtros
        if zone and formatted["zone"] not in zone.split(","):
            continue
        if status and formatted["status"] not in status.split(","):
            continue
        if q:
            term = q.lower()
            match = (
                term in formatted["hostname"].lower()
                or term in formatted["cpu"].lower()
                or term in formatted["gpu"].lower()
                or term in formatted["ip"].lower()
            )
            if not match:
                continue

        items.append(formatted)

    total = len(items)
    if limit is not None:
        items = items[offset : offset + limit]

    return {"items": items, "total": total}

@router.get("/{id}")
def get_machine(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM maquinas WHERE id = %s;", (id,))
        m = cur.fetchone()
        if not m:
            raise NotFoundError("Máquina")

        cur.execute("""
            SELECT s.id, s.maquina_id, s.inicio, s.fim, s.usuario_id as user_id, u.nome as user_name, u.nickname as user_nickname
            FROM sessoes_uso s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.maquina_id = %s AND s.fim IS NULL;
        """, (id,))
        active_sess = cur.fetchone()

        cur.execute("""
            SELECT s.id, s.maquina_id, s.inicio, s.fim, s.usuario_id as user_id, u.nome as user_name, u.nickname as user_nickname
            FROM sessoes_uso s
            LEFT JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.maquina_id = %s
            ORDER BY s.inicio DESC LIMIT 1;
        """, (id,))
        last_sess = cur.fetchone()

        return format_machine(m, active_sess, last_sess)

@router.post("")
def create_machine(data: MachineCreateUpdate):
    hostname = data.hostname.strip().upper()
    db_group = map_zone_to_db(data.zone)
    initial_status = data.status or "disponivel"
    db_status = "online" if initial_status == "disponivel" else initial_status

    if initial_status not in ["disponivel", "manutencao", "offline"]:
        raise ValidationError({"status": "Status inicial inválido."})

    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM maquinas WHERE UPPER(codigo) = %s;", (hostname,))
        if cur.fetchone():
            raise ValidationError({"hostname": "Já existe uma máquina com esse hostname."})

        cur.execute("""
            INSERT INTO maquinas (codigo, nome, grupo, sistema_operacional, processador, gpu, memoria_gb, armazenamento_gb, endereco_ip, mac, observacoes, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id;
        """, (
            hostname,
            f"Estacao {hostname}",
            db_group,
            data.os,
            data.cpu,
            data.gpu,
            data.ram_gb,
            data.storage_gb,
            data.ip or None,
            data.mac,
            data.notes,
            db_status,
        ))
        new_id = cur.fetchone()["id"]

    warnings = []
    log_event(
        event_type="state_changed",
        machine_id=new_id,
        machine_hostname=hostname,
        payload={"from": None, "to": initial_status, "reason": "Máquina cadastrada"},
        warnings=warnings,
    )

    res = get_machine(new_id)
    if warnings:
        res["_warnings"] = warnings
    return res

@router.put("/{id}")
def update_machine(id: int, data: MachineCreateUpdate):
    hostname = data.hostname.strip().upper()
    db_group = map_zone_to_db(data.zone)

    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM maquinas WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Máquina")

        cur.execute("SELECT id FROM maquinas WHERE UPPER(codigo) = %s AND id != %s;", (hostname, id))
        if cur.fetchone():
            raise ValidationError({"hostname": "Já existe uma máquina com esse hostname."})

        cur.execute("""
            UPDATE maquinas
            SET codigo = %s, nome = %s, grupo = %s, sistema_operacional = %s, processador = %s,
                gpu = %s, memoria_gb = %s, armazenamento_gb = %s, endereco_ip = %s, mac = %s,
                observacoes = %s, atualizada_em = NOW()
            WHERE id = %s;
        """, (
            hostname,
            f"Estacao {hostname}",
            db_group,
            data.os,
            data.cpu,
            data.gpu,
            data.ram_gb,
            data.storage_gb,
            data.ip or None,
            data.mac,
            data.notes,
            id,
        ))

    return get_machine(id)

@router.patch("/{id}/status")
def patch_machine_status(id: int, body: StatusUpdate):
    target_status = body.status
    if target_status not in ["disponivel", "manutencao", "offline"]:
        raise ValidationError({"status": "Status inválido."})

    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM maquinas WHERE id = %s;", (id,))
        m = cur.fetchone()
        if not m:
            raise NotFoundError("Máquina")

        # Verificar se há sessão ativa
        cur.execute("SELECT id FROM sessoes_uso WHERE maquina_id = %s AND fim IS NULL;", (id,))
        if cur.fetchone():
            raise ConflictError("A máquina possui uma sessão ativa. Encerre a sessão antes de alterar o estado.")

        db_new_status = "online" if target_status == "disponivel" else target_status
        current_api_status = "disponivel" if m["status"] == "online" else m["status"]

        cur.execute("""
            UPDATE maquinas
            SET status = %s, atualizada_em = NOW()
            WHERE id = %s;
        """, (db_new_status, id))

    warnings = []
    if current_api_status != target_status:
        log_event(
            event_type="state_changed",
            machine_id=id,
            machine_hostname=m.get("codigo"),
            payload={"from": current_api_status, "to": target_status, "reason": body.reason or "Alteração manual"},
            warnings=warnings,
        )

    res = get_machine(id)
    if warnings:
        res["_warnings"] = warnings
    return res

@router.delete("/{id}")
def delete_machine(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM maquinas WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Máquina")

        cur.execute("SELECT id FROM sessoes_uso WHERE maquina_id = %s AND fim IS NULL;", (id,))
        if cur.fetchone():
            raise ConflictError("Não é possível excluir uma máquina com sessão ativa.")

        cur.execute("DELETE FROM manutencoes WHERE maquina_id = %s;", (id,))
        cur.execute("DELETE FROM incidentes WHERE maquina_id = %s;", (id,))
        cur.execute("DELETE FROM sessoes_uso WHERE maquina_id = %s;", (id,))
        cur.execute("DELETE FROM maquina_software WHERE maquina_id = %s;", (id,))
        cur.execute("DELETE FROM maquinas WHERE id = %s;", (id,))

    return None

@router.get("/{id}/last-user")
def get_machine_last_user(id: int):
    m = get_machine(id)
    return {"last_user": m.get("last_user")}

@router.get("/{id}/programs")
def get_machine_programs(id: int):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM maquinas WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Máquina")

        cur.execute("""
            SELECT s.id, s.nome as name, s.categoria as category, s.fabricante as publisher,
                   s.versao as version, s.licenca as license, ms.instalado_em as installed_at
            FROM maquina_software ms
            JOIN softwares s ON s.id = ms.software_id
            WHERE ms.maquina_id = %s
            ORDER BY s.nome ASC;
        """, (id,))
        rows = cur.fetchall()

    items = []
    for r in rows:
        cat = r["category"].lower() if r["category"] else "utilitario"
        if cat in ["jogos", "jogo"]:
            cat = "jogo"
        elif cat in ["navegadores", "navegador"]:
            cat = "navegador"
        elif cat in ["desenvolvimento", "produtividade"]:
            cat = "produtividade"
        else:
            cat = "utilitario"

        items.append({
            "id": r["id"],
            "name": r["name"],
            "category": cat,
            "publisher": r["publisher"] or "",
            "version": r["version"] or "",
            "license": r["license"] or "gratuito",
            "installed_at": r["installed_at"].isoformat() if r["installed_at"] else None,
        })

    return {"items": items, "total": len(items)}

class SetProgramsBody(BaseModel):
    program_ids: List[int]

@router.put("/{id}/programs")
def set_machine_programs(id: int, body: SetProgramsBody):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM maquinas WHERE id = %s;", (id,))
        if not cur.fetchone():
            raise NotFoundError("Máquina")

        # Remove atuais
        cur.execute("DELETE FROM maquina_software WHERE maquina_id = %s;", (id,))

        # Insere novos válidos
        ids = list(set(body.program_ids))
        valid_ids = []
        for pid in ids:
            cur.execute("SELECT id FROM softwares WHERE id = %s;", (pid,))
            if cur.fetchone():
                cur.execute("""
                    INSERT INTO maquina_software (maquina_id, software_id, instalado_em)
                    VALUES (%s, %s, CURRENT_DATE);
                """, (id, pid))
                valid_ids.append(pid)

    return {"machine_id": id, "program_ids": valid_ids}
