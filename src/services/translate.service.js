const { translate } = require("@vitalets/google-translate-api");

function mapLanguageToCode(language) {
  const value = (language || "").toString().trim().toLowerCase();

  switch (value) {
    case "turkish":
    case "türkçe":
    case "tr":
      return "tr";

    case "english":
    case "ingilizce":
    case "en":
      return "en";

    case "german":
    case "almanca":
    case "de":
      return "de";

    case "french":
    case "fransızca":
    case "fr":
      return "fr";

    case "italian":
    case "italyanca":
    case "it":
      return "it";

    case "spanish":
    case "ispanyolca":
    case "es":
      return "es";

    case "portuguese":
    case "portekizce":
    case "pt":
      return "pt";

    case "russian":
    case "rusça":
    case "ru":
      return "ru";

    case "japanese":
    case "japonca":
    case "ja":
      return "ja";

    case "korean":
    case "korece":
    case "ko":
      return "ko";

    default:
      return "auto";
  }
}

async function translateText(text, sourceLanguage, targetLanguage) {
  try {
    const sourceText = (text || "").toString().trim();

    if (!sourceText) {
      return "";
    }

    const from = mapLanguageToCode(sourceLanguage);
    const to = mapLanguageToCode(targetLanguage);

    const result = await translate(sourceText, {
      from,
      to,
    });

    return result.text || "";
  } catch (error) {
    console.error("TRANSLATE SERVICE ERROR:", error.message);

    // rate limit yakalandığında fallback
    if (error.message?.includes("TooManyRequests")) {
      return "Translation service busy, try again.";
    }

    throw error;
  }
}

module.exports = {
  translateText,
  mapLanguageToCode,
};