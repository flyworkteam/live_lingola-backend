const express = require("express");
const router = express.Router();
const pool = require("../config/mysql");
const { sendPushToExternalUser } = require("../services/onesignal.service");

/*
Bildirim aç / kapat
*/
router.post("/toggle", async (req, res) => {
  try {
    const { userId, enabled } = req.body;

    if (userId === undefined || enabled === undefined) {
      return res.status(400).json({
        ok: false,
        error: "userId ve enabled gerekli",
      });
    }

    await pool.query(
      "UPDATE users SET notifications_enabled = ? WHERE id = ?",
      [enabled ? 1 : 0, userId]
    );

    res.json({
      ok: true,
      message: "Bildirim tercihi güncellendi",
    });
  } catch (error) {
    console.error("TOGGLE ERROR:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/*
Test bildirimi gönder
Body:
{
  "userId": 1
}
*/
router.post("/test", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: "userId gerekli",
      });
    }

    const [rows] = await pool.query(
      "SELECT id, notifications_enabled FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    const user = rows[0];

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Kullanıcı bulunamadı",
      });
    }

    if (!user.notifications_enabled) {
      return res.status(400).json({
        ok: false,
        error: "Kullanıcının bildirimleri kapalı",
      });
    }

    const result = await sendPushToExternalUser({
      externalId: `user_${userId}`,
      title: "Live Lingola",
      body: "OneSignal test bildirimi başarıyla gönderildi.",
    });

    res.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("ONESIGNAL TEST ERROR:", error);

    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

module.exports = router;