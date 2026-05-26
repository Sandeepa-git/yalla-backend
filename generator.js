const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const DEFAULT_URL = 'https://www.tv-yalla.live/home/';
const DATA_DIR = path.join(__dirname, 'data');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Helper to ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Arabic-to-English sports translation mapping
const TRANSLATIONS = {
  // Statuses
  'لم تبدأ بعد': 'Not Started',
  'لم تبدء بعد': 'Not Started',
  'لم تبدا بعد': 'Not Started',
  'جارية الآن': 'LIVE',
  'انتهت': 'Ended',
  'غير معروف': 'Unknown',
  'لم تبدأ': 'Not Started',
  'started': 'Not Started',

  // Tournaments
  'مباراة ودية': 'Friendly Match',
  'الدوري الفرنسي': 'Ligue 1',
  'الدوري الإنجليزي': 'Premier League',
  'الدوري الإسباني': 'La Liga',
  'الدوري الإيطالي': 'Serie A',
  'دوري أبطال أوروبا': 'UEFA Champions League',
  'كأس العالم': 'World Cup',
  
  // Teams
  'المغرب': 'Morocco',
  'بوروندي': 'Burundi',
  'نيجيريا': 'Nigeria',
  'زيمبابوي': 'Zimbabwe',
  'سانت إتيان': 'Saint-Étienne',
  'نيس': 'Nice',
  'منتخب مصر': 'Egypt',
  'نيوزيلندا': 'New Zealand',
  'جالطة سراي': 'Galatasaray',
  'ليفربول': 'Liverpool',
  
  // Channels
  'بي إن سبورت': 'beIN Sports',
  'بي إن سبورت 1': 'beIN Sports 1',
  'بي إن سبورت 2': 'beIN Sports 2',
  'بي إن سبورت 3': 'beIN Sports 3',
  'بي إن سبورت 4': 'beIN Sports 4',
  'بي إن سبورت المفتوحة': 'beIN Sports Open',
  
  // Commentators
  'نوفل باشي': 'Nawfal Bashi',
  'جواد بدة': 'Jawad Badda',

  // Common Sports Title Translation Terms (Fuzzy translation)
  'بالتفصيل:': 'In Detail:',
  'بالتفصيل': 'In Detail',
  'تحليل أداء': 'Performance Analysis of',
  'محمد صلاح': 'Mohamed Salah',
  'ضد': 'vs',
  'ومحاولاته لإنقاذ': 'and his attempts to save',
  'رسميًا:': 'Official:',
  'رسميًا': 'Official',
  'إعلان تشكيل': 'Lineup Announced for',
  'منتخب مصر للشباب': 'Egypt U20 Team',
  'أمام': 'vs',
  'في كأس العالم تحت 20 عامًا': 'in FIFA U-20 World Cup',
  'حياة': 'Life of',
  'يورجن كلوب': 'Jurgen Klopp',
  'بعد اعتزال التدريب:': 'after retiring from coaching:',
  'بعد اعتزال التدريب': 'after coaching retirement',
  'أسرار جديدة وتصريح تاريخي لزوجته عام 2001': 'new secrets and historic 2001 statement by his wife',
  'الكشف عن نجوم الجولة:': 'Reveal of Matchday Stars:',
  'الكشف عن نجوم الجولة': 'Reveal of Matchday Stars',
  'المرشحون لجائزة أفضل لاعب في الدوري الإنجليزي': 'Premier League Player of the Month Nominees'
};

function translate(text) {
  if (!text) return '';
  let trimmed = text.trim();
  if (TRANSLATIONS[trimmed]) return TRANSLATIONS[trimmed];
  
  let result = trimmed;
  for (const [ar, en] of Object.entries(TRANSLATIONS)) {
    if (result.includes(ar)) {
      result = result.replace(new RegExp(ar, 'g'), en);
    }
  }
  return result;
}

// Log with style
function logInfo(msg) {
  console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`);
}
function logSuccess(msg) {
  console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`);
}
function logError(msg) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

// Fetch helper with headers
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    logInfo(`Fetching live content from ${url}...`);
    const options = {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        logInfo(`Redirected to ${res.headers.location}`);
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch site, status code: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
}

// Helper to escape XML special characters
function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// Helper to format date for XMLTV EPG (YYYYMMDDhhmmss +0300)
function getEpgDate(timeStr, daysOffset = 0) {
  const date = new Date();
  
  let hours = 12;
  let minutes = 0;
  
  if (timeStr) {
    const parts = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (parts) {
      hours = parseInt(parts[1], 10);
      minutes = parseInt(parts[2], 10);
      const ampm = parts[3].toUpperCase();
      
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
    }
  }

  date.setHours(hours, minutes, 0, 0);
  
  if (daysOffset) {
    date.setTime(date.getTime() + daysOffset * 24 * 60 * 60 * 1000);
  }
  
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  
  return `${yyyy}${mm}${dd}${hh}${mi}${ss} +0300`; // Riyadh Timezone is +0300
}

// Helper to generate a unique ID based on link slug or team names
function generateId(team1, team2, link) {
  if (link) {
    const slugMatch = link.match(/\/matches\/([^/]+)/);
    if (slugMatch) return slugMatch[1];
  }
  const t1 = team1.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const t2 = team2.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const cleanId = `${t1}_vs_${t2}`.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (cleanId && cleanId !== 'vs') return cleanId;
  return 'match_' + Math.random().toString(36).substr(2, 9);
}

// Main parsing logic
function parseHtml(html) {
  logInfo('Parsing HTML content...');
  
  // Clean comments and double lines
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, '');

  // 1. Parse Matches
  // Matches are inside <div class="AY_Match ...">
  const matchBlocks = cleanHtml.split(/<div\s+class=["']AY_Match/i);
  const matches = [];

  // Note: matchBlocks[0] is header, so we skip it
  for (let i = 1; i < matchBlocks.length; i++) {
    const block = matchBlocks[i];
    
    // Extract status class from the div start
    const classMatch = block.match(/^\s*([^"'>]+)["']/);
    const statusClass = classMatch ? classMatch[1].trim() : 'unknown';

    // Extract Team 1 info
    const name1Match = block.match(/class=['"]MT_Team\s+TM1['"][\s\S]*?<div\s+class=["']TM_Name["']>([\s\S]*?)<\/div>/i);
    const name1 = name1Match ? name1Match[1].replace(/<[^>]+>/g, '').trim() : 'غير معروف';
    const logo1Match = block.match(/class=['"]MT_Team\s+TM1['"][\s\S]*?(?:data-src|src)=["']([^"']+)["']/i);
    const logo1 = logo1Match ? logo1Match[1].trim() : '';
    const team1 = { name: translate(name1), logo: logo1 };

    // Extract Team 2 info
    const name2Match = block.match(/class=['"]MT_Team\s+TM2['"][\s\S]*?<div\s+class=["']TM_Name["']>([\s\S]*?)<\/div>/i);
    const name2 = name2Match ? name2Match[1].replace(/<[^>]+>/g, '').trim() : 'غير معروف';
    const logo2Match = block.match(/class=['"]MT_Team\s+TM2['"][\s\S]*?(?:data-src|src)=["']([^"']+)["']/i);
    const logo2 = logo2Match ? logo2Match[1].trim() : '';
    const team2 = { name: translate(name2), logo: logo2 };

    // Extract Match Data
    const timeMatch = block.match(/<span\s+class=['"]MT_Time['"]>([\s\S]*?)<\/span>/i);
    const time = timeMatch ? timeMatch[1].trim() : '';

    const scoreMatch = block.match(/<span\s+class=['"]MT_Result['"]>([\s\S]*?)<\/span>/i);
    const score = scoreMatch ? scoreMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '0 - 0';

    const statMatch = block.match(/<div\s+class=['"]MT_Stat['"]>([\s\S]*?)<\/div>/i);
    const statusText = statMatch ? statMatch[1].trim() : 'لم تبدأ بعد';

    // Extract Info
    const infoMatch = block.match(/<div\s+class=['"]MT_Info['"]>([\s\S]*?)<\/div>/i);
    let channel = 'غير معروف';
    let commentator = 'غير معروف';
    let tournament = 'غير معروف';
    if (infoMatch) {
      const spans = infoMatch[1].match(/<span>([\s\S]*?)<\/span>/gi);
      if (spans) {
        if (spans[0]) channel = spans[0].replace(/<\/?span>/gi, '').trim();
        if (spans[1]) commentator = spans[1].replace(/<\/?span>/gi, '').trim();
        if (spans[2]) tournament = spans[2].replace(/<\/?span>/gi, '').trim();
      }
    }

    // Extract Link and Title
    let link = '';
    let title = '';
    const hrefMatch = block.match(/href=["']([^"']+)["']/i);
    const titleAttrMatch = block.match(/title=["']([^"']+)["']/i);
    if (hrefMatch) link = hrefMatch[1];
    if (titleAttrMatch) title = titleAttrMatch[1];

    matches.push({
      id: generateId(team1.name, team2.name, link),
      statusClass,
      title: translate(title),
      link,
      time,
      score,
      statusText: translate(statusText),
      team1,
      team2,
      channel: translate(channel),
      commentator: translate(commentator),
      tournament: translate(tournament)
    });
  }

  // 2. Parse News Articles
  // News items are inside <div class='gr-item'>
  const newsBlocks = cleanHtml.split(/<div\s+class=['"]gr-item['"]/i);
  const news = [];

  for (let i = 1; i < newsBlocks.length; i++) {
    const block = newsBlocks[i];
    
    const hrefMatch = block.match(/href=["']([^"']+)["']/i);
    const titleMatch = block.match(/title=["']([^"']+)["']/i);
    const imgMatch = block.match(/data-src=["']([^"']+)["']/i) || block.match(/src=["']([^"']+)["']/i);
    
    if (hrefMatch && titleMatch) {
      news.push({
        title: translate(titleMatch[1].trim()),
        link: hrefMatch[1].trim(),
        image: imgMatch ? imgMatch[1].trim() : ''
      });
    }
  }

  return { matches, news };
}

// Generate Custom XML
function generateCustomXml(data, timestamp) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<yalla_live>\n`;
  xml += `  <metadata>\n`;
  xml += `    <title>يلا لايف - جدول المباريات والأخبار</title>\n`;
  xml += `    <link>${DEFAULT_URL}</link>\n`;
  xml += `    <description>بث مباشر مباريات اليوم بدون تقطيع ومستجدات الرياضة</description>\n`;
  xml += `    <last_updated>${timestamp}</last_updated>\n`;
  xml += `    <timezone>Asia/Riyadh (بتوقيت الرياض)</timezone>\n`;
  xml += `  </metadata>\n`;
  xml += `  <matches>\n`;
  
  data.matches.forEach((m) => {
    xml += `    <match id="${escapeXml(m.id)}" status="${escapeXml(m.statusClass)}">\n`;
    xml += `      <title>${escapeXml(m.title)}</title>\n`;
    xml += `      <link>${escapeXml(m.link)}</link>\n`;
    xml += `      <time>${escapeXml(m.time)}</time>\n`;
    xml += `      <score>${escapeXml(m.score)}</score>\n`;
    xml += `      <status_text>${escapeXml(m.statusText)}</status_text>\n`;
    xml += `      <team1>\n`;
    xml += `        <name>${escapeXml(m.team1.name)}</name>\n`;
    xml += `        <logo>${escapeXml(m.team1.logo)}</logo>\n`;
    xml += `      </team1>\n`;
    xml += `      <team2>\n`;
    xml += `        <name>${escapeXml(m.team2.name)}</name>\n`;
    xml += `        <logo>${escapeXml(m.team2.logo)}</logo>\n`;
    xml += `      </team2>\n`;
    xml += `      <details>\n`;
    xml += `        <channel>${escapeXml(m.channel)}</channel>\n`;
    xml += `        <commentator>${escapeXml(m.commentator)}</commentator>\n`;
    xml += `        <tournament>${escapeXml(m.tournament)}</tournament>\n`;
    xml += `      </details>\n`;
    xml += `    </match>\n`;
  });
  
  xml += `  </matches>\n`;
  xml += `  <news>\n`;
  
  data.news.forEach((item) => {
    xml += `    <item>\n`;
    xml += `      <title>${escapeXml(item.title)}</title>\n`;
    xml += `      <link>${escapeXml(item.link)}</link>\n`;
    xml += `      <image>${escapeXml(item.image)}</image>\n`;
    xml += `    </item>\n`;
  });
  
  xml += `  </news>\n`;
  xml += `</yalla_live>`;
  
  return xml;
}

// Generate XMLTV EPG
function generateXmltv(data) {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<!DOCTYPE tv SYSTEM "xmltv.dtd">\n`;
  xml += `<tv generator-info-name="Yalla Live XMLTV Generator" generator-info-url="${DEFAULT_URL}">\n`;
  
  // Channels section
  data.matches.forEach((m) => {
    const channelId = m.id;
    xml += `  <channel id="${escapeXml(channelId)}">\n`;
    xml += `    <display-name lang="ar">${escapeXml(m.team1.name)} ضد ${escapeXml(m.team2.name)}</display-name>\n`;
    xml += `    <display-name lang="en">${escapeXml(m.id)}</display-name>\n`;
    if (m.team1.logo) {
      xml += `    <icon src="${escapeXml(m.team1.logo)}" />\n`;
    }
    xml += `  </channel>\n`;
  });

  // Programmes section
  data.matches.forEach((m) => {
    const channelId = m.id;
    const startTime = getEpgDate(m.time, 0);
    // Standard match EPG usually spans 2 hours (7200 seconds)
    const endTime = getEpgDate(m.time, 0.0833); // adding ~2 hours
    
    xml += `  <programme start="${startTime}" stop="${endTime}" channel="${escapeXml(channelId)}">\n`;
    xml += `    <title lang="ar">${escapeXml(m.team1.name)} ضد ${escapeXml(m.team2.name)} - بث مباشر</title>\n`;
    xml += `    <desc lang="ar">البطولة: ${escapeXml(m.tournament)} | المعلق: ${escapeXml(m.commentator)} | القناة الناقلة: ${escapeXml(m.channel)} | حالة المباراة: ${escapeXml(m.statusText)}</desc>\n`;
    xml += `    <category lang="ar">Sports</category>\n`;
    xml += `    <category lang="en">Sports</category>\n`;
    if (m.link) {
      xml += `    <url>${escapeXml(m.link)}</url>\n`;
    }
    xml += `  </programme>\n`;
  });
  
  xml += `</tv>`;
  
  return xml;
}

// Generate RSS Feed
function generateRss(data, timestamp) {
  let xml = `<?xml version="1.0" encoding="UTF-8" ?>\n`;
  xml += `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">\n`;
  xml += `  <channel>\n`;
  xml += `    <title>يلا لايف - بث مباشر مباريات اليوم</title>\n`;
  xml += `    <link>${DEFAULT_URL}</link>\n`;
  xml += `    <description>يلا لايف yalla live مشاهدة مباريات اليوم بث مباشر بدون تقطيع yalla tv live موقع يلا لايف مباريات اليوم</description>\n`;
  xml += `    <language>ar</language>\n`;
  xml += `    <lastBuildDate>${new Date(timestamp).toUTCString()}</lastBuildDate>\n`;
  
  // Add Matches to RSS
  data.matches.forEach((m) => {
    xml += `    <item>\n`;
    xml += `      <title>مباراة: ${escapeXml(m.team1.name)} × ${escapeXml(m.team2.name)} (${escapeXml(m.time)})</title>\n`;
    xml += `      <link>${escapeXml(m.link || DEFAULT_URL)}</link>\n`;
    xml += `      <description><![CDATA[\n`;
    xml += `        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 10px; border: 1px solid #ddd; border-radius: 8px;">\n`;
    xml += `          <h3>⚽ ${escapeXml(m.team1.name)} ضد ${escapeXml(m.team2.name)}</h3>\n`;
    xml += `          <p><strong>⏰ توقيت المباراة:</strong> ${escapeXml(m.time)} (بتوقيت الرياض)</p>\n`;
    xml += `          <p><strong>🏆 البطولة:</strong> ${escapeXml(m.tournament)}</p>\n`;
    xml += `          <p><strong>📺 القناة الناقلة:</strong> ${escapeXml(m.channel)}</p>\n`;
    xml += `          <p><strong>🎤 المعلق الرياضي:</strong> ${escapeXml(m.commentator)}</p>\n`;
    xml += `          <p><strong>⚡ حالة المباراة:</strong> ${escapeXml(m.statusText)} (${escapeXml(m.score)})</p>\n`;
    if (m.link) {
      xml += `          <p><a href="${escapeXml(m.link)}" style="display: inline-block; padding: 8px 15px; background: #4d0b7a; color: white; text-decoration: none; border-radius: 4px;">مشاهدة البث المباشر 🎥</a></p>\n`;
    }
    xml += `        </div>\n`;
    xml += `      ]]></description>\n`;
    xml += `      <category>Matches</category>\n`;
    xml += `      <guid>${escapeXml(m.id)}</guid>\n`;
    xml += `    </item>\n`;
  });

  // Add News to RSS
  data.news.forEach((item, index) => {
    xml += `    <item>\n`;
    xml += `      <title>أخبار: ${escapeXml(item.title)}</title>\n`;
    xml += `      <link>${escapeXml(item.link)}</link>\n`;
    xml += `      <description><![CDATA[\n`;
    if (item.image) {
      xml += `        <img src="${escapeXml(item.image)}" alt="${escapeXml(item.title)}" style="max-width:100%; border-radius:8px;" /><br/>\n`;
    }
    xml += `        <p>${escapeXml(item.title)}</p>\n`;
    xml += `      ]]></description>\n`;
    xml += `      <category>News</category>\n`;
    xml += `      <guid>news_${index}</guid>\n`;
    xml += `    </item>\n`;
  });

  xml += `  </channel>\n`;
  xml += `</rss>`;
  
  return xml;
}

// Core Execution
async function run() {
  const args = process.argv.slice(2);
  let html = '';
  
  // Check if a local file is passed for parsing
  const localFileIndex = args.indexOf('--local');
  if (localFileIndex !== -1 && args[localFileIndex + 1]) {
    const filePath = path.resolve(args[localFileIndex + 1]);
    logInfo(`Reading local file: ${filePath}`);
    try {
      html = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      logError(`Failed to read local file: ${e.message}`);
      process.exit(1);
    }
  } else {
    try {
      html = await fetchUrl(DEFAULT_URL);
    } catch (e) {
      logError(`Live fetch failed: ${e.message}`);
      
      // Fallback: search for content.md if available
      logInfo('Checking for offline fallback file...');
      const fallbackPaths = [
        path.join(__dirname, 'content.md'),
        path.join(__dirname, '..', 'content.md')
      ];
      
      let fallbackSuccess = false;
      for (const fPath of fallbackPaths) {
        if (fs.existsSync(fPath)) {
          logInfo(`Using offline fallback: ${fPath}`);
          html = fs.readFileSync(fPath, 'utf-8');
          fallbackSuccess = true;
          break;
        }
      }
      
      if (!fallbackSuccess) {
        logError('No fallback HTML source found. Please connect to the internet or provide a --local HTML path.');
        process.exit(1);
      }
    }
  }

  // Parse HTML
  const parsedData = parseHtml(html);
  logInfo(`Successfully parsed ${parsedData.matches.length} matches and ${parsedData.news.length} news articles!`);

  // Prepare metadata
  const timestamp = new Date().toISOString();
  
  // File Paths
  const matchesXmlPath = path.join(DATA_DIR, 'yalla_live_matches.xml');
  const xmltvPath = path.join(DATA_DIR, 'yalla_live_xmltv.xml');
  const feedXmlPath = path.join(DATA_DIR, 'yalla_live_feed.xml');
  const dataJsonPath = path.join(DATA_DIR, 'yalla_live_data.json');
  const metaJsonPath = path.join(DATA_DIR, 'last_update.json');

  // Generate contents
  const customXml = generateCustomXml(parsedData, timestamp);
  const xmltvXml = generateXmltv(parsedData);
  const rssXml = generateRss(parsedData, timestamp);
  
  // Write files
  fs.writeFileSync(matchesXmlPath, customXml, 'utf-8');
  fs.writeFileSync(xmltvPath, xmltvXml, 'utf-8');
  fs.writeFileSync(feedXmlPath, rssXml, 'utf-8');
  fs.writeFileSync(dataJsonPath, JSON.stringify(parsedData, null, 2), 'utf-8');
  fs.writeFileSync(metaJsonPath, JSON.stringify({ last_updated: timestamp, matches_count: parsedData.matches.length, news_count: parsedData.news.length }, null, 2), 'utf-8');

  logSuccess(`Custom Matches XML created at: ${matchesXmlPath}`);
  logSuccess(`XMLTV EPG Feed created at: ${xmltvPath}`);
  logSuccess(`RSS 2.0 XML Feed created at: ${feedXmlPath}`);
  logSuccess(`JSON Data created at: ${dataJsonPath}`);
  
  console.log('\n\x1b[35m=== SCRAPE SUMMARY ===\x1b[0m');
  console.log(`- Matches Scraped: \x1b[33m${parsedData.matches.length}\x1b[0m`);
  parsedData.matches.forEach((m, idx) => {
    console.log(`  [${idx + 1}] ${m.team1.name} VS ${m.team2.name} at ${m.time} | status: ${m.statusText}`);
  });
  console.log(`- News Scraped: \x1b[33m${parsedData.news.length}\x1b[0m`);
  console.log('\x1b[35m======================\x1b[0m\n');
}

run();
