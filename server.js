import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BYE, DOUBLE, SINGLE, resolveBracket } from "./public/bracket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, "data.json");
const publicDir = path.join(__dirname, "public");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const emptyState = () => ({ format: SINGLE, participantCount: 0, bracketSize: 0, slots: [], results: {} });

async function readState() {
  try {
    return { ...emptyState(), ...JSON.parse(await fs.readFile(dataFile, "utf8")) };
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(state) {
  const tempFile = dataFile + ".tmp";
  await fs.writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tempFile, dataFile);
}

// One read/modify/write at a time, so overlapping updates cannot restore old results.
let pendingWrite = Promise.resolve();
function mutate(handler) {
  return (req, res, next) => {
    const request = pendingWrite.then(() => handler(req, res));
    pendingWrite = request.catch(() => {});
    request.catch(next);
  };
}

function validCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 12 && count <= 32 ? count : null;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "管理者パスワードが設定されていません" });
  if ((req.headers["x-admin-password"] || "") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "管理者パスワードが違います" });
  }
  next();
}

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/api/state", (_req, res, next) => readState().then(state => res.json(state)).catch(next));

app.post("/api/setup", mutate(async (req, res) => {
  const participantCount = validCount(req.body?.participantCount);
  const format = req.body?.format ?? SINGLE;
  if (!participantCount) return res.status(400).json({ error: "人数は12〜32の整数で入力してください" });
  if (format !== SINGLE && format !== DOUBLE) return res.status(400).json({ error: "大会形式が不正です" });
  const current = await readState();
  if (current.bracketSize && (!ADMIN_PASSWORD || req.headers["x-admin-password"] !== ADMIN_PASSWORD)) {
    return res.status(409).json({ error: "作成済みの表は、上部のリセットボタンからリセットしてください" });
  }
  const bracketSize = participantCount <= 16 ? 16 : 32;
  const state = {
    format,
    participantCount,
    bracketSize,
    slots: Array.from({ length: bracketSize }, (_, index) => index < participantCount ? null : BYE),
    results: {}
  };
  await writeState(state);
  res.json(state);
}));

app.post("/api/assign", mutate(async (req, res) => {
  const state = await readState();
  const seed = Number(req.body?.seed);
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
  if (!state.bracketSize) return res.status(409).json({ error: "先にトーナメント表を作成してください" });
  if (!Number.isInteger(seed) || seed < 1 || seed > state.participantCount) {
    return res.status(400).json({ error: "登録先のシードが不正です" });
  }
  if (!name || name === BYE) return res.status(400).json({ error: "有効な名前を入力してください" });
  if (state.slots[seed - 1]) return res.status(409).json({ error: "この枠にはすでにプレイヤーが登録されています" });
  if (state.slots.includes(name)) return res.status(409).json({ error: "この名前はすでに登録されています" });
  const previous = resolveBracket(state);
  state.slots[seed - 1] = name;
  state.results = resolveBracket(state, previous).results;
  await writeState(state);
  res.json(state);
}));

app.post("/api/result", mutate(async (req, res) => {
  const state = await readState();
  const { matchId, winner, opponent } = req.body ?? {};
  if (typeof matchId !== "string" || typeof winner !== "string") {
    return res.status(400).json({ error: "勝敗データが不正です" });
  }
  const previous = resolveBracket(state);
  const match = previous.matches.get(matchId);
  if (!match?.playable) return res.status(409).json({ error: "対戦者が確定していないか、登録できない試合です" });

  const actualOpponent = winner === match.a.name ? match.b.name : winner === match.b.name ? match.a.name : null;
  if (!actualOpponent || (opponent !== undefined && opponent !== actualOpponent)) {
    return res.status(409).json({ error: "対戦者が一致しません。ページを再読み込みして確認してください" });
  }
  state.results = { ...previous.results, [matchId]: winner };
  state.results = resolveBracket(state, previous).results;
  await writeState(state);
  res.json(state);
}));

app.post("/api/reset", requireAdmin, mutate(async (_req, res) => {
  const state = emptyState();
  await writeState(state);
  res.json(state);
}));

app.use(express.static(publicDir));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.status === 400) return res.status(400).json({ error: "リクエストの形式が不正です" });
  if (error.status === 413) return res.status(413).json({ error: "入力が長すぎます" });
  console.error(error);
  res.status(500).json({ error: "大会データにアクセスできませんでした" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Tournament server: http://localhost:" + port));
