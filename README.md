# 📡 Yalla Live XML Feed Center

A premium-grade, interactive, and automated web scraper and feed generator for [TV-Yalla](https://www.tv-yalla.live/home/). This utility extracts live match data, broadcast schedules, commentator names, TV channels, tournaments, and sports articles, then generates optimized feed formats for custom software, IPTV EPGs, and RSS readers.

---

## 🚀 Key Features

* **⚡ Zero-Dependency Scraper**: Written in pure Node.js without heavy NPM installation overhead. Parses directly with high-performance scoped regular expressions.
* **🌐 Web Feed Center Dashboard**: A gorgeous, premium-grade responsive web interface utilizing glassmorphic aesthetics, glowing neon status indicators, and full translation controls (Arabic 🇸🇦 / English 🇬🇧).
* **📄 XML & JSON Feed Formats**:
  1. **`yalla_live_matches.xml`**: A clean, nested custom XML structure representing the complete match database.
  2. **`yalla_live_xmltv.xml`**: A fully standardized XMLTV-compliant Electronic Program Guide (EPG) file ready to be loaded straight into IPTV applications (Tivimate, VLC, OTT Navigator, etc.).
  3. **`yalla_live_feed.xml`**: A compliant RSS 2.0 feed containing news items and rich-formatted match cards for syndication.
  4. **`yalla_live_data.json`**: An structured JSON database format for web and mobile app integration.
* **💻 Interactive XML Viewer**: An on-page syntax-highlighted code inspector that lets you read and copy XML elements dynamically.
* **🔄 Live Web Sync (AJAX Scraper)**: Click the "Scrape & Sync Live" button on the dashboard to trigger the scraper in real-time, fetching fresh matches and live score updates instantaneously without reloading.
* **💾 Hybrid Offline Fallback**: Features automatic local caching and fallback execution using pre-scraped HTML documents in offline mode.

---

## 🛠️ Folder Structure

```bash
yalla/
├── data/                       # Generated data feeds folder
│   ├── yalla_live_matches.xml  # Custom Structured Matches XML
│   ├── yalla_live_xmltv.xml    # Standard XMLTV (EPG format)
│   ├── yalla_live_feed.xml     # RSS 2.0 Feed XML
│   └── yalla_live_data.json    # JSON Scraped raw data
├── generator.js                # Core scraper and XML formatting engine
├── server.js                   # Pure Node HTTP Server with API endpoints
├── index.html                  # Cyberpunk dark glassmorphic web dashboard
├── content.md                  # Saved HTML snapshot for offline fallback
├── package.json                # Project configuration and script commands
└── README.md                   # Complete system documentation
```

---

## 🏃 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (Version 18.0.0 or higher is recommended).

### 1. Run the Scraping Script

To run the live scraper and generate/overwrite the feeds inside the `data/` folder immediately, run:

```bash
npm run generate
```

To run the scraper in **offline/local fallback mode** (highly useful if you are offline or getting rate-limited by the host), run:

```bash
npm run generate:local
```

### 2. Boot the Feed Center Server

Launch the web application locally to access the dashboard and stream your feeds:

```bash
npm run start
```

Once started, open your web browser and navigate to:
👉 **[http://localhost:3000/](http://localhost:3000/)**

---

## 📡 Feed Integration URLs

When the server is running, you can link other programs and players directly to these live endpoints:

* **Custom Matches XML Feed**: `http://localhost:3000/data/yalla_live_matches.xml`
* **XMLTV EPG Feed (IPTV)**: `http://localhost:3000/data/yalla_live_xmltv.xml`
* **RSS Feed Reader Feed**: `http://localhost:3000/data/yalla_live_feed.xml`
* **JSON Raw Data Feed**: `http://localhost:3000/data/yalla_live_data.json`

---

## 📺 IPTV EPG Integration

You can import `yalla_live_xmltv.xml` directly into any IPTV player that supports EPG links:
1. In your player (e.g., Tivimate), add a new **EPG Source**.
2. Set the EPG URL to: `http://localhost:3000/data/yalla_live_xmltv.xml`.
3. Save, and your channels will automatically display matching sports guides (e.g., Morocco vs Burundi EPG schedule containing channel, tournament, and commentator descriptions!).

---

*Powered by Antigravity AI Engine.*
