const express = require("express");
const multer = require("multer");
const router = express.Router();
const pool = require("../config/mysql");
const {
  buildProfilePhotoPath,
  uploadBufferToBunny,
} = require("../services/bunny.service");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str === "" ? null : str;
}

function cleanNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

router.post("/sync", async (req, res) => {
  try {
    const firebase_uid = cleanString(req.body.firebase_uid);
    const email = cleanString(req.body.email);
    const name = cleanString(req.body.name);
    const photo_url = cleanString(req.body.photo_url);
    const provider = cleanString(req.body.provider);

    console.log("SYNC REQUEST BODY:", {
      firebase_uid,
      email,
      name,
      photo_url,
      provider,
    });

    if (!firebase_uid) {
      return res.status(400).json({
        ok: false,
        error: "firebase_uid is required",
      });
    }

    const [existing] = await pool.query(
      `
      SELECT *
      FROM users
      WHERE firebase_uid = ?
      LIMIT 1
      `,
      [firebase_uid]
    );

    if (existing.length > 0) {
      const user = existing[0];

      console.log("SYNC EXISTING USER BEFORE UPDATE:", user);

      const nextEmail = email ?? user.email ?? null;
      const nextName =
        cleanString(user.name) !== null ? cleanString(user.name) : name;
      const nextPhotoUrl =
        cleanString(user.photo_url) !== null
          ? cleanString(user.photo_url)
          : photo_url;
      const nextProvider = provider ?? user.provider ?? null;

      console.log("SYNC NEXT VALUES:", {
        nextEmail,
        nextName,
        nextPhotoUrl,
        nextProvider,
      });

      await pool.query(
        `
        UPDATE users
        SET
          email = ?,
          name = ?,
          photo_url = ?,
          provider = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE firebase_uid = ?
        `,
        [nextEmail, nextName, nextPhotoUrl, nextProvider, firebase_uid]
      );

      const [updatedRows] = await pool.query(
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
        [firebase_uid]
      );

      console.log("SYNC UPDATED USER:", updatedRows[0]);

      return res.json({
        ok: true,
        user: updatedRows[0],
      });
    }

    const [result] = await pool.query(
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
      [firebase_uid, email, name, photo_url, provider]
    );

    const [newRows] = await pool.query(
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
      WHERE id = ?
      LIMIT 1
      `,
      [result.insertId]
    );

    console.log("SYNC NEW USER:", newRows[0]);

    return res.json({
      ok: true,
      user: newRows[0],
    });
  } catch (error) {
    console.error("SYNC USER ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

router.get("/firebase/:firebaseUid", async (req, res) => {
  try {
    const firebaseUid = cleanString(req.params.firebaseUid);

    console.log("GET USER BY FIREBASE UID:", firebaseUid);

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid is required",
      });
    }

    const [rows] = await pool.query(
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
      [firebaseUid]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    return res.json({
      ok: true,
      user: rows[0],
    });
  } catch (error) {
    console.error("GET USER ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

router.post(
  "/firebase/:firebaseUid/photo",
  upload.single("photo"),
  async (req, res) => {
    try {
      const firebaseUid = cleanString(req.params.firebaseUid);

      console.log("UPLOAD PROFILE PHOTO REQUEST FIREBASE UID:", firebaseUid);
      console.log("UPLOAD PROFILE PHOTO FILE EXISTS:", !!req.file);

      if (!firebaseUid) {
        return res.status(400).json({
          ok: false,
          error: "firebaseUid is required",
        });
      }

      if (!req.file || !req.file.buffer) {
        console.log("UPLOAD PROFILE PHOTO ERROR: req.file missing");
        return res.status(400).json({
          ok: false,
          error: "photo file is required",
        });
      }

      const mimeType = cleanString(req.file.mimetype) || "image/jpeg";
      const originalName = cleanString(req.file.originalname) || "profile.jpg";

      console.log("UPLOAD PROFILE PHOTO MIME TYPE:", mimeType);
      console.log("UPLOAD PROFILE PHOTO ORIGINAL NAME:", originalName);
      console.log("UPLOAD PROFILE PHOTO BUFFER SIZE:", req.file.buffer.length);

      const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
      ];

      if (!allowedMimeTypes.includes(mimeType)) {
        console.log("UPLOAD PROFILE PHOTO ERROR: invalid mime type");
        return res.status(400).json({
          ok: false,
          error: "Only jpg, jpeg, png, webp files are allowed",
        });
      }

      const remotePath = buildProfilePhotoPath({
        firebaseUid,
        originalName,
      });

      console.log("UPLOAD PROFILE PHOTO REMOTE PATH:", remotePath);
      console.log("UPLOAD PROFILE PHOTO STARTING BUNNY UPLOAD...");

      const uploadResult = await uploadBufferToBunny({
        buffer: req.file.buffer,
        remotePath,
        contentType: mimeType,
      });

      console.log("UPLOAD PROFILE PHOTO RESULT:", uploadResult);

      return res.json({
        ok: true,
        photo_url: uploadResult.publicUrl,
        path: remotePath,
      });
    } catch (error) {
      console.error("UPLOAD PROFILE PHOTO ERROR:", error);
      return res.status(500).json({
        ok: false,
        error: error.message,
      });
    }
  }
);

router.put("/firebase/:firebaseUid", async (req, res) => {
  try {
    const firebaseUid = cleanString(req.params.firebaseUid);
    const name = cleanString(req.body.name);
    const age = cleanNullableInt(req.body.age);
    const photo_url = cleanString(req.body.photo_url);

    console.log("UPDATE USER REQUEST:", {
      firebaseUid,
      name,
      age,
      photo_url,
    });

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid is required",
      });
    }

    const [existing] = await pool.query(
      `
      SELECT id, firebase_uid, email, name, age, photo_url, provider
      FROM users
      WHERE firebase_uid = ?
      LIMIT 1
      `,
      [firebaseUid]
    );

    if (!existing.length) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    await pool.query(
      `
      UPDATE users
      SET
        name = ?,
        age = ?,
        photo_url = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE firebase_uid = ?
      `,
      [name, age, photo_url, firebaseUid]
    );

    const [rows] = await pool.query(
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
      [firebaseUid]
    );

    console.log("UPDATE USER RESULT:", rows[0]);

    return res.json({
      ok: true,
      user: rows[0],
    });
  } catch (error) {
    console.error("UPDATE USER ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

router.delete("/firebase/:firebaseUid", async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const firebaseUid = cleanString(req.params.firebaseUid);

    console.log("DELETE USER REQUEST FIREBASE UID:", firebaseUid);

    if (!firebaseUid) {
      return res.status(400).json({
        ok: false,
        error: "firebaseUid is required",
      });
    }

    await connection.beginTransaction();

    const [userRows] = await connection.query(
      `
      SELECT id, firebase_uid
      FROM users
      WHERE firebase_uid = ?
      LIMIT 1
      `,
      [firebaseUid]
    );

    if (!userRows.length) {
      await connection.rollback();
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    const userId = userRows[0].id;

    console.log("DELETE USER FOUND:", { userId, firebaseUid });

    const [deleteResult] = await connection.query(
      `
      DELETE FROM users
      WHERE firebase_uid = ?
      `,
      [firebaseUid]
    );

    console.log("DELETE USER RESULT:", deleteResult);

    await connection.commit();

    return res.json({
      ok: true,
      message: "User and all related data deleted successfully",
    });
  } catch (error) {
    await connection.rollback();
    console.error("DELETE USER ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

module.exports = router;