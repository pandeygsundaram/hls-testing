import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();


const ACCOUNT_ID = process.env.ACCOUNT_ID;
const BUCKET = "simple-storage";
const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY;
const FILE_PATH = path.resolve("hls_output.zip"); // or full path to your zip
const FILE_KEY = "hls_output.zip"; // how it'll appear in R2


console.log(ACCOUNT_ID)
console.log(ACCESS_KEY_ID)
console.log(SECRET_ACCESS_KEY)


const s3 = new S3Client({
  region: "auto", // R2 ignores region but field is required
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY
  }
});

// --- UPLOAD FUNCTION ---
async function upload() {
  try {
    // 1. Check if file already exists
    console.log(`Checking if "${FILE_KEY}" already exists...`);
    await s3.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: FILE_KEY
    }));
    console.log(`⚠️ File "${FILE_KEY}" already exists in bucket "${BUCKET}". Skipping upload.`);
    return;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      console.log(`File does not exist in bucket. Proceeding with upload...`);
    } else {
      console.error("Error checking file:", err);
      return;
    }
  }

  // 2. Perform upload
  const fileStream = fs.createReadStream(FILE_PATH);

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: FILE_KEY,
    Body: fileStream,
    ContentType: "application/zip"
  });

  try {
    await s3.send(command);
    console.log(`✅ Uploaded "${FILE_PATH}" to bucket "${BUCKET}" as "${FILE_KEY}"`);
  } catch (err) {
    console.error("❌ Upload failed:", err);
  }
}

upload();