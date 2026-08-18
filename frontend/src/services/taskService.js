const API_URL = 'http://localhost:5000/tasks';

export const taskService = {
  // GET /tasks
  getAll: async () => {
    const res = await fetch(API_URL);
    if (!res.ok) {
      throw new Error('Failed to load tasks');
    }
    return res.json();
  },

  // POST /tasks
  create: async (task) => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to create task');
    }
    return res.json();
  },

  // PUT /tasks/:id
  update: async (id, task) => {
    const res = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update task');
    }
    return res.json();
  },

  // DELETE /tasks/:id
  delete: async (id) => {
    const res = await fetch(`${API_URL}/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to delete task');
    }
    return res.json();
  }
};
