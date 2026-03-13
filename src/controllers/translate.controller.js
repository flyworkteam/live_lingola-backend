const sharp = require("sharp");
const pool = require("../config/mysql");

const { detectText } = require("../services/ocr.service");
const {
  translateText: translatePlainText,
} = require("../services/translate.service");
const { renderTranslatedImage } = require("../services/imageRender.service");

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
    } = req.body;

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
            target_language
          );

    let translationId = null;

    if (
      save_to_history === true ||
      save_to_history === "true" ||
      save_to_history === 1 ||
      save_to_history === "1"
    ) {
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

      const [rows] = await pool.query(
        `
        SELECT id, usage_count
        FROM frequently_used_terms
        WHERE user_id = ?
          AND source_text = ?
          AND translated_text = ?
          AND source_language = ?
          AND target_language = ?
        LIMIT 1
        `,
        [
          userId,
          source_text,
          translatedTextValue,
          source_language,
          target_language,
        ]
      );

      if (rows.length > 0) {
        await pool.query(
          `
          UPDATE frequently_used_terms
          SET usage_count = usage_count + 1,
              last_used_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [rows[0].id]
        );
      } else {
        await pool.query(
          `
          INSERT INTO frequently_used_terms (
            user_id,
            source_text,
            translated_text,
            source_language,
            target_language,
            usage_count
          ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            userId,
            source_text,
            translatedTextValue,
            source_language,
            target_language,
            1,
          ]
        );
      }
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
        .jpeg({ quality: 92 })
        .toBuffer();
    } catch (e) {
      console.error("PHOTO NORMALIZE ERROR:", e);
      return res.status(400).json({
        ok: false,
        error: "Geçersiz veya desteklenmeyen görsel dosyası",
      });
    }

    const ocrBlocks = await detectText(normalizedBuffer);

    const translatedBlocks = [];
    for (const block of ocrBlocks) {
      const originalText = (block.text || "").toString().trim();
      if (!originalText) continue;

      const translated = await translatePlainText(
        originalText,
        source_language,
        target_language
      );

      translatedBlocks.push({
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        translated_text: translated,
      });
    }

    const translatedTextValue = translatedBlocks
      .map((b) => b.translated_text)
      .filter(Boolean)
      .join("\n");

    let translatedImageBase64 = null;

    try {
      translatedImageBase64 = await renderTranslatedImage(
        normalizedBuffer,
        translatedBlocks
      );
    } catch (e) {
      console.error("IMAGE RENDER ERROR:", e);
    }

    let translationId = null;

    if (
      save_to_history === true ||
      save_to_history === "true" ||
      save_to_history === 1 ||
      save_to_history === "1"
    ) {
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
          "[PHOTO_TEXT]",
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
      translated_text: translatedTextValue,
      translation_id: translationId,
      blocks: translatedBlocks,
      translated_image_base64: translatedImageBase64,
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
      ORDER BY created_at DESC
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
      SELECT *
      FROM frequently_used_terms
      WHERE user_id = ?
      ORDER BY usage_count DESC, last_used_at DESC
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
      message: "History cleared successfully",
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
      SET is_favorite = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND is_favorite = 1
      `,
      [userId]
    );

    return res.json({
      ok: true,
      message: "Favorites cleared successfully",
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
  translatePhoto,
  toggleFavorite,
  getHistory,
  getFavorites,
  getFrequentlyUsed,
  clearHistory,
  clearFavorites,
};