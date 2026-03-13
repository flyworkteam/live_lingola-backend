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

async function renderTranslatedImage(buffer, blocks) {
  const image = sharp(buffer);
  const meta = await image.metadata();

  if (!meta.width || !meta.height) {
    throw new Error("Image metadata unavailable");
  }

  const svgText = blocks
    .filter((b) => b && b.translated_text)
    .map((b) => {
      const x = Math.max(0, b.x * meta.width);
      const y = Math.max(0, b.y * meta.height);
      const boxWidth = Math.max(60, b.width * meta.width);
      const boxHeight = Math.max(34, b.height * meta.height);

      const fontSize = Math.max(16, Math.min(34, boxWidth / 10));
      const maxCharsPerLine = Math.max(
        8,
        Math.floor(boxWidth / (fontSize * 0.62))
      );

      const lines = splitTextIntoLines(b.translated_text, maxCharsPerLine);
      const rectHeight = Math.max(
        boxHeight,
        lines.length * (fontSize + 6) + 12
      );

      const textLines = lines
        .map((line, index) => {
          const safeLine = escapeXml(line);
          const lineY = y + 10 + fontSize + index * (fontSize + 6);

          return `
            <text
              x="${x + 8}"
              y="${lineY}"
              font-size="${fontSize}"
              fill="white"
              stroke="black"
              stroke-width="2"
              paint-order="stroke"
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
          height="${rectHeight}"
          rx="10"
          ry="10"
          fill="rgba(0,0,0,0.35)"
        />
        ${textLines}
      `;
    })
    .join("");

  const svg = `
    <svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">
      ${svgText}
    </svg>
  `;

  const out = await image
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return out.toString("base64");
}

module.exports = { renderTranslatedImage };