// ============================================================
// LIVE CHAT MENGAMBANG — dipakai di semua halaman (Dashboard,
// Bendahara, File, Footage, Export). Backend-nya (/chat GET,
// POST, DELETE) sudah ada di Worker; file ini yang sebelumnya
// hilang, jadi live chat tidak pernah muncul di aplikasi.
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
  var lastId = 0;
  var panelOpen = false;
  var messages = [];
  var unread = 0;
  var pollTimer = null;

  // ---------------- STYLE ----------------
  var style = document.createElement("style");
  style.textContent =
    "#ktchat-bubble{position:fixed;bottom:22px;right:22px;width:56px;height:56px;border-radius:50%;" +
    "background:linear-gradient(145deg,#facc15,#eab308);color:#181205;border:0;box-shadow:0 10px 30px rgba(0,0,0,.45);" +
    "cursor:pointer;z-index:250;display:flex;align-items:center;justify-content:center;padding:0}" +
    "#ktchat-bubble svg{width:26px;height:26px}" +
    "#ktchat-badge{position:absolute;top:-3px;right:-3px;background:#e11d48;color:#fff;font-size:10.5px;font-weight:700;" +
    "border-radius:999px;min-width:19px;height:19px;display:none;align-items:center;justify-content:center;padding:0 4px;" +
    "border:2px solid #0c0c0e}" +
    "#ktchat-panel{position:fixed;bottom:90px;right:22px;width:325px;max-width:calc(100vw - 32px);height:445px;" +
    "max-height:calc(100vh - 130px);background:#16161a;border:1px solid #2a2a30;border-radius:16px;" +
    "box-shadow:0 24px 60px rgba(0,0,0,.55);display:none;flex-direction:column;overflow:hidden;z-index:250;" +
    "font-family:'Segoe UI',Arial,sans-serif}" +
    "#ktchat-panel.open{display:flex;animation:ktchatSlideIn .18s ease}" +
    "@keyframes ktchatSlideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}" +
    "#ktchat-head{padding:12px 14px;background:#1c1c21;border-bottom:1px solid #2a2a30;display:flex;" +
    "align-items:center;justify-content:space-between;color:#f5f5f7;font-size:13.5px;font-weight:700}" +
    "#ktchat-head .ktchat-title{display:flex;align-items:center;gap:7px}" +
    "#ktchat-dotlive{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);" +
    "animation:ktchatPulse 1.8s infinite}" +
    "@keyframes ktchatPulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 6px rgba(34,197,94,0)}" +
    "100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}" +
    "#ktchat-head button{background:transparent;border:0;color:#a0a0aa;cursor:pointer;padding:4px;font-size:18px;line-height:1}" +
    "#ktchat-head button:hover{color:#f5f5f7}" +
    "#ktchat-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px}" +
    "#ktchat-body::-webkit-scrollbar{width:6px}#ktchat-body::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:6px}" +
    ".ktchat-msg{max-width:82%;padding:8px 10px;border-radius:11px;font-size:12.8px;line-height:1.4;" +
    "word-break:break-word;position:relative}" +
    ".ktchat-msg .who{font-size:10.5px;font-weight:700;color:#facc15;margin-bottom:2px;display:block}" +
    ".ktchat-msg .when{font-size:9.5px;opacity:.65;margin-top:3px;display:block}" +
    ".ktchat-msg.me{align-self:flex-end;background:linear-gradient(145deg,#facc15,#eab308);color:#181205;" +
    "border-bottom-right-radius:3px}" +
    ".ktchat-msg.me .who{color:#5a4400}" +
    ".ktchat-msg.other{align-self:flex-start;background:#232329;color:#f5f5f7;border-bottom-left-radius:3px}" +
    ".ktchat-msg .del{position:absolute;top:1px;right:3px;font-size:12px;cursor:pointer;opacity:.55;" +
    "background:transparent;border:0;color:inherit;padding:2px}" +
    ".ktchat-msg .del:hover{opacity:1}" +
    "#ktchat-empty{color:#6b6b76;font-size:12.5px;text-align:center;margin:auto;padding:0 10px}" +
    "#ktchat-foot{padding:10px;border-top:1px solid #2a2a30;display:flex;gap:8px;background:#1c1c21}" +
    "#ktchat-input{flex:1;resize:none;border-radius:10px;border:1px solid #2a2a30;background:#0f0f12;color:#f5f5f7;" +
    "padding:9px 10px;font-size:12.8px;font-family:inherit;max-height:70px}" +
    "#ktchat-input:focus{outline:none;border-color:#facc15}" +
    "#ktchat-send{background:linear-gradient(145deg,#facc15,#eab308);border:0;border-radius:10px;width:38px;" +
    "flex:0 0 38px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#181205}" +
    "#ktchat-send:disabled{opacity:.5;cursor:not-allowed}" +
    "@media(max-width:480px){#ktchat-panel{right:12px;left:12px;width:auto;bottom:82px}" +
    "#ktchat-bubble{right:16px;bottom:16px}}";
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
    '<button type="button" id="ktchat-close" aria-label="Tutup">&times;</button></div>' +
    '<div id="ktchat-body"><div id="ktchat-empty">Memuat pesan...</div></div>' +
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
      if (!rows || !rows.length) { if (isInitial) renderMessages(); return; }
      if (isInitial) {
        messages = rows;
      } else {
        messages = messages.concat(rows);
        if (messages.length > 200) messages = messages.slice(-200);
        var myUsername = getMe().username;
        if (!panelOpen) {
          unread += rows.filter(function (m) { return m.username !== myUsername; }).length;
          updateBadge();
        }
      }
      lastId = messages[messages.length - 1].id;
      if (panelOpen || isInitial) renderMessages();
    } catch (err) {
      // Diam-diam gagal (mis. offline sebentar) — jangan ganggu halaman utama.
      if (isInitial) {
        bodyEl.innerHTML = '<div id="ktchat-empty">Live chat tidak dapat dimuat.<br>' + escapeHtml(err.message || "") + "</div>";
      }
    }
  }

  function openPanel() {
    panelOpen = true;
    panel.classList.add("open");
    unread = 0;
    updateBadge();
    renderMessages();
    setTimeout(function () { inputEl.focus(); }, 50);
  }
  function closePanel() {
    panelOpen = false;
    panel.classList.remove("open");
  }

  bubble.addEventListener("click", function () { panelOpen ? closePanel() : openPanel(); });
  closeBtn.addEventListener("click", closePanel);

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
  window.addEventListener("beforeunload", function () { clearInterval(pollTimer); });
})();
