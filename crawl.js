#!/usr/bin/env node
/* MIFASA crawl.js : free news crawler. Runs on YOUR computer (or GitHub Actions), NOT in the browser.
   It reads RSS / Atom feeds (and optionally single pages) listed in crawl-feeds.json and writes crawl-news.json,
   which MIFASA loads like any other article file. No API key, no npm install (Node 18+ only).

   Usage:
     node crawl.js              crawl all enabled sources, merge into crawl-news.json
     node crawl.js --mode=fast  only RSS/Atom/page sources (run every few minutes)
     node crawl.js --mode=slow  only type:"site" sources, sites WITHOUT RSS (run about once an hour)
     node crawl.js --test       only check which feeds answer (no file written)
     node crawl.js --selftest   test the parser on built-in samples (works offline)
     node crawl.js --dry        crawl but print instead of writing

   Then upload crawl-news.json to neocities (next to script.js). */
const fs = require("fs"), path = require("path");

const DIR = __dirname;
const FEEDS_FILE = path.join(DIR, "crawl-feeds.json");
const OUT_FILE = path.join(DIR, "crawl-news.json");
const WORDS_FILE = path.join(DIR, "crawl-words.json");
const ARCHIVE_DIR = path.join(DIR, "news-archive");          // PERMANENT archive: one file per DAY (news-archive/YYYY-MM-DD.json) + index.json, never pruned (crawl-news.json keeps only the last 60 days)
const UA = "MifasaCrawler/1.0 (+https://mifasarw.neocities.org; polite, free, reads public RSS only)";
const CFG = { timeoutMs: 15000, delayMs: 1500, perFeed: 25, keepDays: 60, maxItems: 800, summaryChars: 400 };

/* ---------- small helpers ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"');
}
function clean(html, max) {
  let t = decode(String(html || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));   // CDATA first, so the HTML inside it is stripped too
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
  t = decode(t).replace(/\s+/g, " ").trim();
  return max && t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}
function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}
function toIsoDate(s) {                               // full time (2026-11-05T07:42:00.000Z) so "newest first" is exact; never later than now
  const d = new Date(String(s || "").trim());
  if (isNaN(d)) return "";
  return (d.getTime() > Date.now() ? new Date() : d).toISOString();
}
function safeUrl(u, base) {
  if (!String(u || "").trim()) return "";
  try { const x = new URL(String(u || "").trim(), base); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; }
}
function monthOf(date) { const d = new Date(String(date || "")); return isNaN(d) ? new Date().toISOString().slice(0, 7) : d.toISOString().slice(0, 7); }
function dayOf(date) { const d = new Date(String(date || "")); return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10); }
function permanentId(a) { const k = String(a.link || a.url || a.title || ""); return "MN" + monthOf(a.date).replace("-", "") + "_" + hash(k) + hash("~" + k).slice(-4); }   // same story = same id, forever
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }


/* ---------- picture of the story (free, from the feed itself) ---------- */
const BAD_IMG = /pixel|tracker|tracking|1x1|spacer|blank\.|\/ads?\/|doubleclick|feedburner|gravatar|emoji|smilies/i;
function pickImage(block, feedUrl) {
  const cands = [];
  const attr = (tagRe, name) => { let m, re = new RegExp(tagRe, "gi"); while ((m = re.exec(block))) { const a = m[0].match(new RegExp(name + "=[\"']([^\"']+)[\"']", "i")); if (a) cands.push({ u: decode(a[1]), t: m[0] }); } };
  attr("<media:content[^>]*>", "url");
  attr("<media:thumbnail[^>]*>", "url");
  attr("<enclosure[^>]*>", "url");
  attr("<link[^>]*rel=[\"']enclosure[\"'][^>]*>", "href");
  const ok = c => /image|\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(c.t + " " + c.u) && !/video|audio/i.test(c.t.replace(/image/gi, ""));
  let best = cands.filter(ok)[0];
  let url = best ? best.u : "";
  if (!url) {                                   // first <img> inside the story text (may be escaped as &lt;img)
    const body = decode(tag(block, "content:encoded") || tag(block, "description") || tag(block, "content") || tag(block, "summary"));
    const re = /<img[^>]+src=["']([^"']+)["']/gi; let m;
    while ((m = re.exec(body))) { if (!BAD_IMG.test(m[1])) { url = decode(m[1]); break; } }
  }
  url = safeUrl(url, feedUrl);
  if (!url || BAD_IMG.test(url)) return "";
  return url.replace(/^http:\/\//i, "https://");  // https page cannot show http pictures
}

/* ---------- RSS / Atom parser (no dependencies) ---------- */
function parseFeed(xml, feed) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const re = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const blocks = xml.match(re) || [];
  for (const b of blocks.slice(0, CFG.perFeed)) {
    const title = clean(tag(b, "title"), 200);
    let link = "";
    if (isAtom) {
      const m = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? decode(m[1]) : "";
    } else {
      link = clean(tag(b, "link")) || clean(tag(b, "guid"));
    }
    link = safeUrl(link, feed.url);
    const desc = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content") || tag(b, "media:description");
    const date = toIsoDate(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const cats = (b.match(/<category[^>]*>([\s\S]*?)<\/category>/gi) || []).map(c => clean(c, 40)).filter(Boolean).slice(0, 6);
    if (!title || !link) continue;
    const vid = ((b.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/i) || [])[1]) || ((/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch/i.test(link) && (link.match(/[?&]v=([\w-]{11})/) || [])[1]) || "");
    items.push({ title, link, summary: clean(desc, CFG.summaryChars) || title, date, cats, image: pickImage(b, feed.url), video: vid });
  }
  return items;
}

/* YouTube channel without any API key: the channel's public Atom feed.  Feed entry:  { "name":"MIFASARW YouTube", "type":"youtube", "handle":"@mifasarw", "category":"video", "lang":"rw" }
   (or "channel_id":"UC..." which is safest).  The handle is turned into the channel id by reading the channel page. */
async function youtubeFeedUrl(f) {
  if (f.url) return f.url;
  let id = String(f.channel_id || "").trim();
  if (!/^UC[\w-]{22}$/.test(id)) {
    const h = String(f.handle || "").trim().replace(/^@?/, "@");
    if (h.length < 3) throw new Error("youtube source needs channel_id or handle");
    const html = await fetchText("https://www.youtube.com/" + h);
    const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
    if (!m) throw new Error("could not find the channel id for " + h + " (put \"channel_id\" in crawl-feeds.json)");
    id = m[1];
  }
  return "https://www.youtube.com/feeds/videos.xml?channel_id=" + id;
}

/* ---------- pages: for sites WITHOUT an RSS feed ---------- */
function metaOf(html, n) {
  const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']*)["\']', "i")) ||
            html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + n + '["\']', "i"));
  return m ? m[1] : "";
}
function parsePage(html, feed) {                       // type "page": one page = one story (title + description + picture)
  const title = clean(metaOf(html, "og:title") || tag(html, "title"), 200);
  const summary = clean(metaOf(html, "og:description") || metaOf(html, "description"), CFG.summaryChars);
  const date = toIsoDate(metaOf(html, "article:published_time")) || new Date().toISOString();
  const image = safeUrl(metaOf(html, "og:image"), feed.url).replace(/^http:\/\//i, "https://");
  return title ? [{ title, link: feed.url, summary: summary || title, date, cats: [], image }] : [];
}

/* type "site": read a front/section page, find the story links, read each story page (only what search engines read: title, description, picture, time) */
const BAD_PATH = /\/(category|categories|tag|tags|author|authors|page|wp-|feed|search|login|register|contact|about|privacy|terms|advertis|subscribe|cdn-cgi|amp)\b|\.(jpe?g|png|gif|webp|svg|pdf|zip|mp3|mp4|css|js|xml)(\?|$)/i;
function extractLinks(html, baseUrl, feed) {
  let base; try { base = new URL(baseUrl); } catch (e) { return []; }
  const include = feed && feed.include ? new RegExp(feed.include, "i") : null;
  const seen = new Set(), out = [];
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi; let m;
  while ((m = re.exec(html))) {
    const u = safeUrl(decode(m[1]), base.href); if (!u) continue;
    let x; try { x = new URL(u); } catch (e) { continue; }
    if (x.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;       // same site only
    x.hash = ""; const href = x.href.replace(/\/$/, "");
    if (href === base.href.replace(/\/$/, "") || seen.has(href) || BAD_PATH.test(x.pathname + x.search)) continue;
    const ok = include ? include.test(x.pathname) : /[a-z0-9]+(?:-[a-z0-9]+){2,}/i.test(x.pathname);   // default: a "slug-with-several-words" path
    if (!ok) continue;
    seen.add(href); out.push(x.href);
  }
  return out;
}
function parseArticle(html, url, feed) {               // accepts only real stories (og:type=article or a publish time)
  const type = metaOf(html, "og:type"), pub = metaOf(html, "article:published_time") || metaOf(html, "og:updated_time");
  if (!/article/i.test(type) && !pub) return null;
  const title = clean(metaOf(html, "og:title") || tag(html, "title"), 200);
  const summary = clean(metaOf(html, "og:description") || metaOf(html, "description"), CFG.summaryChars);
  if (!title || title.length < 12) return null;
  const canon = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1];
  return { title, link: safeUrl(canon, url) || url, summary: summary || title, date: toIsoDate(pub) || new Date().toISOString(), cats: [], image: safeUrl(metaOf(html, "og:image"), url).replace(/^http:\/\//i, "https://") };
}
async function crawlSite(feed, known) {
  const html = await fetchText(feed.url);
  const links = extractLinks(html, feed.url, feed).filter(u => !known.has(u)).slice(0, feed.max || 10);      // stories we already have are not fetched again
  const items = [];
  for (const u of links) {
    try {
      if (!(await allowedByRobots(u))) continue;
      await sleep(1000);
      const it = parseArticle(await fetchText(u), u, feed);
      if (it) items.push(it);
    } catch (e) { /* one bad story never stops the site */ }
  }
  return { items, found: links.length };
}

/* ---------- robots.txt (simple, polite) ---------- */
const robotsCache = new Map();
async function allowedByRobots(url) {
  try {
    const u = new URL(url);
    if (!robotsCache.has(u.origin)) {
      let rules = [];
      try {
        const r = await fetchText(u.origin + "/robots.txt", 8000);
        let applies = false;
        for (const line of r.split(/\r?\n/)) {
          const m = line.match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i); if (!m) continue;
          const k = m[1].toLowerCase(), v = m[2];
          if (k === "user-agent") applies = v === "*" || /mifasa/i.test(v);
          else if (applies && k === "disallow" && v) rules.push(v);
        }
      } catch (e) { rules = []; }
      robotsCache.set(u.origin, rules);
    }
    return !robotsCache.get(u.origin).some(p => u.pathname.startsWith(p));
  } catch (e) { return true; }
}

async function fetchText(url, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms || CFG.timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}


/* ---------- vocabulary: words seen in the Kinyarwanda stories (the AI uses it to learn and to tell words apart) ---------- */
const STOP = new Set(("abantu aba abo aho ari ariko ayo bari bose bwa bya cya cyangwa cyane gusa iby ibi ibyo iki icyo iyi iyo kandi kuko kuva kuri mbere muri nyuma nyamara nka none ntabwo nubwo rwa rya uko uku uyu uyu ubwo yari yavuze yavuzeko yose zose zari ngo ngira kugira kuba bari bavuga abandi abandi ubu ubwo icyakora byose bizakora byari akaba bikaba bamwe benshi mu na ku ya wa ba za bo yo ko no ni se maze hanyuma ahubwo kandi n'abo n'ibi").split(/\s+/));
function tokens(text) {
  return String(text || "").toLowerCase().normalize("NFC").split(/[^a-zà-ÿ]+/).filter(w => w.length >= 4 && !STOP.has(w));
}
function buildWords(items, max) {
  const rw = items.filter(a => a && a.lang === "rw");
  const df = new Map(), docs = [];
  rw.forEach(a => {
    const set = [...new Set(tokens((a.title || "") + " " + (a.summary || "")))];
    docs.push({ a, set });
    set.forEach(w => df.set(w, (df.get(w) || 0) + 1));
  });
  const kept = [...df.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, max || 400);
  const keep = new Set(kept.map(k => k[0]));
  const out = kept.map(([w, n]) => {
    const co = new Map(), ex = [];
    docs.forEach(d => {
      if (!d.set.includes(w)) return;
      d.set.forEach(o => { if (o !== w && df.get(o) >= 2) co.set(o, (co.get(o) || 0) + 1); });
      if (ex.length < 2) ex.push({ t: String(d.a.title).slice(0, 140), s: d.a.source || "", u: d.a.link });
    });
    const ctx = [...co.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 6).map(e => e[0]);
    return { w, n, ctx, ex };
  });
  return { generated: new Date().toISOString().slice(0, 10), stories: rw.length, words: out };
}

/* ---------- crawl ---------- */
function toArticle(it, feed) {
  const kw = [...new Set([feed.name, feed.category, ...(feed.keywords || []), ...it.cats].filter(Boolean))].slice(0, 12);
  const a = {
    id: "crawl_" + hash(it.link),
    title: it.title,
    summary: it.summary,
    link: it.link,
    url: it.link,
    date: it.date || new Date().toISOString(),
    source: feed.name,
    category: feed.category || "news",
    lang: feed.lang || "en",
    keywords: kw
  };
  if (it.video) { a.video = { provider: "youtube", id: it.video }; a.type = "video"; a.keywords = [...new Set([...a.keywords, "video"])].slice(0, 12); it.image = it.image || ("https://i.ytimg.com/vi/" + it.video + "/hqdefault.jpg"); }
  if (it.image) { a.image = it.image; a.thumbnail = it.image; }
  if (feed.lang === "rw") { a.title_rw = it.title; a.summary_rw = it.summary; } else { a.title_en = it.title; a.summary_en = it.summary; }
  return a;
}

function merge(oldItems, fresh) {
  const map = new Map();
  [...oldItems, ...fresh].forEach(a => {
    if (!a || !a.link) return;
    const before = map.get(a.link);
    map.set(a.link, { ...(before || {}), ...a, ...(before && before.date ? { date: before.date } : {}), ...(before && before.share_id ? { share_id: before.share_id } : {}) });   // first-seen date and first id stay
  });
  const cutoff = Date.now() - CFG.keepDays * 864e5;
  return [...map.values()]
    .filter(a => !a.date || new Date(a.date).getTime() >= cutoff)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, CFG.maxItems);
}

/* ---------- permanent ids + monthly archive ---------- */
function ensureIds(items) { items.forEach(a => { if (!a.share_id) a.share_id = permanentId(a); }); return items; }

function archiveItems(items) {
  /* Adds every story to news-archive/YYYY-MM-DD.json (by its date). Append-only: a stored story is never removed or re-numbered; only missing fields are filled.
     Returns the list of archive files that changed (so the workflow uploads only those). */
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const byDay = new Map();
  items.forEach(a => { if (!a || !a.link) return; const m = dayOf(a.date); if (!byDay.has(m)) byDay.set(m, []); byDay.get(m).push(a); });
  const changed = [];
  for (const [m, list] of byDay) {
    const file = path.join(ARCHIVE_DIR, m + ".json");
    let doc = { day: m, count: 0, articles: [] };
    try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j && Array.isArray(j.articles)) doc = j; } catch (e) {}
    const have = new Map(doc.articles.map(a => [a.link, a]));
    let dirty = false;
    for (const a of list) {
      const old = have.get(a.link);
      if (!old) { const copy = { ...a }; doc.articles.push(copy); have.set(a.link, copy); dirty = true; }
      else for (const k of Object.keys(a)) if (old[k] === undefined || old[k] === "") { old[k] = a[k]; dirty = true; }       // fill gaps only; ids and dates never change
    }
    if (!dirty) continue;
    doc.articles.sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
    doc.count = doc.articles.length; doc.updated = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(doc, null, 1) + "\n");
    changed.push("news-archive/" + m + ".json");
  }
  /* index of all days (small file the site can read first) */
  const months = fs.readdirSync(ARCHIVE_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().map(f => {
    let n = 0; try { n = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), "utf8")).count || 0; } catch (e) {}
    return { day: f.slice(0, 10), file: "news-archive/" + f, count: n };
  });
  const idx = { updated: new Date().toISOString(), total: months.reduce((s, x) => s + x.count, 0), days: months };
  const idxFile = path.join(ARCHIVE_DIR, "index.json");
  let prev = ""; try { prev = fs.readFileSync(idxFile, "utf8"); } catch (e) {}
  const prevCmp = prev ? JSON.stringify({ ...JSON.parse(prev), updated: 0 }) : "";
  if (prevCmp !== JSON.stringify({ ...idx, updated: 0 })) { fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1) + "\n"); changed.push("news-archive/index.json"); }
  return changed;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  if (!fs.existsSync(FEEDS_FILE)) { console.error("crawl-feeds.json not found"); process.exit(1); }
  const mode = (args.find(a => a.startsWith("--mode=")) || "--mode=all").slice(7);     // fast = RSS/Atom/page (every few minutes), slow = sites without RSS (hourly), all = both
  const feeds = JSON.parse(fs.readFileSync(FEEDS_FILE, "utf8")).feeds.filter(f => f.enabled !== false)
    .filter(f => mode === "all" || (mode === "slow") === (f.type === "site"));
  const testOnly = args.includes("--test"), dry = args.includes("--dry");
  let old = [];
  try { const j = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")); old = Array.isArray(j) ? j : (j.articles || j.items || []); } catch (e) {}
  const known = new Set(old.map(a => a.link));
  const fresh = []; let ok = 0, bad = 0;
  console.log(`mode: ${mode}, ${feeds.length} sources`);
  for (const f0 of feeds) {
    let f = f0;
    try {
      if (f0.type === "youtube") f = { ...f0, url: await youtubeFeedUrl(f0) };            // official public feed of a channel: no robots check needed
      else if (!(await allowedByRobots(f.url))) { console.log("SKIP (robots.txt)  " + f.name); continue; }
      let items;
      if (f.type === "site") {
        const r = await crawlSite(f, known); items = r.items;
        if (!items.length && !r.found) throw new Error("no story links found: set \"include\" (a regex for story paths) for this site");
        console.log("OK    " + String(items.length).padStart(3) + " new stories  " + f.name + "  (" + r.found + " new links seen)");
        items.forEach(it => fresh.push(toArticle(it, f))); ok++;
      } else {
        const body = await fetchText(f.url);
        items = f.type === "page" ? parsePage(body, f) : parseFeed(body, f);   // "rss", "atom" and "youtube" all use parseFeed
        if (!items.length) throw new Error("no items found (is this really an RSS/Atom feed?)");
        console.log("OK    " + String(items.length).padStart(3) + " items  " + f.name);
        items.forEach(it => fresh.push(toArticle(it, f))); ok++;
      }
    } catch (e) { console.log("FAIL  " + f.name + "  -> " + (e.name === "AbortError" ? "timeout" : e.message)); bad++; }
    await sleep(CFG.delayMs);
  }
  console.log(`\n${ok} feeds ok, ${bad} failed, ${fresh.length} fresh items`);
  if (testOnly) return;
  if (!fresh.length) { console.log("Nothing fresh: crawl-news.json left unchanged."); return; }   // never wipe the file when offline
  const all = ensureIds(merge(old, fresh));
  if (dry) { console.log(JSON.stringify(all.slice(0, 3), null, 1)); return; }
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 1) + "\n");
  const arch = archiveItems(all);
  console.log(`archive: ${arch.length} file(s) changed` + (arch.length ? " -> " + arch.join(", ") : ""));
  const w = buildWords(all, 400);
  fs.writeFileSync(WORDS_FILE, JSON.stringify(w) + "\n");
  const dayCount = {}; all.forEach(a => { const d = String(a.date || "").slice(0, 10); dayCount[d] = (dayCount[d] || 0) + 1; });
  const days = Object.keys(dayCount).sort().reverse().slice(0, 3).map(d => d + ": " + dayCount[d]).join("   ");
  console.log(`NEWEST story: ${all[0] ? all[0].date : "none"}   |   stories per day -> ${days}`);
  console.log(`crawl-news.json written: ${all.length} items. crawl-words.json written: ${w.words.length} words from ${w.stories} Kinyarwanda stories. Upload both to neocities.`);
}

function selftest() {
  const rss = `<?xml version="1.0"?><rss><channel><title>T</title>
   <item><title><![CDATA[Amatora &amp; byinshi]]></title><link>https://ex.rw/a?x=1&amp;y=2</link><pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate>
   <description><![CDATA[<p>Inkuru <b>ngufi</b> &nbsp;cyane.</p><script>x()</script>]]></description><category>Politiki</category></item>
   <item><title>Nta link</title></item></channel></rss>`;
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom one</title><link rel="alternate" href="https://ex.rw/b"/><updated>2026-11-01T10:00:00Z</updated><summary>Sum &lt;i&gt;x&lt;/i&gt;</summary></entry></feed>`;
  const a = parseFeed(rss, { url: "https://ex.rw/feed" }), b = parseFeed(atom, { url: "https://ex.rw/feed" });
  const art = toArticle(a[0], { name: "Ex", category: "politics", lang: "rw" });
  const checks = [
    ["rss: 1 valid item (item without link dropped)", a.length === 1],
    ["rss: CDATA + entities decoded", a[0].title === "Amatora & byinshi"],
    ["rss: url entities decoded", a[0].link === "https://ex.rw/a?x=1&y=2"],
    ["rss: html + script stripped", a[0].summary === "Inkuru ngufi cyane."],
    ["rss: full ISO time", a[0].date === "2026-11-02T08:00:00.000Z"],
    ["atom: alternate link + date", b[0].link === "https://ex.rw/b" && b[0].date === "2026-11-01T10:00:00.000Z"],
    ["atom: escaped html stripped", b[0].summary === "Sum x"],
    ["article: rw fields + id", art.title_rw === "Amatora & byinshi" && art.id.startsWith("crawl_")],
    ["merge: dedupe by link, newest first", merge([{ link: "x", date: "2026-11-01", title: "old" }], [{ link: "x", date: "2026-11-02", title: "new" }, { link: "y", date: "2026-11-03" }]).map(z => z.link).join() === "y,x"],
    ["image: media:content", parseFeed('<rss><channel><item><title>T</title><link>https://ex.rw/1</link><media:content url="http://cdn.ex.rw/p.jpg?w=600&amp;h=1" medium="image"/></item></channel></rss>', { url: "https://ex.rw/f" })[0].image === "https://cdn.ex.rw/p.jpg?w=600&h=1"],
    ["image: enclosure", parseFeed('<rss><channel><item><title>T</title><link>https://ex.rw/2</link><enclosure url="https://cdn.ex.rw/e.png" type="image/png" length="1"/></item></channel></rss>', { url: "https://ex.rw/f" })[0].image === "https://cdn.ex.rw/e.png"],
    ["image: first <img> in escaped description (tracking pixel skipped)", parseFeed('<rss><channel><item><title>T</title><link>https://ex.rw/3</link><description>&lt;img src="https://x.rw/pixel.gif"&gt;&lt;img src="/uploads/a.jpg"&gt; text</description></item></channel></rss>', { url: "https://ex.rw/f" })[0].image === "https://ex.rw/uploads/a.jpg"],
    ["image: audio enclosure ignored", parseFeed('<rss><channel><item><title>T</title><link>https://ex.rw/4</link><enclosure url="https://cdn.ex.rw/a.mp3" type="audio/mpeg"/></item></channel></rss>', { url: "https://ex.rw/f" })[0].image === ""],
    ["atom: enclosure image link", parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://ex.rw/5"/><link rel="enclosure" type="image/jpeg" href="https://cdn.ex.rw/z.jpg"/></entry></feed>', { url: "https://ex.rw/f" })[0].image === "https://cdn.ex.rw/z.jpg"],
    ["article: image + thumbnail", toArticle({ title: "t", link: "https://ex.rw/6", summary: "s", date: "", cats: [], image: "https://i.rw/1.jpg" }, { name: "N" }).thumbnail === "https://i.rw/1.jpg"],
    ["words: df>=2, stopwords out, examples + context", (() => { const it = [1,2,3].map(i => ({ lang: "rw", title: "Perezida avuze ku bukungu " + i, summary: "ubukungu bw'igihugu burazamuka", source: "S", link: "https://ex.rw/" + i })); it.push({ lang: "en", title: "Economy economy economy", summary: "", link: "https://ex.rw/e" }); const r = buildWords(it, 50); const w = r.words.find(x => x.w === "ubukungu"); return !!w && w.n === 3 && w.ex.length === 2 && w.ctx.includes("perezida") && !r.words.some(x => x.w === "economy" || x.w === "ibyo"); })()],
    ["site: story links only (same host, slug paths, no tags/pages/files)", (() => { const l = extractLinks('<a href="/inkuru/perezida-yagiranye-inama-na-minisitiri">a</a><a href="https://www.x.rw/inkuru/rayon-yatsinze-apr-mu-mukino">b</a><a href="/category/politiki-n-ubutegetsi">c</a><a href="/tag/rayon-sports-fc">d</a><a href="https://other.com/a-b-c-d">e</a><a href="/img/foto-nziza-cyane.jpg">f</a><a href="/inkuru/perezida-yagiranye-inama-na-minisitiri#x">dup</a><a href="/about">g</a>', "https://x.rw/", {}); return l.length === 2 && l[0] === "https://x.rw/inkuru/perezida-yagiranye-inama-na-minisitiri" && l[1].includes("rayon-yatsinze"); })()],
    ["site: include regex overrides the default", extractLinks('<a href="/n/12345">a</a><a href="/x/abc-def-ghi">b</a>', "https://x.rw/", { include: "^/n/\\d+" }).join() === "https://x.rw/n/12345"],
    ["site: story page accepted (og:type article) with picture + time", (() => { const it = parseArticle('<head><meta property="og:type" content="article"><meta property="og:title" content="Rayon yatsinze APR mu mukino"><meta property="og:description" content="Incamake y\'umukino"><meta property="og:image" content="http://x.rw/p.jpg"><meta property="article:published_time" content="2026-11-05T08:00:00+02:00"><link rel="canonical" href="https://x.rw/inkuru/rayon"></head>', "https://x.rw/inkuru/rayon?utm=1", {}); return it && it.link === "https://x.rw/inkuru/rayon" && it.image === "https://x.rw/p.jpg".replace("http:", "https:") && it.date === "2026-11-05T06:00:00.000Z" && it.summary.startsWith("Incamake"); })()],
    ["site: non-story page (no og:type article, no time) refused", parseArticle('<head><title>Home page of the site</title><meta property="og:title" content="Home page of the site"></head>', "https://x.rw/", {}) === null],
    ["future dates are clamped to now", toIsoDate("2999-01-01T00:00:00Z") <= new Date().toISOString()],
    ["merge keeps the first-seen date of a known story", merge([{ link: "x", date: "2026-11-01T01:00:00.000Z" }], [{ link: "x", date: "2026-11-04T09:00:00.000Z", title: "t" }])[0].date === "2026-11-01T01:00:00.000Z"],
    ["javascript: links refused", safeUrl("javascript:alert(1)") === ""]
  ];
  let bad = 0; checks.forEach(([n, ok]) => { console.log((ok ? "PASS  " : "FAIL  ") + n); if (!ok) bad++; });
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
