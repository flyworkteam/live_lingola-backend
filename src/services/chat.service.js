const { GoogleGenAI } = require("@google/genai");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

let aiClient = null;

function getGenAIClient() {
  if (aiClient) return aiClient;

  if (!GOOGLE_CLOUD_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT missing");
  }

  if (!GOOGLE_CLOUD_LOCATION) {
    throw new Error("GOOGLE_CLOUD_LOCATION missing");
  }

  const options = {
    vertexai: true,
    project: GOOGLE_CLOUD_PROJECT,
    location: GOOGLE_CLOUD_LOCATION,
  };

  if (GOOGLE_API_KEY) {
    options.apiKey = GOOGLE_API_KEY;
  }

  aiClient = new GoogleGenAI(options);
  return aiClient;
}

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
  const ai = getGenAIClient();

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

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        temperature: 0.7,
        topK: 32,
        topP: 1,
        maxOutputTokens: 512,
        systemInstruction:
          systemPrompt.length > 0
            ? `${languageInstruction}\n\n${systemPrompt}`
            : languageInstruction,
      },
    });

    const reply = (response?.text || "").trim();

    if (!reply) {
      console.error(
        "VERTEX AI EMPTY RESPONSE:",
        JSON.stringify(response, null, 2)
      );
      throw new Error("Empty response from Vertex AI");
    }

    return reply;
  } catch (error) {
    console.error("VERTEX AI MESSAGE:", error.message);
    console.error(
      "VERTEX AI ERROR:",
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    );

    throw new Error(
      error?.message ||
        error?.error?.message ||
        "Vertex AI request failed"
    );
  }
}

module.exports = {
  sendMessageToGemini,
};