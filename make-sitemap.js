/* MIFASA: builds sitemap.xml = the 2 main pages + one URL per story (s/<share_id>.html) from crawl-news.json and the permanent news-archive/.
   Run: node make-sitemap.js     Newest first, at most SITEMAP_MAX_STORIES (default 2000; Google allows 50,000). Same input = same file (no useless commits). */
const fs = require("fs");
const SITE = "https://mifasarw.neocities.org", MAX = Number(process.env.SITEMAP_MAX_STORIES || 2000);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const read = f => { try { const j = JSON.parse(fs.readFileSync(f, "utf8")); return Array.isArray(j) ? j : (j.articles || j.items || []); } catch (e) { return []; } };
let all = read("crawl-news.json");
try { fs.readdirSync("news-archive").filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, 120).forEach(f => { all = all.concat(read("news-archive/" + f)); }); } catch (e) {}
const seen = new Set(), stories = [];
const hasPage = id => fs.existsSync("s/" + id + ".html");   // only list stories whose static page exists
all.forEach(a => {
  const id = a && a.share_id ? String(a.share_id) : ""; if (!id || !hasPage(id) || seen.has(id) || !(a.title || a.title_rw || a.title_en)) return; seen.add(id);
  const t = new Date(a.date || a.published || a.created_at || 0).getTime() || 0; stories.push({ id, t });
});
stories.sort((a, b) => b.t - a.t);
const day = t => t ? new Date(t).toISOString().slice(0, 10) : "";
const newest = stories.length ? day(stories[0].t) : "";
const u = (loc, last, freq, pri) => "  <url><loc>" + esc(loc) + "</loc>" + (last ? "<lastmod>" + last + "</lastmod>" : "") + "<changefreq>" + freq + "</changefreq><priority>" + pri + "</priority></url>";
const lines = [u(SITE + "/", newest, "hourly", "1.0"), u(SITE + "/mifasa-ai.html", "", "weekly", "0.8")];
stories.slice(0, MAX).forEach(s => lines.push(u(SITE + "/s/" + encodeURIComponent(s.id) + ".html", day(s.t), "monthly", "0.5")));
fs.writeFileSync("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + lines.join("\n") + "\n</urlset>\n");
console.log("sitemap: " + (lines.length) + " urls (" + Math.min(stories.length, MAX) + " stories)");
