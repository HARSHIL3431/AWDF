import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import mongoose from 'mongoose';
import { config } from './src/config/config.js';
import { JOB_POLICY } from './src/config/jobConfig.js';
import { logger } from './src/middleware/logger.js';
import { validateContentType } from './src/middleware/validateContentType.js';
import { errorHandler } from './src/middleware/errorHandler.js';
import taskRoutes from './src/routes/taskRoutes.js';
import authRoutes from './src/routes/authRoutes.js';
import aiRoutes from './src/routes/aiRoutes.js';
import { authenticateToken } from './src/middleware/authMiddleware.js';
import { cacheService } from './src/services/cacheService.js';
import { loadEncryptionKey } from './src/security/payloadEncryption.js';
import { redactText } from './src/security/redaction.js';
import { jobService } from './src/services/jobService.js';
import { createJobStatsHandler } from './src/controllers/debugController.js';
import { createEmailWorker } from './src/workers/emailWorker.js';
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

// Authenticated aggregate job statistics (no payloads/emails/tokens)
app.get('/debug/jobs', authenticateToken, createJobStatsHandler({ statsProvider: jobService }));


// 5. Custom 404 route handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({
    error: "Route not found"
  });
});


// 6. Centralized global error handling middleware (must be the last middleware)
app.use(errorHandler);

// Fail fast before accepting any traffic: the job payload encryption key must
// be present and well-formed (64 hex chars). Remediation text is safe; the key
// value itself is never printed. No key -> no jobs -> no plaintext fallback.
try {
  loadEncryptionKey();
} catch (error) {
  console.error(`[startup] ${error.message}`);
  process.exit(1);
}

// Start Express server and connect to MongoDB
const httpServer = app.listen(config.port, () => {
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  console.log(`Server running in ${config.env} mode on port ${config.port} - ${timestamp}`);
});

let emailWorker = null;

// The worker starts ONLY after a successful MongoDB connection; a failed
// connection leaves no polling loop running.
mongoose.connect(config.mongoUri)
  .then(() => {
    console.log('MongoDB connected');
    emailWorker = createEmailWorker({ jobService });
    const started = emailWorker.start();
    console.log(
      `[worker] email worker ${started ? 'started' : 'already running'} ` +
      `(poll ${JOB_POLICY.pollIntervalMs}ms, batch ${JOB_POLICY.batchSize}, lease ${JOB_POLICY.leaseMs}ms)`
    );
  })
  .catch((err) => {
    console.error(`MongoDB connection error: ${err.message}`);
  });

// Graceful shutdown: stop claiming new jobs, allow the in-flight job up to the
// bounded shutdown window, close the HTTP server, then disconnect MongoDB.
let shuttingDown = false;
async function shutdown(signalName) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signalName} received, starting graceful shutdown`);

  const forceExitTimer = setTimeout(() => {
    console.error('[shutdown] grace period exceeded, forcing exit');
    process.exit(1);
  }, JOB_POLICY.shutdownMs + 5_000);

  try {
    if (emailWorker !== null) {
      const result = await emailWorker.stop(JOB_POLICY.shutdownMs);
      console.log(`[worker] stopped (drained=${result.drained}${result.reason ? `, ${result.reason}` : ''})`);
    }
    if (typeof httpServer.closeIdleConnections === 'function') {
      httpServer.closeIdleConnections();
    }
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
    });
    await mongoose.disconnect();
    console.log('Shutdown complete');
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    console.error(`[shutdown] failed: ${redactText(String(error?.message ?? error))}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => { shutdown('SIGINT'); });
process.on('SIGTERM', () => { shutdown('SIGTERM'); });

// Safety net: no silently dropped promises from startup/shutdown/worker paths.
process.on('unhandledRejection', (reason) => {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  console.error(`[process] unhandledRejection: ${redactText(text)}`);
  process.exit(1);
});

export default app;
