const {
  translateTextWithGemini,
  generateTextExamplesWithGemini,
} = require("./gemini.service");

function normalizeLanguage(language) {
  const raw = (language || "").toString().trim();
  const value = raw.toLowerCase();

  const map = {
    auto: "Auto Detect",
    "": "Auto Detect",

    tr: "Turkish",
    türkçe: "Turkish",
    turkce: "Turkish",
    turkish: "Turkish",

    en: "English",
    ingilizce: "English",
    english: "English",

    de: "German",
    almanca: "German",
    german: "German",

    fr: "French",
    fransızca: "French",
    fransizca: "French",
    french: "French",

    it: "Italian",
    italyanca: "Italian",
    italian: "Italian",

    es: "Spanish",
    ispanyolca: "Spanish",
    spanish: "Spanish",

    pt: "Portuguese",
    portekizce: "Portuguese",
    portuguese: "Portuguese",

    ru: "Russian",
    rusça: "Russian",
    rusca: "Russian",
    russian: "Russian",

    ja: "Japanese",
    japonca: "Japanese",
    japanese: "Japanese",

    ko: "Korean",
    korece: "Korean",
    korean: "Korean",

    hi: "Hindi",
    hintçe: "Hindi",
    hintce: "Hindi",
    hindi: "Hindi",

    ar: "Arabic",
    arapça: "Arabic",
    arapca: "Arabic",
    arabic: "Arabic",
  };

  return {
    code: value || "auto",
    label: map[value] || raw || "Auto Detect",
  };
}

function normalizeExpert(expert) {
  const raw = (expert || "").toString().trim();
  const value = raw.toLowerCase();

  const map = {
    general: "General",

    daily: "Daily Conversation",
    dailyconversation: "Daily Conversation",
    "daily conversation": "Daily Conversation",

    travel: "Travel",

    business: "Business",

    academic: "Academic",

    medical: "Medical",

    legal: "Legal",

    technology: "Technology",
    tech: "Technology",

    marketing: "Marketing",

    ai: "AI Expert",
    aiexpert: "AI Expert",
    "ai expert": "AI Expert",

    finance: "Finance",
  };

  return map[value] || raw || "General";
}

function buildExpertTopicGuide(expert) {
  const value = normalizeExpert(expert);

  const guides = {
    General:
      "Use broadly useful, natural, everyday topics. Keep examples practical and easy to understand.",

    "Daily Conversation":
      "Focus on daily life, casual speaking, greetings, shopping, friends, food, weather, home, and routines.",

    Travel:
      "Focus on airports, hotels, restaurants, directions, local transportation, reservations, sightseeing, and emergencies while traveling.",

    Business:
      "Focus on meetings, emails, presentations, negotiation, deadlines, scheduling, teamwork, and professional office communication.",

    Academic:
      "Focus on classroom language, studying, research, lectures, homework, presentations, and academic discussion.",

    Medical:
      "Focus on symptoms, doctor visits, appointments, medication, pharmacy, emergency help, and basic health communication.",

    Legal:
      "Focus on official procedures, simple legal communication, documents, appointments, contracts, permissions, and rights-related phrases.",

    Technology:
      "Focus on apps, software, devices, internet, troubleshooting, coding, digital tools, and product usage language.",

    Marketing:
      "Focus on campaigns, branding, customer messaging, product promotion, social media, sales copy, and audience communication.",

    "AI Expert":
      "Focus on prompts, AI tools, automation, model behavior, productivity workflows, prompt engineering, and AI-assisted work.",

    Finance:
      "Focus on payments, invoices, pricing, banking, budgeting, expenses, subscriptions, and business finance language.",
  };

  return guides[value] || guides.General;
}

async function translateText(text, sourceLanguage, targetLanguage, options = {}) {
  const sourceText = (text || "").toString().trim();
  if (!sourceText) return "";

  const source = normalizeLanguage(sourceLanguage);
  const target = normalizeLanguage(targetLanguage);
  const expert = normalizeExpert(options.expert);

  if (
    source.code !== "auto" &&
    source.label &&
    target.label &&
    source.label.toLowerCase() === target.label.toLowerCase()
  ) {
    return sourceText;
  }

  return translateTextWithGemini({
    sourceText,
    sourceLanguage: source.label,
    targetLanguage: target.label,
    expert,
    expertGuide: buildExpertTopicGuide(expert),
    nonce: options.nonce || "",
    seed: options.seed || "",
    forceRegenerate: Boolean(options.forceRegenerate),
  });
}

async function generateTextExamples(options = {}) {
  const source = normalizeLanguage(options.sourceLanguage);
  const target = normalizeLanguage(options.targetLanguage);
  const expert = normalizeExpert(options.expert);
  const count = Math.max(1, Math.min(Number(options.count) || 2, 10));

  return generateTextExamplesWithGemini({
    sourceLanguage: source.label,
    targetLanguage: target.label,
    expert,
    expertGuide: buildExpertTopicGuide(expert),
    count,
    nonce: options.nonce || "",
    seed: options.seed || "",
    forceRegenerate: Boolean(options.forceRegenerate),
  });
}

module.exports = {
  translateText,
  generateTextExamples,
  normalizeLanguage,
  normalizeExpert,
  buildExpertTopicGuide,
};