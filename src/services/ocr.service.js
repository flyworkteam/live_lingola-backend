const sharp = require("sharp");
const { createWorker } = require("tesseract.js");


let worker = null;
let currentLang = null;

async function getWorker(lang) {
  if (worker && currentLang === lang) {
    return worker;
  }

  if (worker) {
    await worker.terminate();
    worker = null;
  }

  worker = await createWorker(lang, 1);

  currentLang = lang;

  console.log("🔥 OCR WORKER READY:", lang);

  return worker;
}

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
  const value = (language || "tr").toString().trim().toLowerCase();

  const languageMap = {
    tr: "tur",
    turkish: "tur",
    en: "eng",
    english: "eng",
    de: "deu",
    it: "ita",
    fr: "fra",
    es: "spa",
    ru: "rus",
    ko: "kor",
    hi: "hin",
    ja: "jpn",
    pt: "por",
    ar: "ara",
  };

  return languageMap[value] || "eng";
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

  if (widthNorm < 0.004 && heightNorm < 0.004) return false;

  return true;
}

function sortBlocks(blocks) {
  return [...blocks].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.008) return a.y - b.y;
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

function removeHugeBrokenBlocks(blocks) {
  return blocks.filter((block) => {
    const text = normalizeText(block.text);
    const width = block.width;
    const height = block.height;
    const area = width * height;

    if (!text) return false;

    const tooWideAndSuspicious = width >= 0.7 && text.length > 80;
    const tooHugeArea = area >= 0.16 && text.length > 80;

    return !(tooWideAndSuspicious || tooHugeArea);
  });
}

function removeTinyNoiseBlocks(blocks) {
  return blocks.filter((block) => {
    const text = normalizeText(block.text);
    const area = block.width * block.height;
    const textLen = text.length;

    if (!text) return false;
    if (area < 0.00006 && textLen < 4) return false;
    if (block.width < 0.003 || block.height < 0.003) return false;

    return true;
  });
}

async function preprocessImage(buffer) {
  return await sharp(buffer)
    .rotate()
    .resize({ width: 1100, withoutEnlargement: false })
    .grayscale()
    .normalize()
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function runOcr(buffer, language) {
  const tesseractLanguage = mapToTesseractLanguage(language);

  const worker = await getWorker(tesseractLanguage);

  const { data } = await worker.recognize(buffer, {
    tessedit_pageseg_mode: 6,
    tessedit_ocr_engine_mode: 1,
    preserve_interword_spaces: 1,
  });

  const rawText = normalizeText(data?.text || "");
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const imageWidth = data?.imageSize?.width || 1;
  const imageHeight = data?.imageSize?.height || 1;

  let blocks = [];


  if (lines.length > 0) {
    blocks = buildBlocksFromLines(lines, imageWidth, imageHeight);
  }

  blocks = dedupeBlocks(blocks);
  blocks = removeHugeBrokenBlocks(blocks);
  blocks = removeTinyNoiseBlocks(blocks);

  return {
    rawText,
    blocks,
    lineCount: lines.length,
  };
}

async function detectText(buffer, language = "tr") {
  try {
    const processed = await preprocessImage(buffer);
    const result = await runOcr(processed, language);

    console.log("OCR FAST MODE");
    console.log("LANG:", language);
    console.log("BLOCK COUNT:", result.blocks.length);

    return {
      rawText: result.rawText,
      blocks: result.blocks,
      variant: "fast",
      usedLanguage: language,
    };
  } catch (error) {
    console.error("OCR ERROR:", error);

    return {
      rawText: "",
      blocks: [],
      variant: "error",
    };
  }
}

async function preloadOcr(language = "tr") {
  const tesseractLanguage = mapToTesseractLanguage(language);
  await getWorker(tesseractLanguage);
  console.log("🚀 OCR PRELOADED:", tesseractLanguage);
}

module.exports = {
  detectText,
  preloadOcr,
};