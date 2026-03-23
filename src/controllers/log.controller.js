const pool = require("../config/mysql");
const { createLog } = require("../services/log.service");

async function createClientLog(req, res) {
  try {
    const {
      level,
      type,
      message,
      stack,
      details,
      userId,
      sessionId,
      deviceId,
      platform,
      appVersion,
      screen,
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "message is required",
      });
    }

    await createLog({
      source: "frontend",
      level: level || "error",
      type: type || "client_error",
      message,
      stack: stack || "",
      details: details || {},
      userId: userId || null,
      sessionId: sessionId || null,
      deviceId: deviceId || null,
      platform: platform || null,
      appVersion: appVersion || null,
      screen: screen || null,
    });

    return res.status(201).json({
      ok: true,
      message: "Client log created",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to create client log",
    });
  }
}

async function getLogs(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT *
      FROM logs
      ORDER BY created_at DESC
      LIMIT 200
    `);

    return res.json({
      ok: true,
      logs: rows,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch logs",
    });
  }
}

module.exports = {
  createClientLog,
  getLogs,
};