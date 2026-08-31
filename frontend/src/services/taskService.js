import { authService } from './authService';

const API_URL = 'http://localhost:5000/tasks';

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

const handleResponse = async (res) => {
  if (res.status === 401) {
    authService.removeToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth-unauthorized'));
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Unauthorized: Please log in');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Request failed');
  }

  return res.json();
};

export const taskService = {
  // GET /tasks
  getAll: async () => {
    const res = await fetch(API_URL, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  },

  // POST /tasks
  create: async (task) => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(task),
    });
    return handleResponse(res);
  },

  // PUT /tasks/:id
  update: async (id, task) => {
    const res = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(task),
    });
    return handleResponse(res);
  },

  // DELETE /tasks/:id
  delete: async (id) => {
    const res = await fetch(`${API_URL}/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    return handleResponse(res);
  }
};
