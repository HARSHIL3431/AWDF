import Task from '../models/taskModel.js';

export const taskController = {
  // GET /tasks
  getAllTasks: async (req, res, next) => {
    try {
      const tasks = await Task.find();
      res.status(200).json(tasks);
    } catch (error) {
      next(error);
    }
  },

  // GET /tasks/:id
  getTaskById: async (req, res, next) => {
    try {
      // req.task is already set by validateTaskId middleware
      res.status(200).json(req.task);
    } catch (error) {
      next(error);
    }
  },

  // POST /tasks
  createTask: async (req, res, next) => {
    try {
      const { title, description, completed, priority } = req.body;

      const newTask = await Task.create({
        title,
        description,
        completed,
        priority
      });

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

      res.status(200).json({
        message: "Task deleted successfully"
      });
    } catch (error) {
      next(error);
    }
  }
};
