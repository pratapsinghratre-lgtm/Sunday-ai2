const { GoogleGenerativeAI } = require("@google/generative-ai");
const https = require("https");

const MODEL_NAME = "gemini-3.5-flash";

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a helpful personal assistant.
Speak in simple Hindi or Hinglish and address the user as Boss.
Help with general questions, education, CSC-related questions,
and educational analysis of stock or crypto charts.
Never invent market data or claim historical data is live.
Clearly mention the date and source of market information.
Explain market concepts educationally; never promise profits.
If verified data is unavailable, say so clearly.
`;

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Sunday-AI/1.0",
          Accept: "application/json",
          ...headers,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(new Error(`API status: ${response.statusCode}`));
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid API response"));
          }
        });
      }
    );

    request.setTimeout(10000, () =>
      request.destroy(new Error("API timeout"))
    );

    request.on("error", reject);
  });
}

function formatINR(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "N/A";
  }

  return Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTime(date = new Date()) {
  return (
    date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " IST"
  );
}

function dateInIndia(timestamp) {
  return new Date(timestamp * 1000).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ---------------- CRYPTO DATA ---------------- */

async function getCryptoPrices() {
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers = apiKey ? { "x-cg-demo-api-key": apiKey } : {};

  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ethereum&vs_currencies=inr&include_24hr_change=true";

  return fetchJSON(url, headers);
}

function asksForLiveCryptoPrice(prompt) {
  const mentionsCrypto =
    /\b(bitcoin|btc|ethereum|ether|eth|crypto|cryptocurrency)\b/i.test(
      prompt
    );

  const asksForPrice =
    /(price|rate|quote|current|latest|live|today|aaj|abhi|daam|kimat|कीमत|दाम|भाव)/i.test(
      prompt
    );

  return mentionsCrypto && asksForPrice;
}

function buildCryptoReply(data) {
  const lines = ["Boss, crypto price information:"];

  for (const [name, key] of [
    ["Bitcoin", "bitcoin"],
    ["Ethereum", "ethereum"],
  ]) {
    const coin = data[key];

    if (!coin || coin.inr === undefined) continue;

    const change = coin.inr_24h_change;

    const changeText =
      typeof change === "number"
        ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
        : "N/A";

    lines.push(
      `${name}: ₹${formatINR(coin.inr)} | 24-hour change: ${changeText}`
    );
  }

  lines.push(
    `Fetched: ${formatTime()}`,
    "Source: CoinGecko",
    "Note: Prices may be delayed and can change."
  );

  return lines.join("\n");
}

/* ---------------- STOCK DATA + TECHNICAL ANALYSIS ---------------- */

function detectStockRequest(prompt) {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  const mentionsStock =
    /\b(stock|share|shares|market data|historical|trend|support|resistance|rsi|reliance|tcs|infosys|hdfcbank|icicibank|tatamotors|itc)\b/i.test(
      text
    ) || /\b[A-Z0-9]{2,15}\.(?:BSE|NSE)\b/i.test(text);

  const asksForData =
    /(price|quote|data|market|chart|current|latest|live|today|aaj|abhi|bhav|भाव|कीमत|दाम|historical|history|trading days|trend|support|resistance|rsi|technical analysis|analysis|pichhle|पिछले)/i.test(
      text
    );

  if (!mentionsStock || !asksForData) return null;

  const explicitSymbol = text.match(
    /\b([A-Z0-9]{2,15}\.(?:BSE|NSE))\b/i
  );

  if (explicitSymbol) return explicitSymbol[1].toUpperCase();

  const symbols = [
    [/\breliance\b/i, "RELIANCE.BSE"],
    [/\btcs\b/i, "TCS.BSE"],
    [/\binfosys\b/i, "INFY.BSE"],
    [/\bhdfc\s*bank\b/i, "HDFCBANK.BSE"],
    [/\bicici\s*bank\b/i, "ICICIBANK.BSE"],
    [/\btata\s*motors\b/i, "TATAMOTORS.BSE"],
    [/\bitc\b/i, "ITC.BSE"],
  ];

  for (const [pattern, symbol] of symbols) {
    if (pattern.test(lower)) return symbol;
  }

  return null;
}

// Wilder's standard RSI-14 calculation.
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  const changes = [];

  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let gainTotal = 0;
  let lossTotal = 0;

  for (let i = 0; i < period; i++) {
    gainTotal += Math.max(changes[i], 0);
    lossTotal += Math.max(-changes[i], 0);
  }

  let avgGain = gainTotal / period;
  let avgLoss = lossTotal / period;

  for (let i = period; i < changes.length; i++) {
    avgGain =
      (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;

    avgLoss =
      (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;

  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

async function getDailyStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) throw new Error("STOCK_API_KEY_MISSING");

  const url =
    "https://www.alphavantage.co/query" +
    `?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}` +
    `&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;

  const data = await fetchJSON(url);

  if (data.Note || data.Information) {
    throw new Error("STOCK_API_LIMIT");
  }

  if (data["Error Message"] || !data["Time Series (Daily)"]) {
    throw new Error("STOCK_DATA_UNAVAILABLE");
  }

  const series = data["Time Series (Daily)"];
  const dates = Object.keys(series).sort().reverse();

  if (dates.length < 15) {
    throw new Error("INSUFFICIENT_STOCK_HISTORY");
  }

  const history = dates.slice(0, 30).map((date) => ({
    date,
    open: Number(series[date]["1. open"]),
    high: Number(series[date]["2. high"]),
    low: Number(series[date]["3. low"]),
    close: Number(series[date]["4. close"]),
    volume: Number(series[date]["5. volume"]),
  }));

  const latest = history[0];
  const chronological = [...history].reverse();
  const closes = chronological.map((row) => row.close);
  const rsi14 = calculateRSI(closes, 14);

  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];

  const changePercent = firstClose
    ? Number((((lastClose - firstClose) / firstClose) * 100).toFixed(2))
    : 0;

  let trend = "Sideways";

  if (changePercent > 1) trend = "Uptrend";
  else if (changePercent < -1) trend = "Downtrend";

  const support = Math.min(...history.map((row) => row.low));
  const resistance = Math.max(...history.map((row) => row.high));

  return {
    symbol,
    date: latest.date,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    close: latest.close,
    volume: latest.volume,
    history,
    analysis: {
      tradingDays: history.length,
      trend,
      changePercent,
      support: Number(support.toFixed(2)),
      resistance: Number(resistance.toFixed(2)),
      rsi14,
    },
    source: "Alpha Vantage",
 
