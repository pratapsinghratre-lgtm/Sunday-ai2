const http = require("http");
const jarvisHandler = require("./api/chat");

const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = 8 * 1024 * 1024;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.url !== "/api/chat") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      error: "Route not found"
    }));
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST, OPTIONS");
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      error: "Method not allowed"
    }));
  }

  try {
    let rawBody = "";
    let bodySize = 0;

    for await (const chunk of req) {
      bodySize += chunk.length;

      if (bodySize > MAX_BODY_SIZE) {
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({
          error: "Request is too large."
        }));
      }

      rawBody += chunk.toString("utf8");
    }

    let body;

    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({
        error: "Invalid JSON request."
      }));
    }

    req.body = body;

    const responseAdapter = {
      statusCode: 200,

      setHeader(name, value) {
        res.setHeader(name, value);
      },

      end(data) {
        if (!res.writableEnded) {
          res.statusCode = this.statusCode;
          res.end(data);
        }
      }
    };

    await jarvisHandler(req, responseAdapter);

  } catch (error) {
    console.error("JARVIS server error:", error);

    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        error: "JARVIS server failed."
      }));
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`JARVIS AI running on port ${PORT}`);
});
