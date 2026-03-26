const sharp = require("sharp");
const pool = require("../config/mysql");

const {
  translateText: translatePlainText,
  generateTextExamples: generateExamplesFromService,
} = require("../services/translate.service");
const { renderTranslatedImage } = require("../services/imageRender.service");
const { detectText } = require("../services/ocr.service");
const {
  translatePhotoWithGemini,
  translatePhotoBlocksWithGemini,
  normalizeGeminiBlocks,
} = require("../services/gemini.service");
const {
  cleanupPhotoBlocksForTranslation,
} = require("../services/photoLayout.service");

async function getUserIdByFirebaseUid(firebaseUid) {
  const [rows] = await pool.query(
    `
    SELECT id
    FROM users
    WHERE firebase_uid = ?
    LIMIT 1
    `,
    [firebaseUid]
  );

  if (!rows.length) return null;
  return rows[0].id;
}

function isTruthySave(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizePhotoBlock(block) {
  const sourceText = (block?.source_text || block?.text || "")
    .toString()
    .trim();
  const translatedText = (block?.translated_text || "").toString().trim();

  return {
    source_text: sourceText,
    translated_text: translatedText,
    x: clamp01(block?.x, 0),
    y: clamp01(block?.y, 0),
    width: clamp01(block?.width, 0),
    height: clamp01(block?.height, 0),
  };
}

function cleanupPhotoBlocks(blocks) {
  return cleanupPhotoBlocksForTranslation(
    (Array.isArray(blocks) ? blocks : []).map(normalizePhotoBlock)
  );
}

const translateText = async (req, res) => {
  try {
    const {
      firebase_uid,
      source_text,
      translated_text,
      source_language,
      target_language,
      expert,
      translation_type,
      save_to_history,
      nonce,
      request_id,
      seed,
      force_regenerate,
    } = req.body || {};

    if (!firebase_uid) {
      return res.status(400).json({
        ok: false,
        error: "firebase_uid zorunlu",
      });
    }

    if (!source_text || !source_language || !target_language) {
      return res.status(400).json({
        ok: false,
        error: "source_text, source_language ve target_language zorunlu",
      });
    }

    const userId = await getUserIdByFirebaseUid(firebase_uid);

    if (!userId) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    const translatedTextValue =
      translated_text && translated_text.toString().trim() !== ""
        ? translated_text
        : await translatePlainText(
            source_text,
            source_language,
            target_language,
            {
              expert,
              nonce: nonce || request_id || "",
              seed: seed || "",
              forceRegenerate: Boolean(force_regenerate),
            }
          );

    let translationId = null;

    if (isTruthySave(save_to_history)) {
      const [result] = await pool.query(
        `
        INSERT INTO translations (
          user_id,
          translation_type,
          source_text,
          translated_text,
          source_language,
          target_language,
          expert,
          is_favorite
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          translation_type || "text",
          source_text,
          translatedTextValue,
          source_language,
          target_language,
          expert || "General",
          0,
        ]
      );

      translationId = result.insertId;
    }

    return res.json({
      ok: true,
      translated_text: translatedTextValue,
      translation_id: translationId,
    });
  } catch (error) {
    console.error("TRANSLATE TEXT ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const generateTextExamples = async (req, res) => {
  try {
    const {
      source_language,
      target_language,
      expert,
      count,
      nonce,
      request_id,
      seed,
      force_regenerate,
    } = req.body || {};

    if (!source_language || !target_language) {
      return res.status(400).json({
        ok: false,
        error: "source_language ve target_language zorunlu",
      });
    }

    const examples = await generateExamplesFromService({
      sourceLanguage: source_language,
      targetLanguage: target_language,
      expert,
      count,
      nonce: nonce || request_id || "",
      seed: seed || "",
      forceRegenerate: Boolean(force_regenerate),
    });

    return res.json({
      ok: true,
      examples,
    });
  } catch (error) {
    console.error("GENERATE TEXT EXAMPLES ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      examples: [],
    });
  }
};

const translatePhoto = async (req, res) => {
  try {
    console.log("PHOTO BODY:", req.body);
    console.log(
      "PHOTO FILE:",
      req.file
        ? {
            fieldname: req.file.fieldname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            originalname: req.file.originalname,
          }
        : null
    );

    const {
      firebase_uid,
      source_language,
      target_language,
      save_to_history,
      expert,
    } = req.body || {};

    if (!firebase_uid) {
      return res.status(400).json({
        ok: false,
        error: "firebase_uid zorunlu",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "image gerekli",
      });
    }

    if (!source_language || !target_language) {
      return res.status(400).json({
        ok: false,
        error: "source_language ve target_language zorunlu",
      });
    }

    const userId = await getUserIdByFirebaseUid(firebase_uid);

    if (!userId) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    let normalizedBuffer;
    try {
      normalizedBuffer = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1400, withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch (e) {
      console.error("PHOTO NORMALIZE ERROR:", e);
      return res.status(400).json({
        ok: false,
        error: "Geçersiz veya desteklenmeyen görsel dosyası",
      });
    }

    let sourceTextValue = "";
    let translatedTextValue = "";
    let translatedBlocks = [];
    let processingMode = "ocr_blocks";

    try {
      let ocrResult = await detectText(normalizedBuffer, source_language);

      let rawOcrBlocks = Array.isArray(ocrResult?.blocks)
        ? ocrResult.blocks.map((b) => ({
            source_text: (b?.text || "").toString().trim(),
            x: b?.x,
            y: b?.y,
            width: b?.width,
            height: b?.height,
          }))
        : [];

      let cleanedOcrBlocks = cleanupPhotoBlocks(rawOcrBlocks);

      if (!cleanedOcrBlocks.length) {
        const retryOcrResult = await detectText(normalizedBuffer, "auto");

        const retryRawBlocks = Array.isArray(retryOcrResult?.blocks)
          ? retryOcrResult.blocks.map((b) => ({
              source_text: (b?.text || "").toString().trim(),
              x: b?.x,
              y: b?.y,
              width: b?.width,
              height: b?.height,
            }))
          : [];

        const retryCleanedBlocks = cleanupPhotoBlocks(retryRawBlocks);

        if (retryCleanedBlocks.length > cleanedOcrBlocks.length) {
          ocrResult = retryOcrResult;
          rawOcrBlocks = retryRawBlocks;
          cleanedOcrBlocks = retryCleanedBlocks;
        }
      }

      console.log("PHOTO OCR VARIANT:", ocrResult?.variant || "unknown");
      console.log("PHOTO OCR USED LANGUAGE:", ocrResult?.usedLanguage || source_language);
      console.log("PHOTO OCR RAW TEXT:", ocrResult?.rawText || "");
      console.log("PHOTO OCR RAW BLOCK COUNT:", rawOcrBlocks.length);
      console.log("PHOTO OCR CLEAN BLOCK COUNT:", cleanedOcrBlocks.length);
      console.log("PHOTO OCR CLEAN BLOCKS:", cleanedOcrBlocks);

      sourceTextValue = (ocrResult?.rawText || "").toString().trim();

      if (cleanedOcrBlocks.length > 0) {
        const translated = await translatePhotoBlocksWithGemini({
          blocks: cleanedOcrBlocks,
          sourceLanguage: source_language,
          targetLanguage: target_language,
          expert: expert || "General",
        });

        translatedBlocks = normalizeGeminiBlocks(translated?.blocks || []);
        translatedTextValue = translatedBlocks
          .map((b) => (b?.translated_text || "").toString().trim())
          .filter(Boolean)
          .join("\n");
      }

      if (!translatedBlocks.length) {
        processingMode = "gemini_fallback";

        const geminiPhoto = await translatePhotoWithGemini({
          imageBase64: normalizedBuffer.toString("base64"),
          mimeType: "image/jpeg",
          sourceLanguage: source_language,
          targetLanguage: target_language,
          expert: expert || "General",
        });

        sourceTextValue = (geminiPhoto?.source_text || sourceTextValue || "")
          .toString()
          .trim();
        translatedTextValue = (geminiPhoto?.translated_text || "")
          .toString()
          .trim();
        translatedBlocks = normalizeGeminiBlocks(geminiPhoto?.blocks || []);
      }

      if (!translatedBlocks.length && translatedTextValue) {
        translatedBlocks = [
          {
            x: 0.05,
            y: 0.05,
            width: 0.9,
            height: 0.2,
            source_text: sourceTextValue,
            translated_text: translatedTextValue,
          },
        ];
      }
    } catch (e) {
      console.error("PHOTO PIPELINE ERROR:", e);

      processingMode = "gemini_fallback_error_path";

      const geminiPhoto = await translatePhotoWithGemini({
        imageBase64: normalizedBuffer.toString("base64"),
        mimeType: "image/jpeg",
        sourceLanguage: source_language,
        targetLanguage: target_language,
        expert: expert || "General",
      });

      sourceTextValue = (geminiPhoto?.source_text || "").toString().trim();
      translatedTextValue = (geminiPhoto?.translated_text || "")
        .toString()
        .trim();
      translatedBlocks = normalizeGeminiBlocks(geminiPhoto?.blocks || []);
    }

    console.log("PHOTO FINAL MODE:", processingMode);
    console.log("PHOTO FINAL SOURCE TEXT:", sourceTextValue);
    console.log("PHOTO FINAL TRANSLATED TEXT:", translatedTextValue);
    console.log("PHOTO FINAL BLOCKS:", translatedBlocks);

    let translatedImageBase64 = null;

    try {
      if (translatedBlocks.length > 0) {
        translatedImageBase64 = await renderTranslatedImage(
          normalizedBuffer,
          translatedBlocks
        );
      }
    } catch (e) {
      console.error("IMAGE RENDER ERROR:", e);
    }

    let translationId = null;

    if (isTruthySave(save_to_history)) {
      const [result] = await pool.query(
        `
        INSERT INTO translations (
          user_id,
          translation_type,
          source_text,
          translated_text,
          source_language,
          target_language,
          expert,
          is_favorite
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          "photo",
          sourceTextValue || "[PHOTO_TEXT]",
          translatedTextValue || "[NO_TEXT_FOUND]",
          source_language,
          target_language,
          expert || "General",
          0,
        ]
      );

      translationId = result.insertId;
    }

    return res.json({
      ok: true,
      source_text: sourceTextValue,
      translated_text: translatedTextValue,
      translation_id: translationId,
      blocks: translatedBlocks,
      original_image_base64: normalizedBuffer.toString("base64"),
      translated_image_base64: translatedImageBase64,
      render_mode: processingMode,
    });
  } catch (error) {
    console.error("TRANSLATE PHOTO ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const toggleFavorite = async (req, res) => {
  try {
    const { translation_id, is_favorite } = req.body;

    if (!translation_id || typeof is_favorite !== "boolean") {
      return res.status(400).json({
        ok: false,
        error: "translation_id ve boolean is_favorite zorunlu",
      });
    }

    const [result] = await pool.query(
      `
      UPDATE translations
      SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [is_favorite ? 1 : 0, translation_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        error: "Translation kaydı bulunamadı",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT *
      FROM translations
      WHERE id = ?
      LIMIT 1
      `,
      [translation_id]
    );

    return res.json({
      ok: true,
      item: rows[0],
    });
  } catch (error) {
    console.error("TOGGLE FAVORITE ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const getHistory = async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const userId = await getUserIdByFirebaseUid(firebaseUid);

    if (!userId) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT *
      FROM translations
      WHERE user_id = ?
      ORDER BY created_at DESC
      `,
      [userId]
    );

    return res.json({
      ok: true,
      items: rows,
    });
  } catch (error) {
    console.error("GET HISTORY ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const getFavorites = async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const userId = await getUserIdByFirebaseUid(firebaseUid);

    if (!userId) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT *
      FROM translations
      WHERE user_id = ? AND is_favorite = 1
      ORDER BY updated_at DESC, created_at DESC
      `,
      [userId]
    );

    return res.json({
      ok: true,
      items: rows,
    });
  } catch (error) {
    console.error("GET FAVORITES ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const getFrequentlyUsed = async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const userId = await getUserIdByFirebaseUid(firebaseUid);

    if (!userId) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    const [rows] = await pool.query(
      `
      SELECT source_text, translated_text, source_language, target_language, COUNT(*) AS usage_count
      FROM translations
      WHERE user_id = ?
      GROUP BY source_text, translated_text, source_language, target_language
      ORDER BY usage_count DESC, MAX(created_at) DESC
      LIMIT 20
      `,
      [userId]
    );

    return res.json({
      ok: true,
      items: rows,
    });
  } catch (error) {
    console.error("GET FREQUENTLY USED ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const clearHistory = async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const userId = await getUserIdByFirebaseUid(firebaseUid);

    if (!userId) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    await pool.query(
      `
      DELETE FROM translations
      WHERE user_id = ?
      `,
      [userId]
    );

    return res.json({
      ok: true,
    });
  } catch (error) {
    console.error("CLEAR HISTORY ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

const clearFavorites = async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const userId = await getUserIdByFirebaseUid(firebaseUid);

    if (!userId) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    await pool.query(
      `
      UPDATE translations
      SET is_favorite = 0, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
      `,
      [userId]
    );

    return res.json({
      ok: true,
    });
  } catch (error) {
    console.error("CLEAR FAVORITES ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
};

module.exports = {
  translateText,
  generateTextExamples,
  translatePhoto,
  toggleFavorite,
  getHistory,
  getFavorites,
  getFrequentlyUsed,
  clearHistory,
  clearFavorites,
};