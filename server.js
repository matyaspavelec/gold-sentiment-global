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

// --- Config ---
const API_KEY = process.env.COMMODITY_API_KEY || '';
const API_BASE = 'https://api.commoditypriceapi.com/v2';
const CACHE_DIR = path.join(__dirname, '.cache');
const PORT = process.env.PORT || 8090;

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

// --- API Routes ---

// GET /api/usage — check API quota
app.get('/api/usage', async (req, res) => {
    try {
        const data = await apiRequest('/usage');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/latest — latest gold price
app.get('/api/latest', async (req, res) => {
    const cacheKey = 'gold_latest';
    const cached = readCache(cacheKey, 10 * 60 * 1000); // 10 min cache
    if (cached) return res.json(cached);

    try {
        const data = await apiRequest('/rates/latest', { symbols: 'XAU' });
        if (data.success) {
            writeCache(cacheKey, data);
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/gold?start=YYYY-MM-DD&end=YYYY-MM-DD&interval=weekly|daily
// Fetches gold OHLC data. Uses cache aggressively.
// For large ranges, fetches weekly to conserve API calls.
app.get('/api/gold', async (req, res) => {
    const { start, end, interval } = req.query;
    if (!start || !end) {
        return res.status(400).json({ error: 'start and end dates required (YYYY-MM-DD)' });
    }

    const masterCacheKey = `gold_series_${interval || 'weekly'}_${start}_${end}`;
    const cached = readCache(masterCacheKey, 24 * 60 * 60 * 1000); // 24h cache for full series
    if (cached) return res.json(cached);

    const dates = (interval === 'daily')
        ? getDailyDates(start, end)
        : getWeeklyDates(start, end);

    console.log(`Fetching ${dates.length} gold data points (${interval || 'weekly'}) from ${start} to ${end}`);

    // Check how many are already cached
    const uncached = dates.filter(d => !readCache(`gold_${d}`));
    console.log(`  → ${dates.length - uncached.length} cached, ${uncached.length} need API calls`);

    // Fetch in batches of 5 with delay to respect rate limits
    const BATCH_SIZE = 5;
    const BATCH_DELAY = 1200; // ms between batches

    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
        const batch = uncached.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(d => fetchGoldDate(d)));

        if (i + BATCH_SIZE < uncached.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
    }

    // Collect all results
    const results = [];
    for (const d of dates) {
        const bar = readCache(`gold_${d}`);
        if (bar && bar.open && bar.close) {
            results.push(bar);
        }
    }

    // Deduplicate by date
    const seen = new Set();
    const deduped = results.filter(r => {
        if (seen.has(r.time)) return false;
        seen.add(r.time);
        return true;
    }).sort((a, b) => a.time.localeCompare(b.time));

    const response = { success: true, count: deduped.length, data: deduped };
    writeCache(masterCacheKey, response);
    res.json(response);
});

// GET /api/gold/range — quick fetch using fluctuation endpoint (no API call per day)
app.get('/api/gold/range', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) {
        return res.status(400).json({ error: 'start and end dates required' });
    }

    const cacheKey = `gold_fluct_${start}_${end}`;
    const cached = readCache(cacheKey, 60 * 60 * 1000);
    if (cached) return res.json(cached);

    try {
        const data = await apiRequest('/rates/fluctuation', {
            symbols: 'XAU',
            startDate: start,
            endDate: end,
        });
        if (data.success) writeCache(cacheKey, data);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/historical/:date — single date OHLC
app.get('/api/historical/:date', async (req, res) => {
    const bar = await fetchGoldDate(req.params.date);
    if (bar) {
        res.json({ success: true, data: bar });
    } else {
        res.status(404).json({ error: 'No data for date' });
    }
});

// --- Prefetch helper endpoint ---
// POST /api/prefetch — trigger background fetch for a date range
app.post('/api/prefetch', express.json(), async (req, res) => {
    const { start, end, interval } = req.body;
    if (!start || !end) return res.status(400).json({ error: 'need start/end' });

    // Return immediately, fetch in background
    res.json({ status: 'prefetching', start, end, interval: interval || 'weekly' });

    const dates = (interval === 'daily')
        ? getDailyDates(start, end)
        : getWeeklyDates(start, end);

    const uncached = dates.filter(d => !readCache(`gold_${d}`));
    console.log(`Prefetching ${uncached.length}/${dates.length} dates...`);

    const BATCH_SIZE = 5;
    const BATCH_DELAY = 1200;

    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
        const batch = uncached.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(d => fetchGoldDate(d)));
        if (i + BATCH_SIZE < uncached.length) {
            await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
    }
    console.log(`Prefetch complete: ${start} to ${end}`);
});

// --- Start ---
app.listen(PORT, () => {
    console.log(`Gold Sentiment Model server running on http://localhost:${PORT}`);
    console.log(`API calls cached to: ${CACHE_DIR}`);
});
