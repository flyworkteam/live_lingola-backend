const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function ensureGeminiConfig() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing");
  }
}

function getGeminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
}

function extractTextFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => part?.text || "")
    .join("")
    .trim();
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeGeminiBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];

  return blocks
    .map((block) => {
      const sourceText = (block?.source_text || "").toString().trim();
      const translatedText = (block?.translated_text || "").toString().trim();

      const x = clamp01(block?.x, 0);
      const y = clamp01(block?.y, 0);
      const width = clamp01(block?.width, 0);
      const height = clamp01(block?.height, 0);

      if (!translatedText) return null;
      if (width <= 0 || height <= 0) return null;

      return {
        source_text: sourceText,
        translated_text: translatedText,
        x,
        y,
        width,
        height,
      };
    })
    .filter(Boolean);
}

async function callGemini({
  parts,
  responseMimeType = "text/plain",
  temperature = 0.2,
}) {
  ensureGeminiConfig();

  const response = await fetch(getGeminiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        temperature,
        responseMimeType,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `Gemini request failed with status ${response.status}`;
    throw new Error(message);
  }

  const text = extractTextFromGeminiResponse(data);

  if (!text) {
    throw new Error("Gemini boş cevap döndü");
  }

  return text;
}

async function translateTextWithGemini({
  sourceText,
  sourceLanguage,
  targetLanguage,
  expert,
}) {
  const cleanText = (sourceText || "").toString().trim();
  if (!cleanText) return "";

  const prompt = `
You are a professional translation engine.

Task:
Translate the given text from ${sourceLanguage || "auto-detect"} to ${targetLanguage}.

Rules:
- Return only the translated text.
- Do not add quotation marks.
- Do not add notes, explanations, labels, or alternatives.
- Preserve meaning, tone, punctuation, emojis, and line breaks.
- If the text is already in the target language, still return a polished equivalent in the target language.
- Domain/context: ${expert || "General"}.

Text:
${cleanText}
  `.trim();

  const translated = await callGemini({
    parts: [{ text: prompt }],
    responseMimeType: "text/plain",
    temperature: 0.1,
  });

  return translated.trim();
}

async function translatePhotoWithGemini({
  imageBase64,
  mimeType,
  sourceLanguage,
  targetLanguage,
  expert,
}) {
  const prompt = `
You are an OCR + layout + translation engine.

Your task:
1. Read all visible text in the image.
2. Split the image text into separate text regions or blocks.
3. Translate each block from ${sourceLanguage || "auto-detect"} to ${targetLanguage}.
4. Return ONLY valid JSON.
5. Do not wrap JSON in markdown.
6. Coordinates must be normalized numbers between 0 and 1.
7. x and y are the top-left corner of each text block.
8. width and height are the size of the text block.
9. Keep reading order natural: top-to-bottom, left-to-right.
10. Prefer multiple small blocks over one giant block when the image has separate text areas.

Return JSON in exactly this shape:
{
  "source_text": "all detected source text joined with line breaks",
  "translated_text": "all translated text joined with line breaks",
  "blocks": [
    {
      "source_text": "original text block",
      "translated_text": "translated text block",
      "x": 0.10,
      "y": 0.15,
      "width": 0.30,
      "height": 0.06
    }
  ]
}

Important rules:
- If the image has many UI labels, buttons, headings, or separate lines, return separate blocks.
- Do NOT merge the whole image into one block unless absolutely necessary.
- If there is no visible text, return:
{
  "source_text": "",
  "translated_text": "",
  "blocks": []
}

Domain/context: ${expert || "General"}
  `.trim();

  const raw = await callGemini({
    parts: [
      {
        inlineData: {
          mimeType: mimeType || "image/jpeg",
          data: imageBase64,
        },
      },
      { text: prompt },
    ],
    responseMimeType: "application/json",
    temperature: 0.1,
  });

  try {
    const parsed = JSON.parse(raw);

    const sourceText = (parsed?.source_text || "").toString().trim();
    const translatedText = (parsed?.translated_text || "").toString().trim();
    let blocks = normalizeGeminiBlocks(parsed?.blocks || []);

    if (blocks.length === 0 && translatedText) {
      blocks = [
        {
          source_text: sourceText,
          translated_text: translatedText,
          x: 0.05,
          y: 0.05,
          width: 0.9,
          height: 0.2,
        },
      ];
    }

    return {
      source_text: sourceText,
      translated_text: translatedText,
      blocks,
    };
  } catch (error) {
    throw new Error("Gemini photo JSON parse edilemedi");
  }
}

async function generateTextExamplesWithGemini({
  sourceLanguage,
  targetLanguage,
  expert,
  count = 2,
}) {
  const prompt = `
You are generating example phrases for a mobile translation app.

Task:
Generate ${count} short and natural example texts for a translation screen.

Rules:
- Return ONLY valid JSON.
- Do not wrap JSON in markdown.
- Output must be an array.
- Each item must have exactly:
  - "title": the example text in ${sourceLanguage || "source language"}
  - "subtitle": the translated version of that same text in ${targetLanguage || "target language"}
- Do not use category labels.
- Keep the examples realistic, useful, and mobile-app friendly.
- Avoid harmful, sexual, illegal, or sensitive content.
- Keep each title reasonably short.
- Use domain/context: ${expert || "General"}.
- The examples should feel different from each other.
- The examples are for a translation screen, so make them look like input text a user would type.

Example output:
[
  {
    "title": "Bugün hava çok güzel; yürüyüşe çıkmak istiyorum.",
    "subtitle": "The weather is so nice today; I want to go for a walk."
  },
  {
    "title": "İki kişilik bir masa ayırtmak istiyorum.",
    "subtitle": "I would like to reserve a table for two."
  }
]
  `.trim();

  const raw = await callGemini({
    parts: [{ text: prompt }],
    responseMimeType: "application/json",
    temperature: 0.9,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("Gemini examples JSON parse edilemedi");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini examples formatı geçersiz");
  }

  const normalized = parsed
    .map((item) => {
      const title = (item?.title || "").toString().trim();
      const subtitle = (item?.subtitle || "").toString().trim();

      if (!title || !subtitle) return null;

      return {
        title,
        subtitle,
      };
    })
    .filter(Boolean)
    .slice(0, count);

  if (!normalized.length) {
    throw new Error("Gemini örnek üretmedi");
  }

  return normalized;
}

module.exports = {
  translateTextWithGemini,
  translatePhotoWithGemini,
  normalizeGeminiBlocks,
  generateTextExamplesWithGemini,
};