/* MIFASA: gets EVERY video of every YouTube channel in crawl-feeds.json (entries with type:"youtube").
   Needs the secret YOUTUBE_API_KEY (the same key the trending feeds use; 1 quota unit per 50 videos, free 10,000/day).
   First run = the whole catalogue of each channel; later runs = only the new videos (stops at the first one it already knows).
   Output: videos/<slug>.json (one file per channel) + videos/index.json.  Run: node crawl-videos.js   (or --only="Yee Fanta YouTube") */
const fs = require("fs"), path = require("path");
const KEY = process.env.YOUTUBE_API_KEY, DIR = "videos", UA = "Mozilla/5.0 (compatible; MIFASA-crawler)";
const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
async function get(url) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 25000);
  try { const r = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "en" } }); if (!r.ok) throw new Error("HTTP " + r.status); return r; }
  finally { clearTimeout(t); }
}
async function channelId(f) {
  const id = String(f.channel_id || "").trim();
  if (/^UC[\w-]{22}$/.test(id)) return id;
  const h = String(f.handle || "").trim().replace(/^@?/, "@");
  if (h.length < 3) throw new Error("needs channel_id or handle");
  const html = await (await get("https://www.youtube.com/" + h)).text();
  const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error("channel id not found for " + h + " (put \"channel_id\" in crawl-feeds.json)");
  return m[1];
}
async function main() {
  if (!KEY) { console.log("YOUTUBE_API_KEY is not set: skipping (the RSS crawl still keeps each channel's latest 15 videos)"); return; }
  const only = ((process.argv.find(a => a.startsWith("--only=")) || "").slice(7)).replace(/^"|"$/g, "");
  const feeds = JSON.parse(fs.readFileSync("crawl-feeds.json", "utf8")).feeds.filter(f => f.type === "youtube" && f.enabled !== false && (!only || f.name === only));
  fs.mkdirSync(DIR, { recursive: true });
  const index = []; let quotaOut = false;
  for (const f of feeds) {
    const s = slug(f.name), file = path.join(DIR, s + ".json"); let old = { videos: [] };
    try { old = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
    old.videos = Array.isArray(old.videos) ? old.videos : [];
    let videos = old.videos, id = old.channel_id || "";
    if (!quotaOut) try {
      id = /^UC[\w-]{22}$/.test(id) ? id : await channelId(f);
      const known = new Set(old.videos.map(v => v.id)), fresh = []; let token = "", stop = false, pages = 0;
      while (!stop && pages++ < 100) {
        const j = await (await get("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=UU" + id.slice(2) + "&key=" + KEY + (token ? "&pageToken=" + token : ""))).json();
        for (const it of j.items || []) {
          const vid = (it.contentDetails && it.contentDetails.videoId) || (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId), t = (it.snippet && it.snippet.title) || "";
          if (!/^[\w-]{11}$/.test(vid || "") || /^(private|deleted) video$/i.test(t)) continue;
          if (known.has(vid)) { stop = true; continue; }
          known.add(vid); fresh.push({ id: vid, t: t.slice(0, 160), d: String((it.contentDetails && it.contentDetails.videoPublishedAt) || (it.snippet && it.snippet.publishedAt) || "").slice(0, 19) });
        }
        token = j.nextPageToken || ""; if (!token) stop = true;
      }
      videos = fresh.concat(old.videos).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
      fs.writeFileSync(file, JSON.stringify({ name: f.name, handle: f.handle || "", channel_id: id, lang: f.lang || "rw", category: f.category || "entertainment", updated: new Date().toISOString(), total: videos.length, videos }));
      console.log("OK    " + String(videos.length).padStart(5) + " videos (" + fresh.length + " new)  " + f.name);
    } catch (e) {
      console.log("FAIL  " + f.name + " -> " + e.message);
      if (/HTTP 403/.test(e.message)) { quotaOut = true; console.log("      (403 = YouTube key wrong, API not enabled or quota used: the other channels keep what they had)"); }
    }
    if (videos.length) index.push({ name: f.name, slug: s, total: videos.length, lang: f.lang || "rw", category: f.category || "entertainment" });
  }
  if (!only || index.length) {
    let prev = []; try { prev = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8")).channels || []; } catch (e) {}
    const names = new Set(index.map(c => c.name)), merged = index.concat(only ? prev.filter(c => !names.has(c.name)) : []);
    fs.writeFileSync(path.join(DIR, "index.json"), JSON.stringify({ updated: new Date().toISOString(), channels: merged }));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
