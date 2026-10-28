import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { forgotPasswordRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authenticateToken, authController.getMe);
// Route-specific rate limit: 5 requests / 15 min / IP (process-local).
router.post('/forgot-password', forgotPasswordRateLimiter, authController.forgotPassword);
router.post('/reset-password/:token', authController.resetPassword);

export default router;
