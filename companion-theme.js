// Hub is authoritative for the compact view's palette, including live theme changes.
(() => {
  const compact = /\/mini(?:\.html)?\/?$/.test(location.pathname) || new URLSearchParams(location.search).get('mini') === '1';
  if (window === parent || !compact) return;
  const trusted = 'https://medha-hub.web.app';
  const root = document.documentElement;
  let keys = [];
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.origin !== trusted || data?.type !== 'medha-companion-theme' || !data.tokens || typeof data.tokens !== 'object') return;
    root.setAttribute('data-theme', data.mode === 'dark' ? 'dark' : 'light');
    if (data.collection && data.collection !== 'original') root.setAttribute('data-theme-collection', data.collection);
    else root.removeAttribute('data-theme-collection');
    keys.forEach(key => root.style.removeProperty(key));
    keys = [];
    for (const [key, value] of Object.entries(data.tokens)) {
      if (/^--[a-z0-9_-]+$/i.test(key) && typeof value === 'string' && value.length < 4096) {
        root.style.setProperty(key, value); keys.push(key);
      }
    }
    root.style.colorScheme = data.mode === 'dark' ? 'dark' : 'light';
  });
  parent.postMessage({ type:'medha-mini-theme-ready' }, trusted);
})();
