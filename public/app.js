import { getState, listTeams, createTeam, deleteTeam, startTournament, resetTournament, decideWinner } from './api.js';
import { renderBracket } from './bracket.js';

const socket = io();
let STATE = { tournament:{}, teams:[], matches:[] };

socket.on('state', (st) => {
  STATE = st;
  render();
});

async function render() {
  document.getElementById('status').textContent = `状態: ${STATE.tournament.status}`;
  renderTeams();
  renderBracket(document.getElementById('bracket'), STATE, onClickMatch);
}

function renderTeams() {
  const el = document.getElementById('teams');
  el.innerHTML = '';
  STATE.teams.forEach(t => {
    const box = document.getElementById('team-item').content.firstElementChild.cloneNode(true);
    box.querySelector('.team-name').textContent = t.name;
    box.querySelector('.team-members').textContent = [t.member1, t.member2, t.member3].filter(Boolean).join(' / ');
    el.appendChild(box);
  });
}

document.getElementById('team-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const payload = Object.fromEntries(fd.entries());
  try {
    await createTeam(payload);
    e.currentTarget.reset();
  } catch (err) {
    alert(err.message || err);
  }
});

document.getElementById('start-btn').addEventListener('click', async () => {
  const password = document.getElementById('admin-pass').value;
  if (!password) return alert('管理パスワードを入力してください');
  try {
    await startTournament(password);
  } catch (e) { alert(e.message || e); }
});

document.getElementById('reset-btn').addEventListener('click', async () => {
  const password = document.getElementById('admin-pass').value;
  if (!password) return alert('管理パスワードを入力してください');
  if (!confirm('本当に全リセットしますか？')) return;
  try { await resetTournament(password); } catch (e) { alert(e.message || e); }
});

async function onClickMatch(m) {
  if (STATE.tournament.status !== 'live') return;
  if (!m.team_a && !m.team_b) return;
  const options = [];
  if (m.team_a) options.push({ id: m.team_a, name: nameOf(m.team_a) });
  if (m.team_b) options.push({ id: m.team_b, name: nameOf(m.team_b) });

  const choice = prompt(`勝者を入力してください: ${options.map(o=>`${o.id}:${o.name}`).join(' / ')}`);
  if (!choice) return;
  const winnerId = Number(choice.trim());
  if (!options.some(o=>o.id===winnerId)) return alert('そのチームIDはこの試合に存在しません');

  const password = document.getElementById('admin-pass').value;
  if (!password) return alert('管理パスワードを入力してください');

  try {
    await decideWinner(m.id, winnerId, password);
  } catch (e) {
    alert(e.message || e);
  }
}

function nameOf(id) {
  const t = STATE.teams.find(x=>x.id===id);
  return t ? t.name : '(不明)';
}

// 初期ロード（Socketのstateまでの間を埋める）
getState().then((st) => { STATE = st; render(); });
