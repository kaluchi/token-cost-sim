function link(active, key, href, full, short) {
  const cls = `nav-link ${active === key ? 'active' : ''}`;
  return `<a class="${cls}" href="${href}"><span class="nav-full">${full}</span><span class="nav-short">${short}</span></a>`;
}

export function injectNav(active) {
  const b = import.meta.env.BASE_URL;
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.innerHTML = `
    <a class="nav-brand" href="${b}">⚡ LLM Cost Sim</a>
    <div class="nav-links">
      ${link(active, 'home',    b,                            'Обзор',              '⌂')}
      ${link(active, 'quad',    b + 'pages/quadratic.html',   '01 · x²-Парабола',   '01')}
      ${link(active, 'sim',     b + 'pages/simulator.html',   '02 · Длит. vs Объёмн.', '02')}
      ${link(active, 'oneshot', b + 'pages/one-shot.html',    '03 · One-Shot',       '03')}
      ${link(active, 'tax',     b + 'pages/context-tax.html', '04 · Налог',          '04')}
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);
}
