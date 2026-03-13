const express = require("express");
const router = express.Router();
const pool = require("../config/mysql");

/*
PRO status
GET /subscription/status/:userId
*/
router.get("/status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const [rows] = await pool.query(
      "SELECT is_pro FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "User not found",
      });
    }

    res.json({
      ok: true,
      isPro: rows[0].is_pro === 1,
    });
  } catch (error) {
    console.error("PRO STATUS ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/*
Activate PRO
POST /subscription/activate
Body: { "userId": 1 }
*/
router.post("/activate", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: "userId gerekli",
      });
    }

    await pool.query(
      "UPDATE users SET is_pro = 1 WHERE id = ?",
      [userId]
    );

    res.json({
      ok: true,
      message: "User upgraded to PRO",
    });
  } catch (error) {
    console.error("ACTIVATE PRO ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

/*
Deactivate PRO
POST /subscription/deactivate
Body: { "userId": 1 }
*/
router.post("/deactivate", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: "userId gerekli",
      });
    }

    await pool.query(
      "UPDATE users SET is_pro = 0 WHERE id = ?",
      [userId]
    );

    res.json({
      ok: true,
      message: "User downgraded from PRO",
    });
  } catch (error) {
    console.error("DEACTIVATE PRO ERROR:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

module.exports = router;