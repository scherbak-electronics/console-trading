void (async () => {
    // =========================
    // USER SETTINGS (edit these)
    // =========================
    const symbol = 'FHEUSDT';

    // 'long' or 'short'
    const tradeDirection = 'long';

    // Your key level
    const levelPrice = 0.16137;

    // ATR buffers (Gerchik ATR)
    const entryBufferAtrMultiplier = 0.05; // 5% of ATR as entry buffer from the level
    const stopBufferAtrMultiplier = 0.25;  // 25% of ATR behind the level

    // Optional: show targets in R multiples (risk units)
    const riskRewardMultiples = [1, 2, 3];

    // How many candles to request (we only use last 5 CLOSED)
    const requestedDailyLimit = 12;

    // =========================
    // END USER SETTINGS
    // =========================

    const klineEndpointCandidates = [
        'https://fapi.binance.com/fapi/v1/klines',
        'https://www.binance.com/fapi/v1/klines',
        'https://www.binance.com/bapi/futures/v1/public/future/klines',
    ];

    const premiumIndexEndpointCandidates = [
        'https://fapi.binance.com/fapi/v1/premiumIndex',
        'https://www.binance.com/fapi/v1/premiumIndex',
    ];

    async function fetchJson(url) {
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        return await response.json();
    }

    async function fetchWithFallback(endpointCandidates, buildUrlFn) {
        let lastError = null;

        for (const endpointUrl of endpointCandidates) {
            try {
                const url = buildUrlFn(endpointUrl);
                const payload = await fetchJson(url);
                return { endpointUrl, payload };
            } catch (error) {
                lastError = error;
            }
        }

        throw new Error(`All endpoints failed. Last error: ${lastError?.message ?? String(lastError)}`);
    }

    function formatUtcDate(milliseconds) {
        const date = new Date(milliseconds);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day} UTC`;
    }

    function average(numbers) {
        return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    }

    function roundTo(numberValue, decimals) {
        const scale = Math.pow(10, decimals);
        return Math.round(numberValue * scale) / scale;
    }

    const nowMilliseconds = Date.now();

    // -------------------------
    // 1) Fetch daily klines
    // -------------------------
    const { endpointUrl: klinesEndpointUrl, payload: klinesPayload } = await fetchWithFallback(
        klineEndpointCandidates,
        (endpointUrl) => {
            const queryString = new URLSearchParams({
                symbol,
                interval: '1d',
                limit: String(requestedDailyLimit),
            }).toString();
            return `${endpointUrl}?${queryString}`;
        }
    );

    let dailyKlinesArray = null;

    if (Array.isArray(klinesPayload)) {
        dailyKlinesArray = klinesPayload;
    } else if (klinesPayload && Array.isArray(klinesPayload.data)) {
        dailyKlinesArray = klinesPayload.data;
    } else if (klinesPayload && Array.isArray(klinesPayload.result)) {
        dailyKlinesArray = klinesPayload.result;
    } else {
        throw new Error('Unknown klines response shape.');
    }

    const closedDailyKlines = dailyKlinesArray
        .map((kline) => ({
            openTime: Number(kline[0]),
            highPrice: Number(kline[2]),
            lowPrice: Number(kline[3]),
            closePrice: Number(kline[4]),
            closeTime: Number(kline[6]),
        }))
        .filter((kline) => Number.isFinite(kline.closeTime) && kline.closeTime <= nowMilliseconds)
        .slice(-5);

    if (closedDailyKlines.length < 5) {
        console.error('Not enough CLOSED daily candles returned. Got:', closedDailyKlines.length);
        console.log('Klines endpoint used:', klinesEndpointUrl);
        return;
    }

    const dailyRows = closedDailyKlines.map((kline) => {
        const dayRange = kline.highPrice - kline.lowPrice;
        return {
            date: formatUtcDate(kline.openTime),
            high: kline.highPrice,
            low: kline.lowPrice,
            close: kline.closePrice,
            range: dayRange,
        };
    });

    const ranges = dailyRows.map((row) => row.range);
    const sortedRangesAscending = [...ranges].sort((a, b) => a - b);

    const droppedMin = sortedRangesAscending[0];
    const droppedMax = sortedRangesAscending[sortedRangesAscending.length - 1];

    const trimmedRanges = sortedRangesAscending.slice(1, 4);
    const atrGerchik = average(trimmedRanges);

    const lastClosePrice = dailyRows[dailyRows.length - 1].close;
    const atrPercentFromLastClose = (atrGerchik / lastClosePrice) * 100;

    // -------------------------
    // 2) Fetch current mark price (optional, but useful)
    // -------------------------
    let markPrice = null;
    let markPriceEndpointUrl = null;

    try {
        const { endpointUrl, payload } = await fetchWithFallback(
            premiumIndexEndpointCandidates,
            (endpointUrl) => {
                const queryString = new URLSearchParams({ symbol }).toString();
                return `${endpointUrl}?${queryString}`;
            }
        );

        markPriceEndpointUrl = endpointUrl;

        if (payload && typeof payload.markPrice !== 'undefined') {
            markPrice = Number(payload.markPrice);
        } else if (Array.isArray(payload)) {
            const matchingRow = payload.find((row) => row && row.symbol === symbol);
            if (matchingRow && typeof matchingRow.markPrice !== 'undefined') {
                markPrice = Number(matchingRow.markPrice);
            }
        }
    } catch (error) {
        // If mark price fails, we still can compute the plan using lastClosePrice
        markPrice = null;
        markPriceEndpointUrl = null;
    }

    const referenceCurrentPrice = Number.isFinite(markPrice) ? markPrice : lastClosePrice;

    // -------------------------
    // 3) Build entry/stop plan from level + ATR buffers
    // -------------------------
    const entryBuffer = atrGerchik * entryBufferAtrMultiplier;
    const stopBuffer = atrGerchik * stopBufferAtrMultiplier;

    let entryPrice = null;
    let stopPrice = null;

    if (tradeDirection === 'long') {
        entryPrice = levelPrice + entryBuffer;
        stopPrice = levelPrice - stopBuffer;
    } else if (tradeDirection === 'short') {
        entryPrice = levelPrice - entryBuffer;
        stopPrice = levelPrice + stopBuffer;
    } else {
        throw new Error(`Invalid tradeDirection: "${tradeDirection}". Use "long" or "short".`);
    }

    const riskDistance = Math.abs(entryPrice - stopPrice);

    const triggerStatus = (() => {
        if (tradeDirection === 'long') return referenceCurrentPrice >= entryPrice ? 'triggered' : 'waiting';
        return referenceCurrentPrice <= entryPrice ? 'triggered' : 'waiting';
    })();

    const targetRows = riskRewardMultiples.map((multiple) => {
        const targetPrice = tradeDirection === 'long'
            ? entryPrice + riskDistance * multiple
            : entryPrice - riskDistance * multiple;

        return {
            rrMultiple: multiple,
            targetPrice: targetPrice,
        };
    });

    // -------------------------
    // 4) Output
    // -------------------------
    console.log('Daily klines endpoint used:', klinesEndpointUrl);
    if (markPriceEndpointUrl) console.log('Mark price endpoint used:', markPriceEndpointUrl);
    else console.log('Mark price fetch failed (using last daily close as current reference).');

    console.table(dailyRows);

    console.table([{
        atrGerchik: atrGerchik,
        atrPercentFromLastClose: Number(atrPercentFromLastClose.toFixed(2)),
        droppedMin: droppedMin,
        droppedMax: droppedMax,
        trimmedRanges: trimmedRanges.join(', '),
        lastClosePrice: lastClosePrice,
        markPrice: markPrice,
        referenceCurrentPrice: referenceCurrentPrice,
    }]);

    console.table([{
        symbol,
        tradeDirection,
        levelPrice,
        entryBufferAtrMultiplier,
        stopBufferAtrMultiplier,
        atrGerchik: atrGerchik,
        entryBuffer: entryBuffer,
        stopBuffer: stopBuffer,
        entryPrice: entryPrice,
        stopPrice: stopPrice,
        riskDistance: riskDistance,
        triggerStatus,
    }]);

    if (targetRows.length > 0) {
        console.table(targetRows.map((row) => ({
            rrMultiple: row.rrMultiple,
            targetPrice: row.targetPrice,
        })));
    }

    // Save to window for quick use
    window.__atrGerchik = atrGerchik;
    window.__atrGerchikPercent = atrPercentFromLastClose;
    window.__tradePlan = {
        symbol,
        tradeDirection,
        levelPrice,
        atrGerchik,
        entryPrice,
        stopPrice,
        riskDistance,
        triggerStatus,
        referenceCurrentPrice,
        targets: targetRows,
    };

    // If DevTools supports copy()
    if (typeof copy === 'function') {
        copy(window.__tradePlan);
        console.log('Trade plan copied to clipboard as window.__tradePlan');
    }
})().catch((error) => console.error('Script error:', error));
