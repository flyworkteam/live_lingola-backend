const express = require("express");
const authFirebase = require("../middleware/auth_firebase");
const { me, savePreferences } = require("../controllers/auth.controller");

const router = express.Router();

router.get("/me", authFirebase, me);
router.post("/preferences", authFirebase, savePreferences);

module.exports = router;