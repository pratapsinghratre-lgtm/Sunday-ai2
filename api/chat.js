const SYSTEM_INSTRUCTION = `
You are Sunday AI, a friendly and smart AI assistant.
Speak naturally in Hindi or Hinglish.
`;

const MODELS = ["gemini-3.8-flash"];

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
    const genAI = new GoogleGenerativeAI(apiKey);
    const parts = [];

    if (image && mimeType) {
      parts.push({
        inlineData: {
          data: image.replace(/^data:[^,]+,/, ""),
          mimeType
        }
      });
    }

    parts.push({
      text: prompt || "Please analyze the provided image or data."
    });

    let lastError;

    for (const modelName of MODELS) {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_INSTRUCTION
      });

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await model.generateContent({
            contents: [{ role: "user", parts }]
          });

          return res.status(200).json({
            reply: result.response.text()
          });

        } catch (error) {
          lastError = error;

          const status =
            error.status ||
            (error.response && error.response.status);

          console.error(
            "Sunday AI Error:",
            status,
            error.message
          );

          if (![429, 500, 502, 503, 504].includes(status)) {
            throw error;
          }

          if (attempt < 2) {
            await sleep(1500);
          }
        }
      }
    }

    const status =
      lastError &&
      (lastError.status ||
        (lastError.response && lastError.response.status));

    if ([429, 500, 502, 503, 504].includes(status)) {
      return res.status(503).json({
        error: "Sunday AI is busy right now. Please try again shortly."
      });
    }

    throw lastError || new Error("AI request failed");

  } catch (error) {
    console.error("Sunday AI Error:", error);

    return res.status(500).json({
      error: "AI Processing Failed",
      details: error.message
    });
  }
};
