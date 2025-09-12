// uploadFromDrive.js
import fetch from "node-fetch";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

const ACCOUNT_ID = process.env.ACCOUNT_ID;
const BUCKET = "simple-storage";
const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY;
const DRIVE_LINKS = process.env.DRIVE_LINKS; // comma-separated list

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY
  }
});

// extract drive file id
function getDriveId(url) {
  const match = url.match(/\/d\/([^/]+)/);
  return match ? match[1] : null;
}

// upload single file
async function uploadDriveFile(driveUrl, fileName) {
  const fileId = getDriveId(driveUrl);
  if (!fileId) throw new Error(`Invalid drive URL: ${driveUrl}`);

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  console.log(`⬇️ Downloading from ${downloadUrl}`);

  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Drive fetch failed: ${response.status}`);

  const key = fileName || `${fileId}.mp4`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: response.body, // stream directly
    ContentType: "video/mp4"
  });

  await s3.send(command);
  const r2Url = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}`;
  console.log(`✅ Uploaded: ${r2Url}`);
}

// --- main ---
(async () => {
  if (!DRIVE_LINKS) {
    console.error("❌ No DRIVE_LINKS found in .env");
    process.exit(1);
  }

  const links = DRIVE_LINKS.split(",").map(l => l.trim());

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const name = `episode-${i + 1}.mp4`; // custom naming
    try {
      await uploadDriveFile(link, name);
    } catch (err) {
      console.error(`❌ Failed for ${link}:`, err.message);
    }
  }
})();
