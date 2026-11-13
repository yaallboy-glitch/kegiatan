// Self-check: rate limit + query-token auth. Jalankan: node test_ratelimit.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";

// ambil potongan fungsi dari worker, jangan import seluruh modul (butuh env)
const src = readFileSync(new URL("./worker/src/index.js", import.meta.url), "utf8");
const grab = (name) => {
  const i = src.indexOf(name);
  assert(i > 0, "fungsi " + name + " tidak ditemukan");
  // ambil sampai baris penutup "}\n" di kolom 0
  const end = src.indexOf("\n}\n", i);
  return src.slice(i, end + 3);
};
const rateLimitSrc = grab("function rateLimit(");
const _rateBuckets = new Map();
const rateLimit = new Function("_rateBuckets", rateLimitSrc + " return rateLimit;")(_rateBuckets);

// --- 1. batas terlampaui tepat setelah limit ---
let blocked = 0;
for (let i = 0; i < 5; i++) if (rateLimit("ip1", 5, 60000)) blocked++;
assert.equal(blocked, 0, "5 request pertama harus lolos");
assert.equal(rateLimit("ip1", 5, 60000), true, "request ke-6 harus diblok");

// --- 2. key terpisah tidak saling ganggu ---
assert.equal(rateLimit("ip2", 5, 60000), false, "IP lain tidak boleh kena");

// --- 3. window reset ---
const buckets2 = new Map([["ipX", { count: 99, resetAt: Date.now() - 1 }]]);
const rl2 = new Function("_rateBuckets", rateLimitSrc + " return rateLimit;")(buckets2);
assert.equal(rl2("ipX", 5, 60000), false, "setelah window lewat harus reset");
assert.equal(buckets2.get("ipX").count, 1, "counter harus mulai dari 1");

// --- 4. Map dibersihkan saat > 5000 entri ---
const buckets3 = new Map();
for (let i = 0; i < 5100; i++) buckets3.set("k" + i, { count: 1, resetAt: Date.now() - 1 });
const rl3 = new Function("_rateBuckets", rateLimitSrc + " return rateLimit;")(buckets3);
rl3("new", 5, 60000);
assert(buckets3.size < 600, "entri kedaluwarsa harus dibuang, dapat " + buckets3.size);

// --- 5. verifyAuthHeader menerima ?t= hanya saat allowQueryToken ---
const verifySrc = grab("async function verifyAuthHeader(");
const signSrc = grab("async function signPayload(");
const makeSrc = grab("async function makeToken(");
const crypto = globalThis.crypto;
const env = { TOKEN_SECRET: "rahasia-uji", DB: { prepare: () => ({ bind: () => ({ first: async () => ({ role: "admin" }) }) }) } };
const b64 = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.btoa = b64; globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");
globalThis.unescape = globalThis.unescape || ((s) => s);
const fn = new Function("crypto", signSrc + makeSrc + verifySrc + " return { makeToken, verifyAuthHeader };")(crypto);
const token = await fn.makeToken(env, "budi", "Budi");

const mkReq = (u, h = {}) => new Request(u, { headers: h });
assert.equal(await fn.verifyAuthHeader(env, mkReq("https://x/footage/thumb?id=1&t=" + token), false), null,
  "?t= harus DITOLAK kalau allowQueryToken=false");
const okQuery = await fn.verifyAuthHeader(env, mkReq("https://x/footage/thumb?id=1&t=" + token), true);
assert(okQuery && okQuery.username === "budi", "?t= harus DITERIMA kalau allowQueryToken=true");
const okHdr = await fn.verifyAuthHeader(env, mkReq("https://x/footage/thumb?id=1", { Authorization: "Bearer " + token }), false);
assert(okHdr && okHdr.username === "budi", "header Bearer harus tetap jalan");
assert.equal(await fn.verifyAuthHeader(env, mkReq("https://x/footage/thumb?id=1&t=palsu"), true), null, "token palsu ditolak");

console.log("OK semua 12 assert lolos");