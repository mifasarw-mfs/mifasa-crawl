/* MIFASA: tells people about NEW videos (from crawl-news.json).  Run: node notify-post.js     Every channel is optional: it only runs when its secrets exist.
   1) WEB PUSH (OneSignal, free): visitors tap "🔔" on the site, then get a notification on their phone when a new video appears.
        secrets: ONESIGNAL_APP_ID, ONESIGNAL_API_KEY.   Careful with spam: MIFASARW's own videos always; other channels max 1 per run and 6 per day (PUSH_MAX_PER_DAY).
   2) DISCORD (free): a post in your Discord channel.   secret: DISCORD_WEBHOOK_URL   (Channel > Edit > Integrations > Webhooks > New webhook > Copy URL)
   First run only "seeds" (remembers what exists, sends nothing).  After that: max 3 videos per run, only videos newer than 6 hours (the MIFASARW channel's own videos: any age).
   Remembers what it sent in notify-sent.json. */
const fs = require("fs");
const E = process.env, BASE = "https://mifasarw.neocities.org/mifasa-ai", STATE = "notify-sent.json";
const MAX = Number(E.NOTIFY_MAX_PER_RUN || 3), AGE = Number(E.NOTIFY_MAX_AGE_HOURS || 6) * 36e5, PUSH_DAY = Number(E.PUSH_MAX_PER_DAY || 6);
const PUSH = !!(E.ONESIGNAL_APP_ID && E.ONESIGNAL_API_KEY), DISCORD = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\//.test(E.DISCORD_WEBHOOK_URL || "");
const sleep = ms => new Promise(r => setTimeout(r, ms)), clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
async function post(url, headers, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const t = await r.text().catch(() => ""); if (!r.ok) throw new Error("HTTP " + r.status + " " + t.slice(0, 120)); return t;
}
async function main() {
  if (!PUSH && !DISCORD) { console.log("notify: no ONESIGNAL_* / DISCORD_WEBHOOK_URL secrets - skipping"); return; }
  let news = []; try { const j = JSON.parse(fs.readFileSync("crawl-news.json", "utf8")); news = Array.isArray(j) ? j : (j.articles || j.items || []); } catch (e) { console.log("no crawl-news.json"); return; }
  const vids = news.filter(a => a && a.video && /^[\w-]{11}$/.test(a.video.id || ""));
  let st = null; try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) {}
  if (!st || !Array.isArray(st.ids)) { fs.writeFileSync(STATE, JSON.stringify({ ids: vids.map(a => a.video.id).slice(0, 600), day: "", pushed: 0 })); console.log("notify: first run, remembered " + vids.length + " videos, sent nothing"); return; }
  const today = new Date().toISOString().slice(0, 10); if (st.day !== today) { st.day = today; st.pushed = 0; }
  const sent = new Set(st.ids), now = Date.now(), own = a => /mifasarw/i.test(String(a.source || ""));
  const fresh = vids.filter(a => !sent.has(a.video.id)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const ok = fresh.filter(a => own(a) || now - new Date(a.date).getTime() <= AGE).sort((a, b) => own(b) - own(a)).slice(0, MAX);
  fresh.forEach(a => { if (!ok.includes(a)) sent.add(a.video.id); });
  let pushOthers = 0, n = 0;
  for (const a of ok) {
    const id = a.video.id, en = a.lang === "en", title = clip(a.title, 200), src = clip(String(a.source || "YouTube").replace(/ YouTube$/i, ""), 60);
    const link = BASE + "?lang=" + (en ? "en" : "rw") + "&v=" + id, img = "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg";
    let did = false;
    if (DISCORD) try {
      await post(E.DISCORD_WEBHOOK_URL, {}, { username: "MIFASARW", allowed_mentions: { parse: [] }, embeds: [{ title: clip(title, 250), url: link, description: (en ? "Source: " : "Isoko: ") + src + " · https://youtu.be/" + id + "\n👉 " + (en ? "Follow MIFASARW" : "Kurikira MIFASARW") + ": youtube.com/@mifasarw · tiktok.com/@mifasarw", image: { url: img }, color: 15087942 }] });
      did = true; console.log("discord  " + title.slice(0, 60));
    } catch (e) { console.log("discord FAIL " + e.message); }
    if (PUSH && st.pushed < PUSH_DAY && (own(a) || pushOthers < 1)) try {
      await post("https://api.onesignal.com/notifications", { Authorization: "Key " + E.ONESIGNAL_API_KEY }, { app_id: E.ONESIGNAL_APP_ID, target_channel: "push", included_segments: ["Subscribed Users"], headings: { en: "🎬 " + clip(title, 90) }, contents: { en: (en ? "New on MIFASARW · " : "Rishya kuri MIFASARW · ") + src }, url: link, chrome_web_image: img });
      did = true; st.pushed++; if (!own(a)) pushOthers++; console.log("push     " + title.slice(0, 60));
    } catch (e) { console.log("push FAIL " + e.message); }
    if (did) { sent.add(id); n++; }
    await sleep(1200);
  }
  fs.writeFileSync(STATE, JSON.stringify({ ids: [...sent].slice(-800), day: st.day, pushed: st.pushed }));
  console.log("notify: " + n + " videos sent");
}
main().catch(e => { console.error(e); process.exit(0); });
