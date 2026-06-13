/* FrameUp Pro — full-stack server with auth + admin panel.
   Zero npm dependencies: node:http, node:sqlite, node:crypto (Node 22.5+; tested on Node 24)
   Run with: node server.js */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MAX_BODY = 2.5 * 1024 * 1024; // 2.5 MB — allows PNG overlay frames
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const SESSION_DAYS = 30;

// demo codes accepted by /api/unlock without a purchase (server-side only)
const DEMO_CODES = new Set(["FRAME-PRO-2026"]);

// ---------- database ----------
const dataDir = process.env.DATA_DIR || path.join(ROOT, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "frameup.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pass_hash TEXT,
    google_sub TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    banned INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS frames (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'Anonymous',
    type TEXT NOT NULL CHECK (type IN ('config','png')),
    data TEXT NOT NULL,
    email_gate INTEGER NOT NULL DEFAULT 0,
    owner_key TEXT NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id TEXT NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    ref TEXT,
    unlock_code TEXT,
    created INTEGER NOT NULL
  );
`);

// indexes for fast gallery queries and search
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_frames_downloads ON frames (downloads DESC);
  CREATE INDEX IF NOT EXISTS idx_frames_created   ON frames (created DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires);
  CREATE INDEX IF NOT EXISTS idx_leads_frame      ON leads (frame_id);
`);

// migrations for databases created before auth existed
for (const sql of [
  "ALTER TABLE frames ADD COLUMN user_id INTEGER",
  "ALTER TABLE orders ADD COLUMN user_id INTEGER",
]) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// ---------- rate limiting ----------
const rateLimitStore = new Map();
function rateLimit(ip, max = 10, windowMs = 60_000) {
  const now = Date.now();
  let e = rateLimitStore.get(ip);
  if (!e || now > e.resetAt) e = { count: 0, resetAt: now + windowMs };
  e.count++;
  rateLimitStore.set(ip, e);
  return e.count > max;
}
// prune stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitStore) if (v.resetAt < now) rateLimitStore.delete(k);
}, 5 * 60_000).unref();

// ---------- security headers ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://oauth2.googleapis.com https://accounts.google.com",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

function secHeaders() {
  return {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

// ---------- auth helpers ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + "$" + crypto.scryptSync(pw, salt, 32).toString("hex");
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split("$");
  const candidate = crypto.scryptSync(pw, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(h));
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function createSession(userId) {
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO sessions (token, user_id, created, expires) VALUES (?,?,?,?)")
    .run(token, userId, Date.now(), Date.now() + SESSION_DAYS * 864e5);
  return token;
}
function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || !!req.socket?.encrypted;
}
function sessionCookie(token, clear = false, secure = false) {
  return `fu_session=${clear ? "" : token}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`;
}
function getUser(req) {
  const token = parseCookies(req).fu_session;
  if (!token) return null;
  const row = db.prepare(
    "SELECT u.*, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ).get(token);
  if (!row) return null;
  if (row.expires < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return row;
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, hasGoogle: !!u.google_sub };
}

// seed admin account on first run
if (!db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) {
  db.prepare("INSERT INTO users (email, name, pass_hash, role, banned, created) VALUES (?,?,?,?,0,?)")
    .run("admin@frameup.local", "Admin", hashPassword("admin123"), "admin", Date.now());
  console.log("Seeded admin → admin@frameup.local / admin123  ⚠ Change this in production!");
}

// seed sample community frames on first run
if (db.prepare("SELECT COUNT(*) AS n FROM frames").get().n === 0) {
  const seed = db.prepare(
    "INSERT INTO frames (id, name, author, type, data, email_gate, owner_key, downloads, created) VALUES (?,?,?,?,?,0,?,?,?)"
  );
  const base = {
    ringStyle: "gradient", ringWidth: 70, font: '"Segoe UI", sans-serif',
    textColor: "#ffffff", banner: false, bannerStyle: "pill", bannerText: "",
    pattern: "none", stickers: [], logo: null, emailGate: false,
  };
  const samples = [
    ["Marathon 2026", "City Run Club",
      { ...base, color1: "#0ea5e9", color2: "#22d3ee", topText: "I'M RUNNING", bottomText: "CITY MARATHON 2026", banner: true, bannerText: "🏃 26.2" }, 48],
    ["Food Festival", "Downtown Eats",
      { ...base, color1: "#ea580c", color2: "#facc15", topText: "TASTE THE TOWN", bottomText: "FOOD FEST · JULY", pattern: "dots" }, 31],
    ["Library Week", "Friends of the Library",
      { ...base, ringStyle: "double", color1: "#4338ca", color2: "#a5b4fc", topText: "I LOVE MY LIBRARY", bottomText: "NATIONAL LIBRARY WEEK", stickers: [{ char: "📚", x: 870, y: 210, size: 120 }] }, 17],
  ];
  for (const [name, author, config, downloads] of samples)
    seed.run(newId(), name, author, "config", JSON.stringify(config), newKey(), downloads, Date.now());
}

function newId()  { return crypto.randomBytes(6).toString("base64url"); }
function newKey() { return crypto.randomBytes(18).toString("base64url"); }

// ---------- Nepal payments (eSewa ePay v2 + Khalti ePayment) ----------
const PLANS = {
  pro_unlock:   { label: "FrameUp Pro unlock",   npr: 500 },
  campaign:     { label: "Campaign template",     npr: 3500 },
  campaign_pro: { label: "Campaign Pro template", npr: 7000 },
};
const ESEWA = {
  live: !!process.env.ESEWA_LIVE,
  productCode: process.env.ESEWA_PRODUCT_CODE || "EPAYTEST",
  secret: process.env.ESEWA_SECRET || "8gBm/:&EnhH.1/q",
  formUrl: process.env.ESEWA_LIVE
    ? "https://epay.esewa.com.np/api/epay/main/v2/form"
    : "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
};
const KHALTI_KEY  = process.env.KHALTI_SECRET_KEY || "";
const KHALTI_BASE = process.env.KHALTI_LIVE ? "https://khalti.com/api/v2" : "https://dev.khalti.com/api/v2";

function esewaSign(fields, names) {
  const msg = names.map(n => `${n}=${fields[n]}`).join(",");
  return crypto.createHmac("sha256", ESEWA.secret).update(msg).digest("base64");
}
function newUnlockCode() {
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `FRAME-${part()}-${part()}`;
}
function markOrderPaid(orderId, ref) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  if (!order) return null;
  if (order.status === "paid") return order; // idempotent
  const unlock = order.plan === "pro_unlock" ? newUnlockCode() : null;
  db.prepare("UPDATE orders SET status = 'paid', ref = ?, unlock_code = ? WHERE id = ?")
    .run(ref || null, unlock, orderId);
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
}

// ---------- response helpers ----------
function json(res, code, obj, extraHeaders = {}) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    ...secHeaders(),
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}
function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}
function publicFrame(row) {
  const f = {
    id: row.id, serverId: row.id, name: row.name, author: row.author,
    type: row.type, emailGate: !!row.email_gate, downloads: row.downloads, created: row.created,
  };
  if (row.type === "config") f.config = JSON.parse(row.data);
  else f.dataUrl = row.data;
  return f;
}
function canManageFrame(req, row, url) {
  if (url && url.searchParams.get("key") === row.owner_key) return true; // legacy key
  if (!req.user) return false;
  return req.user.role === "admin" || (row.user_id != null && row.user_id === req.user.id);
}

// ---------- API routes ----------
const api = {

  // ----- health check (public) -----
  "GET /health": (_req, res) => {
    json(res, 200, { status: "ok", ts: Date.now(), uptime: Math.floor(process.uptime()) });
  },

  // ----- auth (public) -----
  "GET /api/auth/config": (_req, res) => {
    json(res, 200, { google: GOOGLE_CLIENT_ID || null });
  },

  "POST /api/auth/register": async (req, res) => {
    const b = await readBody(req);
    const email = String(b.email || "").trim().toLowerCase();
    const name  = String(b.name  || "").trim().slice(0, 60);
    const pw    = String(b.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "bad_email" });
    if (!name)       return json(res, 400, { error: "name_required" });
    if (pw.length < 6) return json(res, 400, { error: "weak_password" });
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) return json(res, 409, { error: "email_taken" });
    db.prepare("INSERT INTO users (email, name, pass_hash, role, banned, created) VALUES (?,?,?,'user',0,?)")
      .run(email, name, hashPassword(pw), Date.now());
    const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    json(res, 201, publicUser(u), { "Set-Cookie": sessionCookie(createSession(u.id), false, isSecureRequest(req)) });
  },

  "POST /api/auth/login": async (req, res) => {
    const b = await readBody(req);
    const email = String(b.email || "").trim().toLowerCase();
    const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!u || !checkPassword(String(b.password || ""), u.pass_hash))
      return json(res, 401, { error: "bad_credentials" });
    if (u.banned) return json(res, 403, { error: "banned" });
    json(res, 200, publicUser(u), { "Set-Cookie": sessionCookie(createSession(u.id), false, isSecureRequest(req)) });
  },

  "POST /api/auth/google": async (req, res) => {
    if (!GOOGLE_CLIENT_ID) return json(res, 503, { error: "google_not_configured" });
    const b = await readBody(req);
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(b.credential || ""));
    if (!r.ok) return json(res, 401, { error: "bad_token" });
    const info = await r.json();
    if (info.aud !== GOOGLE_CLIENT_ID) return json(res, 401, { error: "bad_audience" });
    let u = db.prepare("SELECT * FROM users WHERE google_sub = ? OR email = ?").get(info.sub, info.email);
    if (!u) {
      db.prepare("INSERT INTO users (email, name, google_sub, role, banned, created) VALUES (?,?,?,'user',0,?)")
        .run(info.email, info.name || info.email, info.sub, Date.now());
      u = db.prepare("SELECT * FROM users WHERE email = ?").get(info.email);
    } else if (!u.google_sub) {
      db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(info.sub, u.id);
    }
    if (u.banned) return json(res, 403, { error: "banned" });
    json(res, 200, publicUser(u), { "Set-Cookie": sessionCookie(createSession(u.id), false, isSecureRequest(req)) });
  },

  "POST /api/auth/logout": (req, res) => {
    const token = parseCookies(req).fu_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", true, isSecureRequest(req)) });
  },

  "GET /api/auth/me": (req, res) => {
    const u = getUser(req);
    if (!u) return json(res, 401, { error: "auth_required" });
    if (u.banned) return json(res, 403, { error: "banned" });
    json(res, 200, publicUser(u));
  },

  // ----- frames (auth required — enforced globally) -----
  "GET /api/frames": (req, res, _m, url) => {
    const sort = url.searchParams.get("sort") === "recent" ? "created DESC" : "downloads DESC";
    const q = (url.searchParams.get("q") || "").trim();
    const rows = q
      ? db.prepare(`SELECT * FROM frames WHERE name LIKE ? OR author LIKE ? ORDER BY ${sort} LIMIT 60`)
          .all(`%${q}%`, `%${q}%`)
      : db.prepare(`SELECT * FROM frames ORDER BY ${sort} LIMIT 60`).all();
    json(res, 200, rows.map(publicFrame));
  },

  "GET /api/my/frames": (req, res) => {
    const rows = db.prepare("SELECT * FROM frames WHERE user_id = ? ORDER BY created DESC").all(req.user.id);
    const leadStmt = db.prepare("SELECT name, email, ts FROM leads WHERE frame_id = ? ORDER BY ts DESC");
    json(res, 200, rows.map(r => ({ ...publicFrame(r), leads: leadStmt.all(r.id) })));
  },

  "GET /api/frames/:id": (req, res, m) => {
    const row = db.prepare("SELECT * FROM frames WHERE id = ?").get(m[1]);
    if (!row) return json(res, 404, { error: "not_found" });
    json(res, 200, publicFrame(row));
  },

  "POST /api/frames": async (req, res) => {
    const b = await readBody(req);
    const name   = String(b.name   || "").trim().slice(0, 60);
    const author = (String(b.author || "").trim() || req.user.name).slice(0, 40);
    if (!name) return json(res, 400, { error: "name_required" });
    let type, data;
    if (b.type === "png" && typeof b.dataUrl === "string" && b.dataUrl.startsWith("data:image/png")) {
      type = "png"; data = b.dataUrl;
    } else if (b.type === "config" && b.config && typeof b.config === "object") {
      type = "config"; data = JSON.stringify(b.config);
    } else {
      return json(res, 400, { error: "bad_frame" });
    }
    if (data.length > MAX_BODY) return json(res, 413, { error: "too_large" });
    const id = newId(), key = newKey();
    db.prepare(
      "INSERT INTO frames (id, name, author, type, data, email_gate, owner_key, downloads, created, user_id) VALUES (?,?,?,?,?,?,?,0,?,?)"
    ).run(id, name, author, type, data, b.emailGate ? 1 : 0, key, Date.now(), req.user.id);
    json(res, 201, { id, ownerKey: key });
  },

  "POST /api/frames/:id/download": (req, res, m) => {
    const r = db.prepare("UPDATE frames SET downloads = downloads + 1 WHERE id = ?").run(m[1]);
    if (r.changes === 0) return json(res, 404, { error: "not_found" });
    json(res, 200, { downloads: db.prepare("SELECT downloads FROM frames WHERE id = ?").get(m[1]).downloads });
  },

  "POST /api/frames/:id/leads": async (req, res, m) => {
    const row = db.prepare("SELECT id FROM frames WHERE id = ?").get(m[1]);
    if (!row) return json(res, 404, { error: "not_found" });
    const b = await readBody(req);
    const email = String(b.email || "").trim().slice(0, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "bad_email" });
    db.prepare("INSERT INTO leads (frame_id, name, email, ts) VALUES (?,?,?,?)")
      .run(m[1], String(b.name || "").trim().slice(0, 80), email, Date.now());
    json(res, 201, { ok: true });
  },

  "GET /api/frames/:id/leads": (req, res, m, url) => {
    const row = db.prepare("SELECT * FROM frames WHERE id = ?").get(m[1]);
    if (!row) return json(res, 404, { error: "not_found" });
    if (!canManageFrame(req, row, url)) return json(res, 403, { error: "forbidden" });
    json(res, 200, db.prepare("SELECT name, email, ts FROM leads WHERE frame_id = ? ORDER BY ts DESC").all(m[1]));
  },

  "DELETE /api/frames/:id": (req, res, m, url) => {
    const row = db.prepare("SELECT * FROM frames WHERE id = ?").get(m[1]);
    if (!row) return json(res, 404, { error: "not_found" });
    if (!canManageFrame(req, row, url)) return json(res, 403, { error: "forbidden" });
    db.prepare("DELETE FROM leads WHERE frame_id = ?").run(m[1]);
    db.prepare("DELETE FROM frames WHERE id = ?").run(m[1]);
    json(res, 200, { ok: true });
  },

  // ----- payments -----
  "GET /api/pay/config": (_req, res) => {
    json(res, 200, { esewa: true, khalti: !!KHALTI_KEY, mode: ESEWA.live ? "live" : "test", plans: PLANS });
  },

  "POST /api/pay/initiate": async (req, res) => {
    const b    = await readBody(req);
    const plan = PLANS[b.plan];
    if (!plan) return json(res, 400, { error: "bad_plan" });
    const origin  = `http://${req.headers.host}`;
    const orderId = crypto.randomBytes(8).toString("hex");

    if (b.provider === "esewa") {
      db.prepare("INSERT INTO orders (id, plan, amount, provider, status, created, user_id) VALUES (?,?,?,?,'pending',?,?)")
        .run(orderId, b.plan, plan.npr, "esewa", Date.now(), req.user.id);
      const fields = {
        amount: String(plan.npr), tax_amount: "0", total_amount: String(plan.npr),
        transaction_uuid: orderId, product_code: ESEWA.productCode,
        product_service_charge: "0", product_delivery_charge: "0",
        success_url: `${origin}/api/pay/esewa/callback`,
        failure_url: `${origin}/?payfail=${orderId}`,
        signed_field_names: "total_amount,transaction_uuid,product_code",
      };
      fields.signature = esewaSign(fields, fields.signed_field_names.split(","));
      return json(res, 200, { provider: "esewa", orderId, action: ESEWA.formUrl, fields });
    }

    if (b.provider === "khalti") {
      if (!KHALTI_KEY) return json(res, 503, { error: "khalti_not_configured" });
      db.prepare("INSERT INTO orders (id, plan, amount, provider, status, created, user_id) VALUES (?,?,?,?,'pending',?,?)")
        .run(orderId, b.plan, plan.npr, "khalti", Date.now(), req.user.id);
      const r = await fetch(`${KHALTI_BASE}/epayment/initiate/`, {
        method: "POST",
        headers: { Authorization: `Key ${KHALTI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          return_url: `${origin}/api/pay/khalti/callback`, website_url: origin,
          amount: plan.npr * 100, purchase_order_id: orderId, purchase_order_name: plan.label,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.payment_url) return json(res, 502, { error: "khalti_initiate_failed", detail: data });
      db.prepare("UPDATE orders SET ref = ? WHERE id = ?").run(data.pidx || null, orderId);
      return json(res, 200, { provider: "khalti", orderId, paymentUrl: data.payment_url });
    }

    json(res, 400, { error: "bad_provider" });
  },

  "GET /api/pay/esewa/callback": (req, res, _m, url) => {
    try {
      const payload = JSON.parse(Buffer.from(url.searchParams.get("data") || "", "base64").toString("utf8"));
      const names   = String(payload.signed_field_names || "").split(",");
      if (payload.signature !== esewaSign(payload, names)) return redirect(res, "/?payfail=signature");
      if (payload.status !== "COMPLETE") return redirect(res, `/?payfail=${encodeURIComponent(payload.status)}`);
      const order = markOrderPaid(payload.transaction_uuid, payload.transaction_code);
      if (!order) return redirect(res, "/?payfail=unknown_order");
      redirect(res, `/?order=${order.id}`);
    } catch { redirect(res, "/?payfail=bad_callback"); }
  },

  "GET /api/pay/khalti/callback": async (req, res, _m, url) => {
    const pidx    = url.searchParams.get("pidx");
    const orderId = url.searchParams.get("purchase_order_id");
    if (!pidx || !orderId || !KHALTI_KEY) return redirect(res, "/?payfail=bad_callback");
    try {
      const r = await fetch(`${KHALTI_BASE}/epayment/lookup/`, {
        method: "POST",
        headers: { Authorization: `Key ${KHALTI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pidx }),
      });
      const data = await r.json();
      if (data.status !== "Completed")
        return redirect(res, `/?payfail=${encodeURIComponent(data.status || "lookup_failed")}`);
      const order = markOrderPaid(orderId, pidx);
      if (!order) return redirect(res, "/?payfail=unknown_order");
      redirect(res, `/?order=${order.id}`);
    } catch { redirect(res, "/?payfail=lookup_error"); }
  },

  "GET /api/orders/:id": (req, res, m) => {
    const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(m[1]);
    if (!o) return json(res, 404, { error: "not_found" });
    // only the order's owner or an admin may read it
    const isOwner = o.user_id != null && o.user_id === req.user.id;
    if (!isOwner && req.user.role !== "admin") return json(res, 403, { error: "forbidden" });
    json(res, 200, {
      id: o.id, plan: o.plan, amount: o.amount, provider: o.provider,
      status: o.status, unlockCode: o.status === "paid" ? o.unlock_code : null,
    });
  },

  "POST /api/unlock": async (req, res) => {
    const b    = await readBody(req);
    const code = String(b.code || "").trim().toUpperCase();
    if (DEMO_CODES.has(code)) return json(res, 200, { ok: true });
    const row = db.prepare("SELECT id FROM orders WHERE unlock_code = ? AND status = 'paid'").get(code);
    if (!row) return json(res, 404, { error: "invalid_code" });
    json(res, 200, { ok: true });
  },

  // ----- admin panel (role = admin, enforced globally) -----
  "GET /api/admin/stats": (_req, res) => {
    json(res, 200, {
      users:      db.prepare("SELECT COUNT(*) n FROM users").get().n,
      banned:     db.prepare("SELECT COUNT(*) n FROM users WHERE banned = 1").get().n,
      frames:     db.prepare("SELECT COUNT(*) n FROM frames").get().n,
      downloads:  db.prepare("SELECT COALESCE(SUM(downloads),0) n FROM frames").get().n,
      leads:      db.prepare("SELECT COUNT(*) n FROM leads").get().n,
      orders:     db.prepare("SELECT COUNT(*) n FROM orders").get().n,
      revenueNpr: db.prepare("SELECT COALESCE(SUM(amount),0) n FROM orders WHERE status = 'paid'").get().n,
    });
  },

  "GET /api/admin/users": (req, res, _m, url) => {
    const q = (url.searchParams.get("q") || "").trim();
    const sql = `
      SELECT u.id, u.email, u.name, u.role, u.banned, u.created, u.google_sub,
        (SELECT COUNT(*) FROM frames f WHERE f.user_id = u.id) AS frames
      FROM users u ${q ? "WHERE u.email LIKE ? OR u.name LIKE ?" : ""}
      ORDER BY u.created DESC LIMIT 200`;
    const rows = q ? db.prepare(sql).all(`%${q}%`, `%${q}%`) : db.prepare(sql).all();
    json(res, 200, rows.map(u => ({ ...u, banned: !!u.banned, hasGoogle: !!u.google_sub, google_sub: undefined })));
  },

  "POST /api/admin/users/:id": async (req, res, m) => {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(+m[1]);
    if (!target) return json(res, 404, { error: "not_found" });
    if (target.id === req.user.id) return json(res, 400, { error: "cannot_modify_self" });
    const b = await readBody(req);
    const actions = {
      ban:     () => db.prepare("UPDATE users SET banned = 1 WHERE id = ?").run(target.id),
      unban:   () => db.prepare("UPDATE users SET banned = 0 WHERE id = ?").run(target.id),
      promote: () => db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(target.id),
      demote:  () => db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(target.id),
    };
    if (!actions[b.action]) return json(res, 400, { error: "bad_action" });
    actions[b.action]();
    if (b.action === "ban") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    json(res, 200, { ok: true });
  },

  "DELETE /api/admin/users/:id": (req, res, m) => {
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(+m[1]);
    if (!target) return json(res, 404, { error: "not_found" });
    if (target.id === req.user.id) return json(res, 400, { error: "cannot_modify_self" });
    db.prepare("DELETE FROM leads WHERE frame_id IN (SELECT id FROM frames WHERE user_id = ?)").run(target.id);
    db.prepare("DELETE FROM frames WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
    json(res, 200, { ok: true });
  },

  "GET /api/admin/frames": (_req, res) => {
    const rows = db.prepare(`
      SELECT f.id, f.name, f.author, f.type, f.email_gate, f.downloads, f.created,
        u.email AS owner_email,
        (SELECT COUNT(*) FROM leads l WHERE l.frame_id = f.id) AS leads
      FROM frames f LEFT JOIN users u ON u.id = f.user_id
      ORDER BY f.created DESC LIMIT 500`).all();
    json(res, 200, rows.map(r => ({ ...r, email_gate: !!r.email_gate })));
  },

  "DELETE /api/admin/frames/:id": (_req, res, m) => {
    db.prepare("DELETE FROM leads WHERE frame_id = ?").run(m[1]);
    const r = db.prepare("DELETE FROM frames WHERE id = ?").run(m[1]);
    if (r.changes === 0) return json(res, 404, { error: "not_found" });
    json(res, 200, { ok: true });
  },

  "GET /api/admin/orders": (_req, res) => {
    const rows = db.prepare(`
      SELECT o.*, u.email AS user_email FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      ORDER BY o.created DESC LIMIT 500`).all();
    json(res, 200, rows);
  },

  "GET /api/admin/leads": (_req, res) => {
    const rows = db.prepare(`
      SELECT l.name, l.email, l.ts, f.name AS frame_name FROM leads l
      JOIN frames f ON f.id = l.frame_id
      ORDER BY l.ts DESC LIMIT 500`).all();
    json(res, 200, rows);
  },
};

const apiRoutes = Object.entries(api).map(([k, handler]) => {
  const [method, pattern] = k.split(" ");
  const regex = new RegExp("^" + pattern.replace(/:id/g, "([A-Za-z0-9_-]+)") + "$");
  return { method, regex, handler };
});

function isPublicRoute(method, p) {
  if (p === "/health") return true;
  if (p.startsWith("/api/auth/")) return true;
  if (p === "/api/pay/config") return true;
  if (p === "/api/pay/esewa/callback" || p === "/api/pay/khalti/callback") return true;
  return false;
}

function isRateLimitedRoute(method, p) {
  return method === "POST" &&
    (p === "/api/auth/login" || p === "/api/auth/register" || p === "/api/auth/google");
}

// ---------- static files ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico":  "image/x-icon", ".json": "application/json",
};
// README.md intentionally excluded — contains default admin credentials
const STATIC_FILES = new Set(["index.html", "app.js", "styles.css", "admin.html", "admin.js"]);

function serveStatic(res, file) {
  const full = path.join(ROOT, file);
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, secHeaders()); res.end("Not found"); return; }
    const ext = path.extname(file);
    const cacheControl = "no-cache";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cacheControl,
      ...secHeaders(),
    });
    res.end(buf);
  });
}

// ---------- HTTP server ----------
const server = http.createServer(async (req, res) => {
  const t0  = Date.now();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p   = url.pathname;
  const ip  = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
              || req.socket?.remoteAddress || "?";

  try {
    if (p.startsWith("/api/") || p === "/health") {
      // rate-limit auth mutation routes
      if (isRateLimitedRoute(req.method, p) && rateLimit(ip, 20)) {
        console.warn(`[rate-limit] ${ip} → ${p}`);
        return json(res, 429, { error: "too_many_requests", retryAfter: 60 });
      }

      // auth guard — everything except public routes requires a session
      if (!isPublicRoute(req.method, p)) {
        req.user = getUser(req);
        if (!req.user) return json(res, 401, { error: "auth_required" });
        if (req.user.banned) return json(res, 403, { error: "banned" });
        if (p.startsWith("/api/admin/") && req.user.role !== "admin")
          return json(res, 403, { error: "admin_only" });
      }

      for (const r of apiRoutes) {
        const m = p.match(r.regex);
        if (m && req.method === r.method) {
          await r.handler(req, res, m, url);
          console.log(`${req.method} ${p} ${res.statusCode} ${Date.now() - t0}ms`);
          return;
        }
      }
      return json(res, 404, { error: "no_such_route" });
    }

    // static routing
    if (p === "/" || /^\/f\/[A-Za-z0-9_-]+$/.test(p)) return serveStatic(res, "index.html");
    if (p === "/admin") return serveStatic(res, "admin.html");
    const file = p.slice(1);
    if (STATIC_FILES.has(file)) return serveStatic(res, file);
    res.writeHead(404, secHeaders()); res.end("Not found");

  } catch (e) {
    if (e.message === "too_large") return json(res, 413, { error: "too_large" });
    if (e.message === "bad_json")  return json(res, 400, { error: "bad_json" });
    console.error("Unhandled error:", e);
    json(res, 500, { error: "server_error" });
  }
});

server.listen(PORT, () => {
  console.log(`FrameUp Pro → http://localhost:${PORT}`);
  console.log(`Admin panel → http://localhost:${PORT}/admin`);
});

// graceful shutdown
function shutdown(sig) {
  console.log(`\n${sig} — closing server…`);
  server.close(() => { console.log("Done."); process.exit(0); });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
