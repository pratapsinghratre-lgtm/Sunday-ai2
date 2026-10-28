module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  const apiKey = process.env.COINGECKO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "COINGECKO_API_KEY is missing in Vercel settings."
    });
  }

  try {
    const url = new URL(
      "https://api.coingecko.com/api/v3/simple/price"
    );

    url.searchParams.set("ids", "bitcoin,ethereum");
    url.searchParams.set("vs_currencies", "inr");
    url.searchParams.set("include_24hr_change", "true");

    const response = await fetch(url, {
      headers: {
        "x-cg-demo-api-key": apiKey
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: "CoinGecko market data is temporarily unavailable."
      });
    }

    const data = await response.json();

    return res.status(200).json({
      success: true,
      currency: "INR",
      updatedAt: new Date().toISOString(),
      prices: data
    });
  } catch (error) {
    console.error("Market API error:", error.message);

    return res.status(500).json({
      error: "Unable to fetch market data."
    });
  }
};
