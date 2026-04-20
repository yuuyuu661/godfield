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

// ---------- Bracket (same behavior) ----------
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

  const r1 = data.bracket.map.round1.map(m => {
    const r = data.results[m.id];
    return {
      id: m.id,
      aSeed: m.aSeed,
      bSeed: m.bSeed,
      aName: slots[m.aSeed - 1] || "--",
      bName: slots[m.bSeed - 1] || "--",
      winner: typeof r === "string" ? r : r?.winner || null
    };
  });

  const resolved = Object.fromEntries(data.bracket.resolved.map(m => [m.id, m]));

  function upper(list) {
    return list.map(m => {
      const A = resolved[m.aFrom];
      const B = resolved[m.bFrom];
      const aN = (A && A.winner) ? (A.winner === "A" ? A.aName : A.bName) : "--";
      const bN = (B && B.winner) ? (B.winner === "A" ? B.aName : B.bName) : "--";

      const r = data.results[m.id];

      return {
        id: m.id,
        aName: aN,
        bName: bN,
        winner: typeof r === "string" ? r : r?.winner || null,
        aFrom: m.aFrom,
        bFrom: m.bFrom
      };
    });
  }

  const r2 = upper(data.bracket.map.round2);
  const r3 = upper(data.bracket.map.semis);
  const r4 = upper(data.bracket.map.final);

  renderRound(mk("1回戦"), r1, true);
  renderRound(mk("2回戦"), r2, false);
  renderRound(mk("準決勝"), r3, false);
  renderRound(mk("決勝"), r4, false);
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

    const scoresEl = tpl.querySelector(".bo3-scores");
        if (scoresEl) {
          scoresEl.innerHTML = "";

          const r = state.data.results[m.id];
          const games = r?.games || [];

          // 最大3試合分表示（なければ 0-0）
          for (let i = 0; i < 3; i++) {
            const g = games[i] || { a: 0, b: 0 };
            scoresEl.insertAdjacentHTML(
              "beforeend",
              `<div class="game">
                 <span>${g.a}</span>
                 <span>${g.b}</span>
               </div>`
            );
          }

          // セットカウント（2-0 など）
          let winA = 0, winB = 0;
          games.forEach(g => {
            if (g.a > g.b) winA++;
            if (g.b > g.a) winB++;
          });

          scoresEl.insertAdjacentHTML(
            "beforeend",
            `<div class="summary">
               <span>${winA}</span>
               <span>${winB}</span>
             </div>`
          );
        }

    [a, b].forEach((row) => {
      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (!state.pass) return alert("管理パスワードが必要です");
        const side = row.dataset.side;
        const name = row.querySelector(".name").textContent;
        if (!name || name === "--") return;
        openBo3Modal(m.id, m.aName, m.bName);
      });
    });

    if (m.aSeed) {
      a.addEventListener("contextmenu", (ev) => seedContext(ev, m.aSeed));
      longPress(a, () => seedPrompt(m.aSeed));
    }

    if (m.bSeed) {
      b.addEventListener("contextmenu", (ev) => seedContext(ev, m.bSeed));
      longPress(b, () => seedPrompt(m.bSeed));
    }

    if (m.winner === "A") { a.classList.add("won"); b.classList.add("lost"); box.classList.add("decided"); }
    if (m.winner === "B") { b.classList.add("won"); a.classList.add("lost"); box.classList.add("decided"); }

    col.appendChild(tpl);
  });
}

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

function seedContext(ev, seed) { ev.preventDefault(); seedPrompt(seed); }
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
  try { await api("/api/results/set", { method: "POST", body: JSON.stringify({ matchId, winner }) }); await load(); }
  catch (e) { alert(e.message); }
}
function decideWinner(games) {
  let winA = 0;
  let winB = 0;

  for (const g of games) {
    if (g.a > g.b) winA++;
    if (g.b > g.a) winB++;

    if (winA === 2) return "A";
    if (winB === 2) return "B";
  }

  return null;
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

// ---------- Roulette with deferred removal ----------
const wheel = $("#wheel");
const ctx = wheel.getContext("2d");
const resultBox = $("#result");
const pendingBox = $("#pending");
const itemsEl = $("#items");
const sfxSpin = $("#sfxSpin");
const sfxStop = $("#sfxStop");

$("#preset32").addEventListener("click", () => {
  itemsEl.value = Array.from({length:32},(_,i)=>String(i+1)).join(", ");
  drawWheel();
  updatePending();
});
$("#spin").addEventListener("click", () => spin({ mode: "normal" }));
$("#spinRemove").addEventListener("click", () => {
  // Apply previous pending removal first
  applyPendingRemoval();
  spin({ mode: "defer-remove" });
});

function getItems() {
  const raw = itemsEl.value || "";
  return raw.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
}

let currentRotation = 0; // radians
function drawWheel(rotation = currentRotation) {
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
    ctx.save();
    ctx.fillStyle = "#333";
    ctx.rotate(a0 + (a1-a0)/2);
    ctx.textAlign = "right";
    ctx.font = "16px system-ui";
    ctx.fillText(items[i] || "", R-20, 6);
    ctx.restore();
  }
  ctx.restore();
  currentRotation = rotation;
}

function indexAtPointer(n, rotation) {
  const seg = (Math.PI*2)/n;
  let angle = (-Math.PI/2) - rotation; // pointer angle minus rotation
  angle = ((angle % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
  return Math.floor(angle / seg) % n;
}

function openBo3Modal(matchId, aName, bName) {
  if (!state.pass) return alert("管理パスワードが必要です");

  const tpl = document.importNode($("#bo3Tpl").content, true);
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.appendChild(tpl);

  const inputs = $$("input", modal);

  modal.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    if (btn.dataset.action === "cancel") {
      modal.remove();
    }

    if (btn.dataset.action === "save") {
      const games = [];

      for (let i = 0; i < 3; i++) {
        const a = Number(inputs[i*2].value);
        const b = Number(inputs[i*2+1].value);
        if (!isNaN(a) && !isNaN(b)) {
          games.push({ a, b });
        }
      }

      const winner = decideWinner(games);
      if (!winner) return alert("まだ勝者が決まっていません");

      await api("/api/results/set-bo3", {
        method: "POST",
        body: JSON.stringify({ matchId, games, winner })
      });

      modal.remove();
      load();
    }
  });

  document.body.appendChild(modal);
}
let spinning = false;
let pendingRemoval = null; // value scheduled to be removed on next "SPIN!(出目を削除)"
function updatePending() {
  if (pendingRemoval) {
    pendingBox.style.display = "block";
    pendingBox.textContent = `次回「SPIN!(出目を削除)」時に除外: ${pendingRemoval}`;
  } else {
    pendingBox.style.display = "none";
    pendingBox.textContent = "";
  }
}

function applyPendingRemoval() {
  if (!pendingRemoval) return;
  const list = getItems();
  const idx = list.indexOf(pendingRemoval);
  if (idx >= 0) {
    list.splice(idx,1);
    itemsEl.value = list.join(", ");
    drawWheel();
  }
  pendingRemoval = null;
  updatePending();
}

function spin({ mode }) {
  const items = getItems();
  if (!items.length) return alert("項目を入力してください");
  if (spinning) return;
  spinning = true;
  resultBox.textContent = "";

  // Audio start
  try { sfxStop.pause(); sfxStop.currentTime = 0; } catch {}
  try { sfxSpin.currentTime = 0; sfxSpin.play().catch(()=>{}); } catch {}

  const n = items.length;
  const baseTurns = Math.PI*2*(4 + Math.random()*3);
  const randomExtra = Math.random()*Math.PI*2;
  const total = baseTurns + randomExtra;
  const dur = 3500;
  const start = performance.now();
  const startRot = currentRotation;

  function animate(now) {
    const t = Math.min(1, (now - start)/dur);
    const ease = 1 - Math.pow(1-t, 3);
    const rot = startRot + total * ease;
    drawWheel(rot);
    if (t < 1) requestAnimationFrame(animate);
    else {
      spinning = false;
      const idx = indexAtPointer(n, currentRotation);
      const val = items[idx];
      resultBox.textContent = `結果: ${val}`;
      try { sfxSpin.pause(); } catch {}
      try { sfxStop.currentTime = 0; sfxStop.play().catch(()=>{}); } catch {}

      if (mode === "defer-remove") {
        pendingRemoval = val; // schedule for next delete-spin
        updatePending();
      }
    }
  }
  requestAnimationFrame(animate);
}

// Init
itemsEl.value = Array.from({length:8},(_,i)=>`Item ${i+1}`).join(", ");
drawWheel();
updatePending();

window.addEventListener("load", load);
