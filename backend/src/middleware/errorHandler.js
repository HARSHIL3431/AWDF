import { redactText } from '../security/redaction.js';

export const errorHandler = (err, req, res, next) => {
  // Log the error for development/monitoring — redacted so reset tokens,
  // emails, or other sensitive values embedded in messages/stacks are never
  // written to logs (see test/logging.test.js).
  const errName = err?.name ?? typeof err;
  const errMessage = redactText(String(err?.message ?? err));
  const errStack = typeof err?.stack === 'string' ? redactText(err.stack) : undefined;
  console.error(`[Error Handler] Error occurred: ${errName}: ${errMessage}`, errStack ?? '');

  // Mongoose validation error handling
  if (err.name === 'ValidationError') {
    const details = {};
    for (const field in err.errors) {
      details[field] = redactText(err.errors[field].message);
    }
    return res.status(400).json({
      error: "Validation failed",
      details
    });
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: statusCode === 500 ? "Something went wrong" : redactText(err.message)
  });
};
