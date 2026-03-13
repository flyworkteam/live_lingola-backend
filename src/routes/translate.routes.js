const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload.middleware");

const {
  translateText,
  toggleFavorite,
  getHistory,
  getFavorites,
  getFrequentlyUsed,
  clearHistory,
  clearFavorites,
  translatePhoto,
} = require("../controllers/translate.controller");

router.post("/text", translateText);
router.post("/photo", upload.single("image"), translatePhoto);
router.post("/favorite", toggleFavorite);

router.get("/history/:firebaseUid", getHistory);
router.get("/favorites/:firebaseUid", getFavorites);
router.get("/frequently-used/:firebaseUid", getFrequentlyUsed);

router.delete("/history/:firebaseUid", clearHistory);
router.delete("/favorites/:firebaseUid", clearFavorites);

module.exports = router;