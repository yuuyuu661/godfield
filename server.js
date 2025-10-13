const express = require('express');
const path = require('path');
const cors = require('cors');
const { query, tx } = require('./db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PORT = process.env.PORT || 8080;

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// public配下を静的配信
const publicDir = path.resolve(__dirname, 'public');
app.use(express.static(publicDir));

/** --------- BRACKET HELPERS ---------- **/

function ceilPow2(n) {
  let v = 1;
  while (v < n) v <<= 1;
  return v;
}

// seedOrder(size) -> 長さsizeの配列
// index = seed-1, 値 = そのseedが入るposition(1..size)
function seedOrder(size) {
  if ((size & (size - 1)) !== 0) throw new Error('size must be power of 2');
  const build = (n) => {
    if (n === 2) return [1, 2]; // 位置に入るseed
    const prev = build(n / 2);
    const res = [];
    for (let i = 0; i < prev.length; i += 2) {
      const a = prev[i];
      const b = prev[i + 1];
      // a vs (n+1-a), (n+1-b) vs b のように拡張
      res.push(a, n + 1 - a, n + 1 - b, b);
    }
    return res;
  };
  const arr = build(size); // 位置に入るseed番号の並び
  const posBySeed = Array(size).fill(0);
  arr.forEach((seed, idx) => (posBySeed[seed - 1] = idx + 1));
  return posBySeed;
}

async function createBracket(client, size) {
  await client.query('DELETE FROM matches');
  const rounds = Math.log2(size);

  for (let r = 1; r <= rounds; r++) {
    const matches = size >> r;
    for (let p = 1; p <= matches; p++) {
      await client.query('INSERT INTO matches (round, position) VALUES ($1,$2)', [r, p]);
    }
  }

  for (let r = 1; r < rounds; r++) {
    const matches = size >> r;
    for (let p = 1; p <= matches; p++) {
      const nextPos = Math.ceil(p / 2);
      const nextIsA = p % 2 === 1; // 奇数勝者がA
      const cur = await client.query('SELECT id FROM matches WHERE round=$1 AND position=$2', [r, p]);
      const nxt = await client.query('SELECT id FROM matches WHERE round=$1 AND position=$2', [r + 1, nextPos]);
      await client.query('UPDATE matches SET next_match_id=$1, next_is_a=$2 WHERE id=$3', [
        nxt.rows[0].id,
        nextIsA,
        cur.rows[0].id
      ]);
    }
  }
}

async function putTeamAtSeedPosition(client, size, position1toSize, teamId) {
  const idx = position1toSize - 1;
  const r1pos = Math.floor(idx / 2) + 1;
  const isA = idx % 2 === 0;
  await client.query(
    `UPDATE matches SET ${isA ? 'team_a' : 'team_b'}=$1 WHERE round=1 AND position=$2`,
    [teamId, r1pos]
  );
}

async function r1OccupiedPositions(client, size) {
  const r = await client.query('SELECT team_a, team_b FROM matches WHERE round=1 ORDER BY position');
  const occ = [];
  r.rows.forEach((m, i) => {
    const base = i * 2;
    if (m.team_a) occ.push(base + 1);
    if (m.team_b) occ.push(base + 2);
  });
  return occ;
}

// seeding中の新規登録を次の空きシードに自動配置
async function assignSeedSlot(client, teamId) {
  const r = await client.query('SELECT COUNT(*)::int AS c FROM matches WHERE round=1');
  const m = r.rows[0]?.c || 0;
  if (m === 0) return; // まだ表がない
  const size = m * 2;

  const order = seedOrder(size);
  const occ = await r1OccupiedPositions(client, size);

  const nextSeed = occ.length + 1;
  if (nextSeed > size) return; // 満杯
  const pos = order[nextSeed - 1];
  await putTeamAtSeedPosition(client, size, pos, teamId);
}

async function advanceWinner(client, matchId, winnerTeamId) {
  await client.query('UPDATE matches SET winner=$1 WHERE id=$2', [winnerTeamId, matchId]);
  const r = await client.query('SELECT next_match_id, next_is_a FROM matches WHERE id=$1', [matchId]);
  const { next_match_id, next_is_a } = r.rows[0] || {};
  if (!next_match_id) return;
  const col = next_is_a ? 'team_a' : 'team_b';
  await client.query(`UPDATE matches SET ${col}=$1 WHERE id=$2`, [winnerTeamId, next_match_id]);
}

/** ---------- API ---------- **/

// 状態まとめ
app.get('/api/state', async (_req, res) => {
  const t = await query('SELECT * FROM tournament ORDER BY id LIMIT 1');
  const teams = await query('SELECT * FROM teams ORDER BY id');
  const matches = await query('SELECT * FROM matches ORDER BY round, position, id');
  res.json({ tournament: t.rows[0] || null, teams: teams.rows, matches: matches.rows });
});

function requireAdmin(req, res, next) {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'forbidden' });
  next();
}

// チーム一覧
app.get('/api/teams', async (_req, res) => {
  const r = await query('SELECT * FROM teams ORDER BY id');
  res.json(r.rows);
});

// チーム作成（seeding中なら枠に自動配置）
app.post('/api/teams', requireAdmin, async (req, res) => {
  const { name, member1, member2, member3 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  const inserted = await query(
    'INSERT INTO teams (name, member1, member2, member3) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, member1 || '', member2 || '', member3 || '']
  );

  const t = await query('SELECT status FROM tournament ORDER BY id LIMIT 1');
  if (t.rows[0]?.status === 'seeding') {
    await tx(async (client) => {
      await assignSeedSlot(client, inserted.rows[0].id);
    });
  }
  res.json(inserted.rows[0]);
});

// チーム削除
app.delete('/api/teams/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad id' });
  await tx(async (client) => {
    await client.query('UPDATE matches SET team_a=NULL WHERE team_a=$1', [id]);
    await client.query('UPDATE matches SET team_b=NULL WHERE team_b=$1', [id]);
    await client.query('UPDATE matches SET winner=NULL WHERE winner=$1', [id]);
    await client.query('DELETE FROM teams WHERE id=$1', [id]);
  });
  res.json({ ok: true });
});

// トーナメント開始（= seeding表を作るだけ）
app.post('/api/tournament/start', requireAdmin, async (req, res) => {
  const t = await query('SELECT * FROM tournament ORDER BY id LIMIT 1');
  const teamsRes = await query('SELECT * FROM teams ORDER BY id');
  const teams = teamsRes.rows;

  if (!['registering', 'seeding'].includes(t.rows[0]?.status)) {
    return res.status(400).json({ error: 'Already started' });
  }
  if (teams.length < 1) return res.status(400).json({ error: 'Need at least 1 team' });

  const targetSize = Math.max(2, Math.min(32, Number(req.body?.targetSize || 26)));
  const size = ceilPow2(targetSize); // 26→32

  await tx(async (client) => {
    await client.query('UPDATE tournament SET status=$1 WHERE id=$2', ['seeding', t.rows[0].id]);
    await createBracket(client, size);

    const order = seedOrder(size);
    for (let i = 0; i < Math.min(teams.length, size); i++) {
      const seed = i + 1;
      const pos = order[seed - 1];
      await putTeamAtSeedPosition(client, size, pos, teams[i].id);
    }
  });

  res.json({ ok: true, size });
});

// ライブ開始（BYEを自動勝ち上がり処理）
app.post('/api/tournament/go_live', requireAdmin, async (_req, res) => {
  await tx(async (client) => {
    await client.query(
      "UPDATE tournament SET status='live' WHERE id=(SELECT id FROM tournament ORDER BY id LIMIT 1)"
    );
    const r1 = await client.query('SELECT * FROM matches WHERE round=1 ORDER BY position');
    for (const m of r1.rows) {
      if (m.winner) continue;
      if (m.team_a && !m.team_b) await advanceWinner(client, m.id, m.team_a);
      if (!m.team_a && m.team_b) await advanceWinner(client, m.id, m.team_b);
    }
  });
  res.json({ ok: true });
});

// リセット
app.post('/api/tournament/reset', requireAdmin, async (_req, res) => {
  await tx(async (client) => {
    await client.query('DELETE FROM matches');
    await client.query('DELETE FROM teams');
    await client.query("UPDATE tournament SET status='registering'");
  });
  res.json({ ok: true });
});

// 勝者確定
app.post('/api/matches/:id/winner', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { teamId } = req.body || {};
  if (!id || !teamId) return res.status(400).json({ error: 'bad params' });

  await tx(async (client) => {
    await advanceWinner(client, id, teamId);
  });
  res.json({ ok: true });
});

/** ------ SPAのためのルーティング（index.htmlを返す） ------ **/
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server on :' + PORT);
});
