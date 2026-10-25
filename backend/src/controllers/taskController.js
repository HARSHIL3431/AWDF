import Task from '../models/taskModel.js';
import { cacheService } from '../services/cacheService.js';
import { safeEmit } from '../events/taskEvents.js';

/**
 * Evidence logging for response initiation (Practical 10). Guarded so a
 * stdout failure can never turn an already-successful database operation into
 * an error response — logging must stay off the critical response path.
 */
function logApiEvent(message) {
  try {
    console.log(message);
  } catch {
    // logging unavailable — the response path is unaffected
  }
}

export const taskController = {
  // GET /tasks
  getAllTasks: async (req, res, next) => {
    try {
      const cacheKey = 'tasks:all';
      const cachedTasks = cacheService.get(cacheKey);

      if (cachedTasks !== undefined) {
        return res.status(200).json(cachedTasks);
      }

      const tasks = await Task.find();
      cacheService.set(cacheKey, tasks);
      res.status(200).json(tasks);
    } catch (error) {
      next(error);
    }
  },

  // GET /tasks/:id
  getTaskById: async (req, res, next) => {
    try {
      // req.task is already set and cached by validateTaskId middleware
      res.status(200).json(req.task);
    } catch (error) {
      next(error);
    }
  },

  // POST /tasks
  createTask: async (req, res, next) => {
    try {
      const { title, description, completed, priority } = req.body || {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: "Title is required" });
      }

      const newTask = await Task.create({
        title: title.trim(),
        description,
        completed,
        priority
      });

      // Invalidate all tasks cache
      cacheService.invalidateTaskCaches();

      // Evidence log: response initiation timestamp, written immediately
      // BEFORE the response method is called (the client receives the bytes
      // slightly later — measure that separately on the client).
      logApiEvent(`[API] POST /tasks response initiation at ${new Date().toISOString()} (status 201)`);
      res.status(201).json(newTask);

      // Practical 10: emit AFTER the existing 201 response has been initiated.
      // Listeners run synchronously up to their first await, then hand off to a
      // non-blocking timer — the client never waits for notification work, and
      // `safeEmit` guarantees a listener failure cannot alter this response.
      // Payload is built from the PERSISTED task, not the request body, and
      // carries only what the notification needs.
      safeEmit('task-created', {
        taskId: newTask?.id ?? null,
        title: newTask?.title ?? null,
        // The task schema defines no assignment field, so tasks are unassigned;
        // the listener handles this case gracefully.
        assignedUserId: null,
        createdBy: req.user?.id ?? null
      });
    } catch (error) {
      next(error);
    }
  },

  // PUT /tasks/:id
  updateTask: async (req, res, next) => {
    try {
      const { id } = req.params;
      const { title, description, completed, priority } = req.body;

      const updatedTask = await Task.findByIdAndUpdate(
        id,
        { title, description, completed, priority },
        { new: true, runValidators: true }
      );

      if (!updatedTask) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Invalidate cache for task list and the updated task
      cacheService.invalidateTaskCaches(id);

      res.status(200).json(updatedTask);
    } catch (error) {
      next(error);
    }
  },

  // DELETE /tasks/:id
  deleteTask: async (req, res, next) => {
    try {
      const { id } = req.params;
      const deletedTask = await Task.findByIdAndDelete(id);

      if (!deletedTask) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Invalidate cache for task list and the deleted task
      cacheService.invalidateTaskCaches(id);

      // Evidence log: response initiation timestamp (see createTask above).
      logApiEvent(`[API] DELETE /tasks/:id response initiation at ${new Date().toISOString()} (status 200)`);
      res.status(200).json({
        message: "Task deleted successfully"
      });

      // Practical 10: emit AFTER the existing delete response. Only emitted
      // when the deletion actually succeeded (the 404 branch returns first).
      // `deletedTask` holds the record captured by findByIdAndDelete, so the
      // notification data does not require a second query.
      safeEmit('task-deleted', {
        taskId: deletedTask?.id ?? id,
        title: deletedTask?.title ?? null,
        deletedBy: req.user?.id ?? null
      });
    } catch (error) {
      next(error);
    }
  }
};

