import API from './api.js';
import { renderBracket } from './bracket.js';

const $ = (s) => document.querySelector(s);

async function refresh() {
  const state = await API.getState();
  const status = state.tournament?.status || 'registering';
  $('#status').textContent = `状態: ${status}`;
  renderTeams(state.teams);

  renderBracket('#bracket', state, async (m) => {
    // live中のみ操作
    if ((state.tournament?.status || '') !== 'live') return;
    if (!m.team_a && !m.team_b) return;
    const choice = await pickWinnerDialog(m, state.teams);
    if (!choice) return;

    const pw = $('#admin-pass').value;
    if (!pw) return alert('管理パスワードを入力してください');

    try {
      await API.decideWinner(pw, m.id, choice);
      await refresh();
    } catch (e) {
      alert(e.message || e);
    }
  });
}

function renderTeams(teams) {
  const list = $('#teams');
  list.innerHTML = '';
  teams.forEach(t => {
    const li = document.createElement('li');
    li.className = 'team';
    li.innerHTML = `
      <div class="team-name">${escapeHtml(t.name)}</div>
      <div class="team-mems">${[t.member1, t.member2, t.member3].filter(Boolean).map(escapeHtml).join(' / ')}</div>
      <button class="danger small del">削除</button>
    `;
    li.querySelector('.del').addEventListener('click', async () => {
      const pw = $('#admin-pass').value;
      if (!pw) return alert('管理パスワードを入力してください');
      if (!confirm(`「${t.name}」を削除します。よろしいですか？`)) return;
      try {
        await API.deleteTeam(pw, t.id);
        await refresh();
      } catch (e) {
        alert(e.message || e);
      }
    });
    list.appendChild(li);
  });
}

function escapeHtml(s) {
  return (s ?? '').toString().replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function pickWinnerDialog(m, teams) {
  const a = teams.find(t => t.id === m.team_a);
  const b = teams.find(t => t.id === m.team_b);
  const nameA = a ? a.name : '(空き)';
  const nameB = b ? b.name : '(空き)';

  const choice = prompt(`[R${m.round} #${m.position}] 勝者を入力してください:\nA: ${nameA}\nB: ${nameB}\n(A/B/キャンセル)`, 'A');
  if (!choice) return null;
  if (/^a$/i.test(choice) && a) return a.id;
  if (/^b$/i.test(choice) && b) return b.id;
  return null;
}

// -------------- Buttons --------------
$('#add-team').addEventListener('click', async () => {
  const pw = $('#admin-pass').value;
  if (!pw) return alert('管理パスワードを入力してください');
  const name = $('#team-name').value.trim();
  if (!name) return alert('チーム名を入力してください');
  const member1 = $('#mem1').value.trim();
  const member2 = $('#mem2').value.trim();
  const member3 = $('#mem3').value.trim();
  try {
    await API.createTeam(pw, { name, member1, member2, member3 });
    $('#team-name').value = '';
    $('#mem1').value = '';
    $('#mem2').value = '';
    $('#mem3').value = '';
    await refresh();
  } catch (e) {
    alert(e.message || e);
  }
});

$('#start-btn').addEventListener('click', async () => {
  const pw = $('#admin-pass').value;
  if (!pw) return alert('管理パスワードを入力してください');
  const size = Number($('#target-size').value || '26');
  try {
    await API.startTournament(pw, size);
    await refresh();
  } catch (e) {
    alert(e.message || e);
  }
});

$('#go-live-btn').addEventListener('click', async () => {
  const pw = $('#admin-pass').value;
  if (!pw) return alert('管理パスワードを入力してください');
  try {
    await API.goLive(pw);
    await refresh();
  } catch (e) {
    alert(e.message || e);
  }
});

$('#reset-btn').addEventListener('click', async () => {
  const pw = $('#admin-pass').value;
  if (!pw) return alert('管理パスワードを入力してください');
  if (!confirm('全データをリセットします。よろしいですか？')) return;
  try {
    await API.resetTournament(pw);
    await refresh();
  } catch (e) {
    alert(e.message || e);
  }
});

// 初期ロード
refresh();
