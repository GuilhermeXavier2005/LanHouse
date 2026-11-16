import { api } from '../api/index.js';
import { h, debounce } from '../ui/dom.js';
import { card, pageHeader, widget, button, select, searchBox, notice, empty } from '../ui/components.js';
import { eventItem } from '../ui/events-ui.js';
import { EVENT_TYPES, toOptions } from '../constants.js';
import { localDateKey } from '../format.js';

const PAGE = 40;

function dayLabel(key) {
  const today = localDateKey(Date.now());
  const yesterday = localDateKey(Date.now() - 86400e3);
  if (key === today) return 'Hoje';
  if (key === yesterday) return 'Ontem';
  return new Date(`${key}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export default {
  render(root) {
    const filters = { type: '', machine_id: '', q: '' };
    let limit = PAGE;
    const body = h('div');
    const machineSel = select([{ value: '', label: 'Todas as máquinas' }], '', (v) => { filters.machine_id = v; reload(); }, { label: 'Máquina' });
    const reload = () => {
      limit = PAGE;
      ctl.reload();
    };

    root.append(
      pageHeader('Eventos', 'Registro detalhado de sessões, mudanças de estado, erros, diagnósticos e programas executados', [
        button('Atualizar', { icon: 'refresh', onClick: () => ctl.refresh() }),
      ]),
      notice(
        'Eventos são documentos do MongoDB: cada tipo tem um "payload" com estrutura própria. Registros de sessão referenciam a sessão oficial no PostgreSQL pelo campo session_id.',
        'info',
        'database',
      ),
      h(
        'div',
        { class: 'toolbar' },
        searchBox('Buscar em qualquer campo do documento', debounce((v) => { filters.q = v; reload(); }, 300)),
        select([{ value: '', label: 'Todos os tipos' }, ...toOptions(EVENT_TYPES)], '', (v) => { filters.type = v; reload(); }, { label: 'Tipo de evento' }),
        machineSel,
      ),
      card({ title: 'Linha do tempo', icon: 'list', source: 'mongodb', body }),
    );

    // A lista de máquinas vem do PostgreSQL; se ele estiver fora, o filtro só fica sem opções.
    api.machines
      .list()
      .then(({ items }) => machineSel.append(...items.map((m) => h('option', { value: String(m.id) }, m.hostname))))
      .catch(() => {});

    const ctl = widget(body, {
      load: () => api.events.list({ ...filters, limit }),
      render: ({ items, total }) => {
        if (!items.length) return empty('Nenhum evento encontrado para esses filtros.', 'list');
        const out = [];
        let day = null;
        let list = null;
        for (const e of items) {
          const key = localDateKey(Date.parse(e.timestamp));
          if (key !== day) {
            day = key;
            list = h('ul', { class: 'feed' });
            out.push(h('div', { class: 'day-sep' }, dayLabel(key)), list);
          }
          list.append(eventItem(e, { expandable: true }));
        }
        out.push(
          h(
            'div',
            { class: 'table-footer', style: 'padding:14px 0 0;margin-top:14px' },
            h('span', {}, `Mostrando ${items.length} de ${total} eventos`),
            items.length < total && button('Carregar mais', { size: 'sm', onClick: () => { limit += PAGE; ctl.refresh(); } }),
          ),
        );
        return out;
      },
    });
    return ctl;
  },
};
