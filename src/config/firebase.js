const admin = require("firebase-admin");
const path = require("path");

const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!p) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH missing");

const serviceAccount = require(path.resolve(p));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
