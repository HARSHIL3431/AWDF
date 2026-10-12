import mongoose from 'mongoose';
import Task from '../models/taskModel.js';
import { cacheService } from '../services/cacheService.js';

export const validateTaskId = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if ID is a valid Mongoose ObjectID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    // For safe GET operations, check cache first
    const cacheKey = `tasks:id:${id}`;
    if (req.method === 'GET') {
      const cachedTask = cacheService.get(cacheKey);
      if (cachedTask !== undefined) {
        req.task = cachedTask;
        return next();
      }
    }

    const task = await Task.findById(id);
    if (!task) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    if (req.method === 'GET') {
      cacheService.set(cacheKey, task);
    }

    req.task = task;
    next();
  } catch (error) {
    next(error);
  }
};

