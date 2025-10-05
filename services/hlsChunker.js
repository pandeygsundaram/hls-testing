// services/hlsChunker.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class HLSChunker {
  constructor() {
    this.segmentDuration = 6; // seconds per chunk
    this.bandwidthMap = {
      '240p': 500000,  // 0.5 Mbps
      '360p': 800000,  // 0.8 Mbps
      '480p': 1200000, // 1.2 Mbps
      '720p': 2500000  // 2.5 Mbps
    };
  }

  // Get actual resolution from video file
  getVideoResolution(videoPath) {
    try {
      const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`;
      const output = execSync(command, { encoding: 'utf8' }).trim();
      return output; // Returns "1920x1080" format
    } catch (error) {
      console.error(`Failed to get resolution for ${videoPath}:`, error.message);
      return null;
    }
  }

  // Generate HLS chunks for a single quality
  async generateHLSForQuality(videoPath, quality, outputDir) {
    const hlsDir = path.join(outputDir, 'hls');
    if (!fs.existsSync(hlsDir)) {
      fs.mkdirSync(hlsDir, { recursive: true });
    }

    const playlistPath = path.join(hlsDir, `${quality}.m3u8`);
    const segmentPattern = path.join(hlsDir, `${quality}_%03d.ts`);

    console.log(`Generating HLS chunks for ${quality}...`);

    const command = `ffmpeg -i "${videoPath}" \
      -c:v copy \
      -c:a copy \
      -hls_time ${this.segmentDuration} \
      -hls_playlist_type vod \
      -hls_segment_type mpegts \
      -hls_segment_filename "${segmentPattern}" \
      -f hls \
      "${playlistPath}"`;

    try {
      execSync(command, { stdio: 'pipe' });

      // Get all segment files
      const segments = fs.readdirSync(hlsDir)
        .filter(f => f.startsWith(quality) && f.endsWith('.ts'))
        .map(f => path.join(hlsDir, f));

      // Get actual resolution from the video
      const resolution = this.getVideoResolution(videoPath);

      console.log(`HLS chunks created for ${quality}: ${segments.length} segments`);

      return {
        quality,
        playlistPath,
        segments,
        segmentCount: segments.length,
        resolution // Real resolution from video file
      };
    } catch (error) {
      console.error(`Failed to generate HLS for ${quality}:`, error.message);
      throw error;
    }
  }

  // Create master playlist
  createMasterPlaylist(hlsResults, outputDir) {
    const hlsDir = path.join(outputDir, 'hls');
    const masterPlaylistPath = path.join(hlsDir, 'master.m3u8');
    let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

    hlsResults.forEach(result => {
      const bandwidth = this.bandwidthMap[result.quality] || 800000;
      const resolution = result.resolution || '640x360'; // Use real resolution

      masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
      masterContent += `${result.quality}.m3u8\n`;
    });

    fs.writeFileSync(masterPlaylistPath, masterContent);
    console.log(`Master playlist created: ${masterPlaylistPath}`);
    return masterPlaylistPath;
  }

  // Process all compressed videos to HLS
  async processToHLS(compressedVideos, workDir) {
    console.log('Starting HLS chunking process...');
    const hlsResults = [];

    for (const video of compressedVideos) {
      const hlsResult = await this.generateHLSForQuality(
        video.path,
        video.quality,
        workDir
      );
      hlsResults.push(hlsResult);
    }

    // Create master playlist
    const masterPlaylistPath = this.createMasterPlaylist(hlsResults, workDir);

    return {
      success: true,
      masterPlaylistPath,
      hlsResults,
      hlsDirectory: path.join(workDir, 'hls')
    };
  }

  // Get all HLS files for upload
  getAllHLSFiles(hlsDirectory) {
    const files = [];
    if (!fs.existsSync(hlsDirectory)) {
      throw new Error(`HLS directory not found: ${hlsDirectory}`);
    }

    const allFiles = fs.readdirSync(hlsDirectory);

    allFiles.forEach(filename => {
      const filePath = path.join(hlsDirectory, filename);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        files.push({
          filename,
          path: filePath,
          size: stats.size,
          type: filename.endsWith('.m3u8') ? 'playlist' : 'segment'
        });
      }
    });

    console.log(`Found ${files.length} HLS files for upload`);
    return files;
  }
}

module.exports = HLSChunker;