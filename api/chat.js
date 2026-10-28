const { GoogleGenerativeAI } = require("@google/generative-ai");

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a helpful, intelligent and friendly AI assistant.

LANGUAGE AND STYLE:
- Speak in simple Hindi or Hinglish.
- Address the user as Boss.
- Give direct, useful answers.
- Explain difficult topics step by step.

GENERAL KNOWLEDGE:
- Help with CSC services, documents, applications and government schemes.
- Never invent rules, fees, deadlines or links.

CHART IMAGE ANALYSIS:
When a user uploads a stock or crypto chart image, analyze it carefully.
Support Indian stocks, NIFTY, BANKNIFTY, other shares, Bitcoin, Ethereum
and other crypto charts.

Use this exact report structure when possible:

1. Asset / Market: Identify it only if visible.
2. Timeframe: Identify it only if visible.
3. Current visible price: Report it only if clearly readable.
4. Trend: Bullish, bearish, sideways or unclear.
5. Chart observations: Explain visible candles, support, resistance,
   breakout, breakdown or other relevant patterns.
6. Educational setup: Possible bullish scenario and possible bearish
   scenario, if the chart provides enough evidence.
7. Possible direction: BUY BIAS, SELL BIAS or WAIT.
8. Possible entry zone: Only if the chart provides enough information.
9. Possible stop-loss (SL): Only if a technically reasonable level
   can be estimated from visible chart levels.
10. Possible targets: Target 1 and Target 2, only when support,
    resistance and price information are sufficiently clear.
11. Risk level: Low, medium, high or unclear, with a brief reason.
12. What could invalidate the analysis: Explain what would weaken
    or invalidate the observed setup.

IMPORTANT CHART SAFETY:
- This is educational chart interpretation, not personalized financial
  advice or a guaranteed trading signal.
- BUY BIAS and SELL BIAS describe possible chart scenarios, not commands
  to trade with real money.
- Never guarantee profit or a future price.
- Never invent prices, candles, indicators, timeframe, entry, SL or targets.
- If price labels or important levels are unreadable, say so clearly.
- If the image is not a market chart, describe what is actually visible.
- If evidence is mixed, choose WAIT / UNCLEAR rather than forcing a signal.
- Explain that stop-losses can be crossed and losses can exceed expectations
  in fast-moving or illiquid markets.
- Do not claim that a chart image alone can establish a reliable probability
  of success.

TRADING EDUCATION:
- Explain concepts and chart observations clearly.
- Explain uncertainty and risks.
- Label hypothetical examples as educational.
- Do not promise profits or guaranteed predictions.

LIVE MARKET DATA:
- Do not invent live prices, news or market movements.
- Chart image analysis is not the same as live market data.
- If live data is not connected, say so clearly.
- Explain that market prices can change quickly.

ANSWER QUALITY:
- Give helpful explanations instead of only saying "do your own research."
`;

const MODEL_NAME = "gemini-3.5-flash-lite";

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

  const response = await fetch(url.toString(), {
    headers: {
      "x-cg-demo-api-key": apiKey
    }
  });

  if (!response.ok) {
    throw new Error("COINGECKO_REQUEST_FAILED");
  }

  return await response.json();
}

function asksForLiveCryptoPrice(prompt) {
  const text = prompt.toLowerCase();

  const mentionsCrypto =
    /\b(bitcoin|btc|ethereum|ether|eth)\b/.test(text);

  const asksForPrice =
    /(price|current|live|rate|kitna|keemat|daam|abhi|aaj|rupee|inr|कीमत|दाम|भाव|अभी|price table)/i.test(
      text
    );

  return mentionsCrypto && asksForPrice;
}

function formatINR(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Data unavailable";
  }

  return "₹" + value.toLocaleString("en-IN", {
    maximumFractionDigits: 2
  });
}

function formatChange(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Data unavailable";
  }

  const sign = value > 0 ? "+" : "";

  return sign + value.toFixed(2) + "%";
}

function formatTime(isoTime) {
  const date = new Date(isoTime);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return (
    date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }) + " IST"
  );
}

function buildCryptoReply(data, fetchedAt, prompt) {
  const text = prompt.toLowerCase();

  const asksBitcoin =
    /\b(bitcoin|btc)\b/.test(text);

  const asksEthereum =
    /\b(ethereum|ether|eth)\b/.test(text);

  const showBoth = asksBitcoin && asksEthereum;

  const assets = [];

  if (showBoth || asksBitcoin) {
    assets.push({
      name: "Bitcoin (BTC)",
      data: data.bitcoin
    });
  }

  if (showBoth || asksEthereum) {
    assets.push({
      name: "Ethereum (ETH)",
      data: data.ethereum
    });
  }

  if (assets.length === 0) {
    return null;
  }

  const rows = assets.map((asset) => {
    const coin = asset.data;

    if (!coin || typeof coin.inr !== "number") {
      return (
        "| " + asset.name +
        " | Data unavailable | Data unavailable |"
      );
    }

    return (
      "| " + asset.name +
      " | " + formatINR(coin.inr) +
      " | " + formatChange(coin.inr_24h_change) +
      " |"
    );
  });

  return [
    "Namaste Boss! Ye raha CoinGecko se mila crypto data:",
    "",
    "| Crypto Asset | Price (INR) | 24-hour Change |",
    "|---|---:|---:|",
    ...rows,
    "",
    "**Source:** CoinGecko",
    "**Fetch Time:** " + formatTime(fetchedAt),
    "",
    "Ye fetch time par mila data hai. Crypto prices lagatar badal sakti hain. 24-hour change pichhle 24 ghanton ka percentage change hai; ye future return ki guarantee nahi hai."
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

    // Live crypto price requests get a directly formatted reply.
    // Gemini does not rewrite the numeric values.
    if (cleanPrompt && !image && asksForLiveCryptoPrice(cleanPrompt)) {
      let marketData;

      try {
        marketData = await getCryptoPrices();
      } catch (error) {
        console.error("CoinGecko error:", error.message);

        if (error.message === "COINGECKO_API_KEY_MISSING") {
          return res.status(503).json({
            reply:
              "Boss, Vercel mein COINGECKO_API_KEY nahi mili. " +
              "Vercel Environment Variables mein setting check karein."
          });
        }

        return res.status(503).json({
          reply:
            "Boss, abhi CoinGecko se live price nahi mil paayi. " +
            "Main galat price guess nahi karunga. Thodi der baad try karein."
        });
      }

      const fetchedAt = new Date().toISOString();

      const reply = buildCryptoReply(
        marketData,
        fetchedAt,
        cleanPrompt
      );

      if (reply) {
        return res.status(200).json({ reply });
      }
    }

    // Gemini handles normal questions and uploaded images.
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
          ? (
              cleanPrompt +
              "\n\nIf this is a stock or crypto chart, provide the structured " +
              "educational chart report specified in your instructions. " +
              "Only estimate entry, stop-loss and targets when the image " +
              "contains enough readable information. Never invent prices."
            )
          : (
              "Analyze this uploaded image. If it is a stock or crypto chart, " +
              "immediately provide the structured educational chart report: " +
              "asset, timeframe if visible, trend, visible price if readable, " +
              "chart observations, possible BUY BIAS / SELL BIAS / WAIT, " +
              "possible entry zone, stop-loss, Target 1, Target 2, risk level, " +
              "and what could invalidate the setup. Do not invent missing " +
              "prices or levels. If it is not a chart, describe the image."
            )
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
