export const logger = (req, res, next) => {
  const method = req.method;
  const url = req.originalUrl || req.url;
  const timestamp = new Date().toISOString().split('.')[0] + 'Z';
  
  console.log(`${method} ${url} - ${timestamp}`);
  next();
};
