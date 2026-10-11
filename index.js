const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function randomHex(bytes = 24) {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(bytes)),
    x => x.toString(16).padStart(2, "0")
  ).join("");
}

function base64UTF8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }

  return btoa(binary);
}

async function github(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Installer",
      ...(options.headers || {}),
    },
  });
}

async function cf(path, token, options = {}) {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4" + path,
    {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        ...(options.headers || {}),
      },
    }
  );

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = { success: false, errors: [{ message: raw }] };
  }

  if (!response.ok || data.success === false) {
    const details = (data.errors || [])
      .map(x => x.message || JSON.stringify(x))
      .join("; ");

    throw new Error("Cloudflare API: " + (details || response.status));
  }

  return data.result;
}

async function putRepoFile(owner, repo, path, content, token) {
  const url =
    "https://api.github.com/repos/" +
    owner + "/" + repo + "/contents/" + path;

  const existing = await github(url, token);
  let sha;

  if (existing.ok) {
    sha = (await existing.json()).sha;
  } else if (existing.status !== 404) {
    throw new Error(
      "GitHub read failed (" + path + "): " + await existing.text()
    );
  }

  const response = await github(url, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Create relay deployment files",
      content: base64UTF8(content),
      ...(sha ? { sha } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      "GitHub upload failed (" + path + "): " + await response.text()
    );
  }
}

/* =========================
   TCP RELAY
========================= */

const RELAY_SOURCE = String.raw`
import net from "node:net";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 443);
const SECRET = String(process.env.RELAY_SECRET || "");
const MAX_SECRET_LENGTH = 256;

if (!SECRET) {
  console.error("RELAY_SECRET is required");
  process.exit(1);
}

const expectedSecret = Buffer.from(SECRET, "utf8");

if (expectedSecret.length < 16 || expectedSecret.length > MAX_SECRET_LENGTH) {
  console.error("Invalid RELAY_SECRET length");
  process.exit(1);
}

const server = net.createServer(client => {
  client.setNoDelay(true);

  let remote = null;
  let buffer = Buffer.alloc(0);
  let stage = "secretLength";
  let secretLength = 0;
  let hostLength = 0;
  let finished = false;

  const timer = setTimeout(() => {
    if (stage !== "connected") client.destroy();
  }, 10000);

  function reject(reason) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    console.log("REJECT:", reason);
    client.destroy();
    remote?.destroy();
  }

  function onData(chunk) {
    if (finished) return;

    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      if (stage === "secretLength") {
        if (buffer.length < 2) return;
        secretLength = buffer.readUInt16BE(0);
        buffer = buffer.subarray(2);

        if (secretLength < 16 || secretLength > MAX_SECRET_LENGTH) {
          return reject("Invalid secret length");
        }

        stage = "secret";
      }

      if (stage === "secret") {
        if (buffer.length < secretLength) return;

        const received = buffer.subarray(0, secretLength);
        buffer = buffer.subarray(secretLength);

        if (
          received.length !== expectedSecret.length ||
          !timingSafeEqual(received, expectedSecret)
        ) {
          return reject("Authentication failed");
        }

        stage = "hostLength";
      }

      if (stage === "hostLength") {
        if (buffer.length < 2) return;
        hostLength = buffer.readUInt16BE(0);
        buffer = buffer.subarray(2);

        if (hostLength < 1 || hostLength > 255) {
          return reject("Invalid host length");
        }

        stage = "target";
      }

      if (stage === "target") {
        if (buffer.length < hostLength + 2) return;

        const host = buffer.subarray(0, hostLength).toString("utf8");
        const port = buffer.readUInt16BE(hostLength);
        const payload = buffer.subarray(hostLength + 2);
        buffer = Buffer.alloc(0);
        stage = "connecting";

        if (
          !host ||
          /[\0\r\n]/.test(host) ||
          !Number.isInteger(port) ||
          port < 1 ||
          port > 65535
        ) {
          return reject("Invalid destination");
        }

        clearTimeout(timer);
        client.pause();
        client.removeListener("data", onData);

        try {
          remote = net.connect({ host, port });
          remote.setNoDelay(true);

          let acknowledged = false;
          const connectTimer = setTimeout(() => {
            if (!acknowledged) {
              console.log("REMOTE CONNECT TIMEOUT:", host, port);
              client.end(Buffer.from([1]));
              remote.destroy();
            }
          }, 10000);

          remote.once("connect", () => {
            if (finished) {
              clearTimeout(connectTimer);
              return remote.destroy();
            }

            acknowledged = true;
            clearTimeout(connectTimer);
            stage = "connected";
            console.log("CONNECTED:", host, port);

            // Signal successful destination connection to Gateway.
            client.write(Buffer.from([0]));

            if (payload.length) remote.write(payload);

            client.pipe(remote);
            remote.pipe(client);
            client.resume();
          });

          remote.on("error", err => {
            console.log("REMOTE ERROR:", err.message);
            clearTimeout(connectTimer);

            if (!acknowledged && !client.destroyed) {
              client.end(Buffer.from([1]));
            } else {
              client.destroy();
            }
          });

          remote.on("close", () => {
            if (!acknowledged && !client.destroyed) {
              client.end(Buffer.from([1]));
            } else {
              client.destroy();
            }
          });
        } catch (err) {
          reject(err.message);
        }

        return;
      }

      return;
    }
  }

  client.on("data", onData);

  client.on("error", err => {
    console.log("CLIENT ERROR:", err.message);
    remote?.destroy();
  });

  client.on("close", () => {
    finished = true;
    clearTimeout(timer);
    remote?.destroy();
  });
});

server.on("error", err => console.error("SERVER ERROR:", err));

server.listen(PORT, "0.0.0.0", () => {
  console.log("Authenticated TCP Relay listening on", PORT);
});
`;

/* =========================
   VLESS GATEWAY
========================= */

const GATEWAY_SOURCE = String.raw`
import { connect } from "cloudflare:sockets";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

function uuidFromBytes(bytes) {
  const h = Array.from(
    bytes,
    b => b.toString(16).padStart(2, "0")
  ).join("");

  return h.slice(0,8) + "-" + h.slice(8,12) + "-" +
    h.slice(12,16) + "-" + h.slice(16,20) + "-" + h.slice(20,32);
}

function decodeEarlyData(value) {
  if (!value) return null;

  try {
    let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    normalized += "=".repeat((4 - (normalized.length % 4)) % 4);

    const binary = atob(normalized);

    return Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function bytesOf(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength
    );
  }

  if (data && typeof data.arrayBuffer === "function") {
    return new Uint8Array(await data.arrayBuffer());
  }

  throw new Error("Unsupported WebSocket data");
}

function parseVLESS(bytes) {
  if (bytes.length < 24) {
    throw new Error("VLESS header too short");
  }

  const version = bytes[0];
  const uuid = uuidFromBytes(bytes.slice(1, 17));
  let i = 18 + bytes[17];

  if (i + 4 > bytes.length) {
    throw new Error("Invalid VLESS header");
  }

  const command = bytes[i++];

  if (command !== 1) {
    throw new Error("Only VLESS TCP is supported");
  }

  const port = (bytes[i++] << 8) | bytes[i++];
  const type = bytes[i++];
  let host = "";

  if (type === 1) {
    if (i + 4 > bytes.length) {
      throw new Error("Invalid IPv4");
    }

    host = Array.from(bytes.slice(i, i + 4)).join(".");
    i += 4;
  } else if (type === 2) {
    if (i >= bytes.length) {
      throw new Error("Invalid domain");
    }

    const length = bytes[i++];

    if (i + length > bytes.length) {
      throw new Error("Invalid domain length");
    }

    host = new TextDecoder().decode(bytes.slice(i, i + length));
    i += length;
  } else if (type === 3) {
    if (i + 16 > bytes.length) {
      throw new Error("Invalid IPv6");
    }

    const parts = [];

    for (let n = 0; n < 16; n += 2) {
      parts.push(
        ((bytes[i+n] << 8) | bytes[i+n+1]).toString(16)
      );
    }

    host = parts.join(":");
    i += 16;
  } else {
    throw new Error("Unknown address type");
  }

  if (!host || port < 1 || port > 65535) {
    throw new Error("Invalid destination");
  }

  return {
    version,
    uuid,
    host,
    port,
    payload: bytes.slice(i)
  };
}

async function handleVLESS(request, env) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket Required", { status: 426 });
  }

  if (
    !env.UUID ||
    !env.RELAY_SECRET ||
    !env.RELAY_HOST ||
    !env.RELAY_PORT ||
    env.RELAY_HOST === "SET_AFTER_RAILWAY_DEPLOY"
  ) {
    return new Response(
      "Gateway environment is incomplete",
      { status: 503 }
    );
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const ws = pair[1];

  ws.accept();

  let socket;
  let writer;
  let closed = false;
  let relayHandshakePending = true;
  let chain = Promise.resolve();

  function closeAll() {
    if (closed) return;

    closed = true;

    try { writer?.releaseLock(); } catch {}
    try { socket?.close(); } catch {}
    try { ws.close(); } catch {}
  }

  async function connectRelay(parsed) {
    const secret = new TextEncoder().encode(env.RELAY_SECRET);
    const host = new TextEncoder().encode(parsed.host);
    const relayPort = Number(env.RELAY_PORT);

    if (secret.length < 16 || secret.length > 256) {
      throw new Error("Invalid relay secret");
    }

    if (!host.length || host.length > 255) {
      throw new Error("Invalid destination hostname");
    }

    if (
      !Number.isInteger(relayPort) ||
      relayPort < 1 ||
      relayPort > 65535
    ) {
      throw new Error("Invalid relay port");
    }

    socket = connect({
      hostname: String(env.RELAY_HOST).trim(),
      port: relayPort
    });

    await socket.opened;

    if (closed) return socket.close();

    writer = socket.writable.getWriter();

    const frame = new Uint8Array(
      2 + secret.length + 2 + host.length + 2 + parsed.payload.length
    );

    let offset = 0;

    frame[offset++] = (secret.length >> 8) & 255;
    frame[offset++] = secret.length & 255;

    frame.set(secret, offset);
    offset += secret.length;

    frame[offset++] = (host.length >> 8) & 255;
    frame[offset++] = host.length & 255;

    frame.set(host, offset);
    offset += host.length;

    frame[offset++] = (parsed.port >> 8) & 255;
    frame[offset++] = parsed.port & 255;

    frame.set(parsed.payload, offset);

    await writer.write(frame);

    socket.readable.pipeTo(new WritableStream({
      write(chunk) {
        if (closed || ws.readyState !== WebSocket.OPEN) return;

        const data = chunk instanceof Uint8Array
          ? chunk
          : new Uint8Array(chunk);

        if (relayHandshakePending) {
          if (data.length < 1) return;

          relayHandshakePending = false;

          if (data[0] !== 0) {
            closeAll();
            return;
          }

          ws.send(new Uint8Array([parsed.version, 0]));

          if (data.length > 1) {
            ws.send(data.slice(1));
          }

          return;
        }

        if (data.length) ws.send(data);
      }
    })).catch(err => {
      if (!closed) {
        console.log("RELAY STREAM ERROR", err.message);
      }
    }).finally(closeAll);
  }

  async function onMessage(data) {
    const bytes = await bytesOf(data);

    if (writer) {
      await writer.write(bytes);
      return;
    }

    const parsed = parseVLESS(bytes);

    if (parsed.uuid.toLowerCase() !== String(env.UUID).toLowerCase()) {
      throw new Error("UUID mismatch");
    }

    await connectRelay(parsed);
  }

  function enqueue(data) {
    chain = chain.then(() => onMessage(data)).catch(err => {
      console.log("VLESS ERROR:", err.message);
      closeAll();
    });
  }

  const early = decodeEarlyData(
    request.headers.get("sec-websocket-protocol")
  );

  if (early?.length) enqueue(early);

  ws.addEventListener("message", event => enqueue(event.data));
  ws.addEventListener("close", closeAll);
  ws.addEventListener("error", closeAll);

  const headers = {};
  const protocol = request.headers.get("sec-websocket-protocol");

  if (protocol) {
    headers["sec-websocket-protocol"] = protocol;
  }

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "*"
        }
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        success: true,
        gateway: "Gateway",
        gateway_id: env.GATEWAY_ID || null,
        region: env.GATEWAY_REGION || "eu",
        status: "online",
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
      return handleVLESS(request, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};
`;

/* =========================
   TELEGRAM BOT WORKER
========================= */

function_placeholder_to_continue
const BOT_SOURCE = String.raw`
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function sendMessage(env, chatId, text) {
  const response = await fetch(
    "https://api.telegram.org/bot" +
      env.TELEGRAM_BOT_TOKEN +
      "/sendMessage",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    }
  );

  if (!response.ok) {
    throw new Error("Telegram sendMessage failed");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        success: true,
        service: "Telegram Bot Webhook"
      });
    }

    if (url.pathname !== "/telegram-webhook") {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (
      !env.TELEGRAM_BOT_TOKEN ||
      !env.TELEGRAM_ADMIN_ID ||
      !env.BOT_WEBHOOK_SECRET ||
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        env.BOT_WEBHOOK_SECRET
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update;

    try {
      update = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const message = update.message;

    if (!message?.text || !message.chat?.id) {
      return json({ success: true });
    }

    const command = message.text.trim().split(/\s+/)[0].split("@")[0];
    const senderId = String(message.from?.id || "");
    const chatId = message.chat.id;
    const isAdmin = senderId === String(env.TELEGRAM_ADMIN_ID);

    try {
      if (command === "/start" || command === "/help") {
        await sendMessage(
          env,
          chatId,
          isAdmin
            ? "ربات فعال است. برای راهنما /help را بزن.\nمدیریت کاربران هنوز به API پنل متصل نشده است."
            : "ربات فعال است. برای دسترسی مدیریتی با مدیر سیستم تماس بگیر."
        );
      } else if (command === "/id") {
        await sendMessage(
          env,
          chatId,
          "Telegram ID: " + senderId
        );
      } else if (isAdmin) {
        await sendMessage(
          env,
          chatId,
          "این ربات هنوز به API پنل متصل نشده است؛ مدیریت کاربران و اشتراک‌ها در دسترس نیست."
        );
      } else {
        await sendMessage(
          env,
          chatId,
          "این دستور در دسترس نیست."
        );
      }
    } catch (err) {
      console.log("Telegram handler error:", err.message);
    }

    return json({ success: true });
  }
};
`;

async function deployWorker(
  accountId,
  token,
  workerName,
  source,
  bindings,
  secretNames = []
) {
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2026-10-10",
    bindings: Object.entries(bindings).map(([name, value]) => ({
      type: secretNames.includes(name) ? "secret_text" : "plain_text",
      name,
      text: String(value)
    }))
  };

  const form = new FormData();

  form.append("metadata", JSON.stringify(metadata));

  form.append(
    "index.js",
    new Blob([source], {
      type: "application/javascript+module"
    }),
    "index.js"
  );

  await cf(
    "/accounts/" + accountId +
      "/workers/scripts/" + workerName + "/content",
    token,
    {
      method: "PUT",
      body: form
    }
  );

  await cf(
    "/accounts/" + accountId +
      "/workers/scripts/" + workerName + "/subdomain",
    token,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: true })
    }
  );
}
/* =========================
   INSTALLER API
========================= */

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    if (request.method !== "POST") {
      return json({
        success: false,
        message: "Method Not Allowed"
      }, 405);
    }

    let repository = null;
    let workerName = null;
    let botWorkerName = null;
    let repoCreated = false;

    try {
      const body = await request.json();

      const githubToken = String(body.githubToken || "").trim();
      const cloudflareToken = String(body.cloudflareToken || "").trim();
      const accountId = String(body.accountId || "").trim();
      const telegramBotToken = String(body.telegramBotToken || "").trim();
      const telegramAdminId = String(body.telegramAdminId || "").trim();

      if (
        !githubToken ||
        !cloudflareToken ||
        !accountId ||
        !telegramBotToken ||
        !/^-?\d+$/.test(telegramAdminId)
      ) {
        return json({
          success: false,
          message: "همه فیلدها الزامی هستند و شناسه ادمین تلگرام باید عددی باشد."
        }, 400);
      }

      // Validate Cloudflare token
      const tokenCheck = await cf(
        "/user/tokens/verify",
        cloudflareToken
      );

      if (tokenCheck.status !== "active") {
        throw new Error("Cloudflare API Token فعال نیست.");
      }

      // Validate GitHub token
      const userResponse = await github(
        "https://api.github.com/user",
        githubToken
      );

      if (!userResponse.ok) {
        throw new Error(
          "GitHub Token معتبر نیست یا دسترسی کافی ندارد."
        );
      }

      const user = await userResponse.json();
      const owner = user.login;

      // Validate Telegram bot token
      const telegramCheck = await fetch(
        "https://api.telegram.org/bot" +
          telegramBotToken +
          "/getMe"
      );

      const telegramData = await telegramCheck.json();

      if (!telegramCheck.ok || !telegramData.ok) {
        throw new Error("توکن ربات تلگرام معتبر نیست.");
      }

      const botUsername = telegramData.result.username;

      // Check Cloudflare workers.dev subdomain
      const accountInfo = await cf(
        "/accounts/" + accountId + "/workers/subdomain",
        cloudflareToken
      );

      const subdomain = accountInfo.subdomain;

      if (!subdomain) {
        throw new Error(
          "ابتدا workers.dev subdomain را در تنظیمات Cloudflare فعال کن."
        );
      }

      // Generate unique names and credentials
      const repoName = randomHex(6);
      workerName = randomHex(6);
      botWorkerName = randomHex(6);

      const gatewayId = randomHex(6);
      const relaySecret = randomHex(32);
      const webhookSecret = randomHex(32);
      const uuid = crypto.randomUUID();

      // Create GitHub repository
      const createRepo = await github(
        "https://api.github.com/user/repos",
        githubToken,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: repoName,
            description: "Authenticated TCP relay",
            private: false,
            auto_init: true
          })
        }
      );

      if (!createRepo.ok) {
        throw new Error(
          "ساخت مخزن GitHub ناموفق بود: " +
            await createRepo.text()
        );
      }

      repoCreated = true;
      repository =
        "https://github.com/" + owner + "/" + repoName;

      const packageJson = JSON.stringify({
        name: repoName,
        version: "1.0.0",
        private: true,
        type: "module",
        main: "server.js",
        scripts: {
          start: "node server.js"
        },
        engines: {
          node: ">=20"
        }
      }, null, 2);

      const dockerfile = [
        "FROM node:22-alpine",
        "WORKDIR /app",
        "COPY package.json .",
        "COPY server.js .",
        "EXPOSE 443",
        'CMD ["npm", "start"]'
      ].join("\n");

      const railwayJson = JSON.stringify({
        $schema: "https://railway.app/railway.schema.json",
        deploy: {
          startCommand: "npm start",
          restartPolicyType: "ON_FAILURE",
          restartPolicyMaxRetries: 10
        }
      }, null, 2);

      const readme = [
        "# Authenticated TCP Relay",
        "",
        "## Required environment variables",
        "- PORT=443",
        "- RELAY_SECRET: configure in Railway variables; do not commit it.",
        "",
        "## Deployment",
        "1. Deploy this repository to Railway.",
        "2. Set PORT=443 and RELAY_SECRET in Railway variables.",
        "3. Create a Railway TCP Proxy targeting internal port 443.",
        "4. Configure RELAY_HOST and RELAY_PORT in the Gateway.",
        "",
        "Railway service and TCP Proxy creation are manual."
      ].join("\n");

      const files = {
        "server.js": RELAY_SOURCE,
        "package.json": packageJson,
        "Dockerfile": dockerfile,
        "railway.json": railwayJson,
        "README.md": readme
      };

      for (const [path, content] of Object.entries(files)) {
        await putRepoFile(
          owner,
          repoName,
          path,
          content,
          githubToken
        );
      }

      // Deploy Gateway
      await deployWorker(
        accountId,
        cloudflareToken,
        workerName,
        GATEWAY_SOURCE,
        {
          UUID: uuid,
          RELAY_HOST: "SET_AFTER_RAILWAY_DEPLOY",
          RELAY_PORT: "443",
          RELAY_SECRET: relaySecret,
          GATEWAY_ID: gatewayId,
          GATEWAY_REGION: "eu"
        },
        ["RELAY_SECRET"]
      );

      // Deploy Telegram Worker
      await deployWorker(
        accountId,
        cloudflareToken,
        botWorkerName,
        BOT_SOURCE,
        {
          TELEGRAM_BOT_TOKEN: telegramBotToken,
          TELEGRAM_ADMIN_ID: telegramAdminId,
          BOT_WEBHOOK_SECRET: webhookSecret
        },
        [
          "TELEGRAM_BOT_TOKEN",
          "BOT_WEBHOOK_SECRET"
        ]
      );

      const workerUrl =
        "https://" + workerName +
        "." + subdomain + ".workers.dev";

      const botWorkerUrl =
        "https://" + botWorkerName +
        "." + subdomain + ".workers.dev";

      // Configure Telegram webhook
      const webhookResponse = await fetch(
        "https://api.telegram.org/bot" +
          telegramBotToken +
          "/setWebhook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            url: botWorkerUrl + "/telegram-webhook",
            secret_token: webhookSecret,
            allowed_updates: ["message"]
          })
        }
      );

      const webhookData = await webhookResponse.json();

      if (!webhookResponse.ok || !webhookData.ok) {
        throw new Error(
          "ساخت Worker انجام شد، اما تنظیم Webhook ناموفق بود: " +
            (webhookData.description || "خطای نامشخص")
        );
      }

      return json({
        success: true,
        message:
          "مخزن GitHub، Gateway و Worker ربات تلگرام ساخته شدند.",
        repository,
        workerName,
        workerUrl,
        gatewayId,
        uuid,
        botWorkerName,
        botWorkerUrl,
        botUsername,
        requiredRailwayVariables: {
          PORT: "443",
          RELAY_SECRET: relaySecret
        },
        requiredGatewayVariablesAfterRailway: {
          RELAY_HOST: "Railway TCP Proxy hostname, without port",
          RELAY_PORT: "Railway TCP Proxy public port"
        },
        note:
          "Railway و TCP Proxy هنوز باید جداگانه تنظیم شوند. " +
          "ربات هنوز به API مدیریت کاربران و اشتراک‌ها متصل نیست."
      });

    } catch (error) {
      return json({
        success: false,
        message: error?.message || "Installer failed.",
        repositoryMayHaveBeenCreated: repoCreated,
        repository,
        workerName,
        botWorkerName
      }, 500);
    }
  }
};
