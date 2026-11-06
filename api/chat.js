// ==========================================
// JARVIS AI - COMPLETE API
// Gemini + Image + Trading Education
// Crypto + Stocks + Indices + Live News + CSC
// ==========================================

const { GoogleGenerativeAI } = require("@google/generative-ai");
const https = require("https");

const MODEL_NAME =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const SYSTEM_INSTRUCTION = `
You are JARVIS AI, a helpful personal assistant.

LANGUAGE:
- Reply naturally in Hindi or Hinglish when appropriate.
- Explain difficult things step by step.
- Be friendly, clear and respectful.

GENERAL:
- Use supplied conversation history.
- Never claim to remember conversations that were not supplied.
- Never invent facts, prices, news or government rules.
- Clearly mention when information is unavailable or uncertain.

TRADING MASTER:
- Explain stock-market concepts for education.
- Explain candlesticks, RSI, support, resistance and indicators.
- Distinguish historical data from live market data.
- Never promise profits.
- Never give personalized buy/sell instructions.
- Explain that market data can be delayed.

CSC:
- Explain CSC services and general application processes.
- Mention that requirements can change.
- Do not claim an application has been submitted.
- Direct users to verify requirements through official government services.

IMAGES:
- Describe uploaded images carefully.
- Do not invent details that cannot be seen.

CODING:
- Preserve existing features when editing code.
- Explain setup steps clearly.
`;


// ==========================================
// JSON RESPONSE
// ==========================================

function sendJSON(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  return res.end(JSON.stringify(data));
}


// ==========================================
// HTTPS HELPERS
// ==========================================

function fetchText(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "JARVIS-AI/1.0",
          Accept: "*/*",
        },
      },
      (response) => {
        let data = "";

        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          data += chunk;

          if (data.length > 2 * 1024 * 1024) {
            request.destroy(new Error("Response too large."));
          }
        });

        response.on("end", () => {
          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new Error(`External service error: ${response.statusCode}`)
            );
          }

          resolve(data);
        });
      }
    );

    request.setTimeout(timeout, () => {
      request.destroy(new Error("Request timed out."));
    });

    request.on("error", reject);
  });
}


function fetchJSON(url) {
  return fetchText(url).then((text) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("External service returned invalid JSON.");
    }
  });
}


// ==========================================
// FORMATTING
// ==========================================

function formatINR(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(number);
}


function formatTime(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}


// ==========================================
// REQUEST BODY
// ==========================================

function getRequestBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error("Request body contains invalid JSON.");
    }
  }

  return {};
}


// ==========================================
// CONVERSATION HISTORY
// ==========================================

function sanitizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const items = history
    .filter((item) =>
      item &&
      typeof item === "object" &&
      ["user", "assistant", "model"].includes(item.role) &&
      typeof item.content === "string" &&
      item.content.trim()
    )
    .slice(-20)
    .map((item) => ({
      role: item.role === "assistant" ? "model" : item.role,
      content: item.content.trim().slice(0, 6000),
    }));

  const result = [];

  for (const item of items) {
    const previous = result[result.length - 1];

    if (previous && previous.role === item.role) {
      previous.content += "\n" + item.content;
    } else {
      result.push({ ...item });
    }
  }

  while (result.length && result[0].role !== "user") {
    result.shift();
  }

  return result;
}


// ==========================================
// IMAGE INPUT
// ==========================================

function getImageParts(body) {
  const image =
    body.image ||
    body.imageBase64 ||
    body.imageData;

  if (!image) {
    return [];
  }

  if (typeof image !== "string") {
    throw new Error("Invalid image data.");
  }

  const match = image.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
  );

  const mimeType =
    match?.[1] ||
    body.mimeType ||
    "image/jpeg";

  const base64 =
    match?.[2] ||
    image.replace(/\s/g, "");

  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(mimeType)) {
    throw new Error("Unsupported image format. Use JPG, PNG or WEBP.");
  }

  // Keep image size within a practical server request limit.
  if (!base64 || base64.length > 4 * 1024 * 1024) {
    throw new Error("Image is empty or too large. Try a smaller image.");
  }

  return [
    {
      inlineData: {
        mimeType,
        data: base64,
      },
    },
  ];
}

// ==========================================
// GEMINI AI - IMPROVED RETRY SYSTEM
// ==========================================

async function askGemini(prompt, imageParts = [], history = []) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  let validHistory = sanitizeHistory(history);

  if (
    validHistory.length &&
    validHistory[validHistory.length - 1].role === "user"
  ) {
    validHistory.pop();
  }

  const chatHistory = validHistory.map((item) => ({
    role: item.role,
    parts: [{ text: item.content }],
  }));

  const chat = model.startChat({
    history: chatHistory,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  });

  const messageParts = [
    {
      text: String(
        prompt || "Please describe the uploaded image."
      ),
    },
    ...imageParts,
  ];

  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const result = await chat.sendMessage(messageParts);
      const answer = result.response.text();

      if (!answer) {
        throw new Error("Gemini returned an empty response.");
      }

      return answer;

    } catch (error) {
      lastError = error;

      const message = String(error.message || "");
      const retryable =
        /503|429|500|502|504|overloaded|temporarily unavailable/i.test(message);

      console.error(
        `Gemini attempt ${attempt} failed:`,
        message
      );

      if (!retryable || attempt === 4) {
        break;
      }

      const delay = Math.min(
        1500 * Math.pow(2, attempt - 1),
        10000
      );

      await new Promise((resolve) =>
        setTimeout(resolve, delay)
      );
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

// ==========================================
// CRYPTO PRICE
// ==========================================

function asksForCrypto(message) {
  const text = String(message || "").toLowerCase();

  const hasCrypto =
    /\b(bitcoin|btc|ethereum|eth|crypto)\b/.test(text);

  const hasPrice =
    /\b(price|rate|value|live|current|latest|cost)\b/.test(text) ||
    /कीमत|भाव|दाम/.test(text);

  return hasCrypto && hasPrice;
}


async function getCryptoPrices() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ethereum" +
    "&vs_currencies=usd,inr" +
    "&include_24hr_change=true";

  return fetchJSON(url);
}


function buildCryptoReply(data) {
  if (!data || (!data.bitcoin && !data.ethereum)) {
    return "अभी crypto prices उपलब्ध नहीं हैं। बाद में कोशिश करें।";
  }

  function describe(name, item) {
    if (!item) {
      return `${name}: unavailable`;
    }

    const lines = [`${name}:`];

    if (Number.isFinite(Number(item.inr))) {
      lines.push(`INR: ${formatINR(item.inr)}`);
    }

    if (Number.isFinite(Number(item.usd))) {
      lines.push(`USD: $${Number(item.usd).toLocaleString("en-US")}`);
    }

    if (Number.isFinite(Number(item.usd_24h_change))) {
      lines.push(
        `24-hour change: ${Number(item.usd_24h_change).toFixed(2)}%`
      );
    }

    return lines.join("\n");
  }

  return [
    "Crypto price information:",
    describe("Bitcoin (BTC)", data.bitcoin),
    describe("Ethereum (ETH)", data.ethereum),
    `Checked: ${formatTime(new Date())}`,
    "",
    "Prices can change quickly and may be delayed.",
  ].join("\n");
}


// ==========================================
// STOCK SYMBOLS
// ==========================================

const COMPANY_ALIASES = {
  reliance: "RELIANCE.BSE",
  "reliance industries": "RELIANCE.BSE",
  tcs: "TCS.BSE",
  infosys: "INFY.BSE",
  infy: "INFY.BSE",
  itc: "ITC.BSE",
  "tata motors": "TATAMOTORS.BSE",
  "hdfc bank": "HDFCBANK.BSE",
  "icici bank": "ICICIBANK.BSE",
};


function detectStockSymbol(message) {
  const text = String(message || "").toLowerCase();

  for (const [name, symbol] of Object.entries(COMPANY_ALIASES)) {
    if (text.includes(name)) {
      return symbol;
    }
  }

  const explicit = String(message || "").match(
    /\b([A-Z]{2,12})\.(BSE|NSE)\b/i
  );

  if (!explicit) {
    return null;
  }

  return (
    `${explicit[1].toUpperCase()}.` +
    explicit[2].toUpperCase()
  );
}


function detectStockRequest(message) {
  const text = String(message || "").toLowerCase();

  const asksStock =
    /\b(stock|share|shares|price|chart|history|historical|rsi|support|resistance)\b/.test(text) ||
    /शेयर|स्टॉक|भाव|कीमत|सपोर्ट|रेजिस्टेंस/.test(text);

  return asksStock ? detectStockSymbol(message) : null;
}


// ==========================================
// RSI
// ==========================================

function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes)) {
    return null;
  }

  const values = closes.map(Number);

  if (
    values.length <= period ||
    !values.every(Number.isFinite)
  ) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) gains += change;
    if (change < 0) losses -= change;
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    averageGain =
      (averageGain * (period - 1) + Math.max(change, 0)) / period;

    averageLoss =
      (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const rs = averageGain / averageLoss;

  return 100 - 100 / (1 + rs);
}


// ==========================================
// ALPHA VANTAGE STOCK DATA
// ==========================================

async function getDailyStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not configured.");
  }

  const url =
    "https://www.alphavantage.co/query" +
    "?function=TIME_SERIES_DAILY" +
    `&symbol=${encodeURIComponent(symbol)}` +
    "&outputsize=compact" +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const data = await fetchJSON(url);

  if (data.Note || data.Information) {
    throw new Error("Stock data limit reached. Try later.");
  }

  if (data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }

  const series = data["Time Series (Daily)"];

  if (!series) {
    throw new Error("Stock history is unavailable.");
  }

  const dates = Object.keys(series).sort().reverse();

  const rows = dates.map((date) => ({
    date,
    close: Number(series[date]["4. close"]),
    high: Number(series[date]["2. high"]),
    low: Number(series[date]["3. low"]),
    volume: Number(series[date]["5. volume"]),
  }));

  const validRows = rows.filter((row) =>
    Number.isFinite(row.close)
  );

  if (!validRows.length) {
    throw new Error("No valid stock data returned.");
  }

  const latest = validRows[0];
  const previous = validRows[1] || null;
  const closes = validRows.map((row) => row.close).reverse();

  const recent = validRows.slice(0, 14);

  const lows = recent
    .map((row) => row.low)
    .filter(Number.isFinite);

  const highs = recent
    .map((row) => row.high)
    .filter(Number.isFinite);

  return {
    symbol,
    date: latest.date,
    close: latest.close,
    previousClose: previous?.close ?? null,
    dailyChangePercent:
      previous && previous.close !== 0
        ? ((latest.close - previous.close) / previous.close) * 100
        : null,
    rsi14: calculateRSI(closes, 14),
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null,
    volume: latest.volume,
  };
}


function buildStockReply(report) {
  const money = (value) =>
    Number.isFinite(Number(value))
      ? Number(value).toFixed(2)
      : "Unavailable";

  const percent = (value) =>
    Number.isFinite(Number(value))
      ? `${Number(value).toFixed(2)}%`
      : "Unavailable";

  return [
    `Stock: ${report.symbol}`,
    `Latest available date: ${report.date}`,
    `Close: ₹${money(report.close)}`,
    `Previous close: ₹${money(report.previousClose)}`,
    `Daily change: ${percent(report.dailyChangePercent)}`,
    `RSI (14): ${money(report.rsi14)}`,
    `Support estimate: ₹${money(report.support)}`,
    `Resistance estimate: ₹${money(report.resistance)}`,
    `Volume: ${money(report.volume)}`,
    "",
    "Educational data only. Values may be delayed.",
  ].join("\n");
}


// ==========================================
// NIFTY / BANK NIFTY
// ==========================================

function detectIndexRequest(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("bank nifty") || text.includes("banknifty")) {
    return {
      symbol: "^NSEBANK",
      name: "BANK NIFTY",
    };
  }

  if (
    text.includes("nifty 50") ||
    text.includes("nifty50") ||
    /\bnifty\b/.test(text)
  ) {
    return {
      symbol: "^NSEI",
      name: "NIFTY 50",
    };
  }

  return null;
}


async function getIndexData(index) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(index.symbol) +
    "?range=5d&interval=1d";

  const data = await fetchJSON(url);
  const result = data?.chart?.result?.[0];

  if (!result || !result.timestamp?.length) {
    throw new Error("Index data is unavailable.");
  }

  const closes = result.indicators?.quote?.[0]?.close;

  if (!closes) {
    throw new Error("Index closing values are unavailable.");
  }

  const rows = result.timestamp
    .map((timestamp, i) => ({
      date: new Date(timestamp * 1000)
        .toISOString()
        .slice(0, 10),
      close: Number(closes[i]),
    }))
    .filter((row) => Number.isFinite(row.close));

  if (!rows.length) {
    throw new Error("No valid index values returned.");
  }

  const latest = rows[rows.length - 1];
  const previous = rows.length > 1
    ? rows[rows.length - 2]
    : null;

  return {
    symbol: index.name,
    date: latest.date,
    close: latest.close,
    previousClose: previous?.close ?? null,
    dailyChangePercent:
      previous && previous.close !== 0
        ? ((latest.close - previous.close) / previous.close) * 100
        : null,
  };
}


function buildIndexReply(report) {
  const money = (value) =>
    Number.isFinite(Number(value))
      ? Number(value).toFixed(2)
      : "Unavailable";

  const percent = (value) =>
    Number.isFinite(Number(value))
      ? `${Number(value).toFixed(2)}%`
      : "Unavailable";

  return [
    `Index: ${report.symbol}`,
    `Date: ${report.date}`,
    `Close: ${money(report.close)}`,
    `Previous close: ${money(report.previousClose)}`,
    `Daily change: ${percent(report.dailyChangePercent)}`,
    "",
    "Market data may be delayed.",
  ].join("\n");
}


// ==========================================
// COMPANY NEWS - GOOGLE NEWS RSS
// ==========================================

function decodeXML(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}


function getXMLTag(block, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(
    `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`,
    "i"
  );

  const match = String(block).match(regex);

  return match ? decodeXML(match[1].trim()) : "";
}


function asksForCompanyNews(message) {
  const text = String(message || "").toLowerCase();

  return (
    /\b(news|latest news|company update|headlines|announcement)\b/.test(text) ||
    /समाचार|खबर|ताज़ा खबर/.test(text)
  );
}


function detectNewsCompany(message) {
  const text = String(message || "").toLowerCase();

  for (const name of Object.keys(COMPANY_ALIASES)) {
    if (text.includes(name)) {
      return name;
    }
  }

  return null;
}


async function getGoogleNewsRSS(company) {
  const query = encodeURIComponent(`${company} when:7d`);

  const url =
    "https://news.google.com/rss/search?q=" +
    query +
    "&hl=en-IN&gl=IN&ceid=IN:en";

  const xml = await fetchText(url);

  const blocks =
    xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];

  return blocks
    .slice(0, 5)
    .map((block) => ({
      title: getXMLTag(block, "title"),
      link: getXMLTag(block, "link"),
      published: getXMLTag(block, "pubDate"),
    }))
    .filter((item) => item.title);
}


function buildNewsReply(company, news) {
  if (!Array.isArray(news) || news.length === 0) {
    return `अभी ${company} की खबरें उपलब्ध नहीं हैं।`;
  }

  return [
    `Latest available news: ${company}`,
    "",
    ...news.map((item, index) =>
      `${index + 1}. ${item.title}\n${item.published || "Date unavailable"}\n${item.link || ""}`
    ),
    "",
    "खबर की पूरी जानकारी के लिए मूल स्रोत खोलकर जाँचें।",
  ].join("\n");
}


// ==========================================
// MAIN API HANDLER
// ==========================================

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJSON(res, 405, {
      error: "Method not allowed. Use POST.",
    });
  }

  try {
    const body = getRequestBody(req);

    const message = String(
      body.message || body.prompt || ""
    ).trim();

    const hasImage = Boolean(
      body.image ||
      body.imageBase64 ||
      body.imageData
    );

    if (!message && !hasImage) {
      return sendJSON(res, 400, {
        error: "Please enter a message or upload an image.",
      });
    }

    const history = sanitizeHistory(
      body.history || body.messages || []
    );

    // 1. Crypto
    if (asksForCrypto(message)) {
      try {
        const data = await getCryptoPrices();

        return sendJSON(res, 200, {
          reply: buildCryptoReply(data),
          memorySupported: false,
        });
      } catch (error) {
        console.error("Crypto error:", error.message);

        return sendJSON(res, 502, {
          error: "Crypto price service is temporarily unavailable.",
        });
      }
    }

    // 2. Indices
    const index = detectIndexRequest(message);

    if (index) {
      try {
        const report = await getIndexData(index);

        return sendJSON(res, 200, {
          reply: buildIndexReply(report),
          memorySupported: false,
        });
      } catch (error) {
        console.error("Index error:", error.message);

        return sendJSON(res, 502, {
          error: "Index data is temporarily unavailable.",
        });
      }
    }

    // 3. Company news
    if (asksForCompanyNews(message)) {
      const company = detectNewsCompany(message);

      if (company) {
        try {
          const news = await getGoogleNewsRSS(company);

          return sendJSON(res, 200, {
            reply: buildNewsReply(company, news),
            memorySupported: false,
          });
        } catch (error) {
          console.error("News error:", error.message);

          return sendJSON(res, 502, {
            error: "Company news is temporarily unavailable.",
          });
        }
      }
    }

    // 4. Historical stock data
    const stockSymbol = detectStockRequest(message);

    if (stockSymbol) {
      try {
        const report = await getDailyStockData(stockSymbol);

        return sendJSON(res, 200, {
          reply: buildStockReply(report),
          memorySupported: false,
        });
      } catch (error) {
        console.error("Stock error:", error.message);

        return sendJSON(res, 502, {
          error: error.message || "Stock data is unavailable.",
        });
      }
    }

    // 5. Gemini chat and image analysis
    const imageParts = getImageParts(body);

    const reply = await askGemini(
      message || "Please describe the uploaded image.",
      imageParts,
      history
    );

    return sendJSON(res, 200, {
      reply,
      memorySupported: false,
    });

  } catch (error) {
    console.error("JARVIS API error:", error.message);

    const message = String(error.message || "");

    const isBadRequest =
      /image format|image is empty|too large|invalid JSON|invalid image/i.test(
        message
      );

    return sendJSON(res, isBadRequest ? 400 : 500, {
      error: isBadRequest
        ? message
        : "JARVIS AI server error. Check Vercel Runtime Logs.",
    });
  }
};
