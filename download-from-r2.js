import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { pipeline } from "stream";
import { promisify } from "util";
dotenv.config();

const streamPipeline = promisify(pipeline);

const ACCOUNT_ID = process.env.ACCOUNT_ID;
const BUCKET = "simple-storage";
const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY;
const FILE_KEY = "hls_output.zip"; // key in bucket
const FILE_PATH = path.resolve("hls_output.zip"); // where to save locally

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

// --- DOWNLOAD FUNCTION ---
async function download() {
  console.log(`Downloading "${FILE_KEY}" from bucket "${BUCKET}"...`);
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: FILE_KEY,
  });

  try {
    const response = await s3.send(command);
    await streamPipeline(response.Body, fs.createWriteStream(FILE_PATH));
    console.log(`✅ Downloaded "${FILE_KEY}" as "${FILE_PATH}"`);
  } catch (err) {
    console.error("❌ Download failed:", err);
  }
}

download();
