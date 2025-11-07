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

// DB
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

function teamAtSeed(seed, slots) {
  return slots[seed - 1];
}

function computeBracket(state) {
  const { slots, results } = state;
  const map = matchMap();

  // Build a deterministic list with ids matching map order
  const all = [];
  map.round1.forEach(m => all.push({ ...m }));
  map.round2.forEach(m => all.push({ ...m }));
  map.quarters.forEach(m => all.push({ ...m }));
  map.semis.forEach(m => all.push({ ...m }));
  map.final.forEach(m => all.push({ ...m }));

  // helper
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

// API
app.get("/api/state", async (req, res) => {
  await db.read();
  const bracket = computeBracket(db.data);
  res.json({ teams: db.data.teams, slots: db.data.slots, results: db.data.results, bracket });
});

app.post("/api/teams/add", auth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Team name required" });
  await db.read();
  if (db.data.teams.includes(name.trim())) return res.status(409).json({ error: "Team already exists" });
  db.data.teams.push(name.trim());
  await db.write();
  res.json({ ok: true, teams: db.data.teams });
});

app.post("/api/teams/update", auth, async (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName || !newName.trim()) return res.status(400).json({ error: "Bad params" });
  await db.read();
  const i = db.data.teams.indexOf(oldName);
  if (i === -1) return res.status(404).json({ error: "Team not found" });
  if (db.data.teams.includes(newName.trim())) return res.status(409).json({ error: "New name already exists" });
  db.data.teams[i] = newName.trim();
  // Update slots
  db.data.slots = db.data.slots.map(t => t === oldName ? newName.trim() : t);
  await db.write();
  res.json({ ok: true, teams: db.data.teams, slots: db.data.slots });
});

app.post("/api/teams/delete", auth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  await db.read();
  const i = db.data.teams.indexOf(name);
  if (i === -1) return res.status(404).json({ error: "Team not found" });
  db.data.teams.splice(i, 1);
  // Remove from slots
  db.data.slots = db.data.slots.map(t => t === name ? null : t);
  // Results become inconsistent; safest is to clear results:

  db.data.results = {};
  await db.write();
  res.json({ ok: true, teams: db.data.teams, slots: db.data.slots, results: db.data.results });
});

app.post("/api/seed/clear", auth, async (req, res) => {
  await db.read();
  db.data.slots = Array(32).fill(null);
  await db.write();
  res.json({ ok: true, slots: db.data.slots });
});

app.post("/api/seed/random", auth, async (req, res) => {
  const { onlyUnassigned } = req.body || {};
  await db.read();
  const pool = db.data.teams.slice();
  if (onlyUnassigned) {
    db.data.slots.forEach((t) => {
      if (t) {
        const i = pool.indexOf(t);
        if (i !== -1) pool.splice(i, 1);
      }
    });
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let p = 0;
  for (let s = 0; s < 32 && p < pool.length; s++) {
    if (!onlyUnassigned || !db.data.slots[s]) db.data.slots[s] = pool[p++];
  }
  await db.write();
  res.json({ ok: true, slots: db.data.slots });
});

app.post("/api/seed/assign-one", auth, async (req, res) => {
  const { seed } = req.body;
  if (!seed || seed < 1 || seed > 32) return res.status(400).json({ error: "Invalid seed" });
  await db.read();
  const placed = new Set(db.data.slots.filter(Boolean));
  const remaining = db.data.teams.filter(t => !placed.has(t));
  if (!remaining.length) return res.status(409).json({ error: "No teams remaining" });
  const pick = remaining[Math.floor(Math.random() * remaining.length)];
  db.data.slots[seed - 1] = pick;
  await db.write();
  res.json({ ok: true, seed, team: pick, slots: db.data.slots });
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
