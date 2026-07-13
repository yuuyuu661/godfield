import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, "data.json");
const publicDir = path.join(__dirname, "public");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "gerogero";

const emptyState = () => ({ participantCount: 0, bracketSize: 0, slots: [], results: {} });

async function readState() {
  try {
    return { ...emptyState(), ...JSON.parse(await fs.readFile(dataFile, "utf8")) };
  } catch {
    return emptyState();
  }
}

async function writeState(state) {
  await fs.writeFile(dataFile, JSON.stringify(state, null, 2), "utf8");
}

function validCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 12 && count <= 32 ? count : null;
}

function requireAdmin(req, res, next) {
  if ((req.headers["x-admin-password"] || "") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "管理者パスワードが違います" });
  }
  next();
}

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/api/state", async (_req, res) => res.json(await readState()));

app.post("/api/setup", async (req, res) => {
  const participantCount = validCount(req.body.participantCount);
  if (!participantCount) return res.status(400).json({ error: "人数は12〜32の整数で入力してください" });
  const current = await readState();
  if (current.bracketSize && (req.headers["x-admin-password"] || "") !== ADMIN_PASSWORD) {
    return res.status(409).json({ error: "作成済みの表は、上部のリセットボタンからリセットしてください" });
  }
  const bracketSize = participantCount <= 16 ? 16 : 32;
  const state = {
    participantCount,
    bracketSize,
    slots: Array.from({ length: bracketSize }, (_, index) => index < participantCount ? null : "BYE"),
    results: {}
  };
  await writeState(state);
  res.json(state);
});

app.post("/api/assign", async (req, res) => {
  const state = await readState();
  const seed = Number(req.body.seed);
  const name = String(req.body.name || "").trim().slice(0, 80);
  if (!state.bracketSize) return res.status(409).json({ error: "先にトーナメント表を作成してください" });
  if (!Number.isInteger(seed) || seed < 1 || seed > state.participantCount) {
    return res.status(400).json({ error: "登録先のシードが不正です" });
  }
  if (!name || name === "BYE") return res.status(400).json({ error: "有効な名前を入力してください" });
  state.slots = state.slots.map(value => value === name ? null : value);
  state.slots[seed - 1] = name;
  state.results = {};
  await writeState(state);
  res.json(state);
});

app.post("/api/result", async (req, res) => {
  const state = await readState();
  const matchId = String(req.body.matchId || "");
  const winner = String(req.body.winner || "");
  if (!/^r\d+m\d+$/.test(matchId) || !winner || winner === "BYE") {
    return res.status(400).json({ error: "勝敗データが不正です" });
  }
  state.results[matchId] = winner;
  await writeState(state);
  res.json(state);
});

app.post("/api/reset", requireAdmin, async (_req, res) => {
  const state = emptyState();
  await writeState(state);
  res.json(state);
});

app.use(express.static(publicDir));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Tournament server: http://localhost:" + port));

