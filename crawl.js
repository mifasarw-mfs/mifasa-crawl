#!/usr/bin/env node
/* MIFASA crawl.js : free news crawler. Runs on YOUR computer (or GitHub Actions), NOT in the browser.
   It reads RSS / Atom feeds (and optionally single pages) listed in crawl-feeds.json and writes crawl-news.json,
   which MIFASA loads like any other article file. No API key, no npm install (Node 18+ only).

   Usage:
     node crawl.js              crawl all enabled feeds, merge into crawl-news.json
     node crawl.js --test       only check which feeds answer (no file written)
     node crawl.js --selftest   test the parser on built-in samples (works offline)
     node crawl.js --dry        crawl but print instead of writing

   Then upload crawl-news.json to neocities (next to script.js). */
const fs = require("fs"), path = require("path");

const DIR = __dirname;
const FEEDS_FILE = path.join(DIR, "crawl-feeds.json");
const OUT_FILE = path.join(DIR, "crawl-news.json");
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
function toIsoDate(s) {
  const d = new Date(String(s || "").trim());
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}
function safeUrl(u, base) {
  if (!String(u || "").trim()) return "";
  try { const x = new URL(String(u || "").trim(), base); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; }
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

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
    const desc = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content");
    const date = toIsoDate(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const cats = (b.match(/<category[^>]*>([\s\S]*?)<\/category>/gi) || []).map(c => clean(c, 40)).filter(Boolean).slice(0, 6);
    if (!title || !link) continue;
    items.push({ title, link, summary: clean(desc, CFG.summaryChars) || title, date, cats });
  }
  return items;
}

/* ---------- single page (when a site has no RSS): title + description only ---------- */
function parsePage(html, feed) {
  const meta = n => { const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']*)["\']', "i")) ||
                                 html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + n + '["\']', "i")); return m ? m[1] : ""; };
  const title = clean(meta("og:title") || tag(html, "title"), 200);
  const summary = clean(meta("og:description") || meta("description"), CFG.summaryChars);
  const date = toIsoDate(meta("article:published_time")) || new Date().toISOString().slice(0, 10);
  return title ? [{ title, link: feed.url, summary: summary || title, date, cats: [] }] : [];
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

/* ---------- crawl ---------- */
function toArticle(it, feed) {
  const kw = [...new Set([feed.name, feed.category, ...(feed.keywords || []), ...it.cats].filter(Boolean))].slice(0, 12);
  const a = {
    id: "crawl_" + hash(it.link),
    title: it.title,
    summary: it.summary,
    link: it.link,
    url: it.link,
    date: it.date || new Date().toISOString().slice(0, 10),   // no date in the feed -> first day we saw it
    source: feed.name,
    category: feed.category || "news",
    lang: feed.lang || "en",
    keywords: kw
  };
  if (feed.lang === "rw") { a.title_rw = it.title; a.summary_rw = it.summary; } else { a.title_en = it.title; a.summary_en = it.summary; }
  return a;
}

function merge(oldItems, fresh) {
  const map = new Map();
  [...oldItems, ...fresh].forEach(a => { if (a && a.link) { const o = map.get(a.link) || {}; map.set(a.link, { ...o, ...a, date: o.date || a.date || "" }); } });   // first-seen date wins
  const cutoff = Date.now() - CFG.keepDays * 864e5;
  return [...map.values()]
    .filter(a => !a.date || new Date(a.date).getTime() >= cutoff)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, CFG.maxItems);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  if (!fs.existsSync(FEEDS_FILE)) { console.error("crawl-feeds.json not found"); process.exit(1); }
  const feeds = JSON.parse(fs.readFileSync(FEEDS_FILE, "utf8")).feeds.filter(f => f.enabled !== false);
  const testOnly = args.includes("--test"), dry = args.includes("--dry");
  const fresh = []; let ok = 0, bad = 0; const status = [];
  for (const f of feeds) {
    try {
      if (!(await allowedByRobots(f.url))) { console.log("SKIP (robots.txt)  " + f.name); continue; }
      const body = await fetchText(f.url);
      const items = f.type === "page" ? parsePage(body, f) : parseFeed(body, f);
      if (!items.length) throw new Error("no items found (is this really an RSS/Atom feed?)");
      console.log("OK    " + String(items.length).padStart(3) + " items  " + f.name);
      items.forEach(it => fresh.push(toArticle(it, f))); ok++; status.push({ name: f.name, ok: true, items: items.length });
    } catch (e) { const why = e.name === "AbortError" ? "timeout" : e.message; console.log("FAIL  " + f.name + "  -> " + why); bad++; status.push({ name: f.name, ok: false, error: why }); }
    await sleep(CFG.delayMs);
  }
  console.log(`\n${ok} feeds ok, ${bad} failed, ${fresh.length} fresh items`);
  if (testOnly) return;
  let old = [];
  try { const j = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")); old = Array.isArray(j) ? j : (j.articles || j.items || []); } catch (e) {}
  if (!fresh.length) { console.log("Nothing fresh: crawl-news.json left unchanged."); return; }   // never wipe the file when offline
  const all = merge(old, fresh);
  if (dry) { console.log(JSON.stringify(all.slice(0, 3), null, 1)); return; }
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 1) + "\n");
  fs.writeFileSync(path.join(DIR, "crawl-words.json"), JSON.stringify(buildWords(all)) + "\n");
  fs.writeFileSync(path.join(DIR, "crawl-status.json"), JSON.stringify({ updated: new Date().toISOString(), ok, failed: bad, fresh: fresh.length, total: all.length, feeds: status }, null, 1) + "\n");
  console.log(`crawl-news.json written: ${all.length} items. Upload it to neocities.`);
}

/* ---------- crawl-words.json: frequent words of Kinyarwanda headlines (script.js reads {generated, stories, words:[{w,n,ex,ctx}]}) ---------- */
const STOP = new Set("ariko kandi nawe nabo nayo ubwo ubundi uyu uyu buri muri mbere nyuma hagati kugira kuba bari baba abo iyo icyo iki iyi izi aba aya ayo ntabwo nta ibyo byose yose zose rwose cyane ngo kuko nuko none noneho umwaka umunsi mu ku ya wa rya cya bya za ba mba ibi iby uko kuri kugeza gusa niba hari hariho bwa bwo twe mwe bo we jye wowe".split(" "));
function buildWords(all) {
  const rw = all.filter(a => a.lang === "rw" && a.title);
  const map = new Map();
  rw.forEach((a, idx) => {
    const ws = [...new Set((a.title + " " + (a.summary || "")).toLowerCase().replace(/[’‘`]/g, "'").match(/[a-zà-ÿ']{4,25}/g) || [])].filter(w => !STOP.has(w));
    ws.forEach(w => {
      const e = map.get(w) || { w, n: 0, ex: [], co: new Map() };
      e.n++; if (e.ex.length < 3) e.ex.push({ t: a.title, u: a.link, s: a.source });
      ws.forEach(o => { if (o !== w) e.co.set(o, (e.co.get(o) || 0) + 1); });
      map.set(w, e);
    });
  });
  const words = [...map.values()].filter(e => e.n >= 3).sort((x, y) => y.n - x.n).slice(0, 300)
    .map(e => ({ w: e.w, n: e.n, ex: e.ex, ctx: [...e.co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]) }));
  return { generated: new Date().toISOString().slice(0, 10), stories: rw.length, words };
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
    ["rss: date ISO", a[0].date === "2026-11-02"],
    ["atom: alternate link + date", b[0].link === "https://ex.rw/b" && b[0].date === "2026-11-01"],
    ["atom: escaped html stripped", b[0].summary === "Sum x"],
    ["article: rw fields + id", art.title_rw === "Amatora & byinshi" && art.id.startsWith("crawl_")],
    ["merge: dedupe by link, newest first", merge([{ link: "x", date: "2026-11-01", title: "old" }], [{ link: "x", date: "2026-11-02", title: "new" }, { link: "y", date: "2026-11-03" }]).map(z => z.link).join() === "y,x"],
    ["merge: empty fresh date keeps old date", merge([{ link: "k", date: "2026-11-01" }], [{ link: "k", date: "" }])[0].date === "2026-11-01"],
    ["words: built from rw titles", buildWords([1,2,3].map(i => ({ lang: "rw", title: "Ubukungu bw'igihugu bwazamutse", link: "https://e/" + i, source: "T" }))).words.some(x => x.w === "ubukungu" && x.n === 3)],
    ["javascript: links refused", safeUrl("javascript:alert(1)") === ""]
  ];
  let bad = 0; checks.forEach(([n, ok]) => { console.log((ok ? "PASS  " : "FAIL  ") + n); if (!ok) bad++; });
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
