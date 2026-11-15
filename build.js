#!/usr/bin/env node
/* MIFASA build v2: parts/*.js  ->  script.js
   Why: script.js is ONE closure (IIFE), so it cannot simply be cut into separate <script> files (the parts share variables).
   You edit small files in parts/, this puts them back together AND checks the join for the usual mistakes.
   Usage:  node build.js            checks, then writes script.js
           node build.js --check    only tells you whether script.js is up to date (exit code 1 if not)
           node build.js --list     lists the parts with size and line count
   parts/000-header.js stays OUTSIDE the closure; every other part (010 ... 270) goes inside, in name order.
   Checks (build stops with exit code 1 when one of them fails):
     - the part numbers expected by EXPECTED below are all present (a missing part = missing feature)
     - no top-level name (function / const / let / var / class) is declared in two parts (SyntaxError for const/let)
     - every part ends with a newline (so two parts can never glue together on one line)
     - the finished script has no syntax error                                                          */
const fs = require("fs"), path = require("path");

const EXPECTED = ["000", "010", "020", "030", "040", "050", "060", "070", "080", "090", "100", "110", "120", "130", "140", "150",
  "160", "170", "175", "176", "180", "190", "200", "210", "220", "230", "240", "250", "260", "265", "270", "280", "285", "290", "295"];

function topLevelNames(src) {
  const out = [], re = /^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m; while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function build(dir) {
  const pd = path.join(dir, "parts");
  const files = fs.readdirSync(pd).filter(f => /^\d{3}-.+\.js$/.test(f)).sort();
  if (!files.length || files[0] !== "000-header.js") throw new Error("parts/000-header.js is missing");
  const read = f => { const t = fs.readFileSync(path.join(pd, f), "utf8"); return t.endsWith("\n") ? t : t + "\n"; };
  const head = read(files[0]);
  const body = files.slice(1).map(read).join("");
  const problems = [], warns = [];

  const have = new Set(files.map(f => f.slice(0, 3)));
  const missing = EXPECTED.filter(n => !have.has(n));
  if (missing.length) problems.push("missing parts: " + missing.join(", "));
  const extra = [...have].filter(n => !EXPECTED.includes(n));
  if (extra.length) warns.push("parts not in EXPECTED (fine if you added them on purpose): " + extra.join(", "));

  const owner = new Map();
  files.slice(1).forEach(f => {
    const own = new Set(topLevelNames(read(f)));
    own.forEach(n => { if (owner.has(n)) problems.push(`"${n}" is declared in both ${owner.get(n)} and ${f}`); else owner.set(n, f); });
  });

  return { text: head + "(function () {\n" + body + "})();\n", files, problems, warns };
}
module.exports = build;

if (require.main === module) {
  const dir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || ".");
  const r = build(dir), out = path.join(dir, "script.js");
  if (process.argv.includes("--list")) {
    r.files.forEach(f => { const t = fs.readFileSync(path.join(dir, "parts", f), "utf8"); console.log(f.padEnd(28), String(t.length).padStart(8) + " bytes", String(t.split("\n").length).padStart(6) + " lines"); });
    process.exit(0);
  }
  r.warns.forEach(w => console.log("  ! " + w));
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    r.problems.forEach(p => console.log("  ✗ " + p));
    console.log(cur === r.text ? "script.js is up to date (" + r.files.length + " parts)" : "script.js is OUT OF DATE: run  node build.js");
    process.exit(cur === r.text && !r.problems.length ? 0 : 1);
  }
  if (r.problems.length) { r.problems.forEach(p => console.log("  ✗ " + p)); console.error("Build stopped: fix the lines above (script.js was NOT written)."); process.exit(1); }
  try { new Function(r.text); } catch (e) { console.error("Build stopped: the joined script has a syntax error: " + e.message + "\n(script.js was NOT written)"); process.exit(1); }
  fs.writeFileSync(out, r.text);
  console.log("script.js built from " + r.files.length + " parts (" + r.text.length + " bytes)");
}
