import { api } from '../api/index.js';
import { config } from '../config.js';
import { h, loadPref, savePref } from '../ui/dom.js';
import { card, pageHeader, widget, table, badge, empty } from '../ui/components.js';
import { miniBar, isStale } from '../ui/floor.js';
import { metricsPanel } from '../ui/metrics-panel.js';
import { relative, num, kbps } from '../format.js';

const LATE_MS = 10 * 60_000;

function commState(x) {
  const age = Date.now() - Date.parse(x.last_seen_at);
  if (!isStale(x)) return badge('Online', 'success', { dot: true });
  if (age < LATE_MS) return badge('Atrasada', 'warning', { dot: true });
  return badge('Sem sinal', 'danger', { dot: true });
}

export default {
  render(root) {
    let selected = Number(loadPref('metrics-machine', 0)) || null;
    let panel = null;
    let latest = [];
    const commsEl = h('div');
    const panelHost = h('div');
    const machineSel = h('select', { class: 'input', 'aria-label': 'Máquina', style: 'width:auto;min-width:160px', onchange: (e) => choose(Number(e.target.value)) });

    function choose(id, { repaint = true } = {}) {
      selected = id;
      savePref('metrics-machine', String(id));
      machineSel.value = String(id);
      panel?.stop();
      panel = metricsPanel(id);
      panelHost.replaceChildren(panel.el);
      if (repaint) commsCtl.refresh();
    }

    root.append(
      pageHeader('Métricas técnicas', 'Histórico de CPU, GPU, memória, disco e conectividade por máquina e período'),
      card({ title: 'Última comunicação das máquinas', icon: 'wifi', source: 'cassandra', body: commsEl, flush: true }),
      h('div', { class: 'spacer' }),
      card({ title: 'Histórico por máquina', icon: 'activity', actions: machineSel, body: panelHost }),
    );

    const commsCtl = widget(commsEl, {
      load: () => api.metrics.latest(),
      render: ({ items }) => {
        latest = [...items].sort((a, b) => a.hostname.localeCompare(b.hostname, 'pt-BR', { numeric: true }));
        if (!machineSel.options.length) {
          machineSel.append(...latest.map((x) => h('option', { value: String(x.machine_id) }, x.hostname)));
          if (!selected || !latest.some((x) => x.machine_id === selected)) selected = latest[0]?.machine_id ?? null;
          if (selected) choose(selected, { repaint: false });
        }
        return table({
          rows: latest,
          onRowClick: (x) => choose(x.machine_id),
          rowClass: (x) => (x.machine_id === selected ? 'selected' : ''),
          columns: [
            { label: 'Máquina', render: (x) => h('span', { class: 'mono cell-main' }, x.hostname) },
            { label: 'Comunicação', render: commState },
            { label: 'Última coleta', render: (x) => h('span', { dataset: { relative: x.last_seen_at } }, relative(x.last_seen_at)) },
            { label: 'CPU / RAM', render: (x) => h('div', { style: 'min-width:150px' }, miniBar('CPU', x.cpu_pct), miniBar('RAM', x.ram_pct)) },
            { label: 'Disco', class: 'num', render: (x) => `${num(x.disk_pct)}%` },
            { label: 'Temp.', class: 'num', render: (x) => `${num(x.temp_c)} °C` },
            { label: 'Latência', class: 'num', render: (x) => `${num(x.latency_ms)} ms` },
            { label: 'Rede ↓ / ↑', class: 'num', render: (x) => `${kbps(x.net_in_kbps)} / ${kbps(x.net_out_kbps)}` },
          ],
        });
      },
      interval: config.pollMs,
    });

    panelHost.append(empty('Selecione uma máquina para ver o histórico.', 'activity'));

    return () => {
      commsCtl();
      panel?.stop();
    };
  },
};
