import { api } from '../api/index.js';
import { config, saveConfig } from '../config.js';
import { getDown, setDown, resetDb } from '../api/mock/store.js';
import { h, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { card, pageHeader, widget, button, segmented, badge, kv, notice } from '../ui/components.js';
import { formModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { DB_SOURCES } from '../constants.js';
import { money, date } from '../format.js';

const DB_INFO = {
  postgres: {
    stores: ['Máquinas e especificações', 'Usuários', 'Sessões, valores e pagamentos', 'Planos e serviços', 'Programas instalados', 'Incidentes e manutenções', 'Serviço de internet'],
    impact: 'Fonte oficial. Sem ele, cadastros, sessões e o mapa do salão ficam indisponíveis.',
  },
  mongodb: {
    stores: ['Início e fim de sessões', 'Mudanças de estado', 'Erros e diagnósticos', 'Programas executados'],
    impact: 'Feeds de atividade param. Sessões continuam funcionando, mas os eventos não são gravados (o usuário recebe um aviso).',
  },
  cassandra: {
    stores: ['CPU, GPU, RAM e disco', 'Tráfego de rede e latência', 'Temperatura', 'Horário da última comunicação'],
    impact: 'Telemetria e gráficos ficam indisponíveis. O restante do sistema segue operando normalmente.',
  },
};

const ENDPOINTS = [
  ['GET', '/health', null],
  ['GET', '/machines', 'postgres'],
  ['PATCH', '/machines/{id}/status', 'postgres'],
  ['GET', '/machines/{id}/last-user', 'postgres'],
  ['POST', '/sessions', 'postgres'],
  ['POST', '/sessions/{id}/end', 'postgres'],
  ['GET', '/machines/{id}/metrics?from&to', 'cassandra'],
  ['GET', '/metrics/latest', 'cassandra'],
  ['GET', '/events?type&machine_id', 'mongodb'],
  ['GET', '/machines/{id}/events', 'mongodb'],
];
const METHOD_TONE = { GET: 'success', POST: 'primary', PUT: 'warning', PATCH: 'accent', DELETE: 'danger' };

export default {
  render(root) {
    const dbGrid = h('div');
    const internetEl = h('div');

    append(root, [
      pageHeader('Bancos de dados & API', 'Saúde dos serviços, simulação de falhas e configuração da fonte de dados'),
      dataSourceCard(),
      h('div', { class: 'spacer' }),
      dbGrid,
      h(
        'div',
        { class: 'grid grid-2' },
        card({ title: 'Serviço de internet contratado', icon: 'globe', source: 'postgres', body: internetEl, actions: button('Editar', { icon: 'edit', size: 'sm', onClick: () => editInternet() }) }),
        card({ title: 'Principais endpoints', icon: 'code', body: endpointList() }),
      ),
      config.useMock && demoCard(),
    ]);

    const healthCtl = widget(dbGrid, { load: () => api.health(), render: renderDbs, interval: 5000 });
    const internetCtl = widget(internetEl, {
      load: () => api.internet.get(),
      render: (n) =>
        kv([
          ['Provedor', n.provider],
          ['Plano', n.plan_name],
          ['Velocidade', `${n.download_mbps} Mbps ↓ · ${n.upload_mbps} Mbps ↑`],
          ['Mensalidade', money(n.monthly_cost)],
          ['IP público', h('span', { class: 'mono' }, `${n.public_ip ?? '—'}${n.static_ip ? ' (fixo)' : ''}`)],
          ['Contrato desde', date(n.contract_start)],
          ['Suporte', n.support_phone],
        ]),
    });

    async function editInternet() {
      let current;
      try {
        current = await api.internet.get();
      } catch {
        current = {};
      }
      const result = await formModal({
        title: 'Serviço de internet',
        fields: [
          { name: 'provider', label: 'Provedor', required: true },
          { name: 'plan_name', label: 'Plano' },
          { name: 'download_mbps', label: 'Download (Mbps)', type: 'number', required: true, min: 1 },
          { name: 'upload_mbps', label: 'Upload (Mbps)', type: 'number', required: true, min: 1 },
          { name: 'monthly_cost', label: 'Mensalidade (R$)', type: 'number', min: 0, step: 0.01 },
          { name: 'contract_start', label: 'Início do contrato', type: 'date' },
          { name: 'public_ip', label: 'IP público' },
          { name: 'support_phone', label: 'Telefone do suporte' },
          { name: 'static_ip', label: 'IP fixo', type: 'checkbox' },
        ],
        values: current,
        onSubmit: (v) => api.internet.update(v),
      });
      if (result) {
        toast('Dados do serviço de internet atualizados.', 'success');
        internetCtl.refresh();
      }
    }

    function renderDbs(health) {
      return h(
        'div',
        { class: 'grid grid-3' },
        Object.entries(DB_SOURCES).map(([key, db]) => {
          const s = health.services[key];
          const up = s?.status === 'up';
          const toggle = config.useMock
            ? h(
                'label',
                { class: 'switch' },
                h('input', {
                  type: 'checkbox',
                  checked: !!getDown()[key],
                  onchange: (e) => {
                    setDown(key, e.target.checked);
                    toast(e.target.checked ? `${db.label} derrubado na simulação. Navegue pelas telas para ver o impacto.` : `${db.label} restabelecido.`, e.target.checked ? 'warning' : 'success', { title: 'Simulação de falha' });
                    window.dispatchEvent(new Event('lanhouse:health'));
                    healthCtl.refresh();
                  },
                }),
                h('span', { class: 'switch-track' }),
                'Simular indisponibilidade',
              )
            : null;
          return h(
            'section',
            { class: `card db-card src-${key}` },
            h('header', { class: 'card-header' }, h('div', { class: 'card-title' }, icon('database', 16), h('h2', {}, db.label)), badge(up ? 'Operacional' : 'Indisponível', up ? 'success' : 'danger', { dot: true })),
            h(
              'div',
              { class: 'card-body' },
              h('div', { class: 'db-head' }, h('div', {}, h('div', { class: 'db-kind' }, db.kind), h('div', { class: 'db-role' }, db.role)), h('span', { class: 'db-latency' }, up ? `${s.latency_ms} ms` : '— ms')),
              h('ul', { class: 'db-list' }, DB_INFO[key].stores.map((t) => h('li', {}, t))),
              h('div', { class: 'db-impact' }, h('strong', {}, 'Se cair: '), DB_INFO[key].impact),
              toggle,
            ),
          );
        }),
      );
    }

    return () => {
      healthCtl();
      internetCtl();
    };
  },
};

function dataSourceCard() {
  let mode = config.useMock ? 'mock' : 'api';
  const url = h('input', { class: 'input mono', value: config.apiBaseUrl, placeholder: 'http://localhost:8000/api', 'aria-label': 'URL base da API', disabled: mode === 'mock' });
  const testBtn = button('Testar conexão', {
    icon: 'zap',
    onClick: async () => {
      testBtn.classList.add('loading');
      try {
        const res = await fetch(`${url.value.trim().replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast(`A API respondeu: status "${data?.status ?? 'ok'}".`, 'success', { title: 'Conexão bem-sucedida' });
      } catch (err) {
        toast(`Não foi possível acessar ${url.value}/health (${err.message}). Verifique se o back-end está rodando e com CORS liberado.`, 'danger', { title: 'Falha na conexão', timeout: 8000 });
      } finally {
        testBtn.classList.remove('loading');
      }
    },
  });
  const save = button('Salvar e recarregar', {
    variant: 'primary',
    icon: 'check',
    onClick: () => {
      saveConfig({ useMock: mode === 'mock', apiBaseUrl: url.value.trim() || config.apiBaseUrl });
      toast('Configuração salva. Recarregando...', 'success');
      setTimeout(() => location.reload(), 500);
    },
  });

  return card({
    title: 'Fonte de dados',
    icon: 'sliders',
    body: [
      notice(
        config.useMock
          ? 'Você está no modo demonstração: uma API simulada roda no próprio navegador, com o mesmo contrato que o back-end deverá implementar (veja frontend/API.md).'
          : `Conectado à API real em ${config.apiBaseUrl}.`,
        config.useMock ? 'accent' : 'success',
        config.useMock ? 'zap' : 'server',
      ),
      h(
        'div',
        { class: 'toolbar', style: 'margin:0' },
        segmented(
          [
            { value: 'mock', label: 'Demonstração (mock)', icon: 'zap' },
            { value: 'api', label: 'API real', icon: 'server' },
          ],
          mode,
          (v) => {
            mode = v;
            url.disabled = v === 'mock';
          },
        ),
        h('div', { class: 'grow' }, url),
        testBtn,
        save,
      ),
    ],
  });
}

function endpointList() {
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'endpoint-list' },
      ENDPOINTS.map(([method, path, src]) =>
        h('div', { class: 'endpoint' }, h('span', { class: `method tone-${METHOD_TONE[method]}` }, method), h('code', {}, path), src ? h('span', { class: `source-tag src-${src}` }, DB_SOURCES[src].short) : h('span')),
      ),
    ),
    h('p', { class: 'cell-sub', style: 'margin:12px 0 0' }, 'Contrato completo, formatos de resposta e de erro em frontend/API.md.'),
  );
}

function demoCard() {
  return h(
    'div',
    { style: 'margin-top:16px' },
    card({
      title: 'Dados de demonstração',
      icon: 'refresh',
      body: h(
        'div',
        { class: 'toolbar', style: 'margin:0;justify-content:space-between' },
        h('span', { class: 'muted' }, 'Os dados simulados ficam salvos no navegador (localStorage). Restaure para voltar ao cenário inicial.'),
        button('Restaurar dados', {
          icon: 'refresh',
          variant: 'danger',
          onClick: async () => {
            const ok = await confirmDialog({ title: 'Restaurar dados de demonstração?', message: 'Todas as alterações feitas no modo demonstração serão perdidas.', confirmLabel: 'Restaurar', danger: true });
            if (!ok) return;
            resetDb();
            ['postgres', 'mongodb', 'cassandra'].forEach((k) => setDown(k, false));
            toast('Dados restaurados.', 'success');
            setTimeout(() => location.reload(), 400);
          },
        }),
      ),
    }),
  );
}
