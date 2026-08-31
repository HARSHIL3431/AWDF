export const errorHandler = (err, req, res, next) => {
  // Log the error stack internally for development/monitoring
  console.error(`[Error Handler] Error occurred:`, err);

  // Mongoose validation error handling
  if (err.name === 'ValidationError') {
    const details = {};
    for (const field in err.errors) {
      details[field] = err.errors[field].message;
    }
    return res.status(400).json({
      error: "Validation failed",
      details
    });
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: statusCode === 500 ? "Something went wrong" : err.message
  });
};
