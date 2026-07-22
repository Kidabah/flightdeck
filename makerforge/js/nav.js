/**
 * MakerDeck — Shared Navigation Component  b504
 * Auto-injects consistent nav bar across all MakerDeck tools.
 * Import this module in any MakerDeck page:
 *   <script type="module" src="js/nav.js"></script>
 */

const BUILD = 'b504';

const TOOLS = [
  { id: 'container', label: 'Container', href: 'index.html' },
  { id: 'painter',   label: 'STL Painter', href: 'painter.html' },
  { id: 'voronoi',   label: 'Voronoi', href: 'voronoi.html' },
];

function detectActiveTool() {
  const path = location.pathname.toLowerCase();
  if (path.includes('painter')) return 'painter';
  if (path.includes('voronoi')) return 'voronoi';
  return 'container'; // index.html or root
}

export function injectNav(targetSelector = '.md-nav') {
  let nav = document.querySelector(targetSelector);
  if (!nav) {
    // Create nav element and prepend to body or app container
    nav = document.createElement('nav');
    nav.className = 'md-nav';
    const app = document.querySelector('.app');
    if (app) app.prepend(nav);
    else document.body.prepend(nav);
  }

  const active = detectActiveTool();

  nav.innerHTML = `
    <a class="md-nav-home" href="index.html" title="Back to MakerDeck">&#x2302;</a>
    <a class="md-nav-brand" href="index.html">Maker<span>Deck</span></a>
    <div class="md-nav-links">
      ${TOOLS.map(t => `<a class="md-nav-link${t.id === active ? ' active' : ''}" href="${t.href}">${t.label}</a>`).join('')}
    </div>
    <div class="md-nav-spacer"></div>
    <span class="md-nav-build">${BUILD}</span>
  `;
}

// Auto-inject on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => injectNav());
} else {
  injectNav();
}
