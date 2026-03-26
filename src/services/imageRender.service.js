const sharp = require("sharp");

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  return lum > 0.5 ? "#000000" : "#ffffff";
}

function normalizeText(text = "") {
  return String(text).replace(/\r/g, "").trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateCharWidth(fontSize) {
  return fontSize * 0.52;
}

function wrapTextToWidth(text, maxWidth, fontSize) {
  const clean = normalizeText(text);
  if (!clean) return [];

  const paragraphs = clean
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  const lines = [];
  const maxCharsPerLine = Math.max(
    1,
    Math.floor(maxWidth / Math.max(1, estimateCharWidth(fontSize)))
  );

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

  const safeLeft = Math.max(
    0,
    Math.min((meta.width || 1) - 1, Math.floor(left))
  );
  const safeTop = Math.max(
    0,
    Math.min((meta.height || 1) - 1, Math.floor(top))
  );
  const safeWidth = Math.max(
    1,
    Math.min((meta.width || 1) - safeLeft, Math.floor(width))
  );
  const safeHeight = Math.max(
    1,
    Math.min((meta.height || 1) - safeTop, Math.floor(height))
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

async function sampleBackgroundColorAroundBlock(buffer, x, y, w, h, meta) {
  const padX = Math.max(2, Math.floor(w * 0.05));
  const padY = Math.max(2, Math.floor(h * 0.06));

  const regions = [];

  if (y - padY > 0) {
    regions.push({
      left: x,
      top: Math.max(0, y - padY),
      width: w,
      height: padY,
    });
  }

  if (y + h < (meta.height || 0)) {
    regions.push({
      left: x,
      top: y + h,
      width: w,
      height: Math.min(padY, (meta.height || 0) - (y + h)),
    });
  }

  if (x - padX > 0) {
    regions.push({
      left: Math.max(0, x - padX),
      top: y,
      width: padX,
      height: h,
    });
  }

  if (x + w < (meta.width || 0)) {
    regions.push({
      left: x + w,
      top: y,
      width: Math.min(padX, (meta.width || 0) - (x + w)),
      height: h,
    });
  }

  if (!regions.length) {
    return sampleRegionAverageColor(buffer, x, y, w, h);
  }

  const samples = [];
  for (const region of regions) {
    if (region.width > 0 && region.height > 0) {
      samples.push(
        await sampleRegionAverageColor(
          buffer,
          region.left,
          region.top,
          region.width,
          region.height
        )
      );
    }
  }

  if (!samples.length) {
    return sampleRegionAverageColor(buffer, x, y, w, h);
  }

  const total = samples.reduce(
    (acc, item) => ({
      r: acc.r + item.r,
      g: acc.g + item.g,
      b: acc.b + item.b,
    }),
    { r: 0, g: 0, b: 0 }
  );

  return {
    r: total.r / samples.length,
    g: total.g / samples.length,
    b: total.b / samples.length,
  };
}

function resolveInitialFontSize(boxHeight) {
  if (boxHeight <= 10) return 8;
  if (boxHeight <= 12) return 9;
  if (boxHeight <= 14) return 10;
  if (boxHeight <= 17) return 11;
  if (boxHeight <= 20) return 12;
  if (boxHeight <= 24) return 13;
  if (boxHeight <= 28) return 14;
  if (boxHeight <= 34) return 16;
  if (boxHeight <= 42) return 18;
  return Math.max(20, Math.floor(boxHeight * 0.58));
}

function layoutTextInsideSourceBox({
  translatedText,
  boxWidth,
  boxHeight,
}) {
  const cleanText = normalizeText(translatedText);

  const insetX = clamp(Math.floor(boxWidth * 0.04), 2, 12);
  const insetY = clamp(Math.floor(boxHeight * 0.10), 1, 10);

  const innerWidth = Math.max(8, boxWidth - insetX * 2);
  const innerHeight = Math.max(8, boxHeight - insetY * 2);

  let fontSize = resolveInitialFontSize(boxHeight);
  let lines = [cleanText];
  let lineHeight = Math.max(fontSize + 1, Math.round(fontSize * 1.16));

  while (fontSize >= 8) {
    lines = wrapTextToWidth(cleanText, innerWidth, fontSize);
    if (!lines.length) lines = [cleanText];

    lineHeight = Math.max(fontSize + 1, Math.round(fontSize * 1.16));
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= innerHeight) {
      break;
    }

    fontSize -= 1;
  }

  if (fontSize < 8) {
    fontSize = 8;
    lines = wrapTextToWidth(cleanText, innerWidth, fontSize);
    if (!lines.length) lines = [cleanText];
    lineHeight = Math.max(fontSize + 1, Math.round(fontSize * 1.16));
  }

  const maxLines = Math.max(1, Math.floor(innerHeight / lineHeight));

  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    if (lines.length > 0) {
      const lastIndex = lines.length - 1;
      lines[lastIndex] = `${lines[lastIndex].replace(/\.*$/, "")}…`;
    }
  }

  const totalTextHeight = lines.length * lineHeight;
  const offsetY = Math.max(
    insetY,
    Math.floor((boxHeight - totalTextHeight) / 2)
  );

  return {
    fontSize,
    lineHeight,
    lines,
    insetX,
    offsetY,
  };
}

async function buildBlurPatchForSourceBox({
  buffer,
  meta,
  left,
  top,
  width,
  height,
  backgroundSample,
}) {
  const patchLeft = Math.max(0, Math.floor(left));
  const patchTop = Math.max(0, Math.floor(top));
  const patchWidth = Math.max(
    1,
    Math.min(meta.width - patchLeft, Math.floor(width))
  );
  const patchHeight = Math.max(
    1,
    Math.min(meta.height - patchTop, Math.floor(height))
  );

  const blurSigma =
    patchHeight <= 18 || patchWidth <= 60
      ? 2.4
      : patchHeight <= 30 || patchWidth <= 140
        ? 3.4
        : 4.4;

  const extracted = await sharp(buffer)
    .extract({
      left: patchLeft,
      top: patchTop,
      width: patchWidth,
      height: patchHeight,
    })
    .blur(blurSigma)
    .composite([
      {
        input: {
          create: {
            width: patchWidth,
            height: patchHeight,
            channels: 4,
            background: {
              r: Math.round(backgroundSample.r),
              g: Math.round(backgroundSample.g),
              b: Math.round(backgroundSample.b),
              alpha: 0.18,
            },
          },
        },
        blend: "over",
      },
    ])
    .png()
    .toBuffer();

  return {
    input: extracted,
    left: patchLeft,
    top: patchTop,
  };
}

function buildTextSvg({
  x,
  y,
  boxWidth,
  boxHeight,
  translatedText,
  textColor,
}) {
  const layout = layoutTextInsideSourceBox({
    translatedText,
    boxWidth,
    boxHeight,
  });

  const safeTextColor = escapeXml(textColor);
  const fontWeight = layout.fontSize <= 11 ? "600" : "700";

  return layout.lines
    .map((line, index) => {
      const safeLine = escapeXml(line);
      const lineY =
        y +
        layout.offsetY +
        (index + 1) * layout.lineHeight -
        Math.round((layout.lineHeight - layout.fontSize) / 2);

      return `
        <text
          x="${x + layout.insetX}"
          y="${lineY}"
          font-size="${layout.fontSize}"
          fill="${safeTextColor}"
          font-family="Arial, Helvetica, sans-serif"
          font-weight="${fontWeight}"
        >
          ${safeLine}
        </text>
      `;
    })
    .join("");
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

  if (!validBlocks.length) {
    return null;
  }

  const backgroundPatches = [];
  const textOverlays = [];

  for (const b of validBlocks) {
    const x = Math.max(0, Math.floor((Number(b.x) || 0) * meta.width));
    const y = Math.max(0, Math.floor((Number(b.y) || 0) * meta.height));
    const boxWidth = Math.max(
      8,
      Math.floor((Number(b.width) || 0) * meta.width)
    );
    const boxHeight = Math.max(
      8,
      Math.floor((Number(b.height) || 0) * meta.height)
    );

    const translatedText = String(b.translated_text || "").trim();

    const backgroundSample = await sampleBackgroundColorAroundBlock(
      buffer,
      x,
      y,
      boxWidth,
      boxHeight,
      meta
    );

    const textColor = chooseReadableTextColor(backgroundSample);

    const patch = await buildBlurPatchForSourceBox({
      buffer,
      meta,
      left: x,
      top: y,
      width: boxWidth,
      height: boxHeight,
      backgroundSample,
    });

    backgroundPatches.push(patch);

    textOverlays.push(
      buildTextSvg({
        x,
        y,
        boxWidth,
        boxHeight,
        translatedText,
        textColor,
      })
    );
  }

  const svg = `
    <svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">
      ${textOverlays.join("\n")}
    </svg>
  `;

  const out = await image
    .composite([
      ...backgroundPatches,
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();

  return out.toString("base64");
}

module.exports = { renderTranslatedImage };