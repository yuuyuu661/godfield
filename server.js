import express from "express";
import cors from "cors";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const dbFile = path.join(__dirname, "db.json");
const adapter = new JSONFile(dbFile);

const db = new Low(adapter, {
  teams: [],
  upperSlots: Array(32).fill(null),
  lowerSlots: Array(32).fill(null),
  results: {}
});

await db.read();

if (!db.data) {
  db.data = {
    teams: [],
    upperSlots: Array(32).fill(null),
    lowerSlots: Array(32).fill(null),
    results: {}
  };
}

// 旧データ移行
if (!db.data.upperSlots) {
  db.data.upperSlots = Array.isArray(db.data.slots)
    ? [...db.data.slots, ...Array(Math.max(0, 32 - db.data.slots.length)).fill(null)].slice(0, 32)
    : Array(32).fill(null);
}
if (!db.data.lowerSlots) {
  db.data.lowerSlots = Array(32).fill(null);
}
if (!db.data.results) db.data.results = {};
if (!db.data.teams) db.data.teams = [];
delete db.data.slots;

await db.write();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "yamada";

const auth = (req, res, next) => {
  const pass = (req.headers["x-admin-pass"] || req.body.password || "").toString();
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  next();
};

function matchMap() {
  return {
    // ===== 勝者側（今まで通り）=====
    upper: {
      round1: [
        { id: "m1", aSeed: 1, bSeed: 2 }
      ],
      round2: [
        { id: "m2", aSeed: 3, bSeed: 4 },
        { id: "m3", aSeed: 5, bSeed: 6 },
        { id: "m4", aSeed: 7, bSeed: 8 },
        { id: "m5", aFrom: "m1", bSeed: 9 }
      ],
      semis: [
        { id: "m6", aFrom: "m2", bFrom: "m3" },
        { id: "m7", aFrom: "m4", bFrom: "m5" }
      ],
      final: [
        { id: "m8", aFrom: "m6", bFrom: "m7" }
      ]
    },

    // ===== 敗者側（完全手動・完全独立）=====
    // 1回戦 1個 / 2回戦 2個 / 準決勝 2個 / 決勝 1個
    lower: {
      round1: [
        { id: "l1", aSeed: 1, bSeed: 2 }
      ],
      round2: [
        { id: "l2", aSeed: 3, bSeed: 4 },
        { id: "l3", aSeed: 5, bSeed: 6 }
      ],
      semis: [
        { id: "l4", aSeed: 7, bSeed: 8 },
        { id: "l5", aSeed: 9, bSeed: 10 }
      ],
      final: [
        { id: "l6", aSeed: 11, bSeed: 12 }
      ]
    },

    // ===== グランドファイナル =====
    grandFinal: [
      { id: "gf", aFrom: "m8", bFrom: "l6" }
    ]
  };
}

function teamAtSeed(seed, slots) {
  return slots[seed - 1] || null;
}

function buildBracket(section, slots, results) {
  const all = [];

  section.round1?.forEach(m => all.push({ ...m }));
  section.round2?.forEach(m => all.push({ ...m }));
  section.semis?.forEach(m => all.push({ ...m }));
  section.final?.forEach(m => all.push({ ...m }));

  const winnerOf = (id) => {
    const m = all.find(x => x.id === id);
    if (!m) return null;

    const a = m.aSeed ? teamAtSeed(m.aSeed, slots) : winnerOf(m.aFrom);
    const b = m.bSeed ? teamAtSeed(m.bSeed, slots) : winnerOf(m.bFrom);

    const r = results[id];
    const pick = typeof r === "string" ? r : r?.winner;

    if (pick === "A") return a || null;
    if (pick === "B") return b || null;
    return null;
  };

  const resolved = all.map(m => {
    const aName = m.aSeed ? teamAtSeed(m.aSeed, slots) : winnerOf(m.aFrom);
    const bName = m.bSeed ? teamAtSeed(m.bSeed, slots) : winnerOf(m.bFrom);

    const r = results[m.id];
    const winner = typeof r === "string" ? r : r?.winner || null;

    return {
      id: m.id,
      aSeed: m.aSeed || null,
      bSeed: m.bSeed || null,
      aFrom: m.aFrom || null,
      bFrom: m.bFrom || null,
      aName: aName || null,
      bName: bName || null,
      winner
    };
  });

  return { map: section, resolved, winnerOf };
}

function computeBracket(state) {
  const { upperSlots, lowerSlots, results } = state;
  const map = matchMap();

  const upper = buildBracket(map.upper, upperSlots, results);
  const lower = buildBracket(map.lower, lowerSlots, results);

  const grandFinal = map.grandFinal.map(m => {
    const aName = upper.winnerOf("m8");
    const bName = lower.winnerOf("l6");

    const r = results[m.id];
    const winner = typeof r === "string" ? r : r?.winner || null;

    return {
      id: m.id,
      aName: aName || null,
      bName: bName || null,
      winner
    };
  });

  return { upper, lower, grandFinal };
}

function syncTeamsFromSlots(data) {
  const set = new Set();
  for (const t of data.upperSlots || []) if (t) set.add(t);
  for (const t of data.lowerSlots || []) if (t) set.add(t);
  data.teams = Array.from(set);
}

app.get("/api/state", async (req, res) => {
  await db.read();
  const bracket = computeBracket(db.data);

  res.json({
    teams: db.data.teams,
    upperSlots: db.data.upperSlots,
    lowerSlots: db.data.lowerSlots,
    results: db.data.results,
    bracket
  });
});

app.post("/api/seed/set-name", auth, async (req, res) => {
  const { seed, name, bracket } = req.body;

  if (!seed || seed < 1 || seed > 32) {
    return res.status(400).json({ error: "Invalid seed" });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Invalid name" });
  }

  if (bracket !== "upper" && bracket !== "lower") {
    return res.status(400).json({ error: "Invalid bracket" });
  }

  await db.read();

  const key = bracket === "upper" ? "upperSlots" : "lowerSlots";
  const n = name.trim();

  db.data[key] = db.data[key].map((t, idx) =>
    idx === seed - 1 ? t : (t === n ? null : t)
  );

  db.data[key][seed - 1] = n;

  syncTeamsFromSlots(db.data);
  await db.write();

  res.json({
    ok: true,
    upperSlots: db.data.upperSlots,
    lowerSlots: db.data.lowerSlots
  });
});

app.post("/api/seed/clear", auth, async (req, res) => {
  await db.read();
  db.data.upperSlots = Array(32).fill(null);
  db.data.lowerSlots = Array(32).fill(null);
  db.data.results = {};
  syncTeamsFromSlots(db.data);
  await db.write();

  res.json({
    ok: true,
    upperSlots: db.data.upperSlots,
    lowerSlots: db.data.lowerSlots,
    results: db.data.results
  });
});

function isValidMatchId(matchId) {
  return /^(m\d+|l\d+|gf)$/.test(matchId);
}

app.post("/api/results/set", auth, async (req, res) => {
  const { matchId, winner } = req.body;

  if (!isValidMatchId(matchId)) {
    return res.status(400).json({ error: "Bad matchId" });
  }

  if (!(winner === "A" || winner === "B")) {
    return res.status(400).json({ error: "Winner must be 'A' or 'B'" });
  }

  await db.read();
  db.data.results[matchId] = winner;
  await db.write();

  res.json({ ok: true, results: db.data.results });
});

app.post("/api/results/reset", auth, async (req, res) => {
  await db.read();
  db.data.results = {};
  await db.write();
  res.json({ ok: true });
});

app.post("/api/results/set-bo3", auth, async (req, res) => {
  const { matchId, games, winner } = req.body;

  if (!isValidMatchId(matchId)) {
    return res.status(400).json({ error: "Bad matchId" });
  }

  if (!Array.isArray(games) || games.length === 0) {
    return res.status(400).json({ error: "Games required" });
  }

  if (!(winner === "A" || winner === "B")) {
    return res.status(400).json({ error: "Winner must be A or B" });
  }

  await db.read();

  db.data.results[matchId] = {
    games,
    winner
  };

  await db.write();
  res.json({ ok: true, results: db.data.results });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
