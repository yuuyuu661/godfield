const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const state = { pass: "", data: null };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
      ...(state.pass ? { "x-admin-pass": state.pass } : {})
    }
  });
  if (!res.ok) {
    try { const j = await res.json(); throw new Error(j.error || "API error"); }
    catch { throw new Error("API error"); }
  }
  return res.json();
}

async function load() {
  const data = await api("/api/state", { method: "GET" });
  state.data = data;
  render(data);
  drawWires();
}

function render(data) {
  const slots = data.slots || [];
  const cols = $("#cols");
  cols.innerHTML = "";

  const mk = (title) => {
    const col = document.createElement("div");
    col.className = "col";
    const h = document.createElement("h2");
    h.textContent = title;
    col.appendChild(h);
    cols.appendChild(col);
    return col;
  };

  const r1 = data.bracket.map.round1.map(m => ({
    id: m.id, aSeed: m.aSeed, bSeed: m.bSeed,
    aName: slots[m.aSeed - 1] || "--",
    bName: slots[m.bSeed - 1] || "--",
    winner: data.results[m.id] || null
  }));

  const resolved = Object.fromEntries(data.bracket.resolved.map(m => [m.id, m]));

  function upper(list) {
    return list.map(m => {
      const A = resolved[m.aFrom];
      const B = resolved[m.bFrom];
      const aN = pickName(A);
      const bN = pickName(B);
      return { id: m.id, aName: aN, bName: bN, winner: data.results[m.id] || null, aFrom: m.aFrom, bFrom: m.bFrom };
    });
  }
  function pickName(m) {
    if (!m) return "--";
    if (m.winner === "A") return m.aName || "--";
    if (m.winner === "B") return m.bName || "--";
    return m.aName || "--";
  }

  const r2 = upper(data.bracket.map.round2);
  const r3 = upper(data.bracket.map.quarters);
  const r4 = upper(data.bracket.map.semis);
  const r5 = upper(data.bracket.map.final);

  renderRound(mk("1回戦"), r1, true);
  renderRound(mk("2回戦"), r2, false);
  renderRound(mk("準々決勝"), r3, false);
  renderRound(mk("準決勝"), r4, false);
  renderRound(mk("決勝"), r5, false);
}

function renderRound(col, matches, firstRound) {
  matches.forEach((m) => {
    const tpl = document.importNode($("#matchTpl").content, true);
    const box = tpl.querySelector(".match");
    box.dataset.matchId = m.id;
    const a = tpl.querySelector('[data-side="A"]');
    const b = tpl.querySelector('[data-side="B"]');
    a.querySelector(".name").textContent = m.aName || "--";
    b.querySelector(".name").textContent = m.bName || "--";
    a.querySelector(".seed").textContent = firstRound ? String(m.aSeed) : "";
    b.querySelector(".seed").textContent = firstRound ? String(m.bSeed) : "";

    // Left-click to set winner
    [a, b].forEach((row) => {
      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (!state.pass) return alert("管理パスワードが必要です");
        const side = row.dataset.side;
        const name = row.querySelector(".name").textContent;
        if (!name || name === "--") return;
        setResult(m.id, side);
      });
    });

    // Right-click to set name on first round seed
    if (firstRound) {
      a.addEventListener("contextmenu", (ev) => seedContext(ev, m.aSeed));
      b.addEventListener("contextmenu", (ev) => seedContext(ev, m.bSeed));
    }

    if (m.winner === "A") { a.classList.add("won"); b.classList.add("lost"); box.classList.add("decided"); }
    if (m.winner === "B") { b.classList.add("won"); a.classList.add("lost"); box.classList.add("decided"); }

    col.appendChild(tpl);
  });
}

function seedContext(ev, seed) {
  ev.preventDefault();
  if (!state.pass) { alert("管理パスワードが必要です"); return; }
  const current = prompt(`Seed ${seed} のチーム名を入力`, "");
  if (current === null) return;
  const name = current.trim();
  if (!name) return;
  api("/api/seed/set-name", { method: "POST", body: JSON.stringify({ seed, name }) })
    .then(load).catch(e => alert(e.message));
}

async function setResult(matchId, winner) {
  try {
    await api("/api/results/set", { method: "POST", body: JSON.stringify({ matchId, winner }) });
    await load();
  } catch (e) { alert(e.message); }
}

$("#clearSeeds").addEventListener("click", () => {
  if (!state.pass) return alert("管理パスワードが必要です");
  if (!confirm("全ての配置と勝敗をクリアしますか？")) return;
  api("/api/seed/clear", { method: "POST" }).then(load).catch(e => alert(e.message));
});
$("#resetResults").addEventListener("click", () => {
  if (!state.pass) return alert("管理パスワードが必要です");
  if (!confirm("勝敗をリセットしますか？")) return;
  api("/api/results/reset", { method: "POST" }).then(load).catch(e => alert(e.message));
});
$("#pass").addEventListener("input", (e) => { state.pass = e.target.value; });

function drawWires() {
  const svg = $("#wires");
  svg.innerHTML = "";
  const cols = $$(".col");
  if (cols.length < 2) return;

  const pad = svg.getBoundingClientRect();
  function midRight(el) { const r = el.getBoundingClientRect(); return [r.right - pad.left, r.top + r.height/2 - pad.top]; }
  function midLeft(el)  { const r = el.getBoundingClientRect(); return [r.left - pad.left,  r.top + r.height/2 - pad.top]; }

  function connectRound(fromCol, toCol) {
    const a = $$(".match", fromCol);
    const b = $$(".match", toCol);
    for (let i = 0; i < b.length; i++) {
      const src1 = a[i*2];
      const src2 = a[i*2+1];
      if (!src1 || !src2) continue;
      const dst = b[i];
      const [x1,y1] = midRight(src1);
      const [x2,y2] = midRight(src2);
      const [dx,dy] = midLeft(dst);
      const mx1 = (x1 + dx) / 2;
      const mx2 = (x2 + dx) / 2;
      addPath(x1,y1, dx, dy - 10, mx1);
      addPath(x2,y2, dx, dy + 10, mx2);
    }
  }

  function addPath(x1,y1, x2,y2, cx) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
    p.setAttribute("d", d);
    svg.appendChild(p);
  }

  for (let i = 0; i < cols.length - 1; i++) connectRound(cols[i], cols[i+1]);
}

window.addEventListener("resize", () => { if (state.data) drawWires(); });
window.addEventListener("load", load);
