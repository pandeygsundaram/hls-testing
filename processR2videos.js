// processR2Videos.js
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const VideoCompressor = require("./services/videoCompressor");
const HLSChunker = require("./services/hlsChunker");
require("dotenv").config();

const ACCOUNT_ID = process.env.ACCOUNT_ID;
const BUCKET = "simple-storage";
const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY;
const R2_FOLDER = "latent-videos";
const OUTPUT_FOLDER = "processed-videos";
const PROGRESS_FILE = path.join(__dirname, "processing-progress.json");

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

// Progress tracker
class ProgressTracker {
  constructor() {
    this.data = this.load();
  }

  load() {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
    return { videos: {}, lastRun: null, stats: { total: 0, completed: 0, failed: 0 } };
  }

  save() {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(this.data, null, 2));
  }

  initVideo(videoKey) {
    const videoName = path.basename(videoKey, '.mp4');
    if (!this.data.videos[videoName]) {
      this.data.videos[videoName] = {
        videoKey,
        status: 'pending',
        steps: {
          download: 'pending',
          compress_240p: 'pending',
          compress_360p: 'pending',
          compress_480p: 'pending',
          compress_720p: 'pending',
          hls_generation: 'pending',
          upload: 'pending',
          cleanup: 'pending'
        },
        startTime: null,
        endTime: null,
        error: null,
        retryCount: 0
      };
    }
    return videoName;
  }

  updateStep(videoName, step, status, error = null) {
    if (this.data.videos[videoName]) {
      this.data.videos[videoName].steps[step] = status;
      if (error) {
        this.data.videos[videoName].error = error;
      }
      this.save();
    }
  }

  updateStatus(videoName, status, error = null) {
    if (this.data.videos[videoName]) {
      this.data.videos[videoName].status = status;
      if (status === 'processing' && !this.data.videos[videoName].startTime) {
        this.data.videos[videoName].startTime = new Date().toISOString();
      }
      if (status === 'completed' || status === 'failed') {
        this.data.videos[videoName].endTime = new Date().toISOString();
      }
      if (error) {
        this.data.videos[videoName].error = error;
      }
      this.save();
    }
  }

  incrementRetry(videoName) {
    if (this.data.videos[videoName]) {
      this.data.videos[videoName].retryCount++;
      this.save();
    }
  }

  getIncompleteVideos() {
    return Object.entries(this.data.videos)
      .filter(([_, info]) => info.status !== 'completed')
      .map(([name, info]) => info.videoKey);
  }

  getSummary() {
    const videos = Object.values(this.data.videos);
    return {
      total: videos.length,
      completed: videos.filter(v => v.status === 'completed').length,
      failed: videos.filter(v => v.status === 'failed').length,
      processing: videos.filter(v => v.status === 'processing').length,
      pending: videos.filter(v => v.status === 'pending').length
    };
  }

  printReport() {
    console.log('\n📊 PROGRESS REPORT:');
    console.log('='.repeat(60));
    
    const summary = this.getSummary();
    console.log(`Total Videos: ${summary.total}`);
    console.log(`✅ Completed: ${summary.completed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⏳ Processing: ${summary.processing}`);
    console.log(`⏸️  Pending: ${summary.pending}`);
    
    const failed = Object.entries(this.data.videos).filter(([_, v]) => v.status === 'failed');
    if (failed.length > 0) {
      console.log('\n❌ Failed Videos:');
      failed.forEach(([name, info]) => {
        console.log(`  - ${name}`);
        console.log(`    Error: ${info.error}`);
        console.log(`    Last step: ${Object.entries(info.steps).filter(([_, s]) => s === 'completed').pop()?.[0] || 'none'}`);
        console.log(`    Retries: ${info.retryCount}`);
      });
    }
    
    console.log('='.repeat(60));
  }
}

// Download file from R2
async function downloadFromR2(key, localPath, tracker, videoName) {
  console.log(`📥 Downloading: ${key}`);
  tracker.updateStep(videoName, 'download', 'processing');
  
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  const response = await s3.send(command);
  
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await pipeline(response.Body, fs.createWriteStream(localPath));
  console.log(`✅ Downloaded: ${localPath}`);
  tracker.updateStep(videoName, 'download', 'completed');
  return localPath;
}

// Upload file to R2
async function uploadToR2(filePath, key) {
  const stats = fs.statSync(filePath);
  const totalSize = stats.size;
  
  const contentType = key.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 
                      key.endsWith('.ts') ? 'video/mp2t' : 
                      'application/octet-stream';

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    },
  });

  upload.on("httpUploadProgress", (progress) => {
    const percentage = (progress.loaded / totalSize) * 100;
    process.stdout.write(`\r📤 Uploading ${path.basename(key)} - ${percentage.toFixed(1)}%`);
  });

  await upload.done();
  console.log(`\r✅ Uploaded: ${key} (${(totalSize / 1e6).toFixed(2)} MB)`);
}

// List all videos in R2 folder
async function listR2Videos() {
  console.log(`🔍 Listing videos in ${R2_FOLDER}/...`);
  
  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: R2_FOLDER + "/",
  });

  const response = await s3.send(command);
  const videos = (response.Contents || [])
    .filter(obj => obj.Key.endsWith('.mp4'))
    .map(obj => obj.Key);

  console.log(`Found ${videos.length} videos`);
  return videos;
}

// Process single video with tracking
async function processSingleVideo(videoKey, videoCompressor, hlsChunker, tracker) {
  const videoName = tracker.initVideo(videoKey);
  tracker.updateStatus(videoName, 'processing');
  
  console.log(`\n🎬 Processing: ${videoName}`);
  
  const tempDir = path.join(__dirname, 'temp', `${videoName}_${Date.now()}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // 1. Download from R2
    const localVideoPath = path.join(tempDir, 'original.mp4');
    await downloadFromR2(videoKey, localVideoPath, tracker, videoName);

    // 2. Compress to multiple qualities
    console.log(`🔄 Compressing video...`);
    const originalSize = videoCompressor.getFileSize(localVideoPath);
    console.log(`Original size: ${originalSize}MB`);

    const compressedVideos = [];
    const qualities = [
      { label: '240p', crf: 30, height: 240 },
      { label: '360p', crf: 28, height: 360 },
      { label: '480p', crf: 26, height: 480 },
      { label: '720p', crf: 24, height: 720 },
    ];

    for (const quality of qualities) {
      tracker.updateStep(videoName, `compress_${quality.label}`, 'processing');
      const outputPath = path.join(tempDir, `${quality.label}.mp4`);
      const result = await videoCompressor.compressToQuality(localVideoPath, quality, outputPath);
      compressedVideos.push(result);
      tracker.updateStep(videoName, `compress_${quality.label}`, 'completed');
    }

    // 3. Generate HLS chunks
    console.log(`📦 Generating HLS chunks...`);
    tracker.updateStep(videoName, 'hls_generation', 'processing');
    const hlsResult = await hlsChunker.processToHLS(compressedVideos, tempDir);
    tracker.updateStep(videoName, 'hls_generation', 'completed');

    // 4. Upload HLS files to R2
    console.log(`☁️ Uploading to R2...`);
    tracker.updateStep(videoName, 'upload', 'processing');
    const hlsFiles = hlsChunker.getAllHLSFiles(hlsResult.hlsDirectory);
    
    for (const file of hlsFiles) {
      const r2Key = `${OUTPUT_FOLDER}/${videoName}/${file.filename}`;
      await uploadToR2(file.path, r2Key);
    }
    tracker.updateStep(videoName, 'upload', 'completed');

    // 5. Cleanup temp files
    tracker.updateStep(videoName, 'cleanup', 'processing');
    videoCompressor.cleanup(tempDir);
    tracker.updateStep(videoName, 'cleanup', 'completed');

    console.log(`✨ Successfully processed: ${videoName}`);
    tracker.updateStatus(videoName, 'completed');
    
    return {
      success: true,
      videoName,
      qualities: compressedVideos.map(v => v.quality),
      hlsFiles: hlsFiles.length
    };

  } catch (error) {
    console.error(`❌ Failed to process ${videoName}:`, error.message);
    tracker.updateStatus(videoName, 'failed', error.message);
    
    // Cleanup on error
    if (fs.existsSync(tempDir)) {
      tracker.updateStep(videoName, 'cleanup', 'processing');
      fs.rmSync(tempDir, { recursive: true, force: true });
      tracker.updateStep(videoName, 'cleanup', 'completed');
    }
    
    return {
      success: false,
      videoName,
      error: error.message
    };
  }
}

// Main function
(async () => {
  console.log(`🚀 Starting R2 Video Processing Pipeline\n`);

  const tracker = new ProgressTracker();
  const videoCompressor = new VideoCompressor();
  const hlsChunker = new HLSChunker();

  try {
    // Check FFmpeg
    videoCompressor.checkFFmpeg();
    console.log(`✅ FFmpeg available\n`);

    // List all videos in R2
    const videoKeys = await listR2Videos();
    
    if (videoKeys.length === 0) {
      console.log(`❌ No videos found in ${R2_FOLDER}/`);
      process.exit(1);
    }

    // Check for incomplete videos
    const incompleteVideos = tracker.getIncompleteVideos();
    console.log(`\n📋 Found ${incompleteVideos.length} incomplete videos from previous runs\n`);

    // Process each video
    for (let i = 0; i < videoKeys.length; i++) {
      console.log(`\n📊 Progress: ${i + 1}/${videoKeys.length}`);
      await processSingleVideo(videoKeys[i], videoCompressor, hlsChunker, tracker);
    }

    // Final report
    tracker.data.lastRun = new Date().toISOString();
    tracker.save();
    tracker.printReport();

    console.log(`\n💾 Progress saved to: ${PROGRESS_FILE}`);
    console.log(`\n🎉 All done!`);

  } catch (error) {
    console.error(`❌ Fatal error:`, error.message);
    tracker.printReport();
    process.exit(1);
  }
})();