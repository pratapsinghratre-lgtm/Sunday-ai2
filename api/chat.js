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

    request.setTimeout(
      10000,
      () => request.destroy(new Error("API timeout"))
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
  const explicit = prompt.match(/\b([A-Z0-9]{2,15}\.(?:BSE|NSE))\b/i);

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

function asksForCompanyNews(prompt) {
  return /\b(news|headlines|latest updates|company updates|khabar|khabrein|taaza khabar)\b/i.test(
    prompt
  );
}

async function getCompanyNews(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) throw new Error("STOCK_API_KEY_MISSING");

  const url =
    "https://www.alphavantage.co/query?function=NEWS_SENTIMENT" +
    `&tickers=${encodeURIComponent(symbol)}` +
    `&limit=10&apikey=${encodeURIComponent(apiKey)}`;

  const data = await fetchJSON(url);

  if (data.Note || data.Information) {
    throw new Error("STOCK_API_LIMIT");
  }

  if (data["Error Message"] || !Array.isArray(data.feed)) {
    throw new Error("NEWS_UNAVAILABLE");
  }

  return data.feed.slice(0, 10).map((item) => ({
    title: item.title || "Untitled",
    source: item.source || "Unknown source",
    url: item.url || "",
    published: item.time_published || "Date unavailable",
    sentiment: item.overall_sentiment_label || "Not available",
  }));
}

function buildNewsReply(symbol, articles) {
  if (!articles.length) {
    return `Boss, ${symbol} ke liye abhi koi news result nahi mila.`;
  }

  const lines = [`Boss, ${symbol} ki available news:`, ""];

  for (const article of articles) {
    lines.push(
      `Headline: ${article.title}`,
      `Source: ${article.source}`,
      `Published: ${article.published}`,
      `Sentiment: ${article.sentiment}`
    );

    if (article.url) {
      lines.push(`Article: ${article.url}`);
    }

    lines.push("");
  }

  lines.push(
    "Source: Alpha Vantage NEWS_SENTIMENT",
    `Fetched: ${formatTime()}`,
    "Note: News sentiment apne aap mein buy/sell signal nahi hai. Indian BSE ticker coverage guaranteed nahi hai."
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

  const explicit = prompt.match(/\b([A-Z0-9]{2,15}\.(?:BSE|NSE))\b/i);

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
    "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY" +
    `&symbol=${encodeURIComponent(symbol)}` +
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
  const closes = [...history].reverse().map((row) => row.close);
  const rsi14 = calculateRSI(closes, 14);

  const changePercent = closes[0]
    ? Number(
        (
          ((closes[closes.length - 1] - closes[0]) / closes[0]) *
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
        Math.min(...history.map((r) => r.low)).toFixed(2)
      ),
      resistance: Number(
        Math.max(...history.map((r) => r.high)).toFixed(2)
      ),
      rsi14,
    },
    source: "Alpha Vantage",
  };
}

function buildStockReply(data) {
  const a = data.analysis;

  const lines = [
    `Boss, ${data.symbol} ka daily historical market data:`,
    `Latest available trading date: ${data.date}`,
    `Open: ₹${formatINR(data.open)}`,
    `High: ₹${formatINR(data.high)}`,
    `Low: ₹${formatINR(data.low)}`,
    `Close: ₹${formatINR(data.close)}`,
    `Volume: ${Number(data.volume).toLocaleString("en-IN")}`,
    "",
    `Technical analysis (${a.tradingDays} trading days):`,
    `Trend: ${a.trend}`,
    `Price change across available history: ${
      a.changePercent >= 0 ? "+" : ""
    }${a.changePercent}%`,
    `Approximate support (lowest low): ₹${formatINR(a.support)}`,
    `Approximate resistance (highest high): ₹${formatINR(
      a.resistance
    )}`,
    `RSI-14 (Wilder): ${
      a.rsi14 === null ? "Not enough data" : a.rsi14
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
    "Support/resistance simple historical estimates hain; guaranteed levels ya buy/sell signals nahi."
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
    .map((timestamp, i) => ({
      date: dateInIndia(timestamp),
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
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
  const r = data.latest;

  const lines = [
    `Boss, ${data.name} ka daily historical data:`,
    `Date: ${r.date}`,
    `Open: ${formatINR(r.open)}`,
    `High: ${formatINR(r.high)}`,
    `Low: ${formatINR(r.low)}`,
    `Close: ${formatINR(r.close)}`,
    "",
    "Recent daily closing values:",
  ];

  for (const row of data.history) {
    lines.push(`${row.date}: ${formatINR(row.close)}`);
  }

  lines.push(
    "",
    `Source: ${data.source}`,
    `Fetched: ${formatTime()}`,
    "Ye daily historical data hai, guaranteed live intraday data nahi.",
    "Yahoo Finance chart endpoint unofficial hai; data unavailable ya delayed ho sakta hai."
  );

  return lines.join("\n");
}

/* ---------------- GEMINI ASSISTANT ---------------- */

function getImageParts(body) {
  const imageValue = body.image || body.imageBase64 || body.imageData;

  if (!imageValue || typeof imageValue !== "string") return [];

  let mimeType = body.mimeType || "image/jpeg";
  let base64 = imageValue;

  const match = imageValue.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
  );

  if (match) {
    mimeType = match[1];
    base64 = match[2];
  }

  if (!/^image\/[a-zA-Z0-9.+-]+$/.test(mimeType)) return [];

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

  if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING");

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed." });
  }

  try {
    const body = req.body || {};
    const cleanPrompt = String(body.message || body.prompt || "").trim();
    const imageParts = getImageParts(body);

    if (!cleanPrompt && imageParts.length === 0) {
      return res
        .status(400)
        .json({ reply: "Boss, apna message ya image bhejo." });
    }

    // Company news is checked before normal stock data.
    if (
      asksForCompanyNews(cleanPrompt) &&
      imageParts.length === 0
    ) {
      const symbol = detectNewsSymbol(cleanPrompt);

      if (!symbol) {
        return res.status(400).json({
          reply:
            "Boss, news ke liye Reliance, TCS, Infosys, HDFC Bank, ICICI Bank, Tata Motors, ITC ya supported ticker symbol ka naam likho.",
        });
      }

      try {
        const articles = await getCompanyNews(symbol);

        return res
          .status(200)
          .json({ reply: buildNewsReply(symbol, articles) });
      } catch (error) {
        console.error("Company news error:", error.message);

        let reply =
          "Boss, is company ki news abhi fetch nahi ho pa rahi. Alpha Vantage ticker coverage ya API access unavailable ho sakta hai.";

        if (error.message === "STOCK_API_KEY_MISSING") {
          reply =
            "Boss, ALPHA_VANTAGE_API_KEY environment variable set nahi hai.";
        } else if (error.message === "STOCK_API_LIMIT") {
          reply =
            "Boss, Alpha Vantage ki API limit ya access restriction aa rahi hai. Baad mein try karo.";
        }

        return res.status(503).json({ reply });
      }
    }

    const index = detectIndexRequest(cleanPrompt);

    if (index && imageParts.length === 0) {
      try {
        const data = await getIndexData(index);

        return res
          .status(200)
          .json({ reply: buildIndexReply(data) });
      } catch (error) {
        console.error("Index data error:", error.message);

        return res.status(503).json({
          reply: `Boss, abhi ${index.name} ka verified daily data fetch nahi ho pa raha. Provider unavailable ho sakta hai. Main bina verify kiye numbers nahi bataunga.`,
        });
      }
    }

    if (asksForLiveCryptoPrice(cleanPrompt)) {
      try {
        const data = await getCryptoPrices();

        return res
          .status(200)
          .json({ reply: buildCryptoReply(data) });
      } catch (error) {
        console.error("Crypto data error:", error.message);

        return res.status(503).json({
          reply:
            "Boss, abhi crypto prices fetch nahi ho pa rahe. Thodi der baad dobara try karo.",
        });
      }
    }

    const stockSymbol = detectStockRequest(cleanPrompt);

    if (stockSymbol && imageParts.length === 0) {
      try {
        const data = await getDailyStockData(stockSymbol);

        return res
          .status(200)
          .json({ reply: buildStockReply(data) });
      } catch (error) {
        console.error("Stock data error:", error.message);

        let message =
          "Boss, abhi is stock ka daily data available nahi ho pa raha.";

        if (error.message === "STOCK_API_KEY_MISSING") {
          message =
            "Boss, ALPHA_VANTAGE_API_KEY environment variable set nahi hai.";
        } else if (error.message === "STOCK_API_LIMIT") {
          message =
            "Boss, Alpha Vantage ki API limit ya access restriction aa rahi hai. Baad mein try karo.";
        } else if (
          error.message === "INSUFFICIENT_STOCK_HISTORY"
        ) {
          message =
            "Boss, RSI-14 calculate karne ke liye paryapt historical data nahi mila.";
        }

        return res.status(503).json({ reply: message });
      }
    }

    const reply = await askGemini(cleanPrompt, imageParts);

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Sunday AI error:", error.message);

    if (error.message === "GEMINI_API_KEY_MISSING") {
      return res.status(500).json({
        reply:
          "Boss, GEMINI_API_KEY environment variable set nahi hai.",
      });
    }

    return res.status(500).json({
      reply:
        "Boss, abhi ek technical error aa gaya hai. Thodi der baad dobara try karo.",
    });
  }
};
