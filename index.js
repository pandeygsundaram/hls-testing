const express = require("express");
const path = require("path");
const fs = require("fs");


const app = express();
const PORT = 8080;

app.use("/videos", express.static(path.join(__dirname, "hls_output")));

app.get("/api/videos", (req, res) => {
  const basePath = path.join(__dirname, "hls_output");
  const folders = fs.readdirSync(basePath).filter(f => fs.statSync(path.join(basePath, f)).isDirectory());

  const videos = folders.map(folder => ({
    id: folder,
    masterUrl: `http://${req.hostname}:${PORT}/videos/${folder}/hls/master.m3u8`,
    lowResUrl: `http://${req.hostname}:${PORT}/videos/${folder}/hls/240p.m3u8`,
    mediumResUrl: `http://${req.hostname}:${PORT}/videos/${folder}/hls/480p.m3u8`,
    highResUrl: `http://${req.hostname}:${PORT}/videos/${folder}/hls/720p.m3u8`
  }));

  res.json(videos);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});