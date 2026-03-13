const Tesseract = require("tesseract.js");

async function detectText(buffer) {
  const result = await Tesseract.recognize(buffer, "eng+tur", {
    logger: (m) => console.log(m),
  });

  const words = Array.isArray(result?.data?.words) ? result.data.words : [];
  const imageWidth = result?.data?.imageSize?.width || 1;
  const imageHeight = result?.data?.imageSize?.height || 1;

  return words
    .filter((word) => word?.text && word.text.trim() !== "")
    .map((word) => {
      const x0 = word.bbox?.x0 ?? 0;
      const y0 = word.bbox?.y0 ?? 0;
      const x1 = word.bbox?.x1 ?? 0;
      const y1 = word.bbox?.y1 ?? 0;

      return {
        text: word.text.trim(),
        x: x0 / imageWidth,
        y: y0 / imageHeight,
        width: Math.max(0, x1 - x0) / imageWidth,
        height: Math.max(0, y1 - y0) / imageHeight,
      };
    });
}

module.exports = {
  detectText,
};