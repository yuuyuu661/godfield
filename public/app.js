import { listEntries, addEntry, deleteEntry } from './api.js';

const socket = io();
socket.on('entries:update', () => refresh()); // 他人の登録も即反映

const listEl = document.getElementById('list');
const tpl = document.getElementById('row-tpl');

async function refresh() {
  const items = await listEntries();
  render(items);
}
function render(items) {
  listEl.innerHTML = '';
  for (const it of items) {
    const row = tpl.content.firstElementChild.cloneNode(true);
    row.querySelector('.id').textContent = `#${it.id}`;
    row.querySelector('.team').textContent = it.team_name;
    row.querySelector('.members').textContent =
      [it.member1, it.member2, it.member3].filter(Boolean).join(' / ') || '-';
    row.querySelector('.time').textContent =
      new Date(it.created_at).toLocaleString();
    listEl.appendChild(row);
  }
}

// 追加
document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const payload = Object.fromEntries(fd.entries());
  try {
    await addEntry(payload);
    e.currentTarget.reset();
    await refresh();
  } catch (e2) { alert(e2.message || e2); }
});

// 削除
document.getElementById('delete-btn').addEventListener('click', async () => {
  const id = Number(document.getElementById('delete-id').value);
  const pw = document.getElementById('delete-pass').value;
  if (!id || !pw) return alert('IDとパスワードを入力してください');
  try {
    await deleteEntry(id, pw);
    document.getElementById('delete-id').value = '';
    document.getElementById('delete-pass').value = '';
    await refresh();
  } catch (e) { alert(e.message || e); }
});

refresh();
