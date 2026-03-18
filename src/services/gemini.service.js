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

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function extractJsonText(rawText) {
  const text = (rawText || "").toString().trim();

  if (!text) return "";

  const cleaned = text
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");

  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    return cleaned.slice(firstArray, lastArray + 1);
  }

  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return cleaned.slice(firstObject, lastObject + 1);
  }

  return cleaned;
}

function normalizeExpert(expert) {
  const value = (expert || "").toString().trim().toLowerCase();

  const map = {
    general: "General",
    daily: "Daily Conversation",
    travel: "Travel",
    business: "Business",
    academic: "Academic",
    medical: "Medical",
    legal: "Legal",
    technology: "Technology",
    marketing: "Marketing",
    ai: "AI Expert",
    finance: "Finance",
  };

  return map[value] || expert || "General";
}

function buildExpertTopicGuide(expert) {
  const normalized = normalizeExpert(expert);

  const guides = {
    General:
      "Use practical, natural, general-purpose topics that a typical translation app user may type.",
    "Daily Conversation":
      "Focus on greetings, daily routines, food, shopping, friends, family, weather, and casual everyday communication.",
    Travel:
      "Focus on airport, hotel, booking, directions, transportation, restaurants, sightseeing, reservations, and tourist communication.",
    Business:
      "Focus on meetings, schedules, presentations, deadlines, office communication, negotiation, email-like business phrasing, and teamwork.",
    Academic:
      "Focus on studying, classes, homework, lectures, research, presentations, exams, and educational communication.",
    Medical:
      "Focus on appointments, symptoms, pharmacy, medicine, doctor communication, emergency needs, and basic health-related situations.",
    Legal:
      "Focus on documents, permissions, procedures, forms, appointments, contracts, legal office interactions, and official communication.",
    Technology:
      "Focus on apps, devices, software, settings, internet, troubleshooting, coding, digital products, and user-tech interactions.",
    Marketing:
      "Focus on campaigns, branding, product promotion, customer communication, social media captions, ad messaging, and sales-friendly language.",
    "AI Expert":
      "Focus on prompts, AI tools, automation, model outputs, productivity workflows, content generation, and AI-assisted work language.",
    Finance:
      "Focus on pricing, invoices, subscriptions, banking, payments, budgeting, financial planning, and expenses.",
  };

  return guides[normalized] || guides.General;
}

async function callGemini({
  parts,
  responseMimeType = "text/plain",
  temperature = 0.2,
  topP,
  topK,
  maxOutputTokens,
}) {
  ensureGeminiConfig();

  const generationConfig = {
    temperature,
    responseMimeType,
  };

  if (typeof topP === "number") generationConfig.topP = topP;
  if (typeof topK === "number") generationConfig.topK = topK;
  if (typeof maxOutputTokens === "number") {
    generationConfig.maxOutputTokens = maxOutputTokens;
  }

  const response = await fetch(getGeminiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig,
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
  expertGuide,
  nonce,
  seed,
  forceRegenerate,
}) {
  const cleanText = (sourceText || "").toString().trim();
  if (!cleanText) return "";

  const resolvedExpert = normalizeExpert(expert);

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
- The final response must always be in ${targetLanguage}.
- Domain/context: ${resolvedExpert}.
- Domain guidance: ${expertGuide || buildExpertTopicGuide(resolvedExpert)}.
- Fresh generation requested: ${forceRegenerate ? "yes" : "no"}.
- Request nonce: ${nonce || "none"}.
- Request seed: ${seed || "none"}.

Text:
${cleanText}
  `.trim();

  const translated = await callGemini({
    parts: [{ text: prompt }],
    responseMimeType: "text/plain",
    temperature: 0.25,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 2048,
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
  const resolvedExpert = normalizeExpert(expert);

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

Domain/context: ${resolvedExpert}
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
    topP: 0.9,
    topK: 32,
    maxOutputTokens: 4096,
  });

  try {
    const parsed = JSON.parse(extractJsonText(raw));

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
  } catch (_) {
    throw new Error("Gemini photo JSON parse edilemedi");
  }
}

async function generateTextExamplesWithGemini({
  sourceLanguage,
  targetLanguage,
  expert,
  expertGuide,
  count = 2,
  nonce,
  seed,
  forceRegenerate,
}) {
  const resolvedExpert = normalizeExpert(expert);
  const safeCount = Math.max(1, Math.min(Number(count) || 2, 10));

  const prompt = `
You are generating example phrases for a mobile translation app.

Task:
Generate ${safeCount} short, natural, and fresh example texts for a translation screen.

Language rules:
- "title" must be written in ${sourceLanguage || "the source language"}.
- "subtitle" must be the meaning-equivalent translation in ${targetLanguage || "the target language"}.
- The answer must respect the requested languages exactly.
- If the source and target languages are the same, still write natural matching examples in that same language.

Expert/domain rules:
- Selected expert: ${resolvedExpert}
- Domain guidance: ${expertGuide || buildExpertTopicGuide(resolvedExpert)}

Freshness rules:
- Generate new examples for this request.
- Avoid repeating generic translation app clichés unless necessary.
- Avoid repeating the same structure across all items.
- The examples should clearly differ from each other.
- Fresh generation requested: ${forceRegenerate ? "yes" : "no"}.
- Request nonce: ${nonce || "none"}.
- Request seed: ${seed || "none"}.

Safety and quality rules:
- Avoid harmful, sexual, illegal, extremist, hateful, or sensitive content.
- Keep each title reasonably short and realistic.
- Make them look like text a real user would type into a translation app.
- Do not include numbering or labels.
- Do not include markdown.

Return ONLY valid JSON.
Do not wrap JSON in markdown.
Output must be an array.
Each item must have exactly:
- "title"
- "subtitle"

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
    temperature: 1.1,
    topP: 0.98,
    topK: 50,
    maxOutputTokens: 2048,
  });

  const parsed =
    safeJsonParse(extractJsonText(raw)) || safeJsonParse(raw);

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
    .slice(0, safeCount);

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
  normalizeExpert,
  buildExpertTopicGuide,
};