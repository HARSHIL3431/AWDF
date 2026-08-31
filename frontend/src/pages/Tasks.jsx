import { useState, useEffect, useCallback } from 'react';
import { taskService } from '../services/taskService';
import { authService } from '../services/authService';
import AuthForm from '../Components/AuthForm';

function Tasks({ user, onLoginSuccess }) {
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
    const token = authService.getToken();
    if (!token) return;

    try {
      setError(null);
      const data = await taskService.getAll();
      setTasks(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    const token = authService.getToken();
    if (!token) return;

    const init = async () => {
      setLoading(true);
      await fetchTasks();
      setLoading(false);
    };
    init();
  }, [fetchTasks, user]);

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

  const token = authService.getToken();
  if (!token || !user) {
    return <AuthForm onLoginSuccess={onLoginSuccess} />;
  }

  const isBusy = submitting || deletingId !== null || togglingId !== null;

  return (
    <section className="tasks-page">
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✓ ' : '✕ '}
          {toast.message}
        </div>
      )}

      <div className="task-heading">
        <h1>Task <span className="accent">Management</span></h1>
        <span className="task-heading__count">
          {loading ? '…' : `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="task-layout">
        <aside className="task-form-card">
          <h2>
            {editingTaskId ? 'Edit Task' : 'New Task'}
            {editingTaskId && <span className="tag">editing</span>}
          </h2>

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
                  className="form-button form-button--ghost"
                  onClick={handleCancelEdit}
                  disabled={submitting}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </aside>

        <div className="task-list-wrap">
          {loading ? (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>Loading tasks...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="tasks-empty">
              <span className="tasks-empty__icon" aria-hidden="true">✦</span>
              <strong>No tasks yet</strong>
              <p className="muted" style={{ margin: 0 }}>
                Create your first task using the form to get started.
              </p>
            </div>
          ) : (
            <div className="task-card-list">
              {tasks.map((task) => (
                <article
                  key={task.id}
                  className={`task-card ${task.completed ? 'task-card--done' : ''}`}
                >
                  <button
                    className={`task-card__check ${task.completed ? 'task-card__check--done' : ''}`}
                    onClick={() => handleToggleCompleted(task)}
                    disabled={isBusy}
                    aria-label={task.completed ? 'Mark as pending' : 'Mark as done'}
                    title={task.completed ? 'Mark as pending' : 'Mark as done'}
                  >
                    {task.completed ? '✓' : ''}
                  </button>

                  <div className="task-card__body">
                    <h3 className="task-card__title">{task.title}</h3>
                    <p className="task-card__desc">
                      {task.description || 'No description'}
                    </p>
                    <div className="task-card__meta">
                      <span className={`priority-badge priority-${task.priority || 'medium'}`}>
                        {task.priority || 'medium'}
                      </span>
                      <span className="task-card__id">{task.id.slice(-8)}</span>
                    </div>
                  </div>

                  <div className="task-card__actions">
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
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default Tasks;
