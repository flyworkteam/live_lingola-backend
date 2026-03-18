const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function extractSystemPrompt(history) {
  const systemItem = history.find(
    (item) => item && item.role === "system" && typeof item.text === "string"
  );
  return systemItem?.text?.trim() || "";
}

function mapHistoryToGeminiContents(history) {
  return history
    .filter((item) => item && item.role !== "system")
    .map((item) => ({
      role: item.role === "model" ? "model" : "user",
      parts: [{ text: (item.text || "").toString() }],
    }))
    .filter((item) => item.parts[0].text.trim().length > 0);
}

async function sendMessageToGemini(history) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing");
  }

  const systemPrompt = extractSystemPrompt(history);
  const contents = mapHistoryToGeminiContents(history);

  if (!contents.length) {
    throw new Error("No valid chat content found");
  }

  const languageInstruction = `
You are a helpful AI assistant.

IMPORTANT RULE:
Always reply in the same language as the user's latest message.
If the user writes in Turkish, reply in Turkish.
If the user writes in English, reply in English.
Do not switch languages unless the user explicitly asks.
Keep the entire response in that same language.
`.trim();

  const requestBody = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topK: 32,
      topP: 1,
      maxOutputTokens: 512,
    },
  };

  requestBody.systemInstruction = {
    parts: [
      {
        text:
          systemPrompt.length > 0
            ? `${languageInstruction}\n\n${systemPrompt}`
            : languageInstruction,
      },
    ],
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    const reply =
      response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!reply) {
      console.error(
        "GEMINI EMPTY RESPONSE:",
        JSON.stringify(response.data, null, 2)
      );
      throw new Error("Empty response from Gemini");
    }

    return reply;
  } catch (error) {
    console.error("GEMINI STATUS:", error.response?.status);
    console.error(
      "GEMINI DATA:",
      JSON.stringify(error.response?.data, null, 2)
    );
    console.error("GEMINI MESSAGE:", error.message);

    throw new Error(
      error.response?.data?.error?.message ||
        error.message ||
        "Gemini request failed"
    );
  }
}

module.exports = {
  sendMessageToGemini,
};