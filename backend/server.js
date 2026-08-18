import express from 'express';
import mongoose from 'mongoose';
import { config } from './src/config/config.js';
import { logger } from './src/middleware/logger.js';
import { validateContentType } from './src/middleware/validateContentType.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import taskRoutes from './src/routes/taskRoutes.js';

const app = express();

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
app.use('/tasks', taskRoutes);

// 5. Custom 404 route handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({
    error: "Route not found"
  });
});

// 6. Centralized global error handling middleware (must be the last middleware)
app.use(errorHandler);

// Connect to MongoDB and then start Express server
mongoose.connect(config.mongoUri)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(config.port, () => {
      const timestamp = new Date().toISOString().split('.')[0] + 'Z';
      console.log(`Server running in ${config.env} mode on port ${config.port} - ${timestamp}`);
    });
  })
  .catch((err) => {
    console.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

export default app;
// Trigger nodemon restart for new .env variables
