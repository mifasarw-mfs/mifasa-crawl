/* MIFASA learning store: routes for the Cloudflare Worker that already serves MIFASA_LLM_URL.
   ADD to your Worker (3 lines):
       import { handleLearn } from "./learn.js";
       // at the top of fetch(request, env, ctx):   const l = await handleLearn(request, env); if (l) return l;
   Needs: a D1 binding named  DB  (schema.sql), the secret OWNER_TOKEN (wrangler secret put OWNER_TOKEN),
          optional  RATE_SALT  (any random text) and  ALLOW_ORIGIN  (default "*").
   Routes
     POST /api/learn            browsers send ANSWERS THE EXTERNAL AI GAVE  -> stored as "pending" (nobody else sees them yet)
     POST /api/learn/vote       👍/👎 counters
     GET  /api/learned/export   ONLY owner-APPROVED answers (what every browser downloads)
     GET  /api/learn/pending    owner: the queue, most-asked first          (Authorization: Bearer OWNER_TOKEN)
     POST /api/learn/review     owner: {id, action: approve|reject, answer?, answer_other?}
     POST /api/translate        optional translator, see translate() below
   Why "pending": anyone can call a public endpoint. Nothing a visitor sends is ever shown to other visitors until YOU approve it. */
const LIMITS = { perDay: 120, batch: 20, q: 400, answer: 6000 };
const PRIVATE_RE = /(password|passcode|\bpin\b|ijambo ry.ibanga|\b\d{6,}\b|@\w+\.\w+|\bhiv\b|cancer|diagnos|suicid|\bcvv\b)/i;
const json = (o, status, env) => new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": (env && env.ALLOW_ORIGIN) || "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" } });
const s = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);
const now = () => new Date().toISOString();
const owner = (req, env) => !!env.OWNER_TOKEN && (req.headers.get("authorization") || "") === "Bearer " + env.OWNER_TOKEN;

async function visitor(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "0", enc = new TextEncoder().encode(ip + "|" + (env.RATE_SALT || "mifasa") + "|" + now().slice(0, 10));
  const h = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function allowed(req, env, cost) {
  const who = await visitor(req, env), day = now().slice(0, 10);
  await env.DB.prepare("INSERT INTO learn_rate (who, day, n) VALUES (?, ?, 0) ON CONFLICT(who, day) DO NOTHING").bind(who, day).run();
  const row = await env.DB.prepare("UPDATE learn_rate SET n = n + ? WHERE who = ? AND day = ? RETURNING n").bind(cost, who, day).first();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM learn_rate WHERE day < ?").bind(new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)).run();
  return !!row && row.n <= LIMITS.perDay;
}

/* the ONLY place that decides whether a submitted answer is even accepted as "pending" */
export function cleanItem(x) {
  if (!x || typeof x !== "object") return null;
  const it = { id: s(x.id, 40), lang: x.lang === "en" ? "en" : "rw", q_raw: s(x.q_raw, LIMITS.q), q_norm: s(x.q_norm, LIMITS.q), q_en: s(x.q_en, LIMITS.q), key_en: s(x.key_en, LIMITS.q),
    understood: s(x.understood, 400), intent: s(x.intent, 60), answer: s(x.answer, LIMITS.answer), answer_lang: x.answer_lang === "en" ? "en" : "rw",
    grounded: x.grounded ? 1 : 0, sources: JSON.stringify((Array.isArray(x.sources) ? x.sources : []).slice(0, 3).map(r => ({ title: s(r && r.title, 80), url: s(r && r.url, 200) }))) };
  if (!/^L[a-z0-9]{3,30}$/.test(it.id) || it.q_raw.length < 6 || it.q_norm.length < 3 || it.answer.length < 20) return null;
  if (PRIVATE_RE.test(it.q_raw) || PRIVATE_RE.test(it.answer)) return null;
  return it;
}

export async function handleLearn(req, env) {
  const url = new URL(req.url), p = url.pathname;
  if (!/^\/api\/(learn|learned|translate)/.test(p)) return null;
  if (req.method === "OPTIONS") return json({}, 204, env);
  if (!env.DB) return json({ error: "no D1 binding named DB" }, 500, env);
  try {
    if (p === "/api/learn" && req.method === "POST") {
      const body = await req.json().catch(() => null), list = (body && Array.isArray(body.items) ? body.items : []).slice(0, LIMITS.batch);
      if (!list.length) return json({ error: "no items" }, 400, env);
      if (!(await allowed(req, env, list.length))) return json({ error: "daily limit" }, 429, env);
      let added = 0, seen = 0, ignored = 0; const t = now();
      for (const raw of list) {
        const it = cleanItem(raw); if (!it) { ignored++; continue; }
        const old = await env.DB.prepare("SELECT status FROM learned WHERE id = ?").bind(it.id).first();
        if (old) { await env.DB.prepare("UPDATE learned SET seen = seen + 1, updated_at = ? WHERE id = ?").bind(t, it.id).run(); seen++; continue; }   // an approved/rejected answer is never overwritten by a visitor
        await env.DB.prepare("INSERT INTO learned (id, lang, q_raw, q_norm, q_en, key_en, understood, intent, answer, answer_lang, grounded, sources, status, seen, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 1, ?, ?)")
          .bind(it.id, it.lang, it.q_raw, it.q_norm, it.q_en, it.key_en, it.understood, it.intent, it.answer, it.answer_lang, it.grounded, it.sources, t, t).run();
        added++;
      }
      return json({ ok: true, added, seen, ignored }, 200, env);
    }
    if (p === "/api/learn/vote" && req.method === "POST") {
      const b = await req.json().catch(() => null);
      if (!b || !/^L[a-z0-9]{3,30}$/.test(String(b.id || ""))) return json({ error: "bad id" }, 400, env);
      if (!(await allowed(req, env, 1))) return json({ error: "daily limit" }, 429, env);
      await env.DB.prepare(b.good ? "UPDATE learned SET helpful = helpful + 1 WHERE id = ?" : "UPDATE learned SET unhelpful = unhelpful + 1 WHERE id = ?").bind(b.id).run();
      return json({ ok: true }, 200, env);
    }
    if (p === "/api/learned/export" && req.method === "GET") {
      const r = await env.DB.prepare("SELECT id, lang, q_raw, q_norm, q_en, key_en, understood, intent, answer, answer_lang, answer_other, grounded, sources FROM learned WHERE status = 'approved' ORDER BY seen DESC LIMIT 5000").all();
      const items = (r.results || []).map(x => {
        const alt = {}; if (x.answer_other) alt[x.answer_lang === "en" ? "rw" : "en"] = x.answer_other;
        return { id: x.id, v: 1, lang: x.lang, q_raw: x.q_raw, q_norm: x.q_norm, q_en: x.q_en, key_en: x.key_en, understood: x.understood, intent: x.intent, answer: x.answer, answer_lang: x.answer_lang, answer_alt: alt, grounded: !!x.grounded, sources: JSON.parse(x.sources || "[]") };
      });
      return json({ version: 1, count: items.length, items }, 200, env);
    }
    if (p === "/api/learn/pending" && req.method === "GET") {
      if (!owner(req, env)) return json({ error: "owner only" }, 401, env);
      const r = await env.DB.prepare("SELECT * FROM learned WHERE status = 'pending' ORDER BY seen DESC, created_at DESC LIMIT ?").bind(Math.min(+url.searchParams.get("limit") || 50, 200)).all();
      return json({ count: (r.results || []).length, items: r.results || [] }, 200, env);
    }
    if (p === "/api/learn/review" && req.method === "POST") {
      if (!owner(req, env)) return json({ error: "owner only" }, 401, env);
      const b = await req.json().catch(() => null);
      if (!b || !/^L[a-z0-9]{3,30}$/.test(String(b.id || "")) || !["approve", "reject"].includes(b.action)) return json({ error: "need id and action approve|reject" }, 400, env);
      const t = now();
      if (b.action === "approve") {
        const ans = s(b.answer, LIMITS.answer);        // the owner may correct the answer before approving
        await env.DB.prepare("UPDATE learned SET status = 'approved', reviewed_at = ?, updated_at = ?, answer = CASE WHEN ? <> '' THEN ? ELSE answer END, answer_other = CASE WHEN ? <> '' THEN ? ELSE answer_other END WHERE id = ?")
          .bind(t, t, ans, ans, s(b.answer_other, LIMITS.answer), s(b.answer_other, LIMITS.answer), b.id).run();
      } else await env.DB.prepare("UPDATE learned SET status = 'rejected', reviewed_at = ?, updated_at = ? WHERE id = ?").bind(t, t, b.id).run();
      return json({ ok: true }, 200, env);
    }
    if (p === "/api/translate" && req.method === "POST") {
      const b = await req.json().catch(() => null), text = s(b && b.text, 6000);
      if (!text || !/^(en|rw)$/.test(b.from || "") || !/^(en|rw)$/.test(b.to || "")) return json({ error: "need text, from, to (en|rw)" }, 400, env);
      if (!(await allowed(req, env, 1))) return json({ error: "daily limit" }, 429, env);
      const out = await translate(text, b.from, b.to, env);
      return out ? json({ text: out }, 200, env) : json({ error: "translator not available" }, 501, env);
    }
    return json({ error: "not found" }, 404, env);
  } catch (e) { return json({ error: "server error" }, 500, env); }
}

/* TRANSLATOR SLOT. Put here whatever translates Kinyarwanda <-> English best for you. Two options:
   A) your own LLM (the one MIFASA_LLM_URL already uses): ask it "Translate to English. Reply with the translation only: ..." (best quality for Kinyarwanda)
   B) env.AI (Workers AI) with a translation model: M2M100 is documented by Cloudflare, but I could NOT confirm it supports Kinyarwanda: test 10 real
      sentences before trusting it. If it does not work for "rw", leave this function returning null: the browser then keeps using the
      question's English form that the external AI itself returns (q_en), which costs nothing extra. */
async function translate(text, from, to, env) {
  if (typeof env.TRANSLATE === "function") return env.TRANSLATE(text, from, to);   // e.g. set env.TRANSLATE in your Worker's own code
  return null;
}

/* FREE TRANSLATION + "HOW THE AI UNDERSTOOD IT", in the SAME call to your LLM (no extra cost):
   1) add this sentence to your LLM's system prompt:
      "After your answer write one last line exactly like this: <meta>{\"q_en\":\"the user's question in English\",\"understood_en\":\"one sentence: what the user wants\"}</meta>"
   2) in your Worker, where you build the reply:   const m = splitMeta(llmText);   return json({ text: m.text, q_en: m.q_en, understood_en: m.understood_en, sources, kb, web, taught })
   The browser saves q_en (the English pivot, so Kinyarwanda and English questions share ONE stored answer) and understood_en. */
export function splitMeta(text) {
  const t = String(text || ""), m = t.match(/<meta>\s*(\{[\s\S]*?\})\s*<\/meta>\s*$/i);
  if (!m) return { text: t.trim(), q_en: "", understood_en: "" };
  let j = {}; try { j = JSON.parse(m[1]); } catch (e) {}
  return { text: t.slice(0, m.index).trim(), q_en: s(j.q_en, LIMITS.q), understood_en: s(j.understood_en, 400) };
}
