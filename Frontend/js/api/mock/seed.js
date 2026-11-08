// Dados de demonstração gerados de forma determinística (mesma semente → mesmos dados),
// com datas relativas ao momento da geração.

import { sessionAmount } from '../../pricing.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function createSeed(now = Date.now()) {
  const rand = mulberry32(20261030);
  const int = (a, b) => Math.floor(a + rand() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const iso = (ms) => new Date(ms).toISOString();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  const objectId = (ms) => Math.floor(ms / 1000).toString(16).padStart(8, '0') + hex(16);
  const shuffle = (arr) => arr.map((v) => [rand(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

  // ---------------------------------------------------------------- máquinas
  const zones = [
    {
      zone: 'arena', prefix: 'PC', count: 12, os: 'Windows 11 Pro 23H2',
      specs: [
        { cpu: 'AMD Ryzen 5 5600', gpu: 'NVIDIA GeForce RTX 3060 12 GB', ram_gb: 16, storage_gb: 1000 },
        { cpu: 'Intel Core i5-12400F', gpu: 'NVIDIA GeForce RTX 3060 Ti 8 GB', ram_gb: 16, storage_gb: 1000 },
      ],
    },
    {
      zone: 'vip', prefix: 'VIP', count: 4, os: 'Windows 11 Pro 23H2',
      specs: [{ cpu: 'AMD Ryzen 7 7800X3D', gpu: 'NVIDIA GeForce RTX 4070 Super 12 GB', ram_gb: 32, storage_gb: 2000 }],
    },
    {
      zone: 'navegacao', prefix: 'NAV', count: 6, os: 'Windows 11 Home 23H2',
      specs: [{ cpu: 'Intel Core i3-12100', gpu: 'Intel UHD Graphics 730', ram_gb: 8, storage_gb: 256 }],
    },
  ];
  const initialStatus = {
    'PC-04': 'disponivel', 'PC-07': 'disponivel', 'PC-12': 'disponivel', 'PC-10': 'manutencao',
    'VIP-02': 'disponivel', 'VIP-04': 'manutencao',
    'NAV-02': 'disponivel', 'NAV-03': 'disponivel', 'NAV-05': 'disponivel', 'NAV-06': 'offline',
  };
  const notes = {
    'PC-10': 'GPU superaquecendo — aguardando troca de pasta térmica.',
    'VIP-04': 'Fonte em substituição.',
    'NAV-06': 'Sem comunicação desde a tarde de hoje.',
  };

  const machines = [];
  let ip = 11;
  for (const z of zones) {
    for (let i = 1; i <= z.count; i++) {
      const hostname = `${z.prefix}-${String(i).padStart(2, '0')}`;
      const spec = z.specs[(i - 1) % z.specs.length];
      machines.push({
        id: machines.length + 1,
        hostname,
        zone: z.zone,
        status: initialStatus[hostname] ?? 'em_uso',
        ...spec,
        os: z.os,
        ip: `192.168.10.${ip++}`,
        mac: `00:1A:2B:${hex(2)}:${hex(2)}:${hex(2)}`.toUpperCase(),
        notes: notes[hostname] ?? '',
        created_at: iso(now - int(220, 640) * DAY),
        updated_at: iso(now - int(1, 20) * DAY),
        last_seen_at: null,
      });
    }
  }
  const byHost = Object.fromEntries(machines.map((m) => [m.hostname, m]));
  byHost['NAV-06'].last_seen_at = iso(now - 3 * HOUR - 12 * MIN);
  byHost['VIP-04'].last_seen_at = iso(now - 26 * HOUR);

  // ---------------------------------------------------------------- usuários
  const people = [
    ['Lucas Martins', 'lukinhas'], ['Ana Beatriz Souza', 'anabia'], ['Pedro Henrique Lima', 'phzin'],
    ['Gabriel Costa', 'gabsniper'], ['Mariana Oliveira', 'mari_gg'], ['João Victor Alves', 'jvzera'],
    ['Rafaela Santos', 'rafa.exe'], ['Matheus Rocha', 'mthrocha'], ['Larissa Ferreira', 'lari_fps'],
    ['Thiago Ribeiro', 'thiagao'], ['Beatriz Carvalho', 'biazinha'], ['Felipe Araújo', 'lipe_tryhard'],
    ['Camila Mendes', 'camz'], ['Bruno Teixeira', 'brunotx'], ['Isabela Gomes', 'isagomes'],
    ['Gustavo Barbosa', 'gustaboom'], ['Vinícius Pereira', 'vini_jg'], ['Letícia Moreira', 'leh'],
  ];
  const users = people.map(([name, nickname], i) => ({
    id: i + 1,
    name,
    nickname,
    phone: rand() > 0.35 ? `(11) 9${int(1000, 9999)}-${int(1000, 9999)}` : null,
    created_at: iso(now - int(10, 400) * DAY),
  }));

  // ---------------------------------------------------------------- planos e serviços
  const plans = [
    { id: 1, name: 'Hora Avulsa', kind: 'plano', billing: 'hora', price: 5, hours: null, description: 'Máquinas da área de navegação: internet, trabalhos e documentos.', active: true },
    { id: 2, name: 'Hora Gamer', kind: 'plano', billing: 'hora', price: 7, hours: null, description: 'Arena Gamer com RTX 3060, monitor 165 Hz e headset.', active: true },
    { id: 3, name: 'Hora VIP', kind: 'plano', billing: 'hora', price: 12, hours: null, description: 'Sala VIP com RTX 4070 Super, cadeira gamer e sala climatizada.', active: true },
    { id: 4, name: 'Pacote 3h Gamer', kind: 'plano', billing: 'pacote', price: 18, hours: 3, description: 'Três horas na Arena com desconto. Excedente cobrado proporcionalmente.', active: true },
    { id: 5, name: 'Madrugadão', kind: 'plano', billing: 'pacote', price: 25, hours: 6, description: 'Das 00h às 06h em qualquer máquina da Arena.', active: true },
    { id: 6, name: 'Impressão P&B', kind: 'servico', billing: 'unidade', price: 1, hours: null, description: 'Por página, A4.', active: true },
    { id: 7, name: 'Impressão colorida', kind: 'servico', billing: 'unidade', price: 2.5, hours: null, description: 'Por página, A4.', active: true },
    { id: 8, name: 'Digitalização', kind: 'servico', billing: 'unidade', price: 1.5, hours: null, description: 'Por página, enviada por e-mail ou pendrive.', active: true },
  ].map((p) => ({ ...p, created_at: iso(now - 300 * DAY) }));
  const planById = Object.fromEntries(plans.map((p) => [p.id, p]));

  // ---------------------------------------------------------------- programas
  const programDefs = [
    ['Steam', 'launcher', 'Valve', '2.10', 'gratuito'],
    ['Epic Games Launcher', 'launcher', 'Epic Games', '17.2', 'gratuito'],
    ['Riot Client', 'launcher', 'Riot Games', '96.0', 'gratuito'],
    ['Counter-Strike 2', 'jogo', 'Valve', '1.40.3', 'gratuito'],
    ['Valorant', 'jogo', 'Riot Games', '9.08', 'gratuito'],
    ['League of Legends', 'jogo', 'Riot Games', '14.21', 'gratuito'],
    ['Fortnite', 'jogo', 'Epic Games', '31.40', 'gratuito'],
    ['Minecraft', 'jogo', 'Mojang', '1.21.3', 'pago'],
    ['GTA V', 'jogo', 'Rockstar Games', '1.69', 'pago'],
    ['Roblox', 'jogo', 'Roblox Corp.', '0.648', 'gratuito'],
    ['EA Sports FC 25', 'jogo', 'Electronic Arts', '1.08', 'pago'],
    ['Discord', 'comunicacao', 'Discord Inc.', '1.0.9170', 'gratuito'],
    ['Google Chrome', 'navegador', 'Google', '130.0', 'gratuito'],
    ['Mozilla Firefox', 'navegador', 'Mozilla', '132.0', 'gratuito'],
    ['Microsoft 365', 'produtividade', 'Microsoft', '2410', 'pago'],
    ['LibreOffice', 'produtividade', 'The Document Foundation', '24.8', 'gratuito'],
    ['Adobe Acrobat Reader', 'produtividade', 'Adobe', '24.004', 'gratuito'],
    ['OBS Studio', 'utilitario', 'OBS Project', '30.2', 'gratuito'],
    ['7-Zip', 'utilitario', 'Igor Pavlov', '24.08', 'gratuito'],
    ['VLC Media Player', 'utilitario', 'VideoLAN', '3.0.21', 'gratuito'],
  ];
  const programs = programDefs.map(([name, category, publisher, version, license], i) => ({
    id: i + 1, name, category, publisher, version, license, created_at: iso(now - 200 * DAY),
  }));
  const prog = (name) => programs.find((p) => p.name === name).id;
  const games = programs.filter((p) => p.category === 'jogo').map((p) => p.id);
  const base = ['Steam', 'Epic Games Launcher', 'Riot Client', 'Discord', 'Google Chrome', 'OBS Studio', '7-Zip'].map(prog);
  const office = ['Google Chrome', 'Mozilla Firefox', 'Microsoft 365', 'LibreOffice', 'Adobe Acrobat Reader', 'VLC Media Player', '7-Zip', 'Discord', 'Roblox'].map(prog);

  const machinePrograms = [];
  for (const m of machines) {
    let ids;
    if (m.zone === 'navegacao') ids = office;
    else if (m.zone === 'vip') ids = [...base, ...games];
    else ids = [...base, ...shuffle(games).slice(0, int(5, 8))];
    for (const pid of ids) machinePrograms.push({ machine_id: m.id, program_id: pid, installed_at: iso(now - int(5, 180) * DAY) });
  }
  const programsOf = (mid) => machinePrograms.filter((x) => x.machine_id === mid).map((x) => programs.find((p) => p.id === x.program_id));

  // ---------------------------------------------------------------- sessões
  const sessions = [];
  const payMethods = ['pix', 'pix', 'pix', 'dinheiro', 'cartao_debito', 'cartao_credito'];
  const planFor = (m) => (m.zone === 'vip' ? planById[3] : m.zone === 'navegacao' ? planById[1] : rand() < 0.28 ? planById[4] : planById[2]);

  const activeStart = {};
  const activeUser = {};
  const freeUsers = shuffle(users.map((u) => u.id));
  machines.filter((m) => m.status === 'em_uso').forEach((m, i) => {
    activeStart[m.id] = now - int(6, 170) * MIN;
    activeUser[m.id] = freeUsers[i % freeUsers.length];
  });
  const outageStart = {
    [byHost['PC-10'].id]: now - 28 * HOUR,
    [byHost['VIP-04'].id]: now - 26 * HOUR,
    [byHost['NAV-06'].id]: now - 3 * HOUR - 15 * MIN,
  };

  for (let d = 7; d >= 0; d--) {
    const dayStart = startOfDay(now - d * DAY);
    for (const m of machines) {
      const limit = Math.min(activeStart[m.id] ?? now, outageStart[m.id] ?? now) - 5 * MIN;
      let cursor = dayStart + 9 * HOUR + int(0, 150) * MIN;
      const count = int(2, 5);
      for (let k = 0; k < count; k++) {
        const plan = planFor(m);
        const minutes = plan.billing === 'pacote' ? int(plan.hours * 60 - 40, plan.hours * 60 + 10) : int(25, 200);
        const start = cursor;
        const end = start + minutes * MIN;
        if (end > limit || end > dayStart + DAY) break;
        const paid = rand() > 0.04;
        sessions.push({
          machine_id: m.id,
          user_id: pick(users).id,
          plan_id: plan.id,
          started_at: iso(start),
          ended_at: iso(end),
          duration_minutes: minutes,
          amount: sessionAmount(plan, minutes),
          payment_method: pick(payMethods),
          payment_status: paid ? 'pago' : 'pendente',
          status: 'encerrada',
        });
        cursor = end + int(10, 140) * MIN;
      }
    }
  }
  for (const m of machines.filter((x) => x.status === 'em_uso')) {
    sessions.push({
      machine_id: m.id,
      user_id: activeUser[m.id],
      plan_id: planFor(m).id,
      started_at: iso(activeStart[m.id]),
      ended_at: null,
      duration_minutes: null,
      amount: null,
      payment_method: null,
      payment_status: 'pendente',
      status: 'ativa',
    });
  }
  sessions.sort((a, b) => a.started_at.localeCompare(b.started_at)).forEach((s, i) => (s.id = i + 1));

  // ---------------------------------------------------------------- incidentes e manutenções
  const incidents = [
    { machine: 'PC-10', title: 'Placa de vídeo superaquecendo', description: 'GPU chegando a 94 °C com o jogo aberto; a máquina desligou duas vezes.', severity: 'alta', status: 'em_andamento', opened: now - 28 * HOUR, resolved: null, by: 'Atendente (Diego)' },
    { machine: 'VIP-04', title: 'Máquina não liga', description: 'Desligou durante uma sessão e não liga mais. Suspeita de fonte queimada.', severity: 'critica', status: 'em_andamento', opened: now - 26 * HOUR, resolved: null, by: 'Atendente (Diego)' },
    { machine: 'NAV-06', title: 'Sem comunicação com o servidor', description: 'Agente de monitoramento parou de enviar heartbeat.', severity: 'media', status: 'aberto', opened: now - 3 * HOUR, resolved: null, by: 'Monitoramento automático' },
    { machine: 'PC-03', title: 'Headset com chiado no lado esquerdo', description: 'Cliente relatou chiado constante no fone esquerdo.', severity: 'baixa', status: 'aberto', opened: now - 5 * HOUR, resolved: null, by: 'Cliente (@phzin)' },
    { machine: 'PC-05', title: 'Queda de FPS em Valorant', description: 'FPS caindo de 240 para ~60 após alguns minutos. Driver de vídeo reiniciou.', severity: 'media', status: 'aberto', opened: now - 4.5 * HOUR, resolved: null, by: 'Cliente (@gabsniper)' },
    { machine: 'PC-07', title: 'Teclas W e A falhando', description: 'Teclado mecânico com falha intermitente nas teclas W e A.', severity: 'media', status: 'resolvido', opened: now - 2.2 * DAY, resolved: now - 1.6 * DAY, by: 'Cliente (@lari_fps)' },
    { machine: 'NAV-02', title: 'Navegador travando ao abrir PDFs', description: 'Chrome fecha sozinho ao abrir boletos em PDF.', severity: 'baixa', status: 'resolvido', opened: now - 9 * HOUR, resolved: now - 7 * HOUR, by: 'Atendente (Carla)' },
    { machine: 'PC-12', title: 'Mouse com duplo clique', description: 'Botão esquerdo registrando cliques duplos.', severity: 'baixa', status: 'resolvido', opened: now - 4.3 * DAY, resolved: now - 4 * DAY, by: 'Cliente (@jvzera)' },
    { machine: 'VIP-01', title: 'Monitor piscando', description: 'Tela pisca em 240 Hz. Testar cabo DisplayPort.', severity: 'media', status: 'resolvido', opened: now - 6 * DAY, resolved: now - 5.8 * DAY, by: 'Atendente (Diego)' },
  ].map((x, i) => ({
    id: i + 1,
    machine_id: byHost[x.machine].id,
    title: x.title,
    description: x.description,
    severity: x.severity,
    status: x.status,
    reported_by: x.by,
    opened_at: iso(x.opened),
    resolved_at: x.resolved ? iso(x.resolved) : null,
    created_at: iso(x.opened),
  }));

  const dateOnly = (ms) => iso(ms).slice(0, 10);
  const maintenances = [
    { machine: 'PC-10', incident: 1, type: 'corretiva', description: 'Troca de pasta térmica e limpeza do cooler da GPU.', technician: 'Carlos Henrique', cost: 120, when: now - 20 * HOUR, done: null, status: 'em_andamento' },
    { machine: 'VIP-04', incident: 2, type: 'corretiva', description: 'Substituição da fonte por modelo 750 W 80 Plus Gold.', technician: 'Carlos Henrique', cost: 489.9, when: now, done: null, status: 'em_andamento' },
    { machine: 'PC-07', incident: 6, type: 'corretiva', description: 'Troca do teclado mecânico.', technician: 'Diego Prado', cost: 189.9, when: now - 1.7 * DAY, done: now - 1.6 * DAY, status: 'concluida' },
    { machine: 'NAV-02', incident: 7, type: 'corretiva', description: 'Reinstalação do Chrome e limpeza de cache.', technician: 'Carla Nunes', cost: 0, when: now - 8 * HOUR, done: now - 7 * HOUR, status: 'concluida' },
    { machine: 'PC-12', incident: 8, type: 'corretiva', description: 'Troca do mouse.', technician: 'Diego Prado', cost: 129.9, when: now - 4.1 * DAY, done: now - 4 * DAY, status: 'concluida' },
    { machine: 'VIP-01', incident: 9, type: 'corretiva', description: 'Troca do cabo DisplayPort 1.4.', technician: 'Carlos Henrique', cost: 59.9, when: now - 5.9 * DAY, done: now - 5.8 * DAY, status: 'concluida' },
    { machine: 'PC-01', incident: null, type: 'preventiva', description: 'Limpeza interna, troca de filtros e revisão de cabos.', technician: 'Carlos Henrique', cost: 40, when: now - 6 * DAY, done: now - 6 * DAY, status: 'concluida' },
    { machine: 'PC-02', incident: null, type: 'preventiva', description: 'Limpeza interna, troca de filtros e revisão de cabos.', technician: 'Carlos Henrique', cost: 40, when: now - 6 * DAY, done: now - 6 * DAY, status: 'concluida' },
    { machine: 'PC-08', incident: null, type: 'preventiva', description: 'Limpeza interna e troca de pasta térmica da CPU.', technician: 'Carlos Henrique', cost: 60, when: now + 2 * DAY, done: null, status: 'agendada' },
    { machine: 'NAV-01', incident: null, type: 'preventiva', description: 'Atualização do Windows, drivers e antivírus.', technician: 'Carla Nunes', cost: 0, when: now + 3 * DAY, done: null, status: 'agendada' },
    { machine: 'NAV-03', incident: null, type: 'preventiva', description: 'Atualização do Windows, drivers e antivírus.', technician: 'Carla Nunes', cost: 0, when: now + 3 * DAY, done: null, status: 'agendada' },
  ].map((x, i) => ({
    id: i + 1,
    machine_id: byHost[x.machine].id,
    incident_id: x.incident,
    type: x.type,
    description: x.description,
    technician: x.technician,
    cost: x.cost,
    scheduled_for: dateOnly(x.when),
    completed_at: x.done ? iso(x.done) : null,
    status: x.status,
    created_at: iso(Math.min(x.when, now)),
  }));

  const internet = {
    provider: 'FibraMax Telecom',
    plan_name: 'Empresarial 1 Giga',
    download_mbps: 1000,
    upload_mbps: 500,
    monthly_cost: 449.9,
    contract_start: '2025-03-01',
    public_ip: '200.155.32.18',
    static_ip: true,
    support_phone: '0800 000 1234',
  };

  // ---------------------------------------------------------------- eventos (MongoDB)
  const events = [];
  const push = (ms, machine, type, payload, sessionId) => {
    events.push({
      _id: objectId(ms),
      type,
      machine_id: machine.id,
      machine_hostname: machine.hostname,
      timestamp: iso(ms),
      ...(sessionId ? { session_id: sessionId } : {}),
      payload,
    });
  };
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const machineById = Object.fromEntries(machines.map((m) => [m.id, m]));
  const exe = (name) => `${name.replace(/[^a-z0-9]/gi, '')}.exe`;

  for (const s of sessions) {
    const start = Date.parse(s.started_at);
    if (start < now - 36 * HOUR) continue;
    const m = machineById[s.machine_id];
    const u = userById[s.user_id];
    const end = s.ended_at ? Date.parse(s.ended_at) : now;
    push(start, m, 'session_started', { session_id: s.id, user_id: u.id, user_nickname: u.nickname, plan_id: s.plan_id, plan_name: planById[s.plan_id].name }, s.id);
    push(start + 1000, m, 'state_changed', { from: 'disponivel', to: 'em_uso', reason: 'Início de sessão' }, s.id);
    const apps = programsOf(m.id).filter((p) => ['jogo', 'navegador', 'produtividade', 'comunicacao'].includes(p.category));
    for (let k = 0; k < int(1, 3); k++) {
      const at = start + int(1, 25) * MIN;
      if (at >= end) break;
      const p = pick(apps);
      push(at, m, 'program_started', { program_id: p.id, program: p.name, executable: exe(p.name), pid: int(1200, 18000) }, s.id);
    }
    if (s.ended_at) {
      push(end, m, 'session_ended', { session_id: s.id, user_nickname: u.nickname, duration_minutes: s.duration_minutes, amount: s.amount }, s.id);
      push(end + 1000, m, 'state_changed', { from: 'em_uso', to: 'disponivel', reason: 'Fim de sessão' }, s.id);
    }
  }

  const pc10 = byHost['PC-10'];
  push(now - 30 * HOUR, pc10, 'error', { level: 'warning', code: 'GPU_TEMP_HIGH', message: 'Temperatura da GPU acima do limite (91 °C)', value: 91, threshold: 85 });
  push(now - 28.2 * HOUR, pc10, 'error', { level: 'critical', code: 'THERMAL_SHUTDOWN', message: 'Desligamento por proteção térmica', value: 96, threshold: 85 });
  push(now - 28 * HOUR, pc10, 'state_changed', { from: 'disponivel', to: 'manutencao', reason: 'Superaquecimento da GPU' });
  push(now - 28 * HOUR + MIN, pc10, 'incident_opened', { incident_id: 1, title: 'Placa de vídeo superaquecendo', severity: 'alta' });
  push(now - 20 * HOUR, pc10, 'diagnostic', {
    incident_id: 1,
    technician: 'Carlos Henrique',
    summary: 'Pasta térmica ressecada e cooler da GPU com acúmulo de poeira.',
    checks: [
      { name: 'Temperatura GPU (carga)', result: '94 °C', ok: false },
      { name: 'Rotação do cooler', result: '1.150 RPM', ok: false },
      { name: 'Memória (MemTest86)', result: 'sem erros', ok: true },
      { name: 'SMART do SSD', result: 'saudável', ok: true },
    ],
  });

  const vip4 = byHost['VIP-04'];
  push(now - 26 * HOUR, vip4, 'error', { level: 'critical', code: 'POWER_FAILURE', message: 'Perda de energia inesperada (Kernel-Power 41)' });
  push(now - 26 * HOUR + 30_000, vip4, 'state_changed', { from: 'em_uso', to: 'manutencao', reason: 'Máquina não liga' });
  push(now - 26 * HOUR + MIN, vip4, 'incident_opened', { incident_id: 2, title: 'Máquina não liga', severity: 'critica' });
  push(now - 24 * HOUR, vip4, 'diagnostic', {
    incident_id: 2,
    technician: 'Carlos Henrique',
    summary: 'Fonte sem saída de 12 V. Demais componentes testados em bancada sem defeitos.',
    checks: [
      { name: 'Teste da fonte (multímetro)', result: '0 V na linha 12 V', ok: false },
      { name: 'Placa-mãe em bancada', result: 'POST ok com outra fonte', ok: true },
    ],
  });

  const nav6 = byHost['NAV-06'];
  push(now - 3 * HOUR - 12 * MIN, nav6, 'error', { level: 'warning', code: 'HEARTBEAT_LOST', message: 'Agente de monitoramento sem resposta', last_heartbeat: iso(now - 3 * HOUR - 12 * MIN) });
  push(now - 3 * HOUR - 7 * MIN, nav6, 'state_changed', { from: 'disponivel', to: 'offline', reason: 'Sem heartbeat há 5 minutos' });
  push(now - 3 * HOUR, nav6, 'incident_opened', { incident_id: 3, title: 'Sem comunicação com o servidor', severity: 'media' });

  push(now - 4.6 * HOUR, byHost['PC-05'], 'error', { level: 'warning', code: 'GPU_DRIVER_RESET', message: 'O driver de vídeo parou de responder e foi recuperado', driver: 'NVIDIA 566.36' });
  push(now - 4.5 * HOUR, byHost['PC-05'], 'incident_opened', { incident_id: 5, title: 'Queda de FPS em Valorant', severity: 'media' });
  push(now - 5 * HOUR, byHost['PC-03'], 'incident_opened', { incident_id: 4, title: 'Headset com chiado no lado esquerdo', severity: 'baixa' });
  push(now - 9.1 * HOUR, byHost['NAV-02'], 'error', { level: 'error', code: 'APP_CRASH', message: 'chrome.exe encerrado inesperadamente (0xc0000005)', program: 'Google Chrome' });

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    seeded_at: iso(now),
    seq: {},
    machines,
    users,
    plans,
    programs,
    machine_programs: machinePrograms,
    sessions,
    incidents,
    maintenances,
    internet,
    events,
  };
}
