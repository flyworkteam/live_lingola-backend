const { sendMessageToGemini } = require("../services/chat.service");
const {
  generateTextExamplesWithGemini,
} = require("../services/gemini.service");

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

    return res.status(200).json({
      ok: true,
      reply,
    });
  } catch (error) {
    console.error("CHAT ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Chat failed.",
    });
  }
};

const getTextExamples = async (req, res) => {
  try {
    const { source_language, target_language, expert, count } = req.body || {};

    const examples = await generateTextExamplesWithGemini({
      sourceLanguage: source_language || "Turkish",
      targetLanguage: target_language || "English",
      expert: expert || "General",
      count: Number(count) > 0 ? Number(count) : 2,
    });

    return res.status(200).json({
      ok: true,
      examples,
    });
  } catch (error) {
    console.error("TEXT EXAMPLES ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Examples failed.",
    });
  }
};

module.exports = {
  sendChatMessage,
  getTextExamples,
};