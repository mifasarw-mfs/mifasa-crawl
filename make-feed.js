/* MIFASA: builds feed.xml (RSS 2.0) = the newest stories from crawl-news.json. Links go to the static pages s/<share_id>.html.
   Run: node make-feed.js     FEED_MAX (default 60). Description = the short summary only (no full text). Same input = same file (no useless commits). */
const fs = require("fs");
const SITE = "https://mifasarw.neocities.org", MAX = Number(process.env.FEED_MAX || 60);
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = s => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = text(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const first = (...v) => { for (const x of v) { const t = text(x); if (t) return t; } return ""; };
let all = []; try { const j = JSON.parse(fs.readFileSync("crawl-news.json", "utf8")); all = Array.isArray(j) ? j : (j.articles || j.items || []); } catch (e) {}
const seen = new Set(), items = [];
all.forEach(a => {
  const id = a && a.share_id ? String(a.share_id).trim() : "";
  if (!/^[A-Za-z0-9_.-]{3,120}$/.test(id) || id[0] === "." || seen.has(id) || !fs.existsSync("s/" + id + ".html")) return;   // only stories that have their page
  const t = new Date(a.date || a.publish || a.published || a.created_at || 0).getTime() || 0;
  const en = a.lang === "en" || (!a.title_rw && !a.title && !!a.title_en), L = en ? "en" : "rw", O = en ? "rw" : "en";
  const title = clip(first(a["title_" + L], a["title_" + O], a.title, a.name), 200); if (!title) return;
  seen.add(id); items.push({ id, t, title, L, a, desc: clip(first(a["summary_" + L], a["summary_" + O], a.summary, a.desc, a.content), 300) });
});
items.sort((x, y) => y.t - x.t);
const list = items.slice(0, MAX), built = list.length && list[0].t ? new Date(list[0].t).toUTCString() : "";
const out = list.map(s => {
  const url = SITE + "/s/" + encodeURIComponent(s.id) + ".html", p = String(s.a.image || s.a.thumbnail || "").trim(), src = first(s.a.source).replace(/ YouTube$/i, ""), cat = first(s.a.category);
  return "    <item>\n      <title>" + esc(s.title) + "</title>\n      <link>" + esc(url) + "</link>\n      <guid isPermaLink=\"true\">" + esc(url) + "</guid>\n" +
    (s.t ? "      <pubDate>" + new Date(s.t).toUTCString() + "</pubDate>\n" : "") +
    (cat ? "      <category>" + esc(cat) + "</category>\n" : "") +
    "      <description>" + esc(s.desc + (src ? " (" + (s.L === "en" ? "Source" : "Isoko") + ": " + src + ")" : "")) + "</description>\n" +
    (/^https:\/\//.test(p) ? "      <media:thumbnail url=\"" + esc(p) + "\"/>\n" : "") + "    </item>";
});
fs.writeFileSync("feed.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">\n  <channel>\n' +
  "    <title>MIFASARW | Inkuru Yose Irambuye</title>\n    <link>" + SITE + "/</link>\n    <description>Inkuru zigezweho mu Rwanda no ku Isi, na Video za MIFASARW.</description>\n    <language>rw</language>\n" +
  (built ? "    <lastBuildDate>" + built + "</lastBuildDate>\n" : "") + '    <atom:link href="' + SITE + '/feed.xml" rel="self" type="application/rss+xml"/>\n' + out.join("\n") + "\n  </channel>\n</rss>\n");
console.log("feed: " + list.length + " items");
