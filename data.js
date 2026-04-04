// ============================================
// GOLD SENTIMENT MODEL — Data Layer
// Replace with your own historical data
// ============================================

// --- Gold Price Data (Weekly candles, simplified OHLC) ---
// Format: { time: 'YYYY-MM-DD', open, high, low, close }
const GOLD_DATA = generateGoldData();

function generateGoldData() {
    const data = [];
    const baseData = [
        // 2000-2002: Post dot-com, gold bottoming ~$270-$320
        { start: '2000-01-03', months: 12, startPrice: 283, endPrice: 272, volatility: 8 },
        { start: '2001-01-01', months: 12, startPrice: 272, endPrice: 278, volatility: 10 },
        { start: '2002-01-01', months: 12, startPrice: 278, endPrice: 348, volatility: 12 },
        // 2003-2007: Bull run
        { start: '2003-01-01', months: 12, startPrice: 348, endPrice: 416, volatility: 15 },
        { start: '2004-01-01', months: 12, startPrice: 416, endPrice: 438, volatility: 14 },
        { start: '2005-01-01', months: 12, startPrice: 438, endPrice: 517, volatility: 18 },
        { start: '2006-01-01', months: 12, startPrice: 517, endPrice: 636, volatility: 25 },
        { start: '2007-01-01', months: 12, startPrice: 636, endPrice: 836, volatility: 30 },
        // 2008-2011: Financial crisis & peak
        { start: '2008-01-01', months: 12, startPrice: 836, endPrice: 882, volatility: 60 },
        { start: '2009-01-01', months: 12, startPrice: 882, endPrice: 1096, volatility: 40 },
        { start: '2010-01-01', months: 12, startPrice: 1096, endPrice: 1421, volatility: 35 },
        { start: '2011-01-01', months: 12, startPrice: 1421, endPrice: 1566, volatility: 55 },
        // 2012-2015: Correction
        { start: '2012-01-01', months: 12, startPrice: 1566, endPrice: 1675, volatility: 40 },
        { start: '2013-01-01', months: 12, startPrice: 1675, endPrice: 1205, volatility: 50 },
        { start: '2014-01-01', months: 12, startPrice: 1205, endPrice: 1184, volatility: 30 },
        { start: '2015-01-01', months: 12, startPrice: 1184, endPrice: 1062, volatility: 25 },
        // 2016-2019: Recovery
        { start: '2016-01-01', months: 12, startPrice: 1062, endPrice: 1151, volatility: 30 },
        { start: '2017-01-01', months: 12, startPrice: 1151, endPrice: 1303, volatility: 25 },
        { start: '2018-01-01', months: 12, startPrice: 1303, endPrice: 1282, volatility: 30 },
        { start: '2019-01-01', months: 12, startPrice: 1282, endPrice: 1523, volatility: 35 },
        // 2020-2024: COVID & new highs
        { start: '2020-01-01', months: 12, startPrice: 1523, endPrice: 1898, volatility: 60 },
        { start: '2021-01-01', months: 12, startPrice: 1898, endPrice: 1829, volatility: 40 },
        { start: '2022-01-01', months: 12, startPrice: 1829, endPrice: 1824, volatility: 50 },
        { start: '2023-01-01', months: 12, startPrice: 1824, endPrice: 2063, volatility: 45 },
        { start: '2024-01-01', months: 12, startPrice: 2063, endPrice: 2650, volatility: 55 },
        { start: '2025-01-01', months: 3, startPrice: 2650, endPrice: 3100, volatility: 60 },
    ];

    for (const segment of baseData) {
        const startDate = new Date(segment.start);
        const weeks = Math.round(segment.months * 4.33);
        const priceStep = (segment.endPrice - segment.startPrice) / weeks;

        for (let i = 0; i < weeks; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i * 7);
            const dateStr = date.toISOString().split('T')[0];

            const basePrice = segment.startPrice + priceStep * i;
            const noise = () => (Math.random() - 0.5) * segment.volatility;
            const open = basePrice + noise() * 0.3;
            const close = basePrice + priceStep + noise() * 0.3;
            const high = Math.max(open, close) + Math.abs(noise()) * 0.5;
            const low = Math.min(open, close) - Math.abs(noise()) * 0.5;

            data.push({
                time: dateStr,
                open: Math.round(open * 100) / 100,
                high: Math.round(high * 100) / 100,
                low: Math.round(low * 100) / 100,
                close: Math.round(close * 100) / 100,
            });
        }
    }

    // Remove duplicates by date
    const seen = new Set();
    return data.filter(d => {
        if (seen.has(d.time)) return false;
        seen.add(d.time);
        return true;
    }).sort((a, b) => a.time.localeCompare(b.time));
}


// --- Correlated Instruments ---
const INSTRUMENTS = {
    // POSITIVE CORRELATION
    vix: {
        name: 'VIX',
        fullName: 'CBOE Volatility Index',
        correlation: 'positive',
        corrValue: '+0.62',
        currentValue: '18.42',
        description: 'Fear gauge — spikes drive safe-haven flows into gold',
    },
    cpi: {
        name: 'CPI',
        fullName: 'Consumer Price Index (YoY %)',
        correlation: 'positive',
        corrValue: '+0.71',
        currentValue: '3.1%',
        description: 'Inflation erodes fiat purchasing power, boosting gold demand',
    },
    unemployment: {
        name: 'UNEMPLOYMENT',
        fullName: 'US Unemployment Rate',
        correlation: 'positive',
        corrValue: '+0.48',
        currentValue: '3.9%',
        description: 'Rising unemployment signals economic weakness, favoring gold',
    },
    // NEGATIVE CORRELATION
    dxy: {
        name: 'DXY',
        fullName: 'US Dollar Index',
        correlation: 'negative',
        corrValue: '-0.82',
        currentValue: '104.28',
        description: 'Strong dollar makes gold more expensive globally, suppressing demand',
    },
    realRates: {
        name: 'REAL RATES',
        fullName: '10Y TIPS Yield (Real Interest Rate)',
        correlation: 'negative',
        corrValue: '-0.88',
        currentValue: '1.92%',
        description: 'Higher real yields increase opportunity cost of holding gold',
    },
};


// --- Significant Gold Events ---
const GOLD_EVENTS = [
    {
        id: 'dotcom-crash',
        date: '2001-09-17',
        title: '9/11 & Safe Haven Surge',
        direction: 'bullish',
        priceFrom: 272,
        priceTo: 293,
        change: '+7.7%',
        summary: 'Terror attacks triggered immediate flight to safety. Gold surged as equities collapsed and geopolitical uncertainty spiked to generational levels.',
        factors: [
            { name: 'VIX', direction: 'up', detail: 'Spiked to 43.7' },
            { name: 'DXY', direction: 'down', detail: 'Dollar weakened on uncertainty' },
            { name: 'Real Rates', direction: 'down', detail: 'Fed emergency cuts' },
            { name: 'Unemployment', direction: 'up', detail: 'Rising post-recession' },
        ],
        sentiment: 'Extreme fear and geopolitical shock created a textbook safe-haven bid. The Federal Reserve slashed rates in emergency sessions, collapsing real yields and providing a dual tailwind for gold.',
        keyDrivers: 'Geopolitical crisis, emergency rate cuts, equity market collapse',
    },
    {
        id: 'iraq-war',
        date: '2003-03-20',
        title: 'Iraq War — Geopolitical Premium',
        direction: 'bullish',
        priceFrom: 337,
        priceTo: 388,
        change: '+15.1%',
        summary: 'The invasion of Iraq injected sustained geopolitical risk premium into gold. Uncertainty about Middle East stability and US fiscal expansion supported the rally.',
        factors: [
            { name: 'VIX', direction: 'up', detail: 'Elevated ~30+' },
            { name: 'DXY', direction: 'down', detail: 'Dollar declining on twin deficits' },
            { name: 'CPI', direction: 'up', detail: 'Oil-driven inflation rising' },
            { name: 'Real Rates', direction: 'down', detail: 'Fed holding rates at 1%' },
        ],
        sentiment: 'War premium combined with structural dollar weakness from twin deficits. The Fed\'s ultra-low rate policy made gold\'s zero yield relatively attractive.',
        keyDrivers: 'War risk premium, weak dollar, accommodative Fed policy',
    },
    {
        id: 'gfc-crash',
        date: '2008-03-17',
        title: 'Bear Stearns Collapse — GFC Begins',
        direction: 'bullish',
        priceFrom: 920,
        priceTo: 1011,
        change: '+9.9%',
        summary: 'The collapse of Bear Stearns signaled the start of the Global Financial Crisis. Gold initially surged as a safe haven before a liquidity-driven selloff.',
        factors: [
            { name: 'VIX', direction: 'up', detail: 'Surged past 30' },
            { name: 'DXY', direction: 'down', detail: 'Dollar weak on rate cut expectations' },
            { name: 'Real Rates', direction: 'down', detail: 'Aggressive Fed easing' },
            { name: 'Unemployment', direction: 'up', detail: 'Rising rapidly' },
        ],
        sentiment: 'Systemic banking crisis triggered massive safe-haven flows. The Fed\'s aggressive easing crushed real yields, but a temporary liquidity squeeze caused a brief mid-crisis gold dip before the structural rally resumed.',
        keyDrivers: 'Banking crisis, real yield collapse, systemic risk',
    },
    {
        id: 'lehman',
        date: '2008-09-15',
        title: 'Lehman Brothers Bankruptcy',
        direction: 'bearish',
        priceFrom: 850,
        priceTo: 735,
        change: '-13.5%',
        summary: 'Lehman\'s collapse paradoxically caused gold to sell off as the liquidity crisis forced hedge funds and institutions to liquidate all assets, including gold, to meet margin calls.',
        factors: [
            { name: 'VIX', direction: 'up', detail: 'Exploded to 80+' },
            { name: 'DXY', direction: 'up', detail: 'Dollar surged on deleveraging' },
            { name: 'Real Rates', direction: 'down', detail: 'Yields collapsing' },
            { name: 'Unemployment', direction: 'up', detail: 'Spiking toward 10%' },
        ],
        sentiment: 'A classic liquidity crunch selloff. In extreme panic, correlations go to 1 — everything gets sold. The dollar surged as global deleveraging forced USD demand. Gold recovered within weeks as QE expectations built.',
        keyDrivers: 'Forced liquidation, margin calls, dollar squeeze',
    },
    {
        id: 'qe1',
        date: '2009-03-18',
        title: 'QE1 Announced — $1.75T',
        direction: 'bullish',
        priceFrom: 922,
        priceTo: 990,
        change: '+7.4%',
        summary: 'The Federal Reserve announced its first round of quantitative easing, purchasing $1.75 trillion in assets. This massive monetary expansion fueled gold\'s next leg higher.',
        factors: [
            { name: 'Real Rates', direction: 'down', detail: 'Deeply negative' },
            { name: 'DXY', direction: 'down', detail: 'Dollar weakened on money printing' },
            { name: 'CPI', direction: 'flat', detail: 'Deflation fears near-term' },
            { name: 'VIX', direction: 'down', detail: 'Beginning to decline from peak' },
        ],
        sentiment: 'Unprecedented monetary expansion devalued the dollar and crushed real yields into deeply negative territory. Gold became the ultimate hedge against currency debasement.',
        keyDrivers: 'Quantitative easing, dollar debasement, negative real rates',
    },
    {
        id: 'gold-peak-2011',
        date: '2011-09-06',
        title: 'All-Time High — $1,921',
        direction: 'bullish',
        priceFrom: 1650,
        priceTo: 1921,
        change: '+16.4%',
        summary: 'Gold reached its all-time high (at the time) as the European debt crisis, US debt ceiling crisis, and S&P downgrade of US credit rating created a perfect storm of safe-haven demand.',
        factors: [
            { name: 'VIX', direction: 'up', detail: 'Elevated on EU crisis fears' },
            { name: 'DXY', direction: 'down', detail: 'Dollar weak on QE2' },
            { name: 'Real Rates', direction: 'down', detail: 'Deeply negative (-1%+)' },
            { name: 'CPI', direction: 'up', detail: 'Inflation above 3%' },
            { name: 'Unemployment', direction: 'up', detail: 'Still above 9%' },
        ],
        sentiment: 'A confluence of crises: European sovereign debt crisis, US credit downgrade, ongoing QE, and elevated inflation created the perfect environment for gold. Every macro factor aligned bullishly.',
        keyDrivers: 'EU crisis, US downgrade, deeply negative real rates, QE2',
    },
    {
        id: 'gold-crash-2013',
        date: '2013-04-15',
        title: 'Flash Crash — Worst 2-Day Drop in 30 Years',
        direction: 'bearish',
        priceFrom: 1565,
        priceTo: 1321,
        change: '-15.6%',
        summary: 'Gold suffered its worst two-day decline in three decades. Triggered by Cyprus selling gold reserves and Fed taper expectations, massive stop-loss cascades amplified the selloff.',
        factors: [
            { name: 'Real Rates', direction: 'up', detail: 'Rising on taper expectations' },
            { name: 'DXY', direction: 'up', detail: 'Dollar strengthening' },
            { name: 'VIX', direction: 'down', detail: 'Low volatility environment' },
            { name: 'CPI', direction: 'down', detail: 'Inflation declining toward 1%' },
        ],
        sentiment: 'The narrative shifted from inflation fear to recovery optimism. Rising real rates removed gold\'s key tailwind. The Cyprus forced gold sale sparked panic, and algorithmic stop-losses created a cascading liquidation event.',
        keyDrivers: 'Taper tantrum expectations, rising real rates, Cyprus gold sale, technical breakdown',
    },
    {
        id: 'taper-tantrum',
        date: '2013-06-19',
        title: 'Bernanke Taper Tantrum',
        direction: 'bearish',
        priceFrom: 1380,
        priceTo: 1192,
        change: '-13.6%',
        summary: 'Fed Chair Bernanke suggested tapering QE asset purchases. Gold plunged as the market priced in the end of easy money and a normalization of real interest rates.',
        factors: [
            { name: 'Real Rates', direction: 'up', detail: '10Y TIPS yield surged +130bps' },
            { name: 'DXY', direction: 'up', detail: 'Dollar rallied sharply' },
            { name: 'VIX', direction: 'up', detail: 'Brief spike on tantrum' },
            { name: 'Unemployment', direction: 'down', detail: 'Improving to ~7.5%' },
        ],
        sentiment: 'The taper tantrum marked the definitive end of gold\'s post-GFC bull run. Rising real yields and a stronger dollar created a toxic environment for gold. The improving employment picture reduced need for accommodation.',
        keyDrivers: 'Taper announcement, real rate surge, dollar strength',
    },
    {
        id: 'trump-election',
        date: '2016-11-09',
        title: 'Trump Election — Initial Selloff',
        direction: 'bearish',
        priceFrom: 1305,
        priceTo: 1170,
        change: '-10.3%',
        summary: 'Trump\'s election initially sent gold higher overnight, but reversed sharply as markets pivoted to the "reflation trade" — expecting tax cuts, deregulation, and dollar strength.',
        factors: [
            { name: 'DXY', direction: 'up', detail: 'Dollar surged on growth expectations' },
            { name: 'Real Rates', direction: 'up', detail: 'Rising on fiscal expansion' },
            { name: 'VIX', direction: 'down', detail: 'Quick normalization' },
            { name: 'CPI', direction: 'up', detail: 'Reflation expectations building' },
        ],
        sentiment: 'The classic "sell the safe haven, buy the risk asset" rotation. Markets priced in pro-growth policies driving dollar strength and higher real rates, both headwinds for gold.',
        keyDrivers: 'Reflation trade, dollar strength, rising rate expectations',
    },
    {
        id: 'covid-crash',
        date: '2020-03-09',
        title: 'COVID-19 Pandemic Crash',
        direction: 'bearish',
        priceFrom: 1672,
        priceTo: 1471,
        change: '-12.0%',
        summary: 'Similar to Lehman, the COVID crash initially hit gold as a liquidity event. Forced selling across all asset classes as margin calls cascaded through the system.',
        factors: [
            { name: 'VIX', direction: 'up', detail: 'Spiked to 82 — highest ever' },
            { name: 'DXY', direction: 'up', detail: 'Dollar squeeze on deleveraging' },
            { name: 'Unemployment', direction: 'up', detail: 'About to explode to 14.7%' },
            { name: 'Real Rates', direction: 'down', detail: 'Collapsing on emergency cuts' },
        ],
        sentiment: 'A repeat of the Lehman playbook: extreme panic → forced liquidation → sell everything for cash. Gold recovered rapidly as the Fed launched unlimited QE and rates went to zero.',
        keyDrivers: 'Pandemic panic, liquidity crisis, forced deleveraging',
    },
    {
        id: 'gold-ath-2020',
        date: '2020-08-07',
        title: 'New All-Time High — $2,075',
        direction: 'bullish',
        priceFrom: 1810,
        priceTo: 2075,
        change: '+14.6%',
        summary: 'Gold reached a new all-time high as unlimited QE, zero rates, massive fiscal stimulus, and pandemic uncertainty combined to create the perfect storm for precious metals.',
        factors: [
            { name: 'Real Rates', direction: 'down', detail: 'Most negative in history (-1.1%)' },
            { name: 'DXY', direction: 'down', detail: 'Dollar at multi-year lows' },
            { name: 'CPI', direction: 'up', detail: 'Inflation expectations rising' },
            { name: 'VIX', direction: 'down', detail: 'Declining but elevated' },
            { name: 'Unemployment', direction: 'up', detail: 'Still above 10%' },
        ],
        sentiment: 'The most bullish macro backdrop for gold in history: deeply negative real rates, collapsing dollar, massive monetary expansion, rising inflation expectations, and ongoing pandemic uncertainty.',
        keyDrivers: 'Record negative real rates, unlimited QE, dollar weakness, fiscal stimulus',
    },
    {
        id: 'fed-hikes-2022',
        date: '2022-09-28',
        title: 'Aggressive Fed Hiking — Gold Pressured',
        direction: 'bearish',
        priceFrom: 1900,
        priceTo: 1622,
        change: '-14.6%',
        summary: 'The Fed\'s most aggressive tightening cycle in 40 years sent real rates soaring and the dollar to 20-year highs, creating maximum headwinds for gold.',
        factors: [
            { name: 'Real Rates', direction: 'up', detail: 'Surged above 1.5%' },
            { name: 'DXY', direction: 'up', detail: 'Hit 114 — 20-year high' },
            { name: 'CPI', direction: 'up', detail: '9.1% peak but declining' },
            { name: 'Unemployment', direction: 'down', detail: '3.5% — near record low' },
            { name: 'VIX', direction: 'up', detail: 'Elevated 25-35 range' },
        ],
        sentiment: 'Classic gold bear case: rapidly rising real yields increased the opportunity cost of holding gold, while dollar strength at 20-year highs made gold expensive globally. Despite 40-year-high inflation, real rates dominated.',
        keyDrivers: 'Fed tightening, soaring real rates, 20-year dollar high',
    },
    {
        id: 'central-bank-buying',
        date: '2023-10-27',
        title: 'Central Bank Buying Frenzy',
        direction: 'bullish',
        priceFrom: 1820,
        priceTo: 2063,
        change: '+13.4%',
        summary: 'Record central bank gold purchases (1,037 tonnes in 2023) drove gold higher despite elevated real rates. Geopolitical de-dollarization narrative gained traction.',
        factors: [
            { name: 'Real Rates', direction: 'up', detail: 'Still elevated ~2%' },
            { name: 'DXY', direction: 'flat', detail: 'Rangebound 103-107' },
            { name: 'VIX', direction: 'down', detail: 'Relatively calm' },
            { name: 'CPI', direction: 'down', detail: 'Inflation declining to ~3%' },
        ],
        sentiment: 'A paradigm shift in gold price drivers. Traditional correlations (real rates, DXY) partially broke down as central banks — especially China, Poland, India — became the dominant marginal buyer. Geopolitical fragmentation and de-dollarization.',
        keyDrivers: 'Record CB buying, de-dollarization, geopolitical hedging',
    },
    {
        id: 'gold-3000',
        date: '2025-02-14',
        title: 'Gold Breaks $3,000',
        direction: 'bullish',
        priceFrom: 2650,
        priceTo: 3100,
        change: '+17.0%',
        summary: 'Gold shattered the $3,000 barrier as continued central bank accumulation, geopolitical tensions, fiscal deficit concerns, and AI-driven economic uncertainty fueled the rally.',
        factors: [
            { name: 'Real Rates', direction: 'down', detail: 'Declining on cut expectations' },
            { name: 'DXY', direction: 'down', detail: 'Weakening dollar' },
            { name: 'CPI', direction: 'flat', detail: 'Sticky around 3%' },
            { name: 'VIX', direction: 'up', detail: 'Rising uncertainty' },
            { name: 'Unemployment', direction: 'up', detail: 'Gradually rising' },
        ],
        sentiment: 'The $3,000 milestone represented a structural shift in gold\'s role. Persistent central bank buying, US fiscal concerns ($35T+ debt), geopolitical fragmentation, and the breakdown of traditional financial correlations propelled gold into a new regime.',
        keyDrivers: 'Central bank demand, fiscal concerns, geopolitical fragmentation, weakening dollar',
    },
];


// --- Presidential Terms ---
const PRESIDENTIAL_TERMS = [
    {
        name: 'Bill Clinton',
        term: '1993 – 2001',
        party: 'democrat',
        goldStart: 330,
        goldEnd: 272,
        change: '-17.6%',
        high: 415,
        low: 253,
        context: 'Strong dollar policy, tech boom, budget surpluses — worst environment for gold.',
    },
    {
        name: 'George W. Bush',
        term: '2001 – 2009',
        party: 'republican',
        goldStart: 272,
        goldEnd: 882,
        change: '+224.3%',
        high: 1011,
        low: 256,
        context: '9/11, Iraq War, weak dollar, GFC — multiple crises drove sustained gold bull market.',
    },
    {
        name: 'Barack Obama',
        term: '2009 – 2017',
        party: 'democrat',
        goldStart: 882,
        goldEnd: 1151,
        change: '+30.5%',
        high: 1921,
        low: 1049,
        context: 'QE-driven peak to $1,921 in 2011, then taper tantrum crash. Net positive but volatile.',
    },
    {
        name: 'Donald Trump (1st)',
        term: '2017 – 2021',
        party: 'republican',
        goldStart: 1151,
        goldEnd: 1898,
        change: '+64.9%',
        high: 2075,
        low: 1124,
        context: 'Trade wars, COVID pandemic, unlimited QE, zero rates — gold hit new ATH at $2,075.',
    },
    {
        name: 'Joe Biden',
        term: '2021 – 2025',
        party: 'democrat',
        goldStart: 1898,
        goldEnd: 2650,
        change: '+39.6%',
        high: 2790,
        low: 1622,
        context: 'Inflation spike, Fed hiking, then central bank buying frenzy. Gold resilient despite high rates.',
    },
    {
        name: 'Donald Trump (2nd)',
        term: '2025 – Present',
        party: 'republican',
        goldStart: 2650,
        goldEnd: 3100,
        change: '+17.0%',
        high: 3167,
        low: 2596,
        context: 'Tariff policies, fiscal concerns, continued central bank accumulation pushed gold past $3,000.',
    },
];
