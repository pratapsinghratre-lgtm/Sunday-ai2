const https = require("https");

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": "Sunday-AI/1.0", ...headers } },
      (response) => {
        let body = "";

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          try {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              return reject(new Error(`API status: ${response.statusCode}`));
            }

            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error("API timeout"));
    });

    request.on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      success: false,
      error: "GET request required"
    });
  }

  const results = await Promise.allSettled([
    fetchJSON(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=inr&include_24hr_change=true"
    )
  ]);

  const cryptoResult = results[0];

  const crypto = cryptoResult.status === "fulfilled"
    ? cryptoResult.value
    : null;

  return res.status(200).json({
    success: true,
    updatedAt: new Date().toISOString(),
    currency: "INR",
    crypto: crypto
      ? {
          bitcoin: crypto.bitcoin || null,
          ethereum: crypto.ethereum || null
        }
      : null,
    errors: crypto ? [] : ["Crypto data is temporarily unavailable"],
    message: "Indian stock market data and news will be connected in the next update."
  });
};
