void (async () => {
    let currentOrderSymbol = '';

    const orderParams = {
        symbol: (currentOrderSymbol = '1000RATSUSDT'),
        side: 'SELL',              // 'BUY' or 'SELL'
        type: 'STOP_MARKET',       // keep STOP_MARKET as requested

        quantity: depositPercentToQty(10),
        // quantity: usdtToQty(10),

        stopPrice: 0.0570,         // your trigger price; Binance param name is stopPrice
        positionSide: 'SHORT',     // 'BOTH' for one-way, or 'LONG'/'SHORT' for hedge
        // optional extras you can uncomment if needed:
        // workingType: 'MARK_PRICE',    // or 'CONTRACT_PRICE'
        // priceProtect: 'TRUE',         // 'TRUE' or 'FALSE'
        // reduceOnly: 'true',           // if you want it to only reduce an existing position
    };

    //
    //
    //
    //
    //

    //
    //
    //
    //
    //
    //
    //                   FOR SECURITY REASON
    //
    //
    //
    //
    //
    //
    //
    //
    //
    //
    //
    //
    ///

    const BASE_URL = 'https://fapi.binance.com';
    const recvWindow = 5000;      // ms
    const api_key = '';
    const api_secret = '';

    async function hmacSha256Hex(messageString, secretString) {
        const textEncoder = new TextEncoder();
        const secretBytes = textEncoder.encode(secretString);
        const messageBytes = textEncoder.encode(messageString);

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            secretBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        const signatureArrayBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageBytes);
        const signatureBytes = new Uint8Array(signatureArrayBuffer);

        let hexString = '';
        for (let byteIndex = 0; byteIndex < signatureBytes.length; byteIndex += 1) {
            hexString += signatureBytes[byteIndex].toString(16).padStart(2, '0');
        }
        return hexString;
    }

    function buildQueryString(parametersObject) {
        const sortedKeys = Object.keys(parametersObject).sort();
        const searchParameters = new URLSearchParams();

        for (const key of sortedKeys) {
            const value = parametersObject[key];
            if (value === null || typeof value === 'undefined') continue;
            searchParameters.append(key, String(value));
        }

        return searchParameters.toString();
    }

    async function getServerTime() {
        const response = await fetch(`${BASE_URL}/fapi/v1/time`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });

        const responseText = await response.text();
        const json = JSON.parse(responseText);

        return json.serverTime;
    }

    async function signedRequest(method, path, parametersObject) {
        const timestamp = await getServerTime();

        const signedParameters = {
            ...parametersObject,
            recvWindow,
            timestamp,
        };

        const queryString = buildQueryString(signedParameters);
        const signatureHex = await hmacSha256Hex(queryString, api_secret);

        const url = `${BASE_URL}${path}?${queryString}&signature=${signatureHex}`;

        const response = await fetch(url, {
            method,
            headers: {
                'X-MBX-APIKEY': api_key,
                'Accept': 'application/json',
            },
        });

        const responseText = await response.text();

        let responseJson = null;
        try {
            responseJson = JSON.parse(responseText);
        } catch {
            responseJson = { raw: responseText };
        }

        if (!response.ok) {
            console.error('Binance error response:', responseJson);
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        return responseJson;
    }

    async function signedGet(path, parametersObject) {
        return await signedRequest('GET', path, parametersObject);
    }

    async function signedPost(path, parametersObject) {
        return await signedRequest('POST', path, parametersObject);
    }

    async function publicGet(path, parametersObject) {
        const queryString = buildQueryString(parametersObject || {});
        const url = queryString === '' ? `${BASE_URL}${path}` : `${BASE_URL}${path}?${queryString}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
        });

        const responseText = await response.text();
        const json = JSON.parse(responseText);

        if (!response.ok) {
            console.error('Binance public error response:', json);
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        return json;
    }

    function getDecimalsCount(decimalString) {
        const dotIndex = decimalString.indexOf('.');
        if (dotIndex === -1) return 0;
        return decimalString.length - dotIndex - 1;
    }

    function floorToStep(valueNumber, stepNumber, decimalsCount) {
        const factor = Math.pow(10, decimalsCount);
        const scaled = Math.floor((valueNumber * factor) / (stepNumber * factor)) * (stepNumber * factor);
        return scaled / factor;
    }

    function ceilToStep(valueNumber, stepNumber, decimalsCount) {
        const factor = Math.pow(10, decimalsCount);
        const scaled = Math.ceil((valueNumber * factor) / (stepNumber * factor)) * (stepNumber * factor);
        return scaled / factor;
    }

    async function getSymbolLotSizeFilter(symbol) {
        const exchangeInfo = await publicGet('/fapi/v1/exchangeInfo', { symbol });
        const symbolInfo = exchangeInfo.symbols && exchangeInfo.symbols.length ? exchangeInfo.symbols[0] : null;
        const filtersArray = symbolInfo && symbolInfo.filters ? symbolInfo.filters : [];
        return filtersArray.find(filterItem => filterItem.filterType === 'LOT_SIZE') || null;
    }

    async function getCurrentPrice(symbol) {
        const ticker = await publicGet('/fapi/v1/ticker/price', { symbol });
        return Number(ticker.price);
    }

    async function getFuturesUsdtAvailableBalance() {
        const balancesArray = await signedGet('/fapi/v2/balance', {});
        const usdtRow = Array.isArray(balancesArray) ? balancesArray.find(row => row.asset === 'USDT') : null;

        const availableBalanceString = usdtRow && typeof usdtRow.availableBalance !== 'undefined'
            ? String(usdtRow.availableBalance)
            : (usdtRow && typeof usdtRow.balance !== 'undefined' ? String(usdtRow.balance) : '0');

        return Number(availableBalanceString);
    }

    async function normalizeQuantity(symbol, rawQuantityNumber, currentPriceNumber) {
        const lotSizeFilter = await getSymbolLotSizeFilter(symbol);

        const stepSizeString = lotSizeFilter && lotSizeFilter.stepSize ? String(lotSizeFilter.stepSize) : '1';
        const minQtyString = lotSizeFilter && lotSizeFilter.minQty ? String(lotSizeFilter.minQty) : '0';

        const stepSizeNumber = Number(stepSizeString);
        const minQtyNumber = Number(minQtyString);
        const stepDecimalsCount = getDecimalsCount(stepSizeString);

        let normalizedQuantity = floorToStep(rawQuantityNumber, stepSizeNumber, stepDecimalsCount);

        if (normalizedQuantity < minQtyNumber) {
            normalizedQuantity = minQtyNumber;
        }

        const notional = normalizedQuantity * currentPriceNumber;

        if (notional < 5) {
            const requiredQuantity = 5 / currentPriceNumber;
            normalizedQuantity = ceilToStep(requiredQuantity, stepSizeNumber, stepDecimalsCount);

            if (normalizedQuantity < minQtyNumber) {
                normalizedQuantity = minQtyNumber;
            }
        }

        return Number(normalizedQuantity.toFixed(stepDecimalsCount));
    }

    function usdtToQty(usdtAmountNumber) {
        return async () => {
            const symbol = currentOrderSymbol;
            const currentPriceNumber = await getCurrentPrice(symbol);
            const rawQuantityNumber = usdtAmountNumber / currentPriceNumber;
            return await normalizeQuantity(symbol, rawQuantityNumber, currentPriceNumber);
        };
    }

    function depositPercentToQty(depositPercentNumber) {
        return async () => {
            const futuresUsdtBalanceNumber = await getFuturesUsdtAvailableBalance();
            const usdtAmountNumber = futuresUsdtBalanceNumber * (depositPercentNumber / 100);

            const symbol = currentOrderSymbol;
            const currentPriceNumber = await getCurrentPrice(symbol);
            const rawQuantityNumber = usdtAmountNumber / currentPriceNumber;

            return await normalizeQuantity(symbol, rawQuantityNumber, currentPriceNumber);
        };
    }

    async function resolveQuantity(orderParamsObject) {
        if (typeof orderParamsObject.quantity === 'function') {
            orderParamsObject.quantity = await orderParamsObject.quantity();
        }
    }

    await resolveQuantity(orderParams);

    const result = await signedPost('/fapi/v1/order', orderParams);

    console.log('STOP_MARKET order placed successfully:', result);
    window.__lastBinanceFapiStopMarketOrderResult = result;
})().catch((error) => {
    console.error('STOP_MARKET script failed:', error);
});
