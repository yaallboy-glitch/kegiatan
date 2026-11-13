// ================== ATUR SIAPA YANG BOLEH EXPORT ==================
const ALLOWED_EXPORT_USERS = ["admin", "bendahara"];
// ============================================================================

// ================== SISTEM ROLE & HAK AKSES ==================
const VALID_ROLES = ["admin", "anggota", "bendahara", "pdd", "ketua", "sekertaris", "anggota_pj"];

const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

const _rateBuckets = new Map();
// ponytail: Map in-memory, per isolate. Bukan limit global lintas-colo — cukup
// untuk menahan spam satu IP; batas keras tetap di Cloudflare Rate Limiting Rules.
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = _rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    // buang entri kedaluwarsa supaya Map tidak tumbuh terus (ceiling: O(n) scan, fine di <10k key)
    if (_rateBuckets.size > 5000) for (const [k, v] of _rateBuckets) if (v.resetAt < now) _rateBuckets.delete(k);
    _rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count++;
  return bucket.count > limit;
}

const ROLE_EDIT_PERMISSIONS = {
  admin:      { bendahara: true,  footage: true,  file: true },
  bendahara:  { bendahara: true,  footage: false, file: false },
  pdd:        { bendahara: false, footage: true,  file: true },
  ketua:      { bendahara: true,  footage: true,  file: true },
  anggota:    { bendahara: false,  footage: false, file: false },
  sekertaris: { bendahara: false, footage: false, file: false },
  anggota_pj: { bendahara: false, footage: false, file: false },
};

const ROLE_LABEL_ID = {
  admin: "Admin",
  bendahara: "Bendahara",
  pdd: "PDD",
  ketua: "Ketua",
  anggota: "Anggota",
  sekertaris: "Sekertaris",
  anggota_pj: "Anggota PJ",
};

function isAdminRole(role) {
  return role === "admin" || role === "ketua";
}

const ROLE_PROPOSAL_ONLY = ["sekertaris"];

// ================== VALIDASI INPUT ==================
// SQLite tidak menolak string di kolom REAL: "abc" tersimpan apa adanya lalu
// jadi NaN di dashboard (saldo kas tampil "Rp NaN" untuk semua orang).
const VALID_JENIS_KEUANGAN = ["masuk", "keluar"];
const VALID_STATUS_SPJ = ["pending", "disetujui", "ditolak"];
const VALID_STATUS_EVENT = ["draft", "berjalan", "selesai"];
const RE_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function numPos(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Tanggal wajib YYYY-MM-DD dan harus tanggal yang benar-benar ada (2026-02-31 ditolak).
function validTanggal(v) {
  const s = String(v || "").trim();
  if (!RE_TANGGAL.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

// Dipakai khusus fitur Event: role "anggota" boleh lihat/tambah/edit,
// tapi TIDAK boleh hapus event atau acc/checklist alat & status.
function requireNonAnggota(me, cors) {
  if (me.role === "anggota") {
    return json({ error: "Role Anggota tidak dapat melakukan aksi ini." }, 403, cors);
  }
  return null;
}

function requireEdit(me, area, cors) {
  const perms = ROLE_EDIT_PERMISSIONS[me.role] || ROLE_EDIT_PERMISSIONS["anggota"];
  if (!perms[area]) {
    const label = ROLE_LABEL_ID[me.role] || me.role;
    const areaLabel = area === "bendahara" ? "Bendahara" : area === "footage" ? "Footage" : "File";
    return json({ error: `Role Anda (${label}) hanya bisa melihat data ${areaLabel}, tidak bisa menambah/mengubah/menghapus. Hubungi admin jika ini keliru.` }, 403, cors);
  }
  return null;
}

function requireProposalEdit(me, cors) {
  const perms = ROLE_EDIT_PERMISSIONS[me.role] || ROLE_EDIT_PERMISSIONS["anggota"];
  const allowed = perms.bendahara || ROLE_PROPOSAL_ONLY.includes(me.role);
  if (!allowed) {
    const label = ROLE_LABEL_ID[me.role] || me.role;
    return json({ error: `Role Anda (${label}) tidak memiliki izin mengelola Proposal. Hubungi admin jika ini keliru.` }, 403, cors);
  }
  return null;
}

// ================== HASHING PASSWORD ==================
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ================== TOKEN LOGIN ==================
async function signPayload(env, payload) {
  if (!env.TOKEN_SECRET) throw new Error("TOKEN_SECRET belum diset di Worker.");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeToken(env, username, nama) {
  const now = Date.now();
  const exp = now + 30 * 24 * 60 * 60 * 1000; // 30 hari
  const payload = btoa(unescape(encodeURIComponent(username + "|" + nama + "|" + now + "|" + exp)));
  const sig = await signPayload(env, payload);
  return payload + "." + sig;
}

// Token khusus thumbnail: umur 1 jam, scope "thumb". Hanya boleh baca thumbnail.
// Dipisah dari token login supaya kalau bocor (URL ikut ke-log), kerusakannya
// terbatas 1 jam dan tidak bisa dipakai upload/hapus.
async function makeThumbToken(env, username) {
  const now = Date.now();
  const exp = now + 60 * 60 * 1000;
  const payload = btoa(unescape(encodeURIComponent("thumb|" + username + "|" + now + "|" + exp)));
  return payload + "." + (await signPayload(env, payload));
}

async function verifyThumbToken(env, token) {
  const dot = String(token || "").lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  let expected;
  try { expected = await signPayload(env, payload); } catch { return null; }
  if (token.slice(dot + 1) !== expected) return null;
  try {
    const parts = decodeURIComponent(escape(atob(payload))).split("|");
    if (parts[0] !== "thumb") return null;          // scope harus thumb
    if (!parts[1]) return null;
    if (Date.now() > Number(parts[3])) return null; // kedaluwarsa
    return { username: parts[1] };
  } catch { return null; }
}

async function verifyAuthHeader(env, request, allowQueryToken = false) {
  let auth = request.headers.get("Authorization") || "";
  // Endpoint thumbnail boleh terima ?t=<thumb token> karena <img> tak bisa kirim header.
  if (!auth.startsWith("Bearer ") && allowQueryToken) {
    const qt = new URL(request.url).searchParams.get("t");
    if (qt) {
      const tt = await verifyThumbToken(env, qt);
      return tt ? { username: tt.username, nama: null, role: "anggota", thumbOnly: true } : null;
    }
  }
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expectedSig;
  try { expectedSig = await signPayload(env, payload); } catch { return null; }
  if (sig !== expectedSig) return null;
  let username, nama;
  try {
    const decoded = decodeURIComponent(escape(atob(payload)));
    const parts = decoded.split("|");
    if (parts[0] === "thumb") return null; // token thumbnail tidak boleh dipakai sebagai token login
    username = parts[0];
    nama = parts[1];
    if (!username) throw new Error("bad payload");
    // Token lama (3 bagian, tanpa masa berlaku) ditolak -> paksa login ulang.
    if (parts.length < 4) throw new Error("token lama");
    const exp = Number(parts[3]);
    if (!exp || Date.now() > exp) throw new Error("token kedaluwarsa");
  } catch { return null; }
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT role FROM users WHERE username=?").bind(username).first();
  if (!row) return null;
  return { username, nama, role: row.role };
}

// ================== GOOGLE DRIVE ==================
let _cachedAccessToken = null;
let _cachedAccessTokenExpiresAt = 0;

async function getGoogleAccessToken(env) {
  const now = Date.now();
  if (_cachedAccessToken && now < _cachedAccessTokenExpiresAt) return _cachedAccessToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gagal mendapatkan access token Google: " + (data.error_description || data.error || res.status));
  _cachedAccessToken = data.access_token;
  _cachedAccessTokenExpiresAt = now + Math.max(0, (data.expires_in || 3600) - 60) * 1000;
  return _cachedAccessToken;
}

async function driveUpload(env, file, folderId) {
  if (!env.GOOGLE_REFRESH_TOKEN || !folderId) throw new Error("Google Drive belum dikonfigurasi.");
  const accessToken = await getGoogleAccessToken(env);
  const metadata = { name: file.name, parents: [folderId] };
  const boundary = "-------drvbound" + crypto.randomUUID();
  const fileBuffer = await file.arrayBuffer();
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` + JSON.stringify(metadata) + `\r\n`;
  const filePartHeader = `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const body = new Blob([metaPart, filePartHeader, fileBuffer, closing]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gagal unggah ke Google Drive: " + (data.error?.message || res.status));
  return data;
}

async function driveInitiateResumable(env, filename, mimeType, size, folderId) {
  if (!env.GOOGLE_REFRESH_TOKEN || !folderId) throw new Error("Google Drive belum dikonfigurasi.");
  const accessToken = await getGoogleAccessToken(env);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType || "application/octet-stream", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({ name: filename, parents: [folderId] }),
  });
  if (!res.ok) {
    let msg = res.status;
    try { const d = await res.json(); msg = (d.error && d.error.message) || msg; } catch {}
    throw new Error("Gagal memulai sesi unggah ke Google Drive: " + msg);
  }
  const sessionUri = res.headers.get("Location");
  if (!sessionUri) throw new Error("Google Drive tidak mengirimkan URL sesi unggah");
  return sessionUri;
}

async function driveUploadChunk(env, sessionUri, chunkBuffer, start, end, total) {
  const accessToken = await getGoogleAccessToken(env);
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { Authorization: "Bearer " + accessToken, "Content-Length": String(chunkBuffer.byteLength), "Content-Range": `bytes ${start}-${end}/${total}` },
    body: chunkBuffer,
  });
  if (res.status === 200 || res.status === 201) {
    const data = await res.json();
    return { done: true, fileId: data.id, fileName: data.name };
  }
  if (res.status === 308) {
    const range = res.headers.get("Range");
    let uploadedBytes = end + 1;
    if (range) { const m = /bytes=0-(\d+)/.exec(range); if (m) uploadedBytes = Number(m[1]) + 1; }
    return { done: false, uploadedBytes };
  }
  let msg = "status " + res.status;
  try { const d = await res.json(); msg = (d.error && d.error.message) || msg; } catch {}
  const err = new Error("Gagal mengunggah potongan file ke Google Drive: " + msg);
  err.driveStatus = res.status;
  throw err;
}

async function driveQueryResumableStatus(env, sessionUri, total) {
  const accessToken = await getGoogleAccessToken(env);
  const res = await fetch(sessionUri, {
    method: "PUT", headers: { Authorization: "Bearer " + accessToken, "Content-Range": `bytes */${total}`, "Content-Length": "0" },
  });
  if (res.status === 200 || res.status === 201) {
    const data = await res.json();
    return { done: true, fileId: data.id, fileName: data.name };
  }
  if (res.status === 308) {
    const range = res.headers.get("Range");
    let uploadedBytes = 0;
    if (range) { const m = /bytes=0-(\d+)/.exec(range); if (m) uploadedBytes = Number(m[1]) + 1; }
    return { done: false, uploadedBytes };
  }
  const err = new Error("Sesi unggah tidak ditemukan/sudah kedaluwarsa (status " + res.status + ")");
  err.driveStatus = res.status;
  throw err;
}

async function driveDownload(env, fileId, rangeHeader) {
  const accessToken = await getGoogleAccessToken(env);
  const headers = { Authorization: "Bearer " + accessToken };
  if (rangeHeader) headers["Range"] = rangeHeader;
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers });
}

async function driveDelete(env, fileId) {
  try {
    const accessToken = await getGoogleAccessToken(env);
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE", headers: { Authorization: "Bearer " + accessToken } });
  } catch {}
}

async function driveListFolder(env, folderId) {
  if (!folderId) throw new Error("Folder ID Google Drive belum diset.");
  const accessToken = await getGoogleAccessToken(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = "nextPageToken,files(id,name,mimeType,size)";
  let files = [], pageToken = "";
  do {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${encodeURIComponent(fields)}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true` + (pageToken ? `&pageToken=${pageToken}` : ""), { headers: { Authorization: "Bearer " + accessToken } });
    const data = await res.json();
    if (!res.ok) throw new Error("Gagal membaca folder Google Drive: " + (data.error?.message || res.status));
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function driveCreateFolder(env, name, parentFolderId) {
  const accessToken = await getGoogleAccessToken(env);
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentFolderId] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gagal membuat folder di Google Drive: " + (data.error?.message || res.status));
  return data;
}

async function driveRenameFile(env, fileId, newName) {
  const accessToken = await getGoogleAccessToken(env);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name`, {
    method: "PATCH", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gagal mengganti nama di Google Drive: " + (data.error?.message || res.status));
  return data;
}

async function driveMoveFile(env, fileId, newParentId, oldParentId) {
  const accessToken = await getGoogleAccessToken(env);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${newParentId}&removeParents=${oldParentId}&fields=id,parents`, {
    method: "PATCH", headers: { Authorization: "Bearer " + accessToken }
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gagal memindahkan file di Google Drive: " + (data.error?.message || res.status));
  return data;
}

async function resolveFolderDriveId(env, folderId) {
  if (!folderId) return env.GOOGLE_FOLDER_FOOTAGE;
  const row = await env.DB.prepare("SELECT drive_folder_id FROM footage_folders WHERE id=?").bind(folderId).first();
  if (!row) throw new Error("Folder footage tidak ditemukan");
  return row.drive_folder_id;
}

// Ambil thumbnail Drive. size: 400 (grid/lightbox) atau 2000 (pratinjau HD).
// ponytail: cache lewat caches.default (native, 0 dependency). Tanpa cache,
// tiap thumbnail = 2 request Google -> kuota Drive cepat habis kalau di-spam.
async function driveGetThumbnail(env, fileId, size = 400) {
  const px = size >= 2000 ? 2000 : 400;
  const cacheKey = new Request(`https://bms-thumb.internal/${encodeURIComponent(fileId)}?s=${px}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const accessToken = await getGoogleAccessToken(env);
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink`, { headers: { Authorization: "Bearer " + accessToken } });
  const meta = await metaRes.json();
  if (!metaRes.ok || !meta.thumbnailLink) throw new Error("Thumbnail tidak tersedia");
  const thumbUrl = meta.thumbnailLink.replace(/=s\d+$/, "=s" + px);
  const imgRes = await fetch(thumbUrl, { headers: { Authorization: "Bearer " + accessToken } });
  if (!imgRes.ok) throw new Error("Gagal mengambil thumbnail dari Google Drive");

  const out = new Response(imgRes.body, {
    status: 200,
    headers: {
      "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
  const toCache = out.clone();
  // ctx.waitUntil tidak tersedia di helper ini -> put ditunggu (murah, body sudah di memori stream)
  await cache.put(cacheKey, toCache).catch(() => {});
  return out;
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,Content-Range",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/login" && request.method === "POST") {
        return json({ error: "Login dengan username & password sudah tidak berlaku. Silakan login memakai akun Google Anda." }, 410, cors);
      }

      if (path === "/register" && request.method === "POST") {
        return json({ error: "Pendaftaran manual sudah tidak berlaku. Silakan daftar/masuk memakai akun Google Anda." }, 410, cors);
      }

      // ===== LOGIN / REGISTRASI VIA GOOGLE =====
      if (path === "/auth/google" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const credential = body.credential;
        if (!credential) return json({ error: "Token Google tidak ditemukan pada request" }, 400, cors);
        if (!env.GOOGLE_LOGIN_CLIENT_ID) return json({ error: "GOOGLE_LOGIN_CLIENT_ID belum diset di Worker" }, 500, cors);
        if (!env.DB) return json({ error: "Database (DB binding) belum terhubung ke Worker" }, 500, cors);

        let ginfo;
        try {
          const gRes = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential));
          ginfo = await gRes.json();
          if (!gRes.ok || ginfo.error) throw new Error(ginfo.error_description || ginfo.error || "Token Google tidak valid");
        } catch (e) { return json({ error: "Verifikasi login Google gagal: " + e.message }, 401, cors); }

        const _allowedIds = String(env.GOOGLE_LOGIN_CLIENT_ID || "").split(",").map(s => s.trim()).filter(Boolean);
        if (!_allowedIds.includes(ginfo.aud)) return json({ error: "Token Google tidak cocok dengan aplikasi ini" }, 401, cors);
        if (ginfo.email_verified !== "true" && ginfo.email_verified !== true) return json({ error: "Email Google Anda belum terverifikasi" }, 401, cors);

        const email = (ginfo.email || "").toLowerCase().trim();
        const namaGoogle = (ginfo.name || email.split("@")[0] || "Pengguna").trim();
        if (!email) return json({ error: "Google tidak mengirimkan alamat email" }, 401, cors);

        let user = await env.DB.prepare("SELECT * FROM users WHERE google_email=?").bind(email).first();

        if (!user) {
          let baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 16) || "user";
          let username = baseUsername, suffix = 1;
          while (await env.DB.prepare("SELECT username FROM users WHERE username=?").bind(username).first()) {
            username = baseUsername + suffix; suffix++;
          }
          const randomPassword = await sha256(crypto.randomUUID() + Date.now());
          await env.DB.prepare("INSERT INTO users (username, password, nama, role, google_email, nama_confirmed) VALUES (?,?,?,?,?,0)")
            .bind(username, randomPassword, namaGoogle, "anggota", email).run();
          user = { username, nama: namaGoogle, role: "anggota", nama_confirmed: 0 };

          // LOG: Pendaftaran baru
          await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
            .bind(username, "Akun baru terdaftar otomatis via Google (" + email + ")").run();
        }
        // LOG: login user lama (dipakai untuk audit trail)
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(user.username, "Login via Google").run();

        let newToken;
        try { newToken = await makeToken(env, user.username, user.nama); } catch (e) { return json({ error: e.message }, 500, cors); }

        return json({ token: newToken, needs_name: !user.nama_confirmed }, 200, cors);
      }

      // ===== CEK AUTH =====
      const me = await verifyAuthHeader(env, request, true);
      if (!me) return json({ error: "Unauthorized" }, 401, cors);
      // Token thumbnail hanya boleh dipakai membaca thumbnail.
      if (me.thumbOnly && path !== "/footage/thumb") return json({ error: "Token thumbnail hanya untuk melihat thumbnail." }, 403, cors);

      if (path === "/auth/me" && request.method === "GET") {
        const urow = await env.DB.prepare("SELECT nama_confirmed FROM users WHERE username=?").bind(me.username).first();
        return json({ username: me.username, nama: me.nama, role: me.role, nama_confirmed: urow ? !!urow.nama_confirmed : false }, 200, cors);
      }

      // ===== SET NAMA =====
      if (path === "/auth/set-name" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const namaBaru = (body.nama || "").toString().trim();
        if (!namaBaru) return json({ error: "Nama tidak boleh kosong" }, 400, cors);
        if (namaBaru.length > 100) return json({ error: "Nama terlalu panjang (maksimal 100 karakter)" }, 400, cors);

        const current = await env.DB.prepare("SELECT nama_confirmed FROM users WHERE username=?").bind(me.username).first();
        if (!current) return json({ error: "Akun tidak ditemukan" }, 404, cors);
        if (current.nama_confirmed) return json({ error: "Nama Anda sudah dikonfirmasi sebelumnya dan tidak bisa diubah sendiri. Hubungi admin untuk perubahan." }, 403, cors);

        await env.DB.prepare("UPDATE users SET nama=?, nama_confirmed=1 WHERE username=?").bind(namaBaru, me.username).run();

        let newToken;
        try { newToken = await makeToken(env, me.username, namaBaru); } catch (e) { return json({ error: e.message }, 500, cors); }
        return json({ ok: true, token: newToken }, 200, cors);
      }

      // ===== USERS =====
      if (path === "/users" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT username, nama, role, google_email, nama_confirmed FROM users ORDER BY nama ASC").all();
        const isAdmin = isAdminRole(me.role);
        const out = rows.results.map((r) => isAdmin ? r : { ...r, google_email: r.google_email ? r.google_email.replace(/^(.{2})[^@]*@/, "$1***@") : "" });
        return json(out, 200, cors);
      }

      if (path === "/users/update" && request.method === "POST") {
        if (!isAdminRole(me.role)) return json({ error: "Hanya Admin/Ketua yang boleh mengubah data anggota" }, 403, cors);
        let body;
        try { body = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const targetUsername = (body.username || "").trim();
        const newRole = (body.role || "").trim();
        const newGoogleEmail = (body.google_email || "").trim().toLowerCase();

        if (!targetUsername) return json({ error: "Username target wajib diisi" }, 400, cors);
        if (!VALID_ROLES.includes(newRole)) return json({ error: "Role tidak valid (harus salah satu dari: " + VALID_ROLES.join(", ") + ")" }, 400, cors);
        if (newGoogleEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newGoogleEmail)) return json({ error: "Format email Google tidak valid" }, 400, cors);

        const target = await env.DB.prepare("SELECT * FROM users WHERE username=?").bind(targetUsername).first();
        if (!target) return json({ error: "Anggota tidak ditemukan" }, 404, cors);
        if (newGoogleEmail) {
          const clash = await env.DB.prepare("SELECT username FROM users WHERE google_email=? AND username<>?").bind(newGoogleEmail, targetUsername).first();
          if (clash) return json({ error: "Email Google itu sudah ditautkan ke akun lain (" + clash.username + ")" }, 409, cors);
        }

        await env.DB.prepare("UPDATE users SET role=?, google_email=? WHERE username=?").bind(newRole, newGoogleEmail || null, targetUsername).run();
        // LOG: ubah role / tautan email
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, `Ubah data anggota ${targetUsername}: role ${target.role} -> ${newRole}` +
            (newGoogleEmail && newGoogleEmail !== (target.google_email || "") ? `, email ${target.google_email || "(kosong)"} -> ${newGoogleEmail}` : "")).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== KEUANGAN =====
      if (path === "/keuangan" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM keuangan ORDER BY tanggal DESC").all();
        return json(rows.results, 200, cors);
      }
      if (path === "/keuangan" && request.method === "POST") {
        const denied = requireEdit(me, "bendahara", cors); if (denied) return denied;
        let d;
        try { d = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const tanggal = validTanggal(d.tanggal);
        if (!tanggal) return json({ error: "Tanggal wajib diisi dengan format YYYY-MM-DD dan harus tanggal yang valid" }, 400, cors);
        const keterangan = (d.keterangan || "").toString().trim();
        if (!keterangan) return json({ error: "Keterangan wajib diisi" }, 400, cors);
        if (keterangan.length > 200) return json({ error: "Keterangan terlalu panjang (maksimal 200 karakter)" }, 400, cors);
        const jenis = (d.jenis || "").toString().trim().toLowerCase();
        if (!VALID_JENIS_KEUANGAN.includes(jenis)) return json({ error: "Jenis harus salah satu dari: " + VALID_JENIS_KEUANGAN.join(", ") }, 400, cors);
        const jumlah = numPos(d.jumlah);
        if (jumlah === null) return json({ error: "Jumlah harus angka lebih dari 0" }, 400, cors);
        await env.DB.prepare("INSERT INTO keuangan (tanggal,keterangan,jenis,jumlah,created_by) VALUES (?,?,?,?,?)")
          .bind(tanggal, keterangan, jenis, jumlah, me.username).run();
        // LOG: Menambah keuangan
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menambah keuangan: " + keterangan + " (" + jenis + " Rp" + jumlah + ")").run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/keuangan" && request.method === "DELETE") {
        const denied = requireEdit(me, "bendahara", cors); if (denied) return denied;
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM keuangan WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Transaksi tidak ditemukan" }, 404, cors);
        await env.DB.prepare("DELETE FROM keuangan WHERE id=?").bind(id).run();
        // LOG: Menghapus keuangan (simpan nilai asli supaya bisa diaudit)
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, `Menghapus keuangan ID ${id}: ${row.tanggal} ${row.jenis} Rp${row.jumlah} - ${row.keterangan}`).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== SPJ =====
      if (path === "/spj" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM spj ORDER BY tanggal DESC").all();
        return json(rows.results, 200, cors);
      }
      if (path === "/spj" && request.method === "POST") {
        const denied = requireEdit(me, "bendahara", cors); if (denied) return denied;
        let d;
        try { d = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const noSpj = (d.no_spj || "").toString().trim();
        if (!noSpj) return json({ error: "Nomor SPJ wajib diisi" }, 400, cors);
        const tanggal = validTanggal(d.tanggal);
        if (!tanggal) return json({ error: "Tanggal wajib diisi dengan format YYYY-MM-DD dan harus tanggal yang valid" }, 400, cors);
        const kegiatan = (d.kegiatan || "").toString().trim();
        if (!kegiatan) return json({ error: "Nama kegiatan wajib diisi" }, 400, cors);
        const nominal = numPos(d.nominal);
        if (nominal === null) return json({ error: "Nominal harus angka lebih dari 0" }, 400, cors);
        await env.DB.prepare("INSERT INTO spj (no_spj,tanggal,kegiatan,rincian,nominal,created_by) VALUES (?,?,?,?,?,?)")
          .bind(noSpj, tanggal, kegiatan, (d.rincian || "").toString(), nominal, me.username).run();
        // LOG: Menambah SPJ
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menambah SPJ: " + noSpj + " (Rp" + nominal + ")").run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/spj/status" && request.method === "POST") {
        const denied = requireEdit(me, "bendahara", cors); if (denied) return denied;
        if (!isAdminRole(me.role)) return json({ error: "Hanya Admin/Ketua yang boleh mengubah status" }, 403, cors);
        let d;
        try { d = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        if (!d.id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const status = (d.status || "").toString().trim().toLowerCase();
        if (!VALID_STATUS_SPJ.includes(status)) return json({ error: "Status tidak valid (harus salah satu dari: " + VALID_STATUS_SPJ.join(", ") + ")" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM spj WHERE id=?").bind(d.id).first();
        if (!row) return json({ error: "Data SPJ tidak ditemukan" }, 404, cors);
        await env.DB.prepare("UPDATE spj SET status=?, updated_by=? WHERE id=?")
          .bind(status, me.username, d.id).run();
        // LOG: Mengubah status SPJ
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, `Mengubah status SPJ ${row.no_spj} (ID ${d.id}): ${row.status} -> ${status}`).run();
        return json({ ok: true }, 200, cors);
      }

      if (path === "/spj" && request.method === "DELETE") {
        const denied = requireEdit(me, "bendahara", cors); if (denied) return denied;
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM spj WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Data SPJ tidak ditemukan" }, 404, cors);
        await env.DB.prepare("DELETE FROM spj WHERE id=?").bind(id).run();
        // LOG: Menghapus SPJ
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menghapus SPJ ID " + id).run();
        return json({ ok: true }, 200, cors);
      }

      if (path === "/spj/delete" && request.method === "POST") {
        const denied = requireEdit(me, "bendahara", cors); if (denied) return denied;
        const d = await request.json();
        const id = d.id;
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM spj WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Data SPJ tidak ditemukan" }, 404, cors);
        await env.DB.prepare("DELETE FROM spj WHERE id=?").bind(id).run();
        // LOG: Menghapus SPJ
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menghapus SPJ ID " + id).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== PROPOSAL =====
      if (path === "/proposal" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM proposal ORDER BY id DESC").all();
        return json(rows.results, 200, cors);
      }
      if (path === "/proposal" && request.method === "POST") {
        const denied = requireProposalEdit(me, cors); if (denied) return denied;
        const d = await request.json();
        await env.DB.prepare("INSERT INTO proposal (judul,isi,created_by) VALUES (?,?,?)")
          .bind(d.judul, d.isi, me.username).run();
        // LOG: Membuat proposal
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Membuat proposal: " + d.judul).run();
        return json({ ok: true }, 200, cors);
      }

      if (path === "/proposal" && request.method === "DELETE") {
        const denied = requireProposalEdit(me, cors); if (denied) return denied;
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM proposal WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Proposal tidak ditemukan" }, 404, cors);
        await env.DB.prepare("DELETE FROM proposal WHERE id=?").bind(id).run();
        // LOG: Menghapus proposal
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menghapus proposal: " + row.judul).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/proposal/delete" && request.method === "POST") {
        const denied = requireProposalEdit(me, cors); if (denied) return denied;
        const d = await request.json();
        const id = d.id;
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM proposal WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Proposal tidak ditemukan" }, 404, cors);
        await env.DB.prepare("DELETE FROM proposal WHERE id=?").bind(id).run();
        // LOG: Menghapus proposal
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menghapus proposal: " + row.judul).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== LOG =====
      if (path === "/log" && request.method === "GET") {
        const limit = Math.min(parseInt(url.searchParams.get("limit")) || 50, 100);
        const offset = parseInt(url.searchParams.get("offset")) || 0;
        const rows = await env.DB.prepare(
          "SELECT * FROM log_aktivitas ORDER BY waktu DESC LIMIT ? OFFSET ?"
        ).bind(limit, offset).all();
        return json(rows.results, 200, cors);
      }

      // ===== BERSIHKAN LOG (Hanya Admin/Ketua) =====
      if (path === "/log/clear" && request.method === "POST") {
        if (!isAdminRole(me.role)) {
          return json({ error: "Hanya Admin/Ketua yang boleh membersihkan log." }, 403, cors);
        }
        await env.DB.prepare("DELETE FROM log_aktivitas").run();
        return json({ ok: true, message: "Log berhasil dibersihkan" }, 200, cors);
      }

      // ===== PENGUMUMAN =====
      if (path === "/pengumuman" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT p.*, u.nama AS dibuat_oleh_nama, u.role AS dibuat_oleh_role FROM pengumuman p LEFT JOIN users u ON u.username = p.dibuat_oleh ORDER BY p.dibuat_at DESC").all();
        return json(rows.results, 200, cors);
      }
      if (path === "/pengumuman" && request.method === "POST") {
        if (me.role === "anggota") return json({ error: "Hanya Admin, Ketua, Bendahara, PDD, Sekertaris, dan Anggota PJ yang boleh membuat pengumuman." }, 403, cors);
        const d = await request.json();
        const judul = (d.judul || "").toString().trim();
        const isi = (d.isi || "").toString().trim();
        if (!judul || !isi) return json({ error: "Judul dan isi pengumuman wajib diisi" }, 400, cors);
        await env.DB.prepare("INSERT INTO pengumuman (judul, isi, dibuat_oleh) VALUES (?,?,?)")
          .bind(judul, isi, me.username).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/pengumuman" && request.method === "DELETE") {
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM pengumuman WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Pengumuman tidak ditemukan" }, 404, cors);
        if (row.dibuat_oleh !== me.username && !isAdminRole(me.role)) return json({ error: "Anda hanya boleh menghapus pengumuman milik sendiri" }, 403, cors);
        await env.DB.prepare("DELETE FROM pengumuman WHERE id=?").bind(id).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== DRIVE DEBUG =====
      if (path === "/drive/debug" && request.method === "GET") {
        if (!isAdminRole(me.role)) return json({ error: "Hanya Admin/Ketua yang boleh mengakses debug Drive." }, 403, cors);
        const which = url.searchParams.get("which") === "file" ? "file" : "footage";
        const folderId = which === "file" ? env.GOOGLE_FOLDER_FILES : env.GOOGLE_FOLDER_FOOTAGE;
        try {
          const accessToken = await getGoogleAccessToken(env);
          const aboutRes = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)", { headers: { Authorization: "Bearer " + accessToken } });
          const about = await aboutRes.json();
          const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,driveId,owners(emailAddress),shared,trashed&supportsAllDrives=true`, { headers: { Authorization: "Bearer " + accessToken } });
          const folderInfo = await folderRes.json();
          const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents`)}&fields=files(id,name,mimeType,trashed)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=50`, { headers: { Authorization: "Bearer " + accessToken } });
          const listInfo = await listRes.json();
          return json({ which, akun_drive_yang_dipakai_worker: about.user || about, folder_id_dicek: folderId, folder_bisa_diakses: folderRes.ok, info_folder: folderInfo, isi_folder_mentah: listRes.ok ? listInfo.files : listInfo }, 200, cors);
        } catch (e) { return json({ error: e.message }, 500, cors); }
      }

      // ===== CHAT =====
      if (path === "/chat" && request.method === "GET") {
        const afterId = parseInt(url.searchParams.get("after_id"));
        if (afterId) {
          // Polling: hanya kirim pesan baru setelah id ini
          const rows = await env.DB.prepare(
            "SELECT * FROM chat_messages WHERE id > ? ORDER BY id ASC LIMIT 100"
          ).bind(afterId).all();
          return json(rows.results, 200, cors);
        }
        const limit = Math.min(parseInt(url.searchParams.get("limit")) || 50, 100);
        const offset = parseInt(url.searchParams.get("offset")) || 0;
        const rows = await env.DB.prepare(
          "SELECT * FROM chat_messages ORDER BY id DESC LIMIT ? OFFSET ?"
        ).bind(limit, offset).all();
        return json(rows.results.reverse(), 200, cors);
      }
      if (path === "/chat" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const pesan = (body.pesan || "").toString().trim();
        if (!pesan) return json({ error: "Pesan tidak boleh kosong" }, 400, cors);
        if (pesan.length > 1000) return json({ error: "Pesan terlalu panjang (maksimal 1000 karakter)" }, 400, cors);
        if (rateLimit("chat:" + (request.headers.get("CF-Connecting-IP") || me.username), 20, 60000)) return json({ error: "Terlalu banyak pesan dalam waktu singkat. Coba lagi nanti." }, 429, cors);
        const result = await env.DB.prepare("INSERT INTO chat_messages (username, nama, pesan) VALUES (?,?,?)").bind(me.username, me.nama, pesan).run();
        return json({ ok: true, id: result.meta.last_row_id }, 200, cors);
      }
      if (path === "/chat" && request.method === "DELETE") {
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM chat_messages WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Pesan tidak ditemukan" }, 404, cors);
        if (row.username !== me.username && !isAdminRole(me.role)) return json({ error: "Anda hanya boleh menghapus pesan Anda sendiri" }, 403, cors);
        await env.DB.prepare("DELETE FROM chat_messages WHERE id=?").bind(id).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== BERSIHKAN CHAT (Hanya Admin/Ketua) =====
      if (path === "/chat/clear" && request.method === "POST") {
        if (!isAdminRole(me.role)) {
          return json({ error: "Hanya Admin/Ketua yang boleh membersihkan chat." }, 403, cors);
        }
        await env.DB.prepare("DELETE FROM chat_messages").run();
        return json({ ok: true, message: "Chat berhasil dibersihkan" }, 200, cors);
      }

      if (path === "/chat/typing" && request.method === "POST") {
        if (rateLimit("typing:" + (request.headers.get("CF-Connecting-IP") || me.username), 30, 10000)) return json({ error: "Terlalu cepat." }, 429, cors);
        await env.DB.prepare("INSERT INTO chat_typing (username, nama, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(username) DO UPDATE SET nama=excluded.nama, updated_at=excluded.updated_at").bind(me.username, me.nama).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/chat/typing" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT username, nama FROM chat_typing WHERE updated_at > datetime('now','-5 seconds') AND username != ?").bind(me.username).all();
        return json(rows.results, 200, cors);
      }

      // ===== FILE =====
      if (path === "/file" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM files ORDER BY uploaded_at DESC").all();
        return json(rows.results, 200, cors);
      }
      if (path === "/file" && request.method === "POST") {
        const denied = requireEdit(me, "file", cors); if (denied) return denied;
        let form;
        try { form = await request.formData(); } catch { return json({ error: "Body harus berupa form-data (bukan JSON) untuk upload file" }, 400, cors); }
        const file = form.get("file");
        const kategori = (form.get("kategori") || "Umum").toString();
        if (!file || typeof file === "string") return json({ error: "Tidak ada file yang dikirim" }, 400, cors);
        if (file.size <= 0) return json({ error: "File kosong" }, 400, cors);
        if (file.size > 100 * 1024 * 1024) return json({ error: "Ukuran file maksimal 100 MB" }, 400, cors);
        let uploaded;
        try { uploaded = await driveUpload(env, file, env.GOOGLE_FOLDER_FILES); } catch (e) { return json({ error: e.message }, 500, cors); }
        await env.DB.prepare("INSERT INTO files (filename,kategori,size,mime_type,drive_file_id,uploaded_by) VALUES (?,?,?,?,?,?)")
          .bind(file.name, kategori, file.size, file.type, uploaded.id, me.username).run();
        // LOG: Upload file
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Mengunggah file: " + file.name).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/file" && request.method === "DELETE") {
        const denied = requireEdit(me, "file", cors); if (denied) return denied;
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM files WHERE id=?").bind(id).first();
        if (!row) return json({ error: "File tidak ditemukan" }, 404, cors);
        await driveDelete(env, row.drive_file_id);
        await env.DB.prepare("DELETE FROM files WHERE id=?").bind(id).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/file/download" && request.method === "GET") {
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM files WHERE id=?").bind(id).first();
        if (!row) return json({ error: "File tidak ditemukan" }, 404, cors);
        const rangeHdr = request.headers.get("Range");
        let driveRes;
        try { driveRes = await driveDownload(env, row.drive_file_id, rangeHdr); } catch (e) { return json({ error: e.message }, 500, cors); }
        if (!driveRes.ok) return json({ error: "File tidak ada di Google Drive" }, 404, cors);
        const dlHeaders = { ...cors, "Content-Type": row.mime_type || "application/octet-stream", "Content-Disposition": 'attachment; filename="' + safeFilename(row.filename) + '"' };
        if (rangeHdr) dlHeaders["Accept-Ranges"] = "bytes";
        return new Response(driveRes.body, { status: driveRes.status || 200, headers: dlHeaders });
      }

      if (path === "/file/sync" && request.method === "POST") {
        const denied = requireEdit(me, "file", cors); if (denied) return denied;
        let driveFiles;
        try { driveFiles = await driveListFolder(env, env.GOOGLE_FOLDER_FILES); } catch (e) { return json({ error: e.message }, 500, cors); }
        const existing = await env.DB.prepare("SELECT drive_file_id FROM files").all();
        const existingIds = new Set(existing.results.map((r) => r.drive_file_id));
        let added = 0;
        for (const f of driveFiles) {
          if (existingIds.has(f.id)) continue;
          if (f.mimeType && f.mimeType.startsWith("application/vnd.google-apps")) continue;
          await env.DB.prepare("INSERT INTO files (filename,kategori,size,mime_type,drive_file_id,uploaded_by) VALUES (?,?,?,?,?,?)")
            .bind(f.name, "Sync Drive", f.size ? Number(f.size) : 0, f.mimeType || "", f.id, me.username + " (sync)").run();
          added++;
        }
        return json({ ok: true, added, total_di_drive: driveFiles.length }, 200, cors);
      }

      // ===== FOOTAGE =====
      if (path === "/footage" && request.method === "GET") {
        const tipe = url.searchParams.get("tipe");
        const folderParam = url.searchParams.get("folder_id");
        const conds = [], binds = [];
        if (tipe) { conds.push("tipe=?"); binds.push(tipe); }
        if (folderParam !== null) {
          if (folderParam === "") conds.push("folder_id IS NULL");
          else { conds.push("folder_id=?"); binds.push(folderParam); }
        }
        const where = conds.length ? " WHERE " + conds.join(" AND ") : "";
        // Paginasi: tanpa limit, 1277 baris ~295 KB per request. Di 80 anggota
        // ini menghabiskan CPU-time Worker. Default 60, maksimal 200.
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit")) || 60, 1), 200);
        const offset = Math.max(parseInt(url.searchParams.get("offset")) || 0, 0);
        const rows = await env.DB.prepare(
          "SELECT * FROM footage" + where + " ORDER BY uploaded_at DESC LIMIT ? OFFSET ?"
        ).bind(...binds, limit, offset).all();
        const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM footage" + where).bind(...binds).first();
        return json({ items: rows.results, total: total ? total.n : 0, limit, offset, has_more: offset + rows.results.length < (total ? total.n : 0) }, 200, cors);
      }
      if (path === "/footage" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        let form;
        try { form = await request.formData(); } catch { return json({ error: "Body harus berupa form-data (bukan JSON) untuk upload footage" }, 400, cors); }
        const file = form.get("file");
        const judul = (form.get("judul") || file?.name || "Tanpa judul").toString();
        if (!file || typeof file === "string") return json({ error: "Tidak ada file yang dikirim" }, 400, cors);
        if (file.size <= 0) return json({ error: "File kosong" }, 400, cors);
        if (file.size > 100 * 1024 * 1024) return json({ error: "Ukuran file maksimal 100 MB" }, 400, cors);
        const folderIdRaw = form.get("folder_id");
        const folderId = folderIdRaw ? Number(folderIdRaw) : null;
        const tipe = file.type.startsWith("video/") ? "video" : "foto";
        let targetParent;
        try { targetParent = await resolveFolderDriveId(env, folderId); } catch (e) { return json({ error: e.message }, 500, cors); }
        let uploaded;
        try { uploaded = await driveUpload(env, file, targetParent); } catch (e) { return json({ error: e.message }, 500, cors); }
        await env.DB.prepare("INSERT INTO footage (judul,tipe,size,mime_type,drive_file_id,folder_id,uploaded_by) VALUES (?,?,?,?,?,?,?)")
          .bind(judul, tipe, file.size, file.type, uploaded.id, folderId, me.username).run();
        // LOG: Upload footage
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Mengunggah footage: " + judul).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== UPLOAD BERTAHAP =====
      if (path === "/footage/upload/start" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        let body;
        try { body = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const filename = (body.filename || "Tanpa nama").toString();
        const mimeType = (body.mime_type || "application/octet-stream").toString();
        const size = Number(body.size);
        const judul = (body.judul || filename).toString();
        const folderIdRaw = body.folder_id;
        const folderId = folderIdRaw ? Number(folderIdRaw) : null;
        if (!size || size <= 0) return json({ error: "Ukuran file tidak valid" }, 400, cors);
        if (size > 100 * 1024 * 1024) return json({ error: "Ukuran file maksimal 100 MB" }, 400, cors);
        let targetParent;
        try { targetParent = await resolveFolderDriveId(env, folderId); } catch (e) { return json({ error: e.message }, 500, cors); }
        let sessionUri;
        try { sessionUri = await driveInitiateResumable(env, filename, mimeType, size, targetParent); } catch (e) { return json({ error: e.message }, 500, cors); }
        const tipe = mimeType.startsWith("video/") ? "video" : "foto";
        const uploadId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO upload_sessions (id, drive_session_uri, uploaded_bytes, total_size, judul, tipe, mime_type, folder_id, created_by, status) VALUES (?,?,0,?,?,?,?,?,?,'uploading')")
          .bind(uploadId, sessionUri, size, judul, tipe, mimeType, folderId, me.username).run();
        return json({ upload_id: uploadId, chunk_size: UPLOAD_CHUNK_SIZE }, 200, cors);
      }

      if (path === "/footage/upload/chunk" && request.method === "PUT") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const uploadId = url.searchParams.get("upload_id");
        if (!uploadId) return json({ error: "upload_id wajib diisi" }, 400, cors);
        const session = await env.DB.prepare("SELECT * FROM upload_sessions WHERE id=?").bind(uploadId).first();
        if (!session) return json({ error: "Sesi unggah tidak ditemukan" }, 404, cors);
        if (session.created_by !== me.username) return json({ error: "Sesi unggah ini bukan milik Anda" }, 403, cors);
        if (session.status === "done") return json({ done: true }, 200, cors);
        const contentRange = request.headers.get("Content-Range") || "";
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(contentRange);
        if (!m) return json({ error: "Header Content-Range tidak valid" }, 400, cors);
        const start = Number(m[1]), end = Number(m[2]), total = Number(m[3]);
        const chunkBuffer = await request.arrayBuffer();
        let result;
        try { result = await driveUploadChunk(env, session.drive_session_uri, chunkBuffer, start, end, total); } catch (e) {
          await env.DB.prepare("UPDATE upload_sessions SET status='error' WHERE id=?").bind(uploadId).run();
          return json({ error: e.message }, e.driveStatus === 404 || e.driveStatus === 410 ? 410 : 500, cors);
        }
        if (result.done) {
          await env.DB.prepare("INSERT INTO footage (judul,tipe,size,mime_type,drive_file_id,folder_id,uploaded_by) VALUES (?,?,?,?,?,?,?)")
            .bind(session.judul, session.tipe, session.total_size, session.mime_type, result.fileId, session.folder_id, me.username).run();
          // LOG: Upload footage (chunked)
          await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
            .bind(me.username, "Mengunggah footage: " + session.judul).run();
          await env.DB.prepare("UPDATE upload_sessions SET status='done', uploaded_bytes=? WHERE id=?").bind(session.total_size, uploadId).run();
          return json({ done: true }, 200, cors);
        }
        await env.DB.prepare("UPDATE upload_sessions SET uploaded_bytes=? WHERE id=?").bind(result.uploadedBytes, uploadId).run();
        return json({ done: false, uploaded_bytes: result.uploadedBytes }, 200, cors);
      }

      if (path === "/footage/upload/status" && request.method === "GET") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const uploadId = url.searchParams.get("upload_id");
        if (!uploadId) return json({ error: "upload_id wajib diisi" }, 400, cors);
        const session = await env.DB.prepare("SELECT * FROM upload_sessions WHERE id=?").bind(uploadId).first();
        if (!session) return json({ error: "Sesi unggah tidak ditemukan" }, 404, cors);
        if (session.created_by !== me.username) return json({ error: "Sesi unggah ini bukan milik Anda" }, 403, cors);
        if (session.status === "done") return json({ done: true, uploaded_bytes: session.total_size }, 200, cors);
        let result;
        try { result = await driveQueryResumableStatus(env, session.drive_session_uri, session.total_size); } catch (e) {
          await env.DB.prepare("UPDATE upload_sessions SET status='error' WHERE id=?").bind(uploadId).run();
          return json({ error: e.message }, 410, cors);
        }
        if (result.done) {
          await env.DB.prepare("INSERT INTO footage (judul,tipe,size,mime_type,drive_file_id,folder_id,uploaded_by) VALUES (?,?,?,?,?,?,?)")
            .bind(session.judul, session.tipe, session.total_size, session.mime_type, result.fileId, session.folder_id, me.username).run();
          // LOG: Upload footage (chunked status)
          await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
            .bind(me.username, "Mengunggah footage: " + session.judul).run();
          await env.DB.prepare("UPDATE upload_sessions SET status='done', uploaded_bytes=? WHERE id=?").bind(session.total_size, uploadId).run();
          return json({ done: true }, 200, cors);
        }
        await env.DB.prepare("UPDATE upload_sessions SET uploaded_bytes=? WHERE id=?").bind(result.uploadedBytes, uploadId).run();
        return json({ done: false, uploaded_bytes: result.uploadedBytes }, 200, cors);
      }

      // ===== FOLDER FOOTAGE =====
      if (path === "/footage/folders" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM footage_folders ORDER BY nama ASC").all();
        return json(rows.results, 200, cors);
      }
      if (path === "/footage/folders" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const d = await request.json();
        const nama = (d.nama || "").toString().trim();
        if (!nama) return json({ error: "Nama folder wajib diisi" }, 400, cors);
        let drive;
        try { drive = await driveCreateFolder(env, nama, env.GOOGLE_FOLDER_FOOTAGE); } catch (e) { return json({ error: e.message }, 500, cors); }
        const ins =        await env.DB.prepare("INSERT INTO footage_folders (nama,drive_folder_id,created_by) VALUES (?,?,?)").bind(nama, drive.id, me.username).run();
        return json({ ok: true, id: ins.meta.last_row_id, nama }, 200, cors);
      }
      if (path === "/footage/folders" && request.method === "DELETE") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM footage_folders WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Folder tidak ditemukan" }, 404, cors);
        // Pindahkan dulu semua footage di dalam folder ke folder root Drive,
        // supaya tidak ikut terhapus (trash) saat folder dihapus.
        const items = await env.DB.prepare("SELECT drive_file_id FROM footage WHERE folder_id=?").bind(id).all();
        for (const it of items.results) {
          try { await driveMoveFile(env, it.drive_file_id, env.GOOGLE_FOLDER_FOOTAGE, row.drive_folder_id); } catch {}
        }
        await env.DB.prepare("UPDATE footage SET folder_id=NULL WHERE folder_id=?").bind(id).run();
        await driveDelete(env, row.drive_folder_id);
        await env.DB.prepare("DELETE FROM footage_folders WHERE id=?").bind(id).run();
        return json({ ok: true }, 200, cors);
      }

      // ===== RENAME / MOVE / STAR / DLL =====
      if (path === "/footage/rename" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const d = await request.json();
        const judul = (d.judul || "").toString().trim();
        if (!judul) return json({ error: "Judul baru wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(d.id).first();
        if (!row) return json({ error: "Footage tidak ditemukan" }, 404, cors);
        try { await driveRenameFile(env, row.drive_file_id, judul); } catch (e) { return json({ error: e.message }, 500, cors); }
        await env.DB.prepare("UPDATE footage SET judul=? WHERE id=?").bind(judul, d.id).run();
        // LOG: Rename footage
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, `Mengganti nama footage ID ${d.id} -> ${judul}`).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/footage/move" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const d = await request.json();
        const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(d.id).first();
        if (!row) return json({ error: "Footage tidak ditemukan" }, 404, cors);
        const newFolderId = d.folder_id ? Number(d.folder_id) : null;
        try {
          const oldParent = await resolveFolderDriveId(env, row.folder_id);
          const newParent = await resolveFolderDriveId(env, newFolderId);
          if (oldParent !== newParent) await driveMoveFile(env, row.drive_file_id, newParent, oldParent);
        } catch (e) { return json({ error: e.message }, 500, cors); }
        await env.DB.prepare("UPDATE footage SET folder_id=? WHERE id=?").bind(newFolderId, d.id).run();
        // LOG: Pindah footage
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, `Memindahkan footage ID ${d.id}`).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/footage/star" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const d = await request.json();
        const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(d.id).first();
        if (!row) return json({ error: "Footage tidak ditemukan" }, 404, cors);
        const starred = row.starred ? 0 : 1;
        await env.DB.prepare("UPDATE footage SET starred=? WHERE id=?").bind(starred, d.id).run();
        return json({ ok: true, starred: !!starred }, 200, cors);
      }
      if (path === "/footage/download" && request.method === "GET") {
        if (rateLimit("dl:" + (request.headers.get("CF-Connecting-IP") || me.username), 60, 60000))
          return json({ error: "Terlalu banyak unduhan. Coba lagi sebentar." }, 429, cors);
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Footage tidak ditemukan" }, 404, cors);
        const rangeHdr = request.headers.get("Range");
        let driveRes;
        try { driveRes = await driveDownload(env, row.drive_file_id, rangeHdr); } catch (e) { return json({ error: e.message }, 500, cors); }
        if (!driveRes.ok) return json({ error: "Footage tidak ada di Google Drive" }, 404, cors);
        const dlHeaders = { ...cors, "Content-Type": row.mime_type || "application/octet-stream", "Content-Disposition": 'attachment; filename="' + safeFilename(row.judul) + '"' };
        if (rangeHdr) dlHeaders["Accept-Ranges"] = "bytes";
        return new Response(driveRes.body, { status: driveRes.status || 200, headers: dlHeaders });
      }
      if (path === "/footage/thumb" && request.method === "GET") {
        if (rateLimit("thumb:" + (request.headers.get("CF-Connecting-IP") || me.username), 300, 60000))
          return json({ error: "Terlalu banyak permintaan thumbnail. Coba lagi sebentar." }, 429, cors);
        const id = url.searchParams.get("id");
        const size = url.searchParams.get("s") === "2000" ? 2000 : 400;
        const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Footage tidak ditemukan" }, 404, cors);
        try {
          const thumbRes = await driveGetThumbnail(env, row.drive_file_id, size);
          return new Response(thumbRes.body, { status: 200, headers: { ...cors, "Content-Type": thumbRes.headers.get("Content-Type") || "image/jpeg", "Cache-Control": "public, max-age=604800, immutable" } });
        } catch (e) { return json({ error: e.message }, 404, cors); }
      }
      if (path === "/footage/move-bulk" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const d = await request.json();
        const ids = Array.isArray(d.ids) ? d.ids : [];
        const newFolderId = d.folder_id ? Number(d.folder_id) : null;
        let moved = 0;
        for (const id of ids) {
          const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(id).first();
          if (!row) continue;
          try {
            const oldParent = await resolveFolderDriveId(env, row.folder_id);
            const newParent = await resolveFolderDriveId(env, newFolderId);
            if (oldParent !== newParent) await driveMoveFile(env, row.drive_file_id, newParent, oldParent);
            await env.DB.prepare("UPDATE footage SET folder_id=? WHERE id=?").bind(newFolderId, id).run();
            moved++;
          } catch {}
        }
        // LOG: Pindah massal
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, `Memindahkan ${moved} footage sekaligus`).run();
        return json({ ok: true, moved }, 200, cors);
      }
      if (path === "/footage/delete-bulk" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const d = await request.json();
        const ids = Array.isArray(d.ids) ? d.ids : [];
        let deleted = 0;
        for (const id of ids) {
          const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(id).first();
          if (!row) continue;
          await driveDelete(env, row.drive_file_id);
          await env.DB.prepare("DELETE FROM footage WHERE id=?").bind(id).run();
          deleted++;
        }
        // LOG: Hapus massal
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, `Menghapus ${deleted} footage sekaligus`).run();
        return json({ ok: true, deleted }, 200, cors);
      }
      if (path === "/footage" && request.method === "DELETE") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Footage tidak ditemukan" }, 404, cors);
        await driveDelete(env, row.drive_file_id);
        await env.DB.prepare("DELETE FROM footage WHERE id=?").bind(id).run();
        // LOG: Hapus footage
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menghapus footage: " + row.judul).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/footage/view" && request.method === "GET") {
        if (rateLimit("view:" + (request.headers.get("CF-Connecting-IP") || me.username), 60, 60000))
          return json({ error: "Terlalu banyak permintaan media. Coba lagi sebentar." }, 429, cors);
        const id = url.searchParams.get("id");
        const row = await env.DB.prepare("SELECT * FROM footage WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Footage tidak ditemukan" }, 404, cors);
        let driveRes;
        try { driveRes = await driveDownload(env, row.drive_file_id); } catch (e) { return json({ error: e.message }, 500, cors); }
        if (!driveRes.ok) return json({ error: "Footage tidak ada di Google Drive" }, 404, cors);
        return new Response(driveRes.body, { status: 200, headers: { ...cors, "Content-Type": row.mime_type || "application/octet-stream" } });
      }

      if (path === "/footage/sync" && request.method === "POST") {
        const denied = requireEdit(me, "footage", cors); if (denied) return denied;
        const folders = await env.DB.prepare("SELECT * FROM footage_folders").all();
        const targets = [{ folder_id: null, drive_folder_id: env.GOOGLE_FOLDER_FOOTAGE }, ...folders.results.map((f) => ({ folder_id: f.id, drive_folder_id: f.drive_folder_id }))];
        const existing = await env.DB.prepare("SELECT drive_file_id FROM footage").all();
        const existingIds = new Set(existing.results.map((r) => r.drive_file_id));
        let added = 0, totalDrive = 0;
        for (const t of targets) {
          let driveFiles;
          try { driveFiles = await driveListFolder(env, t.drive_folder_id); } catch { continue; }
          totalDrive += driveFiles.length;
          for (const f of driveFiles) {
            if (existingIds.has(f.id)) continue;
            if (f.mimeType && f.mimeType.startsWith("application/vnd.google-apps")) continue;
            const tipe = (f.mimeType || "").startsWith("video/") ? "video" : "foto";
            await env.DB.prepare("INSERT INTO footage (judul,tipe,size,mime_type,drive_file_id,folder_id,uploaded_by) VALUES (?,?,?,?,?,?,?)")
              .bind(f.name, tipe, f.size ? Number(f.size) : 0, f.mimeType || "", f.id, t.folder_id, me.username + " (sync)").run();
            existingIds.add(f.id); added++;
          }
        }
        return json({ ok: true, added, total_di_drive: totalDrive }, 200, cors);
      }

      // ===== EXPORT =====
      if (path === "/export/data" && request.method === "GET") {
        const denied = requireProposalEdit(me, cors); if (denied) return denied;
        const exportAllowed = isAdminRole(me.role) || me.role === "bendahara" || me.role === "sekertaris";
        if (!exportAllowed) return json({ error: "Anda tidak memiliki izin untuk export data. Hubungi admin." }, 403, cors);
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        const proposalOnly = ROLE_PROPOSAL_ONLY.includes(me.role);
        let keuangan = { results: [] };
        let spj = { results: [] };
        if (!proposalOnly) {
          if (start && end) {
            keuangan = await env.DB.prepare("SELECT * FROM keuangan WHERE tanggal >= ? AND tanggal <= ? ORDER BY tanggal ASC").bind(start, end).all();
            spj = await env.DB.prepare("SELECT * FROM spj WHERE tanggal >= ? AND tanggal <= ? ORDER BY tanggal ASC").bind(start, end).all();
          } else {
            keuangan = await env.DB.prepare("SELECT * FROM keuangan ORDER BY tanggal ASC").all();
            spj = await env.DB.prepare("SELECT * FROM spj ORDER BY tanggal ASC").all();
          }
        }
        const proposal = await env.DB.prepare("SELECT * FROM proposal ORDER BY id ASC").all();

        // LOG: Export data
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Export data laporan" + (start && end ? ` (${start} s/d ${end})` : " (semua)")).run();

        return json({ range: { start: start || null, end: end || null }, keuangan: keuangan.results, spj: spj.results, proposal: proposal.results }, 200, cors);
      }

      // ===== EVENT (Manajemen Event) =====
      // Semua role (termasuk anggota) boleh LIHAT/TAMBAH/EDIT. Hanya role
      // selain anggota yang boleh HAPUS dan acc/checklist (centang alat
      // tersedia + ubah status draft/berjalan/selesai).
      if (path === "/event" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM events ORDER BY tanggal_mulai DESC, id DESC").all();
        const results = rows.results.map((r) => {
          let alat = [];
          try { alat = JSON.parse(r.kebutuhan_alat || "[]"); } catch {}
          return { ...r, kebutuhan_alat: alat };
        });
        return json(results, 200, cors);
      }
      if (path === "/event" && request.method === "POST") {
        // Anggota tidak boleh membuat event; hanya pengurus (non-anggota).
        const denied = requireNonAnggota(me, cors); if (denied) return denied;
        let d;
        try { d = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }
        const nama = (d.nama || "").toString().trim();
        if (!nama) return json({ error: "Nama event wajib diisi" }, 400, cors);
        const tanggalMulai = validTanggal(d.tanggal_mulai);
        const tanggalSelesai = validTanggal(d.tanggal_selesai);
        if (!tanggalMulai || !tanggalSelesai) {
          return json({ error: "Tanggal mulai dan tanggal selesai wajib diisi dengan format YYYY-MM-DD" }, 400, cors);
        }
        if (tanggalSelesai < tanggalMulai) return json({ error: "Tanggal selesai tidak boleh sebelum tanggal mulai" }, 400, cors);
        if (d.total_biaya !== undefined && d.total_biaya !== "" && numPos(d.total_biaya) === null && Number(d.total_biaya) !== 0) {
          return json({ error: "Total biaya harus angka 0 atau lebih" }, 400, cors);
        }
        const deskripsi = (d.deskripsi || "").toString();
        const totalBiaya = Math.max(0, Number(d.total_biaya) || 0);
        let kebutuhanAlat = [];
        if (Array.isArray(d.kebutuhan_alat)) {
          kebutuhanAlat = d.kebutuhan_alat.map((item) => ({
            nama: (item.nama || "").toString().trim(),
            jumlah: Math.max(0, Number(item.jumlah) || 0),
            tersedia: !!item.tersedia,
          }));
        }

        const ins = await env.DB.prepare(
          "INSERT INTO events (nama,tanggal_mulai,tanggal_selesai,deskripsi,kebutuhan_alat,total_biaya,status,dibuat_oleh) VALUES (?,?,?,?,?,?,?,?)"
        ).bind(nama, tanggalMulai, tanggalSelesai, deskripsi, JSON.stringify(kebutuhanAlat), totalBiaya, "draft", me.username).run();

        // LOG: Membuat event
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Membuat event: " + nama).run();

        return json({ ok: true, id: ins.meta.last_row_id }, 200, cors);
      }
      if (path === "/event" && request.method === "PUT") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM events WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Event tidak ditemukan" }, 404, cors);

        let d;
        try { d = await request.json(); } catch { return json({ error: "Body request tidak valid (harus JSON)" }, 400, cors); }

        // Anggota hanya boleh mengubah event buatannya sendiri, dan tidak boleh
        // menyentuh anggaran (total_biaya) — itu wewenang pengurus.
        const isPrivileged = me.role !== "anggota";
        if (!isPrivileged && row.dibuat_oleh !== me.username) {
          return json({ error: "Anda hanya boleh mengubah event yang Anda buat sendiri." }, 403, cors);
        }
        if (!isPrivileged && d.total_biaya !== undefined && Number(d.total_biaya) !== Number(row.total_biaya || 0)) {
          return json({ error: "Hanya pengurus yang boleh mengubah anggaran event." }, 403, cors);
        }

        const nama = (d.nama || row.nama).toString().trim();
        if (!nama) return json({ error: "Nama event wajib diisi" }, 400, cors);
        const tanggalMulai = d.tanggal_mulai !== undefined ? validTanggal(d.tanggal_mulai) : row.tanggal_mulai;
        const tanggalSelesai = d.tanggal_selesai !== undefined ? validTanggal(d.tanggal_selesai) : row.tanggal_selesai;
        if (!tanggalMulai || !tanggalSelesai) return json({ error: "Tanggal harus format YYYY-MM-DD dan valid" }, 400, cors);
        if (tanggalSelesai < tanggalMulai) return json({ error: "Tanggal selesai tidak boleh sebelum tanggal mulai" }, 400, cors);
        const deskripsi = d.deskripsi !== undefined ? (d.deskripsi || "").toString() : row.deskripsi;
        const totalBiaya = (isPrivileged && d.total_biaya !== undefined)
          ? Math.max(0, Number(d.total_biaya) || 0)
          : Number(row.total_biaya) || 0;

        let oldAlat = [];
        try { oldAlat = JSON.parse(row.kebutuhan_alat || "[]"); } catch { oldAlat = []; }

        // Anggota boleh edit nama/jumlah alat, tapi TIDAK boleh mengubah status
        // "tersedia" (itu wewenang acc/checklist -> requireNonAnggota di bawah).
        let kebutuhanAlat = oldAlat;
        if (Array.isArray(d.kebutuhan_alat)) {
          kebutuhanAlat = d.kebutuhan_alat.map((item, i) => {
            const tersediaLama = oldAlat[i] ? !!oldAlat[i].tersedia : false;
            const tersedia = isPrivileged && typeof item.tersedia === "boolean" ? item.tersedia : tersediaLama;
            return {
              nama: (item.nama || "").toString().trim(),
              jumlah: Math.max(0, Number(item.jumlah) || 0),
              tersedia,
            };
          });
        }

        // Status juga dijaga di sini sebagai lapis keamanan tambahan (harusnya
        // diubah lewat /event/checklist, bukan lewat PUT umum ini).
        let status = row.status;
        if (isPrivileged && d.status) {
          const s = d.status.toString().trim().toLowerCase();
          if (!VALID_STATUS_EVENT.includes(s)) return json({ error: "Status tidak valid (harus salah satu dari: " + VALID_STATUS_EVENT.join(", ") + ")" }, 400, cors);
          status = s;
        }

        await env.DB.prepare(
          "UPDATE events SET nama=?, tanggal_mulai=?, tanggal_selesai=?, deskripsi=?, kebutuhan_alat=?, total_biaya=?, status=?, diubah_oleh=? WHERE id=?"
        ).bind(nama, tanggalMulai, tanggalSelesai, deskripsi, JSON.stringify(kebutuhanAlat), totalBiaya, status, me.username, id).run();

        // LOG: Mengubah event
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Mengubah event: " + nama).run();

        return json({ ok: true }, 200, cors);
      }
      if (path === "/event" && request.method === "DELETE") {
        const denied = requireNonAnggota(me, cors); if (denied) return denied;
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM events WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Event tidak ditemukan" }, 404, cors);
        await env.DB.prepare("DELETE FROM events WHERE id=?").bind(id).run();
        // LOG: Menghapus event
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Menghapus event: " + row.nama).run();
        return json({ ok: true }, 200, cors);
      }
      if (path === "/event/checklist" && request.method === "PATCH") {
        const denied = requireNonAnggota(me, cors); if (denied) return denied;
        const d = await request.json();
        const id = d.id;
        if (!id) return json({ error: "Parameter id wajib diisi" }, 400, cors);
        const row = await env.DB.prepare("SELECT * FROM events WHERE id=?").bind(id).first();
        if (!row) return json({ error: "Event tidak ditemukan" }, 404, cors);

        const VALID_STATUS = ["draft", "berjalan", "selesai"];
        let status = row.status;
        if (d.status !== undefined) {
          if (!VALID_STATUS.includes(d.status)) {
            return json({ error: "Status tidak valid (harus salah satu dari: " + VALID_STATUS.join(", ") + ")" }, 400, cors);
          }
          status = d.status;
        }

        let kebutuhanAlat = row.kebutuhan_alat;
        if (Array.isArray(d.kebutuhan_alat)) {
          kebutuhanAlat = JSON.stringify(d.kebutuhan_alat.map((item) => ({
            nama: (item.nama || "").toString().trim(),
            jumlah: Number(item.jumlah) || 0,
            tersedia: !!item.tersedia,
          })));
        }

        await env.DB.prepare("UPDATE events SET status=?, kebutuhan_alat=?, diubah_oleh=? WHERE id=?")
          .bind(status, kebutuhanAlat, me.username, id).run();

        // LOG: Update checklist/status event
        await env.DB.prepare("INSERT INTO log_aktivitas (username, aktivitas) VALUES (?,?)")
          .bind(me.username, "Update checklist/status event ID " + id + " -> " + status).run();

        return json({ ok: true }, 200, cors);
      }

      // ===== PEMBERSIHAN OTOMATIS (Hanya Admin/Ketua) =====
      if (path === "/cleanup" && request.method === "POST") {
        if (!isAdminRole(me.role)) {
          return json({ error: "Hanya Admin/Ketua yang boleh melakukan pembersihan." }, 403, cors);
        }
        // Hapus log lebih dari 30 hari
        await env.DB.prepare("DELETE FROM log_aktivitas WHERE waktu < datetime('now', '-30 days')").run();
        // Hapus chat yang bukan 500 pesan terakhir
        await env.DB.prepare(
          "DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 500)"
        ).run();
        await env.DB.prepare("DELETE FROM upload_sessions WHERE status='error'").run();
        return json({ ok: true, message: "Pembersihan selesai" }, 200, cors);
      }

      // ===== STATS (Dashboard counters) =====
      if (path === "/stats" && request.method === "GET") {
        const keuangan = await env.DB.prepare("SELECT COUNT(*) AS n FROM keuangan").first();
        const spj = await env.DB.prepare("SELECT COUNT(*) AS n FROM spj").first();
        const footage = await env.DB.prepare("SELECT COUNT(*) AS n FROM footage").first();
        const file = await env.DB.prepare("SELECT COUNT(*) AS n FROM files").first();
        const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
        const proposal = await env.DB.prepare("SELECT COUNT(*) AS n FROM proposal").first();
        const event = await env.DB.prepare("SELECT COUNT(*) AS n FROM events").first();
        const log = await env.DB.prepare("SELECT COUNT(*) AS n FROM log_aktivitas").first();
        return json({
          keuangan: keuangan?.n || 0,
          spj: spj?.n || 0,
          footage: footage?.n || 0,
          file: file?.n || 0,
          users: users?.n || 0,
          proposal: proposal?.n || 0,
          event: event?.n || 0,
          log: log?.n || 0
        }, 200, cors);
      }

      if (path === "/auth/thumb-token" && request.method === "GET") {
        if (me.thumbOnly) return json({ error: "Token thumbnail tidak bisa membuat token thumbnail baru." }, 403, cors);
        try { return json({ thumb_token: await makeThumbToken(env, me.username) }, 200, cors); }
        catch (e) { return json({ error: e.message }, 500, cors); }
      }

      // ===== TOKEN VERSION (force re-login on secret rotate) =====
      if (path === "/auth/token-version" && request.method === "GET") {
        return json({ token_version: env.TOKEN_VERSION || "1" }, 200, cors);
      }

      return json({ error: "Not found: " + path }, 404, cors);
    } catch (err) {
      console.error("Worker error:", err && err.stack ? err.stack : err);
      return json({ error: "Terjadi kesalahan pada server. Silakan coba lagi." }, 500, cors);
    }
  },
};

function safeFilename(name) {
  return String(name || "file").replace(/[\r\n";]/g, "_").replace(/^\.+/, "");
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}