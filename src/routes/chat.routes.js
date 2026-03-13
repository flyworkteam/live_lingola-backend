const express = require("express");
const router = express.Router();

const { sendChatMessage } = require("../controllers/chat.controller");

router.post("/message", sendChatMessage);

module.exports = router;