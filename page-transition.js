// ============================================================
// TRANSISI MARQUEE ANTAR HALAMAN (Dashboard <-> Bendahara <-> File
// <-> Footage <-> Export). Setiap halaman sudah slide-in otomatis
// lewat CSS (@keyframes ktSlideIn di masing-masing file). Script
// kecil ini menambahkan slide-OUT ke kiri singkat sebelum benar-benar
// pindah halaman, supaya perpindahannya terasa seperti satu gerakan
// menerus (mirip marquee), bukan kedip mendadak.
//
// Cukup di-include sekali di setiap halaman:
//   <script src="page-transition.js"></script>
// ============================================================
(function () {
  var SLIDE_MS = 320; // disamakan dengan durasi transisi keluar (.32s) di CSS

  document.addEventListener("click", function (e) {
    // Cari elemen <a> terdekat dari yang diklik (misal ikonnya di dalam <a>)
    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;

    // Abaikan link yang bukan navigasi antar-halaman lokal:
    // - link eksternal / target="_blank" (mis. Sosial Media)
    // - link hash ke bagian di halaman yang sama (mis. index.html#pengumuman)
    // - modifier klik (buka tab baru, dsb) supaya perilaku browser normal tetap jalan
    var href = a.getAttribute("href") || "";
    if (!href || a.target === "_blank") return;
    var hrefNoHash = href.split("#")[0];
    if (!/\.html(\?.*)?$/i.test(hrefNoHash)) return; // hanya proses link yang mengarah ke halaman .html
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var currentFile = (location.pathname.split("/").pop() || "index.html");
    var targetFile = hrefNoHash.split("?")[0].split("/").pop();
    if (targetFile === currentFile && href.indexOf("#") === -1) return; // sudah di halaman yang sama & bukan hash-nav

    e.preventDefault();
    document.body.classList.add("kt-leaving");
    setTimeout(function () {
      location.href = href;
    }, SLIDE_MS);
  });
})();
