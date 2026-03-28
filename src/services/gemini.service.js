const { GoogleGenAI } = require("@google/genai");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

let aiClient = null;

function ensureGeminiConfig() {
  if (!GOOGLE_CLOUD_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT missing");
  }

  if (!GOOGLE_CLOUD_LOCATION) {
    throw new Error("GOOGLE_CLOUD_LOCATION missing");
  }
}

function getGenAIClient() {
  if (aiClient) return aiClient;

  ensureGeminiConfig();

  const options = {
    vertexai: true,
    project: GOOGLE_CLOUD_PROJECT,
    location: GOOGLE_CLOUD_LOCATION,
  };

  if (GOOGLE_API_KEY) {
    options.apiKey = GOOGLE_API_KEY;
  }


  const fs = require("fs");
const path = require("path");

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

try {
  const resolvedPath = credPath ? path.resolve(credPath) : null;
  console.log("GEMINI CREDENTIAL PATH:", resolvedPath || "YOK");

  if (resolvedPath && fs.existsSync(resolvedPath)) {
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw);

    console.log("GEMINI SERVICE ACCOUNT EMAIL:", parsed.client_email || "YOK");
    console.log("GEMINI SERVICE ACCOUNT PROJECT:", parsed.project_id || "YOK");
  } else {
    console.log("GEMINI CREDENTIAL FILE NOT FOUND");
  }
} catch (err) {
  console.log("GEMINI CREDENTIAL READ ERROR:", err.message);
}

  aiClient = new GoogleGenAI(options);
  return aiClient;
}

function extractTextFromGeminiResponse(response) {
  return (response?.text || "").toString().trim();
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
      const sourceText = (
        block?.source_text ||
        block?.sourceText ||
        block?.text ||
        ""
      )
        .toString()
        .trim();

      const translatedText = (
        block?.translated_text ||
        block?.translatedText ||
        ""
      )
        .toString()
        .trim();

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
    .filter(Boolean)
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.01) return a.y - b.y;
      return a.x - b.x;
    });
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
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (
    (cleaned.startsWith("{") && cleaned.endsWith("}")) ||
    (cleaned.startsWith("[") && cleaned.endsWith("]"))
  ) {
    return cleaned;
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return cleaned.slice(firstBracket, lastBracket + 1);
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

function normalizeDetectedLanguageCode(value, fallback = "") {
  const raw = (value || "").toString().trim().toLowerCase();
  if (!raw) return fallback;

  const map = {
    tr: "tr",
    turkish: "tr",
    türkçe: "tr",

    en: "en",
    english: "en",
    ingilizce: "en",

    de: "de",
    german: "de",
    deutsch: "de",
    almanca: "de",

    fr: "fr",
    french: "fr",
    français: "fr",
    fransızca: "fr",

    es: "es",
    spanish: "es",
    español: "es",
    ispanyolca: "es",

    it: "it",
    italian: "it",
    italiano: "it",
    italyanca: "it",

    pt: "pt",
    portuguese: "pt",
    português: "pt",
    portekizce: "pt",

    ru: "ru",
    russian: "ru",
    русский: "ru",
    rusça: "ru",

    ar: "ar",
    arabic: "ar",
    العربية: "ar",
    arapça: "ar",

    hi: "hi",
    hindi: "hi",

    ja: "ja",
    japanese: "ja",
    日本語: "ja",
    japonca: "ja",

    ko: "ko",
    korean: "ko",
    한국어: "ko",
    korece: "ko",
  };

  return map[raw] || raw || fallback;
}

async function callGemini({
  parts,
  responseMimeType = "text/plain",
  temperature = 0.2,
  topP,
  topK,
  maxOutputTokens,
  systemInstruction,
}) {
  const ai = getGenAIClient();

  const config = {
    temperature,
    responseMimeType,
  };

  if (typeof topP === "number") config.topP = topP;
  if (typeof topK === "number") config.topK = topK;
  if (typeof maxOutputTokens === "number") {
    config.maxOutputTokens = maxOutputTokens;
  }
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      config,
    });
  } catch (error) {
    const message =
      error?.message ||
      error?.error?.message ||
      "Vertex AI request failed";
    throw new Error(message);
  }

  const text = extractTextFromGeminiResponse(response);

  if (!text) {
    throw new Error("Vertex AI boş cevap döndü");
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
  if (!cleanText) {
    return {
      translated_text: "",
      detected_source_language: normalizeDetectedLanguageCode(sourceLanguage),
    };
  }

  const resolvedExpert = normalizeExpert(expert);

  const prompt = `
You are a professional translation engine.

Task:
Translate the given text from ${sourceLanguage || "auto-detect"} to ${targetLanguage}.

Rules:
- Return ONLY valid JSON.
- Do not wrap JSON in markdown.
- Do not add notes, explanations, labels, or alternatives.
- Preserve meaning, tone, punctuation, emojis, and line breaks.
- If the text is already in the target language, still return a polished equivalent in the target language.
- The final response must always be in ${targetLanguage}.
- Also detect the true source language of the input text.
- "detected_source_language" must be a lowercase language code like: tr, en, de, fr, es, it, pt, ru, ar, hi, ja, ko.
- Domain/context: ${resolvedExpert}.
- Domain guidance: ${expertGuide || buildExpertTopicGuide(resolvedExpert)}.
- Fresh generation requested: ${forceRegenerate ? "yes" : "no"}.
- Request nonce: ${nonce || "none"}.
- Request seed: ${seed || "none"}.

Return EXACTLY this JSON shape:
{
  "translated_text": "...",
  "detected_source_language": "tr"
}

Text:
${cleanText}
  `.trim();

  const raw = await callGemini({
    parts: [{ text: prompt }],
    responseMimeType: "application/json",
    temperature: 0.25,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 2048,
  });

  const parsed =
    safeJsonParse(extractJsonText(raw)) || safeJsonParse(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini text translate formatı geçersiz");
  }

  return {
    translated_text: (parsed?.translated_text || "").toString().trim(),
    detected_source_language: normalizeDetectedLanguageCode(
      parsed?.detected_source_language,
      normalizeDetectedLanguageCode(sourceLanguage)
    ),
  };
}

async function translatePhotoBlocksWithGemini({
  blocks,
  sourceLanguage,
  targetLanguage,
  expert,
}) {
  const safeBlocks = Array.isArray(blocks)
    ? blocks
        .map((b, index) => ({
          index,
          source_text: (b?.source_text || b?.text || "").toString().trim(),
        }))
        .filter((b) => b.source_text)
    : [];

  if (!safeBlocks.length) {
    return {
      blocks: [],
    };
  }

  const resolvedExpert = normalizeExpert(expert);

  const prompt = `
You are a professional translation engine for OCR text blocks.

Task:
Translate each OCR text block from ${sourceLanguage || "auto-detect"} to ${targetLanguage}.

Critical rules:
- Return ONLY valid JSON.
- Do not wrap JSON in markdown.
- Preserve the exact block count.
- Preserve the exact index values.
- Do not merge blocks.
- Do not reorder blocks.
- Do not omit blocks.
- Translate each block independently.
- If a block is very short UI text, keep it short and natural.
- The translated text must match the meaning of the source block.
- Keep punctuation, numbers, emojis, symbols, and line intent when possible.
- Final translated text must always be in ${targetLanguage}.

Return EXACTLY this JSON shape:
{
  "blocks": [
    {
      "index": 0,
      "translated_text": "..."
    }
  ]
}

Domain/context: ${resolvedExpert}
Domain guidance: ${buildExpertTopicGuide(resolvedExpert)}

OCR blocks:
${JSON.stringify(safeBlocks, null, 2)}
  `.trim();

  const raw = await callGemini({
    parts: [{ text: prompt }],
    responseMimeType: "application/json",
    temperature: 0.18,
    topP: 0.9,
    topK: 32,
    maxOutputTokens: 4096,
  });

  const parsed =
    safeJsonParse(extractJsonText(raw)) || safeJsonParse(raw);

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed?.blocks)) {
    throw new Error("Gemini photo blocks formatı geçersiz");
  }

  const translatedMap = new Map();

  for (const item of parsed.blocks) {
    const index = Number(item?.index);
    const translatedText = (item?.translated_text || "")
      .toString()
      .trim();

    if (Number.isInteger(index)) {
      translatedMap.set(index, translatedText);
    }
  }

  return {
    blocks: blocks.map((b, index) => {
      const sourceText = (b?.source_text || b?.text || "").toString().trim();

      return {
        source_text: sourceText,
        translated_text: translatedMap.get(index) || sourceText,
        x: clamp01(b?.x, 0),
        y: clamp01(b?.y, 0),
        width: clamp01(b?.width, 0),
        height: clamp01(b?.height, 0),
      };
    }),
  };
}

async function translatePhotoWithGemini({
  imageBase64,
  mimeType,
  sourceLanguage,
  targetLanguage,
  expert,
}) {
  const resolvedExpert = normalizeExpert(expert);

  async function requestPhotoJson({ compactMode = false }) {
    const prompt = compactMode
      ? `
You are an OCR + translation engine.

Task:
1. Read visible text in the image.
2. Group nearby text into a SMALL number of meaningful regions.
3. Translate from ${sourceLanguage || "auto-detect"} to ${targetLanguage}.
4. Return ONLY valid JSON.
5. Do not wrap JSON in markdown.

Hard limits:
- Return at most 12 blocks.
- Merge nearby labels that belong together.
- Prefer compact output over detailed segmentation.
- Coordinates must be normalized between 0 and 1.

Return EXACTLY:
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

Important:
- Final translated text must always be in ${targetLanguage}.
- Domain/context: ${resolvedExpert}
- Domain guidance: ${buildExpertTopicGuide(resolvedExpert)}

If there is no visible text, return:
{
  "source_text": "",
  "translated_text": "",
  "blocks": []
}
      `.trim()
      : `
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

Hard limits:
- Return at most 20 blocks.
- If there are too many tiny UI labels, merge nearby ones.
- Prefer complete valid JSON over excessive detail.

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
- If the image has many UI labels, buttons, headings, or separate lines, return separate blocks only when necessary.
- Do NOT merge the whole image into one block unless absolutely necessary.
- Final translated text must always be in ${targetLanguage}.
- Domain/context: ${resolvedExpert}
- Domain guidance: ${buildExpertTopicGuide(resolvedExpert)}

If there is no visible text, return:
{
  "source_text": "",
  "translated_text": "",
  "blocks": []
}
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
      temperature: compactMode ? 0.1 : 0.15,
      topP: 0.9,
      topK: 32,
      maxOutputTokens: compactMode ? 4096 : 6144,
    });

    const extracted = extractJsonText(raw);
    const parsed = safeJsonParse(extracted) || safeJsonParse(raw);

    if (!parsed || typeof parsed !== "object") {
      console.error("GEMINI PHOTO RAW RESPONSE:", raw);
      console.error("GEMINI PHOTO EXTRACTED JSON:", extracted);
      return null;
    }

    return parsed;
  }

  let parsed = await requestPhotoJson({ compactMode: false });

  if (!parsed) {
    parsed = await requestPhotoJson({ compactMode: true });
  }

  if (!parsed) {
    throw new Error("Gemini photo JSON parse edilemedi");
  }

  const sourceText = (parsed?.source_text || "").toString().trim();
  const translatedText = (parsed?.translated_text || "").toString().trim();

  let blocks = normalizeGeminiBlocks(parsed?.blocks || []);

  if (blocks.length > 20) {
    blocks = blocks.slice(0, 20);
  }

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
  translatePhotoBlocksWithGemini,
  translatePhotoWithGemini,
  normalizeGeminiBlocks,
  generateTextExamplesWithGemini,
  normalizeExpert,
  buildExpertTopicGuide,
};