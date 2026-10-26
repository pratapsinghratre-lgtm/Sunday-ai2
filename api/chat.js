const { GoogleGenAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  // CORS Headers ताकि फ्रंटएंड कनेक्ट हो सके
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "API Key सेट नहीं है, बॉस।" });
    }

    // Gemini AI को इनिशियलाइज करना
    const ai = new GoogleGenAI({ apiKey: apiKey });
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

    // बॉस वाले कस्टमाइज्ड इंस्ट्रक्शन्स (System Prompt)
    const prompt = `You are a helpful AI assistant named 'Sunday AI'. Address the user respectfully as 'Boss' and speak in a friendly mix of Hindi and English (Hinglish). You specialize in trading, candlestick analysis, and news analysis. User message: ${message}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    return res.status(200).json({ response: responseText });

  } catch (error) {
    console.error("Gemini Error:", error);
    return res.status(500).json({ response: "सर्वर से कनेक्ट नहीं हो पाया बॉस। कृपया दोबारा प्रयास करें।" });
  }
};
    
