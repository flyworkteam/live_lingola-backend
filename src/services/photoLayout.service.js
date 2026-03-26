function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function sortBlocksReadingOrder(blocks) {
  return [...blocks].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 0.008) return a.y - b.y;
    return a.x - b.x;
  });
}

function normalizePhotoBlock(block) {
  const sourceText = normalizeText(block?.source_text || block?.text || "");
  const translatedText = normalizeText(block?.translated_text || "");

  return {
    source_text: sourceText,
    translated_text: translatedText,
    x: clamp01(block?.x, 0),
    y: clamp01(block?.y, 0),
    width: clamp01(block?.width, 0),
    height: clamp01(block?.height, 0),
  };
}

function removeTinyPhotoNoise(blocks) {
  return blocks.filter((b) => {
    const text = normalizeText(b.source_text || b.translated_text);
    if (!text) return false;
    if (b.width <= 0 || b.height <= 0) return false;
    if (b.width >= 0.95 && b.height >= 0.95) return false;

    const area = b.width * b.height;
    const textLen = text.length;

    if (area < 0.0001 && textLen < 4) return false;
    if (b.width < 0.006 || b.height < 0.006) return false;

    return true;
  });
}

function overlapRatio(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const intersection = width * height;
  if (intersection <= 0) return 0;

  const aArea = a.width * a.height || 1e-9;
  const bArea = b.width * b.height || 1e-9;
  return intersection / Math.min(aArea, bArea);
}

function dedupePhotoBlocks(blocks) {
  const out = [];

  for (const block of sortBlocksReadingOrder(blocks)) {
    const duplicateIndex = out.findIndex((existing) => {
      const sameText =
        normalizeText(existing.source_text) === normalizeText(block.source_text);
      return sameText && overlapRatio(existing, block) >= 0.84;
    });

    if (duplicateIndex === -1) {
      out.push(block);
      continue;
    }

    const existing = out[duplicateIndex];
    const existingArea = existing.width * existing.height;
    const currentArea = block.width * block.height;

    if (currentArea < existingArea) {
      out[duplicateIndex] = block;
    }
  }

  return out;
}

function expandPhotoBlocksForRender(blocks) {
  return blocks.map((b) => {
    const padX = Math.max(0.0008, Math.min(0.002, b.width * 0.012));
    const padY = Math.max(0.0008, Math.min(0.002, b.height * 0.04));

    const x = Math.max(0, b.x - padX);
    const y = Math.max(0, b.y - padY);
    const right = Math.min(1, b.x + b.width + padX);
    const bottom = Math.min(1, b.y + b.height + padY);

    return {
      ...b,
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    };
  });
}

function cleanupPhotoBlocksForTranslation(blocks) {
  let out = Array.isArray(blocks) ? blocks.map(normalizePhotoBlock) : [];
  out = removeTinyPhotoNoise(out);
  out = dedupePhotoBlocks(out);
  out = expandPhotoBlocksForRender(out);
  out = sortBlocksReadingOrder(out);

  return out.filter((b) => {
    const text = normalizeText(b.source_text || b.translated_text);
    return !!text && b.width > 0 && b.height > 0;
  });
}

module.exports = {
  cleanupPhotoBlocksForTranslation,
  sortBlocksReadingOrder,
};