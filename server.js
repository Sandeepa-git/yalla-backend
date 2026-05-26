const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url;
  
  // API Route to Scrape Live
  if (url === '/api/scrape') {
    console.log('[SERVER] Scrape request received, running generator...');
    exec('node generator.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`[SERVER] Scrape error: ${error.message}`);
        // If live scraping fails, try offline scrape with fallback content
        console.log('[SERVER] Live scrape failed, attempting local fallback scrape...');
        exec('node generator.js --local content.md', (fbError, fbStdout, fbStderr) => {
          if (fbError) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: fbError.message }));
            return;
          }
          sendScrapeResponse(res, fbStdout, true);
        });
        return;
      }
      sendScrapeResponse(res, stdout, false);
    });
    return;
  }

  // API Route to get current data
  if (url === '/api/data') {
    const dataPath = path.join(DATA_DIR, 'yalla_live_data.json');
    const updatePath = path.join(DATA_DIR, 'last_update.json');
    try {
      if (fs.existsSync(dataPath)) {
        const matchesData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        const updateData = fs.existsSync(updatePath) ? JSON.parse(fs.readFileSync(updatePath, 'utf-8')) : { last_updated: new Date().toISOString() };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: matchesData, meta: updateData }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'No data file found yet. Please run a scrape first.' }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, url === '/' ? 'index.html' : url);
  
  // Prevent directory traversal attacks
  const relative = path.relative(__dirname, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  // Serve the file
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Return 404 for invalid files
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

function sendScrapeResponse(res, stdout, fallbackUsed) {
  const dataPath = path.join(DATA_DIR, 'yalla_live_data.json');
  const updatePath = path.join(DATA_DIR, 'last_update.json');
  
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const meta = JSON.parse(fs.readFileSync(updatePath, 'utf-8'));
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: fallbackUsed ? 'Scraped from local fallback content.' : 'Live scrape completed successfully.',
      fallbackUsed,
      data,
      meta,
      console: stdout
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Scraped files written, but error parsing JSON output: ' + e.message }));
  }
}

server.listen(PORT, () => {
  console.log(`\n\x1b[35m========================================================\x1b[0m`);
  console.log(`\x1b[32m[SERVER] Yalla Feed Center running successfully!\x1b[0m`);
  console.log(`\x1b[36m[SERVER] Local Web Dashboard:\x1b[0m \x1b[4mhttp://localhost:${PORT}/\x1b[0m`);
  console.log(`\x1b[36m[SERVER] Custom Matches XML Feed:\x1b[0m \x1b[4mhttp://localhost:${PORT}/data/yalla_live_matches.xml\x1b[0m`);
  console.log(`\x1b[36m[SERVER] XMLTV EPG Feed:\x1b[0m \x1b[4mhttp://localhost:${PORT}/data/yalla_live_xmltv.xml\x1b[0m`);
  console.log(`\x1b[36m[SERVER] RSS Feed:\x1b[0m \x1b[4mhttp://localhost:${PORT}/data/yalla_live_feed.xml\x1b[0m`);
  console.log(`\x1b[35m========================================================\x1b[0m\n`);

  // ========================================================
  // 🔄 Automated Daily Scraper Scheduler
  // ========================================================
  // Automatically triggers the scraper every 4 hours (daily loop)
  const AUTO_UPDATE_INTERVAL = 4 * 60 * 60 * 1000; 

  function runAutomatedScrape() {
    console.log(`\n[SCHEDULER] Running scheduled feed sync: ${new Date().toLocaleString()}`);
    exec('node generator.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`[SCHEDULER] Live sync failed (${error.message}), using fallback...`);
        exec('node generator.js --local content.md', (fbError) => {
          if (fbError) console.error(`[SCHEDULER] Fallback scrape failed: ${fbError.message}`);
          else console.log(`[SCHEDULER] Fallback update completed.`);
        });
        return;
      }
      console.log(`[SCHEDULER] Live matches and XMLTV EPG feeds successfully synced!`);
    });
  }

  // Set recurring daily schedule loop
  setInterval(runAutomatedScrape, AUTO_UPDATE_INTERVAL);
  console.log(`[SCHEDULER] Automated daily update loop started (syncs feeds every 4 hours).`);
});
