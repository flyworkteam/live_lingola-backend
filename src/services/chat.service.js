const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function getGeminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
}

function extractText(data) {
  const candidates = data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || null;
}

function mapHistoryToGeminiContents(history) {
  if (!Array.isArray(history)) return [];

  return history
    .map((item) => {
      const role = item?.role === "model" ? "model" : "user";
      const text = (item?.text ?? "").toString().trim();

      if (!text) return null;

      return {
        role,
        parts: [{ text }],
      };
    })
    .filter(Boolean);
}

async function sendMessageToGemini(history) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing in .env");
  }

  const contents = mapHistoryToGeminiContents(history);

  const response = await fetch(getGeminiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 700,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini request failed");
  }

  const text = extractText(data);

  if (!text) {
    throw new Error("Empty response from Gemini");
  }

  return text;
}

module.exports = {
  sendMessageToGemini,
};