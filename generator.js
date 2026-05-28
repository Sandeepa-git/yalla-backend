const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ===========================
// CONFIG
// ===========================
const DEFAULT_URL = 'https://www.epicsports.in/';
const DATA_DIR = path.join(__dirname, 'data');
const FETCH_TIMEOUT_MS = 15000; // 15 second timeout
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ===========================
// LOGGING
// ===========================
function logInfo(msg)    { console.log(`\x1b[36m[INFO]\x1b[0m  ${msg}`); }
function logSuccess(msg) { console.log(`\x1b[32m[OK]\x1b[0m    ${msg}`); }
function logError(msg)   { console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`); }
function logWarn(msg)    { console.warn(`\x1b[33m[WARN]\x1b[0m  ${msg}`); }

// ===========================
// FETCH WITH TIMEOUT + REDIRECT
// ===========================
function fetchUrl(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects'));
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${urlStr}`));
    }

    logInfo(`Fetching: ${urlStr}`);

    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      timeout: FETCH_TIMEOUT_MS,
    };

    const req = lib.request(options, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        if (!location) return reject(new Error('Redirect with no Location header'));
        logWarn(`Redirect ${res.statusCode} → ${location}`);
        res.resume(); // discard body
        // Resolve absolute redirect URL
        const nextUrl = location.startsWith('http') ? location : new URL(location, urlStr).href;
        return fetchUrl(nextUrl, redirectCount + 1).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${urlStr}`));
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`));
    });

    req.on('error', reject);
    req.end();
  });
}

// ===========================
// XML ESCAPE
// ===========================
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ===========================
// HTML DECODE (basic)
// ===========================
function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#160;/g, ' ');
}

// ===========================
// STRIP HTML TAGS
// ===========================
function stripTags(str) {
  return str ? str.replace(/<[^>]+>/g, '').trim() : '';
}

// ===========================
// DETERMINE MATCH STATUS from data-start / data-gameends
// ===========================
function getMatchStatus(dataStart, dataGameEnds) {
  if (!dataStart) return { statusClass: 'soon', statusText: 'Upcoming' };

  try {
    const now = Date.now();
    const start = new Date(dataStart).getTime();
    const end = dataGameEnds ? new Date(dataGameEnds).getTime() : start + 2 * 60 * 60 * 1000;

    if (isNaN(start)) return { statusClass: 'soon', statusText: 'Upcoming' };

    if (now < start) return { statusClass: 'soon', statusText: 'Upcoming' };
    if (now >= start && now <= end) return { statusClass: 'live', statusText: 'LIVE' };
    return { statusClass: 'finished', statusText: 'Ended' };
  } catch {
    return { statusClass: 'soon', statusText: 'Upcoming' };
  }
}

// ===========================
// FORMAT TIME from ISO date string
// ===========================
function formatMatchTime(dataStart) {
  if (!dataStart) return '--:--';
  try {
    const d = new Date(dataStart);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'   // IST — epicsports uses +05:30
    });
  } catch {
    return '--:--';
  }
}

// ===========================
// GENERATE UNIQUE ID
// ===========================
function makeId(team1, team2) {
  const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const id = `${clean(team1)}_vs_${clean(team2)}`;
  return id && id !== 'vs' ? id : 'match_' + Math.random().toString(36).slice(2, 8);
}

// ===========================
// PARSE epicsports.in HTML
// ===========================
function parseEpicSports(html) {
  logInfo('Parsing epicsports.in HTML...');

  const matches = [];
  const news = [];

  // ── MATCHES ──────────────────────────────────────────────────────────────
  // Each match block looks like:
  // <div id="em..." class="match-event [ch-live|ch-soon|ch-end|...]" data-result='vs'>
  //   <a title="..." href="..."><div id="overlay-match">...</div></a>
  //   <div class="first-team">
  //     <div class="team-logo"><img alt="..." src="..." /></div>
  //     <div class="team-name">Team1</div>
  //   </div>
  //   <div class="match-time">
  //     <div class="match-timing">
  //       <div id="match-hour">HH:MM AM</div>
  //       <div id="result-now">vs / score</div>
  //       <span id="dem..." class="match-date ..." data-start="..." data-gameends="..."></span>
  //     </div>
  //   </div>
  //   <div class="left-team">
  //     <div class="team-logo"><img alt="..." src="..." /></div>
  //     <div class="team-name">Team2</div>
  //   </div>
  //   <div class="match-info">
  //     <ul>
  //       <li><span>Commentator</span></li>
  //       <li><span>Channel</span></li>
  //       <li><span>Tournament</span></li>
  //     </ul>
  //   </div>
  // </div>

  // Split on each match-event div (excluding style-only ones)
  const matchEventRegex = /<div\s+id="em\w+"\s+class="match-event[^"]*"[^>]*data-result=['"]vs['"][^>]*>([\s\S]*?)(?=<div\s+id="em\w+"\s+class="match-event|$)/gi;
  
  // Fallback: split by id="em" pattern
  const rawBlocks = html.split(/<div\s+id="em\d+\w*"\s+class="match-event/i);

  for (let i = 1; i < rawBlocks.length; i++) {
    const block = rawBlocks[i];

    // Only process blocks that contain "data-result" (actual match blocks)
    if (!block.includes('data-result')) continue;

    // ── Link & Title ───────────────────────────────────────────────────────
    const linkMatch = block.match(/href=["']([^"']+)["']/i);
    const titleMatch = block.match(/title=["']([^"']+)["']/i);
    const link = linkMatch ? linkMatch[1] : '#';
    const title = titleMatch ? decodeHtml(titleMatch[1]) : '';

    // ── Status class from opening of the block ─────────────────────────────
    const classMatch = block.match(/^([^>]+)>/);
    const rawClass = classMatch ? classMatch[1] : '';
    let statusClass = 'soon';
    if (/ch-live/i.test(rawClass))      statusClass = 'live';
    else if (/ch-end/i.test(rawClass))  statusClass = 'finished';
    else if (/ch-soon/i.test(rawClass)) statusClass = 'soon';

    // ── Team 1 (first-team) ────────────────────────────────────────────────
    const firstTeamBlock = block.match(/<div\s+class=["']first-team["']([\s\S]*?)(?=<div\s+class=["']match-time["'])/i);
    let team1Name = '', team1Logo = '';
    if (firstTeamBlock) {
      const imgM = firstTeamBlock[1].match(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/i);
      const altM = firstTeamBlock[1].match(/alt=["']([^"']+)["']/i);
      const nameM = firstTeamBlock[1].match(/<div\s+class=["']team-name["']>([^<]+)<\/div>/i);
      team1Logo = imgM ? imgM[1] : '';
      team1Name = nameM ? decodeHtml(nameM[1].trim()) : (altM ? decodeHtml(altM[1]) : 'Team 1');
    }

    // ── Team 2 (left-team) ─────────────────────────────────────────────────
    const leftTeamBlock = block.match(/<div\s+class=["']left-team["']([\s\S]*?)(?=<div\s+class=["']match-info["']|$)/i);
    let team2Name = '', team2Logo = '';
    if (leftTeamBlock) {
      const imgM = leftTeamBlock[1].match(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/i);
      const altM = leftTeamBlock[1].match(/alt=["']([^"']+)["']/i);
      const nameM = leftTeamBlock[1].match(/<div\s+class=["']team-name["']>([^<]+)<\/div>/i);
      team2Logo = imgM ? imgM[1] : '';
      team2Name = nameM ? decodeHtml(nameM[1].trim()) : (altM ? decodeHtml(altM[1]) : 'Team 2');
    }

    // ── Time & Score & Status Date ─────────────────────────────────────────
    const matchHourM = block.match(/<div\s+id=["']match-hour["']>([^<]+)<\/div>/i);
    const resultNowM = block.match(/<div\s+id=["']result-now["']>([^<]+)<\/div>/i);
    const dataStartM = block.match(/data-start=["']([^"']+)["']/i);
    const dataEndsM  = block.match(/data-gameends=["']([^"']+)["']/i);

    const rawTime   = matchHourM ? matchHourM[1].trim() : '';
    const rawScore  = resultNowM ? resultNowM[1].trim() : 'vs';
    const dataStart = dataStartM ? dataStartM[1] : '';
    const dataEnds  = dataEndsM  ? dataEndsM[1]  : '';

    // Use data-start for accurate time display if available
    const displayTime = dataStart ? formatMatchTime(dataStart) : rawTime || '--:--';

    // Get live status from timestamps (more accurate than class alone)
    const { statusClass: tsStatus, statusText } = getMatchStatus(dataStart, dataEnds);
    // Prefer timestamp-derived status if we have dates, else use class
    const finalStatus = dataStart ? tsStatus : statusClass;

    // Score: show if live/ended and score != 'vs'
    const score = (finalStatus === 'live' || finalStatus === 'finished') && rawScore !== 'vs'
      ? rawScore
      : (finalStatus === 'live' ? '0 - 0' : 'vs');

    // ── Match Info (commentator, channel, tournament) ──────────────────────
    const matchInfoBlock = block.match(/<div\s+class=["']match-info["']([\s\S]*?)(?=<\/div>\s*<\/div>\s*$|$)/i);
    let commentator = 'N/A', channel = 'Epicsports', tournament = 'Friendly';
    if (matchInfoBlock) {
      const spans = [...matchInfoBlock[1].matchAll(/<span>([^<]+)<\/span>/gi)];
      if (spans[0]) commentator = decodeHtml(spans[0][1].trim());
      if (spans[1]) channel     = decodeHtml(spans[1][1].trim());
      if (spans[2]) tournament  = decodeHtml(spans[2][1].trim());
    }

    matches.push({
      id: makeId(team1Name, team2Name),
      title: title || `${team1Name} vs ${team2Name}`,
      link,
      time: displayTime,
      score,
      statusClass: finalStatus,
      statusText,
      team1: { name: team1Name, logo: team1Logo },
      team2: { name: team2Name, logo: team2Logo },
      commentator,
      channel,
      tournament,
    });
  }

  // ── NEWS ARTICLES ─────────────────────────────────────────────────────────
  // <div class='blog-posts-sections'>
  //   <div class='blog-post sections index-post'>
  //     <div class='post-image-wrap'>
  //       <a href='...'>
  //         <img ... data-src='...' src='...' title='...' />
  //       </a>
  //     </div>
  //     <div class='post-info'>
  //       <h3 class='post-title'>
  //         <a href='...'>Title text</a>
  //       </h3>
  //     </div>
  //   </div>
  // </div>

  const newsBlocks = html.split(/<div\s+class=['"]blog-posts-sections['"]/i);
  for (let i = 1; i < newsBlocks.length; i++) {
    const block = newsBlocks[i];

    // Get the post link and title from h3.post-title > a
    const titleLinkM = block.match(/<h3\s+class=['"]post-title['"]>\s*<a\s+href=['"]([^'"]+)['"]>([^<]+)<\/a>/i);
    if (!titleLinkM) continue;

    const articleLink  = titleLinkM[1].trim();
    const articleTitle = decodeHtml(titleLinkM[2].trim());

    // Get image — prefer data-src (lazy loaded), fall back to src
    // Exclude placeholder/preview images
    let image = '';
    const dataSrcM = block.match(/data-src=['"]([^'"]+)['"]/i);
    const srcM     = block.match(/<img[^>]+src=['"]([^'"]+)['"]/i);
    if (dataSrcM && !dataSrcM[1].includes('preview.jpg')) {
      image = dataSrcM[1];
    } else if (srcM && !srcM[1].includes('preview.jpg')) {
      image = srcM[1];
    }

    if (articleTitle && articleLink) {
      news.push({
        title: articleTitle,
        link: articleLink,
        image,
      });
    }
  }

  logInfo(`Parsed ${matches.length} match(es) and ${news.length} news article(s)`);
  return { matches, news };
}

// ===========================
// GENERATE CUSTOM MATCHES XML
// ===========================
function generateMatchesXml(data, timestamp) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<yalla_live>\n  <metadata>\n`;
  xml += `    <source>${escapeXml(DEFAULT_URL)}</source>\n`;
  xml += `    <last_updated>${escapeXml(timestamp)}</last_updated>\n`;
  xml += `  </metadata>\n  <matches>\n`;

  data.matches.forEach((m) => {
    xml += `    <match id="${escapeXml(m.id)}" status="${escapeXml(m.statusClass)}">\n`;
    xml += `      <title>${escapeXml(m.title)}</title>\n`;
    xml += `      <link>${escapeXml(m.link)}</link>\n`;
    xml += `      <time>${escapeXml(m.time)}</time>\n`;
    xml += `      <score>${escapeXml(m.score)}</score>\n`;
    xml += `      <status_text>${escapeXml(m.statusText)}</status_text>\n`;
    xml += `      <team1><name>${escapeXml(m.team1.name)}</name><logo>${escapeXml(m.team1.logo)}</logo></team1>\n`;
    xml += `      <team2><name>${escapeXml(m.team2.name)}</name><logo>${escapeXml(m.team2.logo)}</logo></team2>\n`;
    xml += `      <details>\n`;
    xml += `        <channel>${escapeXml(m.channel)}</channel>\n`;
    xml += `        <commentator>${escapeXml(m.commentator)}</commentator>\n`;
    xml += `        <tournament>${escapeXml(m.tournament)}</tournament>\n`;
    xml += `      </details>\n    </match>\n`;
  });

  xml += `  </matches>\n  <news>\n`;
  data.news.forEach((item) => {
    xml += `    <item>\n`;
    xml += `      <title>${escapeXml(item.title)}</title>\n`;
    xml += `      <link>${escapeXml(item.link)}</link>\n`;
    xml += `      <image>${escapeXml(item.image)}</image>\n`;
    xml += `    </item>\n`;
  });
  xml += `  </news>\n</yalla_live>`;
  return xml;
}

// ===========================
// GENERATE XMLTV EPG
// ===========================
function pad(n) { return String(n).padStart(2, '0'); }

function toEpgDate(isoStr, addHours = 0) {
  try {
    const d = new Date(new Date(isoStr).getTime() + addHours * 3600000);
    if (isNaN(d.getTime())) throw new Error('invalid');
    const y  = d.getUTCFullYear();
    const mo = pad(d.getUTCMonth() + 1);
    const dy = pad(d.getUTCDate());
    const h  = pad(d.getUTCHours());
    const mi = pad(d.getUTCMinutes());
    const s  = pad(d.getUTCSeconds());
    return `${y}${mo}${dy}${h}${mi}${s} +0000`;
  } catch {
    const now = new Date();
    const y  = now.getUTCFullYear();
    const mo = pad(now.getUTCMonth() + 1);
    const dy = pad(now.getUTCDate());
    const h  = pad(now.getUTCHours() + addHours);
    const mi = pad(now.getUTCMinutes());
    return `${y}${mo}${dy}${h}${mi}00 +0000`;
  }
}

function generateXmltvEpg(data) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n`;
  xml += `<tv generator-info-name="Yalla Sports XMLTV" generator-info-url="${escapeXml(DEFAULT_URL)}">\n`;

  data.matches.forEach((m) => {
    xml += `  <channel id="${escapeXml(m.id)}">\n`;
    xml += `    <display-name lang="en">${escapeXml(m.team1.name)} vs ${escapeXml(m.team2.name)}</display-name>\n`;
    if (m.team1.logo) xml += `    <icon src="${escapeXml(m.team1.logo)}" />\n`;
    xml += `  </channel>\n`;
  });

  data.matches.forEach((m) => {
    // Use today's date + match time for EPG since we may not have full ISO
    const startIso = new Date().toISOString();
    const start = toEpgDate(startIso, 0);
    const stop  = toEpgDate(startIso, 2);

    xml += `  <programme start="${start}" stop="${stop}" channel="${escapeXml(m.id)}">\n`;
    xml += `    <title lang="en">${escapeXml(m.team1.name)} vs ${escapeXml(m.team2.name)}</title>\n`;
    xml += `    <desc lang="en">Tournament: ${escapeXml(m.tournament)} | Channel: ${escapeXml(m.channel)} | Commentator: ${escapeXml(m.commentator)} | Status: ${escapeXml(m.statusText)} | Time: ${escapeXml(m.time)}</desc>\n`;
    xml += `    <category lang="en">Sports</category>\n`;
    if (m.link) xml += `    <url>${escapeXml(m.link)}</url>\n`;
    xml += `  </programme>\n`;
  });

  xml += `</tv>`;
  return xml;
}

// ===========================
// GENERATE RSS FEED
// ===========================
function generateRss(data, timestamp) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n  <channel>\n`;
  xml += `    <title>Yalla Sports - Live Matches &amp; News</title>\n`;
  xml += `    <link>${escapeXml(DEFAULT_URL)}</link>\n`;
  xml += `    <description>Live sports matches, scores, and latest sports news from Epicsports</description>\n`;
  xml += `    <language>en</language>\n`;
  xml += `    <lastBuildDate>${new Date(timestamp).toUTCString()}</lastBuildDate>\n`;

  data.matches.forEach((m) => {
    xml += `    <item>\n`;
    xml += `      <title>${escapeXml(m.team1.name)} vs ${escapeXml(m.team2.name)} — ${escapeXml(m.time)}</title>\n`;
    xml += `      <link>${escapeXml(m.link || DEFAULT_URL)}</link>\n`;
    xml += `      <description><![CDATA[<b>⚽ ${escapeXml(m.team1.name)} vs ${escapeXml(m.team2.name)}</b><br/>🕐 Time: ${escapeXml(m.time)}<br/>🏆 ${escapeXml(m.tournament)}<br/>📺 ${escapeXml(m.channel)}<br/>🎤 ${escapeXml(m.commentator)}<br/>⚡ Status: ${escapeXml(m.statusText)} — Score: ${escapeXml(m.score)}]]></description>\n`;
    xml += `      <guid>${escapeXml(m.id)}</guid>\n`;
    xml += `      <category>Matches</category>\n`;
    xml += `    </item>\n`;
  });

  data.news.forEach((item, idx) => {
    xml += `    <item>\n`;
    xml += `      <title>${escapeXml(item.title)}</title>\n`;
    xml += `      <link>${escapeXml(item.link)}</link>\n`;
    xml += `      <description><![CDATA[${item.image ? `<img src="${escapeXml(item.image)}" alt="${escapeXml(item.title)}" style="max-width:100%"/><br/>` : ''}<p>${escapeXml(item.title)}</p>]]></description>\n`;
    xml += `      <guid>news_${idx}_${Date.now()}</guid>\n`;
    xml += `      <category>News</category>\n`;
    xml += `    </item>\n`;
  });

  xml += `  </channel>\n</rss>`;
  return xml;
}

// ===========================
// MAIN RUN
// ===========================
async function run() {
  const args = process.argv.slice(2);
  let html = '';

  const localIdx = args.indexOf('--local');
  if (localIdx !== -1 && args[localIdx + 1]) {
    // Local file mode
    const filePath = path.resolve(args[localIdx + 1]);
    logInfo(`Reading local file: ${filePath}`);
    try {
      html = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      logError(`Cannot read local file: ${e.message}`);
      process.exit(1);
    }
  } else {
    // Live fetch mode
    try {
      html = await fetchUrl(DEFAULT_URL);
      logSuccess(`Fetched ${html.length} bytes from ${DEFAULT_URL}`);
    } catch (e) {
      logError(`Live fetch failed: ${e.message}`);

      // Auto-fallback to content.md if present
      const fallback = path.join(__dirname, 'content.md');
      if (fs.existsSync(fallback)) {
        logWarn(`Using local fallback: ${fallback}`);
        html = fs.readFileSync(fallback, 'utf-8');
      } else {
        logError('No fallback file found. Exiting.');
        process.exit(1);
      }
    }
  }

  // Parse
  const data = parseEpicSports(html);
  const timestamp = new Date().toISOString();

  // Write all output files
  const matchesXmlPath = path.join(DATA_DIR, 'yalla_live_matches.xml');
  const xmltvPath      = path.join(DATA_DIR, 'yalla_live_xmltv.xml');
  const rssPath        = path.join(DATA_DIR, 'yalla_live_feed.xml');
  const jsonPath       = path.join(DATA_DIR, 'yalla_live_data.json');
  const metaPath       = path.join(DATA_DIR, 'last_update.json');

  fs.writeFileSync(matchesXmlPath, generateMatchesXml(data, timestamp), 'utf-8');
  fs.writeFileSync(xmltvPath,      generateXmltvEpg(data),              'utf-8');
  fs.writeFileSync(rssPath,        generateRss(data, timestamp),        'utf-8');
  fs.writeFileSync(jsonPath,       JSON.stringify(data, null, 2),       'utf-8');
  fs.writeFileSync(metaPath, JSON.stringify({
    last_updated:   timestamp,
    source:         DEFAULT_URL,
    matches_count:  data.matches.length,
    news_count:     data.news.length,
  }, null, 2), 'utf-8');

  logSuccess(`Matches XML → ${matchesXmlPath}`);
  logSuccess(`XMLTV EPG  → ${xmltvPath}`);
  logSuccess(`RSS Feed   → ${rssPath}`);
  logSuccess(`JSON Data  → ${jsonPath}`);

  console.log('\n\x1b[35m========= SCRAPE SUMMARY =========\x1b[0m');
  console.log(`  Source  : ${DEFAULT_URL}`);
  console.log(`  Matches : \x1b[33m${data.matches.length}\x1b[0m`);
  data.matches.forEach((m, i) => {
    console.log(`    [${i + 1}] ${m.team1.name} vs ${m.team2.name} @ ${m.time} — ${m.statusText}`);
  });
  console.log(`  News    : \x1b[33m${data.news.length}\x1b[0m`);
  data.news.slice(0, 3).forEach((n, i) => {
    console.log(`    [${i + 1}] ${n.title.slice(0, 60)}...`);
  });
  console.log('\x1b[35m==================================\x1b[0m\n');
}

run().catch((err) => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});
