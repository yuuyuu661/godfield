export async function getState() {
  const r = await fetch('/api/state');
  return r.json();
}
export async function listTeams() {
  const r = await fetch('/api/teams');
  return r.json();
}
export async function createTeam(payload) {
  const r = await fetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error((await r.json()).error || 'createTeam failed');
  return r.json();
}
export async function deleteTeam(id, password) {
  const r = await fetch(`/api/teams/${id}?password=${encodeURIComponent(password)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json()).error || 'deleteTeam failed');
  return r.json();
}
export async function startTournament(password) {
  const r = await fetch(`/api/tournament/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!r.ok) throw new Error((await r.json()).error || 'startTournament failed');
  return r.json();
}
export async function resetTournament(password) {
  const r = await fetch(`/api/tournament/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!r.ok) throw new Error((await r.json()).error || 'resetTournament failed');
  return r.json();
}
export async function decideWinner(matchId, winnerTeamId, password) {
  const r = await fetch(`/api/matches/${matchId}/winner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winnerTeamId, password })
  });
  if (!r.ok) throw new Error((await r.json()).error || 'decideWinner failed');
  return r.json();
}
