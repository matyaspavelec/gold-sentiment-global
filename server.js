// ============================================
// GOLD SENTIMENT MODEL — Backend Proxy & Cache
// Proxies requests to CommodityPriceAPI
// Caches results to disk to conserve API calls
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const http = require('http');
const { XMLParser } = require('fast-xml-parser');

// --- Config ---
const API_KEY = process.env.COMMODITY_API_KEY || '';
const API_BASE = 'https://api.commoditypriceapi.com/v2';
const CACHE_DIR = path.join(__dirname, '.cache');
const PORT = process.env.PORT || 8090;

// News API keys (optional — sources with keys disabled if not set)
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || '';
const GNEWS_KEY = process.env.GNEWS_KEY || '';
const FINNHUB_KEY = process.env.FINNHUB_KEY || '';

// Yahoo Finance — free gold OHLC (no key needed)
const YAHOO_SYMBOL = 'GC%3DF'; // Gold futures (GC=F URL-encoded)

// Ensure cache dir
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// --- Helpers ---

function apiRequest(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        params.apiKey = API_KEY;
        const qs = new URLSearchParams(params).toString();
        const url = `${API_BASE}${endpoint}?${qs}`;

        https.get(url, { headers: { 'x-api-key': API_KEY } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON: ' + data.substring(0, 200)));
                }
            });
        }).on('error', reject);
    });
}

function getCacheKey(name) {
    return path.join(CACHE_DIR, name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
}

function readCache(name, maxAgeMs = Infinity) {
    const file = getCacheKey(name);
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function writeCache(name, data) {
    fs.writeFileSync(getCacheKey(name), JSON.stringify(data), 'utf8');
}

// --- Gold Historical Data Fetcher ---
// Fetches OHLC data one date at a time via /v2/rates/historical
// Uses aggressive caching so we only call the API once per date

async function fetchGoldDate(dateStr) {
    const cacheKey = `gold_${dateStr}`;
    const cached = readCache(cacheKey);
    if (cached) return cached;

    try {
        const resp = await apiRequest('/rates/historical', {
            symbols: 'XAU',
            date: dateStr,
        });

        if (resp.success && resp.rates && resp.rates.XAU) {
            const bar = {
                time: resp.rates.XAU.date || dateStr,
                open: resp.rates.XAU.open,
                high: resp.rates.XAU.high,
                low: resp.rates.XAU.low,
                close: resp.rates.XAU.close,
            };
            writeCache(cacheKey, bar);
            return bar;
        }
        return null;
    } catch (err) {
        console.error(`Error fetching ${dateStr}:`, err.message);
        return null;
    }
}

// Generate weekly date list between two dates
function getWeeklyDates(startStr, endStr) {
    const dates = [];
    const start = new Date(startStr);
    const end = new Date(endStr);
    const cursor = new Date(start);

    // Align to Monday
    cursor.setDate(cursor.getDate() - cursor.getDay() + 1);

    while (cursor <= end) {
        dates.push(cursor.toISOString().split('T')[0]);
        cursor.setDate(cursor.getDate() + 7);
    }
    return dates;
}

// Generate daily date list (skip weekends)
function getDailyDates(startStr, endStr) {
    const dates = [];
    const start = new Date(startStr);
    const end = new Date(endStr);
    const cursor = new Date(start);

    while (cursor <= end) {
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) {
            dates.push(cursor.toISOString().split('T')[0]);
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
}

// ============================================
// GOLD PRICE DATA — Multi-source with fallbacks
// Uses Yahoo Finance v8 with crumb auth, plus
// Frankfurter + open exchange fallbacks
// ============================================

// Yahoo Finance request via query2 (works from cloud servers without crumb)
function yahooRequest(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
            },
            timeout: 15000,
        }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return yahooRequest(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Yahoo parse error (${res.statusCode}): ${data.substring(0, 300)}`));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Yahoo request timeout')); });
        req.on('error', reject);
    });
}

// Convert Yahoo Finance chart response to OHLC bars
function parseYahooChart(json) {
    const result = json?.chart?.result?.[0];
    if (!result || !result.timestamp) return [];

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!quote) return [];

    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;

        const date = new Date(timestamps[i] * 1000);
        const dateStr = date.toISOString().split('T')[0];

        bars.push({
            time: dateStr,
            open: Math.round(o * 100) / 100,
            high: Math.round(h * 100) / 100,
            low: Math.round(l * 100) / 100,
            close: Math.round(c * 100) / 100,
        });
    }

    const seen = new Set();
    return bars.filter(b => {
        if (seen.has(b.time)) return false;
        seen.add(b.time);
        return true;
    });
}

// --- Pre-fetched data fallback (for cloud hosts where Yahoo is blocked) ---
const PREFETCH_FILE = path.join(__dirname, 'gold-ohlc-prefetch.json');

function loadPrefetchedData() {
    try {
        if (fs.existsSync(PREFETCH_FILE)) {
            return JSON.parse(fs.readFileSync(PREFETCH_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load prefetch file:', e.message);
    }
    return null;
}

// --- API Routes ---

// GET /api/usage — check if data source is available
app.get('/api/usage', async (req, res) => {
    res.json({
        plan: 'multi-source',
        source: 'Yahoo Finance / Prefetched Data',
        used: 0,
        quota: 'unlimited',
        note: 'Free OHLC data — auto-fallback if Yahoo is blocked',
    });
});

// GET /api/latest — latest gold price
app.get('/api/latest', async (req, res) => {
    const cacheKey = 'gold_latest_v4';
    const cached = readCache(cacheKey, 5 * 60 * 1000); // 5 min cache
    if (cached) return res.json(cached);

    // Try Yahoo Finance
    try {
        const url = 'https://query2.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1m&range=1d';
        const json = await yahooRequest(url);
        const meta = json?.chart?.result?.[0]?.meta;

        if (meta && meta.regularMarketPrice) {
            const data = {
                success: true,
                source: 'yahoo',
                rates: { XAU: meta.regularMarketPrice },
                previousClose: meta.chartPreviousClose || meta.previousClose,
                timestamp: new Date().toISOString(),
            };
            writeCache(cacheKey, data);
            return res.json(data);
        }
    } catch (err) {
        console.log('Yahoo latest failed:', err.message);
    }

    // Fallback: CommodityPriceAPI if key exists
    if (API_KEY) {
        try {
            const data = await apiRequest('/rates/latest', { symbols: 'XAU' });
            if (data.success) { writeCache(cacheKey, data); return res.json(data); }
        } catch (e) { /* fall through */ }
    }

    // Fallback: latest price from prefetched data
    const prefetch = loadPrefetchedData();
    if (prefetch && prefetch.latestPrice) {
        const data = {
            success: true,
            source: 'prefetched',
            rates: { XAU: prefetch.latestPrice },
            fetchedAt: prefetch.fetchedAt,
            timestamp: new Date().toISOString(),
        };
        return res.json(data);
    }

    res.status(500).json({ error: 'All gold price sources failed' });
});

// GET /api/gold?interval=weekly|daily — full gold OHLC history
app.get('/api/gold', async (req, res) => {
    const { interval } = req.query;
    const yahooInterval = interval === 'daily' ? '1d' : '1wk';
    const cacheKey = `gold_ohlc_v3_${yahooInterval}`;
    const cached = readCache(cacheKey, 60 * 60 * 1000); // 1h cache
    if (cached) return res.json(cached);

    // Try Yahoo Finance first
    try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=${yahooInterval}&range=max`;
        console.log(`Fetching gold OHLC from Yahoo Finance (${yahooInterval})...`);
        const json = await yahooRequest(url);
        const bars = parseYahooChart(json);

        if (bars.length > 0) {
            const response = { success: true, source: 'yahoo', count: bars.length, data: bars };
            writeCache(cacheKey, response);
            console.log(`  → Got ${bars.length} bars from Yahoo Finance`);
            return res.json(response);
        }
    } catch (err) {
        console.log('Yahoo Finance OHLC failed:', err.message);
    }

    // Fallback: CommodityPriceAPI if key exists
    if (API_KEY) {
        try {
            const { start, end } = req.query;
            const s = start || '2000-01-01';
            const e = end || new Date().toISOString().split('T')[0];
            const dates = (interval === 'daily') ? getDailyDates(s, e) : getWeeklyDates(s, e);
            const results = [];
            for (const d of dates) {
                const bar = await fetchGoldDate(d);
                if (bar && bar.open && bar.close) results.push(bar);
            }
            if (results.length > 0) {
                const response = { success: true, source: 'commodity-api', count: results.length, data: results };
                writeCache(cacheKey, response);
                return res.json(response);
            }
        } catch (e) { console.error('CommodityAPI fallback error:', e.message); }
    }

    // Fallback: serve pre-fetched data from repo
    const prefetch = loadPrefetchedData();
    if (prefetch && prefetch.data && prefetch.data.length > 0) {
        console.log(`Serving ${prefetch.count} prefetched gold bars (fetched: ${prefetch.fetchedAt})`);
        return res.json(prefetch);
    }

    res.status(500).json({ error: 'All gold OHLC sources failed' });
});

// ============================================
// NEWS AGGREGATION — Multi-source gold news
// ============================================

const GOLD_KEYWORDS = ['gold', 'XAU', 'precious metal', 'bullion', 'Fed', 'inflation', 'central bank', 'interest rate', 'treasury', 'dollar', 'tariff', 'China', 'trade war', 'sanctions', 'PBOC', 'yuan'];

// Strip HTML tags and decode entities
function cleanHTML(str) {
    if (!str) return '';
    return str
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, '"')
        .replace(/&ldquo;/g, '"')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&#\d+;/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const defaultHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GoldSentimentBot/1.0' };
        mod.get(url, { headers: { ...defaultHeaders, ...headers } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
    });
}

// --- NewsAPI.org (Gold + US/China macro focus) ---
async function fetchNewsAPI() {
    if (!NEWSAPI_KEY) return [];
    try {
        const query = encodeURIComponent('(gold OR XAU OR bullion OR "gold price") AND (Fed OR inflation OR tariff OR China OR "trade war" OR "interest rate" OR treasury OR "central bank" OR sanctions)');
        const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${NEWSAPI_KEY}`;
        const resp = await httpGet(url);
        const json = JSON.parse(resp.data);
        if (json.status !== 'ok' || !json.articles) return [];
        return json.articles.map(a => ({
            title: a.title,
            description: a.description || '',
            url: a.url,
            source: a.source?.name || 'NewsAPI',
            publishedAt: a.publishedAt,
            image: a.urlToImage || null,
            provider: 'newsapi',
        }));
    } catch (err) {
        console.error('NewsAPI error:', err.message);
        return [];
    }
}

// --- GNews ---
async function fetchGNews() {
    if (!GNEWS_KEY) return [];
    try {
        const url = `https://gnews.io/api/v4/search?q=gold+price+OR+XAU+OR+bullion&lang=en&max=20&apikey=${GNEWS_KEY}`;
        const resp = await httpGet(url);
        const json = JSON.parse(resp.data);
        if (!json.articles) return [];
        return json.articles.map(a => ({
            title: a.title,
            description: a.description || '',
            url: a.url,
            source: a.source?.name || 'GNews',
            publishedAt: a.publishedAt,
            image: a.image || null,
            provider: 'gnews',
        }));
    } catch (err) {
        console.error('GNews error:', err.message);
        return [];
    }
}

// --- Finnhub ---
async function fetchFinnhub() {
    if (!FINNHUB_KEY) return [];
    try {
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
        const url = `https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB_KEY}`;
        const resp = await httpGet(url);
        const json = JSON.parse(resp.data);
        if (!Array.isArray(json)) return [];
        // Filter for gold-related headlines
        const goldNews = json.filter(a => {
            const text = (a.headline + ' ' + (a.summary || '')).toLowerCase();
            return GOLD_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
        });
        return goldNews.slice(0, 20).map(a => ({
            title: a.headline,
            description: a.summary || '',
            url: a.url,
            source: a.source || 'Finnhub',
            publishedAt: new Date(a.datetime * 1000).toISOString(),
            image: a.image || null,
            provider: 'finnhub',
        }));
    } catch (err) {
        console.error('Finnhub error:', err.message);
        return [];
    }
}

// --- RSS Feeds (Kitco, Reuters commodities) ---
async function fetchRSSFeed(feedUrl, sourceName) {
    try {
        const resp = await httpGet(feedUrl);
        const parser = new XMLParser({ ignoreAttributes: false });
        const xml = parser.parse(resp.data);

        let items = [];
        if (xml.rss && xml.rss.channel && xml.rss.channel.item) {
            items = Array.isArray(xml.rss.channel.item) ? xml.rss.channel.item : [xml.rss.channel.item];
        } else if (xml.feed && xml.feed.entry) {
            items = Array.isArray(xml.feed.entry) ? xml.feed.entry : [xml.feed.entry];
        }

        return items.slice(0, 15).map(item => {
            const title = item.title?.['#text'] || item.title || '';
            const link = item.link?.['@_href'] || item.link || '';
            const desc = item.description || item.summary?.['#text'] || item.summary || '';
            const pubDate = item.pubDate || item.published || item.updated || '';

            return {
                title: cleanHTML(typeof title === 'string' ? title : String(title)),
                description: cleanHTML(typeof desc === 'string' ? desc : '').substring(0, 300),
                url: typeof link === 'string' ? link : '',
                source: sourceName,
                publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
                image: null,
                provider: 'rss',
            };
        }).filter(a => a.title && a.url);
    } catch (err) {
        console.error(`RSS ${sourceName} error:`, err.message);
        return [];
    }
}

async function fetchAllRSS() {
    const feeds = [
        { url: 'https://news.google.com/rss/search?q=%22gold+price%22+OR+XAU+OR+bullion+OR+%22gold+market%22&hl=en-US&gl=US&ceid=US:en', name: 'Google News' },
        { url: 'https://news.google.com/rss/search?q=gold+tariff+OR+gold+China+OR+gold+Fed+OR+%22gold+inflation%22&hl=en-US&gl=US&ceid=US:en', name: 'Google News (Macro)' },
        { url: 'https://www.kitco.com/feed/rss/news/gold.xml', name: 'Kitco' },
        { url: 'https://www.investing.com/rss/news_301.rss', name: 'Investing.com' },
    ];

    const results = await Promise.allSettled(
        feeds.map(f => fetchRSSFeed(f.url, f.name))
    );

    return results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value);
}

// --- Aggregate all news sources ---
async function aggregateNews() {
    const [newsapi, gnews, finnhub, rss] = await Promise.allSettled([
        fetchNewsAPI(),
        fetchGNews(),
        fetchFinnhub(),
        fetchAllRSS(),
    ]);

    const all = [
        ...(newsapi.status === 'fulfilled' ? newsapi.value : []),
        ...(gnews.status === 'fulfilled' ? gnews.value : []),
        ...(finnhub.status === 'fulfilled' ? finnhub.value : []),
        ...(rss.status === 'fulfilled' ? rss.value : []),
    ];

    // Deduplicate by title similarity
    const seen = new Set();
    const deduped = all.filter(a => {
        const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Sort by date (newest first)
    deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Score relevance to gold and filter out irrelevant articles
    deduped.forEach(article => {
        const text = (article.title + ' ' + article.description).toLowerCase();
        let score = 0;

        // Direct gold mentions (highest weight)
        if (text.includes('gold')) score += 4;
        if (text.includes('xau')) score += 4;
        if (text.includes('bullion')) score += 3;
        if (text.includes('precious metal')) score += 3;
        if (text.includes('silver') && text.includes('gold')) score += 2;

        // Macro drivers that directly move gold
        if (text.includes('fed') || text.includes('federal reserve')) score += 2;
        if (text.includes('inflation') || text.includes('cpi')) score += 2;
        if (text.includes('interest rate') || text.includes('rate cut') || text.includes('rate hike')) score += 2;
        if (text.includes('central bank')) score += 2;
        if (text.includes('treasury') || text.includes('bond yield')) score += 1;
        if (text.includes('dollar') || text.includes('dxy') || text.includes('usd')) score += 1;

        // US/China geopolitics (major gold driver)
        if (text.includes('china') || text.includes('beijing') || text.includes('pboc')) score += 2;
        if (text.includes('tariff') || text.includes('trade war') || text.includes('sanctions')) score += 2;
        if (text.includes('yuan') || text.includes('renminbi')) score += 1;
        if (text.includes('geopolit') || text.includes('war') || text.includes('conflict')) score += 1;
        if (text.includes('de-dollarization') || text.includes('brics')) score += 2;

        // Sentiment hints
        let sentiment = 'neutral';
        if (text.includes('surge') || text.includes('rally') || text.includes('record') || text.includes('soar') || text.includes('rise') || text.includes('gain') || text.includes('all-time') || text.includes('breakout')) {
            sentiment = 'bullish';
        } else if (text.includes('drop') || text.includes('fall') || text.includes('decline') || text.includes('plunge') || text.includes('crash') || text.includes('sell') || text.includes('slump')) {
            sentiment = 'bearish';
        }

        article.relevanceScore = score;
        article.sentiment = sentiment;
    });

    // FILTER: only keep articles with relevance score >= 2 (must mention gold or a direct driver)
    const filtered = deduped.filter(a => a.relevanceScore >= 2);

    // Sort by relevance first, then by date
    filtered.sort((a, b) => {
        if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
        return new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    return filtered;
}

// --- News API Route ---
app.get('/api/news', async (req, res) => {
    const cacheKey = 'news_feed_v2';
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh) {
        const cached = readCache(cacheKey, 10 * 60 * 1000); // 10 min cache
        if (cached) return res.json(cached);
    }

    try {
        const articles = await aggregateNews();
        const response = {
            success: true,
            count: articles.length,
            sources: {
                newsapi: NEWSAPI_KEY ? 'active' : 'no key',
                gnews: GNEWS_KEY ? 'active' : 'no key',
                finnhub: FINNHUB_KEY ? 'active' : 'no key',
                rss: 'active',
            },
            articles,
            fetchedAt: new Date().toISOString(),
        };
        writeCache(cacheKey, response);
        res.json(response);
    } catch (err) {
        console.error('News aggregation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gold Sentiment Model server running on http://0.0.0.0:${PORT}`);
    console.log(`API calls cached to: ${CACHE_DIR}`);
});
