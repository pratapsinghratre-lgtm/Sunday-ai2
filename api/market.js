const https = require("https");

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Sunday-AI/1.0",
          ...headers
        }
      },
      (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          try {
            if (
              response.statusCode < 200 ||
              response.statusCode >= 300
            ) {
              return reject(
                new Error(`API status: ${response.statusCode}`)
              );
            }

            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error("API timeout"));
    });

    request.on("error", reject);
  });
}

async function getStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("Alpha Vantage API key is not configured");
  }

  const url =
    "https://www.alphavantage.co/query" +
    "?function=TIME_SERIES_DAILY" +
    "&symbol=" + encodeURIComponent(symbol) +
    "&outputsize=compact" +
    "&apikey=" + encodeURIComponent(apiKey);

  const data = await fetchJSON(url);

  if (data.Note || data.Information || data["Error Message"]) {
    throw new Error(
      data.Note ||
      data.Information ||
      data["Error Message"]
    );
  }

  const series = data["Time Series (Daily)"];

  if (!series) {
    throw new Error("Daily stock data is unavailable for this symbol");
  }

  const dates = Object.keys(series).sort().reverse();

  if (dates.length === 0) {
    throw new Error("No stock history returned");
  }

  const latestDate = dates[0];
  const latest = series[latestDate];

  return {
    symbol,
    dataType: "daily",
    latestDate,
    latest: {
      open: Number(latest["1. open"]),
      high: Number(latest["2. high"]),
      low: Number(latest["3. low"]),
      close: Number(latest["4. close"]),
      volume: Number(latest["5. volume"])
    },
    history: dates.slice(0, 5).map((date) => ({
      date,
      open: Number(series[date]["1. open"]),
      high: Number(series[date]["2. high"]),
      low: Number(series[date]["3. low"]),
      close: Number(series[date]["4. close"]),
      volume: Number(series[date]["5. volume"])
    })),
    note: "Daily historical data; not a live intraday quote."
  };
}

async function getCryptoData() {
  return fetchJSON(
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ethereum" +
    "&vs_currencies=inr" +
    "&include_24hr_change=true"
  );
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      error: "GET request required"
    });
  }

  // Default example: Reliance on BSE.
  // You can request another supported symbol using ?symbol=...
  const requestedSymbol =
    typeof req.query?.symbol === "string"
      ? req.query.symbol.trim().toUpperCase()
      : "RELIANCE.BSE";

  // Prevent arbitrary input from being passed as a symbol.
  if (!/^[A-Z0-9._-]{1,30}$/.test(requestedSymbol)) {
    return res.status(400).json({
      success: false,
      error: "Invalid stock symbol"
    });
  }

  const results = await Promise.allSettled([
    getStockData(requestedSymbol),
    getCryptoData()
  ]);

  const stockResult = results[0];
  const cryptoResult = results[1];

  const stock =
    stockResult.status === "fulfilled"
      ? stockResult.value
      : null;

  const crypto =
    cryptoResult.status === "fulfilled"
      ? cryptoResult.value
      : null;

  const errors = [];

  if (!stock) {
    errors.push(
      "Stock data unavailable: " +
      (stockResult.reason?.message || "Unknown error")
    );
  }

  if (!crypto) {
    errors.push("Crypto data is temporarily unavailable");
  }

  return res.status(200).json({
    success: Boolean(stock || crypto),
    updatedAt: new Date().toISOString(),
    currency: "INR",
    stock,
    crypto: crypto
      ? {
          bitcoin: crypto.bitcoin || null,
          ethereum: crypto.ethereum || null
        }
      : null,
    errors,
    message:
      "Stock prices are daily historical data, not live intraday prices. " +
      "News and live Indian index data are not connected yet."
  });
};
