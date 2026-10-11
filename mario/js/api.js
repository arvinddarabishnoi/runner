// Thin fetch wrapper around the server API. All URLs are relative so the
// client works behind any host (including the sandbox preview proxy).

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const msg = (body && body.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

export const api = {
  levels: () => request('api/levels'),
  level: (id) => request(`api/levels/${encodeURIComponent(id)}`),
  leaderboard: (levelId) => request(`api/leaderboard?level=${encodeURIComponent(levelId)}`),
  player: (name) => request(`api/players/${encodeURIComponent(name)}`),
  submitScore: (entry) => request('api/scores', { method: 'POST', body: JSON.stringify(entry) }),
};
