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
const db = new Low(adapter, { teams: [], slots: Array(10).fill(null), results: {} });
await db.read();
if (!db.data) db.data = { teams: [], slots: Array(10).fill(null), results: {} };
await db.write();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "yamada";
const auth = (req, res, next) => {
  const pass = (req.headers["x-admin-pass"] || req.body.password || "").toString();
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  next();
};

function matchMap() {
  return {
    // 🥊 1回戦（予選）
    round1: [
      { id: "m1", aSeed: 1, bSeed: 2 }
    ],

    // 🏆 2回戦（手動入力ゾーン）
    round2: [
      { id: "m2", aSeed: 3, bSeed: 4 },
      { id: "m3", aSeed: 5, bSeed: 6 },
      { id: "m4", aSeed: 7, bSeed: 8 },
      { id: "m5", aSeed: 9, bSeed: 10 }
    ],

    // 🔥 準決勝（自動）
    semis: [
      { id: "m6", aFrom: "m2", bFrom: "m3" },
      { id: "m7", aFrom: "m4", bFrom: "m5" }
    ],

    // 👑 決勝（自動）
    final: [
      { id: "m8", aFrom: "m6", bFrom: "m7" }
    ]
  };
}

function teamAtSeed(seed, slots) { return slots[seed - 1]; }

function computeBracket(state) {
  const { slots, results } = state;
  const map = matchMap();
  const all = [];
  map.round1.forEach(m => all.push({ ...m }));
  map.round2.forEach(m => all.push({ ...m }));
  map.semis.forEach(m => all.push({ ...m }));
  map.final.forEach(m => all.push({ ...m }));

  const winnerOf = (id) => {
    const m = all.find(x => x.id === id);
    let a = m.aSeed ? teamAtSeed(m.aSeed, slots) : winnerOf(m.aFrom);
    let b = m.bSeed ? teamAtSeed(m.bSeed, slots) : winnerOf(m.bFrom);

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
    return { id: m.id, aSeed: m.aSeed || null, bSeed: m.bSeed || null, aFrom: m.aFrom || null, bFrom: m.bFrom || null, aName: aName || null, bName: bName || null, winner };
  });

  return { map, resolved };
}

function syncTeamsFromSlots(data) {
  const set = new Set();
  for (const t of data.slots) if (t) set.add(t);
  data.teams = Array.from(set);
}

app.get("/api/state", async (req, res) => {
  await db.read();
  const bracket = computeBracket(db.data);
  res.json({ teams: db.data.teams, slots: db.data.slots, results: db.data.results, bracket });
});

app.post("/api/seed/set-name", auth, async (req, res) => {
  const { seed, name } = req.body;
  if (!seed || seed < 1 || seed > 32) return res.status(400).json({ error: "Invalid seed" });
  if (!name || !name.trim()) return res.status(400).json({ error: "Invalid name" });
  await db.read();
  const n = name.trim();
  db.data.slots = db.data.slots.map((t, idx) => (idx === seed - 1 ? t : (t === n ? null : t)));
  db.data.slots[seed - 1] = n;
  syncTeamsFromSlots(db.data);
  await db.write();
  res.json({ ok: true, slots: db.data.slots, teams: db.data.teams });
});

app.post("/api/seed/clear", auth, async (req, res) => {
  await db.read();
  db.data.slots = Array(32).fill(null);
  db.data.results = {};
  syncTeamsFromSlots(db.data);
  await db.write();
  res.json({ ok: true, slots: db.data.slots, results: db.data.results });
});

app.post("/api/results/set", auth, async (req, res) => {
  const { matchId, winner } = req.body;
  if (!/^m\d+$/.test(matchId)) return res.status(400).json({ error: "Bad matchId" });
  if (!(winner === "A" || winner === "B")) return res.status(400).json({ error: "Winner must be 'A' or 'B'" });
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

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));

app.post("/api/results/set-bo3", auth, async (req, res) => {
  const { matchId, games, winner } = req.body;

  if (!/^m\d+$/.test(matchId))
    return res.status(400).json({ error: "Bad matchId" });

  if (!Array.isArray(games) || games.length === 0)
    return res.status(400).json({ error: "Games required" });

  if (!(winner === "A" || winner === "B"))
    return res.status(400).json({ error: "Winner must be A or B" });

  await db.read();

  // ★ BO3結果を保存
  db.data.results[matchId] = {
    games,
    winner
  };

  await db.write();
  res.json({ ok: true, results: db.data.results });
});
