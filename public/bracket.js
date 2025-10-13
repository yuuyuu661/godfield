// SVG描画：ラウンドごとの箱と、上に伸びていく接続線
export function renderBracket(el, state, onClickMatch) {
  el.innerHTML = '';
  const { matches, teams, tournament } = state;
  if (!matches.length) {
    el.innerHTML = '<p>まだトーナメントが生成されていません（登録→「大会開始」）。</p>';
    return;
  }

  const svg = svgEl('svg', { width: 1200, height: Math.max(400, matches.filter(m=>m.round===1).length * 90) });
  el.appendChild(svg);

  const byRound = groupBy(matches, 'round');
  const rounds = Object.keys(byRound).map(n => Number(n)).sort((a,b)=>a-b);
  const colW = 260;
  const rowH = 80;
  const marginX = 20;
  const marginY = 20;

  // 各ラウンドを描画
  const centerY = (pos) => marginY + rowH/2 + (pos-1) * (rowH * Math.pow(2, rounds[0] === 1 ? (1) : 1));

  // map: matchId -> {x,y}
  const midCenter = new Map();

  for (const r of rounds) {
    const list = byRound[r].sort((a,b)=>a.position - b.position);
    const colX = marginX + (r-1) * colW;

    const spacing = rowH * Math.pow(2, r-1);
    const startY = marginY + spacing/2;

    list.forEach((m, idx) => {
      const y = startY + idx * spacing;
      midCenter.set(m.id, { x: colX + 160, y });

      // ボックス（試合）
      const g = svgEl('g', { class: 'match', 'data-id': m.id });
      g.addEventListener('click', () => onClickMatch(m));
      svg.appendChild(g);

      const box = svgEl('rect', { x: colX, y: y-26, width: 200, height: 52, class: 'box' });
      g.appendChild(box);

      const ta = teamName(teams, m.team_a);
      const tb = teamName(teams, m.team_b);
      const wa = m.winner === m.team_a;
      const wb = m.winner === m.team_b;

      g.appendChild(svgEl('text', { x: colX+10, y: y-6, class: 'team-text' }, textLine(ta)));
      g.appendChild(svgEl('text', { x: colX+10, y: y+14, class: 'team-text' }, textLine(tb)));

      // 勝ち上がり線（右方向へ）
      if (m.next_match_id) {
        const next = midCenter.get(m.next_match_id) || {};
        const nx = marginX + (m.round) * colW; // 次コラムのx
        // Aライン（上から）
        const colorA = wa ? 'win' : 'a';
        const colorB = wb ? 'win' : 'b';
        const ay = y - 12, by = y + 12;
        drawStep(svg, colX+200, ay, nx, next.y, colorA);
        drawStep(svg, colX+200, by, nx, next.y, colorB);
      }
    });
  }

  // 決勝の勝者名をデカく
  const finalRound = Math.max(...rounds);
  const finalMatch = byRound[finalRound].sort((a,b)=>a.position-b.position)[0];
  if (finalMatch?.winner) {
    const winner = teamName(teams, finalMatch.winner);
    svg.appendChild(svgEl('text', {
      x: marginX + (finalRound) * colW + 20,
      y: midCenter.get(finalMatch.id).y + 6,
      class: 'team-text',
      style: 'font-size:18px;font-weight:700;'
    }, `🏆 優勝: ${winner}`));
  }
}

function teamName(teams, id) {
  if (!id) return '(未定/BYE)';
  const t = teams.find(x => x.id === id);
  return t ? t.name : '(不明)';
}

function drawStep(svg, x1, y1, x2, y2, variant='a') {
  // 右へ→上（または下）→右 で“上っていく”感じのステップ線
  const midX = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2-40}`;
  const path = svgEl('path', { d, class: `slot ${variant}` });
  svg.appendChild(path);
}

function groupBy(arr, key) {
  return arr.reduce((acc, it) => ((acc[it[key]] ||= []).push(it), acc), {});
}
function svgEl(tag, attrs={}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
  if (text) el.textContent = text;
  return el;
}
function textLine(s) { return s?.length>26 ? s.slice(0,24)+'…' : (s || ''); }
