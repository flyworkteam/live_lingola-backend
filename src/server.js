require("dotenv").config();

const express = require("express");
const cors = require("cors");
const os = require("os");
const pool = require("./config/mysql");

const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const translateRoutes = require("./routes/translate.routes");
const notificationRoutes = require("./routes/notification.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const chatRoutes = require("./routes/chat.routes");


const logRoutes = require("./routes/log.routes");
const { createLog } = require("./services/log.service");


const { preloadOcr } = require("./services/ocr.service");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.get("/db-test", async (_, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows });
  } catch (error) {
    console.error("DB TEST ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/db-info", async (_, res) => {
  try {
    const [currentDb] = await pool.query("SELECT DATABASE() AS db");
    const [tables] = await pool.query("SHOW TABLES");

    res.json({
      ok: true,
      currentDatabase: currentDb[0]?.db ?? null,
      tables,
    });
  } catch (error) {
    console.error("DB INFO ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/all-databases", async (_, res) => {
  try {
    const [rows] = await pool.query("SHOW DATABASES");
    res.json({
      ok: true,
      databases: rows,
    });
  } catch (error) {
    console.error("SHOW DATABASES ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/tables", async (_, res) => {
  try {
    const [rows] = await pool.query("SHOW TABLES");
    res.json({
      ok: true,
      tables: rows,
    });
  } catch (error) {
    console.error("TABLES ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/table/:name", async (req, res) => {
  try {
    const table = req.params.name;
    const [rows] = await pool.query(`DESCRIBE \`${table}\``);

    res.json({
      ok: true,
      table,
      columns: rows,
    });
  } catch (error) {
    console.error("DESCRIBE TABLE ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/data/:name", async (req, res) => {
  try {
    const table = req.params.name;
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` LIMIT 20`);

    res.json({
      ok: true,
      table,
      rows,
    });
  } catch (error) {
    console.error("TABLE DATA ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/translate", translateRoutes);
app.use("/notifications", notificationRoutes);
app.use("/subscription", subscriptionRoutes);
app.use("/chat", chatRoutes);


app.use("/logs", logRoutes);

app.use(async (req, res) => {
  try {
    await createLog({
      source: "backend",
      level: "warning",
      type: "route_not_found",
      message: "Route not found",
      details: {
        url: req.originalUrl,
        method: req.method,
      },
      endpoint: req.originalUrl,
      method: req.method,
      ip: req.ip,
      platform: "backend",
    });
  } catch (_) {}

  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

app.use(async (error, req, res, next) => {
  console.error("SERVER ERROR:", error);

  try {
    await createLog({
      source: "backend",
      level: "critical",
      type: error.type || "server_error",
      message: error.message || "Internal server error",
      stack: error.stack || "",
      details: {
        body: req.body || {},
        query: req.query || {},
        params: req.params || {},
      },
      userId: req.user?.id || null,
      endpoint: req.originalUrl || null,
      method: req.method || null,
      ip: req.ip || null,
      platform: "backend",
    });
  } catch (logError) {
    console.error("LOG WRITE ERROR:", logError);
  }

  res.status(error.statusCode || 500).json({
    ok: false,
    error: error.message || "Internal server error",
  });
});

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }

  return "127.0.0.1";
}

app.listen(PORT, "0.0.0.0", async () => {
  const localIp = getLocalIpAddress();

  console.log(`API running on:`);
  console.log(`- Local:   http://127.0.0.1:${PORT}`);
  console.log(`- Network: http://${localIp}:${PORT}`);


  try {
    await preloadOcr("tr");
    await preloadOcr("en");
    console.log("🚀 OCR PRELOAD COMPLETED");
  } catch (e) {
    console.error("OCR PRELOAD ERROR:", e);
  }
});