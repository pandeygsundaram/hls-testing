import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import readline from "readline";

dotenv.config();

const ACCOUNT_ID = process.env.ACCOUNT_ID;
const BUCKET = "simple-storage";
const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY;

const LOCAL_FOLDER = path.join(process.cwd(), "videos");
const R2_FOLDER = "latent-videos";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

function printProgressBar(percentage, filename) {
  const width = 40;
  const filled = Math.round((percentage / 100) * width);
  const bar = "█".repeat(filled) + "-".repeat(width - filled);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(
    `📤 Uploading ${filename} |${bar}| ${percentage.toFixed(1)}%`
  );
}

async function uploadFile(filePath, keyName) {
  const stats = fs.statSync(filePath);
  const totalSize = stats.size;

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: keyName,
      Body: fs.createReadStream(filePath),
      ContentType: "video/mp4",
    },
  });

  upload.on("httpUploadProgress", (progress) => {
    const percentage = (progress.loaded / totalSize) * 100;
    printProgressBar(percentage, path.basename(filePath));
  });

  await upload.done();
  readline.cursorTo(process.stdout, 0);
  console.log(`✅ Uploaded ${keyName} (${(totalSize / 1e6).toFixed(2)} MB)`);
}

(async () => {
  if (!fs.existsSync(LOCAL_FOLDER)) {
    console.error("❌ Folder 'videos/' not found.");
    process.exit(1);
  }

  const files = fs.readdirSync(LOCAL_FOLDER).filter((f) => f.endsWith(".mp4"));

  if (files.length === 0) {
    console.error("❌ No .mp4 files found in videos/ folder.");
    process.exit(1);
  }

  console.log(`🚀 Uploading ${files.length} videos to R2 under '${R2_FOLDER}/'...\n`);

  for (const file of files) {
    const filePath = path.join(LOCAL_FOLDER, file);
    const keyName = `${R2_FOLDER}/${file}`;
    try {
      await uploadFile(filePath, keyName);
    } catch (err) {
      console.error(`❌ Failed to upload ${file}:`, err.message);
    }
  }

  console.log("\n🎉 All uploads complete!");
})();
