# console-trading
js scripts for trading on binance directly from browser console

## how to use
1. login to your binance account and open futures trading page
2. open the script in editor and set order parameters like this:
```js
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
    ```

3. select all (ctrl(cmd) + A) copy and paste to the browser console opened at logged in binance futures trading page and hit enter.

NOTE: dont forget to set your API / API secret keys 
