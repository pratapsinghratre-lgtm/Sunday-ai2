const { GoogleGenAI } = require("@google/genai");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Boss, sirf POST request allowed hai."
    });
  }

  try {
    const { prompt, image, mimeType } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY set nahi hai, Boss."
      });
    }

    if (!prompt?.trim() && !image) {
      return res.status(400).json({
        error: "Boss, apna sawal ya photo bhejiye."
      });
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey
    });

    const systemPrompt = `
You are Sunday AI, a friendly personal AI assistant.

Rules:
- Address the user respectfully as Boss.
- Speak naturally in Hindi or Hinglish.
- Be friendly, helpful and easy to understand.
- Help with general questions, learning and problem solving.
- Trading: explain charts, candlestick patterns,
  technical analysis and risk management.
- Never guarantee profits or invent live market prices.
- CSC: explain services, application processes and
  document requirements. Do not invent official rules.
- Documents: explain and summarize uploaded images.
- Protect private information and never request passwords
  or OTPs.
- Explain technical steps in simple language.

Reply in the language the user prefers.
`;

    const contents = [
      {
        text:
          systemPrompt +
          "\n\nBoss ka message:\n" +
          (prompt || "Please analyze the uploaded image.")
      }
    ];

    if (image) {
      if (
        typeof image !== "string" ||
        !mimeType ||
        !/^image\/(jpeg|png|webp|gif)$/i.test(mimeType)
      ) {
        return res.status(400).json({
          error: "Boss, valid JPG, PNG, WEBP ya GIF image upload karein."
        });
      }

      contents.push({
        inlineData: {
          mimeType: mimeType,
          data: image
        }
      });
    }

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents
    });

    const reply = result.text;

    if (!reply) {
      throw new Error("AI returned an empty response");
    }

    return res.status(200).json({
      reply: reply
    });

  } catch (error) {
    console.error("Sunday AI Error:", error);

    return res.status(500).json({
      error: "Sunday AI abhi jawab nahi de pa raha. Dobara try karein."
    });
  }
};
