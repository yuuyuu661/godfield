const $ = selector => document.querySelector(selector);

let state = { participantCount: 0, bracketSize: 0, slots: [], results: {} };
let rouletteItems = [];
let rotation = 0;
let spinning = false;
let toastTimer;

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

function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap(seed => [seed, sum - seed]);
  }
  return order;
}

function createBracketModel() {
  if (!state.bracketSize) return [];
  let entrants = seedOrder(state.bracketSize).map(seed => ({
    name: state.slots[seed - 1],
    seed
  }));
  const rounds = [];
  const totalRounds = Math.log2(state.bracketSize);

  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
    const matches = [];
    const next = [];
    for (let i = 0; i < entrants.length; i += 2) {
      const a = entrants[i];
      const b = entrants[i + 1];
      const id = "r" + (roundIndex + 1) + "m" + (i / 2 + 1);
      let winner = null;

      if (a.name && a.name !== "BYE" && b.name === "BYE") winner = a.name;
      if (b.name && b.name !== "BYE" && a.name === "BYE") winner = b.name;
      if (a.name && b.name && a.name !== "BYE" && b.name !== "BYE") {
        const saved = state.results[id];
        if (saved === a.name || saved === b.name) winner = saved;
      }

      matches.push({ id, a, b, winner });
      next.push({ name: winner, seed: null });
    }
    rounds.push(matches);
    entrants = next;
  }
  return rounds;
}

function roundName(index, total) {
  if (index === total - 1) return "決勝";
  if (index === total - 2) return "準決勝";
  if (index === total - 3) return "準々決勝";
  return (index + 1) + "回戦";
}

function renderBracket() {
  const container = $("#bracket");
  container.innerHTML = "";
  const rounds = createBracketModel();

  rounds.forEach((matches, roundIndex) => {
    const round = document.createElement("section");
    round.className = "round";
    const title = document.createElement("div");
    title.className = "round-title";
    title.textContent = roundName(roundIndex, rounds.length);
    const list = document.createElement("div");
    list.className = "round-matches";

    matches.forEach(match => {
      const card = document.createElement("div");
      card.className = "match";
      card.append(
        playerButton(match, match.a, roundIndex),
        playerButton(match, match.b, roundIndex)
      );
      list.appendChild(card);
    });

    round.append(title, list);
    container.appendChild(round);
  });
}

function playerButton(match, player, roundIndex) {
  const button = document.createElement("button");
  const playable = player.name && player.name !== "BYE";
  const opponent = player === match.a ? match.b : match.a;
  const canDecide = playable && opponent.name && opponent.name !== "BYE";
  button.className = "player" + (match.winner === player.name ? " winner" : "");
  button.disabled = !canDecide;

  const seed = document.createElement("span");
  seed.className = "seed";
  seed.textContent = roundIndex === 0 && player.seed ? player.seed : "·";
  const name = document.createElement("span");
  name.className = "name" + (!player.name ? " empty" : "");
  name.textContent = player.name === "BYE" ? "BYE" : (player.name || "未登録");
  button.append(seed, name);

  if (canDecide) {
    button.title = player.name + "を勝者にする";
    button.addEventListener("click", async () => {
      if (!confirm(player.name + " を勝者として登録しますか？")) return;
      try {
        state = await api("/api/result", {
          method: "POST",
          body: JSON.stringify({ matchId: match.id, winner: player.name })
        });
        renderBracket();
      } catch (error) {
        notify(error.message);
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
}

function renderState() {
  const active = Boolean(state.bracketSize);
  $("#rouletteCard").hidden = !active;
  $("#bracketSection").hidden = !active;
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
    .map(name => name.trim())
    .filter(name => name && !seen.has(name) && seen.add(name));
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
  try {
    state = await api("/api/setup", {
      method: "POST",
      body: JSON.stringify({ participantCount })
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

