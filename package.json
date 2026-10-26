import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { prompt, image, mimeType } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API Key is missing in Vercel settings!' });
    }

    // सबसे स्टेबल और स्टैंडर्ड इनिशियलाइज़ेशन तरीका
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // ट्रेडिंग, CSC और इमेज एनालिसिस के लिए सबसे परफेक्ट मॉडल
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: "You are Sunday AI, an advanced AI Assistant who talks like a close, smart friend and expert collaborator. Speak in a friendly, supportive, and natural mix of Hindi and English (Hinglish/Hindi). You are a 'Trading Master' expert in candlestick patterns, chart analysis, and financial news. You are also fully compatible with CSC (Common Service Centres) related queries and government digital services. Keep your responses precise, helpful, scannable, and completely error-free. Act like a voice assistant friendly companion and always call the user 'बॉस'."
    });

    let contents = [];

    // इमेज को सही फॉर्मेट में जोड़ना
    if (image && mimeType) {
      contents.push({
        inlineData: {
          data: image,
          mimeType: mimeType
        }
      });
    }

    // टेक्स्ट प्रॉम्प्ट जोड़ना
    contents.push(prompt || "Analyze the provided data or image.");

    // AI से रिस्पॉन्स जनरेट कराना
    const result = await model.generateContent(contents);
    const responseText = result.response.text();
    
    return res.status(200).json({ reply: responseText });

  } catch (error) {
    console.error("Gemini API Error Detail:", error);
    return res.status(500).json({ error: "AI Processing Failed: " + error.message });
  }
}
