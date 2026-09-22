const API_URL = 'http://localhost:5000';

export const authService = {
  getToken: () => localStorage.getItem('jwt_token'),
  setToken: (token) => localStorage.setItem('jwt_token', token),
  removeToken: () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_info');
  },
  getUser: () => {
    const raw = localStorage.getItem('user_info');
    return raw ? JSON.parse(raw) : null;
  },
  setUser: (user) => localStorage.setItem('user_info', JSON.stringify(user)),

  register: async (email, password) => {
    const res = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    return data;
  },

  login: async (email, password) => {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    if (data.token) {
      authService.setToken(data.token);
      if (data.user) {
        authService.setUser(data.user);
      }
    }
    return data;
  },

  getMe: async () => {
    const token = authService.getToken();
    if (!token) return null;
    const res = await fetch(`${API_URL}/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        authService.removeToken();
      }
      throw new Error(data.error || 'Failed to get user profile');
    }
    return data;
  },

  forgotPassword: async (email) => {
    const res = await fetch(`${API_URL}/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send reset link');
    }
    return data;
  },

  resetPassword: async (token, password) => {
    const res = await fetch(`${API_URL}/reset-password/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to reset password');
    }
    return data;
  }
};
