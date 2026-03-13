const { sendMessageToGemini } = require("../services/chat.service");

const sendChatMessage = async (req, res) => {
  try {
    const { history } = req.body || {};

    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "history zorunlu",
      });
    }

    const reply = await sendMessageToGemini(history);

    return res.json({
      ok: true,
      reply,
    });
  } catch (error) {
    console.error("CHAT ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

module.exports = {
  sendChatMessage,
};