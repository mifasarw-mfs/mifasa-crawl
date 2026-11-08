#!/usr/bin/env node
/* MIFASA improve: LLM yongerera ubwenge bwa moteri (script.js) idahinduye kode yayo.
   Igitekerezo: ibibazo MIFASA AI itabashije gusubiza (byabajijwe LLM) bikunze kuba ari ibisanzwe bisobanuwe ukundi.
   LLM ireba niba ikibazo gihuye na intent wiyandikiye (ai.json...ai16.json); iyo gihuye, ikora "alias" (imvugo nshya) muri ai17.json
   ifite igisubizo cyawe (cya mbere). Ubutaha moteri ubwayo isubiza ikoresheje IGISUBIZO CYAWE, nta LLM.
   Buri alias igeragezwa:  (1) moteri isubiza ikibazo ikoresheje igisubizo cy'iyo intent,
                           (2) ibizamini byawe (mifasa_tests.json) ntibyiyongera mu bitsindwa. Iyo hari ikizamini gishya gitsindwa, nta kintu cyandikwa.
   Env: SITE_DIR (aho script.js n'ai*.json biri, default ./_site), WORKER_EXPORT_URL + EXPORT_TOKEN (cyangwa MISSES_FILE=json), GEMINI_API_KEY,
        MAX_NEW (default 12), IMPROVE_MOCK=1 (ikizamini nta LLM)  |  Usage: node improve.js [--dry]                                           */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const DIR = process.cwd(), SITE = path.resolve(process.env.SITE_DIR || "_site");
const OUT = path.join(DIR, "ai17.json"), TESTS = path.join(DIR, "mifasa_tests.json");
const DRY = process.argv.includes("--dry"), MOCK = process.env.IMPROVE_MOCK === "1";
const MAX_NEW = +process.env.MAX_NEW || 12, MAX_TOTAL = 400;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const SKIP_TARGET = /(suicid|kwiyahura|die|abuse|violence|rape|hiv|vih|pregnan|emergency|ambulance|114|112|912|poison|overdose|crisis|isange)/i;   // ubutabazi n'ubuzima bwite bikomeza uko wabikoze
const BAD = /\b(porn|sex|nude|kill|bomb)\b/i;

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N} ']/gu, " ").replace(/\s+/g, " ").trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash("sha1").update(norm(s)).digest("hex").slice(0, 8);
const first = a => Array.isArray(a) ? a[0] : a;
const clean = h => norm(String(h || "").replace(/<[^>]+>/g, " ").replace(/&#039;/g, "'").replace(/&amp;/g, "&"));

/* ---------- moteri nyayo ya script.js ---------- */
function loadEngine(modules) {
  let src = fs.readFileSync(path.join(SITE, "script.js"), "utf8");
  const k = src.lastIndexOf("})();");
  src = src.slice(0, k) + "\nwindow.__m={mifasaBrainLoad,mifasaAddDictionary};\n" + src.slice(k);
  const store = {};
  global.localStorage = { getItem: x => store[x] ?? null, setItem: (x, v) => { store[x] = String(v); }, removeItem: x => { delete store[x]; } };
  global.window = { MIFASA_API_ONLY: true, location: { search: "", href: "http://x/" } };
  global.document = { body: null, documentElement: {}, addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], createElement: () => ({}) };
  global.location = window.location; global.navigator = {}; global.fetch = () => Promise.reject(new Error("offline"));
  const L = console.log; console.log = () => {};
  try { (0, eval)(src); } catch (e) {}
  const m = window.__m, A = window.MifasaAI;
  for (const [name, d] of modules) m.mifasaBrainLoad(d, name);
  for (const f of ["dictionary.json", "grammar.json"]) { const p = path.join(SITE, f); if (fs.existsSync(p)) m.mifasaAddDictionary(JSON.parse(fs.readFileSync(p, "utf8"))); }
  console.log = L;
  return A;
}
function siteModules(extra) {
  const mods = [];
  for (const f of fs.readdirSync(SITE).filter(f => /^(ai\d*|ai_core)\.json$/.test(f) && f !== "ai17.json").sort((a, b) => (a === "ai.json" ? -1 : b === "ai.json" ? 1 : a.localeCompare(b, undefined, { numeric: true })))) {
    try { mods.push([f, JSON.parse(fs.readFileSync(path.join(SITE, f), "utf8"))]); } catch (e) {}
  }
  if (extra) mods.push(["ai17.json", extra]);
  return mods;
}
const patsOf = it => [...(it.patterns || []), ...(it.patterns_rw || []), ...(it.patterns_en || []), ...(it.questions || [])];
const isMiss = r => !!(r && r.html && (/(Ntabwo mbyizeye 100%|not 100% sure)/i.test(r.html) || (r._viaSearch && r._nEff > 1 && r._cov < 0.75)));

/* ---------- LLM ---------- */
async function gemini(system, user) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 500, responseMimeType: "application/json" } })
  });
  if (r.status === 429) throw new Error("rate");
  if (!r.ok) throw new Error("http " + r.status);
  const d = await r.json();
  return JSON.parse(((d.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("").replace(/```json|```/g, "").trim());
}
const SYS = "You map a user's question to an existing FAQ intent of a Kinyarwanda/English assistant. Candidates are given with id, label, sample questions and the start of their answer. " +
  "Choose a candidate ONLY if its answer fully and correctly answers the user's question (same meaning, not just same topic). Otherwise match=null. " +
  "Return ONLY JSON: {\"match\":\"<id or null>\",\"confidence\":0-1,\"paraphrases_en\":[up to 3 different ways to ask the same thing],\"paraphrases_rw\":[up to 2 in Kinyarwanda]}. Never invent ids.";

(async () => {
  if (!fs.existsSync(path.join(SITE, "script.js"))) { console.error("Missing " + SITE + "/script.js"); process.exit(2); }
  if (!MOCK && !process.env.GEMINI_API_KEY) { console.error("Missing GEMINI_API_KEY"); process.exit(2); }

  const brainFiles = siteModules(null);
  const byId = new Map(); const allPats = new Set();
  brainFiles.forEach(([f, d]) => (d.intents || []).forEach(it => { byId.set(it.id, it); patsOf(it).forEach(p => allPats.add(norm(p))); }));
  const cur = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { version: 2, module: "ai17", description: "Aliases learned by improve.js: new ways to ask existing questions (answers come from your own intents). Delete any entry with \"auto\": true if wrong.", intents: [] };
  cur.intents = cur.intents || [];
  cur.intents.forEach(it => patsOf(it).forEach(p => allPats.add(norm(p))));

  /* ibibazo MIFASA yananiwe (byabitswe na Worker) */
  let log = [];
  if (process.env.MISSES_FILE) log = JSON.parse(fs.readFileSync(process.env.MISSES_FILE, "utf8"));
  else if (process.env.WORKER_EXPORT_URL) {
    const res = await fetch(process.env.WORKER_EXPORT_URL, { headers: { Authorization: "Bearer " + process.env.EXPORT_TOKEN } });
    if (!res.ok) { console.error("export failed " + res.status); process.exit(2); }
    log = await res.json();
  } else { console.error("Need WORKER_EXPORT_URL or MISSES_FILE"); process.exit(2); }

  const A0 = loadEngine(siteModules(cur));
  const todo = [];
  for (const x of log) {
    const q = String(x.q || "").trim(); if (q.length < 6 || BAD.test(q) || allPats.has(norm(q))) continue;
    let r; try { r = A0.ask(q); } catch (e) { continue; }
    if (isMiss(r)) todo.push({ q, n: x.n || 1 });
  }
  todo.sort((a, b) => b.n - a.n);
  const batch = todo.slice(0, MAX_NEW);
  console.log(`${log.length} logged, ${todo.length} still missed, trying ${batch.length}`);
  if (!batch.length) { console.log("nothing to improve"); return; }

  /* ---------- LLM ihitamo intent ihuye ---------- */
  const cand = [];
  for (const x of batch) {
    try {
      const sc = (A0.__scoreAll ? A0.__scoreAll(x.q) : null);
      const ids = [...byId.keys()];
      const qt = new Set(norm(x.q).split(" ").filter(w => w.length > 3));
      const ranked = ids.map(id => { const it = byId.get(id); const t = new Set(norm([it.label_en, it.label_rw, ...patsOf(it).slice(0, 8)].join(" ")).split(" ")); let h = 0; qt.forEach(w => { if (t.has(w)) h++; }); return { id, h }; })
        .filter(c => c.h > 0 && !SKIP_TARGET.test(c.id)).sort((a, b) => b.h - a.h).slice(0, 8);
      if (!ranked.length) continue;
      const list = ranked.map(c => { const it = byId.get(c.id); return { id: c.id, label: it.label_en || it.label_rw || "", samples: patsOf(it).slice(0, 2), answer_start: String(first(it.answer_en) || first(it.answer) || first(it.answer_rw) || "").slice(0, 160) }; });
      const out = MOCK ? await require(path.join(DIR, "improve-mock.js"))(x.q, list)
                       : await gemini(SYS, "User question: " + x.q + "\nCandidates: " + JSON.stringify(list));
      if (out && out.match && out.confidence >= 0.85 && byId.has(out.match) && !SKIP_TARGET.test(out.match)) cand.push({ x, target: byId.get(out.match), out });
      else console.log("no match:", x.q);
    } catch (e) { console.log("stop:", e.message); if (e.message === "rate") break; }
    await sleep(MOCK ? 0 : 5000);
  }
  if (!cand.length) { console.log("no candidates"); return; }

  /* ---------- alias intents ---------- */
  const today = new Date().toISOString().slice(0, 10), aliases = [];
  for (const c of cand) {
    const en = [c.x.q, ...(c.out.paraphrases_en || [])].map(String), rw = (c.out.paraphrases_rw || []).map(String);
    const pe = [...new Set(en.map(s => s.trim()).filter(s => s.length > 5 && !allPats.has(norm(s)) && !BAD.test(s)))].slice(0, 4);
    const pr = [...new Set(rw.map(s => s.trim()).filter(s => s.length > 5 && !allPats.has(norm(s)) && !BAD.test(s)))].slice(0, 2);
    if (!pe.length) continue;
    const t = c.target, al = { id: "ai17_" + hash(c.x.q), alias_of: t.id, label_en: t.label_en, label_rw: t.label_rw, patterns_en: pe, patterns_rw: pr,
      priority: Math.max(1, (t.priority || 5) - 1), auto: true, learned: today, asked: c.x.n };
    for (const k of ["answer", "answer_en", "answer_rw", "follow_ups_en", "follow_ups_rw", "buttons"]) if (t[k] !== undefined) al[k] = t[k];
    aliases.push({ al, target: t, q: c.x.q });
  }
  console.log(`${aliases.length} alias candidates`);
  if (!aliases.length) return;

  /* ---------- 1. moteri ubwayo igerageza buri alias ---------- */
  const trial = { ...cur, intents: [...cur.intents, ...aliases.map(a => a.al)] };
  const A1 = loadEngine(siteModules(trial));
  const good = [];
  for (const a of aliases) {
    const variants = [a.target.answer, a.target.answer_en, a.target.answer_rw].flat().filter(Boolean).map(s => clean(s).slice(0, 28)).filter(s => s.length > 8);
    let pass = true;
    for (const p of [...a.al.patterns_en, ...a.al.patterns_rw]) {
      let t; try { t = clean(A1.ask(p).html); } catch (e) { t = ""; }
      if (!variants.some(v => t.includes(v))) { pass = false; console.log(`✗ "${p}" does not reach "${a.target.id}"`); break; }
    }
    if (pass) { good.push(a); console.log(`✓ ${a.q}  →  ${a.target.id}`); }
  }
  if (!good.length) { console.log("nothing verified"); return; }

  /* ---------- 2. ibizamini byawe: nta cyiyongera mu bitsindwa ---------- */
  const failing = A => {
    if (!fs.existsSync(TESTS)) return null;
    const bad = new Set();
    for (const [q, exp] of JSON.parse(fs.readFileSync(TESTS, "utf8"))) {
      let t; try { t = clean(A.ask(q).html); } catch (e) { t = "error"; }
      if (!exp.some(e => t.includes(norm(e)))) bad.add(q);
    }
    return bad;
  };
  const baseBad = failing(A0);
  const finalMods = { ...cur, intents: [...cur.intents, ...good.map(a => a.al)] };
  const A2 = loadEngine(siteModules(finalMods));
  const newBad = failing(A2);
  if (baseBad && newBad) {
    const worse = [...newBad].filter(q => !baseBad.has(q));
    console.log(`tests: before ${baseBad.size} failing, after ${newBad.size} failing`);
    if (worse.length) { console.log("✗ new failures, nothing written:", worse.slice(0, 5).join(" | ")); return; }
  } else console.log("(no mifasa_tests.json: skipped test guard)");

  finalMods.intents = finalMods.intents.slice(-MAX_TOTAL);
  if (!DRY) fs.writeFileSync(OUT, JSON.stringify(finalMods, null, 1) + "\n");
  console.log(`added ${good.length} alias(es)${DRY ? " (dry, nothing written)" : ""}; total ${finalMods.intents.length}`);
})().catch(e => { console.error(e); process.exit(1); });
