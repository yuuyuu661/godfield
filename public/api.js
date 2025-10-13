export async function listEntries() {
  const r = await fetch('/api/entries');
  return r.json();
}
export async function addEntry(payload) {
  const r = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error((await r.json()).error || 'addEntry failed');
  return r.json();
}
export async function deleteEntry(id, password) {
  const r = await fetch(`/api/entries/${id}?password=${encodeURIComponent(password)}`, {
    method: 'DELETE'
  });
  if (!r.ok) throw new Error((await r.json()).error || 'deleteEntry failed');
  return r.json();
}
