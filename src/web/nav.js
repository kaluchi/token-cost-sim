export function injectNav(active) {
  const b = import.meta.env.BASE_URL;
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.innerHTML = `
    <a class="nav-brand" href="${b}">⚡ LLM Cost Sim</a>
    <div class="nav-links">
      <a class="nav-link ${active === 'home'    ? 'active' : ''}" href="${b}">Обзор</a>
      <a class="nav-link ${active === 'quad'    ? 'active' : ''}" href="${b}pages/quadratic.html">01 · x²-Парабола</a>
      <a class="nav-link ${active === 'sim'     ? 'active' : ''}" href="${b}pages/simulator.html">02 · Длит. vs Объёмн.</a>
      <a class="nav-link ${active === 'oneshot' ? 'active' : ''}" href="${b}pages/one-shot.html">03 · One-Shot</a>
      <a class="nav-link ${active === 'tax'     ? 'active' : ''}" href="${b}pages/context-tax.html">04 · Налог</a>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);
}
