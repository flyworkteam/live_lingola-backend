const sharp = require("sharp");

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  return lum > 0.55 ? "#111111" : "#ffffff";
}

function normalizeText(text = "") {
  return String(text).replace(/\r/g, "").trim();
}

function estimateCharWidth(fontSize) {
  return fontSize * 0.58;
}

function wrapTextToWidth(text, maxWidth, fontSize) {
  const clean = normalizeText(text);
  if (!clean) return [];

  const paragraphs = clean.split("\n").map((item) => item.trim()).filter(Boolean);
  const lines = [];
  const maxCharsPerLine = Math.max(4, Math.floor(maxWidth / estimateCharWidth(fontSize)));

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;

      if (next.length <= maxCharsPerLine) {
        current = next;
      } else {
        if (current) lines.push(current);

        if (word.length > maxCharsPerLine) {
          let rest = word;
          while (rest.length > maxCharsPerLine) {
            lines.push(rest.slice(0, maxCharsPerLine));
            rest = rest.slice(maxCharsPerLine);
          }
          current = rest;
        } else {
          current = word;
        }
      }
    }

    if (current) lines.push(current);
  }

  return lines.filter(Boolean);
}

async function sampleRegionAverageColor(buffer, left, top, width, height) {
  const image = sharp(buffer);
  const meta = await image.metadata();

  const safeLeft = Math.max(0, Math.min(meta.width - 1, Math.floor(left)));
  const safeTop = Math.max(0, Math.min(meta.height - 1, Math.floor(top)));
  const safeWidth = Math.max(
    1,
    Math.min(meta.width - safeLeft, Math.floor(width))
  );
  const safeHeight = Math.max(
    1,
    Math.min(meta.height - safeTop, Math.floor(height))
  );

  const stats = await image
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

async function sampleBackgroundColorInsideBlock(buffer, x, y, w, h) {
  const innerPadX = Math.max(2, Math.floor(w * 0.1));
  const innerPadY = Math.max(2, Math.floor(h * 0.15));

  const left = x + innerPadX;
  const top = y + innerPadY;
  const width = Math.max(1, w - innerPadX * 2);
  const height = Math.max(1, h - innerPadY * 2);

  return sampleRegionAverageColor(buffer, left, top, width, height);
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
  const insetX = Math.max(6, Math.floor(boxWidth * 0.08));
  const insetY = Math.max(4, Math.floor(boxHeight * 0.14));

  const innerWidth = Math.max(12, boxWidth - insetX * 2);
  const innerHeight = Math.max(12, boxHeight - insetY * 2);

  let fontSize = Math.max(
    9,
    Math.min(28, Math.floor(Math.min(innerHeight * 0.7, innerWidth * 0.12)))
  );

  let lines = wrapTextToWidth(translatedText, innerWidth, fontSize);
  if (!lines.length) lines = [normalizeText(translatedText)];

  let lineHeight = Math.max(10, Math.floor(fontSize * 1.2));
  let totalHeight = lines.length * lineHeight;

  while ((totalHeight > innerHeight || lines.length > 8) && fontSize > 8) {
    fontSize -= 1;
    lines = wrapTextToWidth(translatedText, innerWidth, fontSize);
    if (!lines.length) lines = [normalizeText(translatedText)];
    lineHeight = Math.max(10, Math.floor(fontSize * 1.2));
    totalHeight = lines.length * lineHeight;
  }

  if (totalHeight > innerHeight && lines.length > 1) {
    const maxLines = Math.max(1, Math.floor(innerHeight / lineHeight));
    lines = lines.slice(0, maxLines);
  }

  if (lines.length > 0) {
    const lastIndex = lines.length - 1;
    if (lines[lastIndex].length > 2) {
      const needsEllipsis =
        wrapTextToWidth(translatedText, innerWidth, fontSize).length > lines.length;

      if (needsEllipsis) {
        lines[lastIndex] = `${lines[lastIndex].replace(/\.*$/, "")}…`;
      }
    }
  }

  const totalHeightFinal = lines.length * lineHeight;
  const textStartY =
    y + insetY + Math.max(0, Math.floor((innerHeight - totalHeightFinal) / 2));

  const safeBg = escapeXml(backgroundColor);
  const safeTextColor = escapeXml(textColor);

  const textLines = lines
    .map((line, index) => {
      const safeLine = escapeXml(line);
      const lineY = textStartY + fontSize + index * lineHeight;

      return `
        <text
          x="${x + insetX}"
          y="${lineY}"
          font-size="${fontSize}"
          fill="${safeTextColor}"
          font-family="Arial, Helvetica, sans-serif"
          font-weight="700"
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
      rx="5"
      ry="5"
      fill="${safeBg}"
      fill-opacity="0.97"
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

  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  const validBlocks = safeBlocks.filter((item) => {
    if (!item) return false;
    if (!String(item.translated_text || "").trim()) return false;

    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;

    return width > 0 && height > 0 && !(width >= 0.95 && height >= 0.95);
  });

  const overlays = [];

  for (const b of validBlocks) {
    const x = Math.max(0, Math.floor((Number(b.x) || 0) * meta.width));
    const y = Math.max(0, Math.floor((Number(b.y) || 0) * meta.height));
    const boxWidth = Math.max(
      28,
      Math.floor((Number(b.width) || 0) * meta.width)
    );
    const boxHeight = Math.max(
      18,
      Math.floor((Number(b.height) || 0) * meta.height)
    );

    const backgroundSample = await sampleBackgroundColorInsideBlock(
      buffer,
      x,
      y,
      boxWidth,
      boxHeight
    );

    const backgroundColor = rgbToHex(
      backgroundSample.r,
      backgroundSample.g,
      backgroundSample.b
    );
    const textColor = chooseReadableTextColor(backgroundSample);

    overlays.push(
      buildTextSvg({
        x,
        y,
        boxWidth,
        boxHeight,
        translatedText: String(b.translated_text || "").trim(),
        textColor,
        backgroundColor,
      })
    );
  }

  if (overlays.length === 0) {
    return null;
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