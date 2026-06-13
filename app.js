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
  errEl.textContent = "";
  try {
    currentUser = await api(authMode === "login" ? "/auth/login" : "/auth/register", {
      method: "POST",
      body: authMode === "login" ? { email, password } : { name, email, password },
    });
    await onAuthed();
  } catch (e) {
    errEl.textContent = AUTH_ERRORS[e.message] || "Something went wrong (" + e.message + ").";
  }
}

async function onAuthed() {
  document.getElementById("authOverlay").hidden = true;
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
  }
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
  for (const v of ["editor", "builder", "community", "dashboard", "pricing"]) {
    document.getElementById("view-" + v).hidden = v !== name;
  }
  document.querySelectorAll(".navbtn").forEach(b =>
    b.classList.toggle("active", b.dataset.view === name)
  );
  if (name === "builder") renderBuilder();
  if (name === "community") renderCommunity();
  if (name === "dashboard") renderDashboard();
  if (name === "pricing") loadPayConfig();
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

  // auth gate: every service requires a logged-in account
  if (API_OK) {
    try { currentUser = await api("/auth/me"); } catch { currentUser = null; }
    if (currentUser) await onAuthed();
    else showAuthOverlay();
  } else {
    toast("Run `node server.js` and open http://localhost:3000 — the app needs its server.");
  }
})();

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
