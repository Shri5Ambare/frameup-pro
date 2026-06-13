/* FrameUp Admin panel — user management, frames, orders, leads. */

let me = null;

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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(ts) { return new Date(ts).toLocaleDateString(); }

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* already gone */ }
  location.href = "/";
}

// ---------- tabs ----------
const TABS = ["overview", "users", "frames", "orders", "leads"];
function showTab(name) {
  for (const t of TABS) document.getElementById("tab-" + t).hidden = t !== name;
  document.querySelectorAll(".admin-tabs .chip").forEach(c =>
    c.classList.toggle("selected", c.dataset.tab === name));
  const loaders = { overview: loadStats, users: loadUsers, frames: loadFrames, orders: loadOrders, leads: loadLeads };
  loaders[name]();
}

// ---------- overview ----------
async function loadStats() {
  const s = await api("/admin/stats");
  const cards = [
    [s.users, "Users"], [s.banned, "Banned"], [s.frames, "Frames"],
    [s.downloads, "Downloads"], [s.leads, "Leads"], [s.orders, "Orders"],
    ["रू" + s.revenueNpr.toLocaleString(), "Revenue (paid)"],
  ];
  document.getElementById("statGrid").innerHTML = cards.map(([num, lbl]) =>
    `<div class="stat-card"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join("");
}

// ---------- users ----------
async function loadUsers() {
  const q = document.getElementById("userSearch").value.trim();
  const users = await api("/admin/users?q=" + encodeURIComponent(q));
  const rows = users.map(u => `
    <tr>
      <td><b>${escapeHtml(u.name)}</b><br><span style="color:var(--muted)">${escapeHtml(u.email)}</span></td>
      <td><span class="pill ${u.role === "admin" ? "admin-role" : "user-role"}">${u.role}</span></td>
      <td>${u.banned ? '<span class="pill bad">banned</span>' : '<span class="pill ok">active</span>'}</td>
      <td>${u.frames}</td>
      <td>${u.hasGoogle ? "Google" : "Email"}</td>
      <td>${fmtDate(u.created)}</td>
      <td>
        <div class="row-actions">
          ${u.id === me.id ? '<span class="pill ok">you</span>' : `
            <button class="btn small ghost" onclick="userAction(${u.id}, '${u.banned ? "unban" : "ban"}')">${u.banned ? "✅ Unban" : "🚫 Ban"}</button>
            <button class="btn small ghost" onclick="userAction(${u.id}, '${u.role === "admin" ? "demote" : "promote"}')">${u.role === "admin" ? "⬇ Demote" : "⬆ Make admin"}</button>
            <button class="btn small danger" onclick="deleteUser(${u.id}, '${escapeHtml(u.email)}')">🗑 Delete</button>`}
        </div>
      </td>
    </tr>`).join("");
  document.getElementById("usersTable").innerHTML = `
    <tr><th>User</th><th>Role</th><th>Status</th><th>Frames</th><th>Login</th><th>Joined</th><th>Actions</th></tr>${rows}`;
}

async function userAction(id, action) {
  try {
    await api("/admin/users/" + id, { method: "POST", body: { action } });
    toast("Done — user " + action + (action.endsWith("e") ? "d" : "ned") + ".");
    loadUsers();
  } catch (e) { toast("Failed: " + e.message); }
}

async function deleteUser(id, email) {
  if (!confirm(`Delete ${email}?\n\nThis removes the account AND all frames + leads they own. This cannot be undone.`)) return;
  try {
    await api("/admin/users/" + id, { method: "DELETE" });
    toast("User deleted.");
    loadUsers();
  } catch (e) { toast("Failed: " + e.message); }
}

let searchTimer = null;
document.getElementById("userSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadUsers, 300);
});

// ---------- frames ----------
async function loadFrames() {
  const frames = await api("/admin/frames");
  const rows = frames.map(f => `
    <tr>
      <td><b>${escapeHtml(f.name)}</b><br><span style="color:var(--muted)">by ${escapeHtml(f.author)}</span></td>
      <td>${escapeHtml(f.owner_email || "—")}</td>
      <td>${f.type}</td>
      <td>${f.downloads}</td>
      <td>${f.leads}${f.email_gate ? " 🔒" : ""}</td>
      <td>${fmtDate(f.created)}</td>
      <td>
        <div class="row-actions">
          <button class="btn small ghost" onclick="window.open('/f/${f.id}','_blank')">👁 View</button>
          <button class="btn small danger" onclick="deleteFrame('${f.id}', '${escapeHtml(f.name)}')">🗑 Delete</button>
        </div>
      </td>
    </tr>`).join("");
  document.getElementById("framesTable").innerHTML = `
    <tr><th>Frame</th><th>Owner</th><th>Type</th><th>Downloads</th><th>Leads</th><th>Created</th><th>Actions</th></tr>${rows}`;
}

async function deleteFrame(id, name) {
  if (!confirm(`Delete frame "${name}" and its leads?`)) return;
  try {
    await api("/admin/frames/" + id, { method: "DELETE" });
    toast("Frame deleted.");
    loadFrames();
  } catch (e) { toast("Failed: " + e.message); }
}

// ---------- orders ----------
async function loadOrders() {
  const orders = await api("/admin/orders");
  const rows = orders.map(o => `
    <tr>
      <td><code>${o.id}</code></td>
      <td>${escapeHtml(o.user_email || "—")}</td>
      <td>${o.plan}</td>
      <td>रू${o.amount.toLocaleString()}</td>
      <td>${o.provider}</td>
      <td>${o.status === "paid" ? '<span class="pill ok">paid</span>' : '<span class="pill user-role">' + o.status + "</span>"}</td>
      <td>${o.unlock_code ? "<code>" + o.unlock_code + "</code>" : "—"}</td>
      <td>${fmtDate(o.created)}</td>
    </tr>`).join("");
  document.getElementById("ordersTable").innerHTML = `
    <tr><th>Order</th><th>User</th><th>Plan</th><th>Amount</th><th>Provider</th><th>Status</th><th>Unlock code</th><th>Date</th></tr>${rows || ""}`;
  if (!orders.length) document.getElementById("ordersTable").innerHTML += `<tr><td colspan="8" style="color:var(--muted)">No orders yet.</td></tr>`;
}

// ---------- leads ----------
async function loadLeads() {
  const leads = await api("/admin/leads");
  const rows = leads.map(l => `
    <tr>
      <td>${escapeHtml(l.name || "—")}</td>
      <td>${escapeHtml(l.email)}</td>
      <td>${escapeHtml(l.frame_name)}</td>
      <td>${fmtDate(l.ts)}</td>
    </tr>`).join("");
  document.getElementById("leadsTable").innerHTML = `
    <tr><th>Name</th><th>Email</th><th>Frame</th><th>Date</th></tr>${rows}`;
  if (!leads.length) document.getElementById("leadsTable").innerHTML += `<tr><td colspan="4" style="color:var(--muted)">No leads collected yet.</td></tr>`;
}

// ---------- init ----------
(async function init() {
  try {
    me = await api("/auth/me");
  } catch {
    document.getElementById("adminDenied").hidden = false;
    return;
  }
  if (me.role !== "admin") {
    document.getElementById("adminDenied").hidden = false;
    return;
  }
  document.getElementById("userChip").hidden = false;
  document.getElementById("userName").textContent = me.name;
  document.getElementById("userAvatar").textContent = (me.name[0] || "?").toUpperCase();
  document.getElementById("adminPanel").hidden = false;
  loadStats();
})();
