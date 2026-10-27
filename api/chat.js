const { GoogleGenerativeAI } = require("@google/generative-ai");

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a fast, friendly and intelligent assistant.

- Speak naturally in Hindi or Hinglish.
- Address the user as Boss.
- Give direct, useful answers without unnecessary introductions.
- Keep simple answers short.
- Explain CSC services, documents, applications and government schemes.
- Help with trading education, chart images, candlesticks, trends,
  support, resistance, entry, stop loss and targets.
- Analyze uploaded images when provided.
- Never invent live market prices or current news.
- Be honest about uncertainty and never promise trading profits.
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

    if (!prompt?.trim() && !image) {
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
        maxOutputTokens: 700
      }
    });

    const parts = [];

    if (image) {
      if (!mimeType || !mimeType.startsWith("image/")) {
        return res.status(400).json({
          error: "Please upload a valid image."
        });
      }

      parts.push({
        inlineData: {
          data: image.replace(/^data:[^,]+,/, ""),
          mimeType
        }
      });
    }

    if (prompt?.trim()) {
      parts.push({
        text: prompt.trim()
      });
    }

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts
      }]
    });

    const reply = result.response.text();

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Sunday AI Error:", error);

    return res.status(500).json({
      error: "Sunday AI जवाब नहीं दे पाया।",
      details: error.message || "Unknown error"
    });
  }
};
