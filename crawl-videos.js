#!/usr/bin/env node
/* MIFASA video crawler. Inkomoko: (1) YouTube RSS (channels) (2) Internet Archive (public domain / Creative Commons) (3) Pexels (Pexels License; bisaba PEXELS_API_KEY).
   Ntikuramo video: ibika link, izina, ibisobanuro bigufi, itariki, uruhushya (license) n'uwayifite. Usage: node crawl-videos.js [--dry]   (Node 18+, nta dependencies) */
const fs = require("fs"), DRY = process.argv.includes("--dry"), UA = "MIFASA-VideoCrawler/1.1 (+https://mifasarw.neocities.org)";
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const cfg = rd("video-channels.json", null); if (!cfg) { console.error("video-channels.json ntibonetse"); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms)), UCID = /^UC[\w-]{22}$/, VID = /^[\w-]{11}$/, one = x => [].concat(x == null ? "" : x)[0];
const clip = (s, n) => String(one(s) || "").replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const dec = s => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
let status = 0;
async function get(url, headers) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en", Cookie: "CONSENT=YES+1", ...headers }, signal: AbortSignal.timeout(20000) }); status = r.status; if (r.ok) return await r.text(); if (r.status === 404 || r.status === 401 || r.status === 403) return null; } catch (e) { status = 0; }
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
const parseFeed = xml => xml.split("<entry>").slice(1).map(e => ({ id: tag(e, "yt:videoId"), title: clip(tag(e, "title"), 150), date: tag(e, "published").slice(0, 10), desc: clip(tag(e, "media:description"), 200) })).filter(v => VID.test(v.id) && v.title);
const lic = u => { u = String(u || ""); let m = /creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/.exec(u); if (m) return "CC " + m[1].toUpperCase() + " " + m[2]; if (/publicdomain\/zero/.test(u)) return "CC0"; if (/publicdomain/.test(u)) return "Public Domain"; return ""; };
const today = () => new Date().toISOString().slice(0, 10), mmss = s => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");

async function fromYouTube(ch, exCh, st) {
  if (!UCID.test(ch.id || "")) { const id = await resolveId(ch.handle); if (id) { ch.id = id; st.idsChanged = true; } else { console.warn("! ID ntibonetse: @" + ch.handle + " (HTTP " + status + "). Yandike 'id' intoki."); return []; } }
  let xml = await get("https://www.youtube.com/feeds/videos.xml?channel_id=" + ch.id), s1 = status;
  if (!xml) xml = await get("https://www.youtube.com/feeds/videos.xml?playlist_id=UU" + ch.id.slice(2));   // uploads playlist: ikora rimwe na rimwe iyo iya mbere inaniwe
  if (!xml) { console.warn("! RSS ntiboneka: @" + ch.handle + " (channel HTTP " + s1 + ", playlist HTTP " + status + ", id " + ch.id + ")"); return []; }
  return parseFeed(xml).slice(0, cfg.max_per_channel || 15).map(v => ({ key: v.id, url: "https://youtu.be/" + v.id, title: v.title, description: v.desc, date: v.date, channel: ch.name || ch.handle, channel_url: "https://www.youtube.com/channel/" + ch.id, license: "YouTube (embed)" }));
}
async function fromArchive(s) {
  const q = "(" + s.query + ") AND mediatype:movies", u = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) + ["identifier", "title", "description", "licenseurl", "publicdate", "creator"].map(f => "&fl[]=" + f).join("") + "&sort[]=downloads+desc&rows=" + Math.min(60, (s.max || 8) * 6) + "&output=json";
  const t = await get(u); if (!t) { console.warn("! archive.org ntiboneka: " + s.name + " (HTTP " + status + ")"); return []; }
  let docs = []; try { docs = JSON.parse(t).response.docs || []; } catch (e) {}
  return docs.filter(d => /^[\w.\-]{1,100}$/.test(d.identifier || "") && lic(one(d.licenseurl))).slice(0, s.max || 8).map(d => ({ key: d.identifier, url: "https://archive.org/details/" + d.identifier, title: clip(d.title, 150), description: clip(d.description, 200), date: String(one(d.publicdate)).slice(0, 10) || today(),
    channel: s.name, channel_url: "https://archive.org/details/" + d.identifier, license: lic(one(d.licenseurl)), thumb: "https://archive.org/services/img/" + d.identifier, credit: clip(d.creator, 80) })).filter(v => v.title);
}
async function fromPexels(s) {
  const key = process.env.PEXELS_API_KEY; if (!key) { console.warn("- Pexels isimbutse (nta PEXELS_API_KEY)"); return []; }
  const t = await get("https://api.pexels.com/videos/search?orientation=landscape&per_page=" + (s.max || 6) + "&query=" + encodeURIComponent(s.query), { Authorization: key }); if (!t) { console.warn("! Pexels (HTTP " + status + ")"); return []; }
  let vs = []; try { vs = JSON.parse(t).videos || []; } catch (e) {}
  return vs.map(v => { const f = (v.video_files || []).filter(x => x.file_type === "video/mp4" && /^https:\/\//.test(x.link) && x.width && x.width <= 1280).sort((a, b) => b.width - a.width)[0]; if (!f) return null;
    return { key: f.link, url: f.link, title: clip(s.query, 60) + " (stock #" + v.id + ")", description: "Video y'ubuntu ya Pexels (Pexels License) na " + clip(v.user && v.user.name, 60) + ".", date: today(), duration_estimate: mmss(v.duration || 0),
      channel: s.name, channel_url: /^https:\/\/www\.pexels\.com\//.test(v.url || "") ? v.url : "https://www.pexels.com/", license: "Pexels License", thumb: /^https:\/\//.test(v.image || "") ? v.image : "", credit: clip(v.user && v.user.name, 80) }; }).filter(Boolean);
}
const keyOf = v => { const m = /youtu\.be\/([\w-]{11})/.exec(v.url || "") || /archive\.org\/details\/([\w.\-]+)/.exec(v.url || ""); return m ? m[1] : (v.url || ""); };
(async () => {
  const exCh = new Set((cfg.exclude_channels || []).map(h => h.toLowerCase())), exVid = new Set(cfg.exclude_videos || []), st = { idsChanged: false };
  const file = rd("videos.json", { videos: [] }), map = new Map();
  for (const v of Array.isArray(file.videos) ? file.videos : []) { const k = keyOf(v); if (k && !exVid.has(k) && !(v.source === "crawl" && exCh.has(String(v.handle || "").toLowerCase()))) map.set(k, v); }
  let added = 0;
  const add = (items, base, name) => { for (const v of items) { if (exVid.has(v.key) || map.has(v.key)) continue; const { key, ...o } = v; map.set(key, { duration_estimate: "unknown", category: base.category || "Amashusho", tags: base.tags || [], ...o, handle: name, source: "crawl" }); added++; } };
  for (const ch of cfg.channels || []) { if (exCh.has(ch.handle.toLowerCase())) continue; add(await fromYouTube(ch, exCh, st), ch, ch.handle); console.log("@" + ch.handle + " done"); await sleep(1000); }
  for (const s of cfg.sources || []) { if (exCh.has(String(s.name).toLowerCase())) continue; add(s.type === "pexels" ? await fromPexels(s) : await fromArchive(s), s, s.name); console.log(s.name + " done"); await sleep(800); }
  const all = [...map.values()].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).slice(-(cfg.max_total || 300));
  const out = JSON.stringify({ _note: file._note || "Videos: manual + crawl-videos.js.", videos: all }, null, 1) + "\n";
  console.log("added " + added + ", total " + all.length + (DRY ? " (dry)" : "")); if (DRY) return;
  if (!fs.existsSync("videos.json") || out !== fs.readFileSync("videos.json", "utf8")) fs.writeFileSync("videos.json", out);
  if (st.idsChanged) fs.writeFileSync("video-channels.json", JSON.stringify(cfg, null, 2) + "\n");
})();
