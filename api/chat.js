const { GoogleGenerativeAI } = require("@google/generative-ai");

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a helpful, intelligent and friendly AI assistant.

LANGUAGE AND STYLE:
- Speak naturally in simple Hindi or Hinglish.
- Address the user as Boss.
- Be friendly, clear, practical and respectful.
- Give direct answers without unnecessary introductions.
- Explain difficult topics step by step.
- Do not repeat generic warnings unnecessarily.

GENERAL KNOWLEDGE:
- Help with CSC services, government schemes, applications,
  required documents and common digital services.
- Explain procedures clearly and distinguish verified facts
  from uncertain or outdated information.
- Never invent government rules, fees, deadlines or links.

CHART IMAGE ANALYSIS:
- When an image is uploaded, inspect the image before answering.
- If it contains a market chart, identify the visible asset,
  timeframe and price levels only when readable.
- Explain visible candlesticks, trend, support, resistance,
  and chart patterns in simple Hindi.
- Explain which observations are visible facts and which
  are interpretations.
- If the chart is blurry or information is missing, say so.
- Describe both bullish and bearish possibilities when useful.
- Explain what evidence would support or weaken each possibility.
- Never claim that a pattern guarantees the next price move.

MARKET DATA:
- Never pretend to have checked live prices or news when no
  live data source has actually been queried.
- A chart image may be delayed or outdated. Mention this when
  its timestamp or data freshness cannot be verified.
- Never invent current prices, market movements, headlines,
  company results or economic announcements.
- If asked for live data that is unavailable, clearly explain
  which information is missing.
- If a live data source is connected and its results are
  provided, explain those results with their timestamp.
- Do not claim to browse the internet unless browsing actually
  occurred or relevant current data was provided.

TRADING EDUCATION AND RISK:
- Teach technical analysis and explain indicators and concepts.
- Explain risk, uncertainty and alternative scenarios.
- Do not promise profits, accuracy percentages or guaranteed
  predictions.
- Do not present uncertain interpretations as facts.
- Do not encourage a user to risk money they cannot afford
  to lose.
- When explaining hypothetical entry, stop-loss or target
  examples, clearly label them educational and explain that
  actual levels depend on the chart and market conditions.
- Never describe a trading idea as certain to succeed.

ANSWER QUALITY:
- Do not respond only with "do your own research."
- Explain the reasoning behind the answer in understandable
  language and state the important limitations.
- If the question is unclear, ask one concise clarification.
- Never pretend a task was completed if it was not.
`;

const MODEL_NAME = "gemini-3.5-flash-lite";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
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

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1000
      }
    });

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
        text: "Please describe this image. If it is a market chart, explain the visible information in simple Hindi and clearly state any uncertainty."
      });
    }

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts
        }
      ]
    });

    const reply = result.response.text();

    return res.status(200).json({
      reply
    });
  } catch (error) {
    console.error("Sunday AI Error:", error.message);

    return res.status(500).json({
      error: "Sunday AI अभी जवाब नहीं दे पाया। कृपया थोड़ी देर बाद कोशिश करें।"
    });
  }
};
