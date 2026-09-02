// ============================================================
// LIVE CHAT MENGAMBANG — dipakai di semua halaman (Dashboard,
// Bendahara, File, Footage, Export). Backend-nya (/chat GET,
// POST, DELETE, /chat/typing GET/POST) ada di Worker.
//
// Mandiri: tidak perlu variabel/fungsi khusus dari halaman yang
// menyertakannya, cukup <script src="chat-widget.js"></script>
// di akhir <body> (setelah token & (opsional) `me` disiapkan).
// ============================================================
(function () {
  function getToken() {
    try { if (typeof token !== "undefined" && token) return token; } catch (e) {}
    return localStorage.getItem("token") || "";
  }
  function getApiBase() {
    try { if (typeof API !== "undefined" && API) return API; } catch (e) {}
    return "https://kegiatan-api.newbrigademudasoropati.workers.dev";
  }
  function getMe() {
    try { if (typeof me !== "undefined" && me) return me; } catch (e) {}
    return {};
  }

  // Jangan tampilkan widget kalau belum login sama sekali.
  if (!getToken()) return;

  var API_BASE = getApiBase();
  var POLL_MS = 4000;
  var TYPING_POLL_MS = 2500;
  var lastId = 0;
  var panelOpen = false;
  var isFullscreen = false;
  var messages = [];
  var unread = 0;
  var pollTimer = null;
  var typingPollTimer = null;
  var typingPingTimer = null;
  var lastTypingPing = 0;

  // ---------------- STYLE ----------------
  // Tema: Merah - Biru - Emas - Putih (profesional)
  var style = document.createElement("style");
  style.textContent =
    ":root{--ktc-red:#b91c1c;--ktc-red2:#dc2626;--ktc-blue:#1e3a8a;--ktc-blue2:#1d4ed8;" +
    "--ktc-gold:#d4af37;--ktc-gold2:#f0c94a;--ktc-white:#f8fafc}" +

    "#ktchat-bubble{position:fixed;bottom:22px;right:22px;width:58px;height:58px;border-radius:50%;" +
    "background:linear-gradient(135deg,var(--ktc-red2),var(--ktc-blue));color:#fff;border:2px solid var(--ktc-gold);" +
    "box-shadow:0 10px 30px rgba(0,0,0,.5);cursor:pointer;z-index:250;display:flex;align-items:center;" +
    "justify-content:center;padding:0;transition:transform .15s ease}" +
    "#ktchat-bubble:hover{transform:scale(1.06)}" +
    "#ktchat-bubble svg{width:26px;height:26px}" +
    "#ktchat-badge{position:absolute;top:-3px;right:-3px;background:var(--ktc-red2);color:#fff;font-size:10.5px;" +
    "font-weight:700;border-radius:999px;min-width:19px;height:19px;display:none;align-items:center;" +
    "justify-content:center;padding:0 4px;border:2px solid #0c0c0e}" +

    "#ktchat-panel{position:fixed;bottom:92px;right:22px;width:330px;max-width:calc(100vw - 32px);height:460px;" +
    "max-height:calc(100vh - 130px);max-height:calc(100dvh - 130px);background:#14141a;border:1px solid var(--ktc-gold);border-radius:18px;" +
    "box-shadow:0 24px 60px rgba(0,0,0,.55);display:none;flex-direction:column;overflow:hidden;z-index:250;" +
    "font-family:'Segoe UI',Arial,sans-serif;transition:all .25s cubic-bezier(.4,0,.2,1)}" +
    "#ktchat-panel.open{display:flex;animation:ktchatSlideIn .2s ease}" +
    "#ktchat-panel.fullscreen{position:fixed;inset:0;bottom:0;right:0;width:100vw;height:100vh;height:100dvh;max-width:100vw;" +
    "max-height:100vh;max-height:100dvh;border-radius:0;border:0;z-index:999}" +
    "@keyframes ktchatSlideIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}" +

    "#ktchat-head{padding:13px 14px;background:linear-gradient(100deg,var(--ktc-red) 0%,var(--ktc-blue) 65%,#0f172a 100%);" +
    "border-bottom:2px solid var(--ktc-gold);display:flex;align-items:center;justify-content:space-between;" +
    "color:var(--ktc-white);font-size:13.5px;font-weight:700}" +
    "#ktchat-head .ktchat-title{display:flex;align-items:center;gap:7px}" +
    "#ktchat-head .ktchat-actions{display:flex;align-items:center;gap:2px}" +
    "#ktchat-dotlive{width:7px;height:7px;border-radius:50%;background:var(--ktc-gold2);" +
    "box-shadow:0 0 0 0 rgba(240,201,74,.6);animation:ktchatPulse 1.8s infinite}" +
    "@keyframes ktchatPulse{0%{box-shadow:0 0 0 0 rgba(240,201,74,.55)}70%{box-shadow:0 0 0 6px rgba(240,201,74,0)}" +
    "100%{box-shadow:0 0 0 0 rgba(240,201,74,0)}}" +
    "#ktchat-head button{background:transparent;border:0;color:#e2e8f0;cursor:pointer;padding:5px;font-size:16px;" +
    "line-height:1;border-radius:7px;display:flex;align-items:center;justify-content:center}" +
    "#ktchat-head button:hover{background:rgba(255,255,255,.15);color:#fff}" +
    "#ktchat-head #ktchat-close{font-size:19px}" +

    "#ktchat-body{flex:1;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px;display:flex;flex-direction:column;gap:9px;background:#0f0f14}" +
    "#ktchat-body::-webkit-scrollbar{width:6px}#ktchat-body::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:6px}" +
    ".ktchat-msg{max-width:82%;padding:8px 10px;border-radius:11px;font-size:12.8px;line-height:1.4;" +
    "word-break:break-word;position:relative}" +
    ".ktchat-msg .who{font-size:10.5px;font-weight:700;color:var(--ktc-gold2);margin-bottom:2px;display:block}" +
    ".ktchat-msg .when{font-size:9.5px;opacity:.7;margin-top:3px;display:block}" +
    ".ktchat-msg.me{align-self:flex-end;background:linear-gradient(135deg,var(--ktc-blue2),var(--ktc-blue));" +
    "color:#fff;border-bottom-right-radius:3px;border:1px solid rgba(212,175,55,.4)}" +
    ".ktchat-msg.me .who{color:var(--ktc-gold2)}" +
    ".ktchat-msg.other{align-self:flex-start;background:#1c1c24;color:#f5f5f7;border-bottom-left-radius:3px;" +
    "border:1px solid #2a2a30}" +
    ".ktchat-msg .del{position:absolute;top:1px;right:3px;font-size:12px;cursor:pointer;opacity:.55;" +
    "background:transparent;border:0;color:inherit;padding:2px}" +
    ".ktchat-msg .del:hover{opacity:1}" +
    "#ktchat-empty{color:#6b6b76;font-size:12.5px;text-align:center;margin:auto;padding:0 10px}" +

    "#ktchat-typing{padding:2px 14px;min-height:20px;font-size:11px;color:var(--ktc-gold2);display:flex;" +
    "align-items:center;gap:6px;background:#0f0f14}" +
    "#ktchat-typing.hidden{display:none}" +
    ".ktchat-typedots{display:inline-flex;gap:3px}" +
    ".ktchat-typedots span{width:4px;height:4px;border-radius:50%;background:var(--ktc-gold2);" +
    "animation:ktchatTypeDot 1.1s infinite ease-in-out}" +
    ".ktchat-typedots span:nth-child(2){animation-delay:.15s}" +
    ".ktchat-typedots span:nth-child(3){animation-delay:.3s}" +
    "@keyframes ktchatTypeDot{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}" +

    "#ktchat-foot{padding:10px;border-top:1px solid #2a2a30;display:flex;gap:8px;background:#1c1c21}" +
    "#ktchat-input{flex:1;resize:none;border-radius:10px;border:1px solid #2a2a30;background:#0f0f12;color:#f5f5f7;" +
    "padding:9px 10px;font-size:16px;font-family:inherit;max-height:70px}" +
    "#ktchat-input:focus{outline:none;border-color:var(--ktc-gold)}" +
    "#ktchat-send{background:linear-gradient(135deg,var(--ktc-gold2),var(--ktc-gold));border:0;border-radius:10px;" +
    "width:38px;flex:0 0 38px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#1c1300}" +
    "#ktchat-send:disabled{opacity:.5;cursor:not-allowed}" +

    "#ktchat-panel.fullscreen #ktchat-body{padding:20px;max-width:760px;margin:0 auto;width:100%}" +
    "#ktchat-panel.fullscreen #ktchat-foot{max-width:760px;margin:0 auto;width:100%;padding:14px 10px}" +
    "#ktchat-panel.fullscreen .ktchat-msg{max-width:65%;font-size:13.5px}" +

    "@media(max-width:480px){#ktchat-panel{right:12px;left:12px;width:auto;bottom:82px}" +
    "#ktchat-bubble{right:16px;bottom:16px}" +
    "#ktchat-panel.fullscreen #ktchat-body,#ktchat-panel.fullscreen #ktchat-foot{max-width:100%}}";
  document.head.appendChild(style);

  // ---------------- MARKUP ----------------
  var bubble = document.createElement("button");
  bubble.id = "ktchat-bubble";
  bubble.type = "button";
  bubble.title = "Live Chat";
  bubble.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
    "</svg>" +
    '<span id="ktchat-badge"></span>';

  var panel = document.createElement("div");
  panel.id = "ktchat-panel";
  panel.innerHTML =
    '<div id="ktchat-head"><span class="ktchat-title"><span id="ktchat-dotlive"></span>Live Chat</span>' +
    '<span class="ktchat-actions">' +
    '<button type="button" id="ktchat-fullscreen" aria-label="Fullscreen" title="Layar penuh">' +
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2">' +
    '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>' +
    '<button type="button" id="ktchat-close" aria-label="Tutup">&times;</button>' +
    "</span></div>" +
    '<div id="ktchat-body"><div id="ktchat-empty">Memuat pesan...</div></div>' +
    '<div id="ktchat-typing" class="hidden"></div>' +
    '<div id="ktchat-foot">' +
    '<textarea id="ktchat-input" rows="1" placeholder="Tulis pesan..." maxlength="1000"></textarea>' +
    '<button type="button" id="ktchat-send" aria-label="Kirim">' +
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3">' +
    '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>' +
    "</div>";

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var bodyEl = panel.querySelector("#ktchat-body");
  var inputEl = panel.querySelector("#ktchat-input");
  var sendBtn = panel.querySelector("#ktchat-send");
  var badgeEl = bubble.querySelector("#ktchat-badge");
  var closeBtn = panel.querySelector("#ktchat-close");
  var fullscreenBtn = panel.querySelector("#ktchat-fullscreen");
  var typingEl = panel.querySelector("#ktchat-typing");

  // ---------------- HELPERS ----------------
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(v) {
    try {
      var iso = (v || "").indexOf("T") === -1 ? (v || "").replace(" ", "T") + "Z" : v;
      return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  function authHeaders(extra) {
    var h = { "Authorization": "Bearer " + getToken() };
    if (extra) h["Content-Type"] = "application/json";
    return h;
  }

  function renderMessages() {
    if (!messages.length) {
      bodyEl.innerHTML = '<div id="ktchat-empty">Belum ada pesan. Mulai obrolan pertama!</div>';
      return;
    }
    var myUsername = getMe().username;
    var admin = getMe().role === "admin" || getMe().role === "ketua";
    bodyEl.innerHTML = messages.map(function (m) {
      var mine = m.username === myUsername;
      var canDel = mine || admin;
      return '<div class="ktchat-msg ' + (mine ? "me" : "other") + '" data-id="' + m.id + '">' +
        (canDel ? '<button type="button" class="del" data-del="' + m.id + '" title="Hapus">&times;</button>' : "") +
        '<span class="who">' + (mine ? "Anda" : escapeHtml(m.nama || m.username)) + "</span>" +
        escapeHtml(m.pesan) +
        '<span class="when">' + fmtTime(m.waktu || m.created_at || m.dibuat_at) + "</span>" +
        "</div>";
    }).join("");
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function updateBadge() {
    if (unread > 0) {
      badgeEl.style.display = "flex";
      badgeEl.textContent = unread > 9 ? "9+" : String(unread);
    } else {
      badgeEl.style.display = "none";
    }
  }

  async function fetchChat(afterId) {
    var url = API_BASE + "/chat" + (afterId ? "?after_id=" + afterId : "");
    var r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw new Error("Gagal memuat chat (status " + r.status + ")");
    return r.json();
  }

  async function pollChat(isInitial) {
    try {
      var rows = await fetchChat(isInitial ? null : lastId);
      if (isInitial) {
        // Snapshot penuh: selalu timpa state lama, termasuk kalau hasilnya kosong
        // (mis. chat baru saja dibersihkan Admin/Ketua) supaya pesan lama tidak
        // "nyangkut" di memori browser.
        messages = rows || [];
        if (messages.length) lastId = messages[messages.length - 1].id;
        renderMessages();
        return;
      }
      if (!rows || !rows.length) return;
      messages = messages.concat(rows);
      if (messages.length > 200) messages = messages.slice(-200);
      var myUsername = getMe().username;
      if (!panelOpen) {
        unread += rows.filter(function (m) { return m.username !== myUsername; }).length;
        updateBadge();
      }
      lastId = messages[messages.length - 1].id;
      if (panelOpen) renderMessages();
    } catch (err) {
      if (isInitial) {
        bodyEl.innerHTML = '<div id="ktchat-empty">Live chat tidak dapat dimuat.<br>' + escapeHtml(err.message || "") + "</div>";
      }
    }
  }

  // ---------------- INDIKATOR "SEDANG MENGETIK" ----------------
  function renderTyping(rows) {
    if (!rows || !rows.length) {
      typingEl.classList.add("hidden");
      typingEl.innerHTML = "";
      return;
    }
    var names = rows.map(function (r) { return r.nama || r.username; });
    var text = names.length === 1
      ? names[0] + " sedang mengetik"
      : (names.length === 2 ? names.join(" & ") + " sedang mengetik" : names.length + " orang sedang mengetik");
    typingEl.innerHTML = text + ' <span class="ktchat-typedots"><span></span><span></span><span></span></span>';
    typingEl.classList.remove("hidden");
  }

  async function pollTyping() {
    if (!panelOpen) return; // hemat request kalau panel lagi ditutup
    try {
      var r = await fetch(API_BASE + "/chat/typing", { headers: authHeaders() });
      if (!r.ok) return;
      renderTyping(await r.json());
    } catch (e) {}
  }

  function pingTyping() {
    var now = Date.now();
    if (now - lastTypingPing < 1800) return; // throttle, jangan spam request
    lastTypingPing = now;
    fetch(API_BASE + "/chat/typing", { method: "POST", headers: authHeaders(true), body: "{}" }).catch(function () {});
  }

  // ---------------- BUKA / TUTUP / FULLSCREEN ----------------
  // Jaga-jaga tambahan untuk browser yang belum penuh dukung 100dvh (Safari
  // lama / WebView Android tertentu): saat fullscreen aktif, paksa tinggi
  // panel mengikuti tinggi layar yang BENERAN kelihatan (visualViewport),
  // supaya kotak ketik tidak pernah ketutup atau kedorong keluar layar
  // saat keyboard muncul.
  function syncFullscreenToViewport() {
    if (!isFullscreen || !window.visualViewport) return;
    var vv = window.visualViewport;
    panel.style.height = vv.height + "px";
    panel.style.top = vv.offsetTop + "px";
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncFullscreenToViewport);
    window.visualViewport.addEventListener("scroll", syncFullscreenToViewport);
  }
  window.addEventListener("orientationchange", function () { setTimeout(syncFullscreenToViewport, 350); });

  // Kunci scroll halaman di belakang (mis. footage.html) selama chat dalam
  // mode fullscreen — supaya scroll di dalam chat tidak ikut menggeser
  // halaman belakang, dan tidak ada tap yang bisa "nembus" ke menu/tombol
  // di belakang chat.
  var savedScrollY = 0;
  var bodyScrollLocked = false;
  function lockBodyScroll() {
    if (bodyScrollLocked) return;
    bodyScrollLocked = true;
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = "fixed";
    document.body.style.top = (-savedScrollY) + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }
  function unlockBodyScroll() {
    if (!bodyScrollLocked) return;
    bodyScrollLocked = false;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, savedScrollY);
  }

  function openPanel() {
    panelOpen = true;
    panel.classList.add("open");
    unread = 0;
    updateBadge();
    pollChat(true); // sinkronkan ulang penuh setiap dibuka (menangkap perubahan dari luar, mis. dibersihkan Admin/Ketua)
    if (typingPollTimer) clearInterval(typingPollTimer);
    typingPollTimer = setInterval(pollTyping, TYPING_POLL_MS);
    pollTyping();
    setTimeout(function () { inputEl.focus(); }, 50);
  }
  function closePanel() {
    panelOpen = false;
    panel.classList.remove("open");
    panel.classList.remove("fullscreen");
    isFullscreen = false;
    panel.style.height = "";
    panel.style.top = "";
    unlockBodyScroll();
    if (typingPollTimer) { clearInterval(typingPollTimer); typingPollTimer = null; }
    typingEl.classList.add("hidden");
  }
  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    panel.classList.toggle("fullscreen", isFullscreen);
    if (isFullscreen) {
      lockBodyScroll();
      syncFullscreenToViewport();
    } else {
      unlockBodyScroll();
      panel.style.height = "";
      panel.style.top = "";
    }
    if (panelOpen) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  bubble.addEventListener("click", function () { panelOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener("click", closePanel);
  fullscreenBtn.addEventListener("click", toggleFullscreen);
  // safety net: begitu keyboard muncul (input difokus) saat fullscreen,
  // sinkronkan lagi supaya kotak ketik tetap kelihatan
  inputEl.addEventListener("focus", function () {
    setTimeout(syncFullscreenToViewport, 300);
  });

  async function sendMessage() {
    var pesan = inputEl.value.trim();
    if (!pesan) return;
    sendBtn.disabled = true;
    try {
      var r = await fetch(API_BASE + "/chat", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ pesan: pesan })
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal mengirim pesan");
      inputEl.value = "";
      await pollChat(false);
    } catch (err) {
      alert(err.message || "Gagal mengirim pesan");
    } finally {
      sendBtn.disabled = false;
    }
  }
  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  inputEl.addEventListener("input", pingTyping);

  bodyEl.addEventListener("click", async function (e) {
    var btn = e.target.closest ? e.target.closest("[data-del]") : null;
    if (!btn) return;
    var id = btn.getAttribute("data-del");
    if (!confirm("Hapus pesan ini?")) return;
    try {
      var r = await fetch(API_BASE + "/chat?id=" + id, { method: "DELETE", headers: authHeaders() });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || "Gagal menghapus pesan");
      messages = messages.filter(function (m) { return String(m.id) !== String(id); });
      renderMessages();
    } catch (err) {
      alert(err.message || "Gagal menghapus pesan");
    }
  });

  // ---------------- MULAI ----------------
  pollChat(true);
  pollTimer = setInterval(function () { pollChat(false); }, POLL_MS);
  window.addEventListener("beforeunload", function () {
    clearInterval(pollTimer);
    if (typingPollTimer) clearInterval(typingPollTimer);
  });
})();
