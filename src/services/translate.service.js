const { translate } = require("@vitalets/google-translate-api");

function mapLanguageToCode(language) {
  const value = (language || "").toString().trim().toLowerCase();

  switch (value) {
    case "turkish":
    case "türkçe":
      return "tr";
    case "english":
    case "ingilizce":
      return "en";
    case "german":
    case "almanca":
      return "de";
    case "french":
    case "fransızca":
      return "fr";
    case "italian":
    case "italyanca":
      return "it";
    case "spanish":
    case "spain":
    case "ispanyolca":
      return "es";
    default:
      return "auto";
  }
}

async function translateText(text, sourceLanguage, targetLanguage) {
  const sourceText = (text || "").toString().trim();
  if (!sourceText) return "";

  const from = mapLanguageToCode(sourceLanguage);
  const to = mapLanguageToCode(targetLanguage);

  const result = await translate(sourceText, {
    from,
    to,
  });

  return result.text || "";
}

module.exports = {
  translateText,
  mapLanguageToCode,
};