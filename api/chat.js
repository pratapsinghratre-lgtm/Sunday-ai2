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

CHART ANALYSIS:
- Analyze uploaded chart images when provided.
- Explain visible candlesticks, trends, support and resistance.
- Distinguish visible facts from interpretations.
- Explain bullish and bearish possibilities where useful.
- Never guarantee price movements or profits.

TRADING EDUCATION:
- Explain concepts and chart observations clearly.
- Explain uncertainty and risks.
- Never promise profits or guaranteed predictions.
- Label hypothetical examples as educational.

LIVE MARKET DATA:
- Do not invent live prices, news or market movements.
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
    if (cleanPrompt && asksForLiveCryptoPrice(cleanPrompt)) {
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

    // Keep Gemini for normal questions and image/chart analysis.
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
    }

    if (cleanPrompt) {
      parts.push({ text: cleanPrompt });
    } else if (image) {
      parts.push({
        text:
          "Please analyze this image in simple Hindi. " +
          "If it is a market chart, explain only what is visible."
      });
    }

    const genAI = new GoogleGenerativeAI(geminiKey);

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000
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
