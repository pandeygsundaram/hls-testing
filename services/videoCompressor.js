// services/videoCompressor.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');


class VideoCompressor {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp');
    this.qualities = [
      { label: '240p', crf: 30, height: 240 },
      { label: '360p', crf: 28, height: 360 },
      { label: '480p', crf: 26, height: 480 },
    ];
    
    this.ensureTempDir();
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  // Download video from URL
  async downloadVideo(videoUrl, outputPath) {
    console.log(`Downloading video from: ${videoUrl}`);
    
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputPath);
      const request = videoUrl.startsWith('https') ? https : http;
      
      request.get(videoUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          console.log(`Video downloaded to: ${outputPath}`);
          resolve(outputPath);
        });
        
        file.on('error', (err) => {
          fs.unlink(outputPath, () => {});
          reject(err);
        });
      }).on('error', reject);
    });
  }

  // Get file size in MB
  getFileSize(filePath) {
    const stats = fs.statSync(filePath);
    return (stats.size / (1024 * 1024)).toFixed(2);
  }

  // Check if FFmpeg is available
  checkFFmpeg() {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      return true;
    } catch {
      throw new Error('FFmpeg not found. Please install FFmpeg.');
    }
  }

  // Compress video to specific quality
  async compressToQuality(inputPath, quality, outputPath) {
    this.checkFFmpeg();
    
    console.log(`Compressing to ${quality.label}...`);
    
    // This scale filter keeps aspect ratio automatically
    // -1 means "calculate this to maintain aspect ratio"
    const command = `ffmpeg -i "${inputPath}" \
      -c:v libx264 \
      -crf ${quality.crf} \
      -preset medium \
      -c:a aac \
      -b:a 128k \
      -vf "scale=-2:${quality.height}" \
      -movflags +faststart \
      -y "${outputPath}"`;

    try {
      execSync(command, { stdio: 'pipe' });
      
      const compressedSize = this.getFileSize(outputPath);
      console.log(`${quality.label} compression complete - Size: ${compressedSize}MB`);
      
      return {
        quality: quality.label,
        path: outputPath,
        size: parseFloat(compressedSize)
      };
    } catch (error) {
      console.error(`Failed to compress to ${quality.label}:`, error.message);
      throw error;
    }
  }

  // Main compression function
  async compressVideo(videoUrl, videoId) {
    const workDir = path.join(this.tempDir, `${videoId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    try {
      // Download original video
      const originalPath = path.join(workDir, 'original.mp4');
      await this.downloadVideo(videoUrl, originalPath);
      
      const originalSize = this.getFileSize(originalPath);
      console.log(`Original video size: ${originalSize}MB`);

      // Compress to all qualities
      const compressedVideos = [];
      
      for (const quality of this.qualities) {
        const outputPath = path.join(workDir, `${quality.label}.mp4`);
        const result = await this.compressToQuality(originalPath, quality, outputPath);
        compressedVideos.push(result);
      }

      return {
        success: true,
        originalPath,
        originalSize: parseFloat(originalSize),
        compressedVideos,
        workDir
      };

    } catch (error) {
      console.error('Video compression failed:', error);
      throw error;
    }
  }

  // Cleanup temporary files
  cleanup(workDir) {
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
        console.log(`Cleaned up temp directory: ${workDir}`);
      }
    } catch (error) {
      console.warn(`Failed to cleanup ${workDir}:`, error.message);
    }
  }
}

module.exports = VideoCompressor;