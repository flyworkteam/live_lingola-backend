const { createLog } = require("../services/log.service");

async function errorMiddleware(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  await createLog({
    source: "backend",
    level: statusCode >= 500 ? "critical" : "error",
    type: err.type || "server_error",
    message: err.message || "Internal server error",
    stack: err.stack || "",
    details: {
      body: req.body || {},
      query: req.query || {},
      params: req.params || {},
    },
    userId: req.user?.id || null,
    endpoint: req.originalUrl || null,
    method: req.method || null,
    ip: req.ip || req.headers["x-forwarded-for"] || null,
    platform: "backend",
  });

  return res.status(statusCode).json({
    ok: false,
    error: err.message || "Internal server error",
  });
}

module.exports = errorMiddleware;