const pool = require("../config/mysql");
const {
  translateText: translateTextService,
} = require("../services/translate.service");

const TRANSLATION_TABLE = "translation_history";

async function tableExists(tableName) {
  try {
    const [rows] = await pool.query("SHOW TABLES LIKE ?", [tableName]);
    return rows.length > 0;
  } catch (error) {
    console.error("TABLE EXISTS CHECK ERROR:", error.message);
    return false;
  }
}

async function saveTranslationIfPossible({
  firebaseUid,
  originalText,
  translatedText,
  sourceLanguage,
  targetLanguage,
}) {
  try {
    if (!firebaseUid) return null;

    const exists = await tableExists(TRANSLATION_TABLE);
    if (!exists) {
      console.warn(
        `TABLE NOT FOUND: ${TRANSLATION_TABLE}. Translation history will not be saved.`
      );
      return null;
    }

    const [result] = await pool.query(
      `
      INSERT INTO ${TRANSLATION_TABLE}
      (
        firebase_uid,
        original_text,
        translated_text,
        source_language,
        target_language,
        is_favorite
      )
      VALUES (?, ?, ?, ?, ?, 0)
      `,
      [
        firebaseUid,
        originalText,
        translatedText,
        sourceLanguage || null,
        targetLanguage || null,
      ]
    );

    return result.insertId || null;
  } catch (error) {
    console.error("SAVE TRANSLATION ERROR:", error.message);
    return null;
  }
}

const translateText = async (req, res) => {
  try {
    const { text, sourceLanguage, targetLanguage, firebaseUid } = req.body;

    if (!text || !targetLanguage) {
      return res.status(400).json({
        ok: false,
        error: "text ve targetLanguage zorunlu",
      });
    }

    const translatedText = await translateTextService(
      text,
      sourceLanguage,
      targetLanguage
    );

    const savedId = await saveTranslationIfPossible({
      firebaseUid,
      originalText: text,
      translatedText,
      sourceLanguage,
      targetLanguage,
    });

    return res.json({
      ok: true,
      translationId: savedId,
      originalText: text,
      translatedText,
      sourceLanguage,
      targetLanguage,
    });
  } catch (error) {
    console.error("TRANSLATE TEXT CONTROLLER ERROR:", error);

    if (error.message?.includes("TooManyRequests")) {
      return res.status(429).json({
        ok: false,
        error: "Çeviri servisi şu anda yoğun, lütfen biraz sonra tekrar deneyin.",
      });
    }

    return res.status(500).json({
      ok: false,
      error: error.message || "Translate failed",
    });
  }
};

const translatePhoto = async (req, res) => {
  try {
    return res.status(501).json({
      ok: false,
      error:
        "Photo translate şu an bu yapıda aktif değil. Bunun için ayrı OCR servisi bağlanmalı.",
    });
  } catch (error) {
    console.error("TRANSLATE PHOTO ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Photo translate failed",
    });
  }
};

const toggleFavorite = async (req, res) => {
  try {
    const {
      firebaseUid,
      translationId,
      originalText,
      translatedText,
      sourceLanguage,
      targetLanguage,
    } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid zorunlu",
      });
    }

    const exists = await tableExists(TRANSLATION_TABLE);
    if (!exists) {
      return res.status(200).json({
        ok: true,
        message: `${TRANSLATION_TABLE} tablosu henüz yok. Favori işlemi uygulanmadı.`,
      });
    }

    if (translationId) {
      const [rows] = await pool.query(
        `
        SELECT id, is_favorite
        FROM ${TRANSLATION_TABLE}
        WHERE id = ? AND firebase_uid = ?
        LIMIT 1
        `,
        [translationId, firebaseUid]
      );

      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Çeviri kaydı bulunamadı",
        });
      }

      const current = rows[0];
      const nextValue = current.is_favorite ? 0 : 1;

      await pool.query(
        `
        UPDATE ${TRANSLATION_TABLE}
        SET is_favorite = ?, updated_at = NOW()
        WHERE id = ? AND firebase_uid = ?
        `,
        [nextValue, translationId, firebaseUid]
      );

      return res.json({
        ok: true,
        translationId,
        isFavorite: !!nextValue,
      });
    }

    if (!originalText || !translatedText) {
      return res.status(400).json({
        ok: false,
        error: "translationId yoksa originalText ve translatedText zorunlu",
      });
    }

    const [foundRows] = await pool.query(
      `
      SELECT id, is_favorite
      FROM ${TRANSLATION_TABLE}
      WHERE firebase_uid = ?
        AND original_text = ?
        AND translated_text = ?
        AND COALESCE(source_language, '') = COALESCE(?, '')
        AND COALESCE(target_language, '') = COALESCE(?, '')
      ORDER BY id DESC
      LIMIT 1
      `,
      [
        firebaseUid,
        originalText,
        translatedText,
        sourceLanguage || "",
        targetLanguage || "",
      ]
    );

    if (foundRows.length) {
      const current = foundRows[0];
      const nextValue = current.is_favorite ? 0 : 1;

      await pool.query(
        `
        UPDATE ${TRANSLATION_TABLE}
        SET is_favorite = ?, updated_at = NOW()
        WHERE id = ? AND firebase_uid = ?
        `,
        [nextValue, current.id, firebaseUid]
      );

      return res.json({
        ok: true,
        translationId: current.id,
        isFavorite: !!nextValue,
      });
    }

    const [insertResult] = await pool.query(
      `
      INSERT INTO ${TRANSLATION_TABLE}
      (
        firebase_uid,
        original_text,
        translated_text,
        source_language,
        target_language,
        is_favorite
      )
      VALUES (?, ?, ?, ?, ?, 1)
      `,
      [
        firebaseUid,
        originalText,
        translatedText,
        sourceLanguage || null,
        targetLanguage || null,
      ]
    );

    return res.json({
      ok: true,
      translationId: insertResult.insertId,
      isFavorite: true,
    });
  } catch (error) {
    console.error("TOGGLE FAVORITE ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Favorite action failed",
    });
  }
};

const getHistory = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid zorunlu",
      });
    }

    const exists = await tableExists(TRANSLATION_TABLE);
    if (!exists) {
      return res.json({
        ok: true,
        history: [],
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        id,
        firebase_uid AS firebaseUid,
        original_text AS originalText,
        translated_text AS translatedText,
        source_language AS sourceLanguage,
        target_language AS targetLanguage,
        is_favorite AS isFavorite,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ${TRANSLATION_TABLE}
      WHERE firebase_uid = ?
      ORDER BY id DESC
      `,
      [firebaseUid]
    );

    return res.json({
      ok: true,
      history: rows.map((item) => ({
        ...item,
        isFavorite: !!item.isFavorite,
      })),
    });
  } catch (error) {
    console.error("GET HISTORY ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "History fetch failed",
    });
  }
};

const getFavorites = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid zorunlu",
      });
    }

    const exists = await tableExists(TRANSLATION_TABLE);
    if (!exists) {
      return res.json({
        ok: true,
        favorites: [],
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        id,
        firebase_uid AS firebaseUid,
        original_text AS originalText,
        translated_text AS translatedText,
        source_language AS sourceLanguage,
        target_language AS targetLanguage,
        is_favorite AS isFavorite,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ${TRANSLATION_TABLE}
      WHERE firebase_uid = ?
        AND is_favorite = 1
      ORDER BY id DESC
      `,
      [firebaseUid]
    );

    return res.json({
      ok: true,
      favorites: rows.map((item) => ({
        ...item,
        isFavorite: !!item.isFavorite,
      })),
    });
  } catch (error) {
    console.error("GET FAVORITES ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Favorites fetch failed",
    });
  }
};

const getFrequentlyUsed = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid zorunlu",
      });
    }

    const exists = await tableExists(TRANSLATION_TABLE);
    if (!exists) {
      return res.json({
        ok: true,
        frequentlyUsed: [],
      });
    }

    const [rows] = await pool.query(
      `
      SELECT
        source_language AS sourceLanguage,
        target_language AS targetLanguage,
        COUNT(*) AS total
      FROM ${TRANSLATION_TABLE}
      WHERE firebase_uid = ?
      GROUP BY source_language, target_language
      ORDER BY total DESC
      LIMIT 10
      `,
      [firebaseUid]
    );

    return res.json({
      ok: true,
      frequentlyUsed: rows,
    });
  } catch (error) {
    console.error("GET FREQUENTLY USED ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Frequently used fetch failed",
    });
  }
};

const clearHistory = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid zorunlu",
      });
    }

    const exists = await tableExists(TRANSLATION_TABLE);
    if (!exists) {
      return res.json({
        ok: true,
        message: `${TRANSLATION_TABLE} tablosu yok, history zaten boş.`,
      });
    }

    await pool.query(
      `
      DELETE FROM ${TRANSLATION_TABLE}
      WHERE firebase_uid = ?
      `,
      [firebaseUid]
    );

    return res.json({
      ok: true,
      message: "History cleared",
    });
  } catch (error) {
    console.error("CLEAR HISTORY ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Clear history failed",
    });
  }
};

const clearFavorites = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid zorunlu",
      });
    }

    const exists = await tableExists(TRANSLATION_TABLE);
    if (!exists) {
      return res.json({
        ok: true,
        message: `${TRANSLATION_TABLE} tablosu yok, favorites zaten boş.`,
      });
    }

    await pool.query(
      `
      UPDATE ${TRANSLATION_TABLE}
      SET is_favorite = 0,
          updated_at = NOW()
      WHERE firebase_uid = ?
      `,
      [firebaseUid]
    );

    return res.json({
      ok: true,
      message: "Favorites cleared",
    });
  } catch (error) {
    console.error("CLEAR FAVORITES ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Clear favorites failed",
    });
  }
};

module.exports = {
  translateText,
  toggleFavorite,
  getHistory,
  getFavorites,
  getFrequentlyUsed,
  clearHistory,
  clearFavorites,
  translatePhoto,
};