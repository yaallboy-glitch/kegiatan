/* ============================================================
   WIDGET LIVE CHAT MENGAMBANG — Karang Taruna
   Cukup tempel satu baris di setiap halaman, sebelum </body>:
   <script src="chat-widget.js"></script>
   Butuh: variabel global API (URL worker) dan localStorage "token"
   sudah ada di halaman (semua halaman dashboard sudah punya ini).
   ============================================================ */
(function () {
  const CHAT_API = (typeof API !== "undefined" && API) || "https://kegiatan-api.newbrigademudasoropati.workers.dev";
  const token = localStorage.getItem("token") || "";
  if (!token) return; // belum login, jangan tampilkan widget

  let me = {};
  try {
    const p = atob(token).split("|");
    me = { username: p[0], nama: p[1], role: p[2] };
  } catch { return; }

  const POLL_MS = 4000;
  let lastId = 0;
  let isOpen = false;
  let pollTimer = null;
  let unread = 0;

  // ---------- styles ----------
  const style = document.createElement("style");
  style.textContent = `
    #ktChatBubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;
      background:linear-gradient(135deg,#e0ac2b,#c9932a);color:#181205;border:0;cursor:pointer;
      box-shadow:0 6px 18px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;
      z-index:9998;font-size:24px}
    #ktChatBubble .ktBadge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;
      font-size:10.5px;font-weight:800;min-width:18px;height:18px;border-radius:9px;display:none;
      align-items:center;justify-content:center;padding:0 4px;border:2px solid #0a0a0b}
    #ktChatPanel{position:fixed;bottom:86px;right:20px;width:320px;max-width:92vw;height:440px;max-height:70vh;
      background:#161618;border:1px solid #2a2a2e;border-radius:16px;display:none;flex-direction:column;
      overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.55);z-index:9998;font-family:'Segoe UI',Arial,sans-serif}
    #ktChatPanel.open{display:flex}
    #ktChatHead{background:linear-gradient(90deg,#e0ac2b,#c9932a);color:#181205;padding:12px 14px;
      display:flex;align-items:center;justify-content:space-between;font-weight:800;font-size:13.5px}
    #ktChatHead button{background:transparent;border:0;color:#181205;font-size:18px;cursor:pointer;line-height:1;padding:2px 4px}
    #ktChatBody{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#0d0d0f}
    #ktChatBody .ktMsg{max-width:80%;padding:7px 10px;border-radius:11px;font-size:12.5px;line-height:1.4;
      word-wrap:break-word;position:relative}
    #ktChatBody .ktMsg.me{align-self:flex-end;background:#8a6d1f;color:#fff2d6;border-bottom-right-radius:3px}
    #ktChatBody .ktMsg.other{align-self:flex-start;background:#1b1b1e;color:#f4f4f5;border:1px solid #2a2a2e;border-bottom-left-radius:3px}
    #ktChatBody .ktMsg b{display:block;font-size:10.5px;color:#e0ac2b;margin-bottom:2px;font-weight:700}
    #ktChatBody .ktMsg .ktTime{display:block;font-size:9.5px;color:#9ca0a8;margin-top:3px;text-align:right}
    #ktChatBody .ktMsg .ktDel{position:absolute;top:2px;right:6px;font-size:10px;color:#fca5a5;cursor:pointer;display:none}
    #ktChatBody .ktMsg.me:hover .ktDel{display:block}
    #ktChatEmpty{color:#6b6f76;font-size:12px;text-align:center;margin:auto}
    #ktChatFoot{display:flex;gap:8px;padding:10px;border-top:1px solid #2a2a2e;background:#161618}
    #ktChatFoot input{flex:1;background:#1b1b1e;border:1px solid #2a2a2e;color:#f4f4f5;border-radius:9px;
      padding:9px 11px;font-size:12.5px;outline:0}
    #ktChatFoot button{background:#e0ac2b;color:#181205;border:0;border-radius:9px;padding:0 14px;
      font-weight:800;cursor:pointer;font-size:13px}
    #ktChatFoot button:disabled{opacity:.5;cursor:default}
    @media(max-width:520px){
      #ktChatPanel{right:10px;bottom:78px;width:calc(100vw - 20px)}
      #ktChatBubble{right:14px;bottom:14px}
    }
  `;
  document.head.appendChild(style);

  // ---------- markup ----------
  const bubble = document.createElement("button");
  bubble.id = "ktChatBubble";
  bubble.innerHTML = '💬<span class="ktBadge" id="ktChatBadge">0</span>';
  bubble.title = "Live Chat";

  const panel = document.createElement("div");
  panel.id = "ktChatPanel";
  panel.innerHTML = `
    <div id="ktChatHead">
      <span>💬 Live Chat</span>
      <button id="ktChatClose" aria-label="Tutup">&times;</button>
    </div>
    <div id="ktChatBody"><div id="ktChatEmpty">Memuat pesan...</div></div>
    <div id="ktChatFoot">
      <input id="ktChatInput" placeholder="Tulis pesan..." maxlength="1000">
      <button id="ktChatSend">Kirim</button>
    </div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  const bodyEl = panel.querySelector("#ktChatBody");
  const inputEl = panel.querySelector("#ktChatInput");
  const sendBtn = panel.querySelector("#ktChatSend");
  const badgeEl = bubble.querySelector("#ktChatBadge");

  function fmtTime(iso) {
    try {
      return new Date(iso.replace(" ", "T") + "Z").toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  }
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function appendMessages(rows, { scroll = true } = {}) {
    if (!rows.length) return;
    const emptyNote = document.getElementById("ktChatEmpty");
    if (emptyNote) emptyNote.remove();
    rows.forEach(r => {
      const div = document.createElement("div");
      const mine = r.username === me.username;
      div.className = "ktMsg " + (mine ? "me" : "other");
      div.dataset.id = r.id;
      div.innerHTML = `
        ${mine ? "" : `<b>${escHtml(r.nama || r.username)}</b>`}
        ${escHtml(r.pesan)}
        <span class="ktTime">${fmtTime(r.waktu || r.created_at)}</span>
        ${mine ? `<span class="ktDel" data-id="${r.id}">Hapus</span>` : ""}
      `;
      bodyEl.appendChild(div);
      lastId = Math.max(lastId, r.id);
    });
    if (scroll) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  bodyEl.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("ktDel")) return;
    const id = e.target.dataset.id;
    if (!confirm("Hapus pesan ini?")) return;
    try {
      await fetch(CHAT_API + "/chat?id=" + id, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
      const el = bodyEl.querySelector(`.ktMsg[data-id="${id}"]`);
      if (el) el.remove();
    } catch {}
  });

  async function loadInitial() {
    try {
      const r = await fetch(CHAT_API + "/chat", { headers: { Authorization: "Bearer " + token } });
      const rows = await r.json();
      bodyEl.innerHTML = "";
      if (!Array.isArray(rows) || rows.length === 0) {
        bodyEl.innerHTML = '<div id="ktChatEmpty">Belum ada pesan. Mulai obrolan!</div>';
        return;
      }
      appendMessages(rows);
    } catch {
      bodyEl.innerHTML = '<div id="ktChatEmpty">Gagal memuat chat.</div>';
    }
  }

  async function poll() {
    try {
      const r = await fetch(CHAT_API + "/chat?after_id=" + lastId, { headers: { Authorization: "Bearer " + token } });
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        const wasAtBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 30;
        appendMessages(rows, { scroll: isOpen && wasAtBottom });
        if (!isOpen) {
          const fromOthers = rows.filter(r => r.username !== me.username).length;
          if (fromOthers) {
            unread += fromOthers;
            badgeEl.textContent = unread > 9 ? "9+" : unread;
            badgeEl.style.display = "flex";
          }
        }
      }
    } catch {}
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_MS);
  }

  async function sendMessage() {
    const pesan = inputEl.value.trim();
    if (!pesan) return;
    sendBtn.disabled = true;
    try {
      await fetch(CHAT_API + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ pesan })
      });
      inputEl.value = "";
      await poll();
    } catch {
      alert("Gagal mengirim pesan, coba lagi.");
    } finally {
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

  function openPanel() {
    isOpen = true;
    panel.classList.add("open");
    unread = 0;
    badgeEl.style.display = "none";
    bodyEl.scrollTop = bodyEl.scrollHeight;
    inputEl.focus();
  }
  function closePanel() {
    isOpen = false;
    panel.classList.remove("open");
  }

  bubble.addEventListener("click", () => { isOpen ? closePanel() : openPanel(); });
  panel.querySelector("#ktChatClose").addEventListener("click", closePanel);

  loadInitial().then(startPolling);
})();
