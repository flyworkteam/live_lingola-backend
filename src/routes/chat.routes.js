const express = require("express");
const router = express.Router();

const {
  sendChatMessage,
  getTextExamples,
} = require("../controllers/chat.controller");

router.post("/message", sendChatMessage);
router.post("/text-examples", getTextExamples);

module.exports = router;