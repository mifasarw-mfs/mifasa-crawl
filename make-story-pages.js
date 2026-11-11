/* MIFASA: makes ONE static HTML page per story  ->  s/<share_id>.html   Run: node make-story-pages.js
   Why: WhatsApp / Facebook / X / Telegram do NOT run JavaScript. story.html sets its meta tags with JS, so a shared link shows
   the default title + logo. These pages have the real title, summary, photo and structured data written INSIDE the HTML.
   People who open one are sent on to story.html (full reader); bots read the meta tags and stop here.
   Sources: crawl-news.json + the permanent news-archive/*.json (newest data wins, one page per share_id).
   Only writes a page when it is missing or its content changed (so no useless commits/uploads).
   Newest stories first; at most STORY_PAGES_MAX pages written per run (default 400) - the backlog is finished in the next runs. */
const fs = require("fs");
const SITE = "https://mifasarw.neocities.org", DIR = "s", DEF_IMG = SITE + "/og-default.jpg", MAX = Number(process.env.STORY_PAGES_MAX || 400);
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = s => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const clip = (s, n) => { s = text(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const first = (...v) => { for (const x of v) { const t = text(x); if (t) return t; } return ""; };
const read = f => { try { const j = JSON.parse(fs.readFileSync(f, "utf8")); return Array.isArray(j) ? j : (j.articles || j.items || []); } catch (e) { return []; } };
const ts = a => new Date(a.date || a.publish || a.published || a.created_at || 0).getTime() || 0;

let all = read("crawl-news.json");
try { fs.readdirSync("news-archive").filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().forEach(f => { all = all.concat(read("news-archive/" + f)); }); } catch (e) {}
const seen = new Set(), stories = [];
all.forEach(a => {
  const id = a && a.share_id ? String(a.share_id).trim() : "";
  if (!/^[A-Za-z0-9_.-]{3,120}$/.test(id) || id[0] === "." || seen.has(id)) return;   // safe file names only
  seen.add(id); stories.push({ id, a, t: ts(a) });
});
stories.sort((x, y) => y.t - x.t);

function imageOf(a, vid) {
  let p = String(a.image || a.thumbnail || a.featured_image || a.img || a.picture || "").trim();
  if (p.startsWith("//")) p = "https:" + p;
  if (p && !/^https?:\/\//i.test(p) && !p.startsWith("data:")) p = SITE + "/" + p.replace(/^\/+/, "");
  if (/^https:\/\//i.test(p)) return p;                       // social sites want https
  return vid ? "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg" : DEF_IMG;
}
function page(id, a) {
  const en = a.lang === "en" || (!a.title_rw && !a.title && !!a.title_en), L = en ? "en" : "rw", O = en ? "rw" : "en";
  const title = clip(first(a["title_" + L], a["title_" + O], a.title, a.name) || "MIFASARW", 140);
  const sum = first(a["summary_" + L], a["summary_" + O], a.summary, a.desc);
  const body = first(a["full_content_" + L], a["content_" + L], a.full_content_rw, a.content, a.full_content_en);
  const desc = clip(sum || body || title, 200);
  let vid = a.video && /^[\w-]{11}$/.test(a.video.id || "") ? a.video.id : "";
  if (!vid) { const m = /(?:youtu\.be\/|[?&]v=|embed\/)([\w-]{11})/.exec(String(a.link || a.url || "")); vid = m ? m[1] : ""; }
  const img = imageOf(a, vid), url = SITE + "/" + DIR + "/" + encodeURIComponent(id) + ".html", full = SITE + "/story.html?news=" + encodeURIComponent(id);
  const d = new Date(a.date || a.publish || a.published || a.created_at || 0), iso = isNaN(d.getTime()) || d.getTime() === 0 ? "" : d.toISOString();
  const cat = first(a.category, a.cat), src = first(a.source).replace(/ YouTube$/i, "");
  const kw = Array.isArray(a.seo_keywords) ? a.seo_keywords.join(", ") : first(a.seo_keywords, a.keywords);
  const ld = { "@context": "https://schema.org", "@type": "NewsArticle", headline: title.slice(0, 110), description: desc, image: [img], inLanguage: L, mainEntityOfPage: url,
    author: { "@type": "Person", name: "MIFASA Mizero Fabrice Samuel" }, publisher: { "@type": "Organization", name: "MIFASARW", url: SITE } };
  if (iso) { ld.datePublished = iso; ld.dateModified = iso; }
  if (vid) ld.video = { "@type": "VideoObject", name: title.slice(0, 110), description: desc || title, thumbnailUrl: [img], embedUrl: "https://www.youtube.com/embed/" + vid, contentUrl: "https://www.youtube.com/watch?v=" + vid, inLanguage: L, ...(iso ? { uploadDate: iso } : {}) };
  const m = (k, v, attr) => '<meta ' + (attr || "property") + '="' + k + '" content="' + esc(v) + '">';
  const T = en ? { read: "Read the full story", src: "Source", open: "Opening the full story…" } : { read: "Soma inkuru yose", src: "Isoko", open: "Turakujyana ku nkuru yose…" };
  return '<!DOCTYPE html>\n<html lang="' + L + '">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "<title>" + esc(title) + " | MIFASARW</title>\n" +
    m("description", desc, "name") + "\n" + (kw ? m("keywords", kw, "name") + "\n" : "") +
    m("author", "MIFASA Mizero Fabrice Samuel", "name") + "\n" + m("robots", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1", "name") + "\n" +
    '<link rel="canonical" href="' + esc(url) + '">\n<link rel="icon" type="image/png" href="' + SITE + '/favicon.png">\n' +
    m("og:type", vid ? "video.other" : "article") + "\n" + m("og:site_name", "MIFASARW") + "\n" + m("og:title", title) + "\n" + m("og:description", desc) + "\n" +
    m("og:image", img) + "\n" + m("og:image:alt", title) + "\n" + m("og:url", url) + "\n" + m("og:locale", en ? "en_US" : "rw_RW") + "\n" +
    (iso ? m("article:published_time", iso) + "\n" : "") + (cat ? m("article:section", cat) + "\n" : "") +
    (vid ? m("og:video", "https://www.youtube.com/embed/" + vid) + "\n" + m("og:video:secure_url", "https://www.youtube.com/embed/" + vid) + "\n" + m("og:video:type", "text/html") + "\n" + m("og:video:width", "1280") + "\n" + m("og:video:height", "720") + "\n" : "") +
    m("twitter:card", "summary_large_image", "name") + "\n" + m("twitter:title", title, "name") + "\n" + m("twitter:description", desc, "name") + "\n" + m("twitter:image", img, "name") + "\n" +
    '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>\n" +
    "<style>body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f4f4f6;color:#1a1a1f}main{max-width:720px;margin:0 auto;padding:18px}" +
    "article{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px #0001}article img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#ddd}" +
    ".b{padding:18px}h1{font-size:1.4rem;line-height:1.3;margin:.2em 0 .5em}.meta{font-size:.85rem;color:#666}.btn{display:inline-block;margin-top:14px;background:#e63946;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600}</style>\n" +
    "</head>\n<body>\n<main>\n<article>\n" + '<img src="' + esc(img) + '" alt="' + esc(title) + '" referrerpolicy="no-referrer">\n<div class="b">\n' +
    (cat || src ? '<div class="meta">' + esc([cat, src ? T.src + ": " + src : ""].filter(Boolean).join(" · ")) + "</div>\n" : "") +
    "<h1>" + esc(title) + "</h1>\n" + (iso ? '<div class="meta"><time datetime="' + iso + '">' + iso.slice(0, 10) + "</time></div>\n" : "") +
    (sum ? "<p>" + esc(sum) + "</p>\n" : "") + (body && body !== sum ? "<p>" + esc(clip(body, 1500)) + "</p>\n" : "") +
    '<a class="btn" id="go" href="' + esc(full) + '&amp;lang=' + L + '">' + T.read + "</a>\n</div>\n</article>\n</main>\n" +
    // people go straight to the full reader (keeps ?lang=); bots never run this, they read the tags above
    "<script>(function(){try{var l=new URLSearchParams(location.search).get('lang')||'" + L + "',u=" + JSON.stringify(full) + "+'&lang='+encodeURIComponent(l);document.getElementById('go').href=u;location.replace(u)}catch(e){}})()</script>\n" +
    "</body>\n</html>\n";
}
fs.mkdirSync(DIR, { recursive: true });
let made = 0, same = 0, left = 0;
for (const s of stories) {
  const f = DIR + "/" + s.id + ".html", html = page(s.id, s.a);
  let old = ""; try { old = fs.readFileSync(f, "utf8"); } catch (e) {}
  if (old === html) { same++; continue; }
  if (made >= MAX) { left++; continue; }
  fs.writeFileSync(f, html); made++;
}
console.log("story pages: " + made + " written, " + same + " unchanged, " + left + " waiting for next run (" + stories.length + " stories)");
