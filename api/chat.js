// ==========================================
// SUNDAY AI — PART 1 OF 3
// CONFIGURATION, HELPERS, CRYPTO & MEMORY
// ==========================================

const { GoogleGenerativeAI } = require("@google/generative-ai");
const https = require("https");

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a helpful personal AI assistant.

Rules:
- Reply naturally in Hindi or Hinglish when appropriate.
- Be friendly, clear, and respectful.
- Explain technical topics step by step.
- Use conversation history when it is provided.
- Do not claim to remember conversations that were not provided.
- Never invent live prices, news, or market data.
- Clearly distinguish verified data from estimates.
- Explain financial information educationally; never promise profits.
- For coding requests, preserve the user's existing features.
- If information is missing, ask a useful clarification.
`;

// ------------------------------------------
// HTTPS JSON HELPER
// ------------------------------------------

function fetchJSON(url, headers = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "SundayAI/1.0",
          Accept: "application/json",
          ...headers,
        },
      },
      (response) => {
        let data = "";

        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new Error(
                `API request failed with status ${response.statusCode}`
              )
            );
          }

          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("API returned invalid JSON"));
          }
        });
      }
    );

    request.setTimeout(timeout, () => {
      request.destroy(new Error("API request timed out"));
    });

    request.on("error", reject);
  });
}

// ------------------------------------------
// HTTPS TEXT HELPER
// ------------------------------------------

function fetchText(url, headers = {}, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "SundayAI/1.0",
          ...headers,
        },
      },
      (response) => {
        let data = "";

        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new Error(
                `Request failed with status ${response.statusCode}`
              )
            );
          }

          resolve(data);
        });
      }
    );

    request.setTimeout(timeout, () => {
      request.destroy(new Error("Request timed out"));
    });

    request.on("error", reject);
  });
}

// ------------------------------------------
// FORMATTING HELPERS
// ------------------------------------------

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

function dateInIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ------------------------------------------
// CONVERSATION MEMORY / HISTORY
// ------------------------------------------

// This keeps the recent history supplied by the frontend.
// It does not independently save permanent conversation data.

function sanitizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => {
      return (
        item &&
        typeof item === "object" &&
        ["user", "assistant", "model"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim().length > 0
      );
    })
    .slice(-20)
    .map((item) => ({
      role: item.role === "assistant" ? "model" : item.role,
      content: item.content.trim().slice(0, 6000),
    }));
}

// ------------------------------------------
// CRYPTO PRICE HELPERS
// ------------------------------------------

async function getCryptoPrices() {
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ethereum" +
    "&vs_currencies=usd,inr" +
    "&include_24hr_change=true";

  const data = await fetchJSON(url);

  return {
    bitcoin: data.bitcoin || null,
    ethereum: data.ethereum || null,
    updatedAt: new Date().toISOString(),
  };
}

function asksForLiveCryptoPrice(message) {
  const text = String(message || "").toLowerCase();

  const cryptoWords =
    /\b(bitcoin|btc|ethereum|eth|crypto|cryptocurrency)\b/.test(text);

  const priceWords =
    /\b(price|rate|value|live|current|latest|cost|कीमत|भाव|दाम)\b/.test(text);

  return cryptoWords && priceWords;
}

function buildCryptoReply(data) {
  if (!data || (!data.bitcoin && !data.ethereum)) {
    return "Boss, abhi crypto prices available nahi hain. Thodi der baad try karein.";
  }

  function describe(name, item) {
    if (!item) {
      return `${name}: data unavailable`;
    }

    const usd = Number(item.usd);
    const inr = Number(item.inr);
    const change = Number(item.usd_24h_change);

    const lines = [`${name}:`];

    if (Number.isFinite(inr)) {
      lines.push(`INR price: ${formatINR(inr)}`);
    }

    if (Number.isFinite(usd)) {
      lines.push(
        `USD price: ${new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        }).format(usd)}`
      );
    }

    if (Number.isFinite(change)) {
      lines.push(`24-hour change: ${change.toFixed(2)}%`);
    }

    return lines.join("\n");
  }

  return [
    "Live crypto data response:",
    describe("Bitcoin (BTC)", data.bitcoin),
    describe("Ethereum (ETH)", data.ethereum),
    `Data checked: ${formatTime(data.updatedAt)}`,
    "",
    "Note: Prices can change quickly and may be delayed.",
  ].join("\n");
}

// ==========================================
// END OF PART 1
// PART 2 WILL CONTAIN STOCKS, RSI, INDICES
// AND COMPANY NEWS HELPERS.
// ==========================================// ==========================================
// SUNDAY AI — PART 2 OF 3
// STOCKS, RSI, INDICES AND COMPANY NEWS
// Paste directly below Part 1.
// ==========================================

// ------------------------------------------
// STOCK SYMBOL ALIASES
// ------------------------------------------

const COMPANY_ALIASES = {
  reliance: "RELIANCE.BSE",
  "reliance industries": "RELIANCE.BSE",
  tcs: "TCS.BSE",
  "tata consultancy services": "TCS.BSE",
  infosys: "INFY.BSE",
  infy: "INFY.BSE",
  itc: "ITC.BSE",
  "tata motors": "TATAMOTORS.BSE",
  "hdfc bank": "HDFCBANK.BSE",
  "icici bank": "ICICIBANK.BSE",
};

// ------------------------------------------
// DETECT STOCK SYMBOL
// ------------------------------------------

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

  return explicit ? explicit[1].toUpperCase() + "." +
    explicit[2].toUpperCase() : null;
}

// ------------------------------------------
// DETECT STOCK REQUEST
// ------------------------------------------

function detectStockRequest(message) {
  const text = String(message || "").toLowerCase();

  const asksStock =
    /\b(stock|share|shares|price|chart|history|historical|rsi|support|resistance|close|market data)\b/.test(text) ||
    /शेयर|स्टॉक|भाव|कीमत|सपोर्ट|रेजिस्टेंस/.test(text);

  if (!asksStock) {
    return null;
  }

  return detectStockSymbol(message);
}

// ------------------------------------------
// RSI CALCULATION
// ------------------------------------------

function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) {
    return null;
  }

  const values = closes
    .map(Number)
    .filter(Number.isFinite);

  if (values.length <= period) {
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
      (averageGain * (period - 1) + Math.max(change, 0)) /
      period;

    averageLoss =
      (averageLoss * (period - 1) + Math.max(-change, 0)) /
      period;
  }

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const relativeStrength = averageGain / averageLoss;

  return 100 - 100 / (1 + relativeStrength);
}

// ------------------------------------------
// ALPHA VANTAGE STOCK HISTORY
// Requires ALPHA_VANTAGE_API_KEY in environment.
// ------------------------------------------

async function getDailyStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not configured.");
  }

  const url =
    "https://www.alphavantage.co/query" +
    `?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}` +
    `&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;

  const data = await fetchJSON(url);

  if (data.Note || data.Information) {
    throw new Error(
      "Alpha Vantage request limit reached. Try again later."
    );
  }

  if (data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }

  const series = data["Time Series (Daily)"];

  if (!series) {
    throw new Error("Daily stock data is unavailable.");
  }

  const dates = Object.keys(series).sort().reverse();

  const rows = dates.map((date) => ({
    date,
    open: Number(series[date]["1. open"]),
    high: Number(series[date]["2. high"]),
    low: Number(series[date]["3. low"]),
    close: Number(series[date]["4. close"]),
    volume: Number(series[date]["5. volume"]),
  }));

  const validRows = rows.filter((row) =>
    Number.isFinite(row.close)
  );

  if (!validRows.length) {
    throw new Error("No valid stock history was returned.");
  }

  const latest = validRows[0];
  const previous = validRows[1] || null;
  const closes = validRows.map((row) => row.close).reverse();

  const change =
    previous && previous.close !== 0
      ? ((latest.close - previous.close) / previous.close) * 100
      : null;

  const recent = validRows.slice(0, 14);
  const lows = recent.map((row) => row.low).filter(Number.isFinite);
  const highs = recent.map((row) => row.high).filter(Number.isFinite);

  return {
    symbol,
    date: latest.date,
    close: latest.close,
    previousClose: previous ? previous.close : null,
    dailyChangePercent: change,
    rsi14: calculateRSI(closes, 14),
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null,
    volume: latest.volume,
  };
}

// ------------------------------------------
// BUILD STOCK REPLY
// ------------------------------------------

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
    "Note: Support and resistance are historical estimates, not guarantees.",
  ].join("\n");
}

// ------------------------------------------
// DETECT INDEX REQUEST
// ------------------------------------------

function detectIndexRequest(message) {
  const text = String(message || "").toLowerCase();

  if (text.includes("bank nifty") || text.includes("banknifty")) {
    return { symbol: "^NSEBANK", name: "BANK NIFTY" };
  }

  if (
    text.includes("nifty 50") ||
    text.includes("nifty50") ||
    /\bnifty\b/.test(text)
  ) {
    return { symbol: "^NSEI", name: "NIFTY 50" };
  }

  return null;
}

// ------------------------------------------
// YAHOO FINANCE INDEX DATA
// ------------------------------------------

async function getIndexData(index) {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(index.symbol) +
    "?range=5d&interval=1d";

  const data = await fetchJSON(url);
  const result = data?.chart?.result?.[0];

  if (!result || !result.timestamp?.length) {
    throw new Error("Index data is currently unavailable.");
  }

  const quotes = result.indicators?.quote?.[0];

  if (!quotes?.close?.length) {
    throw new Error("Index closing data is unavailable.");
  }

  const valid = result.timestamp
    .map((timestamp, i) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: Number(quotes.close[i]),
    }))
    .filter((row) => Number.isFinite(row.close));

  if (!valid.length) {
    throw new Error("No valid index values were returned.");
  }

  const latest = valid[valid.length - 1];
  const previous = valid.length > 1 ? valid[valid.length - 2] : null;

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

// ------------------------------------------
// BUILD INDEX REPLY
// ------------------------------------------

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
    `📊 Index: ${report.symbol}`,
    `Latest available date: ${report.date}`,
    `Close: ${money(report.close)}`,
    `Previous close: ${money(report.previousClose)}`,
    `Daily change: ${percent(report.dailyChangePercent)}`,
  ].join("\n");
}

// ------------------------------------------
// COMPANY NEWS HELPERS
// ------------------------------------------

function decodeXML(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getXMLTag(block, tag) {
  const match = String(block).match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")
  );

  return match ? decodeXML(match[1].replace(/<!\\[CDATA\\[|\\]\\]>/g, "").trim()) : "";
}

function asksForCompanyNews(message) {
  const text = String(message || "").toLowerCase();

  return (
    /\b(news|latest news|company update|headlines|announcement)\b/.test(text) ||
    /समाचार|खबर|ताज़ा खबर/.test(text)
  );
}

async function getGoogleNewsRSS(company) {
  const query = encodeURIComponent(`${company} when:7d`);
  const url =
    `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;

  const xml = await fetchText(url);
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];

  return blocks.slice(0, 5).map((block) => ({
    title: getXMLTag(block, "title"),
    link: getXMLTag(block, "link"),
    published: getXMLTag(block, "pubDate"),
  })).filter((item) => item.title);
}

function detectNewsCompany(message) {
  const text = String(message || "").toLowerCase();

  for (const name of Object.keys(COMPANY_ALIASES)) {
    if (text.includes(name)) return name;
  }

  return null;
}

async function getCompanyNews(message) {
  const company = detectNewsCompany(message);

  if (!company) {
    return null;
  }

  return getGoogleNewsRSS(company);
}

function buildNewsReply(company, news) {
  if (!Array.isArray(news) || news.length === 0) {
    return `Boss, ${company} ke liye abhi news available nahi hai.`;
  }

  return [
    `Latest available news: ${company}`,
    "",
    ...news.map((item, index) =>
      `${index + 1}. ${item.title}\n${item.published || "Publication date unavailable"}\n${item.link || ""}`
    ),
    "",
    "News headlines may change; open the source to verify details.",
  ].join("\n");
}

// ==========================================
// END OF PART 2
// PART 3 WILL CONTAIN GEMINI, IMAGE INPUT
// AND THE FINAL API HANDLER.
// ==========================================// ==========================================
// SUNDAY AI — PART 3 OF 3
// GEMINI + IMAGE ANALYSIS + MEMORY + API HANDLER
// ==========================================

// ---------- IMAGE INPUT ----------

function getImageParts(body) {
  const parts = [];

  const image =
    body.image ||
    body.imageBase64 ||
    body.imageData;

  if (!image || typeof image !== "string") {
    return parts;
  }

  const match = image.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
  );

  if (match) {
    parts.push({
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    });
  } else {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: image,
      },
    });
  }

  return parts;
}

// ---------- GEMINI ASSISTANT ----------

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

  const validHistory = sanitizeHistory(history);

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
    { text: String(prompt || "") },
    ...imageParts,
  ];

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await chat.sendMessage(messageParts);
      const response = result.response;

      return response.text();
    } catch (error) {
      lastError = error;

      const message = String(error.message || "");

      const retryable =
        /503|429|500|502|504|overloaded|temporarily unavailable/i.test(
          message
        );

      if (!retryable || attempt === 3) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, attempt * 1000)
      );
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

// ---------- JSON RESPONSE HELPER ----------

function sendJSON(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.json(data);
}

// ---------- FINAL API HANDLER ----------

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJSON(res, 405, {
      error: "Method not allowed. Use POST.",
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const message = String(
      body.message || body.prompt || ""
    ).trim();

    if (!message && !body.image && !body.imageBase64 && !body.imageData) {
      return sendJSON(res, 400, {
        error: "Please provide a message or an image.",
      });
    }

    // Conversation memory supplied by the frontend.
    const history = sanitizeHistory(
      body.history || body.messages || []
    );

    // 1. Cryptocurrency prices
    if (asksForLiveCryptoPrice(message)) {
      try {
        const prices = await getCryptoPrices();

        return sendJSON(res, 200, {
          reply: buildCryptoReply(prices),
          memorySupported: true,
        });
      } catch (error) {
        console.error("Crypto error:", error.message);

        return sendJSON(res, 502, {
          error: "Crypto price service is temporarily unavailable.",
        });
      }
    }

    // 2. NIFTY and BANK NIFTY
    const index = detectIndexRequest(message);

    if (index) {
      try {
        const report = await getIndexData(index);

        return sendJSON(res, 200, {
          reply: buildIndexReply(report),
          memorySupported: true,
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
          const news = await getCompanyNews(message);

          return sendJSON(res, 200, {
            reply: buildNewsReply(company, news),
            memorySupported: true,
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
          memorySupported: true,
        });
      } catch (error) {
        console.error("Stock error:", error.message);

        return sendJSON(res, 502, {
          error: error.message || "Stock data is unavailable.",
        });
      }
    }

    // 5. General Gemini chat and image analysis
    const imageParts = getImageParts(body);

    const reply = await askGemini(
      message || "Please describe the uploaded image.",
      imageParts,
      history
    );

    return sendJSON(res, 200, {
      reply,
      memorySupported: true,
    });
  } catch (error) {
    console.error("Sunday AI API error:", error);

    return sendJSON(res, 500, {
      error: "Sunday AI server error. Please try again.",
    });
  }
};
