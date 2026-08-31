/* ============================================================
   WIDGET POPUP SOSIAL MEDIA — Karang Taruna
   Cukup tempel satu baris di setiap halaman, sebelum </body>:
   <script src="sosmed-widget.js"></script>
   Lalu pasang tombol di halaman itu:
   <button onclick="openSosmedModal()">Sosial Media</button>
   ============================================================ */
(function () {
  // Kalau halaman ini sudah punya modal sosmed sendiri (misal index.html versi
  // lama), jangan bikin duplikat — cukup pastikan fungsi open/close tersedia.
  if (document.getElementById("sosmedModalOverlay")) {
    if (typeof window.openSosmedModal !== "function") {
      window.openSosmedModal = function () { document.getElementById("sosmedModalOverlay").classList.add("open"); };
    }
    if (typeof window.closeSosmedModal !== "function") {
      window.closeSosmedModal = function () { document.getElementById("sosmedModalOverlay").classList.remove("open"); };
    }
    return;
  }

  const TIKTOK_URL = "https://www.tiktok.com/@kabarbms.id?_r=1&_t=ZS-99HRMhXN8Wz";
  const IG_URL = "https://www.instagram.com/bmsofficial.id?igsi=eGZia3hpY3p1dnAy";

  // ---------- styles ----------
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ktSosmedFadeIn { from{opacity:0} to{opacity:1} }
    @keyframes ktSosmedPopIn {
      0%   { opacity:0; transform:scale(.8) translateY(18px); }
      55%  { opacity:1; transform:scale(1.04) translateY(-3px); }
      100% { opacity:1; transform:scale(1) translateY(0); }
    }
    #sosmedModalOverlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.68);
      backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
      z-index:9999;align-items:center;justify-content:center;padding:20px}
    #sosmedModalOverlay.open{display:flex;animation:ktSosmedFadeIn .2s ease}
    #sosmedModalOverlay.open .ktSosmedFrame{animation:ktSosmedPopIn .42s cubic-bezier(.34,1.56,.64,1)}
    .ktSosmedFrame{
      position:relative;width:100%;max-width:320px;padding:3px;border-radius:22px;
      background:linear-gradient(135deg,#f4d675,#e0ac2b 35%,#8a6d1f 70%,#e0ac2b);
      box-shadow:0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(224,172,43,.25);
    }
    .ktSosmedBox{
      background:#161618;border-radius:19px;padding:22px 20px 20px;text-align:center;
      border:1px solid #2a2a2e;font-family:'Segoe UI',Arial,sans-serif;color:#f4f4f5;
    }
    .ktSosmedBox .ktHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
    .ktSosmedBox .ktHead b{font-size:15px}
    .ktSosmedBox .ktClose{background:transparent;border:0;color:#9ca0a8;font-size:20px;cursor:pointer;
      line-height:1;padding:2px 6px;border-radius:8px;transition:background .15s,color .15s}
    .ktSosmedBox .ktClose:hover{background:#1b1b1e;color:#f4f4f5}
    .ktSosmedIcons{display:flex;justify-content:center;gap:24px;padding:16px 0 8px}
    .ktSosmedIcons a{display:flex;flex-direction:column;align-items:center;gap:8px;color:#f4f4f5;
      width:100px;text-decoration:none;transition:transform .18s ease}
    .ktSosmedIcons a:active{transform:scale(.93)}
    .ktSosmedIcons .circ{width:62px;height:62px;border-radius:50%;display:flex;align-items:center;
      justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.4);transition:box-shadow .18s ease}
    .ktSosmedIcons a:hover .circ{box-shadow:0 8px 22px rgba(224,172,43,.35)}
    .ktSosmedFoot{font-size:11.5px;color:#6b6f76;margin-top:2px}
  `;
  document.head.appendChild(style);

  // ---------- markup ----------
  const overlay = document.createElement("div");
  overlay.id = "sosmedModalOverlay";
  overlay.setAttribute("onclick", "if(event.target===this) closeSosmedModal()");
  overlay.innerHTML = `
    <div class="ktSosmedFrame">
      <div class="ktSosmedBox">
        <div class="ktHead">
          <b>🔗 Ikuti Sosial Media Kami</b>
          <button type="button" class="ktClose" onclick="closeSosmedModal()">&times;</button>
        </div>
        <div class="ktSosmedIcons">
          <a href="${TIKTOK_URL}" target="_blank" rel="noopener">
            <div class="circ" style="background:#000">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><path d="M16.6 5.82s.51.5 0 0A4.278 4.278 0 0 1 15.54 3h-3.09v12.4a2.592 2.592 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z"/></svg>
            </div>
            <small style="font-size:11.5px;font-weight:700">TikTok</small>
          </a>
          <a href="${IG_URL}" target="_blank" rel="noopener">
            <div class="circ" style="background:radial-gradient(circle at 30% 110%, #fdf497 0%, #fdf497 5%, #fd5949 45%,#d6249f 60%,#285AEB 90%)">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="6"/><circle cx="12" cy="12" r="4.5"/><circle cx="17.3" cy="6.7" r="1.2" fill="#fff" stroke="none"/></svg>
            </div>
            <small style="font-size:11.5px;font-weight:700">Instagram</small>
          </a>
        </div>
        <p class="ktSosmedFoot">Tap logo untuk membuka di tab baru</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  window.openSosmedModal = function () { overlay.classList.add("open"); };
  window.closeSosmedModal = function () { overlay.classList.remove("open"); };
})();
