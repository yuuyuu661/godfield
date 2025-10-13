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

async function initDb() {
  const sql = fs.readFileSync('./schema.sql', 'utf8');
  await query(sql);
  console.log('DB ready');
}

function ok(res, data) { res.json(data); }
function requirePass(req, res, next) {
  const pass = req.body?.password || req.query?.password || req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* ========== API ========== */

// 全件（公開）
app.get('/api/entries', async (_req, res) => {
  const r = await query('SELECT * FROM entries ORDER BY id ASC');
  ok(res, r.rows);
});

// 追加（登録パス必要）
app.post('/api/entries', requirePass, async (req, res) => {
  const { team_name, member1='', member2='', member3='' } = req.body || {};
  if (!team_name) return res.status(400).json({ error: 'team_name is required' });
  const r = await query(
    'INSERT INTO entries (team_name, member1, member2, member3) VALUES ($1,$2,$3,$4) RETURNING *',
    [team_name, member1, member2, member3]
  );
  io.emit('entries:update'); // リアルタイム更新
  ok(res, r.rows[0]);
});

// 削除（誤登録用／パス必要）
app.delete('/api/entries/:id', requirePass, async (req, res) => {
  await query('DELETE FROM entries WHERE id=$1', [req.params.id]);
  io.emit('entries:update');
  ok(res, { ok: true });
});

// 一括リセット（パス必要・任意）
app.post('/api/reset', requirePass, async (_req, res) => {
  await query('TRUNCATE entries RESTART IDENTITY');
  io.emit('entries:update');
  ok(res, { ok: true });
});

/* ========== Socket.IO ========== */
io.on('connection', (socket) => {
  socket.emit('hello', 'connected');
});

server.listen(PORT, async () => {
  await initDb();
  console.log(`Server on :${PORT}`);
});
