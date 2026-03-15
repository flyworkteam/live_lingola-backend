const { translateTextWithGemini } = require("./gemini.service");

function normalizeLanguage(language) {
  const value = (language || "").toString().trim().toLowerCase();

  const map = {
    auto: "Auto Detect",
    "": "Auto Detect",

    tr: "Turkish",
    türkçe: "Turkish",
    turkish: "Turkish",

    en: "English",
    ingilizce: "English",
    english: "English",

    de: "German",
    almanca: "German",
    german: "German",

    fr: "French",
    fransızca: "French",
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
    russian: "Russian",

    ja: "Japanese",
    japonca: "Japanese",
    japanese: "Japanese",

    ko: "Korean",
    korece: "Korean",
    korean: "Korean",

    hi: "Hindi",
    hintçe: "Hindi",
    hindi: "Hindi",

    ar: "Arabic",
    arapça: "Arabic",
    arabic: "Arabic",
  };

  return {
    code: value || "auto",
    label: map[value] || language || "Auto Detect",
  };
}

async function translateText(text, sourceLanguage, targetLanguage, options = {}) {
  const sourceText = (text || "").toString().trim();
  if (!sourceText) return "";

  const source = normalizeLanguage(sourceLanguage);
  const target = normalizeLanguage(targetLanguage);

  if (
    source.code !== "auto" &&
    source.label.toLowerCase() === target.label.toLowerCase()
  ) {
    return sourceText;
  }

  return translateTextWithGemini({
    sourceText,
    sourceLanguage: source.label,
    targetLanguage: target.label,
    expert: options.expert || "General",
  });
}

module.exports = {
  translateText,
  normalizeLanguage,
};