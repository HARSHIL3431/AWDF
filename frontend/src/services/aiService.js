import { authService } from './authService';

// Same browser-reachable backend base URL as authService/taskService.
// The BROWSER only ever talks to our own Express backend here — never to
// OpenAI or Gemini. The provider key lives in the backend environment and
// would be worthless (and readable) in a VITE_* variable, because Vite inlines
// those into the shipped JavaScript bundle.
const AI_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/ai/generate-description`;

const getAuthHeaders = () => {
  const token = authService.getToken();
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

// Mirrors taskService.handleResponse so an expired token behaves identically
// everywhere in the app. The AI failure itself is surfaced with `status` and
// `fallback` attached so the task form can show a friendly message instead of
// raw JSON or a provider error.
const handleResponse = async (res) => {
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    authService.removeToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth-unauthorized'));
    }
    throw new Error(data.error || 'Unauthorized: Please log in');
  }

  if (!res.ok) {
    const error = new Error(data.message || data.error || 'AI suggestion unavailable');
    error.status = res.status;
    error.fallback = Boolean(data.fallback);
    error.retryAfter = res.headers.get('Retry-After');
    throw error;
  }

  return data;
};

export const aiService = {
  // POST /api/ai/generate-description  { title } -> { description, fallback, message }
  generateDescription: async (title) => {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ title }),
    });
    return handleResponse(res);
  },
};
