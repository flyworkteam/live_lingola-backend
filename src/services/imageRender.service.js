const sharp = require("sharp");

function escapeXml(text = "") {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitTextIntoLines(text = "", maxCharsPerLine = 18) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function rgbToHex(r, g, b) {
  const toHex = (v) => {
    const n = Math.max(0, Math.min(255, Math.round(v)));
    return n.toString(16).padStart(2, "0");
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function chooseReadableTextColor(bg) {
  const lum = getLuminance(bg.r, bg.g, bg.b);
  return lum > 0.5 ? "#111111" : "#ffffff";
}

async function sampleRegionAverageColor(buffer, left, top, width, height) {
  const safeLeft = Math.max(0, Math.floor(left));
  const safeTop = Math.max(0, Math.floor(top));
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));

  const stats = await sharp(buffer)
    .extract({
      left: safeLeft,
      top: safeTop,
      width: safeWidth,
      height: safeHeight,
    })
    .stats();

  const channels = stats.channels || [];
  const r = channels[0]?.mean ?? 255;
  const g = channels[1]?.mean ?? 255;
  const b = channels[2]?.mean ?? 255;

  return { r, g, b };
}

async function sampleBackgroundColorAroundBlock(buffer, x, y, w, h, imageWidth, imageHeight) {
  const pad = Math.max(4, Math.floor(Math.min(w, h) * 0.12));

  const candidates = [];

  if (y - pad > 0) {
    candidates.push({
      left: x,
      top: Math.max(0, y - pad),
      width: w,
      height: pad,
    });
  }

  if (y + h < imageHeight) {
    candidates.push({
      left: x,
      top: Math.min(imageHeight - 1, y + h),
      width: w,
      height: Math.min(pad, imageHeight - (y + h)),
    });
  }

  if (x - pad > 0) {
    candidates.push({
      left: Math.max(0, x - pad),
      top: y,
      width: pad,
      height: h,
    });
  }

  if (x + w < imageWidth) {
    candidates.push({
      left: Math.min(imageWidth - 1, x + w),
      top: y,
      width: Math.min(pad, imageWidth - (x + w)),
      height: h,
    });
  }

  const valid = candidates.filter(
    (c) => c.width > 0 && c.height > 0 && c.left >= 0 && c.top >= 0
  );

  if (valid.length === 0) {
    return { r: 255, g: 255, b: 255 };
  }

  const samples = await Promise.all(
    valid.map((c) =>
      sampleRegionAverageColor(buffer, c.left, c.top, c.width, c.height)
    )
  );

  const avg = samples.reduce(
    (acc, s) => {
      acc.r += s.r;
      acc.g += s.g;
      acc.b += s.b;
      return acc;
    },
    { r: 0, g: 0, b: 0 }
  );

  return {
    r: avg.r / samples.length,
    g: avg.g / samples.length,
    b: avg.b / samples.length,
  };
}

function estimateFontSize(boxWidth, boxHeight, linesCount) {
  const byHeight = boxHeight / Math.max(linesCount * 1.35, 1);
  const byWidth = boxWidth / 11;
  return Math.max(10, Math.min(32, Math.floor(Math.min(byHeight, byWidth))));
}

function buildTextSvg({
  x,
  y,
  boxWidth,
  boxHeight,
  translatedText,
  textColor,
  backgroundColor,
}) {
  const maxCharsPerLine = Math.max(8, Math.floor(boxWidth / 10));
  let lines = splitTextIntoLines(translatedText, maxCharsPerLine);

  if (lines.length === 0) lines = [translatedText];

  let fontSize = estimateFontSize(boxWidth, boxHeight, lines.length);
  let lineHeight = Math.floor(fontSize * 1.18);
  let totalHeight = lines.length * lineHeight;

  while (totalHeight > boxHeight - 8 && fontSize > 9) {
    fontSize -= 1;
    lineHeight = Math.floor(fontSize * 1.18);
    totalHeight = lines.length * lineHeight;
  }

  const textStartY = y + Math.max(4, Math.floor((boxHeight - totalHeight) / 2));

  const safeBg = escapeXml(backgroundColor);
  const safeTextColor = escapeXml(textColor);

  const textLines = lines
    .map((line, index) => {
      const safeLine = escapeXml(line);
      const lineY = textStartY + fontSize + index * lineHeight;

      return `
        <text
          x="${x + 4}"
          y="${lineY}"
          font-size="${fontSize}"
          fill="${safeTextColor}"
          font-family="Arial, Helvetica, sans-serif"
          font-weight="600"
        >
          ${safeLine}
        </text>
      `;
    })
    .join("");

  return `
    <rect
      x="${x}"
      y="${y}"
      width="${boxWidth}"
      height="${boxHeight}"
      rx="6"
      ry="6"
      fill="${safeBg}"
      fill-opacity="0.96"
    />
    ${textLines}
  `;
}

async function renderTranslatedImage(buffer, blocks) {
  const image = sharp(buffer);
  const meta = await image.metadata();

  if (!meta.width || !meta.height) {
    throw new Error("Image metadata unavailable");
  }

  const overlays = [];

  for (const b of blocks.filter((item) => item && item.translated_text)) {
    const x = Math.max(0, Math.floor(b.x * meta.width));
    const y = Math.max(0, Math.floor(b.y * meta.height));
    const boxWidth = Math.max(36, Math.floor(b.width * meta.width));
    const boxHeight = Math.max(18, Math.floor(b.height * meta.height));

    const bgSample = await sampleBackgroundColorAroundBlock(
      buffer,
      x,
      y,
      boxWidth,
      boxHeight,
      meta.width,
      meta.height
    );

    const backgroundColor = rgbToHex(bgSample.r, bgSample.g, bgSample.b);
    const textColor = chooseReadableTextColor(bgSample);

    overlays.push(
      buildTextSvg({
        x,
        y,
        boxWidth,
        boxHeight,
        translatedText: b.translated_text,
        textColor,
        backgroundColor,
      })
    );
  }

  const svg = `
    <svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">
      ${overlays.join("\n")}
    </svg>
  `;

  const out = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return out.toString("base64");
}

module.exports = { renderTranslatedImage };