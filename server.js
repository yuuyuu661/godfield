import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { query } from './db.js';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function requireAdmin(req, res, next) {
  const pass = req.body?.password || req.query?.password;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function initDb() {
  const sql = fs.readFileSync('./schema.sql', 'utf8');
  await query(sql);
  const t = await query('SELECT * FROM tournament ORDER BY id LIMIT 1');
  if (t.rowCount === 0) {
    await query("INSERT INTO tournament (title, status) VALUES ($1, 'registering')", ['Tournament']);
  }
  console.log('DB initialized');
}

function ceilPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }
function seedOrder(n) {
  let arr = [1, 2];
  while (arr.length < n) {
    const m = arr.length * 2;
    const next = [];
    for (let i = 0; i < arr.length; i++) next.push(arr[i]);
    for (let i = arr.length - 1; i >= 0; i--) next.push(m + 1 - arr[i]);
    arr = next;
  }
  return arr.slice(0, n);
}

async function getState() {
  const t = await query('SELECT * FROM tournament ORDER BY id LIMIT 1');
  const teams = await query('SELECT * FROM teams ORDER BY id');
  const matches = await query('SELECT * FROM matches ORDER BY round, position');
  return { tournament: t.rows[0], teams: teams.rows, matches: matches.rows };
}

io.on('connection', async (socket) => {
  socket.emit('state', await getState());
});

function broadcast() {
  getState().then((state) => io.emit('state', state));
}

// ========== API ==========

// 登録一覧
app.get('/api/state', async (_req, res) => res.json(await getState()));

// チーム登録
app.post('/api/teams', requireAdmin, async (req, res) => {
  const { name, member1, member2, member3 } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const r = await query(
    'INSERT INTO teams (name, member1, member2, member3) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, member1 || '', member2 || '', member3 || '']
  );
  broadcast();
  res.json(r.rows[0]);
});

// 大会開始
app.post('/api/start', requireAdmin, async (_req, res) => {
  const teams = await query('SELECT * FROM teams ORDER BY id');
  const N = teams.rowCount;
  if (N < 2) return res.status(400).json({ error: 'Need 2+ teams' });

  await query('DELETE FROM matches');
  const bracketSize = (N % 2 === 1) ? N + 1 : N;
  const order = seedOrder(bracketSize);
  const ids = teams.rows.map(t => t.id);
  const placed = Array(bracketSize).fill(null);
  for (let i = 0; i < N; i++) placed[order[i] - 1] = ids[i];

  const rounds = Math.log2(ceilPow2(bracketSize));
  let prevIds = [];
  for (let r = 1; r <= rounds; r++) {
    const roundMatches = [];
    for (let i = 0; i < bracketSize / Math.pow(2, r); i++) {
      const a = r === 1 ? placed[i * 2] : null;
      const b = r === 1 ? placed[i * 2 + 1] : null;
      const ins = await query(
        'INSERT INTO matches (round, position, team_a, team_b) VALUES ($1,$2,$3,$4) RETURNING id',
        [r, i + 1, a, b]
      );
      roundMatches.push(ins.rows[0].id);
    }
    prevIds.push(roundMatches);
  }

  // BYEを勝者として自動進出
  const byeMatches = await query('SELECT * FROM matches WHERE round=1');
  for (const m of byeMatches.rows) {
    if (m.team_a && !m.team_b) await advanceWinner(m.id, m.team_a);
    if (!m.team_a && m.team_b) await advanceWinner(m.id, m.team_b);
  }

  await query("UPDATE tournament SET status='live'");
  broadcast();
  res.json({ ok: true });
});

async function advanceWinner(matchId, winnerId) {
  await query('UPDATE matches SET winner=$1 WHERE id=$2', [winnerId, matchId]);
  const m = await query('SELECT * FROM matches WHERE id=$1', [matchId]);
  const match = m.rows[0];
  const next = await query('SELECT * FROM matches WHERE round=$1 AND position=$2', [match.round + 1, Math.ceil(match.position / 2)]);
  if (next.rowCount) {
    const nextMatch = next.rows[0];
    const slot = (match.position % 2 === 1) ? 'team_a' : 'team_b';
    await query(`UPDATE matches SET ${slot}=$1 WHERE id=$2`, [winnerId, nextMatch.id]);
  }
}

// 勝敗確定
app.post('/api/match/:id/win', requireAdmin, async (req, res) => {
  const { winner } = req.body;
  await advanceWinner(req.params.id, winner);
  broadcast();
  res.json({ ok: true });
});

server.listen(PORT, async () => {
  await initDb();
  console.log(`Server running on :${PORT}`);
});
