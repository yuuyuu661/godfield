const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const state = { pass: "", data: null };

// Tabs
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  $$(".tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const tab = btn.dataset.tab;
  $$('[data-tab-panel]').forEach(p => p.hidden = p.getAttribute('data-tab-panel') !== tab);
  if (tab === "bracket") setTimeout(drawWires, 50);
});

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

// ---------- Bracket ----------
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

  // IMPORTANT: Do NOT auto-propagate names unless a winner is set
  function upper(list) {
    return list.map(m => {
      const A = resolved[m.aFrom];
      const B = resolved[m.bFrom];
      const aN = (A && A.winner) ? (A.winner === "A" ? A.aName : A.bName) : "--";
      const bN = (B && B.winner) ? (B.winner === "A" ? B.aName : B.bName) : "--";
      return { id: m.id, aName: aN, bName: bN, winner: data.results[m.id] || null, aFrom: m.aFrom, bFrom: m.bFrom };
    });
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

    // Desktop: right-click context for seed naming (first round only)
    if (firstRound) {
      a.addEventListener("contextmenu", (ev) => seedContext(ev, m.aSeed));
      b.addEventListener("contextmenu", (ev) => seedContext(ev, m.bSeed));
      // Mobile: long-press (600ms)
      longPress(a, () => seedPrompt(m.aSeed));
      longPress(b, () => seedPrompt(m.bSeed));
    }

    if (m.winner === "A") { a.classList.add("won"); b.classList.add("lost"); box.classList.add("decided"); }
    if (m.winner === "B") { b.classList.add("won"); a.classList.add("lost"); box.classList.add("decided"); }

    col.appendChild(tpl);
  });
}

// long-press helper
function longPress(el, cb, ms = 600) {
  let timer = null;
  const start = (e) => {
    if (e.type === "mousedown" && e.button !== 0) return;
    timer = setTimeout(() => cb(), ms);
  };
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener("touchstart", start);
  el.addEventListener("touchend", clear);
  el.addEventListener("touchmove", clear);
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", clear);
  el.addEventListener("mouseleave", clear);
}

function seedContext(ev, seed) {
  ev.preventDefault();
  seedPrompt(seed);
}
function seedPrompt(seed) {
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

// Buttons
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

// SVG wires
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

// ---------- Roulette ----------
const wheel = $("#wheel");
const ctx = wheel.getContext("2d");
const resultBox = $("#result");
const itemsEl = $("#items");
$("#preset32").addEventListener("click", () => {
  itemsEl.value = Array.from({length:32},(_,i)=>String(i+1)).join(", ");
  drawWheel();
});
$("#spin").addEventListener("click", spin);

function getItems() {
  const raw = itemsEl.value || "";
  return raw.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
}

function drawWheel(rotation = 0) {
  const items = getItems();
  const W = wheel.width, H = wheel.height, R = W/2;
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(R,R);
  ctx.rotate(rotation);
  const n = Math.max(items.length, 1);
  for (let i=0;i<n;i++) {
    const a0 = (i/n)*Math.PI*2;
    const a1 = ((i+1)/n)*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,R-4,a0,a1);
    ctx.closePath();
    ctx.fillStyle = i%2? "#f7f7f7":"#e9eef9";
    ctx.fill();
    ctx.strokeStyle = "#ddd";
    ctx.stroke();
    // text
    ctx.save();
    ctx.fillStyle = "#333";
    ctx.rotate(a0 + (a1-a0)/2);
    ctx.textAlign = "right";
    ctx.font = "16px system-ui";
    ctx.fillText(items[i] || "", R-20, 6);
    ctx.restore();
  }
  ctx.restore();
}

let spinning = false;
function spin() {
  const items = getItems();
  if (!items.length) return alert("項目を入力してください");
  if (spinning) return;
  spinning = true;
  resultBox.textContent = "";
  // Random final angle; spin 5-8 turns
  const n = items.length;
  const seg = (Math.PI*2)/n;
  const targetIndex = Math.floor(Math.random()*n);
  // top pointer is 0 rad (we draw text facing outwards; pointer at -90deg? We placed pointer at top, so angle  -pi/2 corresponds to index 0 at top).
  // We'll rotate to make target center land at -90deg.
  const centerAngle = (targetIndex + 0.5) * seg;
  const final = (Math.PI*1.5) - centerAngle; // -90deg
  const turns = Math.PI*2*(5 + Math.random()*3);
  const total = turns + final;
  const dur = 3500;
  const start = performance.now();

  function animate(now) {
    const t = Math.min(1, (now - start)/dur);
    // easeOutCubic
    const ease = 1 - Math.pow(1-t, 3);
    const rot = total * ease;
    drawWheel(rot);
    if (t < 1) requestAnimationFrame(animate);
    else {
      spinning = false;
      resultBox.textContent = `結果: ${items[targetIndex]}`;
    }
  }
  requestAnimationFrame(animate);
}

// init default items and drawing
itemsEl.value = Array.from({length:8},(_,i)=>`Item ${i+1}`).join(", ");
drawWheel();

// Init app
window.addEventListener("load", load);
