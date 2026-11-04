import { api } from '../api/index.js';
import { config } from '../config.js';
import { h, debounce, loadPref, savePref } from '../ui/dom.js';
import { card, pageHeader, widget, button, iconButton, segmented, select, searchBox, table, cellStack, statusBadge, notice } from '../ui/components.js';
import { formModal, confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { floorMap, miniBar, isStale } from '../ui/floor.js';
import { MACHINE_STATUS, ZONES, toOptions } from '../constants.js';
import { relative, storage } from '../format.js';

export function machineFields({ creating = false } = {}) {
  return [
    { name: 'hostname', label: 'Hostname', required: true, placeholder: 'PC-13', maxlength: 20, help: 'Identificador único da máquina na rede.' },
    { name: 'zone', label: 'Área', type: 'select', required: true, options: toOptions(ZONES) },
    creating && { name: 'status', label: 'Estado inicial', type: 'select', required: true, options: toOptions(MACHINE_STATUS).filter((o) => o.value !== 'em_uso') },
    { name: 'os', label: 'Sistema operacional', placeholder: 'Windows 11 Pro' },
    { name: 'cpu', label: 'Processador', required: true, placeholder: 'AMD Ryzen 5 5600' },
    { name: 'gpu', label: 'Placa de vídeo', placeholder: 'NVIDIA GeForce RTX 3060' },
    { name: 'ram_gb', label: 'Memória RAM (GB)', type: 'number', required: true, min: 1, step: 1 },
    { name: 'storage_gb', label: 'Armazenamento (GB)', type: 'number', required: true, min: 1, step: 1 },
    { name: 'ip', label: 'Endereço IP', placeholder: '192.168.10.40' },
    { name: 'mac', label: 'Endereço MAC', placeholder: '00:1A:2B:3C:4D:5E' },
    { name: 'notes', label: 'Observações', type: 'textarea', placeholder: 'Periféricos, pendências...' },
  ].filter(Boolean);
}

export async function openMachineForm(machine) {
  const result = await formModal({
    title: machine ? `Editar ${machine.hostname}` : 'Nova máquina',
    fields: machineFields({ creating: !machine }),
    values: machine ?? { zone: 'arena', status: 'disponivel', os: 'Windows 11 Pro', ram_gb: 16, storage_gb: 1000 },
    submitLabel: machine ? 'Salvar alterações' : 'Cadastrar máquina',
    onSubmit: (v) => (machine ? api.machines.update(machine.id, v) : api.machines.create(v)),
  });
  if (result) toast(machine ? `${result.hostname} atualizada.` : `${result.hostname} cadastrada.`, 'success');
  return result;
}

export async function deleteMachine(machine) {
  const ok = await confirmDialog({
    title: `Excluir ${machine.hostname}?`,
    message: 'A máquina sai do cadastro e da lista de programas instalados. O histórico de sessões, eventos e métricas é mantido.',
    confirmLabel: 'Excluir máquina',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.machines.remove(machine.id);
    toast(`${machine.hostname} excluída.`, 'success');
    return true;
  } catch (err) {
    toastError(err);
    return false;
  }
}

export default {
  render(root) {
    const state = { q: '', zone: '', status: '', view: loadPref('machines-view', 'grid') };
    let data = null;
    const results = h('div');

    const paint = () => {
      if (data) results.replaceChildren(...content());
    };

    const content = () => {
      const q = state.q.trim().toLowerCase();
      const list = data.machines.filter(
        (m) =>
          (!state.zone || m.zone === state.zone) &&
          (!state.status || m.status === state.status) &&
          (!q || [m.hostname, m.cpu, m.gpu, m.ip].some((v) => String(v ?? '').toLowerCase().includes(q))),
      );
      const out = [];
      if (data.metricsError) out.push(notice(`Telemetria indisponível: ${data.metricsError.message}`, 'warning', 'database'));
      if (state.view === 'grid') {
        out.push(floorMap({ machines: list, sessions: data.sessions, metrics: data.metrics, onSelect: (m) => (location.hash = `#/maquinas/${m.id}`) }));
      } else {
        const metricBy = new Map((data.metrics ?? []).map((x) => [x.machine_id, x]));
        out.push(
          table({
            rows: list,
            onRowClick: (m) => (location.hash = `#/maquinas/${m.id}`),
            emptyText: 'Nenhuma máquina encontrada com esses filtros.',
            columns: [
              { label: 'Máquina', render: (m) => cellStack(h('span', { class: 'mono' }, m.hostname), ZONES[m.zone]?.label) },
              { label: 'Especificações', class: 'wrap', render: (m) => cellStack(m.cpu, [m.gpu, `${m.ram_gb} GB RAM`, storage(m.storage_gb)].filter(Boolean).join(' · ')) },
              { label: 'Rede', render: (m) => cellStack(h('span', { class: 'mono' }, m.ip ?? '—'), m.mac) },
              { label: 'Estado', render: (m) => statusBadge(MACHINE_STATUS, m.status) },
              { label: 'Último usuário', render: (m) => (m.last_user ? cellStack(`@${m.last_user.nickname}`, m.last_user.in_session ? 'em sessão agora' : relative(m.last_user.at)) : '—') },
              {
                label: 'Uso agora',
                render: (m) => {
                  const x = metricBy.get(m.id);
                  return x && !isStale(x) ? h('div', { style: 'min-width:130px' }, miniBar('CPU', x.cpu_pct), miniBar('RAM', x.ram_pct)) : h('span', { class: 'muted' }, '—');
                },
              },
              {
                label: '',
                class: 'actions',
                render: (m) => [
                  iconButton('edit', 'Editar', async () => (await openMachineForm(m)) && ctl.refresh()),
                  iconButton('trash', 'Excluir', async () => (await deleteMachine(m)) && ctl.refresh(), { danger: true }),
                ],
              },
            ],
          }),
        );
      }
      return out;
    };

    root.append(
      pageHeader('Máquinas', 'Cadastro, especificações e estado operacional de cada computador', [
        button('Nova máquina', { icon: 'plus', variant: 'primary', onClick: async () => (await openMachineForm()) && ctl.refresh() }),
      ]),
      h(
        'div',
        { class: 'toolbar' },
        searchBox('Buscar por hostname, CPU, GPU ou IP', debounce((v) => { state.q = v; paint(); }, 150)),
        select([{ value: '', label: 'Todas as áreas' }, ...toOptions(ZONES)], '', (v) => { state.zone = v; paint(); }, { label: 'Área' }),
        select([{ value: '', label: 'Todos os estados' }, ...toOptions(MACHINE_STATUS)], '', (v) => { state.status = v; paint(); }, { label: 'Estado' }),
        segmented([{ value: 'grid', label: 'Mapa', icon: 'grid' }, { value: 'table', label: 'Tabela', icon: 'list' }], state.view, (v) => {
          state.view = v;
          savePref('machines-view', v);
          paint();
        }),
      ),
      card({ title: 'Parque de máquinas', icon: 'monitor', source: ['postgres', 'cassandra'], body: results }),
    );

    const ctl = widget(results, {
      load: async () => {
        const [machines, sessions, metrics] = await Promise.allSettled([api.machines.list(), api.sessions.list({ status: 'ativa' }), api.metrics.latest()]);
        if (machines.status === 'rejected') throw machines.reason;
        return {
          machines: machines.value.items,
          sessions: sessions.status === 'fulfilled' ? sessions.value.items : [],
          metrics: metrics.status === 'fulfilled' ? metrics.value.items : null,
          metricsError: metrics.status === 'rejected' ? metrics.reason : null,
        };
      },
      render: (d) => {
        data = d;
        return content();
      },
      interval: config.pollMs * 2,
    });
    return ctl;
  },
};
