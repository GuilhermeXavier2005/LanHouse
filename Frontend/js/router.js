// Roteador por hash (#/maquinas/3). Não precisa de configuração no servidor.

export function createRouter(routes, { fallback, onChange }) {
  const compiled = routes.map((r) => {
    const keys = [];
    const re = new RegExp(`^${r.path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
    return { ...r, re, keys };
  });

  function resolve() {
    const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
    for (const r of compiled) {
      const m = path.match(r.re);
      if (m) return onChange(r, Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])));
    }
    location.replace(`#${fallback}`);
  }

  window.addEventListener('hashchange', resolve);
  resolve();
}
