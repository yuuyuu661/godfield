// シンプルなSVG描画（モバイルで黒背景にならない＆拡大縮小しやすい）
export function renderBracket(container, state, onClickMatch) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  el.innerHTML = '';

  const matches = state.matches || [];
  if (!matches.length) {
    el.innerHTML = '<div class="empty">まだトーナメントは作成されていません</div>';
    return;
  }

  const byRound = {};
  for (const m of matches) {
    (byRound[m.round] ||= []).push(m);
  }
  const rounds = Object.keys(byRound).map(n => Number(n)).sort((a, b) => a - b);
  for (const r of rounds) {
    byRound[r].sort((a, b) => a.position - b.position);
  }

  const colW = 260;
  const rowH = 84;
  const marginX = 20;
  const marginY = 20;
  const W = marginX * 2 + rounds.length * colW;
  const H = Math.max(420, (byRound[1]?.length || 1) * rowH + marginY * 2);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
  el.appendChild(svg);

  const teamsById = {};
  (state.teams || []).forEach(t => (teamsById[t.id] = t));

  // 線を先に、ボックスを後に描く
  // 線
  for (const r of rounds) {
    const isLast = (r === rounds[rounds.length - 1]);
    if (isLast) continue;
    const nextR = r + 1;

    for (const m of byRound[r]) {
      const x1 = marginX + (r - 1) * colW + 200;
      const y1 = marginY + (m.position - 1 + 0.5) * rowH;

      const nextPos = Math.ceil(m.position / 2);
      const x2 = marginX + (nextR - 1) * colW + 30;
      const y2 = marginY + (nextPos - 1 + 0.5) * rowH;

      svg.appendChild(line(x1, y1, x2, y2, 'slot'));
    }
  }

  // ボックス
  for (const r of rounds) {
    for (const m of byRound[r]) {
      const x = marginX + (r - 1) * colW + 20;
      const y = marginY + (m.position - 1) * rowH + 8;
      svg.appendChild(matchBox(x, y, m, teamsById, onClickMatch));
    }
  }
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function line(x1, y1, x2, y2, cls) {
  return svgEl('line', { x1, y1, x2, y2, class: cls });
}

function matchBox(x, y, m, teamsById, onClickMatch) {
  const g = svgEl('g', { transform: `translate(${x},${y})`, class: 'match' });

  const rect = svgEl('rect', { width: 200, height: 68, class: 'box', rx: 10, ry: 10 });
  g.appendChild(rect);

  // A
  const a = teamsById[m.team_a]?.name || (m.team_a ? `#${m.team_a}` : '(空き)');
  const b = teamsById[m.team_b]?.name || (m.team_b ? `#${m.team_b}` : '(空き)');

  const aText = svgEl('text', { x: 12, y: 26, class: 'team-text' });
  aText.textContent = a;
  const bText = svgEl('text', { x: 12, y: 52, class: 'team-text' });
  bText.textContent = b;

  g.appendChild(aText);
  g.appendChild(bText);

  // クリックで勝者確定（live中のみ）
  g.addEventListener('click', () => onClickMatch?.(m));

  // winner表示
  if (m.winner) {
    const mark = svgEl('text', { x: 198, y: 16, class: 'winmark', 'text-anchor': 'end' });
    mark.textContent = 'WIN';
    g.appendChild(mark);
  }

  return g;
}
