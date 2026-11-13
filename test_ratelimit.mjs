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

// --- 5. token login vs token thumbnail (scope terpisah) ---
globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");
globalThis.unescape = globalThis.unescape || ((s) => s);
const crypto = globalThis.crypto;
const env = { TOKEN_SECRET: "rahasia-uji", DB: { prepare: () => ({ bind: () => ({ first: async () => ({ role: "admin" }) }) }) } };
const fn = new Function("crypto",
  grab("async function signPayload(") + grab("async function makeToken(")
  + grab("async function makeThumbToken(") + grab("async function verifyThumbToken(")
  + grab("async function verifyAuthHeader(")
  + " return { makeToken, makeThumbToken, verifyThumbToken, verifyAuthHeader };"
)(crypto);
const loginToken = await fn.makeToken(env, "budi", "Budi");
const thumbToken = await fn.makeThumbToken(env, "budi");
const mkReq = (u, h = {}) => new Request(u, { headers: h });

// thumb token lewat ?t= -> diterima dan ditandai thumbOnly
const q = await fn.verifyAuthHeader(env, mkReq("https://x/footage/thumb?id=1&t=" + thumbToken), true);
assert(q && q.username === "budi" && q.thumbOnly === true, "thumb token diterima dan ditandai thumbOnly");

// thumb token sebagai Bearer -> DITOLAK, tidak bisa naik jadi token login
assert.equal(await fn.verifyAuthHeader(env, mkReq("https://x/footage", { Authorization: "Bearer " + thumbToken }), false), null,
  "thumb token harus ditolak sebagai Bearer");

// token login sebagai Bearer -> jalan
const okHdr = await fn.verifyAuthHeader(env, mkReq("https://x/footage", { Authorization: "Bearer " + loginToken }), false);
assert(okHdr && okHdr.username === "budi" && !okHdr.thumbOnly, "token login valid sebagai Bearer");

// token login lewat ?t= -> DITOLAK, slot ?t= khusus thumb token
assert.equal(await fn.verifyAuthHeader(env, mkReq("https://x/footage/thumb?id=1&t=" + loginToken), true), null,
  "token login tidak boleh dipakai di ?t=");

// ?t= ditolak kalau allowQueryToken=false
assert.equal(await fn.verifyAuthHeader(env, mkReq("https://x/footage/thumb?id=1&t=" + thumbToken), false), null,
  "?t= ditolak kalau allowQueryToken=false");

// signature diubah -> ditolak
const flipped = thumbToken.slice(0, -1) + (thumbToken.endsWith("0") ? "1" : "0");
assert.equal(await fn.verifyThumbToken(env, flipped), null, "signature salah ditolak");

// payload kedaluwarsa dengan signature valid -> ditolak
const sig = thumbToken.split(".")[1];
const past = Buffer.from("thumb|budi|1|" + (Date.now() - 1000), "binary").toString("base64");
assert.equal(await fn.verifyThumbToken(env, past + "." + sig), null, "thumb token kedaluwarsa ditolak");

console.log("OK semua assert lolos");