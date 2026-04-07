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
// YAHOO FINANCE — Free Gold OHLC (no API key)
// ============================================

function yahooRequest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Yahoo parse error: ' + data.substring(0, 200)));
                }
            });
        }).on('error', reject);
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

    // Deduplicate by date
    const seen = new Set();
    return bars.filter(b => {
        if (seen.has(b.time)) return false;
        seen.add(b.time);
        return true;
    });
}

// --- API Routes ---

// GET /api/usage — check if data source is available
app.get('/api/usage', async (req, res) => {
    // Yahoo Finance is always available (free, no key)
    res.json({
        plan: 'yahoo-finance-free',
        source: 'Yahoo Finance',
        used: 0,
        quota: 'unlimited',
        note: 'Free OHLC data via Yahoo Finance — no API key needed',
    });
});

// GET /api/latest — latest gold price via Yahoo Finance
app.get('/api/latest', async (req, res) => {
    const cacheKey = 'yahoo_gold_latest';
    const cached = readCache(cacheKey, 5 * 60 * 1000); // 5 min cache
    if (cached) return res.json(cached);

    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d`;
        const json = await yahooRequest(url);
        const result = json?.chart?.result?.[0];
        const meta = result?.meta;

        if (meta && meta.regularMarketPrice) {
            const data = {
                success: true,
                source: 'yahoo',
                rates: { XAU: meta.regularMarketPrice },
                previousClose: meta.chartPreviousClose || meta.previousClose,
                marketState: meta.marketState,
                timestamp: new Date().toISOString(),
            };
            writeCache(cacheKey, data);
            res.json(data);
        } else {
            throw new Error('No price data from Yahoo');
        }
    } catch (err) {
        // Fallback: try CommodityPriceAPI if key exists
        if (API_KEY) {
            try {
                const data = await apiRequest('/rates/latest', { symbols: 'XAU' });
                if (data.success) writeCache(cacheKey, data);
                return res.json(data);
            } catch (e) { /* fall through */ }
        }
        res.status(500).json({ error: err.message });
    }
});

// GET /api/gold?interval=weekly|daily — full gold OHLC via Yahoo Finance
// Yahoo supports range params: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
app.get('/api/gold', async (req, res) => {
    const { interval } = req.query;
    const yahooInterval = interval === 'daily' ? '1d' : '1wk';
    const cacheKey = `yahoo_gold_${yahooInterval}`;
    const cached = readCache(cacheKey, 60 * 60 * 1000); // 1h cache
    if (cached) return res.json(cached);

    try {
        // Fetch max range for full history
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${yahooInterval}&range=max`;
        console.log(`Fetching gold OHLC from Yahoo Finance (${yahooInterval})...`);
        const json = await yahooRequest(url);
        const bars = parseYahooChart(json);

        if (bars.length > 0) {
            const response = { success: true, source: 'yahoo', count: bars.length, data: bars };
            writeCache(cacheKey, response);
            console.log(`  → Got ${bars.length} bars from Yahoo Finance`);
            res.json(response);
        } else {
            throw new Error('No OHLC data from Yahoo Finance');
        }
    } catch (err) {
        console.error('Yahoo Finance error:', err.message);
        // Fallback: try CommodityPriceAPI if key exists
        if (API_KEY) {
            try {
                const { start, end } = req.query;
                if (start && end) {
                    const dates = (interval === 'daily')
                        ? getDailyDates(start, end)
                        : getWeeklyDates(start, end);
                    const results = [];
                    for (const d of dates) {
                        const bar = await fetchGoldDate(d);
                        if (bar && bar.open && bar.close) results.push(bar);
                    }
                    return res.json({ success: true, source: 'commodity-api', count: results.length, data: results });
                }
            } catch (e) { /* fall through */ }
        }
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// NEWS AGGREGATION — Multi-source gold news
// ============================================

const GOLD_KEYWORDS = ['gold', 'XAU', 'precious metal', 'bullion', 'Fed', 'inflation', 'central bank', 'interest rate', 'treasury', 'dollar', 'tariff', 'China', 'trade war', 'sanctions', 'PBOC', 'yuan'];

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
                title: typeof title === 'string' ? title : String(title),
                description: typeof desc === 'string' ? desc.replace(/<[^>]*>/g, '').substring(0, 300) : '',
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
        { url: 'https://news.google.com/rss/search?q=gold+price+OR+XAU+OR+bullion&hl=en-US&gl=US&ceid=US:en', name: 'Google News' },
        { url: 'https://news.google.com/rss/search?q=gold+Fed+inflation+interest+rate&hl=en-US&gl=US&ceid=US:en', name: 'Google News (Macro)' },
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

    // Score relevance to gold
    deduped.forEach(article => {
        const text = (article.title + ' ' + article.description).toLowerCase();
        let score = 0;
        if (text.includes('gold')) score += 3;
        if (text.includes('xau')) score += 3;
        if (text.includes('bullion')) score += 2;
        if (text.includes('precious metal')) score += 2;
        if (text.includes('fed') || text.includes('federal reserve')) score += 1;
        if (text.includes('inflation')) score += 1;
        if (text.includes('interest rate')) score += 1;
        if (text.includes('central bank')) score += 1;
        if (text.includes('treasury')) score += 1;
        if (text.includes('dollar') || text.includes('dxy')) score += 1;
        if (text.includes('china') || text.includes('beijing') || text.includes('pboc')) score += 2;
        if (text.includes('tariff') || text.includes('trade war') || text.includes('sanctions')) score += 2;
        if (text.includes('yuan') || text.includes('renminbi')) score += 1;
        if (text.includes('us') || text.includes('america') || text.includes('washington')) score += 1;

        // Sentiment hints
        let sentiment = 'neutral';
        if (text.includes('surge') || text.includes('rally') || text.includes('high') || text.includes('soar') || text.includes('rise') || text.includes('gain')) {
            sentiment = 'bullish';
        } else if (text.includes('drop') || text.includes('fall') || text.includes('decline') || text.includes('low') || text.includes('crash') || text.includes('sell')) {
            sentiment = 'bearish';
        }

        article.relevanceScore = score;
        article.sentiment = sentiment;
    });

    return deduped;
}

// --- News API Route ---
app.get('/api/news', async (req, res) => {
    const cacheKey = 'news_feed';
    const cached = readCache(cacheKey, 15 * 60 * 1000); // 15 min cache
    if (cached) return res.json(cached);

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
