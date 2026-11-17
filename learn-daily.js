#!/usr/bin/env node
/* MIFASA learn-daily.js : the AI learns every day, online, with no laptop.  Node 18+, no npm install.
   Runs inside GitHub Actions (see .github/workflows/mifasa-auto.yml), or:  node learn-daily.js

   What it does on every run
     1. reads the news MIFASA already crawled (crawl-news.json + news-archive/*.json) and extracts NEW words
     2. files every word under words/a.json ... words/z.json  (count, first/last seen, one example, language)
     3. when there are not enough new words, it seeds Kinyarwanda words from Wiktionary's category list, a -> z
     4. looks each word up in Wiktionary (free, no key) and turns the definition into one checked answer:
          en word: What does "x" mean?      rw word: Ijambo x risobanura iki?   (answer in English = the strong knowledge)
        the answers go to learned/part-0001.json ... (500 per file) + learned/index.json  -> script.js loads them
     5. short Kinyarwanda->English meanings go to dictionary-auto.json (module "dictionary") so MIFASA understands more words
     6. daily/YYYY-MM-DD.json says what was learned that day.  Target: 150 answers a day  (about 1000 in a week)
   A definition becomes an answer ONLY if it passes the gate (real source URL, sensible length, not a "plural of" stub,
   no private data, no vulgar/offensive entries).  learned/banned.json (written by admin.html) removes anything you dislike for good.
   Flags: --selftest (offline test with a fake network)   --dry (print, write nothing)   --target=N   --lookups=N */
const fs = require("fs"), path = require("path");

const DIR = path.resolve(process.env.MIFASA_DIR || process.cwd());
const ARGS = process.argv.slice(2), FLAG = n => ARGS.some(a => a === "--" + n), VAL = (n, d) => { const a = ARGS.find(x => x.startsWith("--" + n + "=")); return a ? +a.split("=")[1] : d; };
const CFG = { dailyTarget: VAL("target", 150), lookupsPerRun: VAL("lookups", 45), delayMs: 350, timeoutMs: 15000, partSize: 500, perLetterMax: 6000, retryDays: 14, seedPage: 200 };
const UA = "MifasaLearner/1.0 (+https://mifasarw.neocities.org; polite, free, reads public dictionary pages)";
const WIKI = "https://en.wiktionary.org";

/* ---------- the SAME id + normalisation the browser uses (script.js: mifasaNorm, mifasaLearnId) ---------- */
function norm(str) {
  return String(str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/\+/g, " plus ")
    .replace(/[−–—]/g, " minus ").replace(/[×✕]/g, " times ").replace(/[÷]/g, " divided ").replace(/=/g, " equals ").replace(/%/g, " percent ")
    .replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
}
function learnId(lang, qn) { let h = 2166136261; const s = lang + "|" + qn; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return "L" + h.toString(36) + s.length.toString(36); }

/* ---------- small file helpers ---------- */
const P = (...x) => path.join(DIR, ...x);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
let DRY = FLAG("dry");
function writeJSON(f, o, pretty) { if (DRY) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, pretty ? 1 : 0) + "\n"); }
const today = () => new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- words ---------- */
const STOP_EN = new Set("the and for are was were with from this that have has not can will you your they them their there here what when where which who how why been being would could should about into than then also just more most some such only over very much many other these those its our out all any but his her she him had did does done off per via too own same both each few may might must shall".split(" "));
const STOP_RW = new Set("abantu aba abo aho ari ariko ayo bari bose bwa bya cya cyangwa cyane gusa iby ibi ibyo iki icyo iyi iyo kandi kuko kuva kuri mbere muri nyuma nyamara nka none ntabwo nubwo rwa rya uru uwo uyu wa ya yo zo mu na ni si ku ko ngo ngu nta".split(" "));
function letterOf(w) { const c = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")[0] || ""; return /[a-z]/.test(c) ? c : ""; }
function extractWords(text, lang) {            // -> Map(word -> example sentence); proper nouns (capital letter inside a sentence) are skipped
  const out = new Map(), t = String(text || "").replace(/\s+/g, " "), stop = lang === "rw" ? STOP_RW : STOP_EN;
  const re = /[\p{L}]+(?:-[\p{L}]+)*/gu; let m;
  while ((m = re.exec(t))) {
    const raw = m[0], w = raw.toLowerCase();
    if (w.length < 3 || w.length > 24 || stop.has(w) || !letterOf(w)) continue;
    const prev = t.slice(Math.max(0, m.index - 3), m.index).trimEnd(), startOfSentence = !prev || /[.!?:]$/.test(prev);
    if (/^\p{Lu}/u.test(raw) && !startOfSentence) continue;                       // Kigali, Rwanda, Kagame ...
    if (raw.length > 1 && raw === raw.toUpperCase()) continue;                    // RDF, NATO
    if (!out.has(w)) out.set(w, t.slice(Math.max(0, m.index - 40), m.index + 60).trim());
  }
  return out;
}
function newsItems() {
  const list = [], add = x => { if (Array.isArray(x)) x.forEach(a => a && list.push(a)); else if (x && Array.isArray(x.items)) x.items.forEach(a => a && list.push(a)); else if (x && Array.isArray(x.articles)) x.articles.forEach(a => a && list.push(a)); };
  add(readJSON(P("crawl-news.json"), []));
  try { const d = P("news-archive"), fl = fs.readdirSync(d).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-3); fl.forEach(f => add(readJSON(path.join(d, f), []))); } catch (e) {}
  return list;
}

/* ---------- Wiktionary (free, no key) ---------- */
let netFail = 0;
async function getJSON(url) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), CFG.timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (res.status === 404) { netFail = 0; return { notFound: true }; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    netFail = 0; return await res.json();
  } catch (e) { netFail++; return { error: String(e && e.message || e) }; } finally { clearTimeout(t); }
}
const stripHtml = h => String(h || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
async function lookup(word, lang) {            // -> { pos, defs:[...], url } | null | { error }
  const j = await getJSON(WIKI + "/api/rest_v1/page/definition/" + encodeURIComponent(word));
  if (j.error) return { error: j.error };
  if (j.notFound || typeof j !== "object") return null;
  const want = lang === "rw" ? "Kinyarwanda" : "English", defs = []; let pos = "";
  Object.values(j).forEach(arr => Array.isArray(arr) && arr.forEach(e => {
    if (!e || e.language !== want) return;
    pos = pos || stripHtml(e.partOfSpeech).toLowerCase();
    (e.definitions || []).forEach(d => { const t = stripHtml(d && d.definition); if (t) defs.push(t); });
  }));
  return defs.length ? { pos, defs, url: WIKI + "/wiki/" + encodeURIComponent(word) } : null;
}
async function seedRw(state, n) {               // next page of Kinyarwanda lemmas, alphabetical (a -> z), continuing where it stopped
  const u = WIKI + "/w/api.php?action=query&list=categorymembers&cmtitle=" + encodeURIComponent("Category:Kinyarwanda lemmas") + "&cmlimit=" + n + "&cmnamespace=0&format=json&origin=*" + (state.rwCursor ? "&cmcontinue=" + encodeURIComponent(state.rwCursor) : "");
  const j = await getJSON(u);
  if (j.error || j.notFound || !j.query) return [];
  state.rwCursor = (j.continue && j.continue.cmcontinue) || "";                  // empty = reached the end, start again later
  if (!state.rwCursor) state.rwRounds = (state.rwRounds || 0) + 1;
  return (j.query.categorymembers || []).map(x => String(x.title || "").toLowerCase()).filter(w => /^[\p{L}]{3,24}$/u.test(w));
}

/* ---------- the quality gate ---------- */
const PRIVATE_RE = /(password|passcode|\bpin\b|ijambo ry.ibanga|\b\d{6,}\b|@\w+\.\w+|\bcvv\b|card number)/i;
const BLOCK_RE = /\b(porn\w*|fuck\w*|shit\w*|cunt|whore|slur|vulgar|derogatory|offensive|pejorative|n[i1]gg\w*|rape\w*|masturbat\w*|sexual intercourse)\b/i;
const STUB_RE = /\b(?:plural|singular|inflection|alternative (?:form|spelling)|alternate (?:form|spelling)|misspelling|obsolete (?:form|spelling)|(?:past|present|passive|perfect|gerund|participle|simple past|third-person singular|comparative|superlative|diminutive|augmentative|nonstandard|dated|eye dialect|informal|archaic|rare|form)[a-z ,-]* of)\b/i;
function gate(word, info) {
  if (!info || !info.url || !/^https:\/\//.test(info.url)) return null;
  if (BLOCK_RE.test(word) || PRIVATE_RE.test(word)) return null;
  const seen = new Set();                         // the same sense is often listed twice ("fall": "to move to a lower position..." x2)
  const defs = info.defs.filter(d => d.length >= 6 && d.length <= 300 && !STUB_RE.test(d.slice(0, 80)) && !BLOCK_RE.test(d) && !PRIVATE_RE.test(d))
    .filter(d => { const k = d.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  if (!defs.length) return null;
  const text = defs.length === 1 ? defs[0] : defs.map((d, i) => (i + 1) + ". " + d).join(" ");
  return text.length <= 700 ? { pos: info.pos, defs, text, url: info.url } : null;
}
function buildItem(word, lang, g, now) {
  const en = lang === "en", q_raw = en ? 'What does "' + word + '" mean?' : "Ijambo " + word + " risobanura iki?";
  const q_norm = norm(q_raw), q_en = en ? q_norm : norm('what does "' + word + '" mean in kinyarwanda'), pos = g.pos ? " (" + g.pos + ")" : "";
  const answer = "**" + word + "**" + pos + (en ? "" : " is a Kinyarwanda word.") + (en ? ": " : " Meaning: ") + g.text + "\n\n_Source: Wiktionary (CC BY-SA 4.0)._";
  return { id: learnId(en ? "en" : "rw", q_norm), v: 1, lang: en ? "en" : "rw", word, q_raw, q_norm, q_en, key_en: q_en, understood: "definition of the word " + word, intent: "definition", answer, answer_lang: "en", answer_alt: {}, grounded: true, sources: [{ title: "Wiktionary: " + word, url: g.url }], added: now };
}
function shortGloss(g) {                        // short Kinyarwanda -> English meaning for dictionary-auto.json, or ""
  const d = g.defs[0].replace(/\([^)]*\)/g, "").split(/[;,]/)[0].replace(/^(?:to|a|an|the)\s+/i, "").trim().toLowerCase();
  return d && d.split(" ").length <= 3 && /^[a-z' -]+$/.test(d) && !/\bof\b/.test(d) ? d : "";
}

/* ---------- storage: words/, learned/, daily/ ---------- */
function loadWords() { const m = {}; for (const c of "abcdefghijklmnopqrstuvwxyz") m[c] = readJSON(P("words", c + ".json"), { letter: c, words: {} }); return m; }
function saveWords(m) {
  const idx = { updated: new Date().toISOString(), letters: {}, total: 0, defined: 0 };
  for (const c of Object.keys(m)) {
    const ws = m[c].words, keys = Object.keys(ws);
    if (keys.length > CFG.perLetterMax) keys.filter(k => !ws[k].def && ws[k].n <= 1).sort((a, b) => (ws[a].last || "").localeCompare(ws[b].last || "")).slice(0, keys.length - CFG.perLetterMax).forEach(k => delete ws[k]);
    m[c].updated = new Date().toISOString(); writeJSON(P("words", c + ".json"), m[c]);
    const n = Object.keys(ws).length, d = Object.values(ws).filter(x => x.def).length; idx.letters[c] = { words: n, defined: d }; idx.total += n; idx.defined += d;
  }
  writeJSON(P("words", "index.json"), idx, true); return idx;
}
function loadParts() { const idx = readJSON(P("learned", "index.json"), { parts: [] }), items = []; (idx.parts || []).forEach(p => { const d = readJSON(P("learned", p.file), { items: [] }); (d.items || []).forEach(x => items.push(x)); }); return items; }
function saveParts(items) {
  const parts = []; for (let i = 0, n = 1; i < items.length || n === 1; i += CFG.partSize, n++) {
    const file = "part-" + String(n).padStart(4, "0") + ".json", chunk = items.slice(i, i + CFG.partSize);
    writeJSON(P("learned", file), { version: 1, items: chunk }); parts.push({ file, count: chunk.length }); if (i + CFG.partSize >= items.length) break;
  }
  writeJSON(P("learned", "index.json"), { version: 1, updated: new Date().toISOString(), total: items.length, parts }, true); return parts;
}

/* ---------- main ---------- */
async function main() {
  const now = new Date().toISOString(), day = today(), state = readJSON(P("learn-state.json"), {});
  const banned = readJSON(P("learned", "banned.json"), { ids: [], words: [] }), banId = new Set(banned.ids || []), banW = new Set((banned.words || []).map(w => String(w).toLowerCase()));
  const daily = readJSON(P("daily", day + ".json"), { date: day, new_words: 0, new_answers: 0, answers: [], runs: 0 });
  const words = loadWords(); let items = loadParts().filter(x => x && x.id && !banId.has(x.id) && !banW.has(String(x.word || "").toLowerCase()));
  const have = new Set(items.map(x => x.id));

  /* 1+2. new words from the news */
  let fresh = 0; const seenA = new Set(state.seen || []);
  newsItems().forEach(a => {
    const key = String(a.url || a.link || a.id || a.title || ""); if (!key || seenA.has(key)) return;      // every article counts once, however many runs read it
    seenA.add(key);
    const lang = a.lang === "rw" ? "rw" : "en", text = [a.title, a.summary, a.title_rw, a.summary_rw, a.title_en, a.summary_en].filter(Boolean).join(". ");
    extractWords(text, lang).forEach((ex, w) => {
      if (banW.has(w)) return;
      const bucket = words[letterOf(w)].words, e = bucket[w];
      if (e) { e.n++; e.last = day; }
      else { bucket[w] = { n: 1, lang, first: day, last: day, ex, src: a.url || a.link || "" }; fresh++; }
    });
  });

  state.seen = [...seenA].slice(-4000);

  /* what is still to look up: seen in the news at least twice first (most useful), then the seeded rw words */
  const all = []; for (const c of Object.keys(words)) for (const [w, e] of Object.entries(words[c].words)) if (!e.def && !banW.has(w) && (!e.tried || (Date.parse(e.tried) || 0) < Date.now() - CFG.retryDays * 864e5)) all.push([w, e]);
  const rank = ([, e]) => (e.seed ? 0 : 1000) + e.n;
  let seeded = 0;
  if (all.filter(([, e]) => e.n >= 2 || e.seed).length < 120) {
    for (const w of await seedRw(state, CFG.seedPage)) { const b = words[letterOf(w)]; if (b && !b.words[w] && !banW.has(w)) { b.words[w] = { n: 0, lang: "rw", first: day, last: day, ex: "", src: WIKI, seed: true }; all.push([w, b.words[w]]); seeded++; } }
  }
  all.sort((a, b) => rank(b) - rank(a));

  /* 3+4. look up + gate + answer */
  const quota = Math.max(0, CFG.dailyTarget - daily.new_answers), todo = all.filter(([, e]) => e.n >= 2 || e.seed).slice(0, Math.min(CFG.lookupsPerRun, quota));
  const dict = readJSON(P("dictionary-auto.json"), { module: "dictionary", version: 1, entries: [] }), dictHave = new Set(dict.entries.map(x => x.rw));
  let made = 0, rejected = 0, errors = 0;
  for (const [w, e] of todo) {
    if (netFail >= 4) { console.log("  ! network keeps failing: stopping this run (nothing is lost, it continues next run)"); break; }
    let info = await lookup(w, e.lang); await sleep(CFG.delayMs);
    if (info && info.error) { errors++; continue; }
    if (!info && !e.seed) { const o = e.lang === "rw" ? "en" : "rw"; const i2 = await lookup(w, o); await sleep(CFG.delayMs); if (i2 && !i2.error) { info = i2; if (i2) e.lang = o; } }   // a Kinyarwanda word inside an English article, or the reverse
    e.tried = now;
    const g = gate(w, info); if (!g) { rejected++; continue; }
    const it = buildItem(w, e.lang, g, now);
    if (have.has(it.id)) { e.def = true; continue; }
    items.push(it); have.add(it.id); e.def = true; made++; daily.answers.push(it.id);
    if (e.lang === "rw" && !dictHave.has(w)) { const gl = shortGloss(g); if (gl) { dict.entries.push({ rw: w, en: [gl], auto: true }); dictHave.add(w); } }
  }
  daily.new_words += fresh + seeded; daily.new_answers += made; daily.runs++; daily.updated = now;

  /* 5. write everything */
  const idx = saveWords(words); saveParts(items);
  writeJSON(P("dictionary-auto.json"), dict); writeJSON(P("learn-state.json"), state, true); writeJSON(P("daily", day + ".json"), daily, true);
  const index = readJSON(P("daily", "index.json"), { days: [] }); if (!index.days.some(d => d.date === day)) index.days.push({ date: day }); index.days.forEach(d => { if (d.date === day) { d.new_words = daily.new_words; d.new_answers = daily.new_answers; } }); writeJSON(P("daily", "index.json"), index, true);
  console.log(`learn-daily: +${fresh} words from news, +${seeded} seeded, +${made} answers (rejected ${rejected}, errors ${errors}); today ${daily.new_answers}/${CFG.dailyTarget}; total answers ${items.length}; words ${idx.total}`);
  return { fresh, seeded, made, rejected, errors, total: items.length, daily };
}

module.exports = { norm, learnId, extractWords, gate, buildItem, shortGloss, main, _cfg: CFG };
if (require.main === module) {
  main().catch(e => { console.error("learn-daily error (not fatal):", e && e.message || e); process.exit(0); });          // never fail the whole workflow because a dictionary site is down
}
