# LanHouse Monitor — Front-end

Painel web para operar e monitorar a lan house: mapa do salão em tempo real, sessões,
máquinas, métricas técnicas, eventos, incidentes, manutenções e cadastros.

Feito em **HTML + CSS + JavaScript puro (ES Modules)** — sem framework, sem build e sem
`npm install`. Basta um servidor de arquivos estáticos.

## Como rodar

**No Windows:** dê dois cliques em `iniciar.bat`. Ele sobe o servidor e abre o navegador.
Deixe a janela do servidor aberta enquanto usa o painel.

Ou, pelo terminal, na pasta `frontend/`:

```bash
py serve.py
```

Abra <http://localhost:5173>. (Em Linux/macOS use `python3 serve.py`.)

> Abrir o `index.html` direto pelo explorador de arquivos **não funciona**: navegadores
> bloqueiam ES Modules em `file://`. O `serve.py` é um `http.server` que também desliga o
> cache, para que alterações apareçam com F5.

## Modo demonstração × API real

Por padrão o front roda em **modo demonstração**: uma API simulada roda dentro do
navegador (`js/api/mock/`), com dados de exemplo salvos no `localStorage`. Ela segue
exatamente o contrato de [`API.md`](API.md), inclusive validações (422), conflitos (409) e
indisponibilidade de banco (503).

Quando o back-end existir:

1. Implemente os endpoints de [`API.md`](API.md) e libere CORS para `http://localhost:5173`.
2. No painel, vá em **Bancos & API → Fonte de dados**, escolha *API real*, informe a URL
   (ex.: `http://localhost:8000/api`), clique em *Testar conexão* e depois *Salvar*.

Também dá para mudar o padrão em `js/config.js` (`useMock: false`).

## Simulação de falhas nos bancos

Em **Bancos & API**, cada banco tem a chave *Simular indisponibilidade*. Com ela é possível
ver, na prática, o comportamento pedido no projeto:

| Banco fora     | O que acontece na interface |
|----------------|-----------------------------|
| PostgreSQL     | Cadastros, sessões, mapa e KPIs mostram erro; telemetria e eventos continuam. |
| MongoDB        | Feeds de eventos mostram erro; sessões e mudanças de estado **continuam funcionando**, com aviso de que o evento não foi gravado. |
| Cassandra      | Gráficos e barras de CPU/RAM somem com aviso; mapa, sessões e cadastros seguem normais. |

Cada bloco da tela mostra uma etiqueta com o banco de onde vêm seus dados
(PostgreSQL / MongoDB / Cassandra).

## Estrutura

```text
frontend/
├── index.html
├── serve.py                 servidor de desenvolvimento (sem cache)
├── API.md                   contrato da API para o back-end
├── assets/                  favicon
├── css/styles.css           tema visual (tokens de cor, componentes, responsivo)
└── js/
    ├── app.js               shell: menu, barra superior, saúde dos bancos, rotas
    ├── router.js            roteador por hash (#/maquinas/3)
    ├── config.js            mock × API real, URL, intervalo de atualização
    ├── constants.js         enums do domínio (estados, severidades, tipos de evento…)
    ├── format.js            formatação pt-BR (moeda, datas, durações)
    ├── pricing.js           regra de cobrança das sessões
    ├── api/
    │   ├── client.js        fetch + tratamento padronizado de erros e avisos
    │   ├── errors.js        ApiError
    │   ├── index.js         mapa de endpoints (api.machines.list(), …)
    │   └── mock/            API simulada (rotas, dados de exemplo, gerador de métricas)
    ├── ui/                  componentes: modal/formulário, gráficos, mapa do salão, toasts…
    └── pages/               uma tela por arquivo
```

Para trocar a fonte de dados de uma tela, mexa apenas em `js/api/index.js`; as telas
nunca chamam `fetch` diretamente.

## Telas

- **Visão geral** — KPIs, mapa do salão ao vivo, atividade recente, incidentes, faturamento e consumo de CPU.
- **Máquinas** — mapa ou tabela com filtros; CRUD. O detalhe tem telemetria ao vivo, histórico de métricas, sessões, programas, incidentes/manutenções e eventos.
- **Sessões** — sessões ativas com cronômetro e valor estimado, iniciar/encerrar, histórico com filtros e recebimento de pendências.
- **Métricas** — última comunicação de cada máquina e histórico por período (1 h, 6 h, 24 h, 7 dias).
- **Eventos** — linha do tempo dos documentos do MongoDB, com visualização do JSON.
- **Incidentes / Manutenções** — acompanhamento, ações rápidas e custos.
- **Usuários / Planos & serviços / Programas** — cadastros.
- **Bancos & API** — saúde dos bancos, simulação de falhas, fonte de dados, serviço de internet.
