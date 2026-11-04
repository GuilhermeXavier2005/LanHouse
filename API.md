# Contrato da API — LanHouse Monitor

Este é o contrato que o front-end consome. Ele já está implementado na **API simulada**
(`js/api/mock/server.js`), então o back-end pode usá-la como referência executável:
qualquer endpoint abaixo pode ser testado no navegador em modo demonstração.

- **Base URL** padrão: `http://localhost:8000/api` (configurável na tela *Bancos & API*).
- Formato: JSON (`Content-Type: application/json`), datas em **ISO 8601 UTC**
  (`2026-10-30T18:27:48.000Z`), exceto campos só de data (`AAAA-MM-DD`).
- IDs numéricos nas tabelas do PostgreSQL; `_id` (ObjectId) nos eventos do MongoDB.
- O back-end precisa liberar **CORS** para a origem do front (ex.: `http://localhost:5173`).

## Convenções

### Listas

Todas as listagens respondem:

```json
{ "items": [ ... ], "total": 42 }
```

Parâmetros comuns: `limit`, `offset`, `q` (busca textual). Filtros por igualdade aceitam
vários valores separados por vírgula: `?status=aberto,em_andamento`.

### Erros

```json
{
  "error": {
    "code": "DB_UNAVAILABLE",
    "message": "Não foi possível consultar o Apache Cassandra.",
    "source": "cassandra",
    "details": null
  }
}
```

| HTTP | `code`              | Quando                                                                    |
|------|---------------------|---------------------------------------------------------------------------|
| 404  | `NOT_FOUND`         | Registro inexistente                                                      |
| 409  | `CONFLICT`          | Regra de negócio violada (ex.: iniciar sessão em máquina ocupada)         |
| 422  | `VALIDATION_ERROR`  | Campos inválidos. `details` = `{ "campo": "mensagem" }` (o front destaca) |
| 503  | `DB_UNAVAILABLE`    | Banco fora do ar. **`source` obrigatório**: `postgres`, `mongodb` ou `cassandra` |

O campo `source` é o que permite ao front mostrar *"Apache Cassandra indisponível"* só nos
blocos de métricas, mantendo o resto da tela funcionando.

### Sucesso parcial (`_warnings`)

Quando a operação principal (PostgreSQL) dá certo mas um registro secundário falha
(ex.: o evento no MongoDB), responda **2xx** com o recurso e um array `_warnings`:

```json
{ "id": 812, "status": "ativa", "...": "...", "_warnings": ["Evento não registrado: MongoDB indisponível."] }
```

O front exibe cada aviso como notificação amarela.

---

## Saúde

### `GET /health`

Não depende de nenhum banco estar no ar.

```json
{
  "status": "degraded",
  "checked_at": "2026-10-30T18:30:00Z",
  "services": {
    "postgres":  { "status": "up",   "latency_ms": 4 },
    "mongodb":   { "status": "down", "latency_ms": null, "error": "connection refused" },
    "cassandra": { "status": "up",   "latency_ms": 11 }
  }
}
```

## Máquinas — PostgreSQL

| Método | Rota                             | Descrição                                                   |
|--------|----------------------------------|-------------------------------------------------------------|
| GET    | `/machines?zone&status&q`        | Lista                                                       |
| GET    | `/machines/{id}`                 | Detalhe                                                     |
| POST   | `/machines`                      | Cria (aceita `status` inicial: `disponivel`, `manutencao`, `offline`) |
| PUT    | `/machines/{id}`                 | Atualiza cadastro (não altera `status`)                     |
| PATCH  | `/machines/{id}/status`          | `{ "status", "reason" }` — muda estado atual + evento `state_changed` no MongoDB. 409 se houver sessão ativa |
| DELETE | `/machines/{id}`                 | 409 se houver sessão ativa                                  |
| GET    | `/machines/{id}/last-user`       | `{ "last_user": {...} \| null }`                            |
| GET    | `/machines/{id}/programs`        | Programas instalados (com `installed_at`)                   |
| PUT    | `/machines/{id}/programs`        | `{ "program_ids": [1, 4, 7] }` — substitui a lista          |

Objeto máquina:

```json
{
  "id": 1, "hostname": "PC-01", "zone": "arena", "status": "em_uso",
  "cpu": "AMD Ryzen 5 5600", "gpu": "NVIDIA GeForce RTX 3060 12 GB",
  "ram_gb": 16, "storage_gb": 1000, "os": "Windows 11 Pro 23H2",
  "ip": "192.168.10.11", "mac": "00:1A:2B:3C:4D:5E", "notes": "",
  "created_at": "...", "updated_at": "...",
  "active_session_id": 812,
  "last_user": { "id": 9, "name": "Larissa Ferreira", "nickname": "lari_fps", "session_id": 812, "at": "...", "in_session": true }
}
```

- `zone`: `arena` | `vip` | `navegacao`
- `status`: `disponivel` | `em_uso` | `manutencao` | `offline` (`em_uso` só via sessões)

## Métricas — Cassandra

| Método | Rota                                         | Descrição                                   |
|--------|----------------------------------------------|---------------------------------------------|
| GET    | `/machines/{id}/metrics?from&to&step`        | Série temporal do período (`step` em segundos, opcional; máx. 31 dias) |
| GET    | `/machines/{id}/metrics/latest`              | Última amostra da máquina                    |
| GET    | `/metrics/latest`                            | Última amostra de **todas** as máquinas      |

Amostra:

```json
{
  "machine_id": 1, "hostname": "PC-01", "ts": "2026-10-30T18:30:00Z",
  "cpu_pct": 58.2, "gpu_pct": 71.0, "ram_pct": 63.4, "ram_used_gb": 10.1, "ram_total_gb": 16,
  "disk_pct": 72.5, "net_in_kbps": 5120, "net_out_kbps": 640, "latency_ms": 14.2, "temp_c": 67.8
}
```

`/latest` inclui também `last_seen_at`. A série (`/metrics`) responde
`{ "machine_id", "from", "to", "step_seconds", "items": [amostras] }`.
Sugestão de tabela: `metrics_by_machine ((machine_id, day), ts)` com `ts DESC`.

## Eventos — MongoDB

| Método | Rota                                         | Descrição                       |
|--------|----------------------------------------------|---------------------------------|
| GET    | `/events?type&machine_id&from&to&q&limit&offset` | Lista (mais recentes primeiro; `limit` padrão 50) |
| GET    | `/events/{_id}`                              | Documento                        |
| GET    | `/machines/{id}/events?type&limit`           | Eventos de uma máquina (`limit` padrão 20) |

Documento:

```json
{
  "_id": "6722a1f0c3b5e8a91d2f4e10",
  "type": "session_started",
  "machine_id": 1, "machine_hostname": "PC-01",
  "timestamp": "2026-10-30T16:32:00Z",
  "session_id": 812,
  "payload": { "session_id": 812, "user_id": 9, "user_nickname": "lari_fps", "plan_id": 2, "plan_name": "Hora Gamer" }
}
```

Tipos e `payload`:

| `type`            | `payload`                                                            |
|-------------------|----------------------------------------------------------------------|
| `session_started` | `session_id, user_id, user_nickname, plan_id, plan_name`             |
| `session_ended`   | `session_id, user_nickname, duration_minutes, amount`                |
| `state_changed`   | `from, to, reason`                                                   |
| `program_started` | `program_id, program, executable, pid`                               |
| `error`           | `level, code, message, ...` (livre)                                  |
| `diagnostic`      | `incident_id, technician, summary, checks: [{ name, result, ok }]`   |
| `incident_opened` | `incident_id, title, severity`                                       |

## Sessões — PostgreSQL

| Método | Rota                         | Descrição |
|--------|------------------------------|-----------|
| GET    | `/sessions?status&payment_status&machine_id&user_id&from&to&q&limit&offset` | Lista (mais recentes primeiro). Inclui `total_paid` e `total_pending` do filtro |
| GET    | `/sessions/{id}`             | Detalhe |
| POST   | `/sessions`                  | `{ machine_id, user_id, plan_id }` — inicia; máquina vai para `em_uso`. 409 se a máquina não estiver `disponivel` ou o usuário já estiver em sessão |
| POST   | `/sessions/{id}/end`         | `{ payment_method, payment_status: "pago" \| "pendente" }` — calcula duração e valor; máquina volta para `disponivel` |
| PATCH  | `/sessions/{id}`             | `{ payment_status, payment_method }` — registrar pagamento posterior |

Sessão (com dados de junção para exibição):

```json
{
  "id": 812, "machine_id": 1, "user_id": 9, "plan_id": 2,
  "started_at": "...", "ended_at": null, "duration_minutes": null, "amount": null,
  "payment_method": null, "payment_status": "pendente", "status": "ativa",
  "machine_hostname": "PC-01", "machine_zone": "arena",
  "user_name": "Larissa Ferreira", "user_nickname": "lari_fps",
  "plan_name": "Hora Gamer", "plan_billing": "hora", "plan_price": 7, "plan_hours": null
}
```

**Cobrança** (mesma regra em `js/pricing.js`): blocos de 15 minutos.
`hora` → `ceil(min/15) × 15/60 × preço` (mínimo 1 bloco); `pacote` → preço fixo +
excedente pelo valor/hora do pacote. O valor oficial é sempre o calculado pela API.

`payment_method`: `pix` | `dinheiro` | `cartao_debito` | `cartao_credito`

## Cadastros — PostgreSQL (CRUD padrão)

Todos com `GET /recurso`, `GET /recurso/{id}`, `POST`, `PUT /recurso/{id}`,
`PATCH /recurso/{id}` (parcial) e `DELETE /recurso/{id}`.

| Recurso         | Campos                                                                 | Filtros |
|-----------------|------------------------------------------------------------------------|---------|
| `/users`        | `name`*, `nickname`* (único), `phone` + calculados `sessions_count`, `last_session_at`, `in_session` | `q` |
| `/plans`        | `name`*, `kind`* (`plano`\|`servico`), `billing`* (`hora`\|`pacote`\|`unidade`), `price`*, `hours` (obrigatório em pacote), `description`, `active` | `kind`, `billing`, `active` |
| `/programs`     | `name`*, `category`* (`jogo`, `launcher`, `navegador`, `comunicacao`, `produtividade`, `utilitario`), `publisher`, `version`, `license` (`gratuito`\|`pago`) + `machines_count` | `category`, `license` |
| `/incidents`    | `machine_id`*, `title`*, `description`, `severity`* (`baixa`\|`media`\|`alta`\|`critica`), `status`* (`aberto`\|`em_andamento`\|`resolvido`), `reported_by` + `opened_at`, `resolved_at`, `machine_hostname` | `status`, `severity`, `machine_id` |
| `/maintenances` | `machine_id`*, `incident_id`, `type`* (`preventiva`\|`corretiva`), `description`*, `technician`, `cost`, `scheduled_for` (data), `status`* (`agendada`\|`em_andamento`\|`concluida`) + `completed_at`, `machine_hostname` | `type`, `status`, `machine_id`, `incident_id` |

Regras: 409 ao excluir usuário em sessão ativa, ou plano usado por sessão ativa.
Ao abrir incidente, gravar evento `incident_opened` no MongoDB.
`resolved_at` / `completed_at` são preenchidos pelo back-end ao mudar o status.

## Relatórios e internet — PostgreSQL

| Método | Rota                          | Resposta |
|--------|-------------------------------|----------|
| GET    | `/reports/summary`            | `{ date, sessions_today, active_sessions, revenue_today, pending_amount, avg_duration_minutes }` |
| GET    | `/reports/revenue?days=7`     | `{ items: [{ date: "AAAA-MM-DD", total, sessions }] }` — sessões pagas por dia de encerramento |
| GET    | `/internet-service`           | `{ provider, plan_name, download_mbps, upload_mbps, monthly_cost, contract_start, public_ip, static_ip, support_phone }` |
| PUT    | `/internet-service`           | Atualiza os mesmos campos |
