const Tesseract = require("tesseract.js");

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

async function detectText(buffer) {
  const result = await Tesseract.recognize(buffer, "eng+tur", {
    logger: () => {},
  });

  const words = Array.isArray(result?.data?.words) ? result.data.words : [];
  const imageWidth = result?.data?.imageSize?.width || 1;
  const imageHeight = result?.data?.imageSize?.height || 1;

  const filteredWords = words.filter((word) => {
    const text = (word?.text || "").trim();
    const confidence = safeNumber(word?.confidence, 0);
    return text !== "" && confidence >= 20;
  });

  const groups = new Map();

  for (let i = 0; i < filteredWords.length; i += 1) {
    const word = filteredWords[i];
    const key = [
      word.block_num ?? "b0",
      word.par_num ?? "p0",
      word.line_num ?? `line_${i}`,
    ].join("_");

    const x0 = safeNumber(word?.bbox?.x0);
    const y0 = safeNumber(word?.bbox?.y0);
    const x1 = safeNumber(word?.bbox?.x1);
    const y1 = safeNumber(word?.bbox?.y1);

    if (!groups.has(key)) {
      groups.set(key, {
        texts: [],
        x0,
        y0,
        x1,
        y1,
      });
    }

    const group = groups.get(key);
    group.texts.push({
      text: word.text.trim(),
      x0,
      y0,
      x1,
      y1,
    });

    group.x0 = Math.min(group.x0, x0);
    group.y0 = Math.min(group.y0, y0);
    group.x1 = Math.max(group.x1, x1);
    group.y1 = Math.max(group.y1, y1);
  }

  return Array.from(groups.values())
    .map((group) => {
      const sortedTexts = group.texts.sort((a, b) => a.x0 - b.x0);
      const lineText = sortedTexts.map((item) => item.text).join(" ").trim();

      return {
        text: lineText,
        x: group.x0 / imageWidth,
        y: group.y0 / imageHeight,
        width: Math.max(0, group.x1 - group.x0) / imageWidth,
        height: Math.max(0, group.y1 - group.y0) / imageHeight,
      };
    })
    .filter((item) => item.text)
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.01) return a.y - b.y;
      return a.x - b.x;
    });
}

module.exports = {
  detectText,
};