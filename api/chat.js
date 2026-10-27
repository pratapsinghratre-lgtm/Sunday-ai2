const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    const { prompt, image, mimeType } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing in Vercel settings."
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash",
      systemInstruction: `
        You are Sunday AI, a friendly and smart AI assistant.
        Speak naturally in Hindi or Hinglish.
        Always address the user as बॉस.
        Help with general questions, trading education,
        candlestick patterns, chart analysis, CSC services,
        and image analysis.
        Be clear, helpful, and honest about uncertainty.
        Do not promise trading profits.
      `
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

    parts.push({
      text: prompt || "Please analyze the provided image or data."
    });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: parts
        }
      ]
    });

    const reply = result.response.text();

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Sunday AI Error:", error);

    return res.status(500).json({
      error: "AI Processing Failed",
      details: error.message
    });
  }
};
