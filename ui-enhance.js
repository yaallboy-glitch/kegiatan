/* ============================================================
   ui-enhance.js — Progressive enhancement untuk BMS
   Pendamping ui-theme.css.

   Prinsip:
   - Additive & aman. Tidak menyentuh fetch/auth/chat/upload.
   - Kalau JS ini gagal dimuat, halaman tetap berfungsi penuh
     (animasi hanya "bonus", bukan syarat tampil).
   - Menghormati prefers-reduced-motion.
   - Idempoten: aman walau dijalankan berkali-kali.
   ============================================================ */
(function () {
  "use strict";

  if (window.__ktEnhanceLoaded) return;
  window.__ktEnhanceLoaded = true;

  // Tandai bahwa JS aktif -> baru izinkan animasi reveal menyembunyikan
  // konten. Kalau baris ini tidak jalan, konten tetap tampil normal.
  try { document.documentElement.classList.add("kt-js"); } catch (e) {}

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { reduceMotion = false; }

  /* ---------- 1. REVEAL SAAT MASUK VIEWPORT ---------- */
  var REVEAL_SELECTOR = [
    ".statCard", ".panel", ".footItem", ".fileRow",
    ".quoteBanner", ".sectionTitle"
  ].join(",");

  var io = null;
  if (!reduceMotion && "IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i];
        if (en.isIntersecting) {
          en.target.classList.add("kt-in");
          io.unobserve(en.target);
        }
      }
    }, { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
  }

  function tagReveal(root) {
    if (reduceMotion || !io) return;
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll(REVEAL_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__ktReveal) continue;
      el.__ktReveal = true;
      el.classList.add("kt-reveal");
      // stagger halus per indeks dalam grup
      var d = i % 4;
      if (d > 0) el.classList.add("kt-d" + d);
      io.observe(el);
    }
  }

  /* ---------- 2. RIPPLE PADA TOMBOL ---------- */
  function attachRipple(el) {
    if (el.__ktRipple) return;
    el.__ktRipple = true;
    el.classList.add("kt-ripple");
    el.addEventListener("pointerdown", function (ev) {
      if (reduceMotion) return;
      var rect = el.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      var ink = document.createElement("span");
      ink.className = "kt-ripple-ink";
      ink.style.width = ink.style.height = size + "px";
      ink.style.left = (ev.clientX - rect.left - size / 2) + "px";
      ink.style.top = (ev.clientY - rect.top - size / 2) + "px";
      el.appendChild(ink);
      setTimeout(function () {
        if (ink && ink.parentNode) ink.parentNode.removeChild(ink);
      }, 650);
    }, { passive: true });
  }

  var RIPPLE_SELECTOR = ".mainBtn, .btnGold, .pillBtn, .navlink, .pmItem, .logoutBtn";

  function tagRipple(root) {
    if (reduceMotion) return;
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll(RIPPLE_SELECTOR);
    for (var i = 0; i < nodes.length; i++) attachRipple(nodes[i]);
  }

  /* ---------- 3. OBSERVER UNTUK KONTEN DINAMIS ---------- */
  function enhanceAll(root) {
    tagReveal(root);
    tagRipple(root);
  }

  function boot() {
    enhanceAll(document);

    if ("MutationObserver" in window) {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n && n.nodeType === 1) enhanceAll(n);
          }
        }
      });
      mo.observe(document.body || document.documentElement, {
        childList: true, subtree: true
      });
    }

    // Jaring pengaman: apa pun yang belum ter-reveal setelah 2.5s
    // dipaksa tampil, supaya konten tidak pernah "hilang".
    setTimeout(function () {
      var pending = document.querySelectorAll(".kt-reveal:not(.kt-in)");
      for (var i = 0; i < pending.length; i++) {
        var el = pending[i];
        var r = el.getBoundingClientRect();
        if (r.top < (window.innerHeight || 0) * 1.2) el.classList.add("kt-in");
      }
    }, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
