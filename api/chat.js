const { GoogleGenerativeAI } = require("@google/generative-ai");

const SYSTEM_INSTRUCTION = `
You are Sunday AI, a friendly and smart AI assistant.
Speak naturally in Hindi or Hinglish.
Always address the user as Boss or Boss in Hindi.
Help with general questions, trading education, candlestick patterns,
chart analysis, CSC services, and image analysis.
Be clear, helpful, and honest about uncertainty.
Never promise trading profits.
`;

const MODELS = ["gemini-3.8-flash"];

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

    if (!prompt && !image) {
      return res.status(400).json({
        error: "Please enter a message or upload an image."
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: MODELS[0],
      systemInstruction: SYSTEM_INSTRUCTION
    });

    const parts = [];

    if (image && mimeType) {
      parts.push({
        inlineData: {
          data: image.replace(/^data:[^,]+,/, ""),
          mimeType: mimeType
        }
      });
    }

    if (prompt) {
      parts.push({
        text: prompt
      });
    }

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: parts
        }
      ]
    });

    const reply = result.response.text();

    return res.status(200).json({
      reply: reply
    });

  } catch (error) {
    console.error("Sunday AI Error:", error);

    return res.status(500).json({
      error: "AI Processing Failed",
      details: error.message || "Unknown error"
    });
  }
};
