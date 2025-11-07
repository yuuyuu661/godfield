const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

const state = { pass: "", selectedSeed: null, data: null };

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
  const teams = data.teams || [];
  const slots = data.slots || [];

  // Admin: editable list
  const list = $("#teamsList");
  list.innerHTML = "";
  teams.forEach(name => {
    const chip = document.createElement("span");
    chip.className = "team-chip";
    const input = document.createElement("input");
    input.value = name;
    input.disabled = !state.pass;
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "保存";
    saveBtn.disabled = !state.pass;
    const delBtn = document.createElement("button");
    delBtn.textContent = "削除";
    delBtn.className = "danger";
    delBtn.disabled = !state.pass;
    saveBtn.onclick = async () => {
      const newName = input.value.trim();
      if (!newName || newName === name) return;
      try { await api("/api/teams/update", { method:"POST", body: JSON.stringify({ oldName: name, newName }) }); load(); } catch (e) { alert(e.message); }
    };
    delBtn.onclick = async () => {
      if (!confirm(`${name} を削除しますか？\n（配置と勝敗はリセットされます）`)) return;
      try { await api("/api/teams/delete", { method:"POST", body: JSON.stringify({ name }) }); load(); } catch (e) { alert(e.message); }
    };
    chip.append(input, saveBtn, delBtn);
    list.appendChild(chip);
  });

  // Build columns
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
      const aN = pickDisplayName(A);
      const bN = pickDisplayName(B);
      return { id: m.id, aName: aN, bName: bN, winner: data.results[m.id] || null, aFrom: m.aFrom, bFrom: m.bFrom };
    });
  }
  function pickDisplayName(m) {
    if (!m) return "--";
    if (m.winner === "A") return m.aName || "--";
    if (m.winner === "B") return m.bName || "--";
    return m.aName || "--";
  }

  const r2 = upper(data.bracket.map.round2);
  const r3 = upper(data.bracket.map.quarters);
  const r4 = upper(data.bracket.map.semis);
  const r5 = upper(data.bracket.map.final);

  const col1 = mk("1回戦");
  renderRound(col1, r1, true);
  const col2 = mk("2回戦");
  renderRound(col2, r2, false);
  const col3 = mk("準々決勝");
  renderRound(col3, r3, false);
  const col4 = mk("準決勝");
  renderRound(col4, r4, false);
  const col5 = mk("決勝");
  renderRound(col5, r5, false);
}

function renderRound(col, matches, showSeeds) {
  matches.forEach((m, idx) => {
    const tpl = document.importNode($("#matchTpl").content, true);
    const box = tpl.querySelector(".match");
    box.dataset.matchId = m.id;
    const a = tpl.querySelector('[data-side="A"]');
    const b = tpl.querySelector('[data-side="B"]');
    a.querySelector(".name").textContent = m.aName || "--";
    b.querySelector(".name").textContent = m.bName || "--";
    a.querySelector(".seed").textContent = showSeeds ? String(m.aSeed) : "";
    b.querySelector(".seed").textContent = showSeeds ? String(m.bSeed) : "";

    // For wire endpoints
    box.dataset.index = idx;

    if (showSeeds) {
      a.addEventListener("click", () => selectSeed(m.aSeed, a));
      b.addEventListener("click", () => selectSeed(m.bSeed, b));
    }

    const radios = tpl.querySelectorAll('input[type="radio"]');
    radios.forEach((r) => r.name = `w-${m.id}`);
    if (m.winner === "A") { a.classList.add("won"); b.classList.add("lost"); }
    if (m.winner === "B") { b.classList.add("won"); a.classList.add("lost"); }

    const enabled = !!state.pass && (m.aName && m.bName && m.aName !== "--" && m.bName !== "--");
    radios.forEach((r) => {
      r.disabled = !enabled;
      r.value = r.closest("[data-side]").dataset.side;
      r.addEventListener("change", () => setResult(m.id, r.value));
    });

    if (m.winner) box.classList.add("decided");

    col.appendChild(tpl);
  });
}

function selectSeed(seed, el) {
  if (!seed) return;
  $$(".seed-focus").forEach(x => x.classList.remove("seed-focus"));
  el.classList.add("seed-focus");
  state.selectedSeed = seed;
  const btn = $("#rouletteBtn");
  btn.disabled = !state.pass || !seed;
}

async function setResult(matchId, winner) {
  try {
    await api("/api/results/set", { method: "POST", body: JSON.stringify({ matchId, winner }) });
    await load();
  } catch (e) { alert(e.message); }
}

async function addTeam() {
  const name = $("#teamName").value.trim();
  if (!name) return;
  try { await api("/api/teams/add", { method: "POST", body: JSON.stringify({ name }) }); $("#teamName").value = ""; load(); }
  catch (e) { alert(e.message); }
}

async function seedAll() {
  try { await api("/api/seed/random", { method: "POST", body: JSON.stringify({ onlyUnassigned: false }) }); load(); } catch (e) { alert(e.message); }
}

async function clearSeeds() {
  if (!confirm("配置をクリアしますか？")) return;
  try { await api("/api/seed/clear", { method: "POST" }); load(); } catch (e) { alert(e.message); }
}

async function resetResults() {
  if (!confirm("勝敗をリセットしますか？")) return;
  try { await api("/api/results/reset", { method: "POST" }); load(); } catch (e) { alert(e.message); }
}

async function rouletteAssign() {
  if (!state.selectedSeed) return alert("枠が未選択です");
  try { await api("/api/seed/assign-one", { method: "POST", body: JSON.stringify({ seed: state.selectedSeed }) }); load(); } catch (e) { alert(e.message); }
}

$("#addTeam").addEventListener("click", addTeam);
$("#seedAll").addEventListener("click", seedAll);
$("#clearSeeds").addEventListener("click", clearSeeds);
$("#resetResults").addEventListener("click", resetResults);
$("#rouletteBtn").addEventListener("click", rouletteAssign);
$("#pass").addEventListener("input", (e) => {
  state.pass = e.target.value;
  $$("input[type=radio]").forEach(r => r.disabled = !state.pass);
  $("#rouletteBtn").disabled = !state.pass || !state.selectedSeed;
});

// SVG wires between columns
function drawWires() {
  const svg = $("#wires");
  svg.innerHTML = "";
  const cols = $$(".col");
  if (cols.length < 2) return;

  const pad = svg.getBoundingClientRect();
  function midRight(el) {
    const r = el.getBoundingClientRect();
    return [r.right - pad.left, r.top + r.height/2 - pad.top];
  }
  function midLeft(el) {
    const r = el.getBoundingClientRect();
    return [r.left - pad.left, r.top + r.height/2 - pad.top];
  }

  // helper to connect pairs from round to next round
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

      // path: from src1 -> dst, and src2 -> dst
      const mx = (x1 + dx) / 2;
      addPath(x1,y1, dx, dy - 10, mx);
      const mx2 = (x2 + dx) / 2;
      addPath(x2,y2, dx, dy + 10, mx2);
    }
  }

  function addPath(x1,y1, x2,y2, cx) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
    p.setAttribute("d", d);
    svg.appendChild(p);
  }

  for (let i = 0; i < cols.length - 1; i++) {
    connectRound(cols[i], cols[i+1]);
  }
}

window.addEventListener("resize", () => { if (state.data) drawWires(); });
window.addEventListener("load", load);
