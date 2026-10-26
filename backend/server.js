import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import mongoose from 'mongoose';
import { config } from './src/config/config.js';
import { logger } from './src/middleware/logger.js';
import { validateContentType } from './src/middleware/validateContentType.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import taskRoutes from './src/routes/taskRoutes.js';
import authRoutes from './src/routes/authRoutes.js';
import aiRoutes from './src/routes/aiRoutes.js';
import { authenticateToken } from './src/middleware/authMiddleware.js';
import { cacheService } from './src/services/cacheService.js';
import { registerTaskListeners } from './src/events/taskListeners.js';

const app = express();

// Practical 10: register background notification listeners exactly ONCE at
// startup (the function is idempotent). Events are emitted by the task
// controllers; the notification handlers live in src/events/taskListeners.js
// so route code stays decoupled from notification logic.
registerTaskListeners();

// 1. Global logging middleware (logs method, url, timestamp)
app.use(logger);

// CORS middleware to support frontend integration
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 2. Global content-type validation middleware (rejects invalid Content-Type for POST/PUT)
app.use(validateContentType);

// 3. Global body parser for JSON payloads
app.use(express.json());

// 4. API Routes
app.use('/', authRoutes);
app.use('/tasks', taskRoutes);
// Practical 13: AI description helper for the task form. The app has no
// global /api prefix, so this router is mounted at /api/ai, making the
// endpoint resolve to exactly /api/ai/generate-description. Existing routes
// and their authentication policy are untouched.
app.use('/api/ai', aiRoutes);

// Debug endpoint for cache statistics (protected with authenticateToken)
app.get('/debug/cache-stats', authenticateToken, (req, res) => {
  res.status(200).json(cacheService.getStats());
});


// 5. Custom 404 route handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({
    error: "Route not found"
  });
});


// 6. Centralized global error handling middleware (must be the last middleware)
app.use(errorHandler);

// Start Express server and connect to MongoDB
app.listen(config.port, () => {
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  console.log(`Server running in ${config.env} mode on port ${config.port} - ${timestamp}`);
});

mongoose.connect(config.mongoUri)
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch((err) => {
    console.error(`MongoDB connection error: ${err.message}`);
  });

export default app;
