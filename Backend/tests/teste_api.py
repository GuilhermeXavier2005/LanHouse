"""Bateria de testes de ponta a ponta da API LanHouse Monitor.

Chama todas as rotas (PostgreSQL, MongoDB e Cassandra) com entradas válidas e inválidas e
confere o código HTTP esperado. Falha se alguma rota responder 5xx inesperado ou um código
diferente do contrato (Frontend/API.md). Também testa a simulação de queda de cada banco.

Pré-requisito: bancos no ar (docker compose up -d) e back-end rodando na porta 8000.
Uso (na pasta Backend, com o ambiente virtual criado pelo iniciar_backend.bat):

    .venv\\Scripts\\python tests\\teste_api.py
    .venv\\Scripts\\python tests\\teste_api.py http://localhost:8000/api   (URL opcional)

Usa apenas a biblioteca padrão do Python. Os registros criados pelo teste (máquina, usuário,
plano, programa, sessão, incidente e manutenção) são excluídos ao final; os eventos dessas
operações permanecem no MongoDB como histórico.
"""
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

try:  # evita erro de acentuação em consoles antigos do Windows
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/api").rstrip("/")
results = []


def call(method, path, body=None, expect=None, label=None):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = (body if isinstance(body, (bytes, str)) else json.dumps(body)).encode() if not isinstance(body, bytes) else body
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    except Exception as e:
        status, raw = -1, str(e).encode()
    ms = round((time.perf_counter() - t0) * 1000)
    try:
        payload = json.loads(raw) if raw else None
    except Exception:
        payload = raw.decode(errors="replace")[:200]
    ok = status != -1 and status < 500
    if expect is not None:
        exp = expect if isinstance(expect, (list, tuple)) else [expect]
        ok = status in exp
    results.append((ok, method, path, status, ms, label, payload if not ok else None))
    return status, payload


now = datetime.now(timezone.utc)
iso = lambda d: d.isoformat().replace("+00:00", "Z")
stamp = str(int(time.time()))[-6:]

# ---------------- Health / raiz ----------------
call("GET", "/health", expect=200)
call("POST", "/health/simulate", {"service": "xyz", "down": True}, expect=[200, 422])
call("POST", "/health/simulate", {}, expect=422)

# ---------------- Máquinas ----------------
call("GET", "/machines", expect=200)
call("GET", "/machines?zone=arena,vip&status=disponivel&q=pc&limit=2&offset=0", expect=200)
call("GET", "/machines?limit=abc", expect=422)
call("GET", "/machines/1", expect=200)
call("GET", "/machines/999999", expect=404)
call("GET", "/machines/abc", expect=422)
call("GET", "/machines/1/last-user", expect=200)
call("GET", "/machines/1/programs", expect=200)
call("GET", "/machines/999999/programs", expect=404)

mach = {"hostname": f"T-{stamp}", "zone": "vip", "cpu": "Ryzen 7", "gpu": "RTX", "ram_gb": 16,
        "storage_gb": 512, "os": "Windows 11", "ip": "10.0.0.50", "mac": "AA:BB", "notes": "teste"}
st, m = call("POST", "/machines", mach, expect=[200, 201])
mid = m["id"] if isinstance(m, dict) and "id" in m else None
call("POST", "/machines", mach, expect=[409, 422], label="hostname duplicado")
call("POST", "/machines", {**mach, "hostname": f"X1-{stamp}", "ip": "nao-e-ip"}, expect=422, label="ip invalido")
call("POST", "/machines", {**mach, "hostname": f"X2-{stamp}", "ram_gb": 0}, expect=422, label="ram 0")
call("POST", "/machines", {**mach, "hostname": f"X3-{stamp}", "ram_gb": -4}, expect=422, label="ram negativa")
call("POST", "/machines", {**mach, "hostname": f"X4-{stamp}", "storage_gb": 0}, expect=422, label="storage 0")
call("POST", "/machines", {**mach, "hostname": f"X5-{stamp}", "status": "em_uso"}, expect=422, label="status invalido")
call("POST", "/machines", {**mach, "hostname": "A" * 60}, expect=422, label="hostname longo")
call("POST", "/machines", {**mach, "hostname": "   "}, expect=422, label="hostname vazio")
call("POST", "/machines", {**mach, "hostname": f"X6-{stamp}", "cpu": "C" * 300}, expect=422, label="cpu longa")
call("POST", "/machines", {"hostname": "x"}, expect=422, label="faltando campos")
call("POST", "/machines", "{json quebrado", expect=422, label="json invalido")
if mid:
    call("PUT", f"/machines/{mid}", {**mach, "notes": "editado", "ip": ""}, expect=200)
    call("PUT", f"/machines/{mid}", {**mach, "ip": "999.1.1.1"}, expect=422, label="put ip invalido")
    call("PUT", f"/machines/{mid}", {**mach, "hostname": "PC-01"}, expect=[409, 422], label="put hostname de outra")
    call("PATCH", f"/machines/{mid}/status", {"status": "manutencao"}, expect=200)
    call("PATCH", f"/machines/{mid}/status", {"status": "voando"}, expect=422)
    call("PATCH", f"/machines/{mid}/status", {"status": "disponivel"}, expect=200)
    call("PUT", f"/machines/{mid}/programs", {"program_ids": [1, 2, 99999]}, expect=200)
    call("GET", f"/machines/{mid}/programs", expect=200)
call("PUT", "/machines/999999", mach, expect=404)
call("PATCH", "/machines/999999/status", {"status": "offline"}, expect=404)

# ---------------- Usuários ----------------
call("GET", "/users", expect=200)
call("GET", "/users?q=lu&limit=1", expect=200)
call("GET", "/users/1", expect=200)
call("GET", "/users/999999", expect=404)
st, u = call("POST", "/users", {"name": "Tester", "nickname": f"tester{stamp}", "phone": "11 9999"}, expect=[200, 201])
uid = u.get("id") if isinstance(u, dict) else None
call("POST", "/users", {"name": "Tester", "nickname": f"tester{stamp}"}, expect=[409, 422], label="nick duplicado")
call("POST", "/users", {"name": "", "nickname": ""}, expect=422, label="nome vazio")
call("POST", "/users", {"name": "N" * 200, "nickname": f"n{stamp}"}, expect=422, label="nome longo")
call("POST", "/users", {"name": "Ok", "nickname": "k" * 100}, expect=422, label="nick longo")
if uid:
    call("PATCH", f"/users/{uid}", {"phone": "123"}, expect=200)
    call("PUT", f"/users/{uid}", {"nickname": "lari_fps"}, expect=[409, 422], label="nick de outro")
    call("PATCH", f"/users/{uid}", {"name": "N" * 200}, expect=422, label="patch nome longo")
call("PATCH", "/users/999999", {"phone": "1"}, expect=404)

# ---------------- Planos ----------------
call("GET", "/plans", expect=200)
call("GET", "/plans?kind=plano&billing=hora&active=true&q=hora", expect=200)
call("GET", "/plans/1", expect=200)
call("GET", "/plans/999999", expect=404)
st, p = call("POST", "/plans", {"name": f"Plano {stamp}", "kind": "plano", "billing": "hora", "price": 9.5}, expect=[200, 201])
pid = p.get("id") if isinstance(p, dict) else None
call("POST", "/plans", {"name": "Pacote", "kind": "plano", "billing": "pacote", "price": 10}, expect=422, label="pacote sem horas")
call("POST", "/plans", {"name": "Neg", "kind": "plano", "billing": "hora", "price": -1}, expect=422, label="preco negativo")
call("POST", "/plans", {"name": "Big", "kind": "plano", "billing": "hora", "price": 1e12}, expect=422, label="preco gigante")
call("POST", "/plans", {"name": "Bad", "kind": "xpto", "billing": "hora", "price": 1}, expect=422, label="kind invalido")
call("POST", "/plans", {"name": "Bad", "kind": "plano", "billing": "xpto", "price": 1}, expect=422, label="billing invalido")
call("POST", "/plans", {"name": "Hrs", "kind": "plano", "billing": "pacote", "price": 1, "hours": 99999}, expect=422, label="horas gigante")
call("POST", "/plans", {"name": "", "kind": "plano", "billing": "hora", "price": 1}, expect=422, label="nome vazio")
if pid:
    call("PATCH", f"/plans/{pid}", {"price": 11}, expect=200)
    call("PATCH", f"/plans/{pid}", {"billing": "pacote"}, expect=422)
    call("PATCH", f"/plans/{pid}", {"price": -5}, expect=422, label="patch preco negativo")

# ---------------- Programas ----------------
call("GET", "/programs", expect=200)
call("GET", "/programs?category=jogo&license=gratuito&q=st", expect=200)
call("GET", "/programs/1", expect=200)
call("GET", "/programs/999999", expect=404)
st, pr = call("POST", "/programs", {"name": f"Prog {stamp}", "category": "jogo", "version": "1"}, expect=[200, 201])
prid = pr.get("id") if isinstance(pr, dict) else None
call("POST", "/programs", {"name": f"Prog {stamp}", "category": "jogo", "version": "1"}, expect=[409, 422], label="programa duplicado")
call("POST", "/programs", {"name": "P" * 200, "category": "jogo"}, expect=422, label="nome longo")
call("POST", "/programs", {"name": "", "category": "jogo"}, expect=422, label="nome vazio")
if prid:
    call("PATCH", f"/programs/{prid}", {"version": "2"}, expect=200)
    call("PATCH", f"/programs/{prid}", {"name": "Google Chrome", "version": "130"}, expect=[409, 422], label="patch duplicando outro")
    call("PATCH", f"/programs/{prid}", {"version": "V" * 100}, expect=422, label="versao longa")

# ---------------- Sessões ----------------
call("GET", "/sessions", expect=200)
call("GET", f"/sessions?status=ativa,encerrada&payment_status=pago&from={iso(now - timedelta(days=30))}&to={iso(now)}&q=pc&limit=5", expect=200)
call("GET", "/sessions/1", expect=200)
call("GET", "/sessions/999999", expect=404)
call("POST", "/sessions", {"machine_id": 999999, "user_id": 1, "plan_id": 1}, expect=422)
call("POST", "/sessions", {"machine_id": 1, "user_id": 1, "plan_id": 1}, expect=409, label="PC-01 ocupada")
call("POST", "/sessions", {"machine_id": 3, "user_id": 1, "plan_id": 1}, expect=409, label="PC-03 offline")
sid = None
if mid and uid:
    call("POST", "/sessions", {"machine_id": mid, "user_id": uid, "plan_id": 5}, expect=422, label="plano servico")
    call("POST", "/sessions", {"machine_id": mid, "user_id": 999999, "plan_id": 1}, expect=422)
    st, s = call("POST", "/sessions", {"machine_id": mid, "user_id": uid, "plan_id": 1}, expect=[200, 201])
    sid = s.get("id") if isinstance(s, dict) else None
    call("POST", "/sessions", {"machine_id": 2, "user_id": uid, "plan_id": 1}, expect=409, label="usuario ja em sessao")
    call("DELETE", f"/machines/{mid}", expect=409, label="excluir maquina com sessao")
    call("PATCH", f"/machines/{mid}/status", {"status": "offline"}, expect=409, label="mudar estado com sessao ativa")
    call("DELETE", f"/users/{uid}", expect=409, label="excluir usuario em sessao")
    if pid:
        pass
    if sid:
        call("PATCH", f"/sessions/{sid}", {"payment_status": "pago"}, expect=409, label="patch sessao ativa")
        call("POST", f"/sessions/{sid}/end", {"payment_method": "pix", "payment_status": "xpto"}, expect=422, label="status pagamento invalido")
        call("POST", f"/sessions/{sid}/end", {"payment_method": "pix"}, expect=200)
        call("POST", f"/sessions/{sid}/end", {"payment_method": "pix"}, expect=409, label="encerrar de novo")
        call("PATCH", f"/sessions/{sid}", {"payment_status": "pendente", "payment_method": "dinheiro"}, expect=200)
        call("PATCH", f"/sessions/{sid}", {"payment_method": "M" * 100}, expect=422, label="metodo longo")
call("POST", "/sessions/999999/end", {}, expect=404)
call("PATCH", "/sessions/999999", {"payment_status": "pago"}, expect=404)

# ---------------- Incidentes ----------------
call("GET", "/incidents", expect=200)
call("GET", "/incidents?status=aberto,em_andamento&severity=alta&machine_id=3&q=falha", expect=200)
call("GET", "/incidents/1", expect=200)
call("GET", "/incidents/999999", expect=404)
target = mid or 2
st, inc = call("POST", "/incidents", {"machine_id": target, "title": "Teste", "severity": "media"}, expect=[200, 201])
iid = inc.get("id") if isinstance(inc, dict) else None
call("POST", "/incidents", {"machine_id": target, "title": "x", "severity": "extrema"}, expect=422, label="severidade invalida")
call("POST", "/incidents", {"machine_id": target, "title": "x", "severity": "baixa", "status": "zzz"}, expect=422, label="status invalido")
call("POST", "/incidents", {"machine_id": 999999, "title": "x", "severity": "baixa"}, expect=422)
call("POST", "/incidents", {"machine_id": target, "title": "T" * 300, "severity": "baixa"}, expect=422, label="titulo longo")
call("POST", "/incidents", {"machine_id": target, "title": "", "severity": "baixa"}, expect=422, label="titulo vazio")
call("POST", "/incidents", {"machine_id": target, "title": "Resolvido", "severity": "baixa", "status": "resolvido"}, expect=[200, 201])
if iid:
    call("PATCH", f"/incidents/{iid}", {"status": "em_andamento"}, expect=200)
    call("PATCH", f"/incidents/{iid}", {"status": "resolvido"}, expect=200)
    call("PATCH", f"/incidents/{iid}", {"status": "aberto"}, expect=200)
    call("PATCH", f"/incidents/{iid}", {"severity": "zzz"}, expect=422, label="patch severidade invalida")
    call("PATCH", f"/incidents/{iid}", {"machine_id": 999999}, expect=422, label="patch maquina inexistente")
    call("PATCH", f"/incidents/{iid}", {"status": "cancelado"}, expect=422)

# ---------------- Manutenções ----------------
call("GET", "/maintenances", expect=200)
call("GET", "/maintenances?type=preventiva&status=concluida&machine_id=2&incident_id=3&q=teclado", expect=200)
call("GET", "/maintenances/1", expect=200)
call("GET", "/maintenances/999999", expect=404)
st, mt = call("POST", "/maintenances", {"machine_id": target, "incident_id": iid, "type": "corretiva", "description": "Troca", "cost": 10, "scheduled_for": now.date().isoformat()}, expect=[200, 201])
mtid = mt.get("id") if isinstance(mt, dict) else None
call("POST", "/maintenances", {"machine_id": target, "type": "xpto", "description": "x"}, expect=422, label="tipo invalido")
call("POST", "/maintenances", {"machine_id": target, "type": "preventiva", "description": "x", "cost": -1}, expect=422, label="custo negativo")
call("POST", "/maintenances", {"machine_id": target, "type": "preventiva", "description": "x", "scheduled_for": "ontem"}, expect=422, label="data invalida")
call("POST", "/maintenances", {"machine_id": target, "type": "preventiva", "description": "x", "status": "zzz"}, expect=422, label="status invalido")
call("POST", "/maintenances", {"machine_id": target, "incident_id": 999999, "type": "preventiva", "description": "x"}, expect=422)
call("POST", "/maintenances", {"machine_id": target, "type": "preventiva", "description": "x", "status": "concluida"}, expect=[200, 201])
call("POST", "/maintenances", {"machine_id": target, "type": "preventiva", "description": ""}, expect=422, label="descricao vazia")
if mtid:
    call("PATCH", f"/maintenances/{mtid}", {"status": "concluida"}, expect=200)
    call("PATCH", f"/maintenances/{mtid}", {"status": "em_andamento"}, expect=200)
    call("PATCH", f"/maintenances/{mtid}", {"incident_id": None}, expect=200)
    call("PATCH", f"/maintenances/{mtid}", {"incident_id": 999999}, expect=422, label="patch incidente inexistente")
    call("PATCH", f"/maintenances/{mtid}", {"machine_id": 999999}, expect=422, label="patch maquina inexistente")
    call("PATCH", f"/maintenances/{mtid}", {"scheduled_for": "31/12/2026"}, expect=422, label="patch data invalida")
    call("PATCH", f"/maintenances/{mtid}", {"cost": -3}, expect=422, label="patch custo negativo")

# ---------------- Relatórios / Internet ----------------
call("GET", "/reports/summary", expect=200)
call("GET", "/reports/revenue", expect=200)
call("GET", "/reports/revenue?days=30", expect=200)
call("GET", "/reports/revenue?days=-5", expect=200)
call("GET", "/reports/revenue?days=abc", expect=422)
call("GET", "/internet-service", expect=200)
st, net = call("GET", "/internet-service")
if isinstance(net, dict):
    call("PUT", "/internet-service", net, expect=200)
    call("PUT", "/internet-service", {**net, "download_mbps": 0}, expect=422)
    call("PUT", "/internet-service", {**net, "monthly_cost": -10}, expect=422, label="custo negativo")
    call("PUT", "/internet-service", {**net, "contract_start": "amanha"}, expect=422, label="data invalida")
    call("PUT", "/internet-service", {**net, "provider": "P" * 200}, expect=422, label="provedor longo")
    call("PUT", "/internet-service", net, expect=200, label="restaura")

# ---------------- Eventos (MongoDB) ----------------
call("GET", "/events", expect=200)
call("GET", f"/events?type=state_changed,session_started&machine_id=1&from={iso(now - timedelta(days=1))}&q=pc&limit=5&offset=0", expect=200)
call("GET", "/events/000000000000000000000000", expect=404)
call("GET", "/events/nao-existe", expect=404)
st, ev = call("POST", "/events", {"type": "diagnostic", "machine_id": 2, "payload": {"a": 1}}, expect=[200, 201])
evid = ev.get("_id") if isinstance(ev, dict) else None
if evid:
    call("GET", f"/events/{evid}", expect=200)
    call("PATCH", f"/events/{evid}", {"payload": {"a": 2}}, expect=200)
    call("DELETE", f"/events/{evid}", expect=[200, 204])
    call("DELETE", f"/events/{evid}", expect=404)
call("GET", "/machines/1/events?limit=5", expect=200)
call("GET", "/events?limit=-1", expect=[200, 422])
call("GET", "/machines/1/events?limit=-1", expect=[200, 422])

# ---------------- Métricas (Cassandra) ----------------
call("GET", "/metrics/latest", expect=200)
call("GET", "/machines/1/metrics/latest", expect=200)
call("GET", "/machines/999999/metrics/latest", expect=404)
call("GET", "/machines/1/metrics", expect=200)
call("GET", f"/machines/1/metrics?from={iso(now - timedelta(days=7))}&to={iso(now)}", expect=200)
call("GET", f"/machines/1/metrics?from={iso(now - timedelta(hours=6))}&to={iso(now)}&step=60", expect=200)
call("GET", "/machines/1/metrics?from=ontem", expect=422)
call("GET", f"/machines/1/metrics?from={iso(now)}&to={iso(now - timedelta(hours=1))}", expect=422)
call("GET", f"/machines/1/metrics?from={iso(now - timedelta(days=60))}&to={iso(now)}", expect=422)
call("GET", "/machines/1/metrics?step=-10", expect=200)
ts_custom = iso(now - timedelta(minutes=2)).split(".")[0] + "Z"
call("POST", "/machines/2/metrics", {"ts": ts_custom, "cpu_pct": 50, "ram_pct": 40}, expect=[200, 201])
call("PUT", "/machines/2/metrics", {"ts": ts_custom, "cpu_pct": 55, "ram_pct": 45}, expect=200)
call("POST", "/machines/2/metrics", {"ts": "nao-e-data"}, expect=422, label="ts invalido")
call("POST", "/machines/2/metrics", {"cpu_pct": 500}, expect=[201, 422], label="cpu 500%")
call("DELETE", f"/machines/2/metrics?day={now.date().isoformat()}&ts={ts_custom}", expect=200)
call("DELETE", "/machines/2/metrics?day=31-12-2026", expect=422)
call("DELETE", f"/machines/2/metrics?day={now.date().isoformat()}&ts=xx", expect=422)
call("DELETE", "/machines/2/metrics", expect=422)
if mid:
    call("GET", f"/machines/{mid}/metrics/latest", expect=[200, 404], label="maquina nova sem telemetria")
    call("GET", f"/machines/{mid}/metrics", expect=200, label="serie maquina nova")

# ---------------- Simulação de queda (CAP) ----------------
for svc in ("mongodb", "cassandra", "postgres"):
    call("POST", "/health/simulate", {"service": svc, "down": True}, expect=200)
    call("GET", "/health", expect=200)
    if svc == "mongodb":
        call("GET", "/events", expect=503)
        st, inc2 = call("POST", "/incidents", {"machine_id": target, "title": "Mongo down", "severity": "baixa"}, expect=[200, 201], label="incidente com mongo off (warning)")
        if isinstance(inc2, dict) and "id" in inc2:
            if "_warnings" not in inc2:
                results.append((False, "POST", "/incidents", st, 0, "esperava _warnings com mongo off", inc2))
            call("DELETE", f"/incidents/{inc2['id']}", expect=[200, 204])
    if svc == "cassandra":
        call("GET", "/metrics/latest", expect=503)
        call("GET", "/machines/1/metrics", expect=503)
    if svc == "postgres":
        call("GET", "/machines", expect=503)
        call("GET", "/sessions", expect=503)
        call("GET", "/reports/summary", expect=503)
        call("GET", "/metrics/latest", expect=200, label="cassandra funciona com postgres off")
    call("POST", "/health/simulate", {"service": svc, "down": False}, expect=200)

# ---------------- Limpeza ----------------
if mtid:
    call("DELETE", f"/maintenances/{mtid}", expect=[200, 204])
    call("DELETE", f"/maintenances/{mtid}", expect=404)
if iid:
    call("DELETE", f"/incidents/{iid}", expect=[200, 204])
    call("DELETE", f"/incidents/{iid}", expect=404)
if prid:
    call("DELETE", f"/programs/{prid}", expect=[200, 204])
if pid:
    call("DELETE", f"/plans/{pid}", expect=[200, 204])
if uid:
    call("DELETE", f"/users/{uid}", expect=[200, 204])
    call("DELETE", f"/users/{uid}", expect=404)
if mid:
    call("DELETE", f"/machines/{mid}", expect=[200, 204])
    call("DELETE", f"/machines/{mid}", expect=404)

# ---------------- Raiz, Swagger e OpenAPI ----------------
ROOT = BASE[: -len("/api")] if BASE.endswith("/api") else BASE
for extra in (ROOT + "/", ROOT + "/docs", ROOT + "/openapi.json"):
    try:
        with urllib.request.urlopen(extra, timeout=15) as r:
            results.append((r.status == 200, "GET", extra, r.status, 0, None, None))
    except urllib.error.HTTPError as e:
        results.append((False, "GET", extra, e.code, 0, None, e.read()[:200]))

fails = [r for r in results if not r[0]]
slow = [r for r in results if r[4] > 5000]
for r in results:
    mark = "OK  " if r[0] else "FAIL"
    print(f"{mark} {r[3]:>4} {r[4]:>6}ms {r[1]:<6} {r[2]}" + (f"  [{r[5]}]" if r[5] else ""))
    if not r[0]:
        print("       ->", json.dumps(r[6], ensure_ascii=False)[:300] if r[6] is not None else "")
print(f"\nTotal de chamadas: {len(results)}  Falhas: {len(fails)}  "
      f"5xx inesperados: {sum(1 for r in results if r[3] >= 500 and r[0] is False)}  Lentas (>5s): {len(slow)}")
print("RESULTADO: OK - nenhuma falha." if not fails else "RESULTADO: HÁ FALHAS (veja as linhas FAIL acima).")
sys.exit(1 if fails else 0)
