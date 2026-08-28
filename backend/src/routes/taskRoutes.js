import { Router } from 'express';
import { taskController } from '../controllers/taskController.js';
import { validateTaskId } from '../middleware/validateTaskId.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = Router();

// Apply authentication middleware to all task routes
router.use(authenticateToken);

router.get('/', taskController.getAllTasks);
router.get('/:id', validateTaskId, taskController.getTaskById);
router.post('/', taskController.createTask);
router.put('/:id', validateTaskId, taskController.updateTask);
router.delete('/:id', validateTaskId, taskController.deleteTask);

export default router;
