const express = require("express");
const router = express.Router();

const {
  createClientLog,
  getLogs,
} = require("../controllers/log.controller");

router.post("/client", createClientLog);
router.get("/", getLogs);

module.exports = router;