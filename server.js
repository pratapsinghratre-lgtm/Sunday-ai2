const http = require("http");
const jarvisHandler = require("./api/chat");

const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = 8 * 1024 * 1024;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const pathname = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  ).pathname.replace(/\/+$/, "") || "/";

  // Server health check
  if (pathname === "/" && req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      status: "online",
      message: "JARVIS AI server is running."
    }));
  }

  if (pathname !== "/api/chat") {
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
      error: "Use POST for the chat API."
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
