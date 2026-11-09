/* MIFASA notifications (free): tells people about NEW videos AND NEW stories from crawl-news.json.   Run: node notify-post.js
   Runs after every crawl (every 5 min) but SPREADS the notifications out so nobody is spammed:
     - MIFASARW's own videos: sent at once (max 3 per run), always.
     - everything else (other channels + news stories): ONE notification, at most every NOTIFY_GAP_MIN minutes (default 25),
       at most PUSH_MAX_PER_DAY per day (default 12), never during quiet hours (22:00-06:00 Kigali time).
       The best one goes first (video before story, newest first). The rest wait in line and are dropped when too old
       (stories 3 h, other videos 6 h), so nothing piles up. Near-duplicate titles are sent only once.
   First run only "seeds" (remembers what exists, sends nothing). Remembers everything in notify-sent.json (rewritten only when it changes).
   Channels (each optional, runs only when its secrets exist):
     WEB PUSH (OneSignal)  secrets: ONESIGNAL_APP_ID, ONESIGNAL_API_KEY      DISCORD  secret: DISCORD_WEBHOOK_URL
   Optional env: NOTIFY_GAP_MIN, PUSH_MAX_PER_DAY, NOTIFY_NEWS_AGE_HOURS, NOTIFY_MAX_AGE_HOURS, NOTIFY_MAX_PER_RUN, QUIET_START, QUIET_END, NOTIFY_TZ_OFFSET */
const fs = require("fs");
const E = process.env, SITE = "https://mifasarw.neocities.org", BASE = SITE + "/mifasa-ai", STATE = "notify-sent.json";
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) ? n : d; };
const GAP = num(E.NOTIFY_GAP_MIN, 25) * 6e4, NEWS_AGE = num(E.NOTIFY_NEWS_AGE_HOURS, 3) * 36e5, VID_AGE = num(E.NOTIFY_MAX_AGE_HOURS, 6) * 36e5;
const DAY_MAX = num(E.PUSH_MAX_PER_DAY, 12), OWN_MAX = num(E.NOTIFY_MAX_PER_RUN, 3), QS = num(E.QUIET_START, 22), QE = num(E.QUIET_END, 6), TZ = num(E.NOTIFY_TZ_OFFSET, 2);
const PUSH = !!(E.ONESIGNAL_APP_ID && E.ONESIGNAL_API_KEY), DISCORD = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\//.test(E.DISCORD_WEBHOOK_URL || "");
const sleep = ms => new Promise(r => setTimeout(r, ms)), clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
async function post(url, headers, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const t = await r.text().catch(() => ""); if (!r.ok) throw new Error("HTTP " + r.status + " " + t.slice(0, 120)); return t;
}
const own = a => /mifasarw/i.test(String(a.source || ""));
function norm(a) {
  if (!a || !a.title) return null;
  const vid = !!(a.video && /^[\w-]{11}$/.test(a.video.id || ""));
  const raw = vid ? a.video.id : String(a.share_id || a.id || a.link || a.url || "").trim();
  if (!raw) return null;
  const en = a.lang === "en", id = vid ? a.video.id : "";
  const t = new Date(a.date || a.published || a.created_at || 0).getTime() || 0;
  const pic = String(a.image || a.img || a.thumbnail || a.picture || "");
  return {
    key: vid ? raw : "s:" + raw, vid, own: own(a), en, t, title: clip(a.title, 200),
    src: clip(String(a.source || (vid ? "YouTube" : "")).replace(/ YouTube$/i, ""), 60),
    url: vid ? BASE + "?lang=" + (en ? "en" : "rw") + "&v=" + id : String(a.link || a.url || SITE),
    img: vid ? "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg" : (/^https:\/\//.test(pic) ? pic : ""),
    yt: vid ? "https://youtu.be/" + id : ""
  };
}
const words = t => new Set(String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length > 3));
const similar = (a, b) => { if (!a.size || !b.size) return false; let n = 0; a.forEach(w => { if (b.has(w)) n++; }); return n / Math.min(a.size, b.size) >= 0.6; };
async function main() {
  if (!PUSH && !DISCORD) { console.log("notify: no ONESIGNAL_* / DISCORD_WEBHOOK_URL secrets - skipping"); return; }
  let news = []; try { const j = JSON.parse(fs.readFileSync("crawl-news.json", "utf8")); news = Array.isArray(j) ? j : (j.articles || j.items || []); } catch (e) { console.log("no crawl-news.json"); return; }
  const items = news.map(norm).filter(Boolean);
  let raw = "", st = null; try { raw = fs.readFileSync(STATE, "utf8"); st = JSON.parse(raw); } catch (e) {}
  const save = s => { const out = JSON.stringify(s); if (out !== raw) fs.writeFileSync(STATE, out); };
  const now = Date.now(), loc = new Date(now + TZ * 36e5), today = loc.toISOString().slice(0, 10), hour = loc.getUTCHours();
  if (!st || !Array.isArray(st.ids)) { save({ v: 2, ids: items.map(i => i.key).slice(0, 3000), day: today, pushed: 0, last: 0, titles: [] }); console.log("notify: first run, remembered " + items.length + " items, sent nothing"); return; }
  const sent = new Set(st.ids);
  if (st.v !== 2) { items.forEach(i => { if (!i.vid) sent.add(i.key); }); console.log("notify: upgraded - existing stories remembered, sent nothing for them"); }
  let pushed = st.day === today ? (st.pushed || 0) : 0, last = st.last || 0, titles = Array.isArray(st.titles) ? st.titles.slice(-60) : [];
  const recent = titles.map(words), quiet = QS > QE ? (hour >= QS || hour < QE) : (hour >= QS && hour < QE);
  // 1) drop what is too old or already told in other words
  const queue = [];
  items.filter(i => !sent.has(i.key)).sort((a, b) => b.t - a.t).forEach(i => {
    if (!i.own && now - i.t > (i.vid ? VID_AGE : NEWS_AGE)) { sent.add(i.key); return; }
    if (!i.own && recent.some(w => similar(w, words(i.title)))) { sent.add(i.key); return; }
    queue.push(i);
  });
  // 2) choose: all own videos (max OWN_MAX) + at most ONE other, only when the gap / daily cap / quiet hours allow
  const pick = queue.filter(i => i.own).slice(0, OWN_MAX);
  const others = queue.filter(i => !i.own).sort((a, b) => (b.vid - a.vid) || (b.t - a.t));
  const slot = !quiet && pushed < DAY_MAX && now - last >= GAP;
  if (slot && others.length) pick.push(others[0]);
  let n = 0;
  for (const a of pick) {
    let did = false;
    if (DISCORD) try {
      await post(E.DISCORD_WEBHOOK_URL, {}, { username: "MIFASARW", allowed_mentions: { parse: [] }, embeds: [{ title: clip(a.title, 250), url: a.url, description: (a.en ? "Source: " : "Isoko: ") + a.src + (a.yt ? " · " + a.yt : "") + "\n👉 " + (a.en ? "Follow MIFASARW" : "Kurikira MIFASARW") + ": youtube.com/@mifasarw · tiktok.com/@mifasarw", ...(a.img ? { image: { url: a.img } } : {}), color: 15087942 }] });
      did = true; console.log("discord  " + a.title.slice(0, 60));
    } catch (e) { console.log("discord FAIL " + e.message); }
    if (PUSH) try {
      const body = { app_id: E.ONESIGNAL_APP_ID, target_channel: "push", included_segments: ["Subscribed Users"], headings: { en: (a.vid ? "🎬 " : "📰 ") + clip(a.title, 90) }, contents: { en: (a.vid ? (a.en ? "New on MIFASARW · " : "Rishya kuri MIFASARW · ") : (a.en ? "News · " : "Amakuru · ")) + a.src }, url: a.url, ttl: a.own ? 86400 : 10800 };
      if (a.img) body.chrome_web_image = a.img;
      if (!a.own) body.collapse_id = "mifasa-" + (a.vid ? "video" : "news");   // a new one replaces the old one on the phone instead of stacking
      await post("https://api.onesignal.com/notifications", { Authorization: "Key " + E.ONESIGNAL_API_KEY }, body);
      did = true; console.log("push     " + a.title.slice(0, 60));
    } catch (e) { console.log("push FAIL " + e.message); }
    if (did) { sent.add(a.key); n++; titles.push(a.title); if (!a.own) { pushed++; last = now; } }
    await sleep(1200);
  }
  save({ v: 2, ids: [...sent].slice(-3000), day: today, pushed, last, titles: titles.slice(-60) });
  console.log("notify: " + n + " sent, " + Math.max(0, queue.length - pick.length) + " waiting" + (quiet ? " (quiet hours)" : "") + ", today " + pushed + "/" + DAY_MAX);
}
main().catch(e => { console.error(e); process.exit(0); });
