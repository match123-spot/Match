const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export function register(payload) {
  return apiFetch('/auth/register', { method: 'POST', body: payload });
}

export function login(payload) {
  return apiFetch('/auth/login', { method: 'POST', body: payload });
}

export function getMe(token) {
  return apiFetch('/users/me', { token });
}

export function listAvailability(token) {
  return apiFetch('/availability/me', { token });
}

export function createAvailability(token, payload) {
  return apiFetch('/availability', { method: 'POST', body: payload, token });
}

export function deleteAvailability(token, id) {
  return apiFetch(`/availability/${id}`, { method: 'DELETE', token });
}

export function pullMockShipments(token, count = 3) {
  return apiFetch('/shipments/mock-pull', { method: 'POST', body: { count }, token });
}

export function listShipments(token) {
  return apiFetch('/shipments/me', { token });
}

export function getMatchCandidates(token, shipmentId) {
  return apiFetch(`/matches/candidates/${shipmentId}`, { token });
}

export function requestMatch(token, shipmentId) {
  return apiFetch('/matches', { method: 'POST', body: { shipmentId }, token });
}

export function listMyMatches(token) {
  return apiFetch('/matches/me', { token });
}

export function approveMatch(token, matchId) {
  return apiFetch(`/matches/${matchId}/approve`, { method: 'POST', token });
}

export function rejectMatch(token, matchId) {
  return apiFetch(`/matches/${matchId}/reject`, { method: 'POST', token });
}
