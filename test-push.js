/* MIFASA: checks OneSignal and sends ONE test notification, telling you exactly what is wrong.
   Run from GitHub: Actions > mifasa-test-push > Run workflow. It also lists the segments of your OneSignal app with their subscriber counts. */
const K = (process.env.ONESIGNAL_API_KEY || ""), A = (process.env.ONESIGNAL_APP_ID || ""), SITE_APP = "0181af12-bb7e-47d5-9c4c-62f7b6c08dfa";
const say = (ok, m) => console.log((ok ? "OK    " : "ERROR ") + m);
const H = { "Content-Type": "application/json", Accept: "application/json", Authorization: "Key " + K.trim() };
const get = async u => { const r = await fetch(u, { headers: H }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, text: t, json: j }; };
async function send(seg) {
  const r = await fetch("https://api.onesignal.com/notifications", { method: "POST", headers: H, body: JSON.stringify({ app_id: A.trim(), target_channel: "push", included_segments: [seg], headings: { en: "🔔 MIFASARW test" }, contents: { en: "Notifications zirakora! / Notifications work!" }, url: "https://mifasarw.neocities.org/" }) });
  const t = await r.text(); return { status: r.status, text: t, ok: r.ok && /"id":"[0-9a-f-]{20,}"/.test(t) };
}
async function main() {
  say(!!A, "ONESIGNAL_APP_ID secret " + (A ? "is set" : "is EMPTY"));
  say(!!K, "ONESIGNAL_API_KEY secret " + (K ? "is set (length " + K.length + "; a real App API Key is about 100 characters)" : "is EMPTY"));
  if (A) { const ok = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(A.trim()); say(ok, "App ID length " + A.length + (ok ? " and shape is right" : " - it must be 36 characters like 0181af12-bb7e-47d5-9c4c-62f7b6c08dfa")); say(A.trim() === SITE_APP, A.trim() === SITE_APP ? "App ID is the same as the one in index.html" : "App ID is DIFFERENT from index.html - visitors subscribe to another app"); }
  if (K) { say(K === K.trim(), K === K.trim() ? "no spaces or new line in the key" : "the key has a space / new line - paste it again"); say(/^os_v2_app_/.test(K), /^os_v2_app_/.test(K) ? "key looks like an App API key" : "key does not start with os_v2_app_"); }
  if (!A || !K) return;
  // 1) which segments does this app have, and how many subscribers in each?
  const segs = []; const L = await get("https://api.onesignal.com/apps/" + A.trim() + "/segments?offset=0&limit=50");
  if (L.status !== 200 || !L.json) say(false, "could not list segments: HTTP " + L.status + " " + L.text.slice(0, 200));
  else for (const s of (L.json.segments || []).slice(0, 12)) {
    const c = await get("https://api.onesignal.com/apps/" + A.trim() + "/segments/" + s.id); const n = c.json && typeof c.json.subscriber_count === "number" ? c.json.subscriber_count : -1;
    segs.push({ name: s.name, n }); console.log("      segment \"" + s.name + "\": " + (n >= 0 ? n + " subscribers" : "count unknown (HTTP " + c.status + ")"));
  }
  if (L.json && !segs.length) say(false, "this app has NO segments - in OneSignal create a segment named Subscribed Users (no filters), then run again");
  // 2) send to "Subscribed Users" first, then to any other segment that has subscribers
  const order = ["Subscribed Users", ...segs.filter(s => s.name !== "Subscribed Users" && s.n !== 0).sort((a, b) => b.n - a.n).map(s => s.name)];
  for (const name of order) {
    const r = await send(name); console.log("OneSignal answered for \"" + name + "\": HTTP " + r.status + " " + r.text.slice(0, 250));
    if (r.status === 401 || r.status === 403) { say(false, "API key refused -> the key is wrong or belongs to another app."); return; }
    if (r.ok) { say(true, "Notification created for segment \"" + name + "\". The key is FINE." + (name !== "Subscribed Users" ? " -> add a GitHub VARIABLE named ONESIGNAL_SEGMENT with the value: " + name : "") + " If nothing arrives: phone silent / Chrome notifications blocked."); return; }
  }
  say(false, "no segment of THIS app has a subscriber. The 2 subscribers you saw in the dashboard are probably in ANOTHER OneSignal app, or were created before the App ID was fixed. Open the site on your phone, tap 🔔 again (if it already says ✓ tap twice to unsubscribe then subscribe), wait 1 minute and run this again. Check the app name at the top of the OneSignal dashboard is the one whose App ID is " + SITE_APP + ".");
}
main().catch(e => { console.log("ERROR " + e.message); });
