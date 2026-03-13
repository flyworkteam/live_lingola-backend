const pool = require("../config/mysql");

function normalizeProvider(rawProvider) {
  if (!rawProvider) return null;

  switch (rawProvider) {
    case "google.com":
      return "google";
    case "apple.com":
      return "apple";
    case "facebook.com":
      return "facebook";
    case "password":
      return "email";
    default:
      return rawProvider;
  }
}

function extractProvider(user) {
  if (!user) return null;

  const provider =
    user.firebase?.sign_in_provider ||
    user.sign_in_provider ||
    user.provider_id ||
    null;

  return normalizeProvider(provider);
}

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str === "" ? null : str;
}

async function me(req, res) {
  try {
    const { uid, email, name, picture } = req.user || {};

    if (!uid) {
      return res.status(400).json({
        ok: false,
        message: "Missing uid in token",
      });
    }

    const provider = extractProvider(req.user);
    const cleanEmail = cleanString(email);
    const cleanName = cleanString(name);
    const cleanPicture = cleanString(picture);
    const cleanProvider = cleanString(provider);

    console.log("AUTH /me req.user:", req.user);
    console.log("AUTH /me provider:", provider);

    // Önce kullanıcı var mı bak
    const [existingRows] = await pool.execute(
      `
      SELECT
        id,
        firebase_uid,
        email,
        name,
        age,
        photo_url,
        provider,
        usage_purpose,
        from_language,
        to_language,
        used_ai_before,
        desired_feature,
        created_at,
        updated_at
      FROM users
      WHERE firebase_uid = ?
      LIMIT 1
      `,
      [uid]
    );

    if (!existingRows.length) {
      // İlk kez giriş yapıyorsa insert et
      await pool.execute(
        `
        INSERT INTO users (
          firebase_uid,
          email,
          name,
          photo_url,
          provider
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [uid, cleanEmail, cleanName, cleanPicture, cleanProvider]
      );
    } else {
      // Varsa sadece güvenli alanları güncelle
      // name ve photo_url custom profil verisi olduğu için burada ezmiyoruz
      await pool.execute(
        `
        UPDATE users
        SET
          email = ?,
          provider = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE firebase_uid = ?
        `,
        [
          cleanEmail ?? existingRows[0].email ?? null,
          cleanProvider ?? existingRows[0].provider ?? null,
          uid,
        ]
      );
    }

    const [rows] = await pool.execute(
      `
      SELECT
        id,
        firebase_uid,
        email,
        name,
        age,
        photo_url,
        provider,
        usage_purpose,
        from_language,
        to_language,
        used_ai_before,
        desired_feature,
        created_at,
        updated_at
      FROM users
      WHERE firebase_uid = ?
      LIMIT 1
      `,
      [uid]
    );

    return res.json({
      ok: true,
      user: rows[0],
    });
  } catch (e) {
    console.error("AUTH /me ERROR:", e);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: e.message,
    });
  }
}

async function savePreferences(req, res) {
  try {
    const { uid } = req.user || {};

    if (!uid) {
      return res.status(400).json({
        ok: false,
        message: "Missing uid in token",
      });
    }

    const {
      usagePurpose,
      fromLanguage,
      toLanguage,
      usedAiBefore,
      desiredFeature,
    } = req.body || {};

    await pool.execute(
      `
      UPDATE users
      SET
        usage_purpose = ?,
        from_language = ?,
        to_language = ?,
        used_ai_before = ?,
        desired_feature = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE firebase_uid = ?
      `,
      [
        cleanString(usagePurpose),
        cleanString(fromLanguage),
        cleanString(toLanguage),
        typeof usedAiBefore === "boolean" ? usedAiBefore : null,
        cleanString(desiredFeature),
        uid,
      ]
    );

    const [rows] = await pool.execute(
      `
      SELECT
        id,
        firebase_uid,
        email,
        name,
        age,
        photo_url,
        provider,
        usage_purpose,
        from_language,
        to_language,
        used_ai_before,
        desired_feature,
        created_at,
        updated_at
      FROM users
      WHERE firebase_uid = ?
      LIMIT 1
      `,
      [uid]
    );

    return res.json({
      ok: true,
      user: rows[0],
    });
  } catch (e) {
    console.error("AUTH /preferences ERROR:", e);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: e.message,
    });
  }
}

module.exports = {
  me,
  savePreferences,
};