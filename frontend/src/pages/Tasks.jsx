import { useState, useEffect, useCallback } from 'react';
import { taskService } from '../services/taskService';

function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [editingTaskId, setEditingTaskId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      setError(null);
      const data = await taskService.getAll();
      setTasks(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchTasks();
      setLoading(false);
    };
    init();
  }, [fetchTasks]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    const taskPayload = { title, description, priority };

    setSubmitting(true);
    try {
      setError(null);
      if (editingTaskId) {
        await taskService.update(editingTaskId, taskPayload);
        showToast('Task updated successfully');
        setEditingTaskId(null);
      } else {
        await taskService.create(taskPayload);
        showToast('Task created successfully');
      }
      setTitle('');
      setDescription('');
      setPriority('medium');
      await fetchTasks();
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (task) => {
    setEditingTaskId(task.id);
    setTitle(task.title);
    setDescription(task.description || '');
    setPriority(task.priority || 'medium');
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingTaskId(null);
    setTitle('');
    setDescription('');
    setPriority('medium');
    setError(null);
  };

  const handleDelete = async (id) => {
    const confirmed = window.confirm('Are you sure you want to delete this task?');
    if (!confirmed) return;

    setDeletingId(id);
    try {
      setError(null);
      await taskService.delete(id);
      showToast('Task deleted successfully');
      await fetchTasks();
      if (editingTaskId === id) {
        handleCancelEdit();
      }
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleCompleted = async (task) => {
    setTogglingId(task.id);
    try {
      setError(null);
      await taskService.update(task.id, {
        title: task.title,
        description: task.description,
        priority: task.priority,
        completed: !task.completed,
      });
      await fetchTasks();
    } catch (err) {
      setError(err.message);
      showToast(err.message, 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const isBusy = submitting || deletingId !== null || togglingId !== null;

  return (
    <section className="contact-card">
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✓ ' : '✕ '}
          {toast.message}
        </div>
      )}

      <div>
        <p className="eyebrow">Tasks</p>
        <h2>Task Management</h2>
      </div>

      {error && <div className="error-message">{error}</div>}

      <form className="contact-form" onSubmit={handleSubmit}>
        <label htmlFor="title">
          Title
          <input
            id="title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Enter task title"
            required
            disabled={submitting}
          />
        </label>

        <label htmlFor="description">
          Description
          <input
            id="description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Enter task description"
            disabled={submitting}
          />
        </label>

        <label htmlFor="priority">
          Priority
          <select
            id="priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            disabled={submitting}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>

        <div className="action-row">
          <button
            type="submit"
            className="form-button"
            disabled={submitting}
          >
            {submitting
              ? (editingTaskId ? 'Updating...' : 'Creating...')
              : (editingTaskId ? 'Update Task' : 'Add Task')
            }
          </button>
          {editingTaskId && (
            <button
              type="button"
              className="form-button"
              onClick={handleCancelEdit}
              disabled={submitting}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="task-table-container">
        {loading ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading tasks...</p>
          </div>
        ) : (
          <table className="task-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Description</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className={task.completed ? 'task-completed' : ''}>
                  <td className="task-id-cell">{task.id.slice(-8)}</td>
                  <td>{task.title}</td>
                  <td>{task.description || '—'}</td>
                  <td>
                    <span className={`priority-badge priority-${task.priority || 'medium'}`}>
                      {task.priority || 'medium'}
                    </span>
                  </td>
                  <td>
                    <button
                      className={`status-toggle ${task.completed ? 'status-done' : 'status-pending'}`}
                      onClick={() => handleToggleCompleted(task)}
                      disabled={isBusy}
                    >
                      {togglingId === task.id ? '...' : (task.completed ? 'Done' : 'Pending')}
                    </button>
                  </td>
                  <td>
                    <button
                      className="edit-btn"
                      onClick={() => handleStartEdit(task)}
                      disabled={isBusy}
                    >
                      Edit
                    </button>
                    <button
                      className="delete-btn"
                      onClick={() => handleDelete(task.id)}
                      disabled={deletingId === task.id}
                    >
                      {deletingId === task.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '24px' }}>
                    No tasks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default Tasks;
