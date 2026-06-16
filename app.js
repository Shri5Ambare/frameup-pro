/* FrameUp Pro — client-side profile frame & social graphics generator.
   Everything (photo, merge, export) happens in the browser; no uploads. */

const BASE = 1080; // design coordinate space; frames are authored at 1080×1080

const FORMATS = [
  { id: "fb",    name: "FB Profile",  w: 1080, h: 1080, circle: true  },
  { id: "wa",    name: "WhatsApp DP", w: 640,  h: 640,  circle: true  },
  { id: "ig",    name: "IG Post",     w: 1080, h: 1080, circle: false },
  { id: "story", name: "Story",       w: 1080, h: 1920, circle: false },
  { id: "cover", name: "FB Cover",    w: 1640, h: 856,  circle: false },
];

const STICKER_SET = ["⭐", "❤️", "🔥", "🎉", "🗳️", "🎓", "🏆", "🎈", "✊", "🌟", "🇺🇸", "🙏"];

// ---------- state ----------
const state = {
  photo: null,
  zoom: 1,
  rotation: 0,
  flip: false,
  offsetX: 0,
  offsetY: 0,
  filters: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0 },
  selectedFrameId: null,
  format: FORMATS[0],
  isPro: localStorage.getItem("frameup_pro") === "1",
};

// ---------- built-in frames ----------
function cfg(extra) {
  return Object.assign({
    ringStyle: "gradient", color1: "#1d4ed8", color2: "#dc2626", ringWidth: 70,
    topText: "", bottomText: "", font: '"Segoe UI", sans-serif', textColor: "#ffffff",
    banner: false, bannerStyle: "pill", bannerText: "",
    pattern: "none", stickers: [], logo: null, emailGate: false,
  }, extra);
}

const BUILTIN_FRAMES = [
  { id: "vote2026", name: "Vote 2026", type: "config",
    config: cfg({ topText: "I'M VOTING", bottomText: "ELECTION 2026", banner: true, bannerText: "VOTE" }) },
  { id: "grad2026", name: "Class of 2026", type: "config",
    config: cfg({ color1: "#7c3aed", color2: "#f59e0b", topText: "PROUD GRADUATE", bottomText: "CLASS OF 2026", banner: true, bannerText: "🎓 GRAD", stickers: [{ char: "🎓", x: 870, y: 210, size: 130 }] }) },
  { id: "festival", name: "Spring Festival", type: "config",
    config: cfg({ color1: "#f43f5e", color2: "#fb923c", ringWidth: 64, topText: "SPRING FESTIVAL", bottomText: "SEE YOU THERE!", textColor: "#fff7ed", pattern: "sparkle" }) },
  { id: "supporter", name: "Team Supporter", type: "config",
    config: cfg({ ringStyle: "double", color1: "#059669", color2: "#10b981", topText: "PROUD SUPPORTER", bottomText: "GO TEAM GO", textColor: "#ecfdf5", banner: true, bannerText: "#1 FAN" }) },
  { id: "elegant", name: "Elegant Gold", type: "config",
    config: cfg({ color1: "#b45309", color2: "#fbbf24", ringWidth: 46, pattern: "dots" }) },
];

function loadCustomFrames() {
  try { return JSON.parse(localStorage.getItem("frameup_frames") || "[]"); }
  catch { return []; }
}
function saveCustomFrames(frames) {
  localStorage.setItem("frameup_frames", JSON.stringify(frames));
}
function allFrames() { return [...BUILTIN_FRAMES, ...loadCustomFrames()]; }

// frames fetched from the server (community gallery / short links), keyed by id
const serverFrames = {};
function getFrame(id) { return allFrames().find(f => f.id === id) || serverFrames[id] || null; }

// ---------- backend API ----------
const API_OK = location.protocol.startsWith("http");
async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("http_" + res.status));
  return data;
}

// legacy pre-auth ownership map (kept so old published frames still show)
function loadOwned() {
  try { return JSON.parse(localStorage.getItem("frameup_owned") || "{}"); }
  catch { return {}; }
}
function saveOwned(map) { localStorage.setItem("frameup_owned", JSON.stringify(map)); }

// ---------- auth ----------
let currentUser = null;
let authMode = "login";

const AUTH_ERRORS = {
  bad_credentials: "Wrong email or password.",
  email_taken: "That email already has an account — try logging in.",
  weak_password: "Password must be at least 6 characters.",
  bad_email: "That doesn't look like a valid email.",
  name_required: "Please enter your name.",
  banned: "This account has been suspended.",
};

function setAuthMode(mode) {
  authMode = mode;
  document.getElementById("tabLogin").classList.toggle("selected", mode === "login");
  document.getElementById("tabSignup").classList.toggle("selected", mode === "signup");
  document.getElementById("authName").hidden = mode === "login";
  document.getElementById("authTitle").textContent = mode === "login" ? "Welcome back" : "Create your account";
  document.getElementById("authSubmit").textContent = mode === "login" ? "Log in" : "Sign up";
  document.getElementById("authError").textContent = "";
}

async function submitAuth() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPass").value;
  const name = document.getElementById("authName").value.trim();
  const errEl = document.getElementById("authError");
  const btn = document.getElementById("authSubmit");
  errEl.textContent = "";
  btn.classList.add("loading");
  btn.textContent = authMode === "login" ? "Logging in…" : "Creating account…";
  try {
    currentUser = await api(authMode === "login" ? "/auth/login" : "/auth/register", {
      method: "POST",
      body: authMode === "login" ? { email, password } : { name, email, password },
    });
    await onAuthed();
  } catch (e) {
    errEl.textContent = AUTH_ERRORS[e.message] || "Something went wrong (" + e.message + ").";
    btn.classList.remove("loading");
    btn.textContent = authMode === "login" ? "Log in" : "Create account";
  }
}

async function onAuthed() {
  document.body.classList.remove("supporter-mode");
  document.getElementById("authOverlay").hidden = true;
  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn) loginBtn.hidden = true;
  document.getElementById("userChip").hidden = false;
  document.getElementById("userName").textContent = currentUser.name;
  document.getElementById("userAvatar").textContent = (currentUser.name[0] || "?").toUpperCase();
  document.getElementById("adminLink").hidden = currentUser.role !== "admin";
  await handlePaymentReturn();
  await loadSharedServerFrame();
}

function showAuthOverlay() {
  document.getElementById("authOverlay").hidden = false;
  setAuthMode("login");
  initGoogleButton();
}

async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* session already gone */ }
  location.href = "/";
}

let googleInited = false;
async function initGoogleButton() {
  if (googleInited || !API_OK) return;
  googleInited = true;
  try {
    const c = await api("/auth/config");
    if (!c.google) {
      document.getElementById("googleHint").textContent =
        "Google sign-in is not configured yet (set GOOGLE_CLIENT_ID on the server to enable it).";
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: c.google,
        callback: async resp => {
          try {
            currentUser = await api("/auth/google", { method: "POST", body: { credential: resp.credential } });
            await onAuthed();
          } catch (e) {
            document.getElementById("authError").textContent =
              AUTH_ERRORS[e.message] || "Google sign-in failed (" + e.message + ").";
          }
        },
      });
      google.accounts.id.renderButton(document.getElementById("gbtn"), { theme: "outline", size: "large", width: 330 });
    };
    document.head.appendChild(s);
  } catch { /* server unreachable; overlay still shows */ }
}

document.getElementById("authPass").addEventListener("keydown", e => {
  if (e.key === "Enter") submitAuth();
});

// image caches (PNG overlays + logos), keyed by an id — LRU capped at 60 entries
const imgCache = {};
const imgCacheOrder = [];
const IMG_CACHE_MAX = 60;
function getCachedImage(key, src, onReady) {
  if (imgCache[key]) return imgCache[key];
  if (imgCacheOrder.length >= IMG_CACHE_MAX) {
    const evict = imgCacheOrder.shift();
    delete imgCache[evict];
  }
  const img = new Image();
  img.onload = () => { if (onReady) onReady(); };
  img.src = src;
  imgCache[key] = img;
  imgCacheOrder.push(key);
  return img;
}

// ---------- frame drawing (always in 1080-space, scaled via ctx transform) ----------
function drawConfigFrame(ctx, size, config, onAsyncReady) {
  const k = size / BASE;
  ctx.save();
  ctx.scale(k, k);
  const c = BASE / 2;
  const rw = config.ringWidth;

  // ring
  let stroke;
  if (config.ringStyle === "solid") {
    stroke = config.color1;
  } else {
    const grad = ctx.createLinearGradient(0, 0, BASE, BASE);
    grad.addColorStop(0, config.color1);
    grad.addColorStop(1, config.color2);
    stroke = grad;
  }
  ctx.beginPath();
  ctx.arc(c, c, c - rw / 2, 0, Math.PI * 2);
  ctx.lineWidth = rw;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  if (config.ringStyle === "double") {
    ctx.beginPath();
    ctx.arc(c, c, c - rw - 14, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = config.color2;
    ctx.stroke();
  }

  // pattern decorations along the ring centerline
  if (config.pattern !== "none") {
    const pr = c - rw / 2;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `${rw * 0.5}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = c + Math.cos(a) * pr, y = c + Math.sin(a) * pr;
      if (config.pattern === "dots") {
        ctx.beginPath();
        ctx.arc(x, y, rw * 0.1, 0, Math.PI * 2);
        ctx.fill();
      } else if (config.pattern === "sparkle" && i % 2 === 0) {
        ctx.fillText("✦", x, y);
      }
    }
    ctx.restore();
  }

  // arc text
  const textR = c - rw / 2;
  const fontPx = Math.max(rw * 0.52, 18);
  if (config.topText) drawArcText(ctx, config.topText, c, c, textR, fontPx, config.textColor, config.font, true);
  if (config.bottomText) drawArcText(ctx, config.bottomText, c, c, textR, fontPx, config.textColor, config.font, false);

  // banner
  if (config.banner && config.bannerText) {
    const bw = BASE * 0.46, bh = BASE * 0.115;
    const bx = c - bw / 2, by = BASE - bh * 1.18;
    ctx.save();
    ctx.fillStyle = config.color2;
    if (config.bannerStyle === "ribbon") {
      const notch = bh * 0.45;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw - notch, by + bh / 2);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx, by + bh);
      ctx.lineTo(bx + notch, by + bh / 2);
      ctx.closePath();
      ctx.fill();
    } else {
      roundRect(ctx, bx, by, bw, bh, bh / 2);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
    ctx.fillStyle = config.textColor;
    ctx.font = `800 ${bh * 0.5}px ${config.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(config.bannerText, c, by + bh / 2 + bh * 0.03);
    ctx.restore();
  }

  // stickers
  for (const s of (config.stickers || [])) {
    ctx.save();
    ctx.font = `${s.size}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.char, s.x, s.y);
    ctx.restore();
  }

  // logo
  if (config.logo && config.logo.dataUrl) {
    const img = getCachedImage("logo_" + (config.logo.key || "x"), config.logo.dataUrl, onAsyncReady);
    if (img.complete && img.naturalWidth) {
      const lw = config.logo.size;
      const lh = lw * (img.naturalHeight / img.naturalWidth);
      ctx.drawImage(img, config.logo.x - lw / 2, config.logo.y - lh / 2, lw, lh);
    }
  }

  ctx.restore();
}

function drawArcText(ctx, text, cx, cy, radius, fontPx, color, font, isTop) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `700 ${fontPx}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const chars = [...text];
  let totalWidth = 0;
  for (const ch of chars) totalWidth += ctx.measureText(ch).width;
  const letterSpacing = fontPx * 0.12;
  totalWidth += letterSpacing * (chars.length - 1);
  const totalAngle = totalWidth / radius;
  let angle = isTop ? -Math.PI / 2 - totalAngle / 2 : Math.PI / 2 + totalAngle / 2;
  for (const ch of chars) {
    const w = ctx.measureText(ch).width;
    const half = (w + letterSpacing) / 2 / radius;
    angle += isTop ? half : -half;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.rotate(angle + (isTop ? Math.PI / 2 : -Math.PI / 2));
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle += isTop ? half : -half;
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawFrame(ctx, size, frame, onAsyncReady) {
  if (!frame) return;
  if (frame.type === "config") {
    drawConfigFrame(ctx, size, frame.config, onAsyncReady);
  } else if (frame.type === "png") {
    const img = getCachedImage("png_" + frame.id, frame.dataUrl, onAsyncReady);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, size, size);
  } else if (frame.type === "custom") {
    drawCustomElements(ctx, size, frame.elements || [], onAsyncReady);
  }
}

// Resolve a fill style (solid or gradient) in local centered space (origin = shape center).
function ceFillStyle(ctx, el, w, h) {
  if (el.fillType === "gradient") {
    const a = (el.gradAngle || 0) * Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const g = ctx.createLinearGradient(-dx * w / 2, -dy * h / 2, dx * w / 2, dy * h / 2);
    g.addColorStop(0, el.fill || "#5b5bf0");
    g.addColorStop(1, el.fill2 || el.fill || "#c026d3");
    return g;
  }
  return el.fill || "#5b5bf0";
}

// Trace a centered shape path (origin at center) sized w×h into the current path.
function ceShapePath(ctx, kind, w, h, cornerR) {
  const hw = w / 2, hh = h / 2;
  ctx.beginPath();
  if (kind === "rect") {
    roundRect(ctx, -hw, -hh, w, h, Math.min(cornerR || 0, hw, hh));
  } else if (kind === "ellipse") {
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
  } else if (kind === "triangle") {
    ctx.moveTo(0, -hh); ctx.lineTo(hw, hh); ctx.lineTo(-hw, hh); ctx.closePath();
  } else if (kind === "star") {
    const pts = 5, inner = 0.45;
    for (let i = 0; i < pts * 2; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / pts;
      const r = i % 2 === 0 ? 1 : inner;
      const x = Math.cos(ang) * hw * r, y = Math.sin(ang) * hh * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (kind === "heart") {
    ctx.moveTo(0, hh * 0.75);
    ctx.bezierCurveTo(hw * 1.4, -hh * 0.2, hw * 0.55, -hh * 1.15, 0, -hh * 0.45);
    ctx.bezierCurveTo(-hw * 0.55, -hh * 1.15, -hw * 1.4, -hh * 0.2, 0, hh * 0.75);
    ctx.closePath();
  } else if (kind === "shield") {
    ctx.moveTo(-hw, -hh); ctx.lineTo(hw, -hh); ctx.lineTo(hw, hh * 0.25);
    ctx.quadraticCurveTo(hw, hh, 0, hh);
    ctx.quadraticCurveTo(-hw, hh, -hw, hh * 0.25);
    ctx.closePath();
  }
}

// Renders a custom canvas frame. Works at any target size (editor preview or final export).
function drawCustomElements(ctx, size, elems, onAsync) {
  const k = size / BASE;
  ctx.save();
  ctx.scale(k, k);
  const C = BASE / 2; // 540 — center of design space
  for (const el of elems) {
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;
    switch (el.kind) {
      case "backdrop": {
        // full-frame mat with a transparent circular cutout for the photo
        ctx.save();
        ctx.translate(C, C);
        ctx.fillStyle = ceFillStyle(ctx, el, BASE, BASE);
        ctx.fillRect(-C, -C, BASE, BASE);
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(0, 0, el.holeR ?? 430, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "ring": {
        let stroke;
        if (el.style === "gradient") {
          const g = ctx.createLinearGradient(0, 0, BASE, BASE);
          g.addColorStop(0, el.color1); g.addColorStop(1, el.color2);
          stroke = g;
        } else { stroke = el.color1; }
        ctx.beginPath();
        ctx.arc(C, C, el.radius - el.width / 2, 0, Math.PI * 2);
        ctx.lineWidth = el.width;
        ctx.strokeStyle = stroke;
        if (el.style === "dashed") ctx.setLineDash([el.width * 0.7, el.width * 0.5]);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "arctext":
        drawArcText(ctx, el.text || "", C, C, el.radius, el.size, el.color, el.font || '"Segoe UI",sans-serif', el.align === "top");
        break;
      case "freetext":
      case "sticker": {
        ctx.save();
        ctx.translate(el.x, el.y);
        if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
        ctx.font = `${el.bold ? "bold " : ""}${el.italic ? "italic " : ""}${el.size}px ${el.font || '"Segoe UI",sans-serif'}`;
        ctx.textAlign = el.align || "center";
        ctx.textBaseline = "middle";
        if (el.strokeW > 0 && el.stroke && el.stroke !== "none") {
          ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeW;
          ctx.lineJoin = "round"; ctx.strokeText(el.text || "", 0, 0);
        }
        ctx.fillStyle = el.color || "#ffffff";
        ctx.fillText(el.text || "", 0, 0);
        ctx.restore();
        break;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2);
        ctx.strokeStyle = el.color || "#ffffff";
        ctx.lineWidth = el.width || 8;
        ctx.lineCap = "round";
        ctx.stroke();
        break;
      }
      case "rect":
      case "triangle":
      case "star":
      case "heart":
      case "shield": {
        ctx.save();
        ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
        if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
        ceShapePath(ctx, el.kind, el.w, el.h, el.cornerR);
        ctx.fillStyle = ceFillStyle(ctx, el, el.w, el.h);
        ctx.fill();
        if (el.strokeW > 0 && el.stroke && el.stroke !== "none") {
          ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeW;
          ctx.lineJoin = "round"; ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case "ellipse": {
        ctx.save();
        ctx.translate(el.cx, el.cy);
        if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
        ceShapePath(ctx, "ellipse", el.rx * 2, el.ry * 2, 0);
        ctx.fillStyle = ceFillStyle(ctx, el, el.rx * 2, el.ry * 2);
        ctx.fill();
        if (el.strokeW > 0 && el.stroke && el.stroke !== "none") {
          ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeW; ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case "image": {
        if (!el.src) break;
        const img = getCachedImage("ce_" + el.key, el.src, onAsync);
        if (img.complete && img.naturalWidth) {
          ctx.save();
          ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
          if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
          if (el.round) {
            ceShapePath(ctx, "ellipse", el.w, el.h, 0);
            ctx.clip();
          }
          ctx.drawImage(img, -el.w / 2, -el.h / 2, el.w, el.h);
          ctx.restore();
        }
        break;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------- photo drawing ----------
function filterString() {
  const f = state.filters;
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%)`;
}

// Draws the user photo with pan/zoom/rotate/flip/filters into a size×size square
// centered region (the circle area). k scales the 1080-space offsets.
function drawPhotoSquare(ctx, size) {
  const img = state.photo;
  const k = size / BASE;
  const base = Math.max(size / img.width, size / img.height);
  const scale = base * state.zoom;
  ctx.save();
  ctx.filter = filterString();
  ctx.translate(size / 2 + state.offsetX * k, size / 2 + state.offsetY * k);
  ctx.rotate((state.rotation * Math.PI) / 180);
  if (state.flip) ctx.scale(-1, 1);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

// Renders the framed circular composite (photo + frame) onto an offscreen square canvas.
function renderFramedCircle(d, onAsyncReady) {
  const cv = document.createElement("canvas");
  cv.width = d; cv.height = d;
  const ctx = cv.getContext("2d");
  ctx.save();
  ctx.beginPath();
  ctx.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#2b3152";
  ctx.fillRect(0, 0, d, d);
  if (state.photo) drawPhotoSquare(ctx, d);
  drawFrame(ctx, d, getFrame(state.selectedFrameId), onAsyncReady);
  ctx.restore();
  return cv;
}

// ---------- main render (format-aware) ----------
function renderComposite(canvas, { watermark }) {
  const fmt = state.format;
  canvas.width = fmt.w;
  canvas.height = fmt.h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, fmt.w, fmt.h);
  const onAsync = () => renderPreview();

  if (fmt.circle) {
    ctx.drawImage(renderFramedCircle(fmt.w, onAsync), 0, 0);
    if (!state.photo) drawPlaceholderText(ctx, fmt.w, fmt.h);
  } else if (fmt.w === fmt.h) {
    // square post: photo full-bleed, frame inscribed
    ctx.fillStyle = "#2b3152";
    ctx.fillRect(0, 0, fmt.w, fmt.h);
    if (state.photo) drawPhotoSquare(ctx, fmt.w);
    else drawPlaceholderText(ctx, fmt.w, fmt.h);
    drawFrame(ctx, fmt.w, getFrame(state.selectedFrameId), onAsync);
  } else {
    // story / cover: blurred photo backdrop + centered framed circle
    ctx.fillStyle = "#1a1f36";
    ctx.fillRect(0, 0, fmt.w, fmt.h);
    if (state.photo) {
      const img = state.photo;
      const cover = Math.max(fmt.w / img.width, fmt.h / img.height);
      ctx.save();
      ctx.filter = "blur(36px) brightness(0.55)";
      ctx.drawImage(img,
        fmt.w / 2 - (img.width * cover) / 2, fmt.h / 2 - (img.height * cover) / 2,
        img.width * cover, img.height * cover);
      ctx.restore();
    }
    const d = Math.min(fmt.w, fmt.h) * 0.78;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 40;
    ctx.drawImage(renderFramedCircle(d, onAsync), fmt.w / 2 - d / 2, fmt.h / 2 - d / 2);
    ctx.restore();
    if (!state.photo) drawPlaceholderText(ctx, fmt.w, fmt.h);
  }

  if (watermark && !state.isPro) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `600 ${Math.min(fmt.w, fmt.h) * 0.024}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("made with FrameUp", fmt.w / 2, fmt.h * 0.975);
    ctx.restore();
  }
}

function drawPlaceholderText(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = "#9aa3c7";
  ctx.font = `${Math.min(w, h) * 0.04}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("Upload a photo to start", w / 2, h / 2);
  ctx.restore();
}

const previewCanvas = document.getElementById("previewCanvas");
function renderPreview() {
  renderComposite(previewCanvas, { watermark: true });
  previewCanvas.classList.toggle("rect", !state.format.circle);
}

// ---------- photo input ----------
const photoInput = document.getElementById("photoInput");
const dropzone = document.getElementById("dropzone");

photoInput.addEventListener("change", e => {
  if (e.target.files[0]) loadPhotoFile(e.target.files[0]);
});
["dragover", "dragenter"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("drag"); })
);
dropzone.addEventListener("drop", e => {
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith("image/")) loadPhotoFile(f);
});

function loadPhotoFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.photo = img;
    resetTransform();
    toast("Photo loaded — drag to reposition, scroll/pinch to zoom.");
  };
  img.src = url;
}

// ---------- transform & filter controls ----------
const zoomSlider = document.getElementById("zoomSlider");
const rotateSlider = document.getElementById("rotateSlider");
zoomSlider.addEventListener("input", () => { state.zoom = +zoomSlider.value; renderPreview(); });
rotateSlider.addEventListener("input", () => { state.rotation = +rotateSlider.value; renderPreview(); });

function resetTransform() {
  state.zoom = 1; state.rotation = 0; state.offsetX = 0; state.offsetY = 0; state.flip = false;
  zoomSlider.value = 1; rotateSlider.value = 0;
  renderPreview();
}
function flipPhoto() { state.flip = !state.flip; renderPreview(); }

const FILTER_PRESETS = {
  normal: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0 },
  vivid:  { brightness: 106, contrast: 116, saturate: 145, grayscale: 0, sepia: 0 },
  bw:     { brightness: 104, contrast: 112, saturate: 100, grayscale: 100, sepia: 0 },
  sepia:  { brightness: 102, contrast: 102, saturate: 100, grayscale: 0, sepia: 80 },
  cool:   { brightness: 102, contrast: 105, saturate: 80, grayscale: 0, sepia: 0 },
};
document.querySelectorAll("#filterPresets .chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#filterPresets .chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    Object.assign(state.filters, FILTER_PRESETS[chip.dataset.preset]);
    document.getElementById("fBrightness").value = state.filters.brightness;
    document.getElementById("fContrast").value = state.filters.contrast;
    document.getElementById("fSaturate").value = state.filters.saturate;
    renderPreview();
  });
});
[["fBrightness", "brightness"], ["fContrast", "contrast"], ["fSaturate", "saturate"]].forEach(([id, key]) => {
  document.getElementById(id).addEventListener("input", e => {
    state.filters[key] = +e.target.value;
    renderPreview();
  });
});

// format chips
function renderFormatChips() {
  const row = document.getElementById("formatChips");
  row.innerHTML = "";
  for (const fmt of FORMATS) {
    const b = document.createElement("button");
    b.className = "chip" + (fmt.id === state.format.id ? " selected" : "");
    b.textContent = `${fmt.name} ${fmt.w}×${fmt.h}`;
    b.onclick = () => { state.format = fmt; renderFormatChips(); renderPreview(); };
    row.appendChild(b);
  }
}

// ---------- preview interactions: drag, wheel zoom, pinch ----------
const activePointers = new Map();
let lastPinchDist = 0;

function canvasScale() {
  return state.format.w / previewCanvas.getBoundingClientRect().width;
}
previewCanvas.addEventListener("pointerdown", e => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  previewCanvas.setPointerCapture(e.pointerId);
  if (activePointers.size === 2) {
    const [a, b] = [...activePointers.values()];
    lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
previewCanvas.addEventListener("pointermove", e => {
  if (!activePointers.has(e.pointerId)) return;
  const prev = activePointers.get(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 1) {
    const s = canvasScale() * (BASE / state.format.w);
    state.offsetX += (e.clientX - prev.x) * s;
    state.offsetY += (e.clientY - prev.y) * s;
    renderPreview();
  } else if (activePointers.size === 2) {
    const [a, b] = [...activePointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastPinchDist > 0) {
      state.zoom = Math.min(4, Math.max(0.3, state.zoom * (dist / lastPinchDist)));
      zoomSlider.value = state.zoom;
      renderPreview();
    }
    lastPinchDist = dist;
  }
});
["pointerup", "pointercancel"].forEach(ev =>
  previewCanvas.addEventListener(ev, e => {
    activePointers.delete(e.pointerId);
    lastPinchDist = 0;
  })
);
previewCanvas.addEventListener("wheel", e => {
  e.preventDefault();
  state.zoom = Math.min(4, Math.max(0.3, state.zoom * (e.deltaY < 0 ? 1.07 : 0.93)));
  zoomSlider.value = state.zoom;
  renderPreview();
}, { passive: false });

// ---------- frame gallery ----------
function renderGallery() {
  const gal = document.getElementById("frameGallery");
  gal.innerHTML = "";
  const customIds = new Set(loadCustomFrames().map(f => f.id));
  for (const frame of allFrames()) {
    const div = document.createElement("div");
    div.className = "frame-thumb" + (frame.id === state.selectedFrameId ? " selected" : "");
    const cv = document.createElement("canvas");
    cv.width = 148; cv.height = 148;
    const tctx = cv.getContext("2d");
    tctx.save();
    tctx.beginPath();
    tctx.arc(74, 74, 74, 0, Math.PI * 2);
    tctx.clip();
    tctx.fillStyle = "#39406b";
    tctx.fillRect(0, 0, 148, 148);
    drawFrame(tctx, 148, frame, () => renderGallery());
    tctx.restore();
    const label = document.createElement("div");
    label.className = "fname";
    label.textContent = frame.name;
    div.appendChild(cv);
    div.appendChild(label);
    if (customIds.has(frame.id)) {
      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.title = "Delete this frame";
      del.onclick = ev => { ev.stopPropagation(); deleteCustomFrame(frame.id); };
      div.appendChild(del);
    }
    div.onclick = () => {
      state.selectedFrameId = frame.id;
      renderGallery();
      renderPreview();
      updateCounter();
    };
    gal.appendChild(div);
  }
}

function deleteCustomFrame(id) {
  saveCustomFrames(loadCustomFrames().filter(f => f.id !== id));
  delete imgCache["png_" + id];
  if (state.selectedFrameId === id) state.selectedFrameId = BUILTIN_FRAMES[0].id;
  renderGallery();
  renderPreview();
  renderDashboard();
  toast("Frame deleted.");
}

// ---------- download (with optional email gate) ----------
function requestDownload() {
  if (!state.photo) { toast("Upload a photo first! 📷"); return; }
  const frame = getFrame(state.selectedFrameId);
  if (!frame) { toast("Pick a frame first! 🖼️"); return; }
  const gated = (frame.type === "config" && frame.config.emailGate) || frame.emailGate;
  if (gated && !sessionStorage.getItem("frameup_lead_done_" + frame.id)) {
    openEmailModal(frame);
    return;
  }
  doDownload();
}

function doDownload() {
  const out = document.createElement("canvas");
  renderComposite(out, { watermark: true });
  const a = document.createElement("a");
  a.download = `frameup-${state.format.id}.png`;
  a.href = out.toDataURL("image/png");
  a.click();
  bumpCounter();
  toast(state.isPro ? "Downloaded! ⭐" : "Downloaded! Upgrade to Pro to remove the watermark.");
}

async function copyImageToClipboard() {
  if (!state.photo) { toast("Upload a photo first! 📷"); return; }
  try {
    const out = document.createElement("canvas");
    renderComposite(out, { watermark: true });
    const blob = await new Promise(res => out.toBlob(res, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    bumpCounter();
    toast("Image copied — paste it straight into Facebook! 📋");
  } catch {
    toast("Couldn't copy to clipboard in this browser — use Download instead.");
  }
}

function bumpCounter() {
  const key = "frameup_downloads_" + (state.selectedFrameId || "none");
  localStorage.setItem(key, parseInt(localStorage.getItem(key) || "0", 10) + 1);
  const frame = getFrame(state.selectedFrameId);
  if (API_OK && frame && frame.serverId) {
    api(`/frames/${frame.serverId}/download`, { method: "POST" })
      .then(r => { frame.downloads = r.downloads; })
      .catch(() => {});
  }
  updateCounter();
}
function downloadsFor(frameId) {
  return parseInt(localStorage.getItem("frameup_downloads_" + frameId) || "0", 10);
}
function updateCounter() {
  const el = document.getElementById("usageCounter");
  if (!state.selectedFrameId) { el.textContent = ""; return; }
  const n = downloadsFor(state.selectedFrameId);
  el.textContent = n > 0 ? `📈 ${n} download${n === 1 ? "" : "s"} with this frame on this device` : "";
}

// ---------- leads ----------
function loadLeads() {
  try { return JSON.parse(localStorage.getItem("frameup_leads") || "[]"); }
  catch { return []; }
}
function saveLeads(leads) { localStorage.setItem("frameup_leads", JSON.stringify(leads)); }

let pendingLeadFrame = null;
function openEmailModal(frame) {
  pendingLeadFrame = frame;
  document.getElementById("emailModalSub").textContent =
    `"${frame.name}" asks for your email before download. (Demo — stored only in this browser.)`;
  openModal("emailModal");
}
function submitLead() {
  const name = document.getElementById("leadName").value.trim();
  const email = document.getElementById("leadEmail").value.trim();
  if (!email || !email.includes("@")) { toast("Please enter a valid email."); return; }
  if (API_OK && pendingLeadFrame.serverId) {
    api(`/frames/${pendingLeadFrame.serverId}/leads`, { method: "POST", body: { name, email } }).catch(() => {});
  } else {
    const leads = loadLeads();
    leads.push({ frameId: pendingLeadFrame.id, name, email, ts: Date.now() });
    saveLeads(leads);
  }
  sessionStorage.setItem("frameup_lead_done_" + pendingLeadFrame.id, "1");
  closeModal();
  doDownload();
  renderDashboard();
}

// ---------- share / campaign links / QR ----------
// Unicode-safe base64 helpers (replaces deprecated escape/unescape)
function strToB64(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64ToStr(b64) {
  return new TextDecoder().decode(new Uint8Array([...atob(b64)].map(c => c.charCodeAt(0))));
}

function encodeFrameToHash(frame) {
  if (frame.type !== "config") return null;
  const cfgCopy = Object.assign({}, frame.config, { logo: null }); // logos are too big for URLs
  return "#f=" + encodeURIComponent(strToB64(JSON.stringify({ name: frame.name, config: cfgCopy })));
}
function decodeFrameFromHash() {
  const m = location.hash.match(/^#f=(.+)$/);
  if (!m) return null;
  try {
    const obj = JSON.parse(b64ToStr(decodeURIComponent(m[1])));
    if (!obj.config) return null;
    return { id: "shared_" + hashString(m[1]), name: obj.name || "Shared frame", type: "config", config: cfg(obj.config) };
  } catch { return null; }
}
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
function frameLink(frame) {
  if (frame.serverId) return location.origin + "/f/" + frame.serverId; // short server link
  const hash = encodeFrameToHash(frame);
  return hash ? location.origin + "/" + hash : null;
}

function copyShareLink() {
  const frame = getFrame(state.selectedFrameId);
  if (!frame) { toast("Pick a frame first!"); return; }
  const link = frameLink(frame);
  if (!link) { toast("PNG-overlay frames can't be shared by link (the image is too large for a URL)."); return; }
  copyText(link, "Campaign link copied! Anyone who opens it gets this frame pre-loaded.");
}

function copyText(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(msg), () => promptFallback(text));
  } else {
    promptFallback(text);
  }
}
function promptFallback(text) { window.prompt("Copy this link:", text); }

function showQRFor(link) {
  if (typeof QRCode === "undefined") {
    toast("QR library didn't load (offline?) — the campaign link still works.");
    return;
  }
  const target = document.getElementById("qrTarget");
  target.innerHTML = "";
  new QRCode(target, { text: link, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  openModal("qrModal");
}

// ---------- frame studio ----------
const builderCanvas = document.getElementById("builderCanvas");
let builder = {
  ringStyle: "gradient",
  pattern: "none",
  stickers: [],
  logo: null,
  pngOverlay: null, // dataUrl when user uploads a full overlay instead
  selected: null,   // {kind:'sticker', idx} | {kind:'logo'} for dragging
};

function builderConfig() {
  return cfg({
    ringStyle: builder.ringStyle,
    color1: document.getElementById("bColor1").value,
    color2: document.getElementById("bColor2").value,
    ringWidth: +document.getElementById("bRingWidth").value,
    topText: document.getElementById("bTopText").value.trim(),
    bottomText: document.getElementById("bBottomText").value.trim(),
    font: document.getElementById("bFont").value,
    textColor: document.getElementById("bTextColor").value,
    banner: document.getElementById("bBanner").checked,
    bannerStyle: document.getElementById("bBannerStyle").value,
    bannerText: document.getElementById("bBannerText").value.trim(),
    pattern: builder.pattern,
    stickers: builder.stickers,
    logo: builder.logo,
    emailGate: document.getElementById("bEmailGate").checked,
  });
}

function renderBuilder() {
  const ctx = builderCanvas.getContext("2d");
  ctx.clearRect(0, 0, BASE, BASE);
  ctx.save();
  ctx.beginPath();
  ctx.arc(BASE / 2, BASE / 2, BASE / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#555d8c";
  ctx.fillRect(0, 0, BASE, BASE);
  // silhouette so creators can judge clearance around a face
  ctx.fillStyle = "#39406b";
  ctx.beginPath();
  ctx.arc(BASE / 2, BASE * 0.42, BASE * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(BASE / 2, BASE * 0.85, BASE * 0.28, BASE * 0.22, 0, Math.PI, 0);
  ctx.fill();
  if (builder.pngOverlay) {
    const img = getCachedImage("builder_png", builder.pngOverlay, renderBuilder);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, BASE, BASE);
  } else {
    drawConfigFrame(ctx, BASE, builderConfig(), renderBuilder);
  }
  ctx.restore();
}

// text/color/slider inputs
["bName", "bColor1", "bColor2", "bRingWidth", "bTopText", "bBottomText", "bFont", "bTextColor", "bBanner", "bBannerStyle", "bBannerText", "bEmailGate"]
  .forEach(id => document.getElementById(id).addEventListener("input", () => {
    builder.pngOverlay = null;
    renderBuilder();
  }));

// ring style + pattern chips
document.querySelectorAll("#ringStyleChips .chip").forEach(chip =>
  chip.addEventListener("click", () => {
    document.querySelectorAll("#ringStyleChips .chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    builder.ringStyle = chip.dataset.ring;
    builder.pngOverlay = null;
    renderBuilder();
  })
);
document.querySelectorAll("#patternChips .chip").forEach(chip =>
  chip.addEventListener("click", () => {
    document.querySelectorAll("#patternChips .chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    builder.pattern = chip.dataset.pattern;
    builder.pngOverlay = null;
    renderBuilder();
  })
);

// sticker palette
(function buildStickerRow() {
  const row = document.getElementById("stickerRow");
  for (const ch of STICKER_SET) {
    const b = document.createElement("button");
    b.className = "chip sticker";
    b.textContent = ch;
    b.onclick = () => {
      builder.stickers.push({ char: ch, x: BASE / 2, y: BASE * 0.2, size: 110 });
      builder.pngOverlay = null;
      renderBuilder();
      toast("Sticker added — drag it into place on the preview.");
    };
    row.appendChild(b);
  }
})();

// logo upload
let logoKeyCounter = 0;
document.getElementById("bLogoInput").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    builder.logo = { dataUrl: reader.result, x: BASE / 2, y: BASE * 0.18, size: +document.getElementById("bLogoSize").value, key: "b" + (++logoKeyCounter) };
    builder.pngOverlay = null;
    renderBuilder();
    toast("Logo added — drag it into place.");
  };
  reader.readAsDataURL(f);
});
document.getElementById("bLogoSize").addEventListener("input", e => {
  if (builder.logo) { builder.logo.size = +e.target.value; renderBuilder(); }
});
function removeLogo() { builder.logo = null; renderBuilder(); }

// full PNG overlay upload
document.getElementById("bPngInput").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    builder.pngOverlay = reader.result;
    delete imgCache["builder_png"];
    renderBuilder();
    toast("Overlay loaded — this PNG replaces the generated design.");
  };
  reader.readAsDataURL(f);
});

// drag stickers & logo on the builder canvas
function builderCanvasPoint(e) {
  const r = builderCanvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (BASE / r.width), y: (e.clientY - r.top) * (BASE / r.height) };
}
function hitTestBuilder(p) {
  for (let i = builder.stickers.length - 1; i >= 0; i--) {
    const s = builder.stickers[i];
    if (Math.hypot(p.x - s.x, p.y - s.y) < s.size * 0.6) return { kind: "sticker", idx: i };
  }
  if (builder.logo && Math.hypot(p.x - builder.logo.x, p.y - builder.logo.y) < builder.logo.size * 0.6) {
    return { kind: "logo" };
  }
  return null;
}
builderCanvas.addEventListener("pointerdown", e => {
  const p = builderCanvasPoint(e);
  builder.selected = hitTestBuilder(p);
  if (builder.selected) builderCanvas.setPointerCapture(e.pointerId);
});
builderCanvas.addEventListener("pointermove", e => {
  if (!builder.selected) return;
  const p = builderCanvasPoint(e);
  if (builder.selected.kind === "sticker") {
    const s = builder.stickers[builder.selected.idx];
    s.x = p.x; s.y = p.y;
  } else {
    builder.logo.x = p.x; builder.logo.y = p.y;
  }
  renderBuilder();
});
builderCanvas.addEventListener("pointerup", () => { builder.selected = null; });
builderCanvas.addEventListener("dblclick", e => {
  const hit = hitTestBuilder(builderCanvasPoint(e));
  if (hit && hit.kind === "sticker") {
    builder.stickers.splice(hit.idx, 1);
    renderBuilder();
    toast("Sticker removed.");
  }
});

function saveBuiltFrame() {
  const name = document.getElementById("bName").value.trim() || "Untitled frame";
  const frames = loadCustomFrames();
  const id = "custom_" + Date.now().toString(36);
  const frame = builder.pngOverlay
    ? { id, name, type: "png", dataUrl: builder.pngOverlay }
    : { id, name, type: "config", config: builderConfig() };
  frames.push(frame);
  try {
    saveCustomFrames(frames);
  } catch {
    toast("Couldn't save — browser storage is full. Try a smaller PNG/logo.");
    return;
  }
  state.selectedFrameId = id;
  renderGallery();
  renderPreview();
  renderDashboard();
  showView("editor");
  toast(`"${name}" saved! It's selected and ready to use.`);
}

function copyFrameCampaignLink() {
  if (builder.pngOverlay) { toast("PNG-overlay frames can't be shared by link — save the frame instead."); return; }
  const name = document.getElementById("bName").value.trim() || "Untitled frame";
  const link = frameLink({ type: "config", name, config: builderConfig() });
  copyText(link, "Campaign link copied! Share it with your supporters.");
}
function showBuilderQR() {
  if (builder.pngOverlay) { toast("PNG-overlay frames can't be shared by link/QR."); return; }
  const name = document.getElementById("bName").value.trim() || "Untitled frame";
  const link = frameLink({ type: "config", name, config: builderConfig() });
  showQRFor(link);
}

async function publishCurrentFrame() {
  if (!API_OK) { toast("Publishing needs the server — run `node server.js` and open http://localhost:3000."); return; }
  const btn = document.querySelector('[onclick="publishCurrentFrame()"]');
  if (btn) { btn.disabled = true; btn.textContent = "Publishing…"; }
  const name = document.getElementById("bName").value.trim() || "Untitled frame";
  const author = document.getElementById("bAuthor").value.trim() || "Anonymous";
  const emailGate = document.getElementById("bEmailGate").checked;
  const payload = builder.pngOverlay
    ? { name, author, emailGate, type: "png", dataUrl: builder.pngOverlay }
    : { name, author, emailGate, type: "config", config: builderConfig() };
  try {
    const r = await api("/frames", { method: "POST", body: payload });
    const owned = loadOwned();
    owned[r.id] = { ownerKey: r.ownerKey, name };
    saveOwned(owned);
    copyText(location.origin + "/f/" + r.id, "Published! 🌍 Short share link copied to clipboard.");
    showView("dashboard");
  } catch (e) {
    toast(e.message === "too_large"
      ? "Frame is too large to publish (max ~2 MB). Use a smaller PNG or logo."
      : "Publish failed — is the server running?");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🌍 Publish & share"; }
  }
}

// ============================================================
// CANVAS FRAME EDITOR — Canva-style freeform builder
// ============================================================
const CE_BASE = BASE;                 // 1080 — design coordinate space
const CE_SIZE = 520;                  // editor canvas display size (px)
const CE_SCALE = CE_SIZE / CE_BASE;   // design → screen factor
const D2S = CE_SCALE;
const CE_MIN = 16;                    // min element size (design units)
const CE_SNAP = 9;                    // center-snap threshold (design units)
const CE_CENTER = CE_BASE / 2;        // 540

let ceElems = [];
let ceSelectedId = null;
let ceDrag = null;                    // active gesture
let ceGuides = { v: false, h: false };
let ceIdCtr = 0;
function ceNewId() { return "ce" + (++ceIdCtr); }

const CE_UNDO = [], CE_REDO = [];
let ceDownSnap = null;                // pre-gesture snapshot (for canvas drags)
let cePropSnap = null, cePropEditing = false;

const ceCanvas = document.getElementById("ceCanvas");
const ceCtx = ceCanvas.getContext("2d");

const CE_PALETTE = ["#ffffff","#000000","#5b5bf0","#c026d3","#e11d48","#f59e0b","#10b981","#0ea5e9","#7c3aed","#f43f5e","#fbbf24","#1e293b"];

// ---------- element factories ----------
function ceShapeBase(extra) {
  return Object.assign({ x:430, y:120, w:220, h:220, fill:"#5b5bf0", fillType:"solid", fill2:"#c026d3", gradAngle:45, stroke:"none", strokeW:0, rotation:0, opacity:1 }, extra);
}
const CE_DEF = {
  ring:     ()  => ({ kind:"ring", radius:512, width:74, style:"gradient", color1:"#5b5bf0", color2:"#c026d3", opacity:1 }),
  backdrop: ()  => ({ kind:"backdrop", holeR:430, fill:"#0f172a", fillType:"solid", fill2:"#1e293b", gradAngle:90, opacity:0.92 }),
  arctext:  (o) => ({ kind:"arctext", text:"YOUR TEXT HERE", radius:476, size:58, color:"#ffffff", bold:true, font:'"Segoe UI",sans-serif', align:"top", opacity:1, ...o }),
  freetext: (o) => ({ kind:"freetext", text:"Your text", x:540, y:880, size:78, color:"#ffffff", bold:true, italic:false, font:'"Segoe UI",sans-serif', align:"center", stroke:"none", strokeW:0, rotation:0, opacity:1, ...o }),
  sticker:  (o) => ({ kind:"sticker", text:"⭐", x:540, y:170, size:150, color:"#ffffff", bold:false, italic:false, font:'"Segoe UI Emoji",sans-serif', align:"center", rotation:0, opacity:1, ...o }),
  line:     ()  => ({ kind:"line", x1:330, y1:760, x2:750, y2:760, color:"#ffffff", width:10, opacity:1 }),
  rect:     ()  => ceShapeBase({ kind:"rect", x:370, y:840, w:340, h:96, cornerR:18 }),
  rrect:    ()  => ceShapeBase({ kind:"rect", x:370, y:840, w:340, h:96, cornerR:48 }),
  ellipse:  ()  => ({ kind:"ellipse", cx:540, cy:200, rx:90, ry:90, fill:"#c026d3", fillType:"solid", fill2:"#5b5bf0", gradAngle:45, stroke:"none", strokeW:0, rotation:0, opacity:1 }),
  triangle: ()  => ceShapeBase({ kind:"triangle", fill:"#f59e0b" }),
  star:     ()  => ceShapeBase({ kind:"star", w:200, h:200, fill:"#fbbf24" }),
  heart:    ()  => ceShapeBase({ kind:"heart", w:200, h:200, fill:"#e11d48" }),
  shield:   ()  => ceShapeBase({ kind:"shield", w:200, h:240, fill:"#0ea5e9" }),
  image:    (o) => ({ kind:"image", x:460, y:130, w:160, h:160, rotation:0, opacity:1, round:false, key:ceNewId(), ...o }),
};

function ceAdd(kind, overrides = {}) {
  const def = CE_DEF[kind];
  if (!def) return;
  ceCommit();
  const elem = { id: ceNewId(), ...def(overrides) };
  ceElems.push(elem);
  ceSelectedId = elem.id;
  ceAfterChange();
}
function ceAddText(preset) {
  const sizes = { heading:{size:118,bold:true}, subheading:{size:74,bold:true}, body:{size:46,bold:false} };
  const p = sizes[preset] || sizes.body;
  const ys = { heading:300, subheading:800, body:880 };
  ceAdd("freetext", { text: preset === "heading" ? "HEADING" : preset === "subheading" ? "Subheading" : "Body text", size:p.size, bold:p.bold, y: ys[preset] || 880 });
}
function ceAddSticker(emoji) { ceAdd("sticker", { text: emoji }); }

// ---------- image upload ----------
function ceAddImage() { document.getElementById("ceImageInput").click(); }
document.getElementById("ceImageInput").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    const existing = ceElems.find(el => el.id === ceSelectedId && el.kind === "image");
    if (existing) {
      ceCommit();
      delete imgCache["ce_" + existing.key];
      existing.key = ceNewId();
      existing.src = src;
      ceAfterChange();
    } else {
      const tmp = new Image();
      tmp.onload = () => {
        const ratio = tmp.naturalWidth / tmp.naturalHeight;
        const w = Math.min(280, tmp.naturalWidth);
        const round = document.getElementById("ceRoundUpload")?.checked || false;
        ceAdd("image", { src, w, h: Math.round(w / ratio), x: CE_CENTER - w / 2, y: 150, round });
      };
      tmp.src = src;
    }
  };
  reader.readAsDataURL(f);
  e.target.value = "";
});

// ---------- geometry abstraction (box-like elements) ----------
function ceMeasure(el) {
  ceCtx.save();
  ceCtx.font = `${el.bold ? "bold " : ""}${el.italic ? "italic " : ""}${el.size}px ${el.font || "sans-serif"}`;
  const w = Math.max(24, ceCtx.measureText(el.text || " ").width);
  ceCtx.restore();
  return { w, h: el.size * 1.25 };
}
function ceGeom(el) {
  switch (el.kind) {
    case "ellipse": return { cx: el.cx, cy: el.cy, w: el.rx * 2, h: el.ry * 2, rot: el.rotation || 0 };
    case "freetext": case "sticker": { const m = ceMeasure(el); return { cx: el.x, cy: el.y, w: m.w, h: m.h, rot: el.rotation || 0 }; }
    case "rect": case "image": case "triangle": case "star": case "heart": case "shield":
      return { cx: el.x + el.w / 2, cy: el.y + el.h / 2, w: el.w, h: el.h, rot: el.rotation || 0 };
    default: return null; // ring / arctext / backdrop / line
  }
}
function ceSetGeom(el, g) {
  switch (el.kind) {
    case "ellipse": el.cx = g.cx; el.cy = g.cy; if (g.w) el.rx = Math.max(8, g.w / 2); if (g.h) el.ry = Math.max(8, g.h / 2); el.rotation = g.rot; break;
    case "freetext": case "sticker": el.x = g.cx; el.y = g.cy; if (g.h) el.size = Math.max(10, Math.round(g.h / 1.25)); el.rotation = g.rot; break;
    default: el.x = g.cx - g.w / 2; el.y = g.cy - g.h / 2; el.w = Math.max(CE_MIN, g.w); el.h = Math.max(CE_MIN, g.h); el.rotation = g.rot;
  }
}

// ---------- handle positions (screen space) ----------
function ceHandles(el) {
  const g = ceGeom(el);
  if (g) {
    const cs = { x: g.cx * D2S, y: g.cy * D2S };
    const hw = g.w / 2 * D2S, hh = g.h / 2 * D2S;
    const rot = (g.rot || 0) * Math.PI / 180, co = Math.cos(rot), si = Math.sin(rot);
    const tf = (ox, oy) => ({ x: cs.x + ox * co - oy * si, y: cs.y + ox * si + oy * co });
    const isText = el.kind === "freetext" || el.kind === "sticker";
    const list = [];
    [["nw",-hw,-hh],["ne",hw,-hh],["se",hw,hh],["sw",-hw,hh]].forEach(([t,ox,oy]) => list.push({ type:t, ...tf(ox,oy) }));
    if (!isText) [["n",0,-hh],["e",hw,0],["s",0,hh],["w",-hw,0]].forEach(([t,ox,oy]) => list.push({ type:t, ...tf(ox,oy) }));
    list.push({ type:"rot", ...tf(0, -hh - 28) });
    return list;
  }
  if (el.kind === "ring" || el.kind === "arctext" || el.kind === "backdrop") {
    const C = CE_SIZE / 2;
    const R = (el.kind === "backdrop" ? el.holeR : el.radius) * D2S;
    const a = -Math.PI / 4;
    return [{ type:"radius", x: C + Math.cos(a) * R, y: C + Math.sin(a) * R }];
  }
  if (el.kind === "line") return [{ type:"p1", x: el.x1 * D2S, y: el.y1 * D2S }, { type:"p2", x: el.x2 * D2S, y: el.y2 * D2S }];
  return [];
}

// ---------- drawing ----------
function ceDraw() {
  const ctx = ceCtx, S = CE_SIZE;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = "#13132a";
  ctx.fillRect(0, 0, S, S);

  // photo placeholder
  const photoR = (CE_BASE * 0.40) * D2S;
  ctx.save();
  ctx.beginPath();
  ctx.arc(S/2, S/2, photoR, 0, Math.PI*2);
  ctx.fillStyle = "#22224a"; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.font = `${Math.round(photoR*0.6)}px serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("👤", S/2, S/2);

  drawCustomElements(ceCtx, S, ceElems, ceDraw);

  // snap guides
  if (ceGuides.v) { ctx.save(); ctx.strokeStyle = "#ff3da6"; ctx.lineWidth = 1; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(S/2,0); ctx.lineTo(S/2,S); ctx.stroke(); ctx.restore(); }
  if (ceGuides.h) { ctx.save(); ctx.strokeStyle = "#ff3da6"; ctx.lineWidth = 1; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(0,S/2); ctx.lineTo(S,S/2); ctx.stroke(); ctx.restore(); }

  if (ceSelectedId) {
    const el = ceElems.find(e => e.id === ceSelectedId);
    if (el) ceDrawSelection(el);
  }
}

function ceDrawSelection(el) {
  const ctx = ceCtx;
  const handles = ceHandles(el);
  ctx.save();
  ctx.strokeStyle = "#5b5bf0"; ctx.lineWidth = 1.5;

  const g = ceGeom(el);
  if (g) {
    // rotated bbox outline through corners
    const corners = handles.filter(h => ["nw","ne","se","sw"].includes(h.type));
    if (corners.length === 4) {
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.setLineDash([5,4]); ctx.stroke(); ctx.setLineDash([]);
    }
    // rotation arm
    const rotH = handles.find(h => h.type === "rot");
    const topMid = { x: (corners[0].x + corners[1].x)/2, y: (corners[0].y + corners[1].y)/2 };
    if (rotH) { ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(rotH.x, rotH.y); ctx.stroke(); }
  } else if (el.kind === "ring" || el.kind === "arctext" || el.kind === "backdrop") {
    const C = CE_SIZE/2, R = (el.kind === "backdrop" ? el.holeR : el.radius) * D2S;
    ctx.setLineDash([5,4]); ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  } else if (el.kind === "line") {
    ctx.setLineDash([5,4]); ctx.beginPath(); ctx.moveTo(el.x1*D2S, el.y1*D2S); ctx.lineTo(el.x2*D2S, el.y2*D2S); ctx.stroke(); ctx.setLineDash([]);
  }

  // handles
  for (const h of handles) {
    ctx.beginPath();
    if (h.type === "rot") { ctx.fillStyle = "#5b5bf0"; ctx.arc(h.x, h.y, 6, 0, Math.PI*2); ctx.fill(); }
    else { ctx.fillStyle = "#fff"; ctx.strokeStyle = "#5b5bf0"; ctx.lineWidth = 1.5;
           ctx.rect(h.x-5, h.y-5, 10, 10); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
}

// ---------- pointer / hit testing ----------
function cePt(e) {
  const r = ceCanvas.getBoundingClientRect();
  const cx = (e.clientX - r.left) * (CE_SIZE / r.width);
  const cy = (e.clientY - r.top)  * (CE_SIZE / r.height);
  return { cx, cy, dx: cx / D2S, dy: cy / D2S };
}
function ceHandleAt(cx, cy) {
  if (!ceSelectedId) return null;
  const el = ceElems.find(e => e.id === ceSelectedId);
  if (!el) return null;
  for (const h of ceHandles(el)) if (Math.hypot(cx - h.x, cy - h.y) < 12) return h.type;
  return null;
}
function cePtSeg(px, py, x1, y1, x2, y2) {
  const dx = x2-x1, dy = y2-y1, l2 = dx*dx+dy*dy;
  let t = l2 ? ((px-x1)*dx + (py-y1)*dy)/l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1+t*dx), py - (y1+t*dy));
}
function ceBodyHas(el, dx, dy) {
  if (el.kind === "ring") { const d = Math.hypot(dx-CE_CENTER, dy-CE_CENTER); return d >= el.radius-el.width-10 && d <= el.radius+10; }
  if (el.kind === "arctext") { const d = Math.hypot(dx-CE_CENTER, dy-CE_CENTER); return Math.abs(d-el.radius) < el.size; }
  if (el.kind === "backdrop") return false; // select via layers panel only
  if (el.kind === "line") return cePtSeg(dx, dy, el.x1, el.y1, el.x2, el.y2) < (el.width/2 + 12);
  const g = ceGeom(el); if (!g) return false;
  const rot = -(g.rot||0) * Math.PI/180;
  const px = dx-g.cx, py = dy-g.cy;
  const lx = px*Math.cos(rot) - py*Math.sin(rot);
  const ly = px*Math.sin(rot) + py*Math.cos(rot);
  if (el.kind === "ellipse") return (lx/(g.w/2))**2 + (ly/(g.h/2))**2 <= 1;
  return Math.abs(lx) <= g.w/2 && Math.abs(ly) <= g.h/2;
}
function ceHitBody(dx, dy) {
  for (let i = ceElems.length-1; i >= 0; i--) if (ceBodyHas(ceElems[i], dx, dy)) return ceElems[i];
  return null;
}

ceCanvas.addEventListener("pointerdown", e => {
  const { cx, cy, dx, dy } = cePt(e);
  const ht = ceHandleAt(cx, cy);
  if (ht) {
    const el = ceElems.find(e => e.id === ceSelectedId);
    ceDownSnap = JSON.stringify(ceElems);
    const mode = ht === "rot" ? "rotate" : ht === "radius" ? "radius" : (ht === "p1" || ht === "p2") ? ht : "resize";
    ceDrag = { mode, el, handle: ht, startDx: dx, startDy: dy, orig: JSON.parse(JSON.stringify(el)) };
    ceCanvas.setPointerCapture(e.pointerId);
    return;
  }
  const hit = ceHitBody(dx, dy);
  if (hit) {
    if (hit.id !== ceSelectedId) { ceSelectedId = hit.id; ceRenderLayers(); ceRenderProps(); }
    ceDownSnap = JSON.stringify(ceElems);
    const mode = (hit.kind === "ring" || hit.kind === "arctext" || hit.kind === "backdrop") ? "radius" : "move";
    ceDrag = { mode, el: hit, handle: null, startDx: dx, startDy: dy, orig: JSON.parse(JSON.stringify(hit)) };
    ceCanvas.setPointerCapture(e.pointerId);
    ceDraw(); ceUpdateFloat();
    return;
  }
  if (ceSelectedId) { ceSelectedId = null; ceRenderLayers(); ceRenderProps(); ceDraw(); ceUpdateFloat(); }
});

ceCanvas.addEventListener("pointermove", e => {
  if (!ceDrag) {
    // hover cursor feedback
    const { cx, cy } = cePt(e);
    ceCanvas.style.cursor = ceHandleAt(cx, cy) ? "pointer" : "default";
    return;
  }
  const { dx, dy } = cePt(e);
  const el = ceDrag.el, o = ceDrag.orig;
  ceGuides = { v: false, h: false };
  if (ceDrag.mode === "move") {
    const ddx = dx - ceDrag.startDx, ddy = dy - ceDrag.startDy;
    if (el.kind === "line") { el.x1 = o.x1+ddx; el.y1 = o.y1+ddy; el.x2 = o.x2+ddx; el.y2 = o.y2+ddy; }
    else {
      const og = ceGeom(o);
      let ncx = og.cx + ddx, ncy = og.cy + ddy;
      if (Math.abs(ncx - CE_CENTER) < CE_SNAP) { ncx = CE_CENTER; ceGuides.v = true; }
      if (Math.abs(ncy - CE_CENTER) < CE_SNAP) { ncy = CE_CENTER; ceGuides.h = true; }
      ceSetGeom(el, { cx: ncx, cy: ncy, w: og.w, h: og.h, rot: og.rot });
    }
  } else if (ceDrag.mode === "resize") {
    ceResize(el, ceDrag.handle, dx, dy);
  } else if (ceDrag.mode === "rotate") {
    const g = ceGeom(el);
    let ang = Math.atan2(dy - g.cy, dx - g.cx) * 180/Math.PI + 90;
    ang = ((ang + 180) % 360 + 360) % 360 - 180;
    const near = Math.round(ang/15)*15;
    if (Math.abs(ang - near) < 4) ang = near;
    ceSetGeom(el, { cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: ang });
  } else if (ceDrag.mode === "radius") {
    let r = Math.max(40, Math.min(540, Math.hypot(dx-CE_CENTER, dy-CE_CENTER)));
    if (el.kind === "backdrop") el.holeR = r; else el.radius = r;
  } else if (ceDrag.mode === "p1") { el.x1 = dx; el.y1 = dy; }
  else if (ceDrag.mode === "p2") { el.x2 = dx; el.y2 = dy; }
  ceDraw(); ceUpdateFloat();
});

function ceResize(el, handle, Pdx, Pdy) {
  const g = ceGeom(el);
  const rot = (g.rot||0) * Math.PI/180;
  const ux = { x: Math.cos(rot), y: Math.sin(rot) };
  const uy = { x: -Math.sin(rot), y: Math.cos(rot) };
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const hw = g.w/2, hh = g.h/2;
  const anchor = { x: g.cx - sx*hw*ux.x - sy*hh*uy.x, y: g.cy - sx*hw*ux.y - sy*hh*uy.y };
  const D = { x: Pdx - anchor.x, y: Pdy - anchor.y };
  const du = D.x*ux.x + D.y*ux.y;
  const dv = D.x*uy.x + D.y*uy.y;
  let newW = sx !== 0 ? Math.max(CE_MIN, sx*du) : g.w;
  let newH = sy !== 0 ? Math.max(CE_MIN, sy*dv) : g.h;
  const ncx = anchor.x + sx*(newW/2)*ux.x + sy*(newH/2)*uy.x;
  const ncy = anchor.y + sx*(newW/2)*ux.y + sy*(newH/2)*uy.y;
  ceSetGeom(el, { cx: ncx, cy: ncy, w: newW, h: newH, rot: g.rot });
}

function ceEndGesture() {
  if (!ceDrag) return;
  ceDrag = null;
  ceGuides = { v: false, h: false };
  if (ceDownSnap && JSON.stringify(ceElems) !== ceDownSnap) ceHistPush(ceDownSnap);
  ceDownSnap = null;
  ceDraw(); ceRenderProps(); ceRenderLayers();
}
ceCanvas.addEventListener("pointerup", ceEndGesture);
ceCanvas.addEventListener("pointercancel", ceEndGesture);

// ---------- history ----------
function ceHistPush(json) { CE_UNDO.push(json); if (CE_UNDO.length > 60) CE_UNDO.shift(); CE_REDO.length = 0; ceUpdateHist(); }
function ceCommit() { ceHistPush(JSON.stringify(ceElems)); }   // call BEFORE a mutation
function ceUndo() { if (!CE_UNDO.length) return; CE_REDO.push(JSON.stringify(ceElems)); ceElems = JSON.parse(CE_UNDO.pop()); ceFixSel(); ceAfterChange(); }
function ceRedo() { if (!CE_REDO.length) return; CE_UNDO.push(JSON.stringify(ceElems)); ceElems = JSON.parse(CE_REDO.pop()); ceFixSel(); ceAfterChange(); }
function ceFixSel() { if (ceSelectedId && !ceElems.find(e => e.id === ceSelectedId)) ceSelectedId = null; }
function ceUpdateHist() {
  const u = document.getElementById("ceUndo"), r = document.getElementById("ceRedo");
  if (u) u.disabled = !CE_UNDO.length;
  if (r) r.disabled = !CE_REDO.length;
}
function ceAfterChange() { ceDraw(); ceRenderLayers(); ceRenderProps(); ceUpdateFloat(); ceUpdateHist(); }

// ---------- keyboard ----------
document.addEventListener("keydown", e => {
  if (document.getElementById("view-canvas").hidden) return;
  const typing = ["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? ceRedo() : ceUndo(); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); ceRedo(); return; }
  if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); ceDuplicate(); return; }
  if (typing) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); ceDeleteSelected(); }
  else if (e.key.startsWith("Arrow") && ceSelectedId) { e.preventDefault(); ceNudge(e.key, e.shiftKey ? 12 : 3); }
  else if (e.key === "]") ceMoveLayer(1);
  else if (e.key === "[") ceMoveLayer(-1);
});
function ceNudge(key, amt) {
  const el = ceElems.find(e => e.id === ceSelectedId); if (!el) return;
  ceCommit();
  const d = { ArrowUp:[0,-amt], ArrowDown:[0,amt], ArrowLeft:[-amt,0], ArrowRight:[amt,0] }[key];
  if (el.kind === "ring" || el.kind === "arctext" || el.kind === "backdrop") {
    const k = el.kind === "backdrop" ? "holeR" : "radius";
    el[k] = Math.max(40, Math.min(540, el[k] - d[1]));
  } else if (el.kind === "line") { el.x1+=d[0]; el.x2+=d[0]; el.y1+=d[1]; el.y2+=d[1]; }
  else { const g = ceGeom(el); ceSetGeom(el, { cx: g.cx+d[0], cy: g.cy+d[1], w: g.w, h: g.h, rot: g.rot }); }
  ceAfterChange();
}

// ---------- duplicate / delete / layers ----------
function ceDuplicate() {
  const el = ceElems.find(e => e.id === ceSelectedId); if (!el) return;
  ceCommit();
  const c = JSON.parse(JSON.stringify(el));
  c.id = ceNewId();
  if (c.kind === "image") { const nk = ceNewId(); if (imgCache["ce_"+el.key]) imgCache["ce_"+nk] = imgCache["ce_"+el.key]; c.key = nk; }
  const g = ceGeom(c);
  if (g) ceSetGeom(c, { cx: g.cx+34, cy: g.cy+34, w: g.w, h: g.h, rot: g.rot });
  else if (c.kind === "line") { c.x1+=34; c.y1+=34; c.x2+=34; c.y2+=34; }
  ceElems.push(c); ceSelectedId = c.id; ceAfterChange();
}
function ceDeleteSelected() { if (ceSelectedId) ceRemoveLayer(ceSelectedId); }
function ceRemoveLayer(id) {
  ceCommit();
  ceElems = ceElems.filter(e => e.id !== id);
  if (ceSelectedId === id) ceSelectedId = null;
  ceAfterChange();
}
function ceSelectLayer(id) { ceSelectedId = id; ceAfterChange(); }
function ceMoveLayerIdx(idx, dir) {
  const ni = idx + dir;
  if (ni < 0 || ni >= ceElems.length) return;
  ceCommit();
  [ceElems[idx], ceElems[ni]] = [ceElems[ni], ceElems[idx]];
  ceAfterChange();
}
function ceMoveLayer(dir) {
  const idx = ceElems.findIndex(e => e.id === ceSelectedId);
  if (idx === -1) return;
  ceMoveLayerIdx(idx, dir);
}

const CE_LABELS = { ring:"⭕ Ring border", backdrop:"🌗 Backdrop", arctext:"➰ Arc text", freetext:"🆗 Text", sticker:"⭐ Sticker", line:"➖ Line", rect:"▭ Rectangle", ellipse:"⬤ Circle", triangle:"🔺 Triangle", star:"⭐ Star", heart:"❤️ Heart", shield:"🛡 Shield", image:"🖼 Image" };
function ceLayerName(el) {
  if (el.kind === "freetext" || el.kind === "arctext") return "“" + (el.text || "").slice(0,14) + "”";
  if (el.kind === "sticker") return el.text + " Sticker";
  return CE_LABELS[el.kind] || el.kind;
}
function ceRenderLayers() {
  const box = document.getElementById("ceLayers");
  if (!box) return;
  if (!ceElems.length) { box.innerHTML = '<p class="hint" style="margin:0">No elements yet</p>'; return; }
  box.innerHTML = [...ceElems].reverse().map((el, ri) => {
    const idx = ceElems.length - 1 - ri;
    return `<div class="ce-layer${el.id === ceSelectedId ? " selected" : ""}" onclick="ceSelectLayer('${el.id}')">
      <span class="ce-layer-name">${ceLayerName(el)}</span>
      <div class="ce-layer-btns">
        ${idx < ceElems.length-1 ? `<button onclick="ceMoveLayerIdx(${idx},1);event.stopPropagation()" title="Up">↑</button>` : ""}
        ${idx > 0 ? `<button onclick="ceMoveLayerIdx(${idx},-1);event.stopPropagation()" title="Down">↓</button>` : ""}
        <button onclick="ceRemoveLayer('${el.id}');event.stopPropagation()" title="Delete">✕</button>
      </div>
    </div>`;
  }).join("");
}

// ---------- floating toolbar ----------
function ceUpdateFloat() {
  const f = document.getElementById("ceFloat");
  if (!f) return;
  const el = ceElems.find(e => e.id === ceSelectedId);
  if (!el) { f.hidden = true; return; }
  let cxS, topS;
  const g = ceGeom(el);
  if (g) { const hs = ceHandles(el); const xs = hs.map(h=>h.x), ys = hs.map(h=>h.y); cxS = (Math.min(...xs)+Math.max(...xs))/2; topS = Math.min(...ys); }
  else if (el.kind === "ring" || el.kind === "arctext") { cxS = CE_SIZE/2; topS = CE_SIZE/2 - el.radius*D2S; }
  else if (el.kind === "backdrop") { cxS = CE_SIZE/2; topS = CE_SIZE/2 - el.holeR*D2S; }
  else if (el.kind === "line") { cxS = (el.x1+el.x2)/2*D2S; topS = Math.min(el.y1,el.y2)*D2S; }
  f.hidden = false;
  f.style.left = (cxS / CE_SIZE * 100) + "%";
  f.style.top = (Math.max(2, topS - 12) / CE_SIZE * 100) + "%";
}

// ---------- properties panel ----------
const CE_FONTS = [{v:'"Segoe UI",sans-serif',l:"Segoe UI"},{v:"Arial,sans-serif",l:"Arial"},{v:"Georgia,serif",l:"Georgia"},{v:"Impact,sans-serif",l:"Impact"},{v:'"Courier New",monospace',l:"Courier"},{v:'"Times New Roman",serif',l:"Times"}];
function ceRenderProps() {
  const box = document.getElementById("ceProps");
  if (!box) return;
  const el = ceElems.find(e => e.id === ceSelectedId);
  if (!el) { box.innerHTML = '<p class="hint" style="margin:0">Select an element on the canvas to edit it.</p>'; return; }

  const lbl = t => `<span style="font-size:0.78rem;color:var(--muted)">${t}</span>`;
  const color = (k,l) => `<label class="field" style="flex-direction:row;align-items:center;justify-content:space-between;gap:8px">${lbl(l)}<input type="color" value="${el[k]||"#ffffff"}" oninput="cePropSet('${k}',this.value)"></label>`;
  const swatches = (k) => `<div class="ce-swatches">${CE_PALETTE.map(c=>`<div class="ce-swatch" style="background:${c}" onclick="cePropSet('${k}','${c}')"></div>`).join("")}</div>`;
  const range = (k,l,mn,mx,st=1) => `<label class="field">${lbl(l)}<div class="ce-range-row"><input type="range" min="${mn}" max="${mx}" step="${st}" value="${el[k]??0}" oninput="cePropSet('${k}',+this.value);this.nextElementSibling.textContent=this.value"><span class="ce-range-val">${el[k]??0}</span></div></label>`;
  const text = (k,l) => `<label class="field">${lbl(l)}<input type="text" value="${(el[k]||"").replace(/"/g,"&quot;")}" oninput="cePropSet('${k}',this.value)"></label>`;
  const sel = (k,l,opts) => `<label class="field">${lbl(l)}<select onchange="cePropSet('${k}',this.value)">${opts.map(o=>`<option value="${o.v}"${el[k]===o.v?" selected":""}>${o.l}</option>`).join("")}</select></label>`;
  const chk = (k,l) => `<label class="ce-check-row"><input type="checkbox" ${el[k]?"checked":""} onchange="cePropSet('${k}',this.checked)"> ${l}</label>`;

  // shared fill controls (solid/gradient) for shapes & backdrop
  const fillCtrls = () => sel("fillType","Fill type",[{v:"solid",l:"Solid"},{v:"gradient",l:"Gradient"}]) +
    color("fill", el.fillType==="gradient" ? "Color 1" : "Fill") + swatches("fill") +
    (el.fillType==="gradient" ? color("fill2","Color 2") + range("gradAngle","Gradient angle",0,360) : "");
  const shapeExtras = () => color("stroke","Border color") + range("strokeW","Border width",0,50) + range("rotation","Rotation °",-180,180) + range("opacity","Opacity",0,1,0.01);

  const titleMap = { ring:"Ring border", backdrop:"Mat backdrop", arctext:"Arc text", freetext:"Text", sticker:"Sticker", line:"Line", rect:"Rectangle", ellipse:"Circle / oval", triangle:"Triangle", star:"Star", heart:"Heart", shield:"Shield", image:"Image" };
  let h = `<div class="ce-prop-head"><b>${titleMap[el.kind]||el.kind}</b><button class="ce-tb-btn ghost-tb" style="width:28px;height:28px;background:rgba(225,29,72,0.12);color:#e11d48" onclick="ceDeleteSelected()" title="Delete">🗑</button></div>`;

  if (el.kind === "ring") {
    h += range("radius","Radius",80,535) + range("width","Thickness",4,260) +
      sel("style","Style",[{v:"gradient",l:"Gradient"},{v:"solid",l:"Solid"},{v:"dashed",l:"Dashed"}]) +
      color("color1","Color 1") + swatches("color1") + (el.style!=="solid" ? color("color2","Color 2") : "") +
      range("opacity","Opacity",0,1,0.01);
  } else if (el.kind === "backdrop") {
    h += range("holeR","Photo hole",120,535) + fillCtrls() + range("opacity","Opacity",0,1,0.01) +
      `<p class="hint" style="margin:2px 0 0">Fills the frame and leaves a circular cut-out for the photo.</p>`;
  } else if (el.kind === "arctext") {
    h += text("text","Text") + sel("align","Position",[{v:"top",l:"Top arc"},{v:"bottom",l:"Bottom arc"}]) +
      range("radius","Radius",80,535) + range("size","Font size",12,180) + color("color","Color") + swatches("color") +
      chk("bold","Bold") + sel("font","Font",CE_FONTS) + range("opacity","Opacity",0,1,0.01);
  } else if (el.kind === "freetext" || el.kind === "sticker") {
    h += text("text", el.kind==="sticker" ? "Emoji / text" : "Text") + range("size","Size",12,360) +
      color("color","Color") + swatches("color") + chk("bold","Bold") + chk("italic","Italic") +
      sel("font","Font",CE_FONTS) + sel("align","Align",[{v:"center",l:"Center"},{v:"left",l:"Left"},{v:"right",l:"Right"}]) +
      color("stroke","Outline") + range("strokeW","Outline width",0,40) +
      range("rotation","Rotation °",-180,180) + range("opacity","Opacity",0,1,0.01);
  } else if (el.kind === "line") {
    h += color("color","Color") + swatches("color") + range("width","Thickness",1,80) + range("opacity","Opacity",0,1,0.01);
  } else if (el.kind === "ellipse") {
    h += range("rx","Width",8,540) + range("ry","Height",8,540) + fillCtrls() + shapeExtras();
  } else if (["rect","triangle","star","heart","shield"].includes(el.kind)) {
    h += range("w","Width",12,1000) + range("h","Height",12,1000) +
      (el.kind==="rect" ? range("cornerR","Corner radius",0,300) : "") + fillCtrls() + shapeExtras();
  } else if (el.kind === "image") {
    h += range("w","Width",12,1000) + range("h","Height",12,1000) + chk("round","Crop to circle") +
      range("rotation","Rotation °",-180,180) + range("opacity","Opacity",0,1,0.01) +
      `<button class="btn ghost small" style="width:100%;margin-top:4px" onclick="document.getElementById('ceImageInput').click()">🔄 Replace image</button>`;
  }
  box.innerHTML = h;
}

function cePropSet(key, val) {
  const el = ceElems.find(e => e.id === ceSelectedId);
  if (!el) return;
  el[key] = val;
  ceDraw(); ceUpdateFloat();
  // structural prop changes need a panel refresh (show/hide dependent controls)
  if (key === "fillType" || key === "style" || key === "align") ceRenderProps();
  if (key === "text") { ceRenderLayers(); }
}

// commit one undo step per property-editing session
(function ceWirePropHistory() {
  const box = document.getElementById("ceProps");
  if (!box) return;
  const begin = () => { if (!cePropEditing) { cePropSnap = JSON.stringify(ceElems); cePropEditing = true; } };
  const end = () => { if (cePropEditing) { if (cePropSnap && JSON.stringify(ceElems) !== cePropSnap) ceHistPush(cePropSnap); cePropEditing = false; } };
  box.addEventListener("pointerdown", begin);
  box.addEventListener("focusin", begin);
  document.addEventListener("pointerup", end);
  box.addEventListener("change", end);
  box.addEventListener("focusout", end);
})();

// ---------- left-panel tabs ----------
function ceTab(name) {
  document.querySelectorAll(".ce-rail-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".ce-panel").forEach(p => p.hidden = p.dataset.panel !== name);
}

// ---------- stickers / shapes / templates content ----------
const CE_STICKERS = ["⭐","🌟","✨","❤️","🔥","🎉","🎊","🏆","🥇","🎓","🗳️","✊","🙏","👑","💎","🌈","☀️","🌸","🦋","🇺🇸","🇳🇵","🇮🇳","✅","💯","📣","🎯","🕊️","🌹","⚡","💪"];
const CE_SHAPE_ICONS = {
  rect:    '<rect x="8" y="20" width="84" height="60" rx="4"/>',
  rrect:   '<rect x="8" y="20" width="84" height="60" rx="24"/>',
  ellipse: '<circle cx="50" cy="50" r="40"/>',
  triangle:'<polygon points="50,10 90,90 10,90"/>',
  star:    '<polygon points="50,6 61,38 95,38 67,58 78,92 50,70 22,92 33,58 5,38 39,38"/>',
  heart:   '<path d="M50 86 C-2 48 22 12 50 36 C78 12 102 48 50 86 Z"/>',
  shield:  '<path d="M14 16 H86 V52 Q86 86 50 94 Q14 86 14 52 Z"/>',
  line:    '<rect x="8" y="46" width="84" height="8" rx="4"/>',
};
function ceInitPanels() {
  // stickers
  const sg = document.getElementById("ceStickerGrid");
  if (sg) sg.innerHTML = CE_STICKERS.map(s => `<button class="ce-sticker-btn" onclick="ceAddSticker('${s}')">${s}</button>`).join("");
  // shapes
  const sh = document.getElementById("ceShapeGrid");
  if (sh) sh.innerHTML = Object.entries(CE_SHAPE_ICONS).map(([k,svg]) =>
    `<button class="ce-shape-btn" title="${k}" onclick="ceAdd('${k}')"><svg viewBox="0 0 100 100">${svg}</svg></button>`).join("");
  // templates
  const tg = document.getElementById("ceTemplateGrid");
  if (tg) {
    tg.innerHTML = CE_TEMPLATES.map((t,i) =>
      `<div class="ce-template-card" onclick="ceLoadTemplate(${i})"><canvas width="120" height="120" data-tpl="${i}"></canvas><span>${t.name}</span></div>`).join("");
    CE_TEMPLATES.forEach((t,i) => {
      const cv = tg.querySelector(`canvas[data-tpl="${i}"]`);
      if (cv) {
        const c = cv.getContext("2d");
        c.fillStyle = "#22224a"; c.beginPath(); c.arc(60,60,46,0,Math.PI*2); c.fill();
        drawCustomElements(c, 120, t.build(), () => { const c2 = cv.getContext("2d"); c2.fillStyle="#22224a"; c2.beginPath(); c2.arc(60,60,46,0,Math.PI*2); c2.fill(); drawCustomElements(c2,120,t.build(),()=>{}); });
      }
    });
  }
}

// starter templates (return fresh element arrays; ids assigned on load)
const CE_TEMPLATES = [
  { name:"Classic Ring", build:() => [
    { kind:"ring", radius:512, width:70, style:"gradient", color1:"#5b5bf0", color2:"#c026d3", opacity:1 },
    { kind:"arctext", text:"YOUR NAME", radius:476, size:62, color:"#ffffff", bold:true, font:'"Segoe UI",sans-serif', align:"top", opacity:1 },
    { kind:"arctext", text:"SUPPORTER", radius:476, size:50, color:"#ffffff", bold:true, font:'"Segoe UI",sans-serif', align:"bottom", opacity:1 },
  ]},
  { name:"Vote 2026", build:() => [
    { kind:"ring", radius:512, width:80, style:"solid", color1:"#e11d48", color2:"#e11d48", opacity:1 },
    { kind:"rect", x:330, y:846, w:420, h:120, fill:"#e11d48", fillType:"solid", stroke:"#ffffff", strokeW:8, cornerR:60, rotation:0, opacity:1 },
    { kind:"freetext", text:"VOTE 2026", x:540, y:906, size:74, color:"#ffffff", bold:true, italic:false, font:"Impact,sans-serif", align:"center", stroke:"none", strokeW:0, rotation:0, opacity:1 },
    { kind:"sticker", text:"🗳️", x:540, y:150, size:150, font:'"Segoe UI Emoji",sans-serif', align:"center", rotation:0, opacity:1 },
  ]},
  { name:"Graduate", build:() => [
    { kind:"ring", radius:512, width:72, style:"gradient", color1:"#b45309", color2:"#fbbf24", opacity:1 },
    { kind:"arctext", text:"CLASS OF 2026", radius:472, size:58, color:"#fffbeb", bold:true, font:"Georgia,serif", align:"top", opacity:1 },
    { kind:"sticker", text:"🎓", x:540, y:880, size:150, font:'"Segoe UI Emoji",sans-serif', align:"center", rotation:0, opacity:1 },
  ]},
  { name:"Festival", build:() => [
    { kind:"ring", radius:512, width:66, style:"gradient", color1:"#f43f5e", color2:"#fb923c", opacity:1 },
    { kind:"arctext", text:"SPRING FEST", radius:476, size:56, color:"#fff7ed", bold:true, font:'"Segoe UI",sans-serif', align:"top", opacity:1 },
    { kind:"sticker", text:"🌸", x:200, y:300, size:110, font:'"Segoe UI Emoji",sans-serif', align:"center", rotation:0, opacity:1 },
    { kind:"sticker", text:"🌸", x:880, y:300, size:110, font:'"Segoe UI Emoji",sans-serif', align:"center", rotation:0, opacity:1 },
  ]},
  { name:"Bold Mat", build:() => [
    { kind:"backdrop", holeR:400, fill:"#0ea5e9", fillType:"gradient", fill2:"#1e3a8a", gradAngle:90, opacity:0.95 },
    { kind:"freetext", text:"#PROUD", x:540, y:930, size:88, color:"#ffffff", bold:true, italic:false, font:"Impact,sans-serif", align:"center", stroke:"none", strokeW:0, rotation:0, opacity:1 },
  ]},
  { name:"Badge", build:() => [
    { kind:"ring", radius:512, width:30, style:"solid", color1:"#fbbf24", color2:"#fbbf24", opacity:1 },
    { kind:"shield", x:380, y:120, w:320, h:150, fill:"#fbbf24", fillType:"solid", stroke:"none", strokeW:0, rotation:0, opacity:1 },
    { kind:"freetext", text:"VIP", x:540, y:185, size:80, color:"#1e293b", bold:true, italic:false, font:"Impact,sans-serif", align:"center", stroke:"none", strokeW:0, rotation:0, opacity:1 },
  ]},
];
function ceLoadTemplate(i) {
  const t = CE_TEMPLATES[i]; if (!t) return;
  ceCommit();
  ceElems = t.build().map(spec => ({ id: ceNewId(), ...spec }));
  ceSelectedId = null;
  ceAfterChange();
  if (!document.getElementById("ceName").value.trim()) document.getElementById("ceName").value = t.name;
  toast(`"${t.name}" loaded — tweak it, then save.`);
}

// ---------- save / clear ----------
function ceSave() {
  if (!ceElems.length) { toast("Add at least one element first."); return; }
  const name = (document.getElementById("ceName")?.value || "").trim() || "My Custom Frame";
  const id = "cust_" + Date.now().toString(36);
  const frame = { id, name, type: "custom", elements: JSON.parse(JSON.stringify(ceElems)) };
  const frames = loadCustomFrames();
  frames.push(frame);
  try { saveCustomFrames(frames); } catch { toast("Storage full — remove some custom frames and retry."); return; }
  state.selectedFrameId = id;
  renderGallery(); renderPreview(); renderDashboard();
  showView("editor");
  toast(`"${name}" saved and selected — add your photo!`);
}
function ceClear() {
  if (ceElems.length && !confirm("Clear the whole canvas?")) return;
  ceCommit();
  ceElems = []; ceSelectedId = null;
  ceAfterChange();
}

// build the left-panel content once on load
ceInitPanels();

// ============================================================
// ---------- community gallery ----------
let commSort = "popular";

async function renderCommunity() {
  const grid = document.getElementById("communityGrid");
  if (!API_OK) {
    grid.innerHTML = `<div class="comm-empty">The community gallery needs the server.<br>Run <code>node server.js</code> and open http://localhost:3000.</div>`;
    return;
  }
  grid.innerHTML = `<div class="comm-empty">Loading frames…</div>`;
  const q = document.getElementById("commSearch").value.trim();
  let frames;
  try {
    frames = await api(`/frames?sort=${commSort}&q=${encodeURIComponent(q)}`);
  } catch {
    grid.innerHTML = `<div class="comm-empty">Couldn't reach the server.</div>`;
    return;
  }
  if (frames.length === 0) {
    grid.innerHTML = `<div class="comm-empty">No frames found${q ? ` for "${escapeHtml(q)}"` : ""}. Be the first to publish one!</div>`;
    return;
  }
  grid.innerHTML = "";
  for (const f of frames) {
    serverFrames[f.id] = f;
    const card = document.createElement("div");
    card.className = "comm-card";
    const cv = document.createElement("canvas");
    cv.width = 200; cv.height = 200;
    const tctx = cv.getContext("2d");
    tctx.save();
    tctx.beginPath();
    tctx.arc(100, 100, 100, 0, Math.PI * 2);
    tctx.clip();
    tctx.fillStyle = "#39406b";
    tctx.fillRect(0, 0, 200, 200);
    drawFrame(tctx, 200, f, () => renderCommunity());
    tctx.restore();
    card.appendChild(cv);
    const info = document.createElement("div");
    info.innerHTML = `<h4>${escapeHtml(f.name)}</h4>
      <div class="by">by ${escapeHtml(f.author)}${f.emailGate ? " · 📧" : ""}</div>
      <div class="dl">⬇ ${f.downloads} download${f.downloads === 1 ? "" : "s"}</div>`;
    card.appendChild(info);
    const use = document.createElement("button");
    use.className = "btn primary small";
    use.textContent = "Use this frame";
    use.onclick = () => {
      state.selectedFrameId = f.id;
      renderGallery();
      renderPreview();
      updateCounter();
      showView("editor");
      toast(`"${f.name}" selected — add your photo!`);
    };
    card.appendChild(use);
    grid.appendChild(card);
  }
}

let commSearchTimer = null;
document.getElementById("commSearch").addEventListener("input", () => {
  clearTimeout(commSearchTimer);
  commSearchTimer = setTimeout(renderCommunity, 300);
});
[["sortPopular", "popular"], ["sortRecent", "recent"]].forEach(([id, sort]) => {
  document.getElementById(id).addEventListener("click", () => {
    commSort = sort;
    document.getElementById("sortPopular").classList.toggle("selected", sort === "popular");
    document.getElementById("sortRecent").classList.toggle("selected", sort === "recent");
    renderCommunity();
  });
});

// ---------- dashboard ----------
let dashToken = 0;

function renderDashboard() {
  const el = document.getElementById("dashboardContent");
  const token = ++dashToken;
  const frames = loadCustomFrames();
  el.innerHTML = "";
  if (frames.length === 0) {
    el.innerHTML = `<div class="dash-empty">No campaigns yet.<br><br>
      <button class="btn primary" onclick="showView('builder')">🎨 Create your first frame</button></div>`;
    renderPublishedSection(el, token);
    return;
  }
  const leads = loadLeads();
  for (const frame of frames) {
    el.appendChild(dashCard(frame, {
      stats: `📈 <b>${downloadsFor(frame.id)}</b> downloads (this device) &nbsp;·&nbsp;
        📧 <b>${leads.filter(l => l.frameId === frame.id).length}</b> emails &nbsp;·&nbsp;
        ${frame.type === "config" && frame.config.emailGate ? "🔒 email gate ON" : "🔓 email gate off"}`,
      leads: leads.filter(l => l.frameId === frame.id),
      onDelete: () => deleteCustomFrame(frame.id),
      deleteLabel: "🗑 Delete",
    }));
  }
  renderPublishedSection(el, token);
}

async function renderPublishedSection(el, token) {
  if (!API_OK || !currentUser) return;
  let mine = [];
  try { mine = await api("/my/frames"); } catch { return; }
  if (token !== dashToken || mine.length === 0) return;
  const empty = el.querySelector(".dash-empty");
  if (empty) empty.remove();
  const h = document.createElement("p");
  h.className = "pricing-sub";
  h.style.textAlign = "left";
  h.textContent = "🌍 Published to the community (live stats, follows your account)";
  el.appendChild(h);
  for (const f of mine) {
    serverFrames[f.id] = f;
    el.appendChild(dashCard(f, {
      stats: `📈 <b>${f.downloads}</b> downloads (all supporters) &nbsp;·&nbsp;
        📧 <b>${f.leads.length}</b> emails &nbsp;·&nbsp;
        ${f.emailGate ? "🔒 email gate ON" : "🔓 email gate off"} &nbsp;·&nbsp; by ${escapeHtml(f.author)}`,
      leads: f.leads,
      onDelete: () => unpublishFrame(f.id),
      deleteLabel: "🗑 Unpublish",
    }));
  }
}

function dashCard(frame, { stats, leads, onDelete, deleteLabel }) {
  const card = document.createElement("div");
  card.className = "dash-card";

  const cv = document.createElement("canvas");
  cv.width = 168; cv.height = 168;
  const tctx = cv.getContext("2d");
  tctx.save();
  tctx.beginPath();
  tctx.arc(84, 84, 84, 0, Math.PI * 2);
  tctx.clip();
  tctx.fillStyle = "#39406b";
  tctx.fillRect(0, 0, 168, 168);
  drawFrame(tctx, 168, frame, () => renderDashboard());
  tctx.restore();
  card.appendChild(cv);

  const meta = document.createElement("div");
  meta.className = "dash-meta";
  meta.innerHTML = `<h3>${escapeHtml(frame.name)}</h3><div class="stats">${stats}</div>`;
  card.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "dash-actions";
  const link = frameLink(frame);
  actions.appendChild(actionBtn("🔗 Copy link", () => {
    if (link) copyText(link, "Campaign link copied!");
    else toast("PNG-overlay frames can't be shared by link — publish them instead.");
  }));
  actions.appendChild(actionBtn("📱 QR code", () => {
    if (link) showQRFor(link);
    else toast("PNG-overlay frames can't be shared by link/QR — publish them instead.");
  }));
  if (leads.length > 0) {
    actions.appendChild(actionBtn("⬇ Leads CSV", () => exportLeadsCsv(frame, leads)));
  }
  const delBtn = actionBtn(deleteLabel, onDelete);
  delBtn.classList.add("danger");
  actions.appendChild(delBtn);
  card.appendChild(actions);

  if (leads.length > 0) {
    const list = document.createElement("div");
    list.className = "lead-list";
    list.innerHTML = leads.map(l =>
      `<div>${escapeHtml(l.name || "—")} · ${escapeHtml(l.email)} · ${new Date(l.ts).toLocaleDateString()}</div>`
    ).join("");
    card.appendChild(list);
  }
  return card;
}

async function unpublishFrame(id) {
  const owned = loadOwned();
  const legacyKey = owned[id] ? `?key=${encodeURIComponent(owned[id].ownerKey)}` : "";
  try {
    await api(`/frames/${id}${legacyKey}`, { method: "DELETE" });
  } catch { /* already gone server-side */ }
  delete owned[id];
  saveOwned(owned);
  delete serverFrames[id];
  if (state.selectedFrameId === id) state.selectedFrameId = BUILTIN_FRAMES[0].id;
  renderDashboard();
  toast("Frame unpublished — it's no longer in the community gallery.");
}

function actionBtn(label, onclick) {
  const b = document.createElement("button");
  b.className = "btn ghost small";
  b.textContent = label;
  b.onclick = onclick;
  return b;
}

function exportLeadsCsv(frame, frameLeads) {
  const rows = [["name", "email", "date"], ...frameLeads.map(l =>
    [l.name || "", l.email, new Date(l.ts).toISOString()]
  )];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.download = `${frame.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-leads.csv`;
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.click();
  toast("Lead list exported.");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- pricing / pro / Nepal payments ----------
function unlockPro(msg) {
  state.isPro = true;
  localStorage.setItem("frameup_pro", "1");
  updateProUI();
  toast(msg || "⭐ Pro unlocked — watermark removed on all downloads!");
}

async function tryUnlock() {
  const code = document.getElementById("unlockInput").value.trim().toUpperCase();
  if (!code) { toast("Enter your unlock code first."); return; }
  if (API_OK) {
    try {
      await api("/unlock", { method: "POST", body: { code } });
      unlockPro();
      return;
    } catch { /* fall through to error toast */ }
  }
  toast("That code doesn't look right. Check your purchase email.");
}

async function payNepal(plan, provider) {
  if (!API_OK) { toast("Payments need the server — run `node server.js` and open http://localhost:3000."); return; }
  try {
    const r = await api("/pay/initiate", { method: "POST", body: { plan, provider } });
    if (r.provider === "esewa") {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = r.action;
      for (const [k, v] of Object.entries(r.fields)) {
        const i = document.createElement("input");
        i.type = "hidden"; i.name = k; i.value = v;
        form.appendChild(i);
      }
      document.body.appendChild(form);
      toast("Redirecting to eSewa…");
      form.submit();
    } else if (r.paymentUrl) {
      toast("Redirecting to Khalti…");
      location.href = r.paymentUrl;
    }
  } catch (e) {
    toast(e.message === "khalti_not_configured"
      ? "Khalti isn't configured — set KHALTI_SECRET_KEY and restart the server."
      : "Couldn't start the payment: " + e.message);
  }
}

let payCfgLoaded = false;
async function loadPayConfig() {
  if (payCfgLoaded || !API_OK) return;
  try {
    const c = await api("/pay/config");
    payCfgLoaded = true;
    document.getElementById("khaltiBtn").hidden = !c.khalti;
    document.getElementById("payMode").textContent =
      c.mode === "test" ? "(Test mode — eSewa sandbox, no real money moves.)" : "";
  } catch { /* server offline; buttons will explain */ }
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get("payfail")) {
    toast("Payment was cancelled or failed — you haven't been charged.");
    history.replaceState(null, "", "/");
    return;
  }
  const orderId = params.get("order");
  if (!orderId || !API_OK) return;
  try {
    const o = await api("/orders/" + orderId);
    if (o.status === "paid") {
      if (o.unlockCode) {
        unlockPro(`✅ Payment received! Pro unlocked. Your code: ${o.unlockCode} (save it for other devices)`);
      } else {
        toast("✅ Payment received! We'll deliver your custom template within the turnaround time.");
      }
    }
  } catch { /* unknown order — ignore */ }
  history.replaceState(null, "", "/");
}

function updateProUI() {
  document.getElementById("proBadge").hidden = !state.isPro;
  document.getElementById("watermarkNote").hidden = state.isPro;
  renderPreview();
}

function orderTemplate(plan) {
  const subjects = {
    campaign: "Campaign template order ($25)",
    pro: "Campaign Pro order ($50)",
    whitelabel: "White-label inquiry ($99/mo)",
  };
  const subject = encodeURIComponent("[FrameUp] " + (subjects[plan] || "Order"));
  const body = encodeURIComponent(
    "Hi! I'd like to order a custom frame.\n\nOrganization name:\nEvent / campaign:\nColors / logo:\nDeadline:\n\n(Attach your logo if you have one.)"
  );
  // In production this opens Stripe/Razorpay checkout; mailto keeps the demo dependency-free.
  location.href = `mailto:ssitnexus@gmail.com?subject=${subject}&body=${body}`;
  toast("Opening your email app to place the order…");
}

// ---------- modals, views, toast ----------
function openModal(id) {
  document.getElementById("modalOverlay").hidden = false;
  for (const m of ["emailModal", "qrModal"]) {
    document.getElementById(m).hidden = m !== id;
  }
}
function closeModal() {
  document.getElementById("modalOverlay").hidden = true;
}
document.getElementById("modalOverlay").addEventListener("click", e => {
  if (e.target.id === "modalOverlay") closeModal();
});

function showView(name) {
  for (const v of ["editor", "builder", "canvas", "community", "dashboard", "pricing"]) {
    document.getElementById("view-" + v).hidden = v !== name;
  }
  document.querySelectorAll(".navbtn").forEach(b =>
    b.classList.toggle("active", b.dataset.view === name)
  );
  if (name === "builder")  renderBuilder();
  if (name === "canvas")   { ceDraw(); ceRenderLayers(); ceRenderProps(); ceUpdateFloat(); ceUpdateHist(); }
  if (name === "community") renderCommunity();
  if (name === "dashboard") renderDashboard();
  if (name === "pricing")   loadPayConfig();
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- init ----------
(async function init() {
  const shared = decodeFrameFromHash();
  if (shared) {
    const frames = loadCustomFrames();
    if (!frames.some(f => f.id === shared.id)) {
      frames.push(shared);
      try { saveCustomFrames(frames); } catch { /* storage full — still usable this session */ }
    }
    state.selectedFrameId = shared.id;
    toast(`Campaign frame "${shared.name}" loaded — add your photo!`);
  } else {
    state.selectedFrameId = BUILTIN_FRAMES[0].id;
  }
  updateProUI();
  renderGallery();
  renderFormatChips();
  renderPreview();
  updateCounter();

  // auth gate — but campaign supporters arriving via a shared QR/link (/f/:id)
  // get to use the frame WITHOUT an account.
  const sharedLink = location.pathname.match(/^\/f\/([A-Za-z0-9_-]+)$/);
  if (API_OK) {
    try { currentUser = await api("/auth/me"); } catch { currentUser = null; }
    if (currentUser) await onAuthed();
    else if (sharedLink) await enterSupporterMode();
    else showAuthOverlay();
  } else {
    toast("Run `node server.js` and open http://localhost:3000 — the app needs its server.");
  }
})();

// Supporter mode: a logged-out visitor who scanned a campaign QR / opened a share
// link. Skip the login wall, load the shared frame, and let them add a photo and
// download. A "Log in" button stays available for when they want their own account.
async function enterSupporterMode() {
  document.body.classList.add("supporter-mode");
  document.getElementById("authOverlay").hidden = true;
  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn) loginBtn.hidden = false;
  showView("editor");
  await loadSharedServerFrame();
}

// short server links: /f/:id (called after auth)
async function loadSharedServerFrame() {
  const fm = location.pathname.match(/^\/f\/([A-Za-z0-9_-]+)$/);
  if (!fm || !API_OK) return;
  try {
    const f = await api("/frames/" + fm[1]);
    serverFrames[f.id] = f;
    state.selectedFrameId = f.id;
    renderGallery();
    renderPreview();
    updateCounter();
    toast(`Campaign frame "${f.name}" loaded — add your photo!`);
  } catch {
    toast("That campaign frame wasn't found — it may have been unpublished.");
  }
}
