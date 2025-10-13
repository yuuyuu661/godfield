const API = {
  async getState() {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error('state failed');
    return r.json();
  },
  async listTeams() {
    const r = await fetch('/api/teams');
    if (!r.ok) throw new Error('teams failed');
    return r.json();
  },
  async createTeam(password, body) {
    const r = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, ...body })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'create failed');
    return r.json();
  },
  async deleteTeam(password, id) {
    const r = await fetch(`/api/teams/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'delete failed');
    return r.json();
  },
  async startTournament(password, targetSize = 26) {
    const r = await fetch('/api/tournament/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, targetSize })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'start failed');
    return r.json();
  },
  async goLive(password) {
    const r = await fetch('/api/tournament/go_live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'go_live failed');
    return r.json();
  },
  async resetTournament(password) {
    const r = await fetch('/api/tournament/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'reset failed');
    return r.json();
  },
  async decideWinner(password, matchId, teamId) {
    const r = await fetch(`/api/matches/${matchId}/winner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, teamId })
    });
    if (!r.ok) throw new Error((await r.json()).error || 'winner failed');
    return r.json();
  }
};
export default API;
