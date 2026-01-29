void (async () => {
    const symbol = 'FHEUSDT';
    const interval = '1d';
    const requestedLimit = 12;

    const endpointCandidates = [
        'https://fapi.binance.com/fapi/v1/klines',
        'https://www.binance.com/fapi/v1/klines',
        'https://www.binance.com/bapi/futures/v1/public/future/klines',
    ];

    async function fetchJson(url) {
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        return await response.json();
    }

    async function fetchKlinesWithFallback() {
        const queryString = new URLSearchParams({
            symbol,
            interval,
            limit: String(requestedLimit),
        }).toString();

        let lastError = null;

        for (const endpointUrl of endpointCandidates) {
            try {
                const payload = await fetchJson(`${endpointUrl}?${queryString}`);

                if (Array.isArray(payload)) return { endpointUrl, klines: payload };
                if (payload && Array.isArray(payload.data)) return { endpointUrl, klines: payload.data };
                if (payload && Array.isArray(payload.result)) return { endpointUrl, klines: payload.result };

                throw new Error('Unknown response shape.');
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

    const nowMilliseconds = Date.now();

    const { endpointUrl, klines } = await fetchKlinesWithFallback();

    const closedDailyKlines = klines
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
        console.log('Endpoint used:', endpointUrl);
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

    // Gerchik style: drop min and max, average middle 3
    const trimmedRanges = sortedRangesAscending.slice(1, 4);
    const atrGerchik = average(trimmedRanges);

    const lastClosePrice = dailyRows[dailyRows.length - 1].close;
    const atrPercent = (atrGerchik / lastClosePrice) * 100;

    console.log('Endpoint used:', endpointUrl);
    console.table(dailyRows);

    // Вот это будет "ниже таблички" отдельной табличкой
    console.table([{
        atrGerchik,
        atrPercent: Number(atrPercent.toFixed(2)),
        lastClosePrice,
        trimmedRanges: trimmedRanges.join(', '),
        droppedMin: sortedRangesAscending[0],
        droppedMax: sortedRangesAscending[sortedRangesAscending.length - 1],
    }]);

    // чтобы можно было быстро использовать
    window.__atrGerchik = atrGerchik;
    window.__atrGerchikPercent = atrPercent;
})().catch((error) => console.error('ATR script error:', error));
