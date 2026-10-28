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

LIVE MARKET DATA:
- A live CoinGecko data block may be provided with a timestamp.
- When provided, use its prices and 24-hour changes accurately.
- Treat the supplied data as the latest fetched snapshot, not a guarantee that prices have not changed since fetching.
- Never invent live prices, news or market movements.
- If the requested asset is not included in the supplied data, clearly say that its live price has not been connected.
- Do not claim to have checked live news or Indian stock prices unless that information was actually provided.
- Explain prices in INR when the supplied data is in INR.

TRADING EDUCATION:
- Explain concepts and chart observations clearly.
- Explain uncertainty and risks.
- Never promise profits or guaranteed predictions.
- Any hypothetical trading example must be labelled educational.

ANSWER QUALITY:
- Do not merely say "do your own research."
- Explain the reasoning and important limitations.
- If information is missing, state what is missing.
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
    /(price|current|live|rate|kitna|keemat|daam|abhi|aaj|rupee|inr|कीमत|दाम|भाव|अभी)/i.test(text);

  return mentionsCrypto && asksForPrice;
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
      parts.push({
        text: cleanPrompt
      });
    } else if (image) {
      parts.push({
        text:
          "Please analyze this image in simple Hindi. " +
          "If it is a market chart, explain only what is visible."
      });
    }

    // Fetch live prices only when the user asks for
    // Bitcoin or Ethereum price information.
    if (cleanPrompt && asksForLiveCryptoPrice(cleanPrompt)) {
      let marketData;

      try {
        marketData = await getCryptoPrices();
      } catch (error) {
        console.error("CoinGecko error:", error.message);

        if (error.message === "COINGECKO_API_KEY_MISSING") {
          return res.status(503).json({
            reply:
              "Boss, live crypto price ke liye COINGECKO_API_KEY " +
              "Vercel mein set nahi hai. Pehle Vercel Environment " +
              "Variables mein is key ko check karna hoga."
          });
        }

        return res.status(503).json({
          reply:
            "Boss, abhi CoinGecko se live price nahi mil paayi. " +
            "Isliye main current price guess nahi karunga. " +
            "Thodi der baad dobara try karo."
        });
      }

      const bitcoin = marketData.bitcoin;
      const ethereum = marketData.ethereum;

      const snapshot = {
        source: "CoinGecko",
        fetchedAt: new Date().toISOString(),
        currency: "INR",
        prices: {
          bitcoin: bitcoin
            ? {
                price_inr: bitcoin.inr,
                change_24h_percent: bitcoin.inr_24h_change
              }
            : null,
          ethereum: ethereum
            ? {
                price_inr: ethereum.inr,
                change_24h_percent: ethereum.inr_24h_change
              }
            : null
        }
      };

      parts.push({
        text:
          "LIVE CRYPTO DATA FETCHED FOR THIS REQUEST. " +
          "Use this data to answer the user's price question. " +
          "Do not invent missing values. Mention the source and " +
          "fetch time, and explain that prices can change.\n" +
          JSON.stringify(snapshot)
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
        "Sunday AI abhi jawab nahi de paaya. Thodi der baad try karo."
    });
  }
};
