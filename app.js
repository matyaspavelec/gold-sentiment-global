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

    // --- Init ---
    function init() {
        createMainChart();
        renderEventTimeline();
        renderCorrelations();
        renderPresidents();
        bindNavigation();
        bindTimeframe();
        bindDetailClose();
        updatePriceDisplay();
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
                scaleMargins: { top: 0.1, bottom: 0.1 },
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

        candleSeries = mainChart.addCandlestickSeries({
            upColor: '#c9a84c',
            downColor: '#5a4f3a',
            borderUpColor: '#c9a84c',
            borderDownColor: '#5a4f3a',
            wickUpColor: '#c9a84c',
            wickDownColor: '#5a4f3a',
        });

        const data = getDataForTimeframe(currentTimeframe);
        candleSeries.setData(data);

        // Add event markers on the chart
        const markers = GOLD_EVENTS.map(evt => ({
            time: evt.date,
            position: evt.direction === 'bullish' ? 'belowBar' : 'aboveBar',
            color: evt.direction === 'bullish' ? '#4ade80' : '#f87171',
            shape: evt.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
            text: evt.title.length > 25 ? evt.title.substring(0, 25) + '...' : evt.title,
        })).sort((a, b) => a.time.localeCompare(b.time));

        candleSeries.setMarkers(markers);

        // Subscribe to crosshair for price display
        mainChart.subscribeCrosshairMove(param => {
            if (!param || !param.time) {
                updatePriceDisplay();
                return;
            }
            const data = param.seriesData.get(candleSeries);
            if (data) {
                $currentPrice.textContent = '$' + data.close.toLocaleString('en-US', { minimumFractionDigits: 2 });
            }
        });

        // Click on chart to detect nearest event
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
        if (tf === 'W') {
            // Aggregate to weekly
            return aggregateToWeekly(GOLD_DATA);
        } else if (tf === '4H') {
            // Simulate 4H by expanding daily data
            return expandTo4H(GOLD_DATA);
        }
        return GOLD_DATA;
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
        const lastBar = GOLD_DATA[GOLD_DATA.length - 1];
        if (!lastBar) return;
        const prevBar = GOLD_DATA[GOLD_DATA.length - 2];
        $currentPrice.textContent = '$' + lastBar.close.toLocaleString('en-US', { minimumFractionDigits: 2 });

        if (prevBar) {
            const change = ((lastBar.close - prevBar.close) / prevBar.close * 100).toFixed(2);
            const isPositive = change >= 0;
            $currentChange.textContent = (isPositive ? '+' : '') + change + '%';
            $currentChange.className = 'chart-change ' + (isPositive ? 'positive' : 'negative');
        }
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
        mainChart.timeScale().scrollToPosition(-GOLD_DATA.findIndex(d => d.time >= eventDate) + GOLD_DATA.length - 20, false);

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

    // --- Correlations ---
    function renderCorrelations() {
        $positiveCorr.innerHTML = '';
        $negativeCorr.innerHTML = '';

        Object.values(INSTRUMENTS).forEach(inst => {
            const card = document.createElement('div');
            card.className = 'corr-card';
            card.innerHTML = `
                <div class="corr-card-header">
                    <span class="corr-card-name">${inst.name}</span>
                    <span class="corr-card-correlation ${inst.correlation}">${inst.corrValue}</span>
                </div>
                <div class="corr-card-value">${inst.currentValue}</div>
                <div class="corr-card-desc">${inst.description}</div>
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
        const goldSubset = GOLD_DATA.filter((_, i) => i % 7 === 0).slice(-80);
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
                        <div class="president-stat-label">Performance</div>
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
                <p style="margin-top:0.75rem;font-size:0.75rem;color:var(--light-gray);font-weight:300;line-height:1.6;">${pres.context}</p>
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
        const showCorrelations = currentView === 'overview' || currentView === 'correlations';
        const showPresidents = currentView === 'presidents';

        $correlationsSection.style.display = showCorrelations ? 'block' : 'none';
        $presidentsSection.style.display = showPresidents ? 'block' : 'none';

        if (currentView === 'presidents') {
            // Re-render to trigger animations
            renderPresidents();
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

    // --- Detail Panel ---
    function bindDetailClose() {
        $detailClose.addEventListener('click', () => {
            $detailPanel.classList.add('collapsed');
            activeEvent = null;
            document.querySelectorAll('.timeline-chip').forEach(c => c.classList.remove('active'));
        });
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

    // --- Boot ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
