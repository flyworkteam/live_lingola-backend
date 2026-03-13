const express = require("express");
const cors = require("cors");

const firebaseAuth = require("./middleware/auth_firebase");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/auth-test", firebaseAuth, (req, res) => {
  res.json({
    ok: true,
    uid: req.auth.uid,
    email: req.auth.email || null,
  });
});

module.exports = app;
