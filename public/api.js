export async function getState() {
  const r = await fetch('/api/state');
  return r.json();
}
export async function addTeam(payload) {
  const r = await fetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return r.json();
}
export async function startTournament(password) {
  const r = await fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  return r.json();
}
export async function setWinner(id, winner, password) {
  const r = await fetch(`/api/match/${id}/win`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, password })
  });
  return r.json();
}
