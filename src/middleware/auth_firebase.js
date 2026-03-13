const admin = require("../config/firebase");

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

async function firebaseAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer (.+)$/);

    if (!match) {
      return res.status(401).json({
        ok: false,
        message: "Missing Bearer token",
      });
    }

    const decoded = await admin.auth().verifyIdToken(match[1]);

    const rawProvider =
        decoded.firebase?.sign_in_provider ||
        decoded.sign_in_provider ||
        decoded.provider_id ||
        null;

    const provider = normalizeProvider(rawProvider);

    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
      provider,
      rawProvider,
      firebase: decoded.firebase || null,
      decoded,
    };

    console.log("FIREBASE AUTH decoded:", decoded);
    console.log("FIREBASE AUTH provider:", provider);

    next();
  } catch (e) {
    console.error("FIREBASE AUTH ERROR:", e);
    return res.status(401).json({
      ok: false,
      message: "Invalid token",
      error: e.message,
    });
  }
}

module.exports = firebaseAuth;