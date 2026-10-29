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
For news, use only returned article details; never invent headlines or URLs.
If verified data is unavailable, say so clearly.
`;

/* ---------------- HTTP HELPERS ---------------- */

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

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new Error(`API status: ${response.statusCode}`)
            );
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Invalid API response"));
          }
        });
      }
    );

    request.setTimeout(
      10000,
      () => request.destroy(new Error("API timeout"))
    );

    request.on("error", reject);
  });
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 Sunday-AI/1.0",
          Accept: "application/rss+xml, application/xml, text/xml",
          ...headers,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new Error(`News RSS HTTP ${response.statusCode}`)
            );
          }

          resolve(body);
        });
      }
    );

    request.setTimeout(
      12000,
      () => request.destroy(new Error("News RSS timeout"))
    );

    request.on("error", reject);
  });
}

/* ---------------- FORMATTING HELPERS ---------------- */

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

  const headers = apiKey
    ? { "x-cg-demo-api-key": apiKey }
    : {};

  return fetchJSON(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=inr&include_24hr_change=true",
    headers
  );
}

function asksForLiveCryptoPrice(prompt) {
  return (
    /\b(bitcoin|btc|ethereum|ether|eth|crypto|cryptocurrency)\b/i.test(
      prompt
    ) &&
    /(price|rate|quote|current|latest|live|today|aaj|abhi|daam|kimat|कीमत|दाम|भाव)/i.test(
      prompt
    )
  );
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

/* ---------------- COMPANY NEWS ---------------- */

function detectNewsSymbol(prompt) {
  const explicit = prompt.match(
    /\b([A-Z0-9]{2,15}\.(?:BSE|NSE))\b/i
  );

  if (explicit) {
    return explicit[1].toUpperCase();
  }

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
    if (pattern.test(prompt)) return symbol;
  }

  return null;
}

function asksForCompanyNews(prompt) {
  return (
    /\b(news|headlines|updates|khabar|khabrein|khabre|taaza)\b/i.test(
      prompt
    ) ||
    /latest\s+news/i.test(prompt) ||
    /company\s+news/i.test(prompt) ||
    /company\s+updates/i.test(prompt) ||
    /ताज़ा खबर|ताजा खबर|कंपनी की खबर|कंपनी की न्यूज़/i.test(prompt)
  );
}

const COMPANY_NAMES = {
  "RELIANCE.BSE": "Reliance Industries",
  "TCS.BSE": "Tata Consultancy Services",
  "INFY.BSE": "Infosys",
  "HDFCBANK.BSE": "HDFC Bank",
  "ICICIBANK.BSE": "ICICI Bank",
  "TATAMOTORS.BSE": "Tata Motors",
  "ITC.BSE": "ITC India",
};

function decodeXML(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .trim();
}

function getXMLTag(item, tag) {
  const match = item.match(
    new RegExp(
      `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
      "i"
    )
  );

  return match ? decodeXML(match[1]) : "";
}

async function getGoogleNewsRSS(companyName) {
  const query = `${companyName} when:7d`;

  const rssUrl =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=en-IN&gl=IN&ceid=IN%3Aen";

  const xml = await fetchText(rssUrl);

  const items =
    xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];

  const articles = items
    .slice(0, 10)
    .map((item) => {
      const title = getXMLTag(item, "title");
      const url = getXMLTag(item, "link");
      const published = getXMLTag(item, "pubDate");
      const source = getXMLTag(item, "source");

      return {
        title,
        url,
        source: source || "Google News",
        published: published || "Date unavailable",
        sentiment: "Not provided",
      };
    })
    .filter((article) => {
      return (
        article.title &&
        /^https?:\/\//i.test(article.url)
      );
    });

  return articles;
}

async function getCompanyNews(symbol) {
  const companyName = COMPANY_NAMES[symbol] || symbol;
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  // First attempt: Alpha Vantage NEWS_SENTIMENT.
  if (apiKey) {
    try {
      const url =
        "https://www.alphavantage.co/query?function=NEWS_SENTIMENT" +
        `&tickers=${encodeURIComponent(symbol)}` +
        `&limit=10&apikey=${encodeURIComponent(apiKey)}`;

      const data = await fetchJSON(url);

      if (Array.isArray(data.feed)) {
        const articles = data.feed
          .filter((item) => item.title && item.url)
          .slice(0, 10)
          .map((item) => ({
            title: item.title,
            source: item.source || "Unknown source",
            url: item.url,
            published:
              item.time_published || "Date unavailable",
            sentiment:
              item.overall_sentiment_label || "Not available",
          }));

        if (articles.length > 0) {
          return {
            articles,
            source: "Alpha Vantage",
            companyName,
          };
        }
      }

      if (
        data.Note ||
        data.Information ||
        data["Error Message"]
      ) {
        console.error(
          "Alpha Vantage news response:",
          String(
            data.Note ||
              data.Information ||
              data["Error Message"]
          ).slice(0, 500)
        );
      }
    } catch (error) {
      console.error(
        "Alpha Vantage news request failed:",
        error.message
      );
    }
  } else {
    console.error(
      "ALPHA_VANTAGE_API_KEY is not configured; trying Google News RSS."
    );
  }

  // Fallback: Google News RSS.
  // No Alpha Vantage news endpoint is needed for this attempt.
  try {
    const articles = await getGoogleNewsRSS(companyName);

    return {
      articles,
      source: "Google News RSS",
      companyName,
    };
  } catch (error) {
    console.error("Google News RSS error:", error.message);

    throw new Error("ALL_NEWS_SOURCES_FAILED");
  }
}

function buildNewsReply(symbol, result) {
  const articles = result.articles || [];
  const companyName =
    result.companyName || COMPANY_NAMES[symbol] || symbol;

  if (!articles.length) {
    return (
      `Boss, ${companyName} ke liye abhi koi news result nahi mila.\n` +
      `Source checked: ${result.source}\n` +
      `Checked: ${formatTime()}`
    );
  }

  const lines = [
    `Boss, ${companyName} ki available news:`,
    `Source: ${result.source}`,
    "",
  ];

  for (const article of articles) {
    lines.push(
      `Headline: ${article.title}`,
      `Source: ${article.source}`,
      `Published: ${article.published}`
    );

    if (article.sentiment !== "Not provided") {
      lines.push(`Sentiment: ${article.sentiment}`);
    }

    if (article.url) {
      lines.push(`Article: ${article.url}`);
    }

    lines.push("");
  }

  lines.push(
    `Fetched: ${formatTime()}`,
    "Note: News sentiment apne aap mein buy/sell signal nahi hai. Headlines aur publication details original source par verify karna."
  );

  return lines.join("\n");
}

/* ---------------- STOCK DATA + TECHNICAL ANALYSIS ---------------- */

function detectStockRequest(prompt) {
  const mentionsStock =
    /\b(stock|share|shares|market data|historical|trend|support|resistance|rsi|reliance|tcs|infosys|hdfcbank|icicibank|tatamotors|itc)\b/i.test(
      prompt
    ) ||
    /\b[A-Z0-9]{2,15}\.(?:BSE|NSE)\b/i.test(prompt);

  const asksForData =
    /(price|quote|data|market|chart|current|latest|live|today|aaj|abhi|bhav|भाव|कीमत|दाम|historical|history|trading days|trend|support|resistance|rsi|technical analysis|analysis|pichhle|पिछले)/i.test(
      prompt
    );

  if (!mentionsStock || !asksForData) return null;

  const explicit = prompt.match(
    /\b([A-Z0-9]{2,15}\.(?:BSE|NSE))\b/i
  );

  if (explicit) return explicit[1].toUpperCase();

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
    if (pattern.test(prompt)) return symbol;
  }

  return null;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  const changes = [];

  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let gain = 0;
  let loss = 0;

  for (let i = 0; i < period; i++) {
    gain += Math.max(changes[i], 0);
    loss += Math.max(-changes[i], 0);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period; i < changes.length; i++) {
    avgGain =
      (avgGain * (period - 1) +
        Math.max(changes[i], 0)) /
      period;

    avgLoss =
      (avgLoss * (period - 1) +
        Math.max(-changes[i], 0)) /
      period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;

  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

async function getDailyStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("STOCK_API_KEY_MISSING");
  }

  const url =
    "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY" +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;

  const data = await fetchJSON(url);

  if (data.Note || data.Information) {
    throw new Error("STOCK_API_LIMIT");
  }

  if (
    data["Error Message"] ||
    !data["Time Series (Daily)"]
  ) {
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
  const closes = [...history].reverse().map((row) => row.close);
  const rsi14 = calculateRSI(closes, 14);

  const changePercent = closes[0]
    ? Number(
        (
          ((closes[closes.length - 1] - closes[0]) /
            closes[0]) *
          100
        ).toFixed(2)
      )
    : 0;

  const trend =
    changePercent > 1
      ? "Uptrend"
      : changePercent < -1
      ? "Downtrend"
      : "Sideways";

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
      support: Number(
        Math.min(...history.map((row) => row.low)).toFixed(2)
      ),
      resistance: Number(
        Math.max(...history.map((row) => row.high)).toFixed(2)
      ),
      rsi14,
    },
    source: "Alpha Vantage",
  };
}

function buildStockReply(data) {
  const analysis = data.analysis;

  const lines = [
    `Boss, ${data.symbol} ka daily historical market data:`,
    `Latest available trading date: ${data.date}`,
    `Open: ₹${formatINR(data.open)}`,
    `High: ₹${formatINR(data.high)}`,
    `Low: ₹${formatINR(data.low)}`,
    `Close: ₹${formatINR(data.close)}`,
    `Volume: ${Number(data.volume).toLocaleString("en-IN")}`,
    "",
    `Technical analysis (${analysis.tradingDays} trading days):`,
    `Trend: ${analysis.trend}`,
    `Price change across available history: ${
      analysis.changePercent >= 0 ? "+" : ""
    }${analysis.changePercent}%`,
    `Approximate support (lowest low): ₹${formatINR(
      analysis.support
    )}`,
    `Approximate resistance (highest high): ₹${formatINR(
      analysis.resistance
    )}`,
    `RSI-14 (Wilder): ${
      analysis.rsi14 === null ? "Not enough data" : analysis.rsi14
    }`,
    "",
    "Recent daily closing prices (newest first):",
  ];

  for (const row of data.history.slice(0, 10)) {
    lines.push(`${row.date}: ₹${formatINR(row.close)}`);
  }

  lines.push(
    "",
    `Source: ${data.source}`,
    `Fetched: ${formatTime()}`,
    "Note: Ye daily historical data hai, live intraday price nahi.",
    "Support/resistance historical estimates hain; guaranteed levels ya buy/sell signals nahi."
  );

  return lines.join("\n");
}

/* ---------------- NIFTY 50 / BANK NIFTY ---------------- */

function detectIndexRequest(prompt) {
  const lower = prompt.toLowerCase();

  const asksForData =
    /(price|data|market|quote|chart|historical|daily|current|latest|live|today|aaj|abhi|bhav|भाव|कीमत|दाम|close|closing)/i.test(
      lower
    );

  if (!asksForData) return null;

  if (/\b(bank\s*nifty|banknifty|nifty\s*bank)\b/i.test(lower)) {
    return { name: "BANK NIFTY", symbol: "^NSEBANK" };
  }

  if (/\b(nifty\s*50|nifty50|nifty)\b/i.test(lower)) {
    return { name: "NIFTY 50", symbol: "^NSEI" };
  }

  return null;
}

async function getIndexData(index) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      index.symbol
    )}?range=5d&interval=1d`;

  const data = await fetchJSON(url, {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });

  if (data.chart?.error) {
    throw new Error("INDEX_DATA_UNAVAILABLE");
  }

  const result = data.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];

  if (!result?.timestamp || !quote?.close) {
    throw new Error("INDEX_DATA_UNAVAILABLE");
  }

  const rows = result.timestamp
    .map((timestamp, indexPosition) => ({
      date: dateInIndia(timestamp),
      open: quote.open?.[indexPosition],
      high: quote.high?.[indexPosition],
      low: quote.low?.[indexPosition],
      close: quote.close?.[indexPosition],
    }))
    .filter((row) => Number.isFinite(row.close));

  if (!rows.length) {
    throw new Error("INDEX_DATA_UNAVAILABLE");
  }

  return {
    name: index.name,
    latest: rows[rows.length - 1],
    history: rows.slice(-5).reverse(),
    source: "Yahoo Finance chart endpoint (unofficial)",
  };
}

function buildIndexReply(data) {
  const row = data.latest;

  const lines = [
    `Boss, ${data.name} ka daily historical data:`,
    `Date: ${row.date}`,
    `Open: ${formatINR(row.open)}`,
    `High: ${formatINR(row.high)}`,
    `Low: ${formatINR(row.low)}`,
    `Close: ${formatINR(row.close)}`,
    "",
    "Recent daily closing values:",
  ];

  for (const historyRow of data.history) {
    lines.push(
      `${historyRow.date}: ${formatINR(historyRow.close)}`
    );
  }

  lines.push(
    "",
    `Source: ${data.source}`,
    `Fetched: ${formatTime()}`,
    "Ye daily historical data hai, guaranteed live intraday data nahi.",
    "Yahoo Finance endpoint unofficial hai; data unavailable ya delayed ho sakta hai."
  );

  return lines.join("\n");
}

/* ---------------- GEMINI ASSISTANT ---------------- */

function getImageParts(body) {
  const imageValue =
    body.image || body.imageBase64 || body.imageData;

  if (!imageValue || typeof imageValue !== "string") {
    return [];
  }

  let mimeType = body.mimeType || "image/jpeg";
  let base64 = imageValue;

  const match = imageValue.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
  );

  if (match) {
    mimeType = match[1];
    base64 = match[2];
  }

  if (!/^image\/[a-zA-Z0-9.+-]+$/.test(mimeType)) {
    return [];
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

async function askGemini(prompt, imageParts = []) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_INSTRUCTION,
  });

  const parts = [
    { text: prompt || "Boss, is image ko analyze karo." },
    ...imageParts,
  ];

  const result = await model.generateContent(parts);

  return result.response.text();
}

/* ---------------- API HANDLER ---------------- */

module.exports = async function handler(req, res)
