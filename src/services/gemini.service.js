const { translateText: translatePlainText } = require("./translate.service");

async function translateTextWithGemini({
  sourceText,
  sourceLanguage,
  targetLanguage,
  expert,
}) {
  return translatePlainText(
    sourceText,
    sourceLanguage,
    targetLanguage
  );
}

async function translatePhotoWithGemini({
  imageBase64,
  mimeType,
  sourceLanguage,
  targetLanguage,
}) {
  return {
    translated_text: "NO_TEXT_FOUND",
    blocks: [],
  };
}

module.exports = {
  translateTextWithGemini,
  translatePhotoWithGemini,
};