/* MIFASARW -> Neocities uploader (Node 18+, no packages).
   Why: the old workflow sent only the files changed in the LAST commit. If one request failed, those files were never sent again
   (so s/<id>.html stayed missing and shared links showed "not found").
   Now: ask Neocities what it really has (sha1 per file), compare with the local files, send ONLY what is missing or different,
   in batches of 40, with retries. A file missed today is sent on the next run automatically. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KEY = process.env.NEOCITIES_API_KEY;
if (!KEY) { console.error("NEOCITIES_API_KEY is missing"); process.exit(1); }
const API = "https://neocities.org/api";
const H = { Authorization: "Bearer " + KEY };
const BATCH = 40;

/* what we keep on Neocities (folders are walked, single files are taken as they are) */
const SINGLE = ["crawl-news.json", "crawl-words.json", "crawl-knowledge.json", "sitemap.xml", "feed.xml", "404.html"];
const FOLDERS = [
  { dir: "s", ext: /\.html$/i },
  { dir: "news-archive", ext: /\.json$/i },
  { dir: "videos", ext: /\.json$/i }
];

const sha1 = f => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function localFiles() {
  const out = [];
  SINGLE.forEach(f => { if (fs.existsSync(f)) out.push(f); });
  FOLDERS.forEach(({ dir, ext }) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(n => { if (ext.test(n)) out.push(dir + "/" + n); });
  });
  return out;
}

async function withRetry(label, fn) {
  let err;
  for (let i = 1; i <= 4; i++) {
    try { return await fn(); } catch (e) { err = e; console.log(label + " failed (try " + i + "): " + e.message); await sleep(2000 * i); }
  }
  throw err;
}

async function remoteHashes() {
  const j = await withRetry("list", async () => {
    const r = await fetch(API + "/list", { headers: H });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
  if (j.result !== "success") throw new Error("list: " + JSON.stringify(j));
  const m = new Map();
  (j.files || []).forEach(f => { if (!f.is_directory) m.set(f.path, f.sha1_hash); });
  return m;
}

async function sendBatch(files) {
  await withRetry("upload", async () => {
    const fd = new FormData();
    files.forEach(f => fd.append(f, new Blob([fs.readFileSync(f)]), path.basename(f)));
    const r = await fetch(API + "/upload", { method: "POST", headers: H, body: fd });
    const t = await r.text();
    if (!r.ok) throw new Error("HTTP " + r.status + " " + t.slice(0, 200));
  });
}

(async () => {
  const remote = await remoteHashes();
  const todo = localFiles().filter(f => remote.get(f) !== sha1(f));
  console.log("local files to send: " + todo.length + " (Neocities already has " + remote.size + " files)");
  if (!todo.length) return;
  /* order matters: story pages s/ first, archive + videos next, crawl-news.json LAST,
     so a story never shows on the home page before its s/<id>.html page is online */
  const rank = f => f.startsWith("s/") ? 0 : f.startsWith("news-archive/") ? 1 : f.startsWith("videos/") ? 2 : f === "crawl-news.json" ? 9 : 5;
  todo.sort((a, b) => rank(a) - rank(b));
  let failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const part = todo.slice(i, i + BATCH);
    try { await sendBatch(part); console.log("sent " + (i + part.length) + "/" + todo.length); }
    catch (e) { failed += part.length; console.log("batch skipped, will retry next run: " + e.message); }
  }
  if (failed) { console.log(failed + " files still missing; the next run sends them."); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });