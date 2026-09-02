// Thin fetch wrapper shared by every page. Mirrors the BASE_URL convention
// and localStorage keys the Express backend + old HTML pages already used,
// so existing sessions and server-side auth logic keep working unchanged.
//
// VITE_API_BASE_URL (set in frontend/.env or frontend/.env.production) wins
// when present, so a build can be pointed at any host — staging, a second
// client domain, etc — with zero code changes. With no env var set, this
// falls back to zero-config behaviour: the standalone dev backend during
// `vite dev`, and otherwise the app's own origin + mount path.
//
// That mount path must NOT be hardcoded. The backend serves this SPA and the
// API from the same Express process, so the API root is always wherever the
// app itself is mounted — BASE_URL (from VITE_BASE_PATH at build time), the
// same value App.jsx feeds to BrowserRouter's basename. Hardcoding a sub-path
// here silently 404s every request the moment the deploy moves, which is
// exactly what happened when the '/hlgp' mount was retired in favour of
// '/audit'.
export function apiBase() {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, '');
  if (window.location.hostname.includes('localhost')) return 'http://localhost:5001';
  return (window.location.origin + import.meta.env.BASE_URL).replace(/\/+$/, '');
}

export function getToken() {
  return localStorage.getItem('jwt_token');
}

export function isAdminSession() {
  return localStorage.getItem('is_admin') === 'true';
}

export function setSession({ token, isAdmin }) {
  localStorage.setItem('jwt_token', token);
  localStorage.setItem('is_admin', isAdmin ? 'true' : 'false');
}

export function clearSession() {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('is_admin');
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Generic JSON request. `path` is relative to the API root, e.g. '/api/admin/users'
// or '/api/rag-audit/questions'. Set `auth: false` to skip the bearer header
// (only the login/signup endpoints need this).
export async function apiFetch(path, { method = 'GET', body, headers, auth = true, isForm = false } = {}) {
  const finalHeaders = { ...(headers || {}) };
  if (!isForm) finalHeaders['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: finalHeaders,
    body: body == null ? undefined : (isForm ? body : JSON.stringify(body))
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new ApiError(data.message || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export const authApi = {
  verifyToken: (token) => apiFetch(`/api/verify-token?token=${encodeURIComponent(token)}`, { auth: false }),
  resetPassword: (token, password) => apiFetch('/api/reset-password', { method: 'POST', body: { token, password }, auth: false })
};

// Convenience namespace for the rag-audit module's endpoints.
export const ragApi = {
  health: () => apiFetch('/api/rag-audit/health'),
  score: (contactId, opts = {}) => apiFetch(`/api/rag-audit/score/${contactId}${opts.save ? '?save=1' : ''}`, { method: 'POST' }),
  fullReport: (contactId, result) => apiFetch(`/api/rag-audit/score/${contactId}/full-report`, {
    method: 'POST',
    body: { areas: result.areas, entityLabel: result.entity, score: result.score, rating: result.rating, criticalFailures: result.criticalFailures, scoredAt: result.scoredAt }
  }),
  analyzeUpload: (formData) => apiFetch('/api/rag-audit/analyze-upload', { method: 'POST', body: formData, isForm: true }),
  note: (contactId, body) => apiFetch(`/api/rag-audit/note/${contactId}`, { method: 'POST', body: { body } }),

  listQuestions: () => apiFetch('/api/rag-audit/questions'),
  addQuestion: (payload) => apiFetch('/api/rag-audit/questions', { method: 'POST', body: payload }),
  updateQuestion: (id, payload) => apiFetch(`/api/rag-audit/questions/${id}`, { method: 'PUT', body: payload }),
  archiveQuestion: (id) => apiFetch(`/api/rag-audit/questions/${id}`, { method: 'DELETE' }),
  restoreQuestion: (id) => apiFetch(`/api/rag-audit/questions/${id}/restore`, { method: 'POST' }),
  reorderQuestions: (order) => apiFetch('/api/rag-audit/questions/reorder', { method: 'POST', body: { order } }),

  formSchema: (contactId) => apiFetch(`/api/rag-audit/form-schema${contactId ? `?contactId=${contactId}` : ''}`),
  getResponses: (contactId) => apiFetch(`/api/rag-audit/responses/${contactId}`),
  saveAnswers: (contactId, answers) => apiFetch(`/api/rag-audit/responses/${contactId}`, { method: 'POST', body: { answers } }),
  uploadEvidence: (contactId, formData) => apiFetch(`/api/rag-audit/responses/${contactId}/upload`, { method: 'POST', body: formData, isForm: true }),
  removeFile: (contactId, qId, fieldKey, url) => apiFetch(`/api/rag-audit/responses/${contactId}/remove-file`, { method: 'POST', body: { qId, fieldKey, url } }),

  // Per-client question assignment — which subset of the bank a given
  // individual is actually asked. assignedIds: null/omitted = everyone.
  getAssignments: (contactId) => apiFetch(`/api/rag-audit/assignments/${contactId}`),
  saveAssignments: (contactId, assignedIds) => apiFetch(`/api/rag-audit/assignments/${contactId}`, { method: 'POST', body: { assignedIds } }),
  getEditPermissions: (contactId) => apiFetch(`/api/rag-audit/edit-permissions/${contactId}`),
  saveEditPermissions: (contactId, questionIds) => apiFetch(`/api/rag-audit/edit-permissions/${contactId}`, { method: 'POST', body: { questionIds } }),

  // Client-facing assistant: their own status + general process info only.
  clientChat: (message) => apiFetch('/api/rag-audit/client-chat', { method: 'POST', body: { message } }),
  messageAdmin: (message) => apiFetch('/api/rag-audit/message-admin', { method: 'POST', body: { message } })
};

export { ApiError };
