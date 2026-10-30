const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const SYSTEM_PROMPT = `
You are GLITCH AI, a helpful student-focused AI assistant created by MR. RAUSHAN / RAUSHAN SINGH.

Rules:
- Reply naturally in Hindi or Hinglish when the user uses Hindi/Hinglish.
- Answer questions as accurately as possible. Never claim 100% accuracy.
- Explain difficult topics step-by-step when useful.
- Help with maths, science, coding, school/college topics, general knowledge and everyday questions.
- When current information is needed, use Google Search grounding when available.
- Do not ask users to enter an API key. The API key is handled securely by the server.
- Be friendly, clear and concise unless the user asks for a detailed answer.
`;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, {
        error: "File not found"
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, {
      "Content-Type":
        types[ext] || "application/octet-stream"
    });

    res.end(data);
  });
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 5 * 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      resolve(body);
    });

    req.on("error", reject);
  });
}

async function callGemini(message, history) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server."
    );
  }

  const contents = [];

  if (Array.isArray(history)) {
    for (const item of history.slice(-20)) {
      if (!item || !item.role || !item.text) {
        continue;
      }

      contents.push({
        role:
          item.role === "assistant"
            ? "model"
            : "user",

        parts: [
          {
            text: String(item.text).slice(0, 12000)
          }
        ]
      });
    }
  }

  contents.push({
    role: "user",
    parts: [
      {
        text: String(message).slice(0, 30000)
      }
    ]
  });

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(GEMINI_MODEL) +
    ":generateContent";

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },

    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: SYSTEM_PROMPT
          }
        ]
      },

      contents,

      tools: [
        {
          google_search: {}
        }
      ],

      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const detail =
      data?.error?.message ||
      `Gemini API returned HTTP ${response.status}`;

    throw new Error(detail);
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

  if (!text) {
    throw new Error(
      "Gemini returned an empty response."
    );
  }

  return text;
}

const server = http.createServer(
  async (req, res) => {
    try {
      const url = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      );

      if (
        req.method === "GET" &&
        url.pathname === "/api/health"
      ) {
        return sendJson(res, 200, {
          ok: true,
          model: GEMINI_MODEL,
          apiKeyConfigured:
            Boolean(GEMINI_API_KEY)
        });
      }

      if (
        req.method === "POST" &&
        url.pathname === "/api/chat"
      ) {
        const rawBody = await getBody(req);

        let body;

        try {
          body = JSON.parse(rawBody || "{}");
        } catch {
          return sendJson(res, 400, {
            error: "Invalid JSON request."
          });
        }

        const message =
          String(body.message || "").trim();

        if (!message) {
          return sendJson(res, 400, {
            error: "Message is required."
          });
        }

        try {
          const reply = await callGemini(
            message,
            body.history || []
          );

          return sendJson(res, 200, {
            ok: true,
            reply
          });

        } catch (error) {
          console.error(
            "Gemini error:",
            error
          );

          return sendJson(res, 500, {
            ok: false,
            error:
              error.message ||
              "AI server error."
          });
        }
      }

      if (req.method === "GET") {
        let requested =
          decodeURIComponent(url.pathname);

        if (requested === "/") {
          requested = "/index.html";
        }

        const safePath =
          path
            .normalize(requested)
            .replace(
              /^(\.\.[\/\\])+/, 
              ""
            );

        const filePath =
          path.join(
            __dirname,
            safePath
          );

        if (
          fs.existsSync(filePath) &&
          fs.statSync(filePath).isFile()
        ) {
          return serveFile(
            res,
            filePath
          );
        }

        return sendJson(res, 404, {
          error: "Page not found."
        });
      }

      return sendJson(res, 405, {
        error: "Method not allowed."
      });

    } catch (error) {
      console.error(
        "Server error:",
        error
      );

      return sendJson(res, 500, {
        error: "Internal server error."
      });
    }
  }
);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `GLITCH AI server running on port ${PORT}`
    );

    console.log(
      `Gemini API key configured: ${Boolean(
        GEMINI_API_KEY
      )}`
    );
  }
);