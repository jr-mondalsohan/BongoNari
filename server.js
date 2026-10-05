"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8000);
const SESSION_COOKIE = "sunday_supply_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", signature: (image) => image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff }],
  ["image/png", { extension: "png", signature: (image) => image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/webp", { extension: "webp", signature: (image) => image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP" }],
]);
const PASSWORD_BYTES = 64;
const PASSWORD_SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const CATEGORIES = [
  "Home",
  "Wear",
  "Objects",
  "Electronics",
  "Beauty & Personal Care",
  "Footwear",
  "Bags & Accessories",
  "Jewellery",
  "Books & Stationery",
  "Toys & Games",
  "Sports & Outdoors",
  "Grocery & Gourmet",
  "Health & Wellness",
  "Baby & Kids",
  "Kitchen & Dining",
  "Furniture",
  "Art & Crafts",
  "Pet Supplies",
  "Travel",
];
const CATEGORY_SET = new Set(CATEGORIES);
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/assets/bongonari-logo.jpg", ["assets/bongonari-logo.png", "image/png"]],
  ["/assets/bongonari-logo.png", ["assets/bongonari-logo.png", "image/png"]],
  ["/assets/bengali-woman-emblem.svg", ["assets/bongonari-logo.png", "image/png"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/admin.html", ["admin.html", "text/html; charset=utf-8"]],
  ["/admin.css", ["admin.css", "text/css; charset=utf-8"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createStore(dataDirectory, seedProducts) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(dataDirectory, "sunday-supply.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('dev', 'owner')),
      salt BLOB NOT NULL,
      password_hash BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      detail TEXT NOT NULL,
      price REAL NOT NULL CHECK (price > 0),
      badge TEXT NOT NULL,
      image TEXT NOT NULL,
      position TEXT NOT NULL
    );
  `);

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (id, name, category, detail, price, badge, image, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const seed = seedProducts ?? JSON.parse(fs.readFileSync(path.join(__dirname, "products.seed.json"), "utf8"));
  for (const product of seed) {
    insertProduct.run(product.id, product.name, product.category, product.detail, product.price, product.badge, product.image, product.position);
  }

  return db;
}

function productFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    detail: row.detail,
    price: row.price,
    badge: row.badge,
    image: row.image,
    position: row.position,
  };
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new HttpError(400, "Passwords must be between 12 and 128 characters.");
  }
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, PASSWORD_BYTES, PASSWORD_SCRYPT),
  };
}

function validateProduct(body, creating) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Provide product details as a JSON object.");
  }
  const textFields = [
    ["name", 1, 80],
    ["detail", 1, 120],
    ["badge", 0, 24],
  ];
  const product = {};

  for (const [field, minLength, maxLength] of textFields) {
    if (typeof body[field] !== "string" || body[field].trim().length < minLength || body[field].trim().length > maxLength) {
      throw new HttpError(400, `${field} must be between ${minLength} and ${maxLength} characters.`);
    }
    product[field] = body[field].trim();
  }
  if (!CATEGORY_SET.has(body.category)) {
    throw new HttpError(400, "Choose a valid product category.");
  }
  product.category = body.category;

  if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price <= 0 || body.price > 100000) {
    throw new HttpError(400, "Enter a price greater than zero with no more than two decimal places.");
  }
  const priceInCents = Math.round(body.price * 100);
  const roundingError = Math.abs(body.price * 100 - priceInCents);
  if (roundingError > Number.EPSILON * Math.max(1, Math.abs(body.price * 100)) * 2) {
    throw new HttpError(400, "Enter a price greater than zero with no more than two decimal places.");
  }
  product.price = priceInCents / 100;

  if (typeof body.image !== "string" || body.image.length > 500) {
    throw new HttpError(400, "Upload a product picture or provide a valid HTTPS image URL.");
  }
  if (/^\/product-images\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(body.image)) {
    product.image = body.image;
  } else {
    let imageUrl;
    try {
      imageUrl = new URL(body.image);
    } catch {
      throw new HttpError(400, "Upload a product picture or provide a valid HTTPS image URL.");
    }
    if (imageUrl.protocol !== "https:" || !imageUrl.hostname || imageUrl.username || imageUrl.password) {
      throw new HttpError(400, "Product image URLs must use HTTPS.");
    }
    product.image = imageUrl.href;
  }

  if (typeof body.position !== "string" || !/^(?:center|top|bottom|left|right|\d{1,3}%)(?:\s+(?:center|top|bottom|left|right|\d{1,3}%))?$/i.test(body.position)) {
    throw new HttpError(400, "Choose a valid image position.");
  }
  product.position = body.position;
  return product;
}

function requireStoredProductImage(image, dataDirectory) {
  if (!image.startsWith("/product-images/")) return;
  const filename = image.slice("/product-images/".length);
  try {
    fs.accessSync(path.join(dataDirectory, "product-images", filename), fs.constants.R_OK);
  } catch (error) {
    if (error.code === "ENOENT") throw new HttpError(400, "Upload the product picture again; the saved image could not be found.");
    throw error;
  }
}

async function readJson(req) {
  if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Requests must use application/json.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "The request body is too large.");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request body must contain valid JSON.");
  }
}

async function readProductImage(req) {
  const contentType = req.headers["content-type"]?.toLowerCase();
  const imageType = PRODUCT_IMAGE_TYPES.get(contentType);
  if (!imageType) throw new HttpError(415, "Choose a JPEG, PNG, or WebP product picture.");
  const declaredSize = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_PRODUCT_IMAGE_BYTES) {
    throw new HttpError(413, "Product pictures must be 5 MB or smaller.");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PRODUCT_IMAGE_BYTES) {
      throw new HttpError(413, "Product pictures must be 5 MB or smaller.");
    }
    chunks.push(chunk);
  }
  const image = Buffer.concat(chunks);
  if (!imageType.signature(image)) {
    throw new HttpError(400, "The selected file is not a valid image of that type.");
  }
  return { image, imageType };
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https:; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}

function requestProtocol(req) {
  const forwardedProtocol = req.headers["x-forwarded-proto"]?.split(",")[0].trim().toLowerCase();
  return forwardedProtocol === "https" || req.socket.encrypted ? "https:" : "http:";
}

function isLoopbackHost(host) {
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function secureCookieAttribute(req) {
  return requestProtocol(req) === "https:" ? "; Secure" : "";
}

function createApp({ dataDirectory = process.env.BONGONARI_DATA_DIR || path.join(__dirname, "data"), seedProducts } = {}) {
  const db = createStore(dataDirectory, seedProducts);
  const sessions = new Map();
  const loginAttempts = new Map();
  const listProducts = db.prepare("SELECT * FROM products ORDER BY rowid");
  const findProduct = db.prepare("SELECT * FROM products WHERE id = ?");
  const findUser = db.prepare("SELECT username, role, salt, password_hash FROM users WHERE username = ? COLLATE NOCASE");
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users");
  const insertUser = db.prepare("INSERT INTO users (username, role, salt, password_hash) VALUES (?, ?, ?, ?)");
  const insertProduct = db.prepare("INSERT INTO products (id, name, category, detail, price, badge, image, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const updateProduct = db.prepare("UPDATE products SET name=?, category=?, detail=?, price=?, badge=?, image=?, position=? WHERE id=?");

  function currentSession(req) {
    const cookie = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]{64})(?:;|$)`));
    const session = cookie && sessions.get(cookie[1]);
    if (!session || session.expiresAt <= Date.now()) {
      if (cookie) sessions.delete(cookie[1]);
      return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return { ...session, key: cookie[1] };
  }

  function requireSession(session) {
    if (!session) throw new HttpError(401, "Sign in to continue.");
    return session;
  }

  function requireOwner(session) {
    const user = requireSession(session);
    if (user.role !== "owner") throw new HttpError(403, "Only the website owner can manage products.");
    return user;
  }

  async function handle(req, res) {
    setSecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const session = currentSession(req);
    const api = url.pathname.startsWith("/api/");
    if (api && req.method !== "GET" && req.method !== "HEAD") {
      const host = req.headers.host ?? "";
      const protocol = requestProtocol(req);
      let requestOrigin;
      try {
        requestOrigin = new URL(req.headers.origin);
      } catch {
        throw new HttpError(403, "The request origin is not allowed.");
      }
      const localHttp = protocol === "http:" && isLoopbackHost(host);
      if ((!localHttp && protocol !== "https:") || requestOrigin.origin !== `${protocol}//${host}`) {
        throw new HttpError(403, "The request origin is not allowed.");
      }
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(res, 200, {
        setupRequired: userCount.get().count === 0,
        user: session ? { username: session.username, role: session.role } : null,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/products") {
      return json(res, 200, listProducts.all().map(productFromRow), { "Cache-Control": "no-cache" });
    }
    if (req.method === "GET" && url.pathname === "/api/categories") {
      return json(res, 200, CATEGORIES);
    }
    if (req.method === "POST" && url.pathname === "/api/setup") {
      if (userCount.get().count !== 0) throw new HttpError(409, "Initial setup has already been completed.");
      const body = await readJson(req);
      if (typeof body.ownerUsername !== "string" || !/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(body.ownerUsername)) {
        throw new HttpError(400, "Choose an owner username with 3 to 32 letters, numbers, dots, underscores, or hyphens.");
      }
      const ownerUsername = body.ownerUsername.trim();
      if (ownerUsername.toLowerCase() === "dev") {
        throw new HttpError(400, "Choose a different username for the owner; 'dev' is reserved for the developer account.");
      }
      validatePassword(body.ownerPassword);
      const devTemporaryPassword = crypto.randomBytes(24).toString("base64url");
      db.exec("BEGIN IMMEDIATE");
      try {
        if (userCount.get().count !== 0) throw new HttpError(409, "Initial setup has already been completed.");
        const owner = hashPassword(body.ownerPassword);
        const dev = hashPassword(devTemporaryPassword);
        insertUser.run(ownerUsername, "owner", owner.salt, owner.hash);
        insertUser.run("dev", "dev", dev.salt, dev.hash);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const sessionKey = crypto.randomBytes(32).toString("hex");
      const session = { username: ownerUsername, role: "owner", expiresAt: Date.now() + SESSION_TTL_MS };
      sessions.set(sessionKey, session);
      return json(res, 201, {
        user: { username: ownerUsername, role: "owner" },
        devTemporaryPassword,
      }, {
        "Set-Cookie": `${SESSION_COOKIE}=${sessionKey}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureCookieAttribute(req)}`,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/login") {
      const now = Date.now();
      const address = req.socket.remoteAddress ?? "unknown";
      const attempt = loginAttempts.get(address);
      if (attempt && attempt.resetAt <= now) loginAttempts.delete(address);
      const activeAttempt = loginAttempts.get(address);
      if (activeAttempt && activeAttempt.count >= 5) {
        throw new HttpError(429, "Too many sign-in attempts. Wait 15 minutes before trying again.");
      }

      const body = await readJson(req);
      if (typeof body.username !== "string" || typeof body.password !== "string" || body.username.length > 32 || body.password.length > 128) {
        throw new HttpError(400, "Enter a valid username and password.");
      }
      const user = findUser.get(body.username.trim());
      const salt = user?.salt ?? Buffer.alloc(16);
      const expected = user?.password_hash ?? Buffer.alloc(PASSWORD_BYTES);
      const actual = crypto.scryptSync(body.password, salt, PASSWORD_BYTES, PASSWORD_SCRYPT);
      const valid = crypto.timingSafeEqual(actual, expected);
      if (!user || !valid) {
        const failed = loginAttempts.get(address);
        loginAttempts.set(address, {
          count: failed && failed.resetAt > now ? failed.count + 1 : 1,
          resetAt: failed && failed.resetAt > now ? failed.resetAt : now + 15 * 60 * 1000,
        });
        throw new HttpError(401, "Username or password is incorrect.");
      }

      loginAttempts.delete(address);
      const key = crypto.randomBytes(32).toString("hex");
      sessions.set(key, { username: user.username, role: user.role, expiresAt: now + SESSION_TTL_MS });
      return json(res, 200, { user: { username: user.username, role: user.role } }, {
        "Set-Cookie": `${SESSION_COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureCookieAttribute(req)}`,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      if (session) sessions.delete(session.key);
      return json(res, 200, { message: "Signed out." }, {
        "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookieAttribute(req)}`,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/account/password") {
      const user = requireSession(session);
      const body = await readJson(req);
      const account = findUser.get(user.username);
      const currentHash = crypto.scryptSync(String(body.currentPassword ?? ""), account.salt, PASSWORD_BYTES, PASSWORD_SCRYPT);
      if (!crypto.timingSafeEqual(currentHash, account.password_hash)) {
        throw new HttpError(401, "Your current password is incorrect.");
      }
      validatePassword(body.newPassword);
      const changed = hashPassword(body.newPassword);
      db.prepare("UPDATE users SET salt=?, password_hash=? WHERE username=? COLLATE NOCASE").run(changed.salt, changed.hash, user.username);
      for (const [key, activeSession] of sessions) {
        if (activeSession.username === user.username) sessions.delete(key);
      }
      const newSessionKey = crypto.randomBytes(32).toString("hex");
      sessions.set(newSessionKey, { username: user.username, role: user.role, expiresAt: Date.now() + SESSION_TTL_MS });
      return json(res, 200, { message: "Your password has been updated." }, {
        "Set-Cookie": `${SESSION_COOKIE}=${newSessionKey}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureCookieAttribute(req)}`,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/product-images") {
      requireOwner(session);
      const { image, imageType } = await readProductImage(req);
      const filename = `${crypto.randomUUID()}.${imageType.extension}`;
      const imageDirectory = path.join(dataDirectory, "product-images");
      fs.mkdirSync(imageDirectory, { recursive: true });
      fs.writeFileSync(path.join(imageDirectory, filename), image, { flag: "wx" });
      return json(res, 201, { image: `/product-images/${filename}` });
    }
    if (req.method === "POST" && url.pathname === "/api/products") {
      requireOwner(session);
      const product = validateProduct(await readJson(req), true);
      requireStoredProductImage(product.image, dataDirectory);
      product.id = crypto.randomUUID();
      while (findProduct.get(product.id)) product.id = crypto.randomUUID();
      try {
        insertProduct.run(product.id, product.name, product.category, product.detail, product.price, product.badge, product.image, product.position);
      } catch (error) {
        if (error.code === "ERR_SQLITE_ERROR" && String(error.message).includes("UNIQUE")) {
          throw new HttpError(409, "A product with that ID already exists.");
        }
        throw error;
      }
      return json(res, 201, product);
    }

    const productMatch = url.pathname.match(/^\/api\/products\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (req.method === "PUT" && productMatch) {
      requireOwner(session);
      const product = validateProduct(await readJson(req), false);
      requireStoredProductImage(product.image, dataDirectory);
      const result = updateProduct.run(product.name, product.category, product.detail, product.price, product.badge, product.image, product.position, productMatch[1]);
      if (result.changes === 0) throw new HttpError(404, "That product could not be found.");
      return json(res, 200, { id: productMatch[1], ...product });
    }

    if (api) throw new HttpError(404, "That API endpoint could not be found.");
    const uploadedImageMatch = url.pathname.match(/^\/product-images\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/);
    if ((req.method === "GET" || req.method === "HEAD") && uploadedImageMatch) {
      const filename = uploadedImageMatch[1];
      const extension = path.extname(filename);
      const contentType = extension === ".jpg" ? "image/jpeg" : extension === ".png" ? "image/png" : "image/webp";
      let content;
      try {
        content = fs.readFileSync(path.join(dataDirectory, "product-images", filename));
      } catch (error) {
        if (error.code === "ENOENT") throw new HttpError(404, "That product picture could not be found.");
        throw error;
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": content.length,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      return res.end(req.method === "HEAD" ? undefined : content);
    }
    const staticFile = STATIC_FILES.get(url.pathname);
    if ((req.method === "GET" || req.method === "HEAD") && staticFile) {
      const [fileName, contentType] = staticFile;
      const filePath = path.join(__dirname, fileName);
      let content;
      try {
        content = fs.readFileSync(filePath);
      } catch (error) {
        if (error.code === "ENOENT") throw new HttpError(404, "That page could not be found.");
        throw error;
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": content.length,
        "Cache-Control": "no-cache",
      });
      return res.end(req.method === "HEAD" ? undefined : content);
    }
    throw new HttpError(404, "That page could not be found.");
  }

  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      if (error.status) {
        return json(res, error.status, { error: error.message });
      }
      console.error("Unhandled request error:", error);
      return json(res, 500, { error: "The server could not complete this request." });
    });
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(key);
    }
    for (const [key, attempt] of loginAttempts) {
      if (attempt.resetAt <= now) loginAttempts.delete(key);
    }
  }, 15 * 60 * 1000);
  cleanup.unref();
  server.once("close", () => {
    clearInterval(cleanup);
    db.close();
  });

  return { server, db };
}

if (require.main === module) {
  const app = createApp();
  app.server.listen(PORT, HOST, () => {
    console.log(`Bongonari is listening on ${HOST}:${PORT}`);
    if (HOST === "127.0.0.1" && !process.env.BONGONARI_DATA_DIR) {
      console.log("Local development mode: use HTTPS and persistent storage before public deployment.");
    }
    console.log("First visit /admin.html to set the dev and owner passwords.");
  });
  app.server.on("error", (error) => {
    console.error("Could not start the storefront server:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApp };
