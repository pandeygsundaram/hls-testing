// viewProgress.js
const fs = require('fs');
const path = require('path');

const PROGRESS_FILE = path.join(__dirname, 'processing-progress.json');

function formatDuration(start, end) {
  if (!start || !end) return 'N/A';
  const diff = new Date(end) - new Date(start);
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTime(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString();
}

function getStepProgress(steps) {
  const total = Object.keys(steps).length;
  const completed = Object.values(steps).filter(s => s === 'completed').length;
  const processing = Object.values(steps).filter(s => s === 'processing').length;
  return { total, completed, processing, percentage: ((completed / total) * 100).toFixed(0) };
}

function viewProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    console.log('❌ No progress file found. Run the processing script first.\n');
    return;
  }

  const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  const videos = Object.entries(data.videos);

  console.clear();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          📊 VIDEO PROCESSING PROGRESS TRACKER              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Overall stats
  const stats = {
    total: videos.length,
    completed: videos.filter(([_, v]) => v.status === 'completed').length,
    failed: videos.filter(([_, v]) => v.status === 'failed').length,
    processing: videos.filter(([_, v]) => v.status === 'processing').length,
    pending: videos.filter(([_, v]) => v.status === 'pending').length
  };

  console.log('📈 OVERALL SUMMARY:');
  console.log('─'.repeat(60));
  console.log(`Total Videos:      ${stats.total}`);
  console.log(`✅ Completed:      ${stats.completed} (${((stats.completed/stats.total)*100).toFixed(0)}%)`);
  console.log(`❌ Failed:         ${stats.failed}`);
  console.log(`⏳ Processing:     ${stats.processing}`);
  console.log(`⏸️  Pending:        ${stats.pending}`);
  console.log(`Last Run:         ${formatTime(data.lastRun)}`);
  console.log('─'.repeat(60));

  // Detailed video status
  console.log('\n📹 VIDEO DETAILS:\n');

  videos.forEach(([name, info]) => {
    const stepProgress = getStepProgress(info.steps);
    const statusIcon = info.status === 'completed' ? '✅' : 
                       info.status === 'failed' ? '❌' : 
                       info.status === 'processing' ? '⏳' : '⏸️';

    console.log(`${statusIcon} ${name}`);
    console.log(`   Status: ${info.status.toUpperCase()}`);
    console.log(`   Progress: ${stepProgress.completed}/${stepProgress.total} steps (${stepProgress.percentage}%)`);
    
    if (info.status === 'processing' || info.status === 'failed') {
      console.log(`   Steps:`);
      Object.entries(info.steps).forEach(([step, status]) => {
        const icon = status === 'completed' ? '✓' : 
                     status === 'processing' ? '►' : 
                     status === 'failed' ? '✗' : '○';
        console.log(`     ${icon} ${step}: ${status}`);
      });
    }

    if (info.startTime) {
      console.log(`   Started: ${formatTime(info.startTime)}`);
    }
    if (info.endTime) {
      console.log(`   Duration: ${formatDuration(info.startTime, info.endTime)}`);
    }
    if (info.error) {
      console.log(`   Error: ${info.error}`);
    }
    if (info.retryCount > 0) {
      console.log(`   Retries: ${info.retryCount}`);
    }
    console.log('');
  });

  // Failed videos summary
  const failedVideos = videos.filter(([_, v]) => v.status === 'failed');
  if (failedVideos.length > 0) {
    console.log('─'.repeat(60));
    console.log('❌ FAILED VIDEOS NEED ATTENTION:\n');
    failedVideos.forEach(([name, info]) => {
      const lastCompleted = Object.entries(info.steps)
        .filter(([_, s]) => s === 'completed')
        .map(([step, _]) => step)
        .pop() || 'none';
      
      console.log(`• ${name}`);
      console.log(`  Last completed step: ${lastCompleted}`);
      console.log(`  Error: ${info.error}`);
      console.log('');
    });
  }

  // In progress videos
  const processingVideos = videos.filter(([_, v]) => v.status === 'processing');
  if (processingVideos.length > 0) {
    console.log('─'.repeat(60));
    console.log('⏳ CURRENTLY PROCESSING:\n');
    processingVideos.forEach(([name, info]) => {
      const currentStep = Object.entries(info.steps)
        .find(([_, s]) => s === 'processing');
      
      console.log(`• ${name}`);
      if (currentStep) {
        console.log(`  Current step: ${currentStep[0]}`);
      }
      console.log('');
    });
  }

  console.log('─'.repeat(60));
  console.log(`\n💾 Progress file: ${PROGRESS_FILE}\n`);
}

// Auto-refresh mode
const args = process.argv.slice(2);
if (args.includes('--watch') || args.includes('-w')) {
  console.log('👀 Watch mode enabled - refreshing every 3 seconds...\n');
  console.log('Press Ctrl+C to exit\n');
  
  viewProgress();
  setInterval(() => {
    viewProgress();
  }, 3000);
} else {
  viewProgress();
  console.log('💡 Tip: Use --watch or -w flag to auto-refresh every 3 seconds\n');
}