// ============================================
// GOLD SENTIMENT MODEL — Application
// ============================================

(function () {
    'use strict';

    // --- State ---
    let mainChart = null;
    let candleSeries = null;
    let markerSeries = null;
    let activeEvent = null;
    let currentTimeframe = 'D';
    let currentView = 'overview';
    let liveGoldData = null;   // Populated from API when available
    let apiAvailable = false;
    let latestLivePrice = null;

    // --- DOM Refs ---
    const $mainChart = document.getElementById('mainChart');
    const $detailPanel = document.getElementById('detailPanel');
    const $detailContent = document.getElementById('detailContent');
    const $detailClose = document.getElementById('detailClose');
    const $currentPrice = document.getElementById('currentPrice');
    const $currentChange = document.getElementById('currentChange');
    const $eventTimeline = document.getElementById('eventTimeline');
    const $positiveCorr = document.getElementById('positiveCorrelations');
    const $negativeCorr = document.getElementById('negativeCorrelations');
    const $presidentsGrid = document.getElementById('presidentsGrid');
    const $presidentsSection = document.getElementById('presidentsSection');
    const $correlationsSection = document.getElementById('correlationsSection');

    // --- API Helpers ---
    async function apiFetch(path) {
        const resp = await fetch('/api' + path);
        if (!resp.ok) throw new Error(`API ${resp.status}`);
        return resp.json();
    }

    // Fetch live gold data from backend
    async function fetchLiveGoldData() {
        try {
            // First check if API is available
            const usage = await apiFetch('/usage');
            if (!usage.plan) return false;

            apiAvailable = true;
            console.log(`API connected — plan: ${usage.plan}, used: ${usage.used}/${usage.quota}`);

            // Fetch latest price
            try {
                const latest = await apiFetch('/latest');
                if (latest.success && latest.rates && latest.rates.XAU) {
                    latestLivePrice = latest.rates.XAU;
                    console.log(`Live gold price: $${latestLivePrice}`);
                }
            } catch (e) {
                console.warn('Could not fetch latest price:', e.message);
            }

            // Fetch weekly historical data (conserves API calls)
            // Start from 2000 to cover full history
            const today = new Date().toISOString().split('T')[0];
            const data = await apiFetch(`/gold?start=2000-01-01&end=${today}&interval=weekly`);

            if (data.success && data.data && data.data.length > 0) {
                liveGoldData = data.data;
                console.log(`Loaded ${data.count} live gold OHLC bars`);
                return true;
            }
            return false;
        } catch (err) {
            console.log('API not available, using generated data:', err.message);
            return false;
        }
    }

    // Get the active dataset (live or generated)
    function getGoldData() {
        return liveGoldData || GOLD_DATA;
    }

    // --- Init ---
    async function init() {
        // Bind all interactions FIRST so buttons always work
        bindNavigation();
        bindTimeframe();
        bindDetailClose();
        bindChartControls();
        bindNewsControls();

        // Then render content (wrapped in try/catch so errors don't kill the page)
        try { createMainChart(); } catch (e) { console.error('Chart error:', e); }
        try { renderCrisisLegend(); } catch (e) { console.error('Crisis legend error:', e); }
        try { renderEventTimeline(); } catch (e) { console.error('Event timeline error:', e); }
        try { renderCorrelations(); } catch (e) { console.error('Correlations error:', e); }
        try { renderPresidents(); } catch (e) { console.error('Presidents error:', e); }
        updatePriceDisplay();
        try { renderSentimentGauge(); } catch (e) { console.error('Sentiment gauge error:', e); }
        updateView();

        // Hide loading overlay
        hideLoading();

        // Load news feed in sidebar
        fetchNews();

        // Then try to load live data in background
        const hasLive = await fetchLiveGoldData();
        if (hasLive) {
            // Re-render chart with live data
            console.log('Switching to live API data...');
            createMainChart();
            updatePriceDisplay();
            showDataSourceBadge(true);
        } else {
            showDataSourceBadge(false);
        }
    }

    function hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function showDataSourceBadge(isLive) {
        let badge = document.getElementById('dataSourceBadge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'dataSourceBadge';
            badge.style.cssText = 'font-size:0.6rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:0.2rem 0.6rem;border-radius:4px;margin-left:1rem;';
            document.querySelector('.chart-title-group').appendChild(badge);
        }
        if (isLive) {
            badge.textContent = 'LIVE';
            badge.style.color = '#4ade80';
            badge.style.background = 'rgba(74,222,128,0.1)';
            badge.style.border = '1px solid rgba(74,222,128,0.2)';
        } else {
            badge.textContent = 'SAMPLE DATA';
            badge.style.color = '#b0b0b8';
            badge.style.background = 'rgba(255,255,255,0.05)';
            badge.style.border = '1px solid rgba(255,255,255,0.1)';
        }
    }

    // --- Main Chart ---
    function createMainChart() {
        if (mainChart) {
            mainChart.remove();
            mainChart = null;
        }

        mainChart = LightweightCharts.createChart($mainChart, {
            width: $mainChart.clientWidth,
            height: $mainChart.clientHeight,
            layout: {
                background: { type: 'solid', color: '#111117' },
                textColor: '#b0b0b8',
                fontFamily: "'Inter', sans-serif",
                fontSize: 11,
            },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.03)' },
                horzLines: { color: 'rgba(255,255,255,0.03)' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: {
                    color: 'rgba(201, 168, 76, 0.3)',
                    width: 1,
                    style: LightweightCharts.LineStyle.Dashed,
                    labelBackgroundColor: '#1a1a1f',
                },
                horzLine: {
                    color: 'rgba(201, 168, 76, 0.3)',
                    width: 1,
                    style: LightweightCharts.LineStyle.Dashed,
                    labelBackgroundColor: '#1a1a1f',
                },
            },
            rightPriceScale: {
                borderColor: 'rgba(255,255,255,0.06)',
                scaleMargins: { top: 0.08, bottom: 0.15 },
            },
            timeScale: {
                borderColor: 'rgba(255,255,255,0.06)',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 5,
                barSpacing: 6,
            },
            handleScroll: { vertTouchDrag: false },
        });

        const chartData = getDataForTimeframe(currentTimeframe);

        // 1) Presidential term background bands (lowest layer)
        PRESIDENTIAL_PERIODS.forEach(pres => {
            const presData = chartData
                .filter(bar => bar.time >= pres.start && bar.time <= pres.end)
                .map(bar => ({ time: bar.time, value: bar.high * 1.25 }));

            if (presData.length > 0) {
                const isRep = pres.party === 'republican';
                const bgSeries = mainChart.addAreaSeries({
                    topColor: isRep ? 'rgba(248, 113, 113, 0.035)' : 'rgba(96, 165, 250, 0.035)',
                    bottomColor: isRep ? 'rgba(248, 113, 113, 0.01)' : 'rgba(96, 165, 250, 0.01)',
                    lineColor: isRep ? 'rgba(248, 113, 113, 0.12)' : 'rgba(96, 165, 250, 0.12)',
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Solid,
                    crosshairMarkerVisible: false,
                    priceLineVisible: false,
                    lastValueVisible: false,
                });
                bgSeries.setData(presData);
            }
        });

        // 2) Crisis zone overlays (above presidential bands)
        CRISIS_PERIODS.forEach(crisis => {
            const highlightData = chartData
                .filter(bar => bar.time >= crisis.start && bar.time <= crisis.end)
                .map(bar => ({ time: bar.time, value: bar.high * 1.15 }));

            if (highlightData.length > 0) {
                const bgSeries = mainChart.addAreaSeries({
                    topColor: crisis.color,
                    bottomColor: crisis.color,
                    lineColor: crisis.borderColor,
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dotted,
                    crosshairMarkerVisible: false,
                    priceLineVisible: false,
                    lastValueVisible: false,
                });
                bgSeries.setData(highlightData);
            }
        });

        // 3) Volume-style histogram (shows price change magnitude)
        const volumeSeries = mainChart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
            color: '#c9a84c',
        });
        mainChart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });
        const volumeData = chartData.map(bar => {
            const change = Math.abs(bar.close - bar.open);
            const isUp = bar.close >= bar.open;
            return {
                time: bar.time,
                value: change * 100,
                color: isUp ? 'rgba(201, 168, 76, 0.25)' : 'rgba(90, 79, 58, 0.35)',
            };
        });
        volumeSeries.setData(volumeData);

        // 4) SMA 50 overlay for trend context
        const sma50Data = calculateSMA(chartData, 50);
        if (sma50Data.length > 0) {
            const smaSeries = mainChart.addLineSeries({
                color: 'rgba(123, 140, 173, 0.4)',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Solid,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            smaSeries.setData(sma50Data);
        }

        // 5) SMA 200 overlay
        const sma200Data = calculateSMA(chartData, 200);
        if (sma200Data.length > 0) {
            const sma200Series = mainChart.addLineSeries({
                color: 'rgba(201, 168, 76, 0.25)',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed,
                crosshairMarkerVisible: false,
                priceLineVisible: false,
                lastValueVisible: false,
            });
            sma200Series.setData(sma200Data);
        }

        // 6) Candlestick series (main layer)
        candleSeries = mainChart.addCandlestickSeries({
            upColor: '#c9a84c',
            downColor: '#5a4f3a',
            borderUpColor: '#c9a84c',
            borderDownColor: '#5a4f3a',
            wickUpColor: '#c9a84c',
            wickDownColor: '#5a4f3a',
        });
        candleSeries.setData(chartData);

        // 7) Event markers
        const markers = GOLD_EVENTS.map(evt => ({
            time: evt.date,
            position: evt.direction === 'bullish' ? 'belowBar' : 'aboveBar',
            color: evt.direction === 'bullish' ? '#4ade80' : '#f87171',
            shape: evt.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
            text: evt.title.length > 25 ? evt.title.substring(0, 25) + '...' : evt.title,
        })).sort((a, b) => a.time.localeCompare(b.time));
        candleSeries.setMarkers(markers);

        // 8) Floating tooltip on crosshair
        createTooltip();
        mainChart.subscribeCrosshairMove(param => {
            if (!param || !param.time) {
                updatePriceDisplay();
                hideTooltip();
                return;
            }
            const data = param.seriesData ? param.seriesData.get(candleSeries) : null;
            if (data) {
                $currentPrice.textContent = '$' + data.close.toLocaleString('en-US', { minimumFractionDigits: 2 });

                // Find which president & crisis this date falls in
                let timeStr;
                if (typeof param.time === 'string') { timeStr = param.time; }
                else if (param.time.year) {
                    timeStr = `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`;
                }
                const pres = PRESIDENTIAL_PERIODS.find(p => timeStr >= p.start && timeStr <= p.end);
                const crisis = CRISIS_PERIODS.find(c => timeStr >= c.start && timeStr <= c.end);

                showTooltip(param.point, data, pres, crisis, timeStr);
            }
        });

        // Click to select nearest event
        mainChart.subscribeClick(param => {
            if (!param || !param.time) return;
            const clickedTime = param.time;
            const nearest = findNearestEvent(clickedTime);
            if (nearest) {
                selectEvent(nearest.id);
            }
        });

        // Handle resize
        const resizeObserver = new ResizeObserver(() => {
            mainChart.applyOptions({
                width: $mainChart.clientWidth,
                height: $mainChart.clientHeight,
            });
        });
        resizeObserver.observe($mainChart);

        mainChart.timeScale().fitContent();
    }

    function getDataForTimeframe(tf) {
        const data = getGoldData();
        if (tf === 'W') {
            return aggregateToWeekly(data);
        } else if (tf === '4H') {
            return expandTo4H(data);
        }
        return data;
    }

    function aggregateToWeekly(data) {
        const weeks = [];
        let current = null;

        for (const bar of data) {
            const d = new Date(bar.time);
            const weekStart = new Date(d);
            weekStart.setDate(d.getDate() - d.getDay() + 1);
            const key = weekStart.toISOString().split('T')[0];

            if (!current || current.time !== key) {
                if (current) weeks.push(current);
                current = {
                    time: key,
                    open: bar.open,
                    high: bar.high,
                    low: bar.low,
                    close: bar.close,
                };
            } else {
                current.high = Math.max(current.high, bar.high);
                current.low = Math.min(current.low, bar.low);
                current.close = bar.close;
            }
        }
        if (current) weeks.push(current);
        return weeks;
    }

    function expandTo4H(data) {
        // For 4H, just return the daily data but with more recent subset
        // In production you'd have actual 4H candles
        return data.slice(-200);
    }

    function findNearestEvent(clickedTime) {
        let timeStr;
        if (typeof clickedTime === 'string') {
            timeStr = clickedTime;
        } else if (clickedTime.year) {
            const month = String(clickedTime.month).padStart(2, '0');
            const day = String(clickedTime.day).padStart(2, '0');
            timeStr = `${clickedTime.year}-${month}-${day}`;
        } else {
            return null;
        }

        const clickDate = new Date(timeStr).getTime();
        let nearest = null;
        let minDist = Infinity;

        for (const evt of GOLD_EVENTS) {
            const dist = Math.abs(new Date(evt.date).getTime() - clickDate);
            const threshold = 30 * 24 * 60 * 60 * 1000; // 30 days
            if (dist < minDist && dist < threshold) {
                minDist = dist;
                nearest = evt;
            }
        }
        return nearest;
    }

    function updatePriceDisplay() {
        // Use live price if available
        if (latestLivePrice) {
            $currentPrice.textContent = '$' + Number(latestLivePrice).toLocaleString('en-US', { minimumFractionDigits: 2 });
        }
        const goldData = getGoldData();
        const lastBar = goldData[goldData.length - 1];
        if (!lastBar) return;
        const prevBar = goldData[goldData.length - 2];
        if (!latestLivePrice) {
            $currentPrice.textContent = '$' + lastBar.close.toLocaleString('en-US', { minimumFractionDigits: 2 });
        }

        if (prevBar) {
            const change = ((lastBar.close - prevBar.close) / prevBar.close * 100).toFixed(2);
            const isPositive = change >= 0;
            $currentChange.textContent = (isPositive ? '+' : '') + change + '%';
            $currentChange.className = 'chart-change ' + (isPositive ? 'positive' : 'negative');
        }
    }

    // --- Sentiment Gauge ---
    function renderSentimentGauge() {
        const signals = calculateSentimentSignals();
        const score = signals.score; // 0-100, 50 = neutral
        const $fill = document.getElementById('gaugeFill');
        const $reading = document.getElementById('gaugeReading');
        const $summary = document.getElementById('summaryText');
        const $chips = document.getElementById('signalChips');

        if (!$fill || !$reading) return;

        // Determine sentiment label
        let label, cssClass, color;
        if (score >= 70) { label = 'STRONGLY BULLISH'; cssClass = 'bullish'; color = 'var(--green)'; }
        else if (score >= 58) { label = 'BULLISH'; cssClass = 'bullish'; color = 'var(--green)'; }
        else if (score >= 42) { label = 'NEUTRAL'; cssClass = 'neutral'; color = 'var(--gold)'; }
        else if (score >= 30) { label = 'BEARISH'; cssClass = 'bearish'; color = 'var(--red)'; }
        else { label = 'STRONGLY BEARISH'; cssClass = 'bearish'; color = 'var(--red)'; }

        // Animate gauge
        setTimeout(() => {
            $fill.style.width = score + '%';
            $fill.style.background = `linear-gradient(90deg, ${color}, ${color})`;
        }, 300);

        $reading.textContent = label + '  ' + score + '/100';
        $reading.className = 'gauge-reading ' + cssClass;

        // Market summary
        if ($summary) $summary.textContent = signals.summary;

        // Signal chips
        if ($chips) {
            $chips.innerHTML = signals.chips.map(c =>
                `<span class="signal-chip ${c.direction}">${c.label}</span>`
            ).join('');
        }
    }

    function calculateSentimentSignals() {
        const inst = INSTRUMENTS;
        let score = 50; // Start neutral
        const chips = [];

        // VIX signal: elevated = bullish for gold
        const vixVal = parseFloat(inst.vix.currentValue);
        if (vixVal > 30) { score += 10; chips.push({ label: 'VIX Panic ' + inst.vix.currentValue, direction: 'bullish' }); }
        else if (vixVal > 20) { score += 5; chips.push({ label: 'VIX Elevated', direction: 'bullish' }); }
        else { score -= 3; chips.push({ label: 'VIX Calm', direction: 'bearish' }); }

        // DXY signal: weak dollar = bullish for gold
        const dxyVal = parseFloat(inst.dxy.currentValue);
        if (dxyVal < 95) { score += 12; chips.push({ label: 'DXY Weak ' + inst.dxy.currentValue, direction: 'bullish' }); }
        else if (dxyVal < 100) { score += 7; chips.push({ label: 'DXY Softening', direction: 'bullish' }); }
        else if (dxyVal > 105) { score -= 10; chips.push({ label: 'DXY Strong', direction: 'bearish' }); }
        else { score += 0; chips.push({ label: 'DXY Neutral', direction: 'neutral' }); }

        // Real rates signal: low/negative = bullish
        const rrVal = parseFloat(inst.realRates.currentValue);
        if (rrVal < 0) { score += 15; chips.push({ label: 'Real Rates Negative', direction: 'bullish' }); }
        else if (rrVal < 1) { score += 8; chips.push({ label: 'Real Rates Low ' + inst.realRates.currentValue, direction: 'bullish' }); }
        else if (rrVal > 1.5) { score -= 12; chips.push({ label: 'Real Rates High', direction: 'bearish' }); }
        else { score -= 3; chips.push({ label: 'Real Rates Moderate', direction: 'neutral' }); }

        // CPI signal: high inflation = bullish
        const cpiVal = parseFloat(inst.cpi.currentValue);
        if (cpiVal > 4) { score += 8; chips.push({ label: 'CPI Hot ' + inst.cpi.currentValue, direction: 'bullish' }); }
        else if (cpiVal > 2.5) { score += 4; chips.push({ label: 'CPI Sticky', direction: 'bullish' }); }
        else { score -= 2; chips.push({ label: 'CPI Contained', direction: 'bearish' }); }

        // Unemployment signal: rising = bullish (rate cut expectations)
        const unemplVal = parseFloat(inst.unemployment.currentValue);
        if (unemplVal > 5) { score += 7; chips.push({ label: 'Unemployment High', direction: 'bullish' }); }
        else if (unemplVal > 4) { score += 3; chips.push({ label: 'Unemployment Rising', direction: 'bullish' }); }
        else { score -= 3; chips.push({ label: 'Labor Tight', direction: 'bearish' }); }

        // Trend momentum from recent price data
        const data = getGoldData();
        if (data.length > 50) {
            const recent = data.slice(-20);
            const older = data.slice(-50, -30);
            const recentAvg = recent.reduce((s, d) => s + d.close, 0) / recent.length;
            const olderAvg = older.reduce((s, d) => s + d.close, 0) / older.length;
            const momentum = ((recentAvg - olderAvg) / olderAvg) * 100;
            if (momentum > 5) { score += 5; chips.push({ label: 'Trend Strong', direction: 'bullish' }); }
            else if (momentum < -3) { score -= 5; chips.push({ label: 'Trend Weak', direction: 'bearish' }); }
        }

        // Clamp
        score = Math.max(0, Math.min(100, Math.round(score)));

        // Generate summary
        const bullishFactors = [];
        const bearishFactors = [];

        if (dxyVal < 100) bullishFactors.push('a weakening dollar (DXY ' + inst.dxy.currentValue + ')');
        if (rrVal < 1) bullishFactors.push('declining real rates (' + inst.realRates.currentValue + ')');
        if (vixVal > 20) bullishFactors.push('elevated market volatility');
        if (cpiVal > 2.5) bullishFactors.push('sticky inflation at ' + inst.cpi.currentValue);
        if (unemplVal > 4) bullishFactors.push('a softening labor market');
        if (dxyVal > 105) bearishFactors.push('dollar strength');
        if (rrVal > 1.5) bearishFactors.push('high real rates');

        let summary;
        if (bullishFactors.length > bearishFactors.length) {
            summary = 'Gold is supported by ' + bullishFactors.slice(0, 3).join(', ') + '. '
                + 'Central bank accumulation and de-dollarization trends provide structural support.';
        } else if (bearishFactors.length > 0) {
            summary = 'Gold faces headwinds from ' + bearishFactors.join(' and ') + ', '
                + 'though structural central bank demand continues to provide a floor.';
        } else {
            summary = 'Mixed signals across macro indicators. Gold is range-bound as bullish and bearish forces balance.';
        }

        return { score, chips, summary };
    }

    // --- Event Timeline ---
    function renderEventTimeline() {
        $eventTimeline.innerHTML = '';
        GOLD_EVENTS.forEach(evt => {
            const chip = document.createElement('button');
            chip.className = 'timeline-chip';
            chip.dataset.eventId = evt.id;
            chip.innerHTML = `
                <span class="chip-dot ${evt.direction}"></span>
                <span>${formatDateShort(evt.date)}</span>
                <span style="color:var(--white);font-weight:500;">${evt.title.length > 30 ? evt.title.substring(0, 30) + '...' : evt.title}</span>
            `;
            chip.addEventListener('click', () => selectEvent(evt.id));
            $eventTimeline.appendChild(chip);
        });
    }

    function selectEvent(eventId) {
        const evt = GOLD_EVENTS.find(e => e.id === eventId);
        if (!evt) return;

        activeEvent = eventId;

        // Update timeline chips
        document.querySelectorAll('.timeline-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.eventId === eventId);
        });

        // Scroll chart to event
        const eventDate = evt.date;
        const gData = getGoldData();
        mainChart.timeScale().scrollToPosition(-gData.findIndex(d => d.time >= eventDate) + gData.length - 20, false);

        // Show detail panel
        renderDetailPanel(evt);
        $detailPanel.classList.remove('collapsed');

        // Scroll to detail
        setTimeout(() => {
            $detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }

    function renderDetailPanel(evt) {
        const factorsHTML = evt.factors.map(f => {
            const icon = f.direction === 'up' ? '&#9650;' : f.direction === 'down' ? '&#9660;' : '&#9644;';
            return `
                <div class="detail-factor">
                    <span class="factor-icon ${f.direction}">${icon}</span>
                    <span><strong>${f.name}</strong> — ${f.detail}</span>
                </div>
            `;
        }).join('');

        $detailContent.innerHTML = `
            <div class="detail-header">
                <div class="detail-header-left">
                    <h3>${evt.title}</h3>
                    <span class="detail-date">${formatDateLong(evt.date)}</span>
                </div>
                <span class="detail-badge ${evt.direction}">${evt.direction}</span>
            </div>
            <div class="detail-grid">
                <div class="detail-section">
                    <h4>Analysis</h4>
                    <p>${evt.sentiment}</p>
                </div>
                <div class="detail-section">
                    <h4>Macro Factors</h4>
                    <div class="detail-factors">
                        ${factorsHTML}
                    </div>
                </div>
                <div class="detail-section">
                    <h4>Price Action</h4>
                    <div class="detail-metrics">
                        <div class="detail-metric">
                            <span class="detail-metric-label">From</span>
                            <span class="detail-metric-value neutral">$${evt.priceFrom.toLocaleString()}</span>
                        </div>
                        <div class="detail-metric">
                            <span class="detail-metric-label">To</span>
                            <span class="detail-metric-value neutral">$${evt.priceTo.toLocaleString()}</span>
                        </div>
                        <div class="detail-metric">
                            <span class="detail-metric-label">Change</span>
                            <span class="detail-metric-value ${evt.direction === 'bullish' ? 'up' : 'down'}">${evt.change}</span>
                        </div>
                        <div class="detail-metric">
                            <span class="detail-metric-label">Key Drivers</span>
                            <span class="detail-metric-value neutral" style="font-size:0.7rem;font-weight:400;text-align:right;max-width:180px;">${evt.keyDrivers}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // --- Crisis Legend ---
    function renderCrisisLegend() {
        const legendContainer = document.getElementById('chartLegend');
        if (!legendContainer) return;

        // Add crisis type items
        const types = {};
        CRISIS_PERIODS.forEach(c => { types[c.type] = CRISIS_TYPES[c.type]; });

        Object.entries(types).forEach(([type, info]) => {
            const item = document.createElement('span');
            item.className = 'crisis-legend-item';
            item.innerHTML = `<span class="crisis-legend-dot" style="background:${info.color}"></span>${info.label}`;
            legendContainer.appendChild(item);
        });
    }

    // --- Correlations ---
    function renderCorrelations() {
        $positiveCorr.innerHTML = '';
        $negativeCorr.innerHTML = '';

        Object.values(INSTRUMENTS).forEach(inst => {
            const snapshotsHTML = inst.historicalSnapshots ? inst.historicalSnapshots.map(s => `
                <tr>
                    <td>${s.date}</td>
                    <td>${s.event}</td>
                    <td style="font-variant-numeric:tabular-nums;">${s.value}</td>
                    <td style="color:${s.goldMove.startsWith('+') || s.goldMove.includes('ATH') ? 'var(--green)' : s.goldMove.startsWith('-') ? 'var(--red)' : 'var(--light-blue)'}">${s.goldMove}</td>
                </tr>
            `).join('') : '';

            const rangesHTML = inst.ranges ? Object.entries(inst.ranges).map(([key, val]) => `
                <div class="range-item">${val}</div>
            `).join('') : '';

            const card = document.createElement('div');
            card.className = 'corr-card';
            card.innerHTML = `
                <div class="corr-card-header">
                    <span class="corr-card-name">${inst.name}</span>
                    <span class="corr-card-correlation ${inst.correlation}">${inst.corrValue}</span>
                </div>
                <div class="corr-card-fullname">${inst.fullName}</div>
                <div class="corr-card-value-row">
                    <span class="corr-card-value">${inst.currentValue}</span>
                    ${inst.trend ? `<span class="corr-card-trend ${inst.trend}">${inst.trendLabel}</span>` : ''}
                </div>
                <div class="corr-card-desc">${inst.description}</div>
                ${inst.mechanism ? `<div class="corr-card-mechanism">${inst.mechanism}</div>` : ''}
                ${snapshotsHTML ? `
                <div class="corr-card-snapshots">
                    <h5>Historical Snapshots</h5>
                    <table class="snapshot-table">
                        <thead><tr><th>Date</th><th>Event</th><th>Value</th><th>Gold</th></tr></thead>
                        <tbody>${snapshotsHTML}</tbody>
                    </table>
                </div>` : ''}
                ${rangesHTML ? `<div class="corr-card-ranges">${rangesHTML}</div>` : ''}
                <div class="corr-card-mini-chart" id="mini-${inst.name.toLowerCase().replace(/\s/g, '')}"></div>
            `;

            if (inst.correlation === 'positive') {
                $positiveCorr.appendChild(card);
            } else {
                $negativeCorr.appendChild(card);
            }

            // Render mini sparkline after DOM insertion
            setTimeout(() => renderMiniChart(inst), 50);
        });
    }

    function renderMiniChart(inst) {
        const containerId = `mini-${inst.name.toLowerCase().replace(/\s/g, '')}`;
        const container = document.getElementById(containerId);
        if (!container) return;

        const chart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: 50,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: 'transparent',
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: false },
            },
            rightPriceScale: { visible: false },
            timeScale: { visible: false },
            crosshair: { mode: LightweightCharts.CrosshairMode.Hidden },
            handleScroll: false,
            handleScale: false,
        });

        const color = inst.correlation === 'positive' ? 'rgba(74, 222, 128, 0.6)' : 'rgba(248, 113, 113, 0.6)';
        const areaColor = inst.correlation === 'positive' ? 'rgba(74, 222, 128, 0.08)' : 'rgba(248, 113, 113, 0.08)';

        const series = chart.addAreaSeries({
            lineColor: color,
            topColor: areaColor,
            bottomColor: 'transparent',
            lineWidth: 1.5,
            crosshairMarkerVisible: false,
        });

        // Generate synthetic data that roughly follows the described correlation
        series.setData(generateCorrelatedData(inst));
        chart.timeScale().fitContent();
    }

    function generateCorrelatedData(inst) {
        const data = [];
        const goldSubset = getGoldData().filter((_, i) => i % 7 === 0).slice(-80);
        let val;

        // Set base values
        switch (inst.name) {
            case 'VIX': val = 20; break;
            case 'CPI': val = 2.5; break;
            case 'UNEMPLOYMENT': val = 5; break;
            case 'DXY': val = 95; break;
            case 'REAL RATES': val = 0.5; break;
            default: val = 100;
        }

        for (let i = 0; i < goldSubset.length; i++) {
            const goldChange = i > 0
                ? (goldSubset[i].close - goldSubset[i - 1].close) / goldSubset[i - 1].close
                : 0;

            const factor = inst.correlation === 'positive' ? 1 : -1;
            const sensitivity = inst.name === 'VIX' ? 5 : inst.name === 'DXY' ? 3 : 2;
            val += goldChange * factor * sensitivity * val * 0.1 + (Math.random() - 0.5) * val * 0.01;
            val = Math.max(val * 0.5, val);

            data.push({
                time: goldSubset[i].time,
                value: Math.round(val * 100) / 100,
            });
        }
        return data;
    }

    // --- Presidents ---
    function renderPresidents() {
        $presidentsGrid.innerHTML = '';
        PRESIDENTIAL_TERMS.forEach(pres => {
            const isPositive = !pres.change.startsWith('-');

            const eventsHTML = pres.keyEvents ? pres.keyEvents.map(e => `
                <div class="president-event-item">
                    <span class="president-event-impact ${e.impact}"></span>
                    <span class="president-event-year">${e.year}</span>
                    <span class="president-event-text">${e.event}</span>
                </div>
            `).join('') : '';

            const macroHTML = pres.macroSnapshot ? `
                <div class="president-macro">
                    <div class="president-macro-item">
                        <div class="president-macro-label">Fed Funds</div>
                        <div class="president-macro-value">${pres.macroSnapshot.fedFunds}</div>
                    </div>
                    <div class="president-macro-item">
                        <div class="president-macro-label">CPI</div>
                        <div class="president-macro-value">${pres.macroSnapshot.inflation}</div>
                    </div>
                    <div class="president-macro-item">
                        <div class="president-macro-label">DXY</div>
                        <div class="president-macro-value">${pres.macroSnapshot.dxy}</div>
                    </div>
                    <div class="president-macro-item">
                        <div class="president-macro-label">Unemp.</div>
                        <div class="president-macro-value">${pres.macroSnapshot.unemployment}</div>
                    </div>
                    <div class="president-macro-item">
                        <div class="president-macro-label">Nat. Debt</div>
                        <div class="president-macro-value">${pres.macroSnapshot.debt}</div>
                    </div>
                </div>
            ` : '';

            const card = document.createElement('div');
            card.className = 'president-card fade-in';
            card.innerHTML = `
                <div class="president-card-header">
                    <div>
                        <div class="president-name">${pres.name}</div>
                        <div class="president-term">${pres.term}</div>
                    </div>
                    <span class="president-party ${pres.party}">${pres.party}</span>
                </div>
                <div class="president-stats">
                    <div class="president-stat">
                        <div class="president-stat-label">Gold Performance</div>
                        <div class="president-stat-value ${isPositive ? 'up' : 'down'}">${pres.change}</div>
                    </div>
                    <div class="president-stat">
                        <div class="president-stat-label">Entry → Exit</div>
                        <div class="president-stat-value" style="color:var(--gold);font-size:0.85rem;">$${pres.goldStart.toLocaleString()} → $${pres.goldEnd.toLocaleString()}</div>
                    </div>
                    <div class="president-stat">
                        <div class="president-stat-label">Term High</div>
                        <div class="president-stat-value up">$${pres.high.toLocaleString()}</div>
                    </div>
                    <div class="president-stat">
                        <div class="president-stat-label">Term Low</div>
                        <div class="president-stat-value down">$${pres.low.toLocaleString()}</div>
                    </div>
                </div>
                ${macroHTML}
                ${eventsHTML ? `
                <div class="president-events">
                    <h5>Key Events</h5>
                    ${eventsHTML}
                </div>` : ''}
                ${pres.analysis ? `<div class="president-analysis">${pres.analysis}</div>` : ''}
            `;
            $presidentsGrid.appendChild(card);
        });
    }

    // --- Navigation ---
    function bindNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
                updateView();
            });
        });
    }

    function updateView() {
        const $dashboardRow = document.getElementById('dashboardRow');
        const $detailPanelEl = document.getElementById('detailPanel');
        const $eventTimelineEl = document.getElementById('eventTimeline');
        const $sentimentBar = document.getElementById('sentimentBar');

        if (currentView === 'overview') {
            // Show everything — chart + news sidebar + correlations
            if ($sentimentBar) $sentimentBar.style.display = '';
            if ($dashboardRow) $dashboardRow.style.display = '';
            if ($detailPanelEl) $detailPanelEl.style.display = '';
            if ($eventTimelineEl) $eventTimelineEl.style.display = '';
            $correlationsSection.style.display = 'block';
            $presidentsSection.style.display = 'none';
            // Recreate chart in case it was hidden (fixes sizing)
            setTimeout(() => {
                try { createMainChart(); } catch (e) { console.error('Chart recreate error:', e); }
            }, 50);
        } else if (currentView === 'correlations') {
            // Hide chart, show sentiment + correlations
            if ($sentimentBar) $sentimentBar.style.display = '';
            if ($dashboardRow) $dashboardRow.style.display = 'none';
            if ($detailPanelEl) $detailPanelEl.style.display = 'none';
            if ($eventTimelineEl) $eventTimelineEl.style.display = 'none';
            $correlationsSection.style.display = 'block';
            $presidentsSection.style.display = 'none';
            $correlationsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (currentView === 'presidents') {
            // Hide chart + sentiment, show presidents only
            if ($sentimentBar) $sentimentBar.style.display = 'none';
            if ($dashboardRow) $dashboardRow.style.display = 'none';
            if ($detailPanelEl) $detailPanelEl.style.display = 'none';
            if ($eventTimelineEl) $eventTimelineEl.style.display = 'none';
            $correlationsSection.style.display = 'none';
            $presidentsSection.style.display = 'block';
            try { renderPresidents(); } catch (e) { console.error('Presidents render error:', e); }
            $presidentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // --- Timeframe ---
    function bindTimeframe() {
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTimeframe = btn.dataset.tf;
                createMainChart();
            });
        });
    }

    // --- Chart Controls ---
    function bindChartControls() {
        document.getElementById('btnZoomIn').addEventListener('click', () => {
            if (!mainChart) return;
            const ts = mainChart.timeScale();
            const currentSpacing = ts.options().barSpacing || 6;
            ts.applyOptions({ barSpacing: Math.min(currentSpacing + 3, 40) });
        });

        document.getElementById('btnZoomOut').addEventListener('click', () => {
            if (!mainChart) return;
            const ts = mainChart.timeScale();
            const currentSpacing = ts.options().barSpacing || 6;
            ts.applyOptions({ barSpacing: Math.max(currentSpacing - 3, 1) });
        });

        document.getElementById('btnPanLeft').addEventListener('click', () => {
            if (!mainChart) return;
            const ts = mainChart.timeScale();
            ts.scrollToPosition(ts.scrollPosition() - 30, true);
        });

        document.getElementById('btnPanRight').addEventListener('click', () => {
            if (!mainChart) return;
            const ts = mainChart.timeScale();
            ts.scrollToPosition(ts.scrollPosition() + 30, true);
        });

        document.getElementById('btnReset').addEventListener('click', () => {
            if (!mainChart) return;
            mainChart.timeScale().fitContent();
        });
    }

    // --- Detail Panel ---
    function bindDetailClose() {
        $detailClose.addEventListener('click', () => {
            $detailPanel.classList.add('collapsed');
            activeEvent = null;
            document.querySelectorAll('.timeline-chip').forEach(c => c.classList.remove('active'));
        });
    }

    // --- SMA Calculation ---
    function calculateSMA(data, period) {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].close;
            }
            result.push({ time: data[i].time, value: Math.round(sum / period * 100) / 100 });
        }
        return result;
    }

    // --- Floating Tooltip ---
    let tooltipEl = null;

    function createTooltip() {
        // Remove old one if exists
        if (tooltipEl) tooltipEl.remove();
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'chart-tooltip';
        tooltipEl.style.display = 'none';
        $mainChart.appendChild(tooltipEl);
    }

    function showTooltip(point, data, pres, crisis, timeStr) {
        if (!tooltipEl || !point) return;
        const change = ((data.close - data.open) / data.open * 100).toFixed(2);
        const isUp = data.close >= data.open;
        const presLabel = pres ? `<span class="tt-pres ${pres.party}">${pres.name}</span>` : '';
        const crisisLabel = crisis ? `<span class="tt-crisis">${crisis.label}</span>` : '';

        tooltipEl.innerHTML = `
            <div class="tt-date">${timeStr || ''}${presLabel}${crisisLabel}</div>
            <div class="tt-prices">
                <span>O <b>${data.open.toFixed(2)}</b></span>
                <span>H <b>${data.high.toFixed(2)}</b></span>
                <span>L <b>${data.low.toFixed(2)}</b></span>
                <span>C <b>${data.close.toFixed(2)}</b></span>
                <span class="${isUp ? 'tt-up' : 'tt-down'}">${isUp ? '+' : ''}${change}%</span>
            </div>
        `;
        tooltipEl.style.display = 'block';

        // Position
        const chartRect = $mainChart.getBoundingClientRect();
        let left = point.x + 15;
        let top = point.y - 10;
        if (left + 280 > chartRect.width) left = point.x - 280;
        if (top < 10) top = 10;
        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.style.display = 'none';
    }

    // --- Helpers ---
    function formatDateShort(dateStr) {
        const d = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[d.getMonth()] + ' ' + d.getFullYear();
    }

    function formatDateLong(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    // --- News Feed ---
    let newsData = null;
    let newsFilter = 'all';
    let newsLoaded = false;

    async function fetchNews(forceRefresh = false) {
        const $status = document.getElementById('newsStatus');
        const $grid = document.getElementById('newsGrid');
        const $sources = document.getElementById('newsSources');

        if ($status) $status.style.display = 'flex';
        if ($grid) $grid.innerHTML = '';

        try {
            const url = forceRefresh ? '/api/news?refresh=1' : '/api/news';
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (data.success && data.articles && data.articles.length > 0) {
                newsData = data;
                newsLoaded = true;
                renderNewsSourceBadges(data.sources);
                renderNews();
            } else {
                newsLoaded = false; // Allow retry
                showNewsError('No articles available. Configure at least one API key or check your internet connection for RSS feeds.');
            }
        } catch (err) {
            console.error('News fetch error:', err);
            showNewsError('Could not load news. Ensure the server is running and API keys are configured.');
        }

        if ($status) $status.style.display = 'none';
    }

    function showNewsError(msg) {
        const $grid = document.getElementById('newsGrid');
        const $status = document.getElementById('newsStatus');
        if ($status) $status.style.display = 'none';
        if ($grid) {
            $grid.innerHTML = `
                <div class="news-empty">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3">
                        <path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/>
                    </svg>
                    <p>${msg}</p>
                    <div class="news-setup-hint">
                        <p>Add API keys to your <code>.env</code> file:</p>
                        <code>NEWSAPI_KEY=your_key_here</code>
                        <code>GNEWS_KEY=your_key_here</code>
                        <code>FINNHUB_KEY=your_key_here</code>
                        <p style="margin-top:0.5rem;font-size:0.65rem;color:var(--light-gray);">RSS feeds (Kitco, Reuters, Mining.com) work without keys.</p>
                    </div>
                </div>
            `;
        }
    }

    function renderNewsSourceBadges(sources) {
        const $sources = document.getElementById('newsSources');
        if (!$sources || !sources) return;

        $sources.innerHTML = Object.entries(sources).map(([name, status]) => {
            const isActive = status === 'active';
            return `<span class="news-source-badge ${isActive ? 'active' : 'inactive'}">${name}${isActive ? '' : ' (no key)'}</span>`;
        }).join('');
    }

    function renderNews() {
        const $grid = document.getElementById('newsGrid');
        if (!$grid || !newsData || !newsData.articles) return;

        let articles = newsData.articles;

        // Apply filter
        if (newsFilter !== 'all') {
            articles = articles.filter(a => a.sentiment === newsFilter);
        }

        if (articles.length === 0) {
            $grid.innerHTML = '<div class="news-empty"><p>No articles match this filter.</p></div>';
            return;
        }

        $grid.innerHTML = articles.slice(0, 40).map(article => {
            const timeAgo = getTimeAgo(article.publishedAt);
            const sentimentClass = article.sentiment || 'neutral';
            const sentimentLabel = article.sentiment === 'bullish' ? 'Bull' : article.sentiment === 'bearish' ? 'Bear' : '';
            const relevanceDots = Math.min(article.relevanceScore || 0, 5);

            return `
                <a href="${escapeHTML(article.url)}" target="_blank" rel="noopener noreferrer" class="news-item">
                    <div class="news-item-meta">
                        <span class="news-item-source">${escapeHTML(article.source)}</span>
                        <span class="news-item-time">${timeAgo}</span>
                        ${sentimentLabel ? `<span class="news-item-sentiment ${sentimentClass}">${sentimentLabel}</span>` : ''}
                    </div>
                    <div class="news-item-title">${escapeHTML(article.title)}</div>
                    ${article.description ? `<div class="news-item-desc">${escapeHTML(article.description.substring(0, 120))}</div>` : ''}
                    <div class="news-item-footer">
                        <span class="news-item-provider">${escapeHTML(article.provider)}</span>
                        <span class="news-item-relevance">${'●'.repeat(relevanceDots)}${'○'.repeat(5 - relevanceDots)}</span>
                    </div>
                </a>
            `;
        }).join('');
    }

    function bindNewsControls() {
        // Filter buttons (pill style in sidebar)
        document.querySelectorAll('.news-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.news-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                newsFilter = btn.dataset.filter;
                renderNews();
            });
        });

        // Refresh button
        const $refresh = document.getElementById('newsRefreshBtn');
        if ($refresh) {
            $refresh.addEventListener('click', () => {
                $refresh.classList.add('spinning');
                fetchNews(true).finally(() => {
                    setTimeout(() => $refresh.classList.remove('spinning'), 500);
                });
            });
        }
    }

    function getTimeAgo(dateStr) {
        const now = Date.now();
        const then = new Date(dateStr).getTime();
        const diff = now - then;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days < 7) return days + 'd ago';
        return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --- Boot ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
