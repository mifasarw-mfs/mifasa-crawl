/* MIFASA LLM proxy - Cloudflare Worker (urwego rw'ubuntu).
   Urubuga rwawe (Neocities) ruvugana na Worker gusa; KEY ibikwa hano nk'ibanga, ntigaragara mu rubuga.
   Secrets/vars (Cloudflare Dashboard > Worker > Settings > Variables):
     GEMINI_API_KEY   (Secret)  key yawe y'ubuntu ya Google AI Studio
     ALLOWED_ORIGIN   (Var)     https://mifasarw.neocities.org
     GEMINI_MODEL     (Var, optional) urugero "gemini-flash-lite-latest"; ugenzure izina ryemewe muri AI Studio
     PER_IP_DAILY     (Var, optional) default 15
     GLOBAL_DAILY     (Var, optional) default 800   (komeza munsi y'imipaka ya Google)
     LOG_QUESTIONS    (Var, optional) "1" = bika ibibazo (TEXT gusa, iminsi 60) kugira ngo GitHub ibyige nijoro; ongera integuza y'ubuzima bwite
     EXPORT_TOKEN     (Secret, optional) ijambo ry'ibanga rya GitHub ryo gusoma /export
   KV namespace (optional ariko irasabwa): bind nka "RATE" kugira ngo imipaka ibikwe. Nta KV, imipaka ikora mu mwanya muto gusa. */

const SYSTEM = "You are MIFASA AI, a helpful assistant for the MIFASARW website (Rwanda). " +
  "Reply in the same language as the user (Kinyarwanda or English). Be concise (max ~150 words), accurate and friendly. " +
  "If you are not sure, say so; never invent facts, sources or links. For medical, legal or financial questions give general info and advise a professional. " +
  "You can help with explanations, writing and short code snippets. You cannot generate images; if asked, say so politely.";

const mem = new Map();   // ikoreshwa iyo nta KV ihari

function cors(env, req) {
  const o = req.headers.get("Origin") || "";
  const ok = !env.ALLOWED_ORIGIN || o === env.ALLOWED_ORIGIN;
  return { "Access-Control-Allow-Origin": ok ? (env.ALLOWED_ORIGIN || "*") : "null", "Access-Control-Allow-Methods": "POST, OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
}
const json = (o, s, h) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...h } });

async function bump(env, key, limit) {
  const day = new Date().toISOString().slice(0, 10), k = key + ":" + day;
  let n = 0;
  if (env.RATE) { n = parseInt(await env.RATE.get(k) || "0", 10); if (n >= limit) return false; await env.RATE.put(k, String(n + 1), { expirationTtl: 172800 }); return true; }
  n = mem.get(k) || 0; if (n >= limit) return false; mem.set(k, n + 1); return true;
}

async function logQuestion(env, q) {          // ibika TEXT y'ikibazo gusa (nta IP). Ikora gusa iyo LOG_QUESTIONS=1 kandi KV ihari.
  if (!env.RATE || env.LOG_QUESTIONS !== "1") return;
  const norm = q.toLowerCase().replace(/[^\p{L}\p{N} ']/gu, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  if (norm.length < 4) return;
  const k = "log:" + norm;
  let n = parseInt(await env.RATE.get(k) || "0", 10);
  await env.RATE.put(k, String(n + 1), { expirationTtl: 60 * 86400 });
}

async function exportLog(env, req) {            // GET /export  (Authorization: Bearer EXPORT_TOKEN) -> [{q, n}]
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.EXPORT_TOKEN || t !== env.EXPORT_TOKEN || !env.RATE) return new Response("forbidden", { status: 403 });
  const out = []; let cursor;
  do {
    const r = await env.RATE.list({ prefix: "log:", cursor, limit: 1000 });
    for (const k of r.keys) out.push({ q: k.name.slice(4), n: parseInt(await env.RATE.get(k.name) || "0", 10) });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && out.length < 3000);
  out.sort((a, b) => b.n - a.n);
  return new Response(JSON.stringify(out.slice(0, 500)), { headers: { "Content-Type": "application/json" } });
}

export default {
  async fetch(req, env) {
    if (req.method === "GET" && new URL(req.url).pathname === "/export") return exportLog(env, req);
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method !== "POST") return json({ error: "POST only" }, 405, h);
    if (env.ALLOWED_ORIGIN && req.headers.get("Origin") !== env.ALLOWED_ORIGIN) return json({ error: "forbidden" }, 403, h);
    if (!env.GEMINI_API_KEY) return json({ error: "not configured" }, 500, h);

    let body; try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400, h); }
    const q = String(body.q || "").trim().slice(0, 600);
    if (q.length < 2) return json({ error: "empty" }, 400, h);

    const ck = "cache:" + q.toLowerCase().replace(/\s+/g, " ").slice(0, 150);
    if (env.RATE) { const c = await env.RATE.get(ck); if (c) return json({ text: c, model: "cache" }, 200, h); }   // ikibazo kimwe = nta mupaka ukoreshwa
    const ip = req.headers.get("CF-Connecting-IP") || "x";
    if (!(await bump(env, "ip:" + ip, +env.PER_IP_DAILY || 15))) return json({ error: "limit", reason: "user" }, 429, h);
    if (!(await bump(env, "all", +env.GLOBAL_DAILY || 800))) return json({ error: "limit", reason: "global" }, 429, h);

    const model = env.GEMINI_MODEL || "gemini-flash-lite-latest";
    const hist = Array.isArray(body.history) ? body.history.slice(-4).map(m => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: String(m.text || "").slice(0, 400) }] })) : [];
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [...hist, { role: "user", parts: [{ text: q }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.6 }
        })
      });
      if (r.status === 429) return json({ error: "limit", reason: "provider" }, 429, h);
      if (!r.ok) return json({ error: "provider " + r.status }, 502, h);
      const d = await r.json();
      const text = ((d.candidates || [])[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
      if (!text) return json({ error: "empty answer" }, 502, h);
      if (env.RATE && !hist.length) await env.RATE.put(ck, text, { expirationTtl: 7 * 86400 });
      await logQuestion(env, q);
      return json({ text, model }, 200, h);
    } catch (e) { return json({ error: "network" }, 502, h); }
  }
};
