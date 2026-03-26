const path = require("path");
const https = require("https");

function getBunnyStorageHost() {
  const region = String(process.env.BUNNY_STORAGE_REGION || "de")
    .trim()
    .toLowerCase();

  switch (region) {
    case "de":
      return "storage.bunnycdn.com";
    case "uk":
      return "uk.storage.bunnycdn.com";
    case "ny":
      return "ny.storage.bunnycdn.com";
    case "la":
      return "la.storage.bunnycdn.com";
    case "sg":
      return "sg.storage.bunnycdn.com";
    case "se":
      return "se.storage.bunnycdn.com";
    case "br":
      return "br.storage.bunnycdn.com";
    case "jh":
      return "jh.storage.bunnycdn.com";
    case "syd":
      return "syd.storage.bunnycdn.com";
    default:
      return "storage.bunnycdn.com";
  }
}

function sanitizeFileName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildProfilePhotoPath({ firebaseUid, originalName }) {
  const rawExt = path.extname(originalName || "").toLowerCase();
  const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(rawExt)
    ? rawExt
    : ".jpg";

  const fileName = sanitizeFileName(
    `profile_${firebaseUid}_${Date.now()}${ext}`
  );

  return `profile_photos/${firebaseUid}/${fileName}`;
}

function uploadBufferToBunny({ buffer, remotePath, contentType }) {
  return new Promise((resolve, reject) => {
    const storageZone = process.env.BUNNY_STORAGE_ZONE;
    const accessKey = process.env.BUNNY_STORAGE_PASSWORD;
    const cdnHostname = process.env.BUNNY_CDN_HOSTNAME;

    if (!storageZone) {
      return reject(new Error("BUNNY_STORAGE_ZONE is missing"));
    }

    if (!accessKey) {
      return reject(new Error("BUNNY_STORAGE_PASSWORD is missing"));
    }

    if (!cdnHostname) {
      return reject(new Error("BUNNY_CDN_HOSTNAME is missing"));
    }

    const hostname = getBunnyStorageHost();
    const requestPath = `/${storageZone}/${remotePath}`;

    const req = https.request(
      {
        hostname,
        port: 443,
        path: requestPath,
        method: "PUT",
        headers: {
          AccessKey: accessKey,
          "Content-Type": contentType || "application/octet-stream",
          "Content-Length": buffer.length,
        },
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk.toString();
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve({
              ok: true,
              statusCode: res.statusCode,
              body,
              publicUrl: `https://${cdnHostname}/${remotePath}`,
            });
          }

          return reject(
            new Error(`Bunny upload failed: ${res.statusCode} ${body}`)
          );
        });
      }
    );

    req.on("error", (error) => reject(error));
    req.write(buffer);
    req.end();
  });
}

module.exports = {
  buildProfilePhotoPath,
  uploadBufferToBunny,
};