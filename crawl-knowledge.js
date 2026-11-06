#!/usr/bin/env node
/* MIFASA crawl-knowledge.js : builds crawl-knowledge.json = a small, trustworthy knowledge base for MIFASA AI.
   Source: Wikipedia (Kinyarwanda + English), through Wikipedia's own free API (licence CC BY-SA 4.0: every entry keeps its source + link).
   You only list ENGLISH page titles in crawl-topics.json; the Kinyarwanda page (if it exists) is found automatically.
   Runs on GitHub (no key, no npm). A topic is refreshed at most once every 30 days, so a run only fetches what is missing or old.

     node crawl-knowledge.js              fetch missing/old topics, write crawl-knowledge.json
     node crawl-knowledge.js --force      refresh everything
     node crawl-knowledge.js --selftest   offline parser test */
const fs = require("fs"), path = require("path");
const TOPICS = path.join(__dirname, "crawl-topics.json"), OUT = path.join(__dirname, "crawl-knowledge.json");
const UA = "MifasaKnowledge/1.0 (https://mifasarw.neocities.org; polite, reads Wikipedia API)";
const REFRESH_DAYS = 30, DELAY = 400, MAX_SUMMARY = 700;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

async function getJson(url) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const cut = t => { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > MAX_SUMMARY ? t.slice(0, MAX_SUMMARY).replace(/\s+\S*$/, "") + "…" : t; };

/* one Wikipedia page -> {title, summary, link, image} (or null when missing / only a disambiguation page) */
function parseSummary(j) {
  if (!j || j.type === "disambiguation" || !j.extract) return null;
  const link = j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : "";
  if (!/^https:\/\//.test(link)) return null;
  const image = j.thumbnail && /^https:\/\//.test(j.thumbnail.source || "") ? j.thumbnail.source : "";
  return { title: String(j.title || "").trim(), summary: cut(j.extract), link, image };
}
function buildEntry(topic, en, rw, prev) {
  const e = en || rw; if (!e) return null;
  const SRC = " · Wikipedia (CC BY-SA)";
  return {
    id: "kn_" + hash(topic.en || topic.rw),
    title: (en || rw).title, title_en: en ? en.title : undefined, title_rw: rw ? rw.title : undefined,
    summary: e.summary + SRC, summary_en: en ? en.summary + SRC : undefined, summary_rw: rw ? rw.summary + SRC : undefined,
    link: (rw || en).link, link_en: en ? en.link : undefined, link_rw: rw ? rw.link : undefined,
    image: (en && en.image) || (rw && rw.image) || "",
    source: "Wikipedia", category: topic.category || "knowledge",
    keywords: [...new Set([topic.en, topic.rw, en && en.title, rw && rw.title, ...(topic.keywords || [])].filter(Boolean))].slice(0, 12),
    lang: rw && en ? "rw+en" : rw ? "rw" : "en", license: "CC BY-SA 4.0", fetched: (prev && prev.fetched && !prev._stale) ? prev.fetched : new Date().toISOString().slice(0, 10)
  };
}
async function fetchTopic(t) {
  const enTitle = t.en;
  let en = null, rw = null, rwTitle = t.rw || "";
  if (enTitle) {
    en = parseSummary(await getJson("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(enTitle.replace(/ /g, "_")))); await sleep(DELAY);
    if (!rwTitle) {                                                   // find the Kinyarwanda page from the English one (langlinks)
      const l = await getJson("https://en.wikipedia.org/w/api.php?action=query&format=json&prop=langlinks&lllang=rw&redirects=1&titles=" + encodeURIComponent(enTitle));
      const pages = l && l.query && l.query.pages ? Object.values(l.query.pages) : [];
      rwTitle = pages[0] && pages[0].langlinks && pages[0].langlinks[0] ? (pages[0].langlinks[0]["*"] || pages[0].langlinks[0].title || "") : ""; await sleep(DELAY);
    }
  }
  if (rwTitle) { rw = parseSummary(await getJson("https://rw.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(rwTitle.replace(/ /g, "_")))); await sleep(DELAY); }
  return { en, rw };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  if (!fs.existsSync(TOPICS)) { console.error("crawl-topics.json not found"); process.exit(1); }
  const topics = JSON.parse(fs.readFileSync(TOPICS, "utf8")).topics.filter(t => t && (t.en || t.rw) && t.enabled !== false);
  let old = []; try { const j = JSON.parse(fs.readFileSync(OUT, "utf8")); old = Array.isArray(j) ? j : []; } catch (e) {}
  const byId = new Map(old.map(e => [e.id, e]));
  const force = args.includes("--force"), now = Date.now();
  let got = 0, skipped = 0, miss = 0, failed = 0;
  for (const t of topics) {
    const id = "kn_" + hash(t.en || t.rw), prev = byId.get(id);
    if (!force && prev && prev.fetched && now - Date.parse(prev.fetched) < REFRESH_DAYS * 864e5) { skipped++; continue; }
    try {
      const { en, rw } = await fetchTopic(t);
      const e = buildEntry(t, en, rw, prev);
      if (!e) { console.log("MISS  " + (t.en || t.rw) + "  (no page found; check the title)"); miss++; continue; }
      byId.set(id, e); got++;
      console.log("OK    " + (t.en || t.rw) + "  [" + e.lang + "]");
    } catch (e) { console.log("FAIL  " + (t.en || t.rw) + "  -> " + (e.name === "AbortError" ? "timeout" : e.message)); failed++; }
  }
  const valid = new Set(topics.map(t => "kn_" + hash(t.en || t.rw)));
  const out = [...byId.values()].filter(e => valid.has(e.id));      // a topic you delete from crawl-topics.json disappears
  console.log(`\n${got} fetched, ${skipped} still fresh, ${miss} not found, ${failed} failed -> ${out.length} entries`);
  if (!got && out.length === old.length) { console.log("Nothing new: crawl-knowledge.json left unchanged."); return; }
  if (!out.length) return;                                          // never write an empty file over a good one
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log("crawl-knowledge.json written. Upload it to neocities.");
}

function selftest() {
  const j = { type: "standard", title: "Rwanda", extract: "Rwanda is a landlocked country in East Africa. ".repeat(40), content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Rwanda" } }, thumbnail: { source: "https://upload.wikimedia.org/x.jpg" } };
  const en = parseSummary(j), rw = parseSummary({ type: "standard", title: "U Rwanda", extract: "U Rwanda ni igihugu.", content_urls: { desktop: { page: "https://rw.wikipedia.org/wiki/U_Rwanda" } } });
  const e = buildEntry({ en: "Rwanda", category: "geography", keywords: ["igihugu"] }, en, rw, null);
  const checks = [
    ["summary cut at ~700 chars with ellipsis", en.summary.length <= MAX_SUMMARY + 1 && en.summary.endsWith("…")],
    ["disambiguation / empty pages refused", parseSummary({ type: "disambiguation", extract: "x" }) === null && parseSummary(null) === null],
    ["non-https link refused", parseSummary({ extract: "x", content_urls: { desktop: { page: "javascript:alert(1)" } } }) === null],
    ["entry has both languages + attribution + licence", e.lang === "rw+en" && e.summary_rw.endsWith("Wikipedia (CC BY-SA)") && e.license === "CC BY-SA 4.0" && e.source === "Wikipedia"],
    ["Kinyarwanda link preferred, English kept", e.link === "https://rw.wikipedia.org/wiki/U_Rwanda" && e.link_en === "https://en.wikipedia.org/wiki/Rwanda"],
    ["English-only entry works", buildEntry({ en: "Rwanda" }, en, null, null).lang === "en"],
    ["no page at all -> null", buildEntry({ en: "Nothing" }, null, null, null) === null],
    ["keywords include titles + yours", e.keywords.includes("igihugu") && e.keywords.includes("U Rwanda")],
    ["stable id", e.id === buildEntry({ en: "Rwanda" }, en, null, null).id]
  ];
  let bad = 0; checks.forEach(([n, ok]) => { console.log((ok ? "PASS  " : "FAIL  ") + n); if (!ok) bad++; });
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
