/* MIFASA: sends ONE test notification to everybody subscribed and tells you exactly what is wrong.  Run from GitHub: Actions > mifasa-test-push > Run workflow. */
const K = process.env.ONESIGNAL_API_KEY || "", A = process.env.ONESIGNAL_APP_ID || "", SITE_APP = "0181af12-bb7e-47d5-9c4c-62f7b6c08dfa";
const say = (ok, m) => console.log((ok ? "OK    " : "ERROR ") + m);
async function main() {
  say(!!A, "ONESIGNAL_APP_ID secret " + (A ? "is set" : "is EMPTY"));
  say(!!K, "ONESIGNAL_API_KEY secret " + (K ? "is set (length " + K.length + "; a real App API Key is about 100 characters)" : "is EMPTY"));
  if (A) { const ok = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(A.trim()); say(ok, "App ID length " + A.length + (ok ? " and shape is right (36 characters, like 0181af12-bb7e-...)" : " - it must be 36 characters like 0181af12-bb7e-47d5-9c4c-62f7b6c08dfa. Copy 'OneSignal App ID' from Settings > Keys & IDs")); }
  if (A) say(A.trim() === SITE_APP, A.trim() === SITE_APP ? "App ID is the same as the one in index.html" : "App ID is DIFFERENT from index.html (" + SITE_APP + ") - visitors subscribe to another app, they will never get this push");
  if (K) {
    say(K === K.trim(), K === K.trim() ? "no spaces or new line in the key" : "the key has a space / new line at the start or end - paste it again in GitHub secrets");
    say(/^os_v2_app_/.test(K), /^os_v2_app_/.test(K) ? "key looks like an App API key (os_v2_app_...)" : "key does not start with os_v2_app_ - copy the REST API KEY of the app (Settings > Keys & IDs), not the User Auth key or the App ID");
  }
  if (!A || !K) return;
  const r = await fetch("https://api.onesignal.com/notifications", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Key " + K.trim() }, body: JSON.stringify({ app_id: A.trim(), target_channel: "push", included_segments: ["Subscribed Users"], headings: { en: "🔔 MIFASARW test" }, contents: { en: "Notifications zirakora! / Notifications work!" }, url: "https://mifasarw.neocities.org/" }) });
  const t = await r.text(); console.log("OneSignal answered HTTP " + r.status + ": " + t.slice(0, 400));
  if (r.status === 401 || r.status === 403) say(false, "API key refused -> the key is wrong, or belongs to another app. Create/copy it again and update the GitHub secret.");
  else if (/not subscribed|no recipients|No subscribed/i.test(t)) say(false, "the key is FINE, but nobody is subscribed yet -> open the site on your phone, tap 🔔, allow, then run this again.");
  else if (r.ok && /"id":"[0-9a-f-]{20,}"/.test(t)) say(true, "Notification created. The key is FINE. If nothing arrives on your phone, check the phone (silent / Do Not Disturb, Chrome notifications allowed).");
  else say(false, "see the answer above");
}
main().catch(e => { console.log("ERROR " + e.message); });
