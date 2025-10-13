import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { query, tx } from './db.js';
import fs from 'fs';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function requireAdmin(req, res, next) {
  const pass = req.body?.password || req.query?.password || req.headers['x-admin-pass'];
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
  // 標準のトーナメントシード(1..n)の対戦順を生成
  // 例: 8 -> [1,8,4,5,3,6,2,7]
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

/* === API === */

// 状態
app.get('/api/state', async (req, res) => {
  res.json(await getState());
});

// チーム登録
app.post('/api/teams', requireAdmin, async (req, res) => {
  const { name, member1, member2, member3 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const r = await query(
    'INSERT INTO teams (name, member1, member2, member3) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, member1 || '', member2 || '', member3 || '']
  );
  broadcast();
  res.json(r.rows[0]);
});

// チーム一覧
app.get('/api/teams', async (req, res) => {
  const r = await query('SELECT * FROM teams ORDER BY id');
  res.json(r.rows);
});

// チーム削除（誤登録用）
app.delete('/api/teams/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM teams WHERE id=$1', [req.params.id]);
  broadcast();
  res.json({ ok: true });
});

// 大会開始（シード＆試合生成）
app.post('/api/tournament/start', requireAdmin, async (req, res) => {
  const tRes = await query('SELECT * FROM tournament ORDER BY id LIMIT 1');
  const t = tRes.rows[0];
  if (t.status !== 'registering') return res.status(400).json({ error: 'Already started' });

  const teamsRes = await query('SELECT * FROM teams ORDER BY id');
  const teams = teamsRes.rows;
  if (teams.length < 2) return res.status(400).json({ error: 'Need at least 2 teams' });

  await tx(async (client) => {
    await client.query('UPDATE tournament SET status=$1 WHERE id=$2', ['live', t.id]);
    await client.query('DELETE FROM matches');

    const N = teams.length;
    const bracketSize = ceilPow2(N);
    const byes = bracketSize - N;

    // シード順を作成してチームを並べる
    const order = seedOrder(bracketSize);
    const placed = Array(bracketSize).fill(null);
    // 実質シード番号=チームID昇順で割り当て（簡易）
    const sortedTeamIds = teams.map(x => x.id).sort((a,b)=>a-b);
    for (let i = 0; i < N; i++) placed[order[i]-1] = sortedTeamIds[i];
    // 残りはnull（BYE）

    // Round 1 作成
    const roundCount = Math.log2(bracketSize);
    const matchIdsByRound = [];
    let pos = 1;
    const r1 = [];
    for (let i = 0; i < bracketSize; i += 2) {
      const a = placed[i];
      const b = placed[i+1];
      const ins = await client.query(
        'INSERT INTO matches (round, position, team_a, team_b) VALUES ($1,$2,$3,$4) RETURNING id',
        [1, pos++, a, b]
      );
      r1.push(ins.rows[0].id);
    }
    matchIdsByRound.push(r1);

    // 後続ラウンド作成（空枠）
    for (let r = 2; r <= roundCount; r++) {
      const prev = matchIdsByRound[r-2];
      const current = [];
      pos = 1;
      for (let i = 0; i < prev.length; i += 2) {
        const ins = await client.query(
          'INSERT INTO matches (round, position) VALUES ($1,$2) RETURNING id',
          [r, pos++]
        );
        const mid = ins.rows[0].id;
        current.push(mid);
        // 親子リンク設定（勝者の流入先）
        await client.query(
          'UPDATE matches SET next_match_id=$1, next_is_a=true WHERE id=$2',
          [mid, prev[i]]
        );
        await client.query(
          'UPDATE matches SET next_match_id=$1, next_is_a=false WHERE id=$2',
          [mid, prev[i+1]]
        );
      }
      matchIdsByRound.push(current);
    }

    // R1のBYEを自動勝ち上がり
    const r1Rows = await client.query('SELECT * FROM matches WHERE round=1 ORDER BY position');
    for (const m of r1Rows.rows) {
      if (m.team_a && !m.team_b) {
        // Aが不戦勝
        await advanceWinner(client, m.id, m.team_a);
      } else if (!m.team_a && m.team_b) {
        await advanceWinner(client, m.id, m.team_b);
      }
    }
  });

  broadcast();
  res.json({ ok: true });
});

// 勝敗確定
app.post('/api/matches/:id/winner', requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  const { winnerTeamId } = req.body || {};
  if (!winnerTeamId) return res.status(400).json({ error: 'winnerTeamId required' });

  await tx(async (client) => {
    const mRes = await client.query('SELECT * FROM matches WHERE id=$1', [matchId]);
    if (mRes.rowCount === 0) throw new Error('match not found');
    const m = mRes.rows[0];
    if (m.winner) throw new Error('Already decided');

    if (![m.team_a, m.team_b].includes(winnerTeamId)) {
      throw new Error('Winner must be team_a or team_b of this match');
    }
    await advanceWinner(client, matchId, winnerTeamId);
  });

  broadcast();
  res.json({ ok: true });
});

async function advanceWinner(client, matchId, winnerTeamId) {
  // 現試合に勝者を書き込み
  await client.query('UPDATE matches SET winner=$1 WHERE id=$2', [winnerTeamId, matchId]);

  // 次の試合に進める
  const mRes = await client.query('SELECT * FROM matches WHERE id=$1', [matchId]);
  const m = mRes.rows[0];
  if (m.next_match_id) {
    const next = await client.query('SELECT * FROM matches WHERE id=$1', [m.next_match_id]);
    const nm = next.rows[0];
    if (m.next_is_a) {
      await client.query('UPDATE matches SET team_a=$1 WHERE id=$2', [winnerTeamId, nm.id]);
    } else {
      await client.query('UPDATE matches SET team_b=$1 WHERE id=$2', [winnerTeamId, nm.id]);
    }
    // 決勝が決まったら大会終了
    const anyFinal = await client.query('SELECT * FROM matches ORDER BY round DESC, position LIMIT 1');
    if (anyFinal.rows[0].id === nm.id && nm.team_a && nm.team_b) {
      // 決勝のwinnerは別途確定時にfinishedになる
    }
  } else {
    // nextが無い＝決勝の勝者
    await client.query("UPDATE tournament SET status='finished' WHERE id=(SELECT id FROM tournament ORDER BY id LIMIT 1)");
  }
}

// リセット（全消し）
app.post('/api/tournament/reset', requireAdmin, async (req, res) => {
  await tx(async (client) => {
    await client.query('DELETE FROM matches');
    await client.query('DELETE FROM teams');
    await client.query("UPDATE tournament SET status='registering'");
  });
  broadcast();
  res.json({ ok: true });
});

// DB初期化スイッチ
if (process.argv.includes('--init-db')) {
  initDb().then(() => process.exit(0));
}

server.listen(PORT, async () => {
  await initDb();
  console.log(`Server on :${PORT}`);
});
