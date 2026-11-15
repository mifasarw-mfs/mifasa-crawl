#!/usr/bin/env node
/* MIFASA video crawler. Inkomoko: (1) YouTube RSS (channels) (2) Internet Archive (public domain / Creative Commons) (3) Pexels (Pexels License; bisaba PEXELS_API_KEY) (4) LINKS: link y'urubuga urwo ari rwo rwose (crawler ikurikira n'izindi page zarwo ikishakira videos), playlist, channel cyangwa video. Links zishyirwa muri video-links.txt (zoroshye) cyangwa muri video-channels.json.
   Ntikuramo video: ibika link, izina, ibisobanuro bigufi, itariki, uruhushya (license) n'uwayifite. Usage: node crawl-videos.js [--dry]   (Node 18+, nta dependencies) */
const fs = require("fs"), DRY = process.argv.includes("--dry"), UA = "MIFASA-VideoCrawler/1.1 (+https://mifasarw.neocities.org)";
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const cfg = rd("video-channels.json", null); if (!cfg) { console.error("video-channels.json ntibonetse"); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms)), UCID = /^UC[\w-]{22}$/, VID = /^[\w-]{11}$/, one = x => [].concat(x == null ? "" : x)[0];
const clip = (s, n) => String(one(s) || "").replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const dec = s => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
let status = 0, KNOWN = new Set(); const T0 = Date.now(), OUT_OF_TIME = () => Date.now() - T0 > 420000;   // 7 min (workflow ni 10)
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
/* ---- LINKS: link ishobora kuba channel (@handle | /channel/UC..), playlist (list=PL..), video imwe, cyangwa page (urubuga) ifite videos nyinshi ---- */
const PLID = /[?&;]list=((?:PL|UU|OL|FL|LL)[\w-]{10,40})/g, YTV = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^"'\s<>]*?[&;])?v=|shorts\/|live\/|v\/))([\w-]{11})(?![\w-])/g, HREF = /<a\s[^>]*?href=["']([^"'#][^"']*)["']/gi, FILE = /(?:src|href|content)=["']([^"']+\.(?:mp4|webm)(?:\?[^"']*)?)["']/gi;
const all = (re, s) => { const o = new Set(); let m; re.lastIndex = 0; while ((m = re.exec(s))) o.add(m[1]); return [...o]; };
async function fromPlaylist(id, name, max) {
  const xml = await get("https://www.youtube.com/feeds/videos.xml?playlist_id=" + id); if (!xml) { console.warn("! playlist ntiboneka: " + id + " (HTTP " + status + ")"); return []; }
  const head = xml.split("<entry>")[0], ai = head.indexOf("<author>"), au = ai < 0 ? "" : head.slice(ai), who = clip(tag(au, "name"), 80), uri = tag(au, "uri");
  return parseFeed(xml).slice(0, max).map(v => ({ key: v.id, url: "https://youtu.be/" + v.id, title: v.title, description: v.desc, date: v.date, channel: who || name || "YouTube", channel_url: /^https:\/\/www\.youtube\.com\//.test(uri) ? uri : "https://www.youtube.com/playlist?list=" + id, license: "YouTube (embed)" }));
}
async function oneVideo(id, name) {   // izina + nyirayo biva kuri oEmbed (video yihariye / private ntiboneka)
  const t = await get("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id)); if (!t) return null;
  let j = {}; try { j = JSON.parse(t); } catch (e) {} if (!j.title) return null;
  return { key: id, url: "https://youtu.be/" + id, title: clip(j.title, 150), description: "", date: today(), channel: clip(j.author_name, 80) || name || "YouTube", channel_url: /^https:\/\/www\.youtube\.com\//.test(j.author_url || "") ? j.author_url : "https://youtu.be/" + id, license: "YouTube (embed)" };
}
async function fromLink(l) {
  const max = l.max || 30; let u = null; try { u = new URL(l.url); } catch (e) {}
  if (!u || u.protocol !== "https:") { console.warn("! link ntiyemewe (https gusa): " + l.url); return []; }
  const host = u.hostname.replace(/^(www|m|music)\./, ""), out = [], seen = new Set(), push = v => { if (v && !seen.has(v.key)) { seen.add(v.key); out.push(v); } };
  if (host === "youtube.com" || host === "youtu.be") {
    const hm = /^\/@([^/]+)/.exec(u.pathname), cm = /^\/channel\/(UC[\w-]{22})/.exec(u.pathname);
    if (hm || cm) return fromYouTube({ handle: cm ? cm[1] : decodeURIComponent(hm[1]), id: cm ? cm[1] : "", name: l.name }, null, {});
    const lid = u.searchParams.get("list"), pm = /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname), vid = u.searchParams.get("v") || (pm ? pm[1] : host === "youtu.be" ? u.pathname.slice(1, 12) : "");
    if (lid && /^[\w-]{10,50}$/.test(lid)) (await fromPlaylist(lid, l.name, max)).forEach(push);
    if (VID.test(vid) && vid !== "videoseries") push(await oneVideo(vid, l.name));
    return out.slice(0, max);
  }
  /* Urubuga rwose: crawler itangirira kuri link, igakurikira links z'imbere mu rubuga rumwe (depth + pages), ikishakira videos kuri buri page */
  const maxPages = l.pages || cfg.site_pages || 25, maxDepth = l.depth != null ? l.depth : cfg.site_depth != null ? cfg.site_depth : 2, bare = h => h.replace(/^www\./, "");
  const queue = [[l.url, 0]], visited = new Set(); let first = true;
  while (queue.length && visited.size < maxPages && out.length < max && !OUT_OF_TIME()) {
    const [pu, d] = queue.shift(), pk = pu.split("#")[0]; if (visited.has(pk)) continue; visited.add(pk);
    const html = await get(pu); if (!html) { if (first) console.warn("! link ntifunguka: " + pu + " (HTTP " + status + ")"); first = false; continue; } first = false;
    const page = html.replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    for (const p of all(PLID, page)) { if (out.length >= max) break; (await fromPlaylist(p, l.name, max)).forEach(push); await sleep(500); }   // playlist zose ziri kuri page
    for (const id of all(YTV, page)) { if (out.length >= max) break; if (id === "videoseries" || seen.has(id) || KNOWN.has(id)) continue; push(await oneVideo(id, l.name)); await sleep(300); }   // video za YouTube (izisanzwe zirasimbukwa)
    for (const f of all(FILE, page)) { try { const fu = new URL(f, pu); if (fu.protocol !== "https:" || KNOWN.has(fu.href)) continue; const fn = decodeURIComponent(fu.pathname.split("/").pop()).replace(/\.(mp4|webm)$/i, "").replace(/[-_]+/g, " ");
      push({ key: fu.href, url: fu.href, title: clip(fn, 150) || "Video", description: "", date: today(), channel: l.name || host, channel_url: pu, license: "Urubuga rwa nyirarwo" }); } catch (e) {} }   // mp4/webm
    if (d < maxDepth) for (const href of all(HREF, page)) { try { const nu = new URL(href, pu); nu.hash = ""; if (nu.protocol === "https:" && bare(nu.hostname) === bare(u.hostname) && !visited.has(nu.href) && !/\.(jpe?g|png|gif|webp|svg|ico|css|js|pdf|zip|mp3|mp4|webm|xml|json|txt)$/i.test(nu.pathname)) queue.push([nu.href, d + 1]); } catch (e) {} }
    await sleep(400);
  }
  console.log("  " + l.url + ": pages " + visited.size + ", videos nshya " + out.length);
  return out.slice(0, max);
}
const keyOf = v => { const m = /youtu\.be\/([\w-]{11})/.exec(v.url || "") || /archive\.org\/details\/([\w.\-]+)/.exec(v.url || ""); return m ? m[1] : (v.url || ""); };
(async () => {
  const exCh = new Set((cfg.exclude_channels || []).map(h => h.toLowerCase())), exVid = new Set(cfg.exclude_videos || []), st = { idsChanged: false };
  const file = rd("videos.json", { videos: [] }), map = new Map();
  for (const v of Array.isArray(file.videos) ? file.videos : []) { const k = keyOf(v); if (k && !exVid.has(k) && !(v.source === "crawl" && exCh.has(String(v.handle || "").toLowerCase()))) map.set(k, v); }
  KNOWN = new Set(map.keys());
  const txt = (() => { try { return fs.readFileSync("video-links.txt", "utf8"); } catch (e) { return ""; } })();   // video-links.txt: link imwe kuri buri murongo (# = comment; "link | Izina")
  const txtLinks = txt.split(/\r?\n/).map(x => x.trim()).filter(x => x && x[0] !== "#").map(x => { const [url, name] = x.split("|").map(y => y.trim()); return { url, name: name || "", category: "Amashusho", tags: [] }; });
  let added = 0;
  const add = (items, base, name) => { for (const v of items) { if (exVid.has(v.key) || map.has(v.key)) continue; const { key, ...o } = v; map.set(key, { duration_estimate: "unknown", category: base.category || "Amashusho", tags: base.tags || [], ...o, handle: name, source: "crawl" }); added++; } };
  for (const ch of cfg.channels || []) { if (exCh.has(ch.handle.toLowerCase())) continue; add(await fromYouTube(ch, exCh, st), ch, ch.handle); console.log("@" + ch.handle + " done"); await sleep(1000); }
  for (const l0 of [...(cfg.links || []), ...txtLinks]) { if (OUT_OF_TIME()) { console.warn("! igihe cyashize, links zisigaye zizakorwa ubutaha"); break; } const l = typeof l0 === "string" ? { url: l0 } : l0; if (!l || !l.url) continue; const nm = l.name || l.url; if (exCh.has(String(nm).toLowerCase()) || exCh.has(String(l.url).toLowerCase())) continue; add(await fromLink(l), l, nm); console.log("link " + l.url + " done"); await sleep(1000); }
  for (const s of cfg.sources || []) { if (exCh.has(String(s.name).toLowerCase())) continue; add(s.type === "pexels" ? await fromPexels(s) : await fromArchive(s), s, s.name); console.log(s.name + " done"); await sleep(800); }
  const all = [...map.values()].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).slice(-(cfg.max_total || 300));
  const out = JSON.stringify({ _note: file._note || "Videos: manual + crawl-videos.js.", videos: all }, null, 1) + "\n";
  console.log("added " + added + ", total " + all.length + (DRY ? " (dry)" : "")); if (DRY) return;
  if (!fs.existsSync("videos.json") || out !== fs.readFileSync("videos.json", "utf8")) fs.writeFileSync("videos.json", out);
  if (st.idsChanged) fs.writeFileSync("video-channels.json", JSON.stringify(cfg, null, 2) + "\n");
})();
