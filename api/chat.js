// JARVIS AI - STABILIZED API
// Gemini 3.8 Interactions + Image + Crypto + Stocks + RSI
// Nifty / Bank Nifty + Company News + Self-Upgrade Planning

const { GoogleGenAI } = require("@google/genai");
const https = require("https");

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const SYSTEM_INSTRUCTION = `
You are JARVIS AI, a helpful personal assistant.
Reply naturally in Hindi or Hinglish when appropriate.
Keep simple answers short and explain complex tasks step by step.
Use only supplied conversation history. Never claim to remember chats not supplied.
Never invent facts, prices, news, or government rules. State uncertainty clearly.

TRADING:
Explain market concepts, candlesticks, RSI, support, resistance and indicators for education.
Distinguish historical data from live data and mention possible delays.
Never promise profits, predict guaranteed outcomes, or give personalized buy/sell instructions.

CSC:
Explain general CSC services and processes. Requirements can change; recommend checking official portals.
Never claim an application was submitted. Never ask for OTPs, passwords, or sensitive credentials.

IMAGES:
Describe uploaded images carefully. Do not invent details that cannot be seen.

CODING AND SELF-UPGRADE:
Preserve existing features when editing code.
You may suggest improvements and prepare proposed code when asked.
Never claim to have edited, saved, pushed, or deployed files unless that action actually occurred.
Never execute generated code or deploy changes automatically.
Always recommend backup, testing, and explicit user approval before production changes.
`;

function sendJSON(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(data));
}

function fetchText(url, timeout = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "JARVIS-AI/1.1",
          Accept: "*/*",
        },
      },
      (response) => {
        let data = "";

        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          data += chunk;

          if (Buffer.byteLength(data, "utf8") > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("External response too large."));
          }
        });

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(`External service error: ${response.statusCode}`)
            );
            return;
          }

          resolve(data);
        });
      }
    );

    request.setTimeout(timeout, () => {
      request.destroy(new Error("External request timed out."));
    });

    request.on("error", reject);
  });
}

async function fetchJSON(url) {
  const text = await fetchText(url);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("External service returned invalid JSON.");
  }
}

function formatINR(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(number);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function safeNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "Unavailable";
}

function getRequestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error("Request body contains invalid JSON.");
    }
  }

  return {};
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const items = history
    .filter(
      (item) =>
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

function getImageParts(body) {
  const image = body.image || body.imageBase64 || body.imageData;

  if (!image) return [];
  if (typeof image !== "string") {
    throw new Error("Invalid image data.");
  }

  const match = image.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/
  );

  const mimeType = match?.[1] || body.mimeType || "image/jpeg";
  const base64 = (match?.[2] || image).replace(/\s/g, "");

  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(mimeType)) {
    throw new Error("Unsupported image format. Use JPG, PNG or WEBP.");
  }

  if (!base64 || base64.length > 4 * 1024 * 1024) {
    throw new Error("Image is empty or too large. Try a smaller image.");
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Invalid image data.");
  }

  return [
    {
      type: "image",
      data: base64,
      mime_type: mimeType,
    },
  ];
}

// Gemini Interactions API
async function askGemini(prompt, imageParts = [], history = []) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(MODEL_NAME)) {
    throw new Error("GEMINI_MODEL is invalid. Check server environment.");
  }

  const validHistory = sanitizeHistory(history);

  const historyText = validHistory
    .map((item) => {
      const role = item.role === "model" ? "Assistant" : "User";
      return `${role}: ${item.content}`;
    })
    .join("\n\n");

  const currentPrompt = String(
    prompt || "Please describe the uploaded image."
  );

  const fullPrompt = [
    historyText ? "Conversation history:\n" + historyText : "",
    "Current user message:\n" + currentPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  const input = [
    { type: "text", text: fullPrompt },
    ...imageParts,
  ];

  const client = new GoogleGenAI({
  apiKey,
  apiVersion: "v1beta"
});

  const interaction = await client.interactions.create({
    model: MODEL_NAME,
    input,
    system_instruction: SYSTEM_INSTRUCTION,
    generation_config: {
      temperature: 0.6,
      max_output_tokens: 2048,
    },
  });

  const steps = interaction.steps || [];

  const answer = steps
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();

  if (!answer) {
    throw new Error("Gemini returned an empty response.");
  }

  return answer;
}

// Crypto prices
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
    "?ids=bitcoin,ethereum&vs_currencies=usd,inr&include_24hr_change=true";

  return fetchJSON(url);
}

function buildCryptoReply(data) {
  if (!data || (!data.bitcoin && !data.ethereum)) {
    return "अभी crypto prices उपलब्ध नहीं हैं। बाद में कोशिश करें।";
  }

  function describe(name, item) {
    if (!item) return `${name}: unavailable`;

    const lines = [`${name}:`];

    if (Number.isFinite(Number(item.inr))) {
      lines.push(`INR: ${formatINR(item.inr)}`);
    }

    if (Number.isFinite(Number(item.usd))) {
      lines.push(
        `USD: $${Number(item.usd).toLocaleString("en-US")}`
      );
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
    "Prices can change quickly and may be delayed. This is information, not a trading recommendation.",
  ].join("\n");
}

// Stock symbols
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
    if (text.includes(name)) return symbol;
  }

  const explicit = String(message || "").match(
    /\b([A-Z]{2,12})\.(BSE|NSE)\b/i
  );

  if (!explicit) return null;

  return `${explicit[1].toUpperCase()}.${explicit[2].toUpperCase()}`;
}

function detectStockRequest(message) {
  const text = String(message || "").toLowerCase();

  const asksStock =
    /\b(stock|share|shares|price|chart|history|historical|rsi|support|resistance)\b/.test(
      text
    ) || /शेयर|स्टॉक|भाव|कीमत|सपोर्ट|रेजिस्टेंस/.test(text);

  return asksStock ? detectStockSymbol(message) : null;
}

function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes)) return null;

  const values = closes.map(Number);

  if (values.length <= period || !values.every(Number.isFinite)) {
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
      }// Alpha Vantage - Historical Stock Data

async function getDailyStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Historical stock data is not configured on the server."
    );
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
    throw new Error(
      "Stock symbol was not accepted by the data provider."
    );
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

  const closes = validRows
    .map((row) => row.close)
    .reverse();

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
    `14-day low reference: ₹${money(report.support)}`,
    `14-day high reference: ₹${money(report.resistance)}`,
    `Volume: ${money(report.volume)}`,
    "",
    "यह historical data है, जरूरी नहीं कि live हो। यह केवल शैक्षिक जानकारी है, खरीदने या बेचने की सलाह नहीं।",
  ].join("\n");
}

// Nifty / Bank Nifty

function detectIndexRequest(message) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("bank nifty") ||
    text.includes("banknifty")
  ) {
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
  const previous =
    rows.length > 1
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
  const percent = (value) =>
    Number.isFinite(Number(value))
      ? `${Number(value).toFixed(2)}%`
      : "Unavailable";

  return [
    `Index: ${report.symbol}`,
    `Date: ${report.date}`,
    `Close: ${safeNumber(report.close)}`,
    `Previous close: ${safeNumber(report.previousClose)}`,
    `Daily change: ${percent(report.dailyChangePercent)}`,
    "",
    "Market data may be delayed. This is informational data, not a prediction or trading recommendation.",
  ].join("\n");
}

// Company News - Google News RSS

function decodeXML(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function getXMLTag(block, tag) {
  const escapedTag = tag.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const regex = new RegExp(
    `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`,
    "i"
  );

  const match = String(block).match(regex);

  return match
    ? decodeXML(match[1].trim())
    : "";
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
    if (text.includes(name)) return name;
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
    ...news.map(
      (item, index) =>
        `${index + 1}. ${item.title}\n${item.published || "Date unavailable"}\n${item.link || ""}`
    ),
    "",
    "खबर की पूरी जानकारी के लिए मूल स्रोत खोलकर जाँचें।",
  ].join("\n");
}

// Safe Self-Upgrade Planning Only

function asksForSelfUpgrade(message) {
  const text = String(message || "").toLowerCase();

  return (
    /\b(self[- ]?upgrade|auto[- ]?upgrade|self[- ]?improve|upgrade yourself|improve yourself)\b/.test(text) ||
    /खुद को अपग्रेड|अपने आप अपग्रेड|खुद में सुधार|नया फीचर जोड़/.test(text)
  );
}

function buildUpgradePrompt(message) {
  return [
    "SELF-UPGRADE PLANNING REQUEST:",
    "Prepare a safe improvement proposal for this JARVIS AI project.",
    "Do not claim to have edited, saved, pushed, or deployed anything.",
    "Do not remove existing features.",
    "Include: proposed improvement, benefits, affected files, backup plan, test plan, risks, rollback plan, and approval needed.",
    "Do not ask for API keys, passwords, or OTPs.",
    "",
    "User request:",
    String(message || ""),
  ].join("\n");
}

// Main API Handler

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
      body.image || body.imageBase64 || body.imageData
    );

    if (!message && !hasImage) {
      return sendJSON(res, 400, {
        error: "Please enter a message or upload an image.",
      });
    }

    const history = sanitizeHistory(
      body.history || body.messages || []
    );

    // Crypto prices
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

    // Nifty / Bank Nifty
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

    // Company News
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

    // Historical Stocks
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

    // Image Upload
    const imageParts = getImageParts(body);

    // Self-Upgrade Planning
    const geminiPrompt = asksForSelfUpgrade(message)
      ? buildUpgradePrompt(message)
      : message || "Please describe the uploaded image.";

    // Gemini
    const reply = await askGemini(
      geminiPrompt,
      imageParts,
      history
    );

    return sendJSON(res, 200, {
      reply,
      memorySupported: false,
    });

  } catch (error) {
    console.error("JARVIS API error:", error);

    const errorMessage = String(
      error?.message || "Unknown server error"
    );

    const isBadRequest =
      /image format|image is empty|too large|invalid JSON|invalid image|unsupported image/i.test(
        errorMessage
      );

    return sendJSON(res, isBadRequest ? 400 : 500, {
      error: isBadRequest
        ? errorMessage
        : "JARVIS AI server error. Please check server logs.",
    });
  }
};
