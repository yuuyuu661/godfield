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
const db = new Low(adapter, { teams: [], slots: Array(32).fill(null), results: {} });
await db.read();
if (!db.data) db.data = { teams: [], slots: Array(32).fill(null), results: {} };
await db.write();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const auth = (req, res, next) => {
  const pass = (req.headers["x-admin-pass"] || req.body.password || "").toString();
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
  next();
};

function matchMap() {
  const round1 = Array.from({ length: 16 }, (_, i) => ({ id: `m${i + 1}`, aSeed: i * 2 + 1, bSeed: i * 2 + 2 }));
  const round2 = Array.from({ length: 8 }, (_, i) => ({ id: `m${17 + i}`, aFrom: `m${i * 2 + 1}`, bFrom: `m${i * 2 + 2}` }));
  const quarters = Array.from({ length: 4 }, (_, i) => ({ id: `m${25 + i}`, aFrom: `m${17 + i * 2}`, bFrom: `m${18 + i * 2}` }));
  const semis = [ { id: "m29", aFrom: "m25", bFrom: "m26" }, { id: "m30", aFrom: "m27", bFrom: "m28" } ];
  const final = [ { id: "m31", aFrom: "m29", bFrom: "m30" } ];
  return { round1, round2, quarters, semis, final };
}

function teamAtSeed(seed, slots) { return slots[seed - 1]; }

function computeBracket(state) {
  const { slots, results } = state;
  const map = matchMap();
  const all = [];
  map.round1.forEach(m => all.push({ ...m }));
  map.round2.forEach(m => all.push({ ...m }));
  map.quarters.forEach(m => all.push({ ...m }));
  map.semis.forEach(m => all.push({ ...m }));
  map.final.forEach(m => all.push({ ...m }));

  const winnerOf = (id) => {
    const m = all.find(x => x.id === id);
    let a = m.aSeed ? teamAtSeed(m.aSeed, slots) : winnerOf(m.aFrom);
    let b = m.bSeed ? teamAtSeed(m.bSeed, slots) : winnerOf(m.bFrom);
    const pick = results[id];
    if (pick === "A") return a || null;
    if (pick === "B") return b || null;
    return null;
  };

  const resolved = all.map(m => {
    const aName = m.aSeed ? teamAtSeed(m.aSeed, slots) : winnerOf(m.aFrom);
    const bName = m.bSeed ? teamAtSeed(m.bSeed, slots) : winnerOf(m.bFrom);
    const winner = results[m.id] || null;
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
