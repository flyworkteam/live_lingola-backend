const pool = require("../config/mysql");

function sanitizeDetails(details = {}) {
  const safe = { ...details };

  if (safe.password) safe.password = "***";
  if (safe.token) safe.token = "***";
  if (safe.idToken) safe.idToken = "***";
  if (safe.accessToken) safe.accessToken = "***";
  if (safe.refreshToken) safe.refreshToken = "***";

  return safe;
}

async function createLog(payload = {}) {
  try {
    const sql = `
      INSERT INTO logs (
        source,
        level,
        type,
        message,
        stack,
        details,
        user_id,
        session_id,
        device_id,
        platform,
        app_version,
        screen,
        endpoint,
        method,
        ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      payload.source || "backend",
      payload.level || "error",
      payload.type || "general_error",
      payload.message || "Unknown error",
      payload.stack || "",
      JSON.stringify(sanitizeDetails(payload.details || {})),
      payload.userId || null,
      payload.sessionId || null,
      payload.deviceId || null,
      payload.platform || null,
      payload.appVersion || null,
      payload.screen || null,
      payload.endpoint || null,
      payload.method || null,
      payload.ip || null,
    ];

    await pool.query(sql, values);
  } catch (error) {
    console.error("CREATE LOG ERROR:", error.message);
  }
}

module.exports = {
  createLog,
};