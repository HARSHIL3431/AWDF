import mongoose from 'mongoose';
import Task from '../models/taskModel.js';

export const validateTaskId = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if ID is a valid Mongoose ObjectID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    const task = await Task.findById(id);
    if (!task) {
      return res.status(404).json({
        error: "Task not found"
      });
    }

    req.task = task;
    next();
  } catch (error) {
    next(error);
  }
};
