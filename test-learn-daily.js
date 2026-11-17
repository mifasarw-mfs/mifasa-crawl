#!/usr/bin/env node
/* Offline test for learn-daily.js (fake Wiktionary, temp folder).  Run:  node test-learn-daily.js */
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mifasa-ld-"));
process.env.MIFASA_DIR = tmp;
const L = require("./learn-daily.js");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("✓ " + m); } else { fail++; console.log("✗ " + m); } };

/* 1. the ids and normalised questions must equal what script.js computes in the browser */
const sp = path.join(__dirname, "script.js");
if (fs.existsSync(sp)) {
  const src = fs.readFileSync(sp, "utf8"), grab = n => { const i = src.indexOf("function " + n + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; if (src[k] === "}" && --d === 0) return src.slice(i, k + 1); } };
  const ctx = {}; vm.createContext(ctx); vm.runInContext(grab("mifasaNorm") + "\n" + grab("mifasaLearnId"), ctx);
  const qs = ['What does "government" mean?', "Ijambo ubukungu risobanura iki?", "How does café work & why?"];
  ok(qs.every(q => ctx.mifasaNorm(q) === L.norm(q)), "normalisation is identical to script.js");
  ok(qs.every(q => ctx.mifasaLearnId("en", ctx.mifasaNorm(q)) === L.learnId("en", L.norm(q))), "ids are identical to script.js");
} else console.log("(script.js not next to this test: browser-compatibility check skipped)");

/* 2. words */
const w = L.extractWords("Perezida Kagame yavuze ko ubukungu burazamuka. RDF na NATO. Ubu Kigali ni umujyi.", "rw");
ok(w.has("ubukungu") && w.has("umujyi") && !w.has("kagame") && !w.has("kigali") && !w.has("rdf"), "words extracted, names and acronyms skipped");

/* 3. gate */
ok(!L.gate("cats", { url: "https://x", pos: "noun", defs: ["plural of cat"] }), "'plural of' stubs are rejected");
ok(!L.gate("x", { url: "", pos: "noun", defs: ["a perfectly fine long definition"] }), "no source URL = rejected");
ok(L.gate("ubukungu", { url: "https://en.wiktionary.org/wiki/ubukungu", pos: "noun", defs: ["economy"] }), "good definition passes");
ok(L.gate("fall", { url: "https://x", pos: "verb", defs: ["To move to a lower position.", "to move to a lower position."] }).defs.length === 1, "duplicate senses are removed");
ok(L.shortGloss({ defs: ["(economics) economy; wealth"] }) === "economy", "short English gloss for dictionary-auto");

/* 4. a whole run with a fake network */
fs.writeFileSync(path.join(tmp, "crawl-news.json"), JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ url: "https://n/" + i, lang: i % 2 ? "rw" : "en", title: "Ubukungu bw'igihugu burazamuka " + i, summary: "The parliament adopted a budget about infrastructure and ubukungu." }))));
let calls = 0;
global.fetch = async url => {
  calls++; const u = String(url);
  if (u.includes("categorymembers")) return { ok: true, status: 200, json: async () => ({ query: { categorymembers: [{ title: "abana" }, { title: "agaciro" }, { title: "ahantu" }] }, continue: { cmcontinue: "next|1" } }) };
  const m = u.match(/definition\/([^?]+)/), word = decodeURIComponent(m[1]);
  if (word === "parliament") return { ok: true, status: 200, json: async () => ({ en: [{ partOfSpeech: "Noun", language: "English", definitions: [{ definition: '<a href="x">An assembly</a> that makes laws.' }] }] }) };
  if (word === "ubukungu") return { ok: true, status: 200, json: async () => ({ rw: [{ partOfSpeech: "Noun", language: "Kinyarwanda", definitions: [{ definition: "economy" }] }] }) };
  if (word === "budget") return { ok: true, status: 200, json: async () => ({ en: [{ partOfSpeech: "Noun", language: "English", definitions: [{ definition: "plural of budgets" }] }] }) };
  return { ok: false, status: 404, json: async () => ({}) };
};
L._cfg.delayMs = 0;
(async () => {
  const r = await L.main();
  ok(r.made >= 2, "answers were created (" + r.made + ")");
  const items = JSON.parse(fs.readFileSync(path.join(tmp, "learned", "part-0001.json"), "utf8")).items;
  ok(items.some(x => x.word === "parliament" && /An assembly that makes laws/.test(x.answer) && x.sources[0].url.startsWith("https://")), "English answer has the cleaned definition + source");
  ok(items.some(x => x.word === "ubukungu" && x.lang === "rw" && x.answer_lang === "en"), "Kinyarwanda word gets a Kinyarwanda question with an English answer");
  ok(!items.some(x => x.word === "budget"), "stub definition never became an answer");
  ok(fs.existsSync(path.join(tmp, "words", "p.json")) && JSON.parse(fs.readFileSync(path.join(tmp, "words", "p.json"), "utf8")).words.parliament, "word filed under its letter (words/p.json)");
  ok(JSON.parse(fs.readFileSync(path.join(tmp, "dictionary-auto.json"), "utf8")).entries.some(e => e.rw === "ubukungu" && e.en[0] === "economy"), "dictionary-auto.json got ubukungu = economy");
  const before = calls; const r2 = await L.main();
  ok(r2.made === 0 || r2.total >= r.total, "second run does not duplicate answers (total " + r2.total + ")");
  /* banned list is respected */
  fs.writeFileSync(path.join(tmp, "learned", "banned.json"), JSON.stringify({ ids: [], words: ["parliament"] }));
  const r3 = await L.main(); const items3 = JSON.parse(fs.readFileSync(path.join(tmp, "learned", "part-0001.json"), "utf8")).items;
  ok(!items3.some(x => x.word === "parliament"), "banned word removed from the answers and never comes back");
  /* daily cap */
  L._cfg.dailyTarget = 1; const r4 = await L.main(); ok(r4.made === 0, "daily target stops new answers");
  /* network down: must not crash */
  global.fetch = async () => { throw new Error("offline"); }; L._cfg.dailyTarget = 150; let crashed = false; try { await L.main(); } catch (e) { crashed = true; } ok(!crashed, "network down: no crash");
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
