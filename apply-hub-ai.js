#!/usr/bin/env node
/* MIFASA: connects the HUB + GOAL MENTOR to the AI (parts 280, 285, 290, 295) and rebuilds script.js.
   Usage (in mifasa-dev, next to parts/ and build.js; run apply-hub.js FIRST):   node apply-hub-ai.js
   Safe to run twice. Changes only: the 3 part files + 3 small hooks (mifasaAskAsync x2, mifasaAskConversation x1). */
const fs = require("fs"), path = require("path"), cp = require("child_process");
const dir = path.resolve(process.argv[2] || "."), pd = path.join(dir, "parts");
if (!fs.existsSync(pd)) { console.error("parts/ not found in " + dir); process.exit(1); }
if (!fs.existsSync(path.join(pd, "280-hub.js"))) { console.error("parts/280-hub.js is missing: run  node apply-hub.js  first"); process.exit(1); }

for (const f of ["280-hub.js", "285-hub-ai.js", "290-goal.js", "295-learn.js"]) {
  const src = path.join(__dirname, "hub-part", f), dst = path.join(pd, f);
  const txt = fs.readFileSync(src, "utf8"), had = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : null;
  if (had === txt) console.log("parts/" + f + " already there"); else { fs.writeFileSync(dst, txt); console.log((had ? "updated " : "created ") + "parts/" + f); }
}

const ins = (find, add) => ({ find, replace: add + find });          // insert a block BEFORE an existing line
const EDITS = [
  { name: "hub before web research", ...ins("  if ((noAnswer || weak) && raw.length >= 6) {\n    const w = await mifasaWebResearch(raw);",
    "  if ((noAnswer || weak) && raw.length >= 6 && typeof mifasaHubAnswer === \"function\") {          // stories stored on the hub (+ their full text) come before the web\n    const hb = await mifasaHubAnswer(raw);\n    if (hb) return hb;\n  }\n") },
  { name: "hub before the external LLM", ...ins("  if ((noAnswer || weak || lowConf) && raw.length >= 6) {          // free external AI",
    "  if (lowConf && !noAnswer && !weak && raw.length >= 6 && typeof mifasaHubAnswer === \"function\") {\n    const hb2 = await mifasaHubAnswer(raw);\n    if (hb2) return hb2;\n  }\n") },
  { name: "goal mentor in the conversation", ...ins("  if (!r && typeof window !== \"undefined\" && window.MIFASA_LLM_URL && q.length >= 2 && !MIFASA_SAFETY_RE.test(q) && mifasaConvIsFollowUp(q)) {",
    "  if (!r && typeof mifasaGoalHandle === \"function\") { try { r = await mifasaGoalHandle(q); } catch (e) { r = null; } }      // long personal goal (part 290)\n") },
  { name: "learned answers first (before KB / web / LLM)", ...ins("  if ((noAnswer || weak || mifasaKbFresh(raw)) && raw.length >= 6 && (typeof MIFASA_SAFETY_RE === \"undefined\" || !MIFASA_SAFETY_RE.test(raw))) {",
    "  if ((noAnswer || weak) && raw.length >= 6 && typeof mifasaLearnLookup === \"function\") {          // what the external AI already answered once (part 295)\n    const lm = await mifasaLearnLookup(raw);\n    if (lm) return lm;\n  }\n") },
  { name: "learned answers inside mifasaLlmAnswer", ...ins("  if (!url || MIFASA_LLM.busy || !mifasaLlmQuota()) return null;",
    "  if (typeof mifasaLearnLookup === \"function\") { const mem = await mifasaLearnLookup(raw, opt); if (mem) return mem; }      // saved answers work even without a URL or quota (part 295)\n") },
  { name: "send the English pivot to the external AI", find: "body: JSON.stringify({ q: raw, lang: en ? \"en\" : \"rw\", history: mifasaConvHistory(), context: ctx, web:",
    replace: "body: JSON.stringify({ q: raw, q_en: (typeof mifasaLearnPivot === \"function\" ? mifasaLearnPivot(raw) : undefined), lang: en ? \"en\" : \"rw\", history: mifasaConvHistory(), context: ctx, web:" },
  { name: "save what the external AI answered", find: "if (!d.taught) mifasaLlmCount();",
    replace: "if (!d.taught) mifasaLlmCount(); if (typeof mifasaLearnCapture === \"function\") mifasaLearnCapture(raw, d, { en, ctx: ctx.length > 0, opt });" }
];
const todo = EDITS.map(e => ({ ...e, done: false, had: false }));
for (const f of fs.readdirSync(pd).filter(f => /^\d{3}-.+\.js$/.test(f))) {
  const p = path.join(pd, f); let t = fs.readFileSync(p, "utf8"), ch = false;
  todo.forEach(e => {
    if (t.includes(e.replace)) { e.had = true; return; }
    if (t.includes(e.find)) { t = t.replace(e.find, () => e.replace); e.done = true; ch = true; console.log("hooked '" + e.name + "' in parts/" + f); }
  });
  if (ch) fs.writeFileSync(p, t);
}
let bad = false;
todo.forEach(e => { if (!e.done && !e.had) { console.error("Could not find the place for '" + e.name + "'. Tell Claude which part has 'async function mifasaAskAsync' / 'mifasaAskConversation' / 'mifasaLlmAnswer'."); bad = true; } else if (e.had) console.log("'" + e.name + "' already hooked"); });
if (bad) process.exit(1);
const r = cp.spawnSync(process.execPath, [path.join(dir, "build.js")], { cwd: dir, stdio: "inherit" });
process.exit(r.status || 0);
