import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
    // केवल POST रिक्वेस्ट को अनुमति दें
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { prompt } = req.body;
        
        // Vercel के Environment Variables से API Key उठाना
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ reply: "सर्वर गड़बड़: GEMINI_API_KEY सेट नहीं है बॉस!" });
        }

        // Google Gen AI SDK को इनिशियलाइज़ करना
        const ai = new GoogleGenAI({ apiKey: apiKey });

        // Gemini 2.5 Flash मॉडल का उपयोग करके जवाब जेनरेट करना
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            // AI को आपका 'Boss' वाला फ्रेंडली टोन सिखाने के लिए सिस्टम इंस्ट्रक्शन
            config: {
                systemInstruction: "You are Sunday AI, a helpful trading assistant. Always address the user as 'Boss'. Keep your responses highly concise, direct, and completely avoid conversational filler words. Mix Hindi and English (Hinglish) naturally."
            }
        });

        const replyText = response.text;

        // फ्रंटएंड को असली जवाब भेजना
        return res.status(200).json({ reply: replyText });

    } catch (error) {
        console.error("Gemini API Error:", error);
        return res.status(500).json({ reply: "माफ़ कीजिएगा बॉस, जेमिनी सर्वर से कनेक्ट करने में गड़बड़ हुई।" });
    }
}
