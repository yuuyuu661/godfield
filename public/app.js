import { BYE, DOUBLE, SINGLE, isPlayer, resolveBracket } from "./bracket.js";

const $ = selector => document.querySelector(selector);

let state = { format: SINGLE, participantCount: 0, bracketSize: 0, slots: [], results: {} };
let rouletteItems = [];
let rotation = 0;
let spinning = false;
let toastTimer;
let savingResult = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "通信に失敗しました");
  return body;
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function roundName(index, total) {
  if (index === total - 1) return "決勝";
  if (index === total - 2) return "準決勝";
  if (index === total - 3) return "準々決勝";
  return (index + 1) + "回戦";
}

function matchLabel(id) {
  const [, side, round, match] = /^([rl])(\d+)m(\d+)$/.exec(id);
  return (side === "r" ? "W" : "L") + round + "-" + match;
}

function sourceLabel(player) {
  if (player.seed) return "未登録";
  const { id, outcome } = player.source;
  return matchLabel(id) + (outcome === "loser" ? "の敗者" : "の勝者");
}

function renderRounds(container, rounds, side) {
  const track = document.createElement("div");
  track.className = "bracket-track";
  const cards = new Map();
  const edges = [];
  rounds.forEach((matches, roundIndex) => {
    const round = document.createElement("section");
    round.className = "round";
    const title = document.createElement("h3");
    title.className = "round-title";
    title.textContent = side === "lower" && roundIndex < rounds.length - 1
      ? (roundIndex + 1) + "回戦"
      : roundName(roundIndex, rounds.length);
    const list = document.createElement("div");
    list.className = "round-matches";

    matches.forEach(match => {
      const card = matchCard(match, state.format === DOUBLE ? matchLabel(match.id) : "");
      cards.set(match.id, card);
      for (const entrant of [match.a, match.b]) {
        if (cards.has(entrant.source.id)) edges.push([entrant.source.id, match.id]);
      }
      list.appendChild(card);
    });
    round.append(title, list);
    track.appendChild(round);
  });

  const svgNS = "http://www.w3.org/2000/svg";
  const lines = document.createElementNS(svgNS, "svg");
  lines.classList.add("bracket-lines");
  lines.setAttribute("aria-hidden", "true");
  track.prepend(lines);
  container.replaceChildren(track);

  const previousObserver = bracketObservers.get(container);
  previousObserver?.disconnect();
  function drawConnections() {
    const origin = track.getBoundingClientRect();
    const rects = new Map(Array.from(cards, ([id, card]) => [id, card.getBoundingClientRect()]));
    lines.replaceChildren(...edges.map(([from, to]) => {
      const a = rects.get(from);
      const b = rects.get(to);
      const x1 = a.right - origin.left;
      const x2 = b.left - origin.left;
      const y1 = a.top + a.height / 2 - origin.top;
      const y2 = b.top + b.height / 2 - origin.top;
      const mid = (x1 + x2) / 2;
      const line = document.createElementNS(svgNS, "path");
      line.setAttribute("d", `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
      return line;
    }));
  }
  drawConnections();
  const observer = new ResizeObserver(drawConnections);
  observer.observe(track);
  bracketObservers.set(container, observer);
}

const bracketObservers = new WeakMap();

function renderBracket() {
  const model = resolveBracket(state);
  const isDouble = state.format === DOUBLE;
  $("#bracketTitle").textContent = isDouble ? "勝者トーナメント" : "トーナメント表";
  $("#lowerBracketSection").hidden = !isDouble;
  $("#finalsSection").hidden = !isDouble;
  renderRounds($("#bracket"), model.upper, "upper");
  if (isDouble) {
    renderRounds($("#lowerBracket"), model.lower, "lower");
    $("#finals").replaceChildren(...model.finals.map((match, i) =>
      matchCard(match, i === 0 ? "第1試合" : "第2試合（ブラケットリセット）")
    ));
  }
  const champion = $("#champion");
  champion.hidden = !model.champion;
  champion.textContent = model.champion ? "優勝　" + model.champion : "";
}

function matchCard(match, label) {
  const card = document.createElement("div");
  card.className = "match";
  card.dataset.match = match.id;
  if (label) {
    const heading = document.createElement("div");
    heading.className = "match-label";
    heading.textContent = label;
    card.appendChild(heading);
  }
  card.append(playerButton(match, match.a, 0), playerButton(match, match.b, 1));
  return card;
}

function playerButton(match, player, index) {
  const button = document.createElement("button");
  const opponent = player === match.a ? match.b : match.a;
  const winner = isPlayer(player.name) && match.winner === player.name;
  button.type = "button";
  button.className = "player" + (winner ? " winner" : "");
  button.disabled = !match.playable;

  const seed = document.createElement("span");
  seed.className = "seed";
  seed.textContent = player.seed ?? "·";
  const name = document.createElement("span");
  name.className = "name" + (!isPlayer(player.name) ? " empty" : "");
  if (player.name === BYE) {
    name.textContent = "BYE";
  } else if (player.name) {
    name.textContent = player.name;
  } else if (match.id.startsWith("gf")) {
    name.textContent = index === 0 ? "勝者側の代表待ち" : "敗者側の代表待ち";
  } else {
    name.textContent = state.format === DOUBLE ? sourceLabel(player) : "未登録";
  }
  button.append(seed, name);

  if (match.playable) {
    button.title = player.name + "を勝者にする";
    button.addEventListener("click", async () => {
      if (savingResult || winner) return;
      const message = match.winner
        ? player.name + " に勝者を訂正しますか？ 対戦者が変わる後続試合の結果は取り消されます。"
        : player.name + " を勝者として登録しますか？";
      if (!confirm(message)) return;
      savingResult = true;
      try {
        state = await api("/api/result", {
          method: "POST",
          body: JSON.stringify({ matchId: match.id, winner: player.name, opponent: opponent.name })
        });
        renderBracket();
        const card = $(`[data-match="${match.id}"]`);
        card?.querySelectorAll(".player")[index]?.focus({ preventScroll: true });
      } catch (error) {
        notify(error.message);
      } finally {
        savingResult = false;
      }
    });
  }
  return button;
}

function openSeeds() {
  return Array.from({ length: state.participantCount }, (_, i) => i + 1)
    .filter(seed => !state.slots[seed - 1]);
}

function updateAllocationControls(preferredSeed) {
  const select = $("#targetSeed");
  const previous = Number(preferredSeed || select.value);
  const seeds = openSeeds();
  select.innerHTML = "";
  seeds.forEach(seed => {
    const option = document.createElement("option");
    option.value = seed;
    option.textContent = "シード " + seed;
    select.appendChild(option);
  });
  if (seeds.includes(previous)) select.value = String(previous);
  $("#allocationStatus").textContent = seeds.length
    ? "未登録 " + seeds.length + "枠 / " + state.participantCount + "人"
    : "全プレイヤーの登録が完了しました";
  $("#spinButton").disabled = spinning || !seeds.length || !rouletteItems.length;
  $("#names").disabled = spinning;
  $("#loadNames").disabled = spinning;
  select.disabled = spinning || !seeds.length;
  $("#resetButton").disabled = spinning;
}

function renderState() {
  const active = Boolean(state.bracketSize);
  $("#rouletteCard").hidden = !active;
  $("#bracketSection").hidden = !active;
  $("#lowerBracketSection").hidden = !active || state.format !== DOUBLE;
  $("#finalsSection").hidden = !active || state.format !== DOUBLE;
  if (!active) $("#champion").hidden = true;
  $("#doubleElimination").checked = state.format === DOUBLE;
  $("#doubleElimination").disabled = active;
  $("#participantCount").value = state.participantCount || 16;
  $("#participantCount").disabled = active;
  $("#setupForm").querySelector("button").disabled = active;
  if (active) {
    renderBracket();
    updateAllocationControls();
    drawWheel();
  }
}

function parseNames(raw) {
  const seen = new Set();
  return raw.split(/[,、\n]+/)
    .map(name => name.trim().slice(0, 80))
    .filter(name => isPlayer(name) && !state.slots.includes(name) && !seen.has(name) && seen.add(name));
}

function drawWheel(angle = rotation) {
  const canvas = $("#wheel");
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 12;
  const items = rouletteItems.length ? rouletteItems : ["名前を登録"];
  const segment = Math.PI * 2 / items.length;
  const colors = ["#e44736", "#f2c94c", "#2b7056", "#f8eee0", "#58a6a6", "#ef8a62"];

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(angle);
  items.forEach((item, index) => {
    const start = index * segment;
    const end = start + segment;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#171717";
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + segment / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = index % colors.length === 0 || index % colors.length === 2 ? "#fff" : "#171717";
    ctx.font = "800 " + Math.max(12, Math.min(20, 260 / items.length + 10)) + "px sans-serif";
    const label = item.length > 15 ? item.slice(0, 14) + "…" : item;
    ctx.fillText(label, radius - 20, 0);
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fillStyle = "#171717";
  ctx.fill();
  ctx.restore();
  rotation = angle;
}

async function spin() {
  if (spinning || !rouletteItems.length) return;
  const seed = Number($("#targetSeed").value);
  if (!seed) return notify("登録できる空き枠がありません");
  spinning = true;
  updateAllocationControls(seed);
  $("#rouletteResult").textContent = "抽選中…";

  const chosenIndex = Math.floor(Math.random() * rouletteItems.length);
  const segment = Math.PI * 2 / rouletteItems.length;
  const desired = -Math.PI / 2 - (chosenIndex + 0.5) * segment;
  const normalizedDelta = ((desired - rotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const startRotation = rotation;
  const endRotation = rotation + Math.PI * 2 * 6 + normalizedDelta;
  const started = performance.now();
  const duration = 3800;

  await new Promise(resolve => {
    function frame(now) {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      drawWheel(startRotation + (endRotation - startRotation) * eased);
      if (progress < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });

  const winner = rouletteItems[chosenIndex];
  try {
    state = await api("/api/assign", {
      method: "POST",
      body: JSON.stringify({ seed, name: winner })
    });
    rouletteItems.splice(chosenIndex, 1);
    $("#names").value = rouletteItems.join(", ");
    $("#rouletteResult").textContent = winner + " → シード " + seed;
    rotation = 0;
    drawWheel();
    renderBracket();
    updateAllocationControls();
  } catch (error) {
    $("#rouletteResult").textContent = winner;
    notify(error.message);
  } finally {
    spinning = false;
    updateAllocationControls();
  }
}

$("#setupForm").addEventListener("submit", async event => {
  event.preventDefault();
  const participantCount = Number($("#participantCount").value);
  const format = $("#doubleElimination").checked ? DOUBLE : SINGLE;
  try {
    state = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({ participantCount, format })
    });
    rouletteItems = [];
    renderState();
    notify(participantCount + "人用のトーナメント表を作成しました");
  } catch (error) {
    notify(error.message);
  }
});

$("#loadNames").addEventListener("click", () => {
  rouletteItems = parseNames($("#names").value);
  $("#names").value = rouletteItems.join(", ");
  rotation = 0;
  drawWheel();
  updateAllocationControls();
  $("#rouletteResult").textContent = rouletteItems.length
    ? rouletteItems.length + "人を登録しました"
    : "名前を入力してください";
});

$("#names").addEventListener("input", () => {
  if (!spinning) $("#rouletteResult").textContent = "「ルーレットに登録」を押してください";
});
$("#spinButton").addEventListener("click", spin);

$("#resetButton").addEventListener("click", async () => {
  const password = prompt("管理者パスワードを入力してください");
  if (password === null) return;
  if (!confirm("トーナメント表・登録選手・勝敗をすべてリセットします。よろしいですか？")) return;
  try {
    state = await api("/api/reset", {
      method: "POST",
      headers: { "x-admin-password": password }
    });
    rouletteItems = [];
    rotation = 0;
    $("#names").value = "";
    $("#rouletteResult").textContent = "名前を登録してください";
    renderState();
    notify("トーナメント表をリセットしました");
  } catch (error) {
    notify(error.message);
  }
});

window.addEventListener("load", async () => {
  try {
    state = await api("/api/state");
    renderState();
  } catch (error) {
    notify(error.message);
  }
});

