import { getState, addTeam, startTournament, setWinner } from './api.js';
import { renderBracket } from './bracket.js';

let STATE = { teams: [], matches: [], tournament: {} };
const socket = io();
socket.on('state', st => { STATE = st; renderAll(); });

document.getElementById('team-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  await addTeam(payload);
  e.target.reset();
});

document.getElementById('start').addEventListener('click', async () => {
  const pass = prompt('管理パスワードを入力');
  await startTournament(pass);
});

function renderAll() {
  const tlist = document.getElementById('teams');
  tlist.innerHTML = STATE.teams.map(t => `<div>・${t.name}</div>`).join('');
  renderBracket(document.getElementById('bracket'), STATE, onMatchClick);
}

async function onMatchClick(m) {
  if (!m.team_a && !m.team_b) return;
  const ids = [m.team_a, m.team_b].filter(Boolean);
  const names = ids.map(id => STATE.teams.find(t => t.id === id)?.name);
  const choice = prompt(`勝者を選択:\n${ids.map((id, i) => `${id}: ${names[i]}`).join('\n')}`);
  const winner = Number(choice);
  if (!winner || !ids.includes(winner)) return alert('無効なID');
  const pass = prompt('管理パスワードを入力');
  await setWinner(m.id, winner, pass);
}

getState().then(st => { STATE = st; renderAll(); });
