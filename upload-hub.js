/* MIFASA HUB: uploads ONLY stories (no videos) to https://mizeromifasa.neocities.org/
   Secret needed: NEOCITIES_API_KEY_HUB.
   Sends: news-archive/** (permanent stories), news-full/** (full text of each story, 1000+ words when the page has them), s/** (one HTML page per story), crawl-news.json, sitemap.xml, feed.xml
   NEVER sends: videos/**.
   Compares sha1 with what is REALLY on the hub (GET /api/list), so only new/changed files are uploaded. Run: node upload-hub.js */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const KEY = process.env.NEOCITIES_API_KEY_HUB;
const API = "https://neocities.org/api";
const ROOTS = ["news-archive", "news-full", "s"], SINGLES = ["crawl-news.json", "sitemap.xml", "feed.xml"];
const OK_EXT = /\.(html|json|xml|txt|js|css)$/i;
const BATCH = 20, MAX_FILE = 5 * 1024 * 1024;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out); else if (OK_EXT.test(n) && st.size <= MAX_FILE) out.push(p.split(path.sep).join("/"));
  }
  return out;
}
const sha1 = f => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
const auth = { Authorization: "Bearer " + KEY };

async function main() {
  if (!KEY) { console.log("NEOCITIES_API_KEY_HUB is not set: skipping hub upload"); return; }
  const files = [];
  ROOTS.forEach(r => walk(r, files));
  SINGLES.forEach(f => { if (fs.existsSync(f)) files.push(f); });

  const remote = new Map();
  const r = await fetch(API + "/list", { headers: auth });
  const j = await r.json();
  if (j.result !== "success") throw new Error("list failed: " + JSON.stringify(j));
  (j.files || []).forEach(f => { if (!f.is_directory) remote.set(f.path, f.sha1_hash); });

  const todo = files.filter(f => remote.get(f) !== sha1(f));
  console.log("hub: " + files.length + " local story files, " + todo.length + " to upload");

  let sent = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const fd = new FormData();
    todo.slice(i, i + BATCH).forEach(f => fd.append(f, new Blob([fs.readFileSync(f)]), path.basename(f)));
    let done = false;
    for (let a = 1; a <= 3 && !done; a++) {
      try {
        const res = await fetch(API + "/upload", { method: "POST", headers: auth, body: fd });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.result === "success") { done = true; sent += Math.min(BATCH, todo.length - i); }
        else console.log("retry " + a + ": " + res.status + " " + (out.message || ""));
      } catch (e) { console.log("retry " + a + ": " + e.message); }
      if (!done) await new Promise(s => setTimeout(s, 4000 * a));
    }
    if (!done) { console.log("FAIL batch starting at " + i + " (next run will resend it)"); }
  }
  console.log("hub: uploaded " + sent + " files");
}
main().catch(e => { console.error(e); process.exit(1); });
