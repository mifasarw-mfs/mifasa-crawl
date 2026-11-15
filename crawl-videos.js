#!/usr/bin/env node
/* MIFASA video crawler: ikurikira channels za YouTube (RSS yemewe ya YouTube, nta API key) ikavugurura videos.json.
   Ntikuramo video: ibika gusa link, izina, ibisobanuro bigufi (<=200), itariki na channel. Video ikinirwa na player ya YouTube.
   Usage: node crawl-videos.js [--dry]     (Node 18+, nta dependencies)   Files: video-channels.json (config), videos.json (output) */
const fs = require("fs"), DRY = process.argv.includes("--dry"), UA = "MIFASA-VideoCrawler/1.0 (+https://mifasarw.neocities.org)";
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const cfg = rd("video-channels.json", null); if (!cfg || !Array.isArray(cfg.channels)) { console.error("video-channels.json ntibonetse"); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms)), UCID = /^UC[\w-]{22}$/, VID = /^[\w-]{11}$/;
const clip = (s, n) => String(s || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const dec = s => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en", Cookie: "CONSENT=YES+1" }, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.text(); } catch (e) {}
    await sleep(1500 * (i + 1));
  }
  return null;
}
async function resolveId(handle) {
  const html = await get("https://www.youtube.com/@" + encodeURIComponent(handle)); if (!html) return null;
  for (const re of [/rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/, /itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"/, /"externalId":"(UC[\w-]{22})"/, /"channelId":"(UC[\w-]{22})"/]) { const m = re.exec(html); if (m) return m[1]; }
  return null;
}
const tag = (x, t) => { const m = new RegExp("<" + t + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + t + ">").exec(x); return m ? dec(m[1]).trim() : ""; };
function parseFeed(xml) {
  return xml.split("<entry>").slice(1).map(e => ({ id: tag(e, "yt:videoId"), title: clip(tag(e, "title"), 150), date: tag(e, "published").slice(0, 10), desc: clip(tag(e, "media:description"), 200) }))
    .filter(v => VID.test(v.id) && v.title);
}
(async () => {
  const exCh = new Set((cfg.exclude_channels || []).map(h => h.toLowerCase())), exVid = new Set(cfg.exclude_videos || []);
  const file = rd("videos.json", { videos: [] }), cur = Array.isArray(file.videos) ? file.videos : [];
  const idOf = u => { const m = /youtu\.be\/([\w-]{11})|[?&]v=([\w-]{11})/.exec(u || ""); return m ? (m[1] || m[2]) : ""; };
  const map = new Map(); for (const v of cur) { const id = idOf(v.url); if (id && !exVid.has(id) && !(v.source === "crawl" && exCh.has(String(v.handle || "").toLowerCase()))) map.set(id, v); else if (!id) map.set("x" + map.size, v); }
  let added = 0, idsChanged = false;
  for (const ch of cfg.channels) {
    if (exCh.has(ch.handle.toLowerCase())) continue;
    if (!UCID.test(ch.id || "")) { const id = await resolveId(ch.handle); if (id) { ch.id = id; idsChanged = true; } else { console.warn("! channel ID ntibonetse: @" + ch.handle + " (yandike 'id' intoki muri video-channels.json)"); continue; } }
    const xml = await get("https://www.youtube.com/feeds/videos.xml?channel_id=" + ch.id);
    if (!xml) { console.warn("! RSS ntiboneka: @" + ch.handle); continue; }
    for (const v of parseFeed(xml).slice(0, cfg.max_per_channel || 15)) {
      if (exVid.has(v.id) || map.has(v.id)) continue;
      map.set(v.id, { url: "https://youtu.be/" + v.id, title: v.title, description: v.desc, category: ch.category || "Amashusho", tags: ch.tags || [], duration_estimate: "unknown", date: v.date,
        channel: ch.name || ch.handle, channel_url: "https://www.youtube.com/channel/" + ch.id, handle: ch.handle, source: "crawl" });
      added++;
    }
    console.log("@" + ch.handle + " ok"); await sleep(1000);
  }
  const all = [...map.values()].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).slice(-(cfg.max_total || 300));   // kera -> gishya (nk'urubuga rwa Promo)
  const out = JSON.stringify({ _note: file._note || "Videos: manual + crawl-videos.js. Hindura intoki ibyo ushaka; crawler ntisimbura ibiriho.", videos: all }, null, 1) + "\n";
  console.log("added " + added + ", total " + all.length + (DRY ? " (dry)" : ""));
  if (DRY) return;
  if (out !== fs.readFileSync("videos.json", "utf8").toString() || !fs.existsSync("videos.json")) fs.writeFileSync("videos.json", out);
  if (idsChanged) fs.writeFileSync("video-channels.json", JSON.stringify(cfg, null, 2) + "\n");
})();
