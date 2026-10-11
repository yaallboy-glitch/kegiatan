/* ============================================================
   BMS app — shared core: auth · api · shell (nav bawah)
   ============================================================ */
const API = "https://kegiatan-api.newbrigademudasoropati.workers.dev";
const CLIENT_ID = "358445361659-e0a67dcf6dakkf6ak74a0kuu9v49a07v.apps.googleusercontent.com";
const REDIRECT_URI = "https://appassets.androidplatform.net/auth-cb.html";
const tok = () => localStorage.getItem("token") || "";
const setTok = t => localStorage.setItem("token", t);
const logout = () => { localStorage.removeItem("token"); location.href = "index.html"; };

const hdr = () => ({ "Content-Type": "application/json", "Authorization": "Bearer " + tok() });

async function api(path, opt = {}) {
  let r;
  try { r = await fetch(API + path, { headers: hdr(), ...opt }); }
  catch (e) { throw new Error("Tidak bisa menghubungi server. Cek koneksi internet. (" + e.message + ")"); }
  if (r.status === 401) { logout(); throw new Error("Sesi habis, silakan login lagi."); }
  const raw = await r.text();
  let d = {};
  if (raw) { try { d = JSON.parse(raw); } catch { throw new Error("Respons server tidak valid (status " + r.status + ")."); } }
  else if (!r.ok) throw new Error("Error " + r.status);
  if (!r.ok) throw new Error(d.error || "Error " + r.status);
  return d;
}
const apiPost = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) });
const apiPatch = (p, body) => api(p, { method: "PATCH", body: JSON.stringify(body) });
const apiDel = p => api(p, { method: "DELETE" });

async function apiUpload(path, fd) {
  const r = await fetch(API + path, { method: "POST", headers: { Authorization: "Bearer " + tok() }, body: fd });
  if (r.status === 401) { logout(); throw new Error("Sesi habis, silakan login lagi."); }
  const raw = await r.text(); let d = {};
  if (raw) { try { d = JSON.parse(raw); } catch {} }
  if (!r.ok) throw new Error(d.error || "Upload gagal (status " + r.status + ")");
  return d;
}
async function fetchBlob(path) {
  const r = await fetch(API + path, { headers: { Authorization: "Bearer " + tok() } });
  if (r.status === 401) { logout(); throw new Error("Sesi habis, silakan login lagi."); }
  if (!r.ok) throw new Error("Gagal mengambil berkas (status " + r.status + ")");
  return r.blob();
}

/* ---- helpers ---- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rp = n => "Rp " + Number(n || 0).toLocaleString("id-ID");
const fmtTgl = s => { try { return new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); } catch { return s || "-"; } };
const fmtTglPanjang = s => { try { return new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return s || "-"; } };
const initials = n => (String(n || "?").trim()[0] || "?").toUpperCase();
const isAdmin = m => !!m && (m.role === "admin" || m.role === "ketua");
function showErr(id, m) { const el = document.getElementById(id); if (!el) return; el.textContent = m; el.style.display = "block"; }
function clearErr(id) { const el = document.getElementById(id); if (!el) return; el.style.display = "none"; }
let _toastT;
function toast(msg) { const t = document.getElementById("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove("show"), 2600); }
function dlBlob(blob, name) {
  if (window.Android && typeof window.Android.saveBase64 === "function") {
    const rd = new FileReader();
    rd.onload = () => {
      const b64 = String(rd.result).split(",")[1] || "";
      const ok = window.Android.saveBase64(name, b64);
      toast(ok ? name + " → folder Download" : "Gagal menyimpan file");
    };
    rd.readAsDataURL(blob);
    return;
  }
  const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
}

function confirmBox(msg, title) {
  return new Promise(res => {
    const o = document.getElementById("confirmOv");
    if (!o) { res(window.confirm(msg)); return; }
    o.querySelector("#confirmTitle").textContent = title || "Konfirmasi";
    o.querySelector("#confirmMsg").textContent = msg || "Lanjutkan?";
    o.classList.add("open");
    const ok = o.querySelector("#confirmOk"), no = o.querySelector("#confirmNo");
    const done = v => { o.classList.remove("open"); ok.onclick = no.onclick = null; res(v); };
    ok.onclick = () => done(true); no.onclick = () => done(false);
  });
}
function decodeJwt(jwt) {
  try { const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(atob(p).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""))); }
  catch { return {}; }
}
/* ===== AUTH ===== */
let me = null;
async function handleCredential(credential) {
  const d = await apiPost("/auth/google", { credential });
  if (!d.token) throw new Error("Server tidak mengirim token.");
  setTok(d.token);
  if (d.needs_name) {
    document.getElementById("loginView").style.display = "none";
    document.getElementById("namaInput").value = decodeJwt(credential).name || "";
    document.getElementById("namaOv").classList.add("open");
    return;
  }
  location.reload();
}
async function submitNama() {
  const btn = document.getElementById("namaBtn"), val = document.getElementById("namaInput").value.trim();
  clearErr("namaErr");
  if (val.length < 2) return showErr("namaErr", "Isi nama asli minimal 2 karakter.");
  btn.disabled = true; btn.textContent = "Menyimpan…";
  try {
    const d = await apiPost("/auth/set-name", { nama: val });
    if (!d.token) throw new Error("Server tidak mengirim token baru.");
    setTok(d.token); location.reload();
  } catch (e) { showErr("namaErr", e.message); btn.disabled = false; btn.textContent = "Simpan & Lanjutkan"; }
}
function initGoogle() {
  const box = document.getElementById("gBtn");
  if (!box || tok()) return;
  if (typeof google === "undefined" || !google.accounts) { setTimeout(initGoogle, 400); return; }
  try {
    google.accounts.id.initialize({ client_id: CLIENT_ID, callback: r => runAuth(r.credential) });
    google.accounts.id.renderButton(box, { theme: "filled_black", size: "large", width: 272, text: "continue_with" });
  } catch (e) { showErr("loginErr", "Gagal memuat tombol Google: " + e.message); }
}
async function runAuth(c) { clearErr("loginErr"); try { await handleCredential(c); } catch (e) { showErr("loginErr", e.message); } }
function googleAuthUrl() {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "token",
    scope: "openid email profile",
    prompt: "select_account"
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}
function doGoogleLogin() {
  const inApp = (window.Android && typeof Android.isApp === "function" && Android.isApp());
  clearErr("loginErr");
  if (inApp) {
    if (typeof Android.loginGoogle === "function") { Android.loginGoogle(); return; }
    showErr("loginErr", "Fitur login tidak tersedia."); return;
  }
  if (typeof google !== "undefined" && google.accounts && google.accounts.id) { google.accounts.id.prompt(); }
  else showErr("loginErr", "Gagal memuat Google. Cek koneksi internet.");
}
window.__onGoogleIdToken = async function (idt) {
  try { await handleCredential(idt); } catch (e) { showErr("loginErr", e.message); }
};
window.__onGoogleError = function (m) { showErr("loginErr", m || "Login gagal."); };
initGoogle();
async function loadMe() { try { me = await api("/auth/me"); return me; } catch (e) { return null; } }
function requireAuth() { if (!tok()) { location.replace("index.html"); return false; } return true; }

/* ===== SHELL: bottom nav + profil + sheet "Lainnya" ===== */
const IC = {
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/></svg>',
  bendahara: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19"/><path d="M6.5 15h4"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.8l2 2h7.2A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/></svg>',
  footage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><rect x="2.5" y="6" width="14" height="12" rx="2.5"/><path d="M16.5 10.5 21.5 7.5v9l-5-3"/></svg>',
  lainnya: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11 13.5v3a2 2 0 0 0 4 0v-2"/></svg>',
  users: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
  ig: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>',
  tt: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 4c.5 2.5 2 4 4.5 4.2"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 3l8 3.5v5c0 5-3.5 8.5-8 9.5-4.5-1-8-4.5-8-9.5v-5z"/><path d="M9 12l2 2 4-4"/></svg>',
  out: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>'
};
const NAV = [
  { href: "index.html", label: "Dashboard", ic: "dash" },
  { href: "bendahara.html", label: "Bendahara", ic: "bendahara" },
  { href: "file.html", label: "File", ic: "file" },
  { href: "footage.html", label: "Footage", ic: "footage" },
  { lainnya: true, label: "Lainnya", ic: "lainnya" }
];
/* ---- GLASS NAV: lekukan + bubble berpindah (bentuk digambar lewat clip-path) ---- */
function initGlassNav() {
  const nav = document.querySelector(".bottomNav");
  if (!nav) return null;
  const bar = nav.querySelector(".bnBar"), bubble = nav.querySelector(".bnBubble");
  const icons = [...bubble.children], items = [...nav.querySelectorAll(".bnItem")];
  const N = items.length, H = 72, HW = 36, K = 20, D = 30, DUR = 880;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = nav.clientWidth || 360, cur = items.findIndex(el => el.classList.contains("active")), busy = false;
  const cx = i => W / (N * 2) * (2 * i + 1);
  const clamp = v => Math.min(1, Math.max(0, v)), seg = (p, a, b) => clamp((p - a) / (b - a));
  const sine = t => -(Math.cos(Math.PI * t) - 1) / 2;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const path = (x, d) => { const l = x - HW, r = x + HW;
    return `M0,0 H${l} C${l + K},0 ${x - K},${d} ${x},${d} C${x + K},${d} ${r - K},0 ${r},0 H${W} V${H} H0 Z`; };
  const draw = (x, d, y) => { bar.style.clipPath = `path('${path(x, d)}')`; bubble.style.transform = `translate(${x - 24}px,${y}px)`; };
  const showIcon = i => icons.forEach((s, j) => s.style.opacity = j === i ? 1 : 0);
  const rest = () => {
    W = nav.clientWidth || 360;
    if (cur < 0) { bar.style.clipPath = `path('M0,0 H${W} V${H} H0 Z')`; bubble.style.opacity = 0; return; }
    bubble.style.opacity = 1; showIcon(cur); draw(cx(cur), D, D - 34);
  };
  function go(to) {
    if (busy || to === cur || to < 0 || to >= N) return;
    if (reduce) { cur = to; items.forEach((el, j) => el.classList.toggle("active", j === to)); rest(); return; }
    busy = true; W = nav.clientWidth || 360;
    const from = cur, x1 = cx(to), x0 = from < 0 ? x1 : cx(from), D0 = from < 0 ? 0 : D, t0 = performance.now();
    let swapped = false;
    items.forEach(el => el.classList.remove("active"));
    bubble.style.opacity = 1; if (from >= 0) showIcon(from);
    (function step(now) {
      const p = Math.min(1, (now - t0) / DUR);
      const close = sine(seg(p, 0, .36)), move = ease(seg(p, .18, .82)), open = sine(seg(p, .64, 1));
      const d = p < .5 ? D0 * (1 - close) : D * open;
      const arc = Math.sin(move * Math.PI) * 18;
      draw(lerp(x0, x1, move), d, d - 34 - (1 - d / D) * 20 - arc);
      if (move > .5 && !swapped) { swapped = true; showIcon(to); }
      if (p < 1) return requestAnimationFrame(step);
      cur = to; items[to].classList.add("active"); rest(); busy = false;
    })(t0);
  }
  addEventListener("resize", () => { if (!busy) rest(); });
  rest();
  return { go };
}

const FOTO_KEY = () => "bmsFoto:" + ((me && me.username) || "anon");
/* Nav dibuat SEKALI & langsung saat halaman dimuat (tidak menunggu fetch /auth/me) supaya tidak berkedip */
function ensureNav() {
  if (document.querySelector(".bottomNav")) return;
  const page = location.pathname.split("/").pop() || "index.html";
  const navHtml = NAV.map(n => n.lainnya
    ? '<button class="bnItem" id="bnLainnya" aria-haspopup="dialog">' + IC.lainnya + '<span>' + n.label + '</span></button>'
    : '<a class="bnItem' + (page === n.href ? " active" : "") + '" href="' + n.href + '"' + (page === n.href ? ' aria-current="page"' : "") + '>' + IC[n.ic] + '<span>' + n.label + '</span></a>').join("");
  const bubbleIcons = NAV.map(n => n.lainnya ? IC.lainnya : IC[n.ic]).join("");
  const el = document.createElement("nav");
  el.className = "bottomNav"; el.setAttribute("aria-label", "Navigasi utama");
  el.innerHTML = '<div class="bnBar"></div><div class="bnTabs">' + navHtml + '</div><div class="bnBubble" aria-hidden="true">' + bubbleIcons + '</div>';
  document.body.appendChild(el);
  const navItems = [...document.querySelectorAll(".bnItem")];
  window._bn = initGlassNav();
  navItems.forEach(item => {
    if (item.tagName === "A" && item.href && item.href !== location.href) {
      item.addEventListener("click", e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const from = NAV.findIndex(n => n.href === (location.pathname.split("/").pop() || "index.html"));
        const to = NAV.findIndex(n => n.href === new URL(item.href).pathname.split("/").pop());
        if (window._bn) window._bn.go(to); else { navItems.forEach(el => el.classList.remove("active")); item.classList.add("active"); }
        document.body.classList.add("pageTransitionOut", to > from ? "pageTransitionForward" : "pageTransitionBack");
        setTimeout(() => { location.href = item.href; }, 920);
      });
    }
    item.addEventListener("pointerdown", () => item.classList.add("is-pressed"), { passive: true });
    item.addEventListener("pointerup", () => item.classList.remove("is-pressed"), { passive: true });
    item.addEventListener("pointercancel", () => item.classList.remove("is-pressed"), { passive: true });
  });
  document.getElementById("bnLainnya").onclick = () => document.getElementById("sheetOv").classList.add("open");
}
function renderShell() {
  const page = location.pathname.split("/").pop() || "index.html";
  const foto = localStorage.getItem(FOTO_KEY());
  const admin = isAdmin(me);
    ensureNav();
document.getElementById("appShell").innerHTML =
    '<div class="ov ovBottom" id="sheetOv"><div class="sheet">'
    + '<div class="sheetHandle"></div><p class="sheetTitle">Menu Lainnya</p>'
    + '<a class="sheetItem" href="index.html#pengumuman">' + IC.bell + 'Pengumuman</a>'
    + '<a class="sheetItem" href="anggota.html">' + IC.users + 'Anggota</a>'
    + '<a class="sheetItem" href="https://www.instagram.com/bmsofficial.id" target="_blank" rel="noopener">' + IC.ig + 'Instagram</a>'
    + '<a class="sheetItem" href="https://www.tiktok.com/@kabarbms.id" target="_blank" rel="noopener">' + IC.tt + 'TikTok</a>'
    + '<button class="sheetItem" id="shProfil">' + IC.user + 'Profil Saya</button>'
    + (admin ? '<a class="sheetItem" href="anggota.html">' + IC.shield + 'Panel Admin</a>' : "")
    + '<button class="sheetItem danger" id="shLogout">' + IC.out + 'Logout</button>'
    + '</div></div>'
    + '<div class="ov" id="profilOv"><div class="ovBox">'
    + '<div class="profilHead"><div class="avatarBig" id="pvFoto"></div><div class="profilWho"><b id="pvNama">-</b><span class="chip gold" id="pvRole">-</span></div></div>'
    + '<p class="ovText">Foto profil disimpan di perangkat ini.</p>'
    + '<input type="file" id="pvInput" accept="image/*" hidden>'
    + '<div class="btnRow"><button class="btn btn-ghost btn-sm" id="pvGanti">' + IC.cam + 'Ganti Foto</button><button class="btn btn-ghost btn-sm" id="pvTutup">Tutup</button></div>'
    + '</div></div>'
    + '<div class="ov" id="confirmOv"><div class="ovBox ovCenter">'
    + '<div class="ovIcon danger">' + IC.trash + '</div><h3 id="confirmTitle">Konfirmasi</h3><p class="ovText" id="confirmMsg"></p>'
    + '<div class="ovActions"><button class="btn btn-ghost btn-sm" id="confirmNo">Batal</button><button class="btn btn-danger btn-sm" id="confirmOk">Ya, lanjutkan</button></div>'
    + '</div></div>'
    + '<div id="toast" role="status"></div>';
  const av = document.getElementById("avatarBtn");
  if (av) { if (foto) { av.textContent = ""; av.style.backgroundImage = 'url("' + foto + '")'; } else av.textContent = initials(me && me.nama); av.onclick = openProfil; }
  document.getElementById("shProfil").onclick = () => { document.getElementById("sheetOv").classList.remove("open"); openProfil(); };
  document.getElementById("shLogout").onclick = async () => { if (await confirmBox("Keluar dari aplikasi?", "Logout")) logout(); };
  document.querySelectorAll(".ov").forEach(o => o.addEventListener("click", e => { if (e.target === o && o.id !== "namaOv") o.classList.remove("open"); }));
  fillProfil();
  const pIn = document.getElementById("pvInput");
  document.getElementById("pvGanti").onclick = () => pIn.click();
  document.getElementById("pvTutup").onclick = () => document.getElementById("profilOv").classList.remove("open");
  pIn.onchange = () => { const f = pIn.files[0]; if (f) simpanFoto(f); pIn.value = ""; };
}
function openProfil() { fillProfil(); document.getElementById("profilOv").classList.add("open"); }
function fillProfil() {
  const foto = localStorage.getItem(FOTO_KEY());
  const pf = document.getElementById("pvFoto");
  if (!pf) return;
  if (foto) { pf.textContent = ""; pf.style.backgroundImage = 'url("' + foto + '")'; } else pf.textContent = initials(me && me.nama);
  document.getElementById("pvNama").textContent = (me && me.nama) || "-";
  document.getElementById("pvRole").textContent = (me && me.role) || "-";
}
function simpanFoto(file) {
  if (!file.type.startsWith("image/")) return toast("File bukan gambar.");
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 256, sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const data = cv.toDataURL("image/jpeg", .85);
      localStorage.setItem(FOTO_KEY(), data);
      fillProfil();
      const av = document.getElementById("avatarBtn");
      if (av) { av.textContent = ""; av.style.backgroundImage = 'url("' + data + '")'; }
      toast("Foto profil diperbarui");
    };
    img.onerror = () => toast("Gambar tidak bisa dibaca.");
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

/* hindari flash login saat pindah antar halaman */
if (tok()) {
  const loginView = document.getElementById("loginView"), appView = document.getElementById("appView");
  if (loginView) loginView.style.display = "none";
  if (appView) appView.hidden = false;
  ensureNav();
}
