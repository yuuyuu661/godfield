export function renderBracket(el, state, onClick) {
  el.innerHTML = '';
  const { matches, teams } = state;
  if (!matches.length) return el.innerHTML = '<p>まだ開始されていません。</p>';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', 1200);
  svg.setAttribute('height', 600);
  el.appendChild(svg);

  const grouped = {};
  matches.forEach(m => (grouped[m.round] ??= []).push(m));

  const colW = 250;
  const rowH = 80;

  for (const r of Object.keys(grouped)) {
    const list = grouped[r];
    const x = (r - 1) * colW + 20;
    list.forEach((m, i) => {
      const y = 60 + i * (rowH * Math.pow(2, r - 1));
      const g = svgEl('g', { class: 'match', 'data-id': m.id });
      g.addEventListener('click', () => onClick(m));
      svg.appendChild(g);
      g.appendChild(svgEl('rect', { x, y, width: 160, height: 50, class: 'box' }));
      const ta = teamName(teams, m.team_a);
      const tb = teamName(teams, m.team_b);
      g.appendChild(svgEl('text', { x: x + 10, y: y + 20, class: 'team-text' }, ta));
      g.appendChild(svgEl('text', { x: x + 10, y: y + 40, class: 'team-text' }, tb));

      if (m.winner) {
        const nx = x + colW;
        const ny = y + 25;
        const color = 'win';
        drawLine(svg, x + 160, ny, nx, ny, color);
      }
    });
  }
}

function drawLine(svg, x1, y1, x2, y2, cls) {
  const path = svgEl('path', { d: `M ${x1} ${y1} H ${x2}`, class: `slot ${cls}` });
  svg.appendChild(path);
}

function teamName(teams, id) {
  const t = teams.find(x => x.id === id);
  return t ? t.name : '(未定/BYE)';
}
function svgEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  if (text) el.textContent = text;
  return el;
}
