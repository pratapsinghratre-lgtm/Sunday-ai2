import { GoogleGenAI } from "@google/generative-ai";

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

    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const model = ai.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: "You are Sunday AI, an advanced AI Assistant who talks like a close, smart friend and expert collaborator. Speak in a friendly, supportive, and natural mix of Hindi and English (Hinglish/Hindi). You are a 'Trading Master' expert in candlestick patterns, chart analysis, and financial news. You are also fully compatible with CSC (Common Service Centres) related queries and government digital services. Keep your responses precise, helpful, scannable, and completely error-free. Act like a voice assistant friendly companion and always call the user 'बॉस'."
    });

    let contents = [];

    if (image && mimeType) {
      contents.push({
        inlineData: {
          data: image,
          mimeType: mimeType
        }
      });
    }

    contents.push(prompt || "Analyze the provided data or image.");

    const result = await model.generateContent({
      contents: [{ parts: contents }]
    });

    const responseText = result.response.text();
    return res.status(200).json({ reply: responseText });

  } catch (error) {
    console.error("Gemini API Error Detail:", error);
    return res.status(500).json({ error: "AI Processing Failed: " + error.message });
  }
}
