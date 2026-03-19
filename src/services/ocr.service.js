const sharp = require("sharp");
const Tesseract = require("tesseract.js");

function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function mapToTesseractLanguage(language) {
  const value = (language || "").toString().trim().toLowerCase();

  const languageMap = {
    tr: "tur",
    turkish: "tur",

    en: "eng",
    english: "eng",

    de: "deu",
    german: "deu",

    it: "ita",
    italian: "ita",

    fr: "fra",
    french: "fra",

    es: "spa",
    spanish: "spa",

    ru: "rus",
    russian: "rus",

    ko: "kor",
    korean: "kor",

    hi: "hin",
    hindi: "hin",

    ja: "jpn",
    japanese: "jpn",

    pt: "por",
    portuguese: "por",

    ar: "ara",
    arabic: "ara",

    auto: "eng+tur+deu+ita+fra+spa+rus+kor+hin+jpn+por+ara",
  };

  return (
    languageMap[value] ||
    "eng+tur+deu+ita+fra+spa+rus+kor+hin+jpn+por+ara"
  );
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[|¦]+/g, "I")
    .trim();
}

function isUsefulText(text) {
  const value = normalizeText(text);
  if (!value) return false;

  const alnumCount = (value.match(/[\p{L}\p{N}]/gu) || []).length;
  return alnumCount > 0;
}

function normalizeBox(item, imageWidth, imageHeight) {
  const x0 = safeNumber(item?.bbox?.x0);
  const y0 = safeNumber(item?.bbox?.y0);
  const x1 = safeNumber(item?.bbox?.x1);
  const y1 = safeNumber(item?.bbox?.y1);

  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);

  return {
    x: imageWidth > 0 ? x0 / imageWidth : 0,
    y: imageHeight > 0 ? y0 / imageHeight : 0,
    width: imageWidth > 0 ? width / imageWidth : 0,
    height: imageHeight > 0 ? height / imageHeight : 0,
  };
}

function shouldKeepBlock(text, widthNorm, heightNorm) {
  const clean = normalizeText(text);
  if (!isUsefulText(clean)) return false;
  if (widthNorm <= 0 || heightNorm <= 0) return false;

  const alnumCount = (clean.match(/[\p{L}\p{N}]/gu) || []).length;
  if (alnumCount < 2) return false;

  if (widthNorm < 0.01 && heightNorm < 0.01) return false;

  return true;
}

function sortBlocks(blocks) {
  return [...blocks].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.012) return a.y - b.y;
    return a.x - b.x;
  });
}

function buildBlocksFromLines(lines, imageWidth, imageHeight) {
  return sortBlocks(
    lines
      .map((line) => {
        const text = normalizeText(line?.text || "");
        const box = normalizeBox(line, imageWidth, imageHeight);

        return {
          text,
          x: clamp01(box.x, 0),
          y: clamp01(box.y, 0),
          width: clamp01(box.width, 0),
          height: clamp01(box.height, 0),
        };
      })
      .filter((item) => shouldKeepBlock(item.text, item.width, item.height))
  );
}

function buildBlocksFromWords(words, imageWidth, imageHeight) {
  const usefulWords = words.filter((word) => {
    const text = normalizeText(word?.text || "");
    const confidence = safeNumber(word?.confidence, 0);
    return isUsefulText(text) && confidence >= 30;
  });

  const groups = new Map();

  for (let i = 0; i < usefulWords.length; i += 1) {
    const word = usefulWords[i];
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
      text: normalizeText(word.text),
      x0,
    });

    group.x0 = Math.min(group.x0, x0);
    group.y0 = Math.min(group.y0, y0);
    group.x1 = Math.max(group.x1, x1);
    group.y1 = Math.max(group.y1, y1);
  }

  return sortBlocks(
    Array.from(groups.values())
      .map((group) => {
        const lineText = normalizeText(
          group.texts
            .sort((a, b) => a.x0 - b.x0)
            .map((item) => item.text)
            .join(" ")
        );

        return {
          text: lineText,
          x: clamp01(group.x0 / imageWidth, 0),
          y: clamp01(group.y0 / imageHeight, 0),
          width: clamp01((group.x1 - group.x0) / imageWidth, 0),
          height: clamp01((group.y1 - group.y0) / imageHeight, 0),
        };
      })
      .filter((item) => shouldKeepBlock(item.text, item.width, item.height))
  );
}

function dedupeBlocks(blocks) {
  const seen = new Set();
  const out = [];

  for (const block of sortBlocks(blocks)) {
    const key = [
      block.text,
      block.x.toFixed(3),
      block.y.toFixed(3),
      block.width.toFixed(3),
      block.height.toFixed(3),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(block);
  }

  return out;
}

function canMergeSameLine(a, b) {
  const aMidY = a.y + a.height / 2;
  const bMidY = b.y + b.height / 2;
  const maxHeight = Math.max(a.height, b.height);

  const sameLine = Math.abs(aMidY - bMidY) <= maxHeight * 0.45;
  if (!sameLine) return false;

  const horizontalGap = b.x - (a.x + a.width);
  if (horizontalGap < 0) return false;

  return horizontalGap <= 0.018;
}

function mergeTwoBlocks(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);

  return {
    text: normalizeText(`${a.text} ${b.text}`),
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function mergeOnlySameLineBlocks(blocks) {
  const sorted = sortBlocks(blocks);
  if (!sorted.length) return [];

  const merged = [];

  for (const block of sorted) {
    if (!merged.length) {
      merged.push({ ...block });
      continue;
    }

    const last = merged[merged.length - 1];

    if (canMergeSameLine(last, block)) {
      merged[merged.length - 1] = mergeTwoBlocks(last, block);
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

function removeHugeBrokenBlocks(blocks) {
  return blocks.filter((block) => {
    const text = normalizeText(block.text);
    const width = block.width;
    const height = block.height;
    const area = width * height;

    if (!text) return false;

    const lineLike = height <= 0.08;
    const tooWideAndSuspicious = width >= 0.8 && text.length > 140;
    const tooHugeArea = area >= 0.22 && text.length > 120;

    if ((tooWideAndSuspicious || tooHugeArea) && !lineLike) {
      return false;
    }

    return true;
  });
}

function scoreBlocks(blocks, rawText) {
  const textLength = blocks.reduce((sum, item) => sum + item.text.length, 0);
  const blockBonus = Math.min(blocks.length, 40) * 12;
  const rawBonus = Math.min(normalizeText(rawText).length, 400);
  return textLength + blockBonus + rawBonus;
}

async function buildPreprocessedVariants(buffer) {
  const base = sharp(buffer).rotate();
  const meta = await base.metadata();

  const width = meta.width || 0;
  const shouldUpscale = width > 0 && width < 1800;
  const resizeWidth = shouldUpscale ? Math.min(2400, width * 2) : null;

  const original = await base.jpeg({ quality: 95 }).toBuffer();

  const enhanced = await sharp(buffer)
    .rotate()
    .resize(resizeWidth ? { width: resizeWidth, withoutEnlargement: false } : {})
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.1, m1: 1, m2: 2 })
    .jpeg({ quality: 95 })
    .toBuffer();

  const thresholded = await sharp(buffer)
    .rotate()
    .resize(resizeWidth ? { width: resizeWidth, withoutEnlargement: false } : {})
    .grayscale()
    .normalize()
    .threshold(175)
    .jpeg({ quality: 95 })
    .toBuffer();

  return [
    { label: "original", buffer: original },
    { label: "enhanced", buffer: enhanced },
    { label: "thresholded", buffer: thresholded },
  ];
}

async function runOcr(buffer, language) {
  const tesseractLanguage = mapToTesseractLanguage(language);

  const result = await Tesseract.recognize(buffer, tesseractLanguage, {
    logger: () => {},
  });

  const data = result?.data || {};
  const rawText = normalizeText(data?.text || "");
  const words = Array.isArray(data?.words) ? data.words : [];
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const imageWidth = data?.imageSize?.width || 1;
  const imageHeight = data?.imageSize?.height || 1;

  let blocks = [];

  if (lines.length > 0) {
    blocks = buildBlocksFromLines(lines, imageWidth, imageHeight);
  }

  if (blocks.length === 0 && words.length > 0) {
    blocks = buildBlocksFromWords(words, imageWidth, imageHeight);
  }

  blocks = dedupeBlocks(mergeOnlySameLineBlocks(blocks));
  blocks = removeHugeBrokenBlocks(blocks);

  return {
    rawText,
    blocks,
    lineCount: lines.length,
    wordCount: words.length,
    tesseractLanguage,
    score: scoreBlocks(blocks, rawText),
  };
}

async function detectText(buffer, language = "auto") {
  const variants = await buildPreprocessedVariants(buffer);

  let best = null;

  for (const variant of variants) {
    try {
      const result = await runOcr(variant.buffer, language);

      console.log("OCR VARIANT:", variant.label);
      console.log("OCR LANGUAGE:", language);
      console.log("OCR TESSERACT LANGUAGE:", result.tesseractLanguage);
      console.log("OCR RAW TEXT:", result.rawText);
      console.log("OCR LINE COUNT:", result.lineCount);
      console.log("OCR WORD COUNT:", result.wordCount);
      console.log("OCR BLOCK COUNT:", result.blocks.length);
      console.log("OCR SCORE:", result.score);
      console.log("OCR BLOCKS:", result.blocks);

      if (!best || result.score > best.score) {
        best = {
          ...result,
          variant: variant.label,
        };
      }
    } catch (error) {
      console.error(`OCR ERROR [${variant.label}]:`, error);
    }
  }

  if (!best) {
    return {
      rawText: "",
      blocks: [],
      variant: "none",
    };
  }

  return {
    rawText: best.rawText,
    blocks: best.blocks,
    variant: best.variant,
  };
}

module.exports = {
  detectText,
};