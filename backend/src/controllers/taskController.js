import Task from '../models/taskModel.js';
import { cacheService } from '../services/cacheService.js';

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

      res.status(201).json(newTask);
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

      res.status(200).json({
        message: "Task deleted successfully"
      });
    } catch (error) {
      next(error);
    }
  }
};

