const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================
// SUNDAY AI — API/CHAT
// PART 1 OF 3: CONFIGURATION + BASIC HELPERS
// ==========================================

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a helpful personal AI assistant.

Rules:
- Speak naturally and helpfully.
- Understand Hindi, Hinglish, and English.
- Explain technical topics in simple steps.
- Use market data carefully and distinguish facts from estimates.
- Never claim that a trade or investment is guaranteed to profit.
- Explain financial information for education, not as guaranteed
  personalized investment advice.
- When information is unavailable, clearly say so.
- If the user sends an image, analyze only what is actually visible.
- Remember relevant context provided in the current conversation.
`;

// ---------- BASIC RESPONSE HELPERS ----------

function sendJSON(res, statusCode, data) {
  return res.status(statusCode).json(data);
}

function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.^=_-]/g, "");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTemporaryError(error) {
  const message = String(error?.message || error || "");

  return /429|500|502|503|504|overloaded|high demand|temporarily unavailable|timeout|timed out/i
    .test(message);
}

// ---------- FETCH WITH TIMEOUT ----------

async function fetchJSON(url, timeoutMs = 12000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "SundayAI/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- CRYPTO PRICE DATA ----------

async function getCryptoPrice(query) {
  const text = String(query || "").toLowerCase();

  const coins = [
    { names: ["bitcoin", "btc"], id: "bitcoin" },
    { names: ["ethereum", "eth"], id: "ethereum" },
    { names: ["solana", "sol"], id: "solana" },
    { names: ["dogecoin", "doge"], id: "dogecoin" },
    { names: ["ripple", "xrp"], id: "ripple" },
    { names: ["cardano", "ada"], id: "cardano" },
    { names: ["binance coin", "bnb"], id: "binancecoin" },
    { names: ["tron", "trx"], id: "tron" },
    { names: ["avalanche", "avax"], id: "avalanche-2" },
    { names: ["polkadot", "dot"], id: "polkadot" }
  ];

  const coin = coins.find(item =>
    item.names.some(name => {
      const pattern = new RegExp(
        `(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
        "i"
      );

      return pattern.test(text);
    })
  );

  if (!coin) {
    return null;
  }

  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    `?ids=${encodeURIComponent(coin.id)}` +
    "&vs_currencies=usd,inr" +
    "&include_24hr_change=true";

  const data = await fetchJSON(url);
  const price = data?.[coin.id];

  if (!price) {
    throw new Error("CRYPTO_PRICE_UNAVAILABLE");
  }

  return {
    name: coin.names[0],
    id: coin.id,
    usd: price.usd ?? null,
    inr: price.inr ?? null,
    change24h: price.usd_24h_change ?? null
  };
}

function formatCryptoReply(coin) {
  const change = Number(coin.change24h);

  return [
    `🪙 ${coin.name.toUpperCase()} ka latest available price:`,
    `USD: ${coin.usd == null ? "Unavailable" : "$" + coin.usd}`,
    `INR: ${coin.inr == null ? "Unavailable" : "₹" + coin.inr}`,
    `24-hour change: ${Number.isFinite(change) ? change.toFixed(2) + "%" : "Unavailable"}`,
    "",
    "Note: Price badalti rehti hai. Yeh live trading guarantee nahi hai."
  ].join("\n");
}

// ---------- HISTORY INPUT CLEANUP ----------

function sanitizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const cleaned = [];

  for (const item of history.slice(-20)) {
    if (!item || typeof item.text !== "string") {
      continue;
    }

    const role = item.role;

    if (role !== "user" && role !== "model") {
      continue;
    }

    const text = item.text.trim();

    if (!text) {
      continue;
    }

    cleaned.push({
      role,
      parts: [{ text: text.slice(0, 6000) }]
    });
  }

  // Gemini chat history should begin with a user message.
  while (cleaned.length && cleaned[0].role !== "user") {
    cleaned.shift();
  }

  // Ensure alternating user/model messages.
  const valid = [];

  for (const item of cleaned) {
    if (
      valid.length === 0 ||
      valid[valid.length - 1].role !== item.role
    ) {
      valid.push(item);
    }
  }

  // A previous assistant reply should end the supplied history.
  while (valid.length && valid[valid.length - 1].role !== "model") {
    valid.pop();
  }

  return valid;
                                     }// ==========================================
// SUNDAY AI — PART 2 OF 3
// STOCKS + INDICES + TECHNICAL ANALYSIS + NEWS
// Paste this directly below Part 1.
// ==========================================

// ---------- STOCK / INDEX SYMBOLS ----------

const INDEX_SYMBOLS = {
  "NIFTY": "^NSEI",
  "NIFTY 50": "^NSEI",
  "BANK NIFTY": "^NSEBANK",
  "BANKNIFTY": "^NSEBANK",
  "SENSEX": "^BSESN"
};

function getIndexSymbol(message) {
  const text = String(message || "").toUpperCase();

  if (text.includes("BANK NIFTY") || text.includes("BANKNIFTY")) {
    return "^NSEBANK";
  }

  if (text.includes("SENSEX")) {
    return "^BSESN";
  }

  if (text.includes("NIFTY")) {
    return "^NSEI";
  }

  return null;
}

function getStockSymbol(message) {
  let text = String(message || "").trim().toUpperCase();

  // Remove common stock-analysis phrases.
  text = text
    .replace(/\b(ANALYZE|ANALYSIS|CHART|PRICE|STOCK|SHARE|STOCK PRICE|SHARE PRICE)\b/g, " ")
    .replace(/\b(TODAY|DAILY|HISTORY|HISTORICAL|RSI|SUPPORT|RESISTANCE)\b/g, " ")
    .replace(/\b(NIFTY 50|BANK NIFTY|BANKNIFTY|SENSEX|NIFTY)\b/g, " ")
    .replace(/\b(PRICE OF|STOCK OF|SHARE OF|ANALYZE THE)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  // Convert common Indian company names into Yahoo Finance symbols.
  const aliases = {
    "RELIANCE": "RELIANCE.NS",
    "TCS": "TCS.NS",
    "INFOSYS": "INFY.NS",
    "HDFC BANK": "HDFCBANK.NS",
    "ICICI BANK": "ICICIBANK.NS",
    "SBIN": "SBIN.NS",
    "SBI": "SBIN.NS",
    "ITC": "ITC.NS",
    "TATA MOTORS": "TATAMOTORS.NS",
    "BHARTI AIRTEL": "BHARTIARTL.NS",
    "WIPRO": "WIPRO.NS",
    "ADANI PORTS": "ADANIPORTS.NS",
    "TATA STEEL": "TATASTEEL.NS",
    "MARUTI": "MARUTI.NS",
    "LT": "LT.NS",
    "HINDUSTAN UNILEVER": "HINDUNILVR.NS",
    "BAJAJ FINANCE": "BAJFINANCE.NS",
    "AXIS BANK": "AXISBANK.NS",
    "KOTAK BANK": "KOTAKBANK.NS",
    "KOTAK MAHINDRA BANK": "KOTAKBANK.NS"
  };

  if (aliases[text]) return aliases[text];

  // Explicit Yahoo-style symbols, such as RELIANCE.NS or AAPL.
  if (/^[A-Z0-9^=.-]{1,30}$/.test(text)) {
    if (text.endsWith(".NS") || text.endsWith(".BO")) {
      return text;
    }

    // If user supplied a bare Indian stock ticker, assume NSE.
    if (/^[A-Z][A-Z0-9&-]{0,19}$/.test(text)) {
      return `${text}.NS`;
    }

    return text;
  }

  return null;
}

// ---------- YAHOO FINANCE HISTORICAL DATA ----------

async function getYahooChart(symbol, range = "3mo", interval = "1d") {
  const safeSymbol = String(symbol || "").trim();

  if (!safeSymbol) {
    throw new Error("STOCK_SYMBOL_MISSING");
  }

  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(safeSymbol) +
    `?range=${encodeURIComponent(range)}` +
    `&interval=${encodeURIComponent(interval)}`;

  const data = await fetchJSON(url);
  const result = data?.chart?.result?.[0];

  if (!result) {
    const message = data?.chart?.error?.description;
    throw new Error(message || "STOCK_DATA_UNAVAILABLE");
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};

  const rows = timestamps.map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: quote.open?.[index] ?? null,
    high: quote.high?.[index] ?? null,
    low: quote.low?.[index] ?? null,
    close: quote.close?.[index] ?? null,
    volume: quote.volume?.[index] ?? null
  })).filter(row =>
    Number.isFinite(row.close) &&
    Number.isFinite(row.high) &&
    Number.isFinite(row.low)
  );

  return {
    symbol: result.meta?.symbol || safeSymbol,
    currency: result.meta?.currency || "Unknown",
    exchange: result.meta?.exchangeName || "Unknown",
    price: result.meta?.regularMarketPrice ?? rows.at(-1)?.close ?? null,
    previousClose: result.meta?.chartPreviousClose ?? null,
    rows
  };
}

// ---------- RSI CALCULATION ----------

function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain =
      (averageGain * (period - 1) + gain) / period;

    averageLoss =
      (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) return 100;

  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

// ---------- SUPPORT / RESISTANCE ----------

function calculateSupportResistance(rows, lookback = 20) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { support: null, resistance: null };
  }

  const recent = rows.slice(-lookback);

  const lows = recent
    .map(row => row.low)
    .filter(Number.isFinite);

  const highs = recent
    .map(row => row.high)
    .filter(Number.isFinite);

  return {
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null
  };
}

// ---------- STOCK ANALYSIS REPORT ----------

async function analyzeStock(symbol) {
  const data = await getYahooChart(symbol, "3mo", "1d");
  const rows = data.rows;

  if (rows.length < 15) {
    throw new Error("NOT_ENOUGH_STOCK_HISTORY");
  }

  const closes = rows.map(row => row.close);
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];

  const rsi = calculateRSI(closes, 14);
  const levels = calculateSupportResistance(rows, 20);

  const change = previous.close
    ? ((latest.close - previous.close) / previous.close) * 100
    : null;

  let rsiStatus = "Neutral range";

  if (rsi !== null && rsi >= 70) {
    rsiStatus = "Potentially overbought";
  } else if (rsi !== null && rsi <= 30) {
    rsiStatus = "Potentially oversold";
  }

  return {
    symbol: data.symbol,
    currency: data.currency,
    latestDate: latest.date,
    latestClose: latest.close,
    previousClose: previous.close,
    dailyChangePercent: change,
    rsi14: rsi,
    rsiStatus,
    support: levels.support,
    resistance: levels.resistance,
    history: rows.slice(-20)
  };
}

function formatStockReport(report) {
  const money = value =>
    Number.isFinite(value) ? value.toFixed(2) : "Unavailable";

  const percent = value =>
    Number.isFinite(value) ? `${value.toFixed(2)}%` : "Unavailable";

  return [
    `📈 Stock analysis: ${report.symbol}`,
    `Latest available date: ${report.latestDate}`,
    `Closing price: ${money(report.latestClose)} ${report.currency}`,
    `Previous close: ${money(report.previousClose)} ${report.currency}`,
    `Daily change: ${percent(report.dailyChangePercent)}`,
    `RSI (14): ${money(report.rsi14)}`,
    `RSI interpretation: ${report.rsiStatus}`,
    `Support estimate (recent 20 sessions): ${money(report.support)}`,
    `Resistance estimate (recent 20 sessions): ${money(report.resistance)}`,
    "",
    "These are historical-data-based technical indicators, not guaranteed predictions.",
    "Market prices may be delayed. Verify prices with your broker before making decisions."
  ].join("\n");
}

// ---------- NIFTY / BANK NIFTY / SENSEX ----------

async function analyzeIndex(message) {
  const symbol = getIndexSymbol(message);

  if (!symbol) return null;

  const data = await getYahooChart(symbol, "3mo", "1d");
  const rows = data.rows;

  if (!rows.length) {
    throw new Error("INDEX_DATA_UNAVAILABLE");
  }

  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];

  const change = previous?.close
    ? ((latest.close - previous.close) / previous.close) * 100
    : null;

  const levels = calculateSupportResistance(rows, 20);
  const rsi = calculateRSI(rows.map(row => row.close), 14);

  return {
    symbol: data.symbol,
    date: latest.date,
    close: latest.close,
    previousClose: previous?.close ?? null,
    dailyChangePercent: change,
    rsi14: rsi,
    support: levels.support,
    resistance: levels.resistance
  };
}

function formatIndexReport(report) {
  const money = value =>
    Number.isFinite(value) ? value.toFixed(2) : "Unavailable";

  const percent = value =>
    Number.isFinite(value) ? `${value.toFixed(2)}%` : "Unavailable";

  return [
    `📊 Index: ${report.symbol}`,
    `Latest available date: ${report.date}`,
    `Close: ${money(report.close)}`,
    `Previous close: ${money(report.previousClose)}`,
    `Daily change: ${percent(report.dailyChangePercent)}`,
    `RSI (14): ${money(report.rsi14)}`,
    `Support estimate: ${money(report.support)}`,
    `Resistance estimate: ${money(report.res// ==========================================
// SUNDAY AI — PART 3 OF 3
// GEMINI + IMAGE ANALYSIS + FINAL API HANDLER
// Paste this directly below Part 2.
// ==========================================

// ---------- IMAGE INPUT ----------

function getImageParts(body) {
  const parts = [];

  const candidates = [
    body.image,
    body.photo,
    body.imageBase64,
    body.base64
  ];

  if (Array.isArray(body.images)) {
    candidates.push(...body.images);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;

    let base64 = "";
    let mimeType = "image/jpeg";

    if (typeof candidate === "string") {
      const match = candidate.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
      );

      if (match) {
        mimeType = match[1];
        base64 = match[2];
      } else {
        base64 = candidate;
      }
    } else if (typeof candidate === "object") {
      base64 =
        candidate.data ||
        candidate.base64 ||
        candidate.imageBase64 ||
        "";

      mimeType =
        candidate.mimeType ||
        candidate.mimetype ||
        candidate.type ||
        mimeType;

      if (typeof base64 === "string") {
        const match = base64.match(
          /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
        );

        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
    }

    if (typeof base64 !== "string") continue;

    base64 = base64.replace(/\s/g, "");

    if (!base64 || !/^image\/(jpeg|png|webp|gif)$/i.test(mimeType)) {
      continue;
    }

    // Prevent unexpectedly large image requests.
    if (base64.length > 8 * 1024 * 1024) {
      throw new Error("IMAGE_TOO_LARGE");
    }

    parts.push({
      inlineData: {
        mimeType,
        data: base64
      }
    });

    // One image is sufficient for the current frontend.
    if (parts.length >= 1) break;
  }

  return parts;
}

// ---------- GEMINI CHAT WITH MEMORY ----------

async function askGemini(prompt, imageParts = [], history = []) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_INSTRUCTION
  });

  const safeHistory = sanitizeHistory(history);

  const messageParts = [
    {
      text: prompt || "Boss, is image ko analyze karo."
    },
    ...imageParts
  ];

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (safeHistory.length > 0) {
        const chat = model.startChat({
          history: safeHistory
        });

        const result = await chat.sendMessage(messageParts);

        return result.response.text();
      }

      const result = await model.generateContent(messageParts);

      return result.response.text();

    } catch (error) {
      const message = String(error?.message || error);

      console.error(
        `Gemini attempt ${attempt}/${maxAttempts} failed:`,
        message.slice(0, 400)
      );

      if (!isTemporaryError(error) || attempt === maxAttempts) {
        throw error;
      }

      await delay(attempt * 1500);
    }
  }

  throw new Error("GEMINI_RETRIES_EXHAUSTED");
}

// ---------- REQUEST CLASSIFICATION ----------

function isNewsRequest(message) {
  return /\b(news|headlines|latest news|company news|market news|stock news)\b/i
    .test(message);
}

function isCryptoRequest(message) {
  return /\b(bitcoin|btc|ethereum|eth|solana|dogecoin|doge|crypto price|cryptocurrency price|xrp|cardano|binance coin)\b/i
    .test(message);
}

function isIndexRequest(message) {
  return /\b(nifty|bank\s*nifty|banknifty|sensex)\b/i
    .test(message);
}

function isStockAnalysisRequest(message) {
  return /\b(stock analysis|analyze stock|analyse stock|share price|stock price|rsi|support and resistance|technical analysis)\b/i
    .test(message);
}

// ---------- FRIENDLY ERROR MESSAGES ----------

function getFriendlyError(error) {
  const message = String(error?.message || error || "");

  if (message.includes("GEMINI_API_KEY_MISSING")) {
    return "Gemini API key missing hai. Project settings mein GEMINI_API_KEY check karo.";
  }

  if (message.includes("IMAGE_TOO_LARGE")) {
    return "Photo bahut badi hai. Chhoti photo upload karke try karo.";
  }

  if (/429|quota|rate.?limit/i.test(message)) {
    return "API ki request limit abhi poori ho gayi hai. Thodi der baad dobara try karo.";
  }

  if (/503|overloaded|high demand|temporarily unavailable/i.test(message)) {
    return "AI service abhi busy hai. Kuch der baad dobara try karo.";
  }

  if (/STOCK_DATA_UNAVAILABLE|INDEX_DATA_UNAVAILABLE|NOT_ENOUGH_STOCK_HISTORY/i.test(message)) {
    return "Is stock ka historical data abhi nahi mil raha. Symbol check karke dobara try karo.";
  }

  if (/CRYPTO_PRICE_UNAVAILABLE|HTTP_429/i.test(message)) {
    return "Price service abhi data nahi de rahi. Thodi der baad try karo.";
  }

  if (/NEWS_QUERY_MISSING|NEWS_HTTP/i.test(message)) {
    return "News fetch nahi ho paayi. Dobara try karo.";
  }

  console.error("Sunday AI request error:", message.slice(0, 500));

  return "Abhi request complete nahi ho paayi. Message dobara bhejkar try karo.";
}

// ---------- MAIN API HANDLER ----------

module.exports = async function handler(req, res) {
  // CORS for browser-based frontend.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return sendJSON(res, 405, {
      reply: "Only POST requests are supported."
    });
  }

  try {
    const body = req.body || {};

    const cleanPrompt = getText(
      body.message || body.prompt
    );

    const imageParts = getImageParts(body);

    if (!cleanPrompt && imageParts.length === 0) {
      return sendJSON(res, 400, {
        reply: "Message ya photo bhejo, phir main help karunga."
      });
    }

    // 1. Cryptocurrency price request.
    if (isCryptoRequest(cleanPrompt)) {
      try {
        const coin = await getCryptoPrice(cleanPrompt);

        if (coin) {
          return sendJSON(res, 200, {
            reply: formatCryptoReply(coin)
          });
        }
      } catch (error) {
        console.error("Crypto lookup failed:", String(error.message || error));
      }
    }

    // 2. NIFTY / BANK NIFTY / SENSEX analysis.
    if (isIndexRequest(cleanPrompt)) {
      try {
        const report = await analyzeIndex(cleanPrompt);

        if (report) {
          return sendJSON(res, 200, {
            reply: formatIndexReport(report)
          });
        }
      } catch (error) {
        console.error("Index lookup failed:", String(error.message || error));
      }
    }

    // 3. Stock technical analysis.
    if (isStockAnalysisRequest(cleanPrompt)) {
      const symbol = getStockSymbol(cleanPrompt);

      if (symbol) {
        try {
          const report = await analyzeStock(symbol);

          return sendJSON(res, 200, {
            reply: formatStockReport(report)
          });
        } catch (error) {
          console.error("Stock analysis failed:", String(error.message || error));
        }
      }
    }

    // 4. News lookup.
    if (isNewsRequest(cleanPrompt)) {
      try {
        const query = cleanPrompt
          .replace(/\b(latest|news|headlines|show|tell|me|about|please|company|market)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

        const news = await getGoogleNews(query || cleanPrompt);

        if (news.length > 0) {
          return sendJSON(res, 200, {
            reply: formatNewsReply(query || cleanPrompt, news)
          });
        }
      } catch (error) {
        console.error("News lookup failed:", String(error.message || error));
      }
    }

    // 5. General conversation or image analysis with Gemini.
    const reply = await askGemini(
      cleanPrompt,
      imageParts,
      Array.isArray(body.history) ? body.history : []
    );

    return sendJSON(res, 200, {
      reply
    });

  } catch (error) {
    const friendlyMessage = getFriendlyError(error);

    return sendJSON(res, 500, {
      reply: friendlyMessage
    });
  }
};
