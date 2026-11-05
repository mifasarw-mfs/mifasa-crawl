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
const WORDS_FILE = path.join(DIR, "crawl-words.json");
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
    const desc = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content");
    const date = toIsoDate(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const cats = (b.match(/<category[^>]*>([\s\S]*?)<\/category>/gi) || []).map(c => clean(c, 40)).filter(Boolean).slice(0, 6);
    if (!title || !link) continue;
    items.push({ title, link, summary: clean(desc, CFG.summaryChars) || title, date, cats, image: pickImage(b, feed.url) });
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
  const image = safeUrl(meta("og:image"), feed.url).replace(/^http:\/\//i, "https://");
  return title ? [{ title, link: feed.url, summary: summary || title, date, cats: [], image }] : [];
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
    date: it.date,
    source: feed.name,
    category: feed.category || "news",
    lang: feed.lang || "en",
    keywords: kw
  };
  if (it.image) { a.image = it.image; a.thumbnail = it.image; }
  if (feed.lang === "rw") { a.title_rw = it.title; a.summary_rw = it.summary; } else { a.title_en = it.title; a.summary_en = it.summary; }
  return a;
}

function merge(oldItems, fresh) {
  const map = new Map();
  [...oldItems, ...fresh].forEach(a => { if (a && a.link) map.set(a.link, { ...(map.get(a.link) || {}), ...a }); });
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
  const fresh = []; let ok = 0, bad = 0;
  for (const f of feeds) {
    try {
      if (!(await allowedByRobots(f.url))) { console.log("SKIP (robots.txt)  " + f.name); continue; }
      const body = await fetchText(f.url);
      const items = f.type === "page" ? parsePage(body, f) : parseFeed(body, f);
      if (!items.length) throw new Error("no items found (is this really an RSS/Atom feed?)");
      console.log("OK    " + String(items.length).padStart(3) + " items  " + f.name);
      items.forEach(it => fresh.push(toArticle(it, f))); ok++;
    } catch (e) { console.log("FAIL  " + f.name + "  -> " + (e.name === "AbortError" ? "timeout" : e.message)); bad++; }
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
  const w = buildWords(all, 400);
  fs.writeFileSync(WORDS_FILE, JSON.stringify(w) + "\n");
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
    ["rss: date ISO", a[0].date === "2026-11-02"],
    ["atom: alternate link + date", b[0].link === "https://ex.rw/b" && b[0].date === "2026-11-01"],
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
    ["javascript: links refused", safeUrl("javascript:alert(1)") === ""]
  ];
  let bad = 0; checks.forEach(([n, ok]) => { console.log((ok ? "PASS  " : "FAIL  ") + n); if (!ok) bad++; });
  process.exit(bad ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
