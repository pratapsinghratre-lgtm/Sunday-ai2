const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL_NAME = "gemini-3.5-flash-lite";

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a helpful, intelligent and friendly AI assistant.

LANGUAGE AND STYLE:
- Speak in simple Hindi or Hinglish.
- Address the user as Boss.
- Give direct, useful answers.
- Explain difficult topics step by step.
- Do not introduce unrelated topics at the end of an answer.

GENERAL KNOWLEDGE:
- Help with CSC services, documents, applications and government schemes.
- Never invent rules, fees, deadlines or links.

MARKET DATA:
- Use actual market data provided in the conversation.
- Distinguish daily historical data from live intraday prices.
- Never call daily closing prices live prices.
- Never invent prices, dates, news or market movements.
- If data is unavailable, explain the limitation clearly.
- Alpha Vantage data availability depends on its supported symbols and plan.
- Do not claim that NIFTY or BANKNIFTY data is available unless verified.

CHART IMAGE ANALYSIS:
When a user uploads a stock or crypto chart image, analyze it carefully.

Use this structure when possible:
1. Asset / Market, if identifiable.
2. Timeframe, if visible.
3. Current visible price, only if readable.
4. Trend: bullish, bearish, sideways or unclear.
5. Chart observations.
6. Possible bullish and bearish scenarios.
7. Possible direction: BUY BIAS, SELL BIAS or WAIT.
8. Possible entry zone, only with sufficient evidence.
9. Possible stop-loss, only with sufficient evidence.
10. Possible targets, only with sufficient evidence.
11. Risk level and reason.
12. What could invalidate the analysis.

CHART SAFETY:
- Educational analysis, not a guaranteed trading signal.
- Never guarantee profits or future prices.
- Never invent chart levels.
- If evidence is mixed, prefer WAIT / UNCLEAR.
- Explain that stop-losses do not guarantee a maximum loss.
- Do not claim that a chart image establishes a reliable probability of success.

TRADING EDUCATION:
- Explain concepts and uncertainty.
- Label hypothetical examples as educational.
- Do not promise profits.

ANSWER QUALITY:
- Be helpful, clear and concise.
`;

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = require("https").get(
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

async function getCryptoPrices() {
  const apiKey = process.env.COINGECKO_API_KEY;

  if (!apiKey) {
    throw new Error("COINGECKO_API_KEY_MISSING");
  }

  const url = new URL(
    "https://api.coingecko.com/api/v3/simple/price"
  );

  url.searchParams.set("ids", "bitcoin,ethereum");
  url.searchParams.set("vs_currencies", "inr");
  url.searchParams.set("include_24hr_change", "true");

  return fetchJSON(url.toString(), {
    "x-cg-demo-api-key": apiKey
  });
}

function asksForLiveCryptoPrice(prompt) {
  const text = prompt.toLowerCase();

  const mentionsCrypto =
    /\b(bitcoin|btc|ethereum|ether|eth)\b/.test(text);

  const asksForPrice =
    /(price|current|live|rate|kitna|keemat|daam|abhi|aaj|rupee|inr|कीमत|दाम|भाव|अभी)/i.test(text);

  return mentionsCrypto && asksForPrice;
}

function formatINR(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return "₹" + value.toLocaleString("en-IN", {
    maximumFractionDigits: 2
  });
}

function formatTime(isoTime) {
  return new Date(isoTime).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium"
  }) + " IST";
}

function buildCryptoReply(data, prompt, fetchedAt) {
  const text = prompt.toLowerCase();

  const wantsBTC = /\b(bitcoin|btc)\b/.test(text);
  const wantsETH = /\b(ethereum|ether|eth)\b/.test(text);

  const assets = [];

  if (wantsBTC || (!wantsBTC && !wantsETH)) {
    assets.push(["Bitcoin (BTC)", data.bitcoin]);
  }

  if (wantsETH || (!wantsBTC && !wantsETH)) {
    assets.push(["Ethereum (ETH)", data.ethereum]);
  }

  const rows = assets.map(([name, coin]) => {
    if (!coin || typeof coin.inr !== "number") {
      return `| ${name} | Unavailable | Unavailable |`;
    }

    const change =
      typeof coin.inr_24h_change === "number"
        ? coin.inr_24h_change.toFixed(2) + "%"
        : "Unavailable";

    return `| ${name} | ${formatINR(coin.inr)} | ${change} |`;
  });

  return [
    "Namaste Boss! CoinGecko se mila crypto data:",
    "",
    "| Crypto | Price (INR) | 24-hour change |",
    "|---|---:|---:|",
    ...rows,
    "",
    "**Source:** CoinGecko",
    `**Fetched:** ${formatTime(fetchedAt)}`,
    "",
    "Ye fetch time par mila data hai. Prices badal sakti hain; future returns ki guarantee nahi hai."
  ].join("\n");
}

function detectStockRequest(prompt) {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  const mentionsStock =
    /\b(stock|share|shares|stock price|share price|market data|nifty|banknifty|sensex|reliance|tcs|infosys|hdfcbank|icicibank|tatamotors|itc)\b/i.test(text) ||
    /\b[A-Z]{2,15}(?:\.(?:BSE|NSE))\b/.test(text);

  const asksForData =
    /(price|quote|data|market|chart|share|stock|current|latest|live|today|aaj|abhi|bhav|भाव|कीमत|दाम|reliance\.bse|reliance\.nse)/i.test(text);

  if (!mentionsStock || !asksForData) {
    return null;
  }

  // Use an explicit Alpha Vantage symbol if the user supplied one.
  const explicitSymbol = text.match(
    /\b([A-Z0-9]{2,15}\.(?:BSE|NSE))\b/i
  );

  if (explicitSymbol) {
    return explicitSymbol[1].toUpperCase();
  }

  const symbols = [
    [/\breliance\b/i, "RELIANCE.BSE"],
    [/\btcs\b/i, "TCS.BSE"],
    [/\binfosys\b/i, "INFY.BSE"],
    [/\bhdfc\s*bank\b/i, "HDFCBANK.BSE"],
    [/\bicici\s*bank\b/i, "ICICIBANK.BSE"],
    [/\btata\s*motors\b/i, "TATAMOTORS.BSE"],
    [/\bitc\b/i, "ITC.BSE"]
  ];

  for (const [pattern, symbol] of symbols) {
    if (pattern.test(lower)) {
      return symbol;
    }
  }

  return null;
}

async function getDailyStockData(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY_MISSING");
  }

  const url = new URL("https://www.alphavantage.co/query");

  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("outputsize", "compact");
  url.searchParams.set("apikey", apiKey);

  const data = await fetchJSON(url.toString());

  if (data.Note || data.Information || data["Error Message"]) {
    throw new Error(
      data.Note ||
      data.Information ||
      data["Error Message"]
    );
  }

  const series = data["Time Series (Daily)"];

  if (!series) {
    throw new Error("STOCK_SYMBOL_UNAVAILABLE");
  }

  const dates = Object.keys(series).sort().reverse();

  if (!dates.length) {
    throw new Error("STOCK_HISTORY_EMPTY");
  }

  const latestDate = dates[0];
  const latest = series[latestDate];

  return {
    symbol,
    dataType: "daily historical data",
    latestDate,
    latest: {
      open: Number(latest["1. open"]),
      high: Number(latest["2. high"]),
      low: Number(latest["3. low"]),
      close: Number(latest["4. close"]),
      volume: Number(latest["5. volume"])
    },
    previousDays: dates.slice(1, 4).map((date) => ({
      date,
      close: Number(series[date]["4. close"])
    }))
  };
}

function buildStockReply(data, fetchedAt) {
  const p = data.latest;

  return [
    `Boss, Alpha Vantage se ${data.symbol} ka daily data mila hai.`,
    "",
    `**Data date:** ${data.latestDate}`,
    `**Open:** ${formatINR(p.open)}`,
    `**High:** ${formatINR(p.high)}`,
    `**Low:** ${formatINR(p.low)}`,
    `**Close:** ${formatINR(p.close)}`,
    `**Volume:** ${p.volume.toLocaleString("en-IN")}`,
    "",
    "**Source:** Alpha Vantage",
    `**Fetched:** ${formatTime(fetchedAt)}`,
    "",
    "**Important:** Ye daily historical data hai, live intraday quote nahi. Market band hone, provider delay, ya unsupported symbol ki wajah se date purani ho sakti hai.",
    "",
    "Ye data apne aap BUY ya SELL signal nahi hai. Trading mein risk hota hai."
  ].join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  const geminiKey = process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing in Vercel settings."
    });
  }

  try {
    const { prompt, image, mimeType } = req.body || {};
    const cleanPrompt =
      typeof prompt === "string" ? prompt.trim() : "";

    if (!cleanPrompt && !image) {
      return res.status(400).json({
        error: "Please enter a message or upload an image."
      });
    }

    if (cleanPrompt && !image && asksForLiveCryptoPrice(cleanPrompt)) {
      try {
        const data = await getCryptoPrices();

        return res.status(200).json({
          reply: buildCryptoReply(
            data,
            cleanPrompt,
            new Date().toISOString()
          )
        });
      } catch (error) {
        console.error("Crypto API error:", error.message);

        return res.status(503).json({
          reply:
            "Boss, abhi crypto data nahi mil paaya. " +
            "Main galat price guess nahi karunga. Thodi der baad try karein."
        });
      }
    }

    // Connect stock-price questions to Alpha Vantage daily history.
    if (cleanPrompt && !image) {
      const symbol = detectStockRequest(cleanPrompt);

      if (symbol) {
        try {
          const data = await getDailyStockData(symbol);

          return res.status(200).json({
            reply: buildStockReply(data, new Date().toISOString())
          });
        } catch (error) {
          console.error("Alpha Vantage error:", error.message);

          let message =
            "Boss, Alpha Vantage se is stock ka data nahi mil paaya.";

          if (error.message === "ALPHA_VANTAGE_API_KEY_MISSING") {
            message =
              "Boss, Vercel mein ALPHA_VANTAGE_API_KEY setting nahi mili. Environment Variables check karein.";
          } else if (error.message === "STOCK_SYMBOL_UNAVAILABLE") {
            message =
              `Boss, Alpha Vantage ne ${symbol} ka daily data nahi diya. ` +
              "Ho sakta hai symbol supported na ho ya tumhare plan mein available na ho. Main price invent nahi karunga.";
          } else if (
            error.message.includes("API status:") ||
            error.message === "API timeout"
          ) {
            message =
              "Boss, market-data server se abhi response nahi mila. Thodi der baad dobara try karein.";
          } else if (
            /rate limit|call frequency|25 requests|higher API call frequency/i.test(
              error.message
            )
          ) {
            message =
              "Boss, Alpha Vantage ki request limit ya usage restriction aa sakti hai. Free quota check karein.";
          }

          return res.status(503).json({ reply: message });
        }
      }
    }

    const parts = [];

    if (image) {
      if (
        typeof image !== "string" ||
        typeof mimeType !== "string" ||
        !["image/jpeg", "image/png", "image/webp"].includes(mimeType)
      ) {
        return res.status(400).json({
          error: "Please upload a JPEG, PNG or WebP image."
        });
      }

      const imageData = image.replace(/^data:[^,]+,/, "");

      if (!imageData) {
        return res.status(400).json({
          error: "The uploaded image is empty."
        });
      }

      parts.push({
        inlineData: {
          data: imageData,
          mimeType
        }
      });

      parts.push({
        text: cleanPrompt
          ? cleanPrompt +
            "\n\nAnalyze this image carefully. If it is a stock or crypto chart, provide educational chart analysis. Never invent unreadable prices or levels."
          : "Analyze this image. If it is a stock or crypto chart, explain the visible trend, levels and possible scenarios. Do not invent prices or claim live data from the image."
      });
    } else {
      parts.push({ text: cleanPrompt });
    }

    const genAI = new GoogleGenerativeAI(geminiKey);

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1500
      }
    });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts
        }
      ]
    });

    return res.status(200).json({
      reply: result.response.text()
    });
  } catch (error) {
    console.error("Sunday AI error:", error.message);

    return res.status(500).json({
      error:
        "Sunday AI abhi jawab nahi de paaya. Thodi der baad try karein."
    });
  }
};
