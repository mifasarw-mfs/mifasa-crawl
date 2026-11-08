#!/usr/bin/env node
/* MIFASA teach: LLM yigisha MIFASA AI ubumenyi bw'ibanze bushya, ikabwandika muri ai16.json (module yayo yihariye).
   - Ntigera ikora kuri ai.json cyangwa ai2..ai15 wanditse ubwawe: ni ai16.json gusa (ushobora kuyisiba igihe cyose).
   - Intambwe: (1) ireba ibyo MIFASA isanzwe izi mu cyiciro kimwe, (2) isaba LLM ibyingenzi bibura,
               (3) LLM yandika buri kimwe (Kinyarwanda + English), (4) LLM ya kabiri irakigenzura ("fact-check"),
               (5) hakomezwa ibyemejwe gusa, bidasa n'ibisanzwe, nta links, nta mibare ihinduka.
   Env: GEMINI_API_KEY (ikenewe), GEMINI_MODEL, MAX_TOPICS (default 6), TEACH_CATEGORY (guhitamo icyiciro), TEACH_MOCK=1 (ikizamini nta LLM)
   Usage: node teach.js [--dry]   (--dry: ntandika ai16.json)                                                                                  */
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const DIR = process.cwd(), OUT = path.join(DIR, "ai16.json"), SRC = path.resolve(process.env.SITE_DIR || DIR);   // SRC: aho ai*.json z'urubuga ziri
const DRY = process.argv.includes("--dry"), MOCK = process.env.TEACH_MOCK === "1";
const MAX_TOPICS = +process.env.MAX_TOPICS || 6, MAX_TOTAL = 600;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

const CATEGORIES = ["rwanda", "science", "health", "technology", "history", "business", "world", "education", "sports", "safety", "language", "math", "agriculture", "environment", "culture", "finance"];
const BAD = /\b(porn|sex|suicide|kwiyahura|kill|bomb|weapon|drug dosage|election|amatora|president|perezida|minister|minisitiri|price of|igiciro cya|population of|today|uyu munsi|this year|uyu mwaka|2025|2026|2027)\b/i;

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N} ']/gu, " ").replace(/\s+/g, " ").trim();
const toks = s => norm(s).split(" ").filter(w => w.length > 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = s => crypto.createHash("sha1").update(norm(s)).digest("hex").slice(0, 8);

/* ---------- 1. ibyo MIFASA isanzwe izi ---------- */
function loadCovered() {
  const titles = [], pats = new Set(), byCat = {};
  for (const f of fs.readdirSync(SRC)) {
    if (!/^(ai\d*|ai_core)\.json$/.test(f)) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8")); } catch (e) { continue; }
    for (const k of d.knowledge || []) {
      const t = k.title_en || k.title_rw || ""; if (!t) continue;
      titles.push(t); (byCat[k.category] = byCat[k.category] || []).push(t);
      (k.keywords || []).forEach(w => titles.push(w));
    }
    for (const it of d.intents || []) {
      const t = it.label_en || it.label_rw || ""; if (t) { titles.push(t); }
      [...(it.patterns || []), ...(it.patterns_rw || []), ...(it.patterns_en || []), ...(it.questions || [])].forEach(p => pats.add(norm(p)));
    }
  }
  return { titles, pats, byCat, titleSet: new Set(titles.map(norm)) };
}
function tooSimilar(title, cov) {
  const n = norm(title); if (!n) return true;
  if (cov.titleSet.has(n)) return true;
  const a = new Set(toks(title)); if (!a.size) return true;
  for (const t of cov.titles) { const b = toks(t); if (!b.length) continue; const hit = b.filter(w => a.has(w)).length; if (hit / Math.max(a.size, b.length) >= 0.75) return true; }
  return false;
}

/* ---------- 2. LLM ---------- */
async function gemini(system, user, temp) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: temp, maxOutputTokens: 900, responseMimeType: "application/json" } })
  });
  if (r.status === 429) throw new Error("rate");
  if (!r.ok) throw new Error("http " + r.status);
  const d = await r.json();
  const t = ((d.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("");
  return JSON.parse(t.replace(/```json|```/g, "").trim());
}
const mockLLM = require("fs").existsSync(path.join(DIR, "teach-mock.js")) ? require(path.join(DIR, "teach-mock.js")) : null;
const llm = (kind, system, user, temp) => MOCK ? mockLLM(kind, user) : gemini(system, user, temp);

const SYS_GAPS = "You help build a small Kinyarwanda/English knowledge base for Rwandan learners. Given a category and the titles already covered, list foundational, timeless topics NOT yet covered. " +
  "Only stable facts (no news, prices, populations, elections, living politicians, sports results). Return ONLY JSON: {\"topics\":[{\"title_en\":\"...\",\"title_rw\":\"...\"}]}.";
const SYS_WRITE = "Write one short, factual knowledge entry for a Rwandan assistant. Plain text, no links, no markdown. Each summary max 70 words, same meaning in Kinyarwanda and English. Kinyarwanda rules: keep proper names and technical terms (e.g. Indo-European, Niger-Congo, Greenwich, Pacific) in their original form unless you are sure of the standard Kinyarwanda word; never invent translations; use short simple sentences. English rules: do not state simplifications as exact facts (write \"about\", \"usually\" when a number is approximate, e.g. time zones). " +
  "Return ONLY JSON: {\"title_rw\":\"\",\"title_en\":\"\",\"summary_rw\":\"\",\"summary_en\":\"\",\"keywords\":[5-8 lowercase words in rw and en],\"questions_rw\":[3 natural questions],\"questions_en\":[3 natural questions],\"confidence\":0-1,\"ok\":true|false}. " +
  "Set ok=false if the topic is contested, time-sensitive, medical dosage, legal advice, about a living person, or you are not certain every fact is correct.";
const SYS_CHECK = "You are a strict fact-checker. Check the entry below for factual errors, invented details or misleading claims (both languages). " +
  "Return ONLY JSON: {\"correct\":true|false,\"issues\":\"short\"}. Say correct=false if ANY claim is doubtful.";

/* ---------- akayunguruzo k'amazina y'Ikinyarwanda ----------
   Amazina (afite inyuguti nkuru hagati mu nteruro, cyangwa ahujwe na "-") ataboneka mu ai*.json zawe KANDI atari mu Cyongereza cy'iyo entry
   ni ugukeka ko LLM yayahimbye (urugero "Antagitika" aho wowe wanditse "Antaragitika"). Entry ibifite ntiyemerwa. */
let VOCAB = null;
function loadVocab() {
  if (VOCAB) return VOCAB; VOCAB = new Set();
  const add = s => String(s).split(/\s+/).forEach(w => { const l = norm(w.replace(/[-]/g, " ")).split(" "); l.forEach(x => x && VOCAB.add(x)); VOCAB.add(norm(w)); });
  const walk = o => { if (typeof o === "string") add(o); else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") Object.values(o).forEach(walk); };
  for (const f of fs.readdirSync(SRC)) { if (!/^(ai\d*|ai_core|dictionary|grammar)\.json$/.test(f)) continue; try { walk(JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"))); } catch (e) {} }
  return VOCAB;
}
function unknownNames(rwTexts, enTexts) {
  const V = loadVocab(), en = new Set(String(enTexts.join(" ")).split(/\s+/).flatMap(w => [norm(w), ...norm(w.replace(/-/g, " ")).split(" ")]).filter(Boolean));
  const bad = [];
  for (const text of rwTexts) {
    const toks = String(text).split(/\s+/).filter(Boolean);
    toks.forEach((raw, i) => {
      const prev = i ? toks[i - 1] : "", sentStart = i === 0 || /[.!?:]$/.test(prev);
      const core = raw.replace(/^[("'“]+|[)"'”.,;:!?]+$/g, ""), last = core.split("'").pop(), hyph = core.includes("-");
      const nameLike = hyph || (/^[A-ZÀ-Ý]/.test(last) && !sentStart);
      if (!nameLike) return;
      const base = hyph ? core : last;                       // "n'Inyanja" -> "Inyanja", "y'Amahoro" -> "Amahoro"
      const parts = norm(base.replace(/-/g, " ")).split(" ").filter(Boolean);
      const whole = norm(base.replace(/-/g, " "));
      const known = x => V.has(x) || en.has(x) || ["u", "i", "a", "o", "ik", "ic"].some(p => V.has(p + x));   // "Bwongereza" ~ "ubwongereza"
      if (!(known(whole) || parts.every(known))) bad.push(core);
    });
  }
  return [...new Set(bad)];
}

function validEntry(e) {
  if (!e || e.ok !== true || !(e.confidence >= 0.8)) return false;
  for (const k of ["title_rw", "title_en", "summary_rw", "summary_en"]) if (typeof e[k] !== "string" || e[k].trim().length < 3) return false;
  if (!Array.isArray(e.keywords) || e.keywords.length < 3 || !Array.isArray(e.questions_en) || e.questions_en.length < 2 || !Array.isArray(e.questions_rw) || e.questions_rw.length < 2) return false;
  const all = [e.title_rw, e.title_en, e.summary_rw, e.summary_en, ...e.keywords, ...e.questions_en, ...e.questions_rw].join(" ");
  if (/https?:\/\/|www\./i.test(all) || BAD.test(all) || e.summary_en.length > 520 || e.summary_rw.length > 560) return false;
  return true;
}

if (process.env.TEACH_SELFTEST) {
  const cases = JSON.parse(process.env.TEACH_SELFTEST);
  cases.forEach(c => console.log(JSON.stringify(unknownNames(c.rw, c.en)), "<-", c.rw[0].slice(0, 50)));
  process.exit(0);
}
(async () => {
  if (!MOCK && !process.env.GEMINI_API_KEY) { console.error("Missing env GEMINI_API_KEY"); process.exit(2); }
  const cov = loadCovered();
  const brain = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8"))
    : { version: 2, module: "ai16", description: "Knowledge taught by an LLM (teach.js on GitHub). Low priority; never overrides hand-written modules. Delete any entry with \"auto\": true if it is wrong.", intents: [], knowledge: [] };
  brain.intents = brain.intents || []; brain.knowledge = brain.knowledge || [];
  brain.knowledge.forEach(k => cov.titles.push(k.title_en || k.title_rw));
  brain.intents.forEach(i => [...(i.patterns_en || []), ...(i.patterns_rw || [])].forEach(p => cov.pats.add(norm(p))));

  // icyiciro gihinduka buri nshuro (buri masaha 3), cyangwa icyo wahisemo
  const cat = String(process.env.TEACH_CATEGORY || CATEGORIES[Math.floor(Date.now() / (3 * 3600e3)) % CATEGORIES.length]).trim().toLowerCase();
  const have = Object.keys(cov.byCat).filter(k => String(k).toLowerCase() === cat).flatMap(k => cov.byCat[k]).slice(0, 80);
  console.log(`category: ${cat} (${have.length} titles already covered)`);

  let topics = [];
  try {
    const g = await llm("gaps", SYS_GAPS, `Category: ${cat}\nAlready covered: ${have.join("; ") || "(none)"}\nList ${MAX_TOPICS + 3} new topics.`, 0.4);
    topics = (g.topics || []).filter(t => t && t.title_en && !BAD.test(t.title_en) && !tooSimilar(t.title_en, cov)).slice(0, MAX_TOPICS);
  } catch (e) { console.log("gap-finding stopped:", e.message); }
  console.log(`${topics.length} new topics`);

  let added = 0;
  for (const t of topics) {
    try {
      const e = await llm("write", SYS_WRITE, `Category: ${cat}\nTopic: ${t.title_en} / ${t.title_rw || ""}`, 0.2);
      if (!validEntry(e)) { console.log("skip (invalid/unsure):", t.title_en); continue; }
      if (tooSimilar(e.title_en, cov)) { console.log("skip (duplicate):", e.title_en); continue; }
      const unk = unknownNames([e.title_rw, e.summary_rw, ...e.questions_rw], [e.title_en, e.summary_en, ...e.questions_en, ...e.keywords]);
      if (unk.length) { console.log("skip (unknown Kinyarwanda names, maybe invented):", e.title_en, "->", unk.join(", ")); continue; }
      await sleep(MOCK ? 0 : 5000);
      const c = await llm("check", SYS_CHECK, JSON.stringify({ title_en: e.title_en, summary_en: e.summary_en, title_rw: e.title_rw, summary_rw: e.summary_rw }), 0);
      if (!c || c.correct !== true) { console.log("rejected by fact-check:", e.title_en, "-", (c && c.issues) || ""); continue; }

      const id = "ai16_" + hash(e.title_en), today = new Date().toISOString().slice(0, 10);
      const qEn = e.questions_en.map(String).filter(q => !cov.pats.has(norm(q))).slice(0, 4);
      const qRw = e.questions_rw.map(String).filter(q => !cov.pats.has(norm(q))).slice(0, 4);
      brain.knowledge.push({ id, category: cat, title_rw: e.title_rw.trim(), title_en: e.title_en.trim(), summary_rw: e.summary_rw.trim(), summary_en: e.summary_en.trim(),
        keywords: [...new Set(e.keywords.map(k => String(k).toLowerCase().trim()))].slice(0, 10), auto: true, taught: today });
      if (qEn.length || qRw.length) brain.intents.push({
        id: id + "_q", label_rw: e.title_rw.trim().slice(0, 60), label_en: e.title_en.trim().slice(0, 60),
        patterns_en: qEn, patterns_rw: qRw, priority: 3,
        answer_rw: [e.summary_rw.trim() + "\n\n⚠️ Ubu bumenyi bwigishijwe na AI, bushobora kwibeshya."],
        answer_en: [e.summary_en.trim() + "\n\n⚠️ This knowledge was taught by an AI and may contain mistakes."],
        auto: true, taught: today
      });
      cov.titles.push(e.title_en); cov.titleSet.add(norm(e.title_en)); [...qEn, ...qRw].forEach(q => cov.pats.add(norm(q)));
      added++; console.log("taught:", e.title_en);
    } catch (err) { console.log("stop:", err.message); if (err.message === "rate") break; }
    await sleep(MOCK ? 0 : 5000);        // ubuntu bufite imipaka y'ibibazo ku munota
  }

  const trim = arr => { const au = arr.filter(x => x.auto); if (au.length > MAX_TOTAL) { const drop = new Set(au.slice(0, au.length - MAX_TOTAL).map(x => x.id)); return arr.filter(x => !drop.has(x.id)); } return arr; };
  brain.knowledge = trim(brain.knowledge); brain.intents = trim(brain.intents);
  if (!DRY && added) fs.writeFileSync(OUT, JSON.stringify(brain, null, 1) + "\n");
  console.log(`added ${added}${DRY ? " (dry, nothing written)" : ""}; total taught: ${brain.knowledge.length}`);
})().catch(e => { console.error(e); process.exit(1); });
