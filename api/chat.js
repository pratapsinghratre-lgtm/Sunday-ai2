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
    https
      .get(
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
            } catch (error) {
              reject(new Error("Invalid API response"));
            }
          });
        }
      )
      .on("error", reject);
  });
}

function formatINR(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "N/A";
  }

  return Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTime(date = new Date()) {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " IST";
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

  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ethereum" +
    "&vs_currencies=inr" +
    "&include_24hr_change=true";

  return fetchJSON(url, headers);
}

function asksForLiveCryptoPrice(prompt) {
  const lower = prompt.toLowerCase();

  const mentionsCrypto =
    /\b(bitcoin|btc|ethereum|ether|eth|crypto|cryptocurrency)\b/i.test(lower);

  const asksForPrice =
    /(price|rate|quote|current|latest|live|today|aaj|abhi|daam|kimat|कीमत|दाम|भाव)/i.test(
      lower
    );

  return mentionsCrypto && asksForPrice;
}

function buildCryptoReply(data) {
  const lines = ["Boss, crypto price information:"];

  const coins = [
    ["Bitcoin", "bitcoin"],
    ["Ethereum", "ethereum"],
  ];

  for (const [name, key] of coins) {
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

  lines.push(`Fetched: ${formatTime()}`);
  lines.push("Source: CoinGecko");
  lines.push("Note: Prices may be delayed and can change.");

  return lines.join("\n");
}

/* ---------------- STOCK DATA ---------------- */

function detectStockRequest(prompt) {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  const mentionsStock =
    /\b(stock|share|shares|stock price|share price|market data|reliance|tcs|infosys|hdfcbank|icicibank|tatamotors|itc)\b/i.test(text) ||
    /\b[A-Z]{2,15}\.(?:BSE|NSE)\b/i.test(text);

  const asksForData =
    /(price|quote|data|market|chart|share|stock|current|latest|live|today|aaj|abhi|bhav|भाव|कीमत|दाम)/i.test(
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

async function getDailyStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("STOCK_API_KEY_MISSING");
  }

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

  if (!dates.length) {
    throw new Error("STOCK_DATA_UNAVAILABLE");
  }

  const latestDate = dates[0];
  const latest = series[latestDate];

  return {
    symbol,
    date: latestDate,
    open: Number(latest["1. open"]),
    high: Number(latest["2. high"]),
    low: Number(latest["3. low"]),
    close: Number(latest["4. close"]),
    volume: Number(latest["5. volume"]),
    previousCloses: dates.slice(1, 4).map((date) => ({
      date,
      close: Number(series[date]["4. close"]),
    })),
    source: "Alpha Vantage",
  };
}

function buildStockReply(data) {
  const lines = [
    `Boss, ${data.symbol} ka daily historical market data:`,
    `Date: ${data.date}`,
    `Open: ₹${formatINR(data.open)}`,
    `High: ₹${formatINR(data.high)}`,
    `Low: ₹${formatINR(data.low)}`,
    `Close: ₹${formatINR(data.close)}`,
    `Volume: ${Number(data.volume).toLocaleString("en-IN")}`,
    `Source: ${data.source}`,
    `Fetched: ${formatTime()}`,
    "Note: Ye daily historical data hai, live intraday price nahi.",
  ];

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

  // Check Bank Nifty first so it is not mistaken for Nifty 50.
  if (/\b(bank\s*nifty|banknifty|nifty\s*bank)\b/i.test(lower)) {
    return {
      name: "BANK NIFTY",
      symbol: "^NSEBANK",
    };
  }

  if (/\b(nifty\s*50|nifty50|nifty)\b/i.test(lower)) {
    return {
      name: "NIFTY 50",
      symbol: "^NSEI",
    };
  }

  return null;
}

async function getIndexData(index) {
  const encodedSymbol = encodeURIComponent(index.symbol);

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}` +
    "?range=5d&interval=1d";

  const data = await fetchJSON(url, {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });

  if (data.chart && data.chart.error) {
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
    symbol: index.symbol,
    latest: rows[rows.length - 1],
    history: rows.slice(-5).reverse(),
    source: "Yahoo Finance chart endpoint (unofficial)",
  };
}

function buildIndexReply(data) {
  const latest = data.latest;

  const lines = [
    `Boss, ${data.name} ka daily historical data:`,
    `Date: ${latest.date}`,
    `Open: ${formatINR(latest.open)}`,
    `High: ${formatINR(latest.high)}`,
    `Low: ${formatINR(latest.low)}`,
    `Close: ${formatINR(latest.close)}`,
    "",
    "Recent daily closing values:",
  ];

  for (const row of data.history) {
    lines.push(`${row.date}: ${formatINR(row.close)}`);
  }

  lines.push("");
  lines.push(`Source: ${data.source}`);
  lines.push(`Fetched: ${formatTime()}`);
  lines.push(
    "Important: Ye daily historical data hai, guaranteed live intraday data nahi."
  );
  lines.push(
    "Yahoo Finance ka chart endpoint unofficial hai; kabhi data unavailable ya delayed ho sakta hai."
  );

  return lines.join("\n");
}

/* ---------------- GEMINI ASSISTANT ---------------- */

function getImageParts(body) {
  const imageValue = body.image || body.imageBase64 || body.imageData;

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      reply: "Method not allowed.",
    });
  }

  try {
    const body = req.body || {};
    const cleanPrompt = String(
      body.message || body.prompt || ""
    ).trim();

    const imageParts = getImageParts(body);

    if (!cleanPrompt && imageParts.length === 0) {
      return res.status(400).json({
        reply: "Boss, apna message ya image bhejo.",
      });
    }

    // 1. NIFTY 50 / BANK NIFTY daily historical data
    const index = detectIndexRequest(cleanPrompt);

    if (index) {
      try {
        const data = await getIndexData(index);

        return res.status(200).json({
          reply: buildIndexReply(data),
        });
      } catch (error) {
        console.error("Index data error:", error.message);

        return res.status(503).json({
          reply:
            `Boss, abhi ${index.name} ka verified daily data fetch nahi ho pa raha. ` +
            "Data provider temporarily unavailable ho sakta hai. Thodi der baad try karo. " +
            "Main bina verify kiye market numbers nahi bataunga.",
        });
      }
    }

    // 2. Cryptocurrency prices
    if (asksForLiveCryptoPrice(cleanPrompt)) {
      try {
        const data = await getCryptoPrices();

        return res.status(200).json({
          reply: buildCryptoReply(data),
        });
      } catch (error) {
        console.error("Crypto data error:", error.message);

        return res.status(503).json({
          reply:
            "Boss, abhi crypto prices fetch nahi ho pa rahe. " +
            "Thodi der baad dobara try karo.",
        });
      }
    }

    // 3. Stock daily historical data
    const stockSymbol = detectStockRequest(cleanPrompt);

    if (stockSymbol) {
      try {
        const data = await getDailyStockData(stockSymbol);

        return res.status(200).json({
          reply: buildStockReply(data),
        });
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
        }

        return res.status(503).json({
          reply: message,
        });
      }
    }

    // 4. General questions and image/chart analysis
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
