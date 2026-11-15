// ========================================================== //
// MIFASA SYSTEMS 4 - ADVANCED AI ENGINE EDITION
// Merged Engine + RAG Knowledge Extraction + AI Responder
// Languages: Kinyarwanda (rw) & English (en)
// v4.1 PATCH: safeHref (blocks javascript:), safer image URLs, link-rewrite fix,
//   private-host/IPv6 blocklist + redirect check + body size cap in link reader,
//   query length caps, validated siteLang, clickable https links in AI answers,
//   MifasaAI.runTests() for mifasa_tests.json.
// ========================================================== //

/* ---------------------------------------------------------- */
/* WRAPPER: script.js ikora mu "IIFE" kugira ngo idasekura (SyntaxError)  */
/* izindi nyandiko z'urupapuro (story.html ifite currentLang yayo bwite). */
/* Ku rupapuro rusanzwe (index.html...) ibikenewe byose byoherezwa ku    */
/* "window" hasi. Ku rupapuro rufite window.MIFASA_API_ONLY = true        */
/* (search.html, story.html) hakora gusa window.MifasaAI.                 */
/* ---------------------------------------------------------- */
(function () {
const MIFASA_API_ONLY = !!(typeof window !== "undefined" && window.MIFASA_API_ONLY);

/* ---------------------------------------------------------- */
/* 1. THEME, SIZE & DARK MODE MANAGEMENT                      */
/* ---------------------------------------------------------- */

const MIFASA_THEMES = [
  "mifasastyle", "gold", "grow", "shine", "ocean", "forest",
  "sunset", "neon", "pastel", "cyberpunk", "rainbow"
];

function changeTheme(themeName) {
  if (!MIFASA_THEMES.includes(themeName)) themeName = "mifasastyle";
  if (document.body) {
    document.body.classList.remove(...MIFASA_THEMES);
    document.body.classList.add(themeName);
  }
}

/* ---------------------------------------------------------- */
/* 2. LANGUAGE ENGINE & URL PARAMETER HANDLING                */
/* ---------------------------------------------------------- */

/* Ururimi rwa mbere: iyo umuntu ataraduhitiramo (nta siteLang), tuzikura kuri telefone ye.
   Kinyarwanda (rw/kin) cyangwa ari muri Kigali (isaha Africa/Kigali) -> rw, ibindi byose -> en. Icyo yahisemo ubwe gihora imbere. */
function mifasaDetectLang() {
  try {
    var saved = localStorage.getItem("siteLang");
    if (saved === "en" || saved === "rw") return saved;
  } catch (e) {}
  try {
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""]).map(function (l) { return String(l).toLowerCase(); });
    if (langs.some(function (l) { return /^(rw|kin)(-|$)/.test(l); })) return "rw";
    var tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    if (tz === "Africa/Kigali") return "rw";
    return "en";
  } catch (e) { return "rw"; }
}
let currentLang = mifasaDetectLang();

function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

function setLanguage(lang, reload = true) {
  if (lang !== "rw" && lang !== "en") lang = "rw";
  localStorage.setItem("siteLang", lang);
  currentLang = lang;

  const url = new URL(window.location.href);
  if (url.searchParams.get("lang") !== lang) {
    url.searchParams.set("lang", lang);
    window.history.pushState({}, "", url);
  }

  if (reload) {
    location.reload();
  } else {
    document.documentElement.lang = currentLang;
    if (typeof updateAllLinksWithLang === "function") updateAllLinksWithLang();
  }
}

function getTitle(article) {
  if (!article) return "";
  if (currentLang === "en") {
    return article.title_en || article.title_rw || article.title || "";
  }
  return article.title_rw || article.title || "";
}

function getSummary(article) {
  if (!article) return "";
  if (currentLang === "en") {
    return article.summary_en || article.summary_rw || article.summary || "";
  }
  return article.summary_rw || article.summary || "";
}

function generateSlug(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function updateAllLinksWithLang() {
  const links = document.querySelectorAll("a[href*='story']");
  links.forEach(link => {
    try {
      const hrefAttr = link.getAttribute("href");
      if (hrefAttr) {
        const url = new URL(hrefAttr, window.location.href);
        // only our own story pages: external links containing the word "story" must stay untouched
        if (url.origin !== window.location.origin) return;
        if (!/(^|\/)story/i.test(url.pathname)) return;
        url.searchParams.set("lang", currentLang);
        link.setAttribute("href", url.pathname + url.search + url.hash);
      }
    } catch (e) {}
  });
}

/* ---------------------------------------------------------- */
/* 3. GLOBAL VARIABLES & DOM ELEMENTS                         */
/* ---------------------------------------------------------- */

let allNews = [];
let hotIndex = 0;
let trendWords = [];
let trendIndex = 0;
let newsIndex = 0;
let searchTimeout;
let mifasaRenderedCount = 0;
let mifasaScrollObserver = null;

const mifasaEl = id => (MIFASA_API_ONLY ? null : document.getElementById(id));
const input = mifasaEl("searchInput");
const suggestions = mifasaEl("suggestions");
const results = mifasaEl("searchResults");
const noResultsMsg = mifasaEl("noResultsMsg");
const trendBox = mifasaEl("trendBox");
const tickerContent = mifasaEl("tickerContent");
const newsText = mifasaEl("newsText");
const latestNewsBox = mifasaEl("latestNews");
const hotImage = mifasaEl("hotImage");
const hotTitle = mifasaEl("hotTitle");
const hotSummary = mifasaEl("hotSummary");

const MIFASA_SITE_URL = "https://mifasarw.neocities.org";
const MIFASA_CACHE_PREFIX = "mifasa_json_v4_";
const MIFASA_CACHE_TTL = 1000 * 60 * 5; // re-check files at most every 5 minutes
const MIFASA_FETCH_TIMEOUT = 6000;
const MIFASA_PAGE_SIZE = 12;

/* ---------------------------------------------------------- */
/* 4. SAFE HELPERS                                             */
/* ---------------------------------------------------------- */

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeUrl(url) {
  if (!url) return "";
  const value = String(url).trim();

  // small inline images are fine; any other data: (text/html, svg+xml with scripts...) is not
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(value)) return value;

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("//")
  ) {
    return value;
  }

  // any other scheme (javascript:, vbscript:, data:text/html ...) is refused
  if (/^[a-z][a-z0-9+.\-]*:/i.test(value)) return `${MIFASA_SITE_URL}/default.jpg`;

  return `${MIFASA_SITE_URL}/${value.replace(/^\/+/, "")}`;
}

// Returns the link only when it is http(s) or a relative path. Blocks javascript:, data:, vbscript: ...
function safeHref(url, fallback) {
  const fb = fallback === undefined ? "#" : fallback;
  if (url == null) return fb;
  const value = String(url).trim();
  if (!value) return fb;
  try {
    // fixed https base: relative links stay "relative = ok", whatever protocol the page itself was opened with
    const u = new URL(value, MIFASA_SITE_URL + "/");
    return (u.protocol === "https:" || u.protocol === "http:") ? value : fb;
  } catch (e) { return fb; }
}

function getFileBaseName(sourceFile) {
  return String(sourceFile || "news")
    .split("/")
    .pop()
    .replace(/\.json$/i, "");
}

function getArticleCategory(article, sourceFile) {
  return (
    article?.category ||
    article?.cat ||
    getFileBaseName(sourceFile) ||
    "news"
  );
}

function getArticleId(article) {
  return String(
    article?.share_id ||
    article?.id ||
    article?.slug ||
    generateSlug(article?.title_rw || article?.title_en || article?.title || "") ||
    Math.random().toString(36).slice(2, 11)
  );
}

/* ---------------------------------------------------------- */
/* 5. DATA NORMALIZER + UNIVERSAL EXTRACTOR                   */
/* ---------------------------------------------------------- */

const MIFASA_NO_SUMMARY = "Nta nshamake itanzwe.";

// Keys never indexed as free text (already handled as fields, or private/technical)
const MIFASA_SKIP_KEYS = new Set([
  "title", "title_rw", "title_en", "name", "headline", "caption",
  "summary", "summary_rw", "summary_en", "image", "thumbnail", "avatar",
  "featured_image", "link", "url", "slug", "id", "share_id", "publish",
  "date", "created_at", "video", "audio", "source", "category", "cat",
  "seo_keywords", "keywords", "tags", "question", "q", "answer", "a"
]);
const MIFASA_PRIVATE_KEY_RE = /pass|pwd|mail|phone|tel\b|token|secret|api_?key|address|^ip$|birth/i;

// Pulls every readable sentence out of an item (nested sections, arrays, *_rw / *_en fields)
// so the AI can use the FULL content of every JSON, not only title + summary.
function collectBodyText(value, state, depth) {
  if (state.left <= 0 || depth > 4 || value == null) return;
  if (typeof value === "string") {
    const s = value.trim();
    if (s.length < 3) return;
    if (/^(https?:|data:|\/\/|\/)/i.test(s)) return;
    if (s.length > 60 && !/\s/.test(s)) return;           // base64 / tokens / long ids
    const piece = s.length > state.left ? s.slice(0, state.left) : s;
    state.parts.push(piece);
    state.left -= piece.length + 1;
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length && i < 60 && state.left > 0; i++) collectBodyText(value[i], state, depth + 1);
  } else if (typeof value === "object") {
    for (const k in value) {
      if (state.left <= 0) break;
      if (MIFASA_SKIP_KEYS.has(k) || MIFASA_PRIVATE_KEY_RE.test(k)) continue;
      collectBodyText(value[k], state, depth + 1);
    }
  }
}

function normalizeArticle(item, sourceFile) {
  if (!item || typeof item !== "object") return null;

  const question = item.question || item.q || item.prompt || "";
  const answer = item.answer || item.a || item.response || item.reply || "";

  const title =
    item.title_rw ||
    item.title_en ||
    item.title ||
    item.name ||
    item.headline ||
    item.caption ||
    (typeof question === "string" ? question : "");

  if (!title || typeof title !== "string" || title.trim() === "") return null;

  const summary =
    item.summary_rw ||
    item.summary_en ||
    item.summary ||
    item.desc ||
    item.description ||
    item.bio ||
    item.excerpt ||
    (typeof answer === "string" && answer) ||
    MIFASA_NO_SUMMARY;

  let image =
    item.thumbnail ||
    item.image ||
    item.avatar ||
    item.featured_image ||
    "default.jpg";

  image = normalizeUrl(image);

  let keywords = item.seo_keywords || item.keywords || item.tags || [];
  if (!Array.isArray(keywords)) keywords = [String(keywords)];
  else keywords = keywords.slice();

  if (item.link) keywords.push(String(item.link));

  const cleanSource = getFileBaseName(sourceFile);
  const shareId = getArticleId(item);
  const category = getArticleCategory(item, sourceFile);
  const titleSlug = item.slug || generateSlug(title);

  const generatedLink =
    `story.html?news=${encodeURIComponent(shareId)}` +
    `&cat=${encodeURIComponent(category)}` +
    `&lang=${encodeURIComponent(currentLang)}` +
    `&title=${encodeURIComponent(titleSlug)}`;

  // Full-text body for the AI (skipped for user/profile files: they are never answer material)
  let body = "";
  if (!/^users?\d*$/i.test(cleanSource)) {
    const state = { parts: [], left: 6000 };
    collectBodyText(item, state, 0);
    body = state.parts.join(". ");
  }

  return {
    ...item,
    title_rw: item.title_rw || title,
    title_en: item.title_en || title,
    summary_rw: item.summary_rw || summary,
    summary_en: item.summary_en || summary,
    keywords,
    share_id: shareId,
    id: item.id || shareId,
    source: item.source || cleanSource,
    category,
    image,
    thumbnail: normalizeUrl(item.thumbnail || item.image || image),
    link: safeHref(item.link, "") || generatedLink,
    slug: titleSlug,
    _sourceFile: sourceFile || cleanSource,
    _external: /^crawl-news$/i.test(cleanSource),
    _knowledge: /^crawl-knowledge$/i.test(cleanSource),   // Wikipedia entries from crawl-knowledge.js: the AI answers from them; never shown as news   // from crawl.js: kept for the AI + the crawl box, kept OUT of the home hot-news / latest grid
    _body: body,
    _ans: typeof answer === "string" ? answer.slice(0, 800) : "",
    _ts: Date.parse(item.publish || item.date || item.created_at || "") || 0
  };
}

function extractItemsFromJSON(obj, targetArray, depth = 0) {
  if (!obj || depth > 14) return;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) extractItemsFromJSON(obj[i], targetArray, depth + 1);
  } else if (typeof obj === "object") {
    if (
      obj.title_rw ||
      obj.title_en ||
      obj.title ||
      obj.name ||
      obj.headline ||
      obj.caption ||
      (typeof obj.question === "string" && obj.question) ||
      (typeof obj.q === "string" && obj.q)
    ) {
      targetArray.push(obj);
    } else {
      for (const key in obj) extractItemsFromJSON(obj[key], targetArray, depth + 1);
    }
  }
}

function removeDuplicates(newsArray) {
  const seen = new Set();

  return newsArray.filter(article => {
    const identifier =
      article.share_id ||
      article.id ||
      `${article.category}|${article.title_rw || article.title_en}`;

    if (seen.has(identifier)) return false;
    seen.add(identifier);
    return true;
  });
}

/* ---------------------------------------------------------- */
/* 6. DATA LAYER: instant start, background refresh           */
/* ---------------------------------------------------------- */

const MIFASA_JSON_FILES = [
"binance-hack.json","techresearch.json","Gsrwimiyaga.json","techmfs.json","mifasa_research-pys.json","Pn25-09_26.json","politicsresearch2026-09-24.json", "politicsresearch2026-09-24", "Ent_2026-09-24.json", "politics_2026-09-24.json",
  "27aug2026sports.json", "googlerecovery.json", "history2.json",
  "mifasa_research_psychology.json", "politics_2026-08-10.json", "data.json",
  "web.json", "users2.json", "politics.json", "sports.json", "education.json",
  "ai.json", "ai2json.json", "ai3.json", "ai4.json", "ai5.json", "ai6.json", "ai7.json", "ai8.json", "ai9.json", "ai10.json", "ai11.json", "ai12.json", "ai13.json", "ai14.json", "ai15.json", "ai16.json", "ai17.json", "ai18.json", "ai_photos.json", "ai_core.json", "crawl-news.json", "crawl-knowledge.json", "trending.json", "research.json", "trendnow.json", "aichat.json",
  "eastafrica.json", "rwatech.json", "users.json", "mifasarwphysicsstudy.json",
  "mifasarwhistorystudy.json", "mifasarwgeographystudy.json", "mifasarwourworld.json",
  "history.json", "health.json", "technology.json", "psychology.json",
  "mfs1.json", "mfs2.json", "mfs3.json", "mfs4.json", "mfs5.json",
  "mfs6.json", "mfs7.json", "mfs8.json", "mfs9.json", "mfs10.json",
  "mfs11.json", "mfs12.json", "mfs13.json", "mfs14.json", "mfs15.json",
  "mfs16.json", "mfs17.json", "mfs18.json"
];

const MIFASA_MANIFEST_FILES = [
  "json-manifest.json", "manifest.json", "data-manifest.json"
];

const MIFASA_MISSING_TTL = 1000 * 60 * 60 * 6;   // don't re-ask for files that returned 404 for 6h
const MIFASA_POOL_SIZE = 8;

let mifasaLoaded = false;
let mifasaPainted = false;
let mifasaUISig = "";
let mifasaFileOrder = [];
const mifasaFileArticles = new Map();

function readLS(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

/* ---- IndexedDB cache (big, async, does not block the page like localStorage) ---- */
let mifasaDBPromise = null;
function mifasaDB() {
  if (mifasaDBPromise) return mifasaDBPromise;
  mifasaDBPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open("mifasa_cache_v5", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return mifasaDBPromise;
}

async function idbGetAll() {
  const db = await mifasaDB();
  if (!db) return {};
  return new Promise(resolve => {
    const out = {};
    try {
      const req = db.transaction("files", "readonly").objectStore("files").openCursor();
      req.onsuccess = e => {
        const cur = e.target.result;
        if (cur) { out[cur.key] = cur.value; cur.continue(); } else resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch (e) { resolve(out); }
  });
}

async function idbSet(file, record) {
  const db = await mifasaDB();
  if (!db) return;
  try { db.transaction("files", "readwrite").objectStore("files").put(record, file); } catch (e) {}
}

/* ---- Network ---- */
async function fetchWithTimeout(url, timeout = MIFASA_FETCH_TIMEOUT, cacheMode = "default") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: cacheMode,
      headers: { "Accept": "application/json" }
    });
  } finally {
    clearTimeout(timer);
  }
}

// Fetches one file. If the server says it is unchanged (same ETag / Last-Modified) the body is
// never parsed, so background refreshes cost almost nothing.
async function fetchFileRecord(file, prev, mode) {
  try {
    const res = await fetchWithTimeout(file, MIFASA_FETCH_TIMEOUT, mode);
    if (!res.ok) return { file, failed: true, status: res.status };
    const etag = res.headers.get("etag") || "";
    const lm = res.headers.get("last-modified") || "";
    const len = res.headers.get("content-length") || "";
    if (prev && prev.data && (
      (etag && etag === prev.etag) ||
      (!etag && lm && lm === prev.lm && len === prev.len)
    )) {
      return { file, unchanged: true };
    }
    const data = await res.json();
    return { file, changed: true, record: { time: Date.now(), data, etag, lm, len } };
  } catch (e) {
    return { file, failed: true, status: 0 };
  }
}

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// All manifests are asked in parallel with a short timeout (before: one after another).
async function discoverJSONFiles() {
  const lists = await Promise.all(MIFASA_MANIFEST_FILES.map(async f => {
    try {
      const res = await fetchWithTimeout(f, 3000, "default");
      if (!res.ok) return [];
      const manifest = await res.json();
      const list = Array.isArray(manifest) ? manifest : manifest.json_files || manifest.files || [];
      return Array.isArray(list) ? list.filter(x => typeof x === "string" && /\.json$/i.test(x)) : [];
    } catch (e) { return []; }
  }));
  return [...new Set(lists.flat())];
}

/* ---- Ingest ---- */
function ingestFile(file, data) {
  if (/^ai_core(?:json)?$/i.test(getFileBaseName(file)) && typeof mifasaCoreLoad === "function" && mifasaCoreLoad(data)) {   // ai_core.json = understanding layer
    mifasaFileArticles.set(file, []);
    return;
  }
  if (mifasaIsBrainFile(file) && mifasaBrainLoad(data, file)) {   // ai*.json = modular AI brain files
    mifasaFileArticles.set(file, []);
    return;
  }
  const raw = [];
  extractItemsFromJSON(data, raw);
  const arr = [];
  for (let i = 0; i < raw.length; i++) {
    const a = normalizeArticle(raw[i], file);
    if (a) arr.push(a);
  }
  mifasaFileArticles.set(file, arr);
}

function rebuildAllNews() {
  let all = [];
  mifasaFileOrder.forEach(f => {
    const arr = mifasaFileArticles.get(f);
    if (arr) for (let i = 0; i < arr.length; i++) all.push(arr[i]);
  });
  all = removeDuplicates(all);
  all.sort((a, b) => b._ts - a._ts);
  allNews = all;
  if (typeof MifasaIndex !== "undefined") MifasaIndex.dirty = true;
}

function mifasaPaintSignature() {
  return allNews.length + "|" + allNews.slice(0, 12).map(a => a.share_id).join(",");
}

function paintUI(force) {
  if (MIFASA_API_ONLY) return;
  const sig = mifasaPaintSignature();
  if (!force && mifasaPainted && sig === mifasaUISig) return;
  mifasaUISig = sig;
  mifasaPainted = true;
  trendWords = [];
  trendIndex = 0;
  startTrending();
  loadTicker();
  loadDailyNews();
  loadHotNews();
  loadLatestNews();
  if (typeof mifasaPaintCrawlBox === "function") mifasaPaintCrawlBox();
}

function scheduleIndexBuild() {
  const run = () => { try { ensureIndex(); } catch (e) { console.warn("Index build failed", e); } };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 400 });
  else setTimeout(run, 30);
}

function onDataReady() {
  rebuildAllNews();
  mifasaLoaded = true;
  paintUI();
  mifasaNotify();
  scheduleIndexBuild();
  // user typed before data was ready? answer now
  if (input && input.value.trim().length >= 2) setTimeout(() => { doSearch(); }, 0);
}

/* ---------------------------------------------------------- */
/* 7. DATA INITIALIZATION ENGINE                              */
/* ---------------------------------------------------------- */

async function loadSearchData() {
  const t0 = performance.now();
  const storedManifest = readLS("mifasa_manifest_files_v5", []);
  const baseFiles = [...new Set([...MIFASA_JSON_FILES, ...storedManifest])];
  mifasaFileOrder = baseFiles.slice();

  const manifestPromise = discoverJSONFiles();   // runs in parallel with everything below
  const cache = await idbGetAll();

  // PHASE 1: paint instantly from the on-device cache
  let cachedCount = 0;
  baseFiles.forEach(f => {
    const rec = cache[f];
    if (rec && rec.data) { ingestFile(f, rec.data); cachedCount++; }
  });
  if (cachedCount) {
    onDataReady();
    console.log(`⚡ MIFASA ready from cache in ${Math.round(performance.now() - t0)}ms (${allNews.length} items)`);
  }

  // PHASE 2: refresh in the background
  const discovered = await manifestPromise;
  if (discovered.length) writeLS("mifasa_manifest_files_v5", discovered);
  const files = [...new Set([...baseFiles, ...discovered])];
  mifasaFileOrder = files.slice();

  let changed = 0;
  // cached files that only the manifest knows about
  files.forEach(f => {
    if (!mifasaFileArticles.has(f) && cache[f] && cache[f].data) { ingestFile(f, cache[f].data); changed++; }
  });

  const missing = readLS("mifasa_missing_v5", {});
  const now = Date.now();
  const todo = files.filter(f => {
    if (missing[f] && now - missing[f] < MIFASA_MISSING_TTL) return false;
    const rec = cache[f];
    return !rec || !rec.data || now - rec.time > MIFASA_CACHE_TTL;
  });

  const mode = cachedCount ? "no-cache" : "default";
  let ingestedFresh = 0;

  await runPool(todo, MIFASA_POOL_SIZE, async f => {
    const res = await fetchFileRecord(f, cache[f], mode);
    if (res.failed) {
      if (res.status === 404 || res.status === 403) missing[f] = Date.now();
      return;
    }
    if (res.changed) {
      ingestFile(f, res.record.data);
      idbSet(f, res.record);
      cache[f] = res.record;
      changed++;
      ingestedFresh++;
      // first ever visit: show something as soon as a handful of files arrived
      if (!cachedCount && !mifasaLoaded && ingestedFresh >= 6) onDataReady();
    }
  });

  writeLS("mifasa_missing_v5", missing);

  if (changed > 0 || !mifasaLoaded) {
    rebuildAllNews();
    mifasaLoaded = true;
    paintUI();                 // only repaints if the visible content really changed
    scheduleIndexBuild();
    mifasaNotify();
    if (input && input.value.trim().length >= 2) doSearch();
  }

  // free the old 5MB localStorage cache once
  try {
    Object.keys(localStorage).filter(k => k.startsWith(MIFASA_CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
  } catch (e) {}

  mifasaNotify(true);          // release anyone waiting (even if there was nothing new)
  console.log(`🚀 MIFASA V5 AI ENGINE READY: ${allNews.length} items, ${files.length} sources, ${Math.round(performance.now() - t0)}ms`);
}

/* ---------------------------------------------------------- */
/* 8. AUDIO READER ENGINE                                     */
/* ---------------------------------------------------------- */

function playArticleAudio(text, lang = "rw") {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || ""));
    utterance.lang = lang === "en" ? "en-US" : "rw-RW";
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  } else {
    alert(currentLang === "en" ? "Speech not supported" : "Browser ntishobora gusoma ijwi");
  }
}

function toggleAudio(share_id) {
  const article = allNews.find(a => String(a.share_id) === String(share_id));
  if (!article) return;
  const textToRead = `${getTitle(article)}. ${getSummary(article)}`;
  playArticleAudio(textToRead, currentLang);
}

/* ---------------------------------------------------------- */
/* 9. ADVANCED MIFASA AI INTELLIGENCE & REASONING ENGINE       */
/* ---------------------------------------------------------- */

const MIFASA_STOP_WORDS = new Set([
  "cyane", "kandi", "muri", "ariko", "niba", "ubwo", "iki", "izo",
  "nyuma", "mbere", "hano", "about", "after", "their", "which",
  "from", "with", "this", "that", "what", "when", "where", "ninde",
  "shaka", "baza", "niyompamvu", "gusa",
  // Kinyarwanda function words and request verbs
  "ni", "na", "mu", "ku", "kuri", "ya", "wa", "ba", "bya", "cya", "rya", "za",
  "iyo", "ibyo", "icyo", "uko", "aho", "kuko", "kugira", "ngo", "cyangwa", "nta",
  "ese", "none", "ubu", "mbwira", "mbwirire", "sobanura", "sobanurira", "nsobanurire",
  "erekana", "nyereka", "gute", "ibi", "iyi", "uyu", "uwo", "abo", "bo", "wowe",
  "njye", "ndashaka", "nshaka", "nifuza", "umbwire", "umbaze", "ibindi",
  // English function words and request verbs
  "the", "is", "are", "was", "were", "of", "an", "to", "in", "on", "for", "and",
  "or", "how", "why", "who", "tell", "me", "explain", "show", "give", "please",
  "can", "you", "do", "does", "it", "be", "by", "at", "as", "my", "your",
  "know", "want", "need", "some", "any", "there", "have", "has", "more",
  "many", "much", "did", "will", "would", "could", "should", "use", "used",
  // question words
  "uwuhe", "iyihe", "ihe", "ayahe", "ryari", "bangahe", "angahe", "ingahe", "zingahe", "kuki"
]);

function tokenize(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bk[\s-]pop\b/g, "kpop")     // "k-pop" is one word
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    const curr = [i];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[bl];
}

function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length > 2 && b.startsWith(a)) return 0.9;
  if (b.length > 2 && a.startsWith(b)) return 0.9;

  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  const sim = 1 - dist / maxLen;
  return sim >= 0.6 ? sim : 0;
}

/* ---- Bilingual synonym groups (Kinyarwanda <-> English <-> related words) ---- */
const MIFASA_SYNONYM_GROUPS = [
  ["politiki", "politics", "political", "leta", "government", "perezida", "president", "amatora", "election"],
  ["ubuzima", "health", "indwara", "disease", "kwivuza", "medical", "muganga", "doctor", "ibitaro", "hospital"],
  ["siporo", "sports", "sport", "umupira", "football", "soccer", "imikino", "game", "amavubi"],
  ["ikoranabuhanga", "technology", "tech", "digital", "mudasobwa", "computer", "murandasi", "internet"],
  ["ai", "ubwenge", "intelligence", "artificial", "robot", "machine", "learning"],
  ["amateka", "history", "historical", "kera", "ancient", "past"],
  ["uburezi", "education", "school", "amashuri", "ishuri", "student", "umunyeshuri", "kwiga", "learn", "study"],
  ["ubukungu", "economy", "economic", "business", "amafaranga", "money", "ubucuruzi", "trade", "finance"],
  ["imitekerereze", "psychology", "mental", "umutwe", "mind", "feelings", "amarangamutima", "emotion"],
  ["siyansi", "science", "scientific", "ubumenyi", "research", "ubushakashatsi", "study"],
  ["fiziki", "physics", "physical", "energy", "ingufu", "force", "imbaraga"],
  ["geografiya", "geography", "imiterere", "map", "ikarita", "climate", "ikirere", "weather"],
  ["isi", "world", "global", "mpuzamahanga", "international", "planet"],
  ["afurika", "africa", "african", "uburasirazuba", "east", "eac", "eastafrica"],
  ["rwanda", "urwanda", "rwandan", "umunyarwanda", "kigali"],
  ["inkuru", "news", "story", "article", "amakuru", "report"],
  ["umuco", "culture", "cultural", "imiyoborere", "tradition", "gakondo"],
  ["ubuhinzi", "agriculture", "farming", "farm", "ubworozi", "crop", "igihingwa"],
  ["umutekano", "security", "safety", "peace", "amahoro", "army", "ingabo"],
  ["gukira", "recovery", "restore", "google", "kugarura", "kugarura"]
];

/* ---- "latest / newest / trending" intent: sort by freshness instead of only relevance ---- */
const MIFASA_LATEST_SRC = "(?:amakuru mashya|inkuru nshya|inkuru zigezweho|amakuru agezweho|ibigezweho|bigezweho|vuba aha|bya vuba|latest news|latest|newest|most recent|recent|what's new|what is new|whats new|new stories|trending)";
const MIFASA_LATEST_RE = new RegExp("\\b" + MIFASA_LATEST_SRC + "\\b");
const MIFASA_LATEST_G = new RegExp("\\b" + MIFASA_LATEST_SRC + "\\b", "g");

function splitLatestIntent(value) {
  const norm = mifasaNorm(value);
  if (!MIFASA_LATEST_RE.test(norm)) return null;
  const rest = norm.replace(MIFASA_LATEST_G, " ").replace(/\s+/g, " ").trim();
  const topicTokens = indexTokens(rest);
  return { rest: topicTokens.length ? rest : "", label: topicTokens.join(" ") };
}

// topic given -> best matches re-ordered newest first; no topic -> the newest items overall
function mifasaLatestSearch(info, limit = 40) {
  if (info.rest) {
    const base = mifasaSearch(info.rest, 60);
    const hits = base.hits.slice().sort((a, b) => (b.article._ts || 0) - (a.article._ts || 0)).slice(0, limit);
    return { ...base, hits, latest: true, latestTopic: info.label || info.rest, topCoverage: 1 };
  }
  const hits = (typeof mifasaHomeNews === "function" ? mifasaHomeNews() : allNews).slice(0, limit).map(a => ({ article: a, score: 1, cov: 1 }));   // our own news; crawled news has its own box + tool
  return { hits, terms: [], termInfos: [], nTerms: 1, nEff: 1, corrected: "", topCoverage: 1, latest: true, latestTopic: "" };
}

// question words -> prefer sentences that actually contain the kind of fact being asked for
const MIFASA_Q_WHEN_RE = /\b(ryari|igihe|when|what year|mu mwaka|which year|date)\b/;
const MIFASA_Q_COUNT_RE = /\b(angahe|bangahe|zingahe|ingahe|how many|how much|number of|umubare)\b/;
const MIFASA_YEAR_RE = /\b(1[5-9]\d\d|20\d\d)\b/;
function questionBoost(qnorm, sentence) {
  if (!qnorm) return 0;
  if (MIFASA_Q_WHEN_RE.test(qnorm) && MIFASA_YEAR_RE.test(sentence)) return 2.5;
  if (MIFASA_Q_COUNT_RE.test(qnorm) && /\d/.test(sentence)) return 2.5;
  return 0;
}

const MIFASA_FOLLOWUP_RE = /^(ibindi|ongera|ndashaka ibindi|ibindi bisobanuro|more|tell me more|go on|continue|next|and\s?\?|na none)$/;

/* ---------------------------------------------------------- */
/* INVERTED INDEX + BM25 RANKING                              */
/* ---------------------------------------------------------- */

const MIFASA_BM25_K1 = 1.4;
const MIFASA_BM25_B = 0.72;
const MIFASA_FIELD_W = { title: 6, kw: 4, cat: 2, summary: 3, qa: 5, body: 1.2 };

const MifasaIndex = {
  dirty: true,
  built: false,
  N: 0,
  postings: new Map(),
  vocab: [],
  vocabByFirst: new Map(),
  lens: null,
  avgLen: 1,
  scores: null,
  termBest: null,
  mask: null,
  expCache: new Map(),
  queryCache: new Map(),
  synMap: null,
  docs: []
};

function indexTokens(text) {
  if (!text) return [];
  const out = [];
  const toks = tokenize(text);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.length < 2 || t.length > 28 || MIFASA_STOP_WORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

function buildSynonymMap() {
  const map = new Map();
  MIFASA_SYNONYM_GROUPS.forEach(group => {
    const toks = [...new Set(group.flatMap(g => tokenize(g)))];
    toks.forEach(t => {
      if (!map.has(t)) map.set(t, new Set());
      toks.forEach(o => { if (o !== t) map.get(t).add(o); });
    });
  });
  return map;
}

function buildSearchIndex() {
  const t0 = performance.now();
  const docs = allNews.concat(getCoreDocs());   // news from the files + what the AI knows by itself
  MifasaIndex.docs = docs;
  const N = docs.length;
  const postings = new Map();
  const lens = new Float32Array(N);
  let totalLen = 0;

  for (let i = 0; i < N; i++) {
    const a = docs[i];
    const tf = new Map();
    let len = 0;

    const add = (text, w) => {
      const toks = indexTokens(text);
      for (let k = 0; k < toks.length; k++) {
        tf.set(toks[k], (tf.get(toks[k]) || 0) + w);
      }
      len += toks.length;
      return toks;
    };

    const tTokens = add(a.title_rw, MIFASA_FIELD_W.title);
    if (a.title_en && a.title_en !== a.title_rw) {
      const te = add(a.title_en, MIFASA_FIELD_W.title);
      for (let k = 0; k < te.length; k++) tTokens.push(te[k]);
    }
    a._tnorm = " " + tTokens.join(" ") + " ";

    add((a.keywords || []).join(" "), MIFASA_FIELD_W.kw);
    add(friendlyCategory(a.category), MIFASA_FIELD_W.cat);
    if (a.summary_rw && a.summary_rw !== MIFASA_NO_SUMMARY) add(a.summary_rw, MIFASA_FIELD_W.summary);
    if (a.summary_en && a.summary_en !== a.summary_rw && a.summary_en !== MIFASA_NO_SUMMARY) add(a.summary_en, MIFASA_FIELD_W.summary);
    if (a._ans) add(a._ans, MIFASA_FIELD_W.qa);
    if (a._body) add(a._body, MIFASA_FIELD_W.body);

    lens[i] = Math.max(len, 1);
    totalLen += lens[i];

    tf.forEach((w, term) => {
      let p = postings.get(term);
      if (!p) { p = { d: [], w: [] }; postings.set(term, p); }
      p.d.push(i);
      p.w.push(w);
    });
  }

  const vocab = Array.from(postings.keys()).sort();
  const vocabByFirst = new Map();
  vocab.forEach(t => {
    const c = t[0];
    if (!vocabByFirst.has(c)) vocabByFirst.set(c, []);
    vocabByFirst.get(c).push(t);
  });

  MifasaIndex.N = N;
  MifasaIndex.postings = postings;
  MifasaIndex.vocab = vocab;
  MifasaIndex.vocabByFirst = vocabByFirst;
  MifasaIndex.lens = lens;
  MifasaIndex.avgLen = N ? totalLen / N : 1;
  MifasaIndex.scores = new Float32Array(N);
  MifasaIndex.termBest = new Float32Array(N);
  MifasaIndex.mask = new Uint32Array(N);
  MifasaIndex.expCache = new Map();
  MifasaIndex.queryCache = new Map();
  if (!MifasaIndex.synMap) MifasaIndex.synMap = buildSynonymMap();
  MifasaIndex.dirty = false;
  MifasaIndex.built = true;

  console.log(`🧠 Index: ${N} docs, ${vocab.length} terms in ${Math.round(performance.now() - t0)}ms`);
}

function ensureIndex() {
  if (MifasaIndex.dirty || !MifasaIndex.built) buildSearchIndex();
}

function boundedEdit(a, b, max) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[bl];
}

function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// One query word -> every index term it could mean, each with a confidence weight
function expandTerm(t) {
  const idx = MifasaIndex;
  const cached = idx.expCache.get(t);
  if (cached) return cached;

  const found = new Map();
  const put = (term, w, kind) => { const cur = found.get(term); if (!cur || cur.w < w) found.set(term, { w, kind: kind || "" }); };
  const has = term => idx.postings.has(term);

  const exact = has(t);
  if (exact) put(t, 1);

  // synonyms / translations
  const syns = idx.synMap.get(t);
  if (syns) syns.forEach(s => { if (has(s)) put(s, 0.8, "s"); });

  // prefix matches  (politik -> politiki, politikiya)
  if (t.length >= 3) {
    let k = lowerBound(idx.vocab, t), n = 0;
    while (k < idx.vocab.length && idx.vocab[k].startsWith(t) && n < 25) {
      const term = idx.vocab[k];
      if (term !== t) { put(term, 0.55 + 0.35 * (t.length / term.length)); n++; }
      k++;
    }
  }

  // suffix stripping for Kinyarwanda inflections (amatora -> amator..., ikoranabuhanga -> ikoranabuhang)
  if (t.length >= 7) {
    for (let cut = 1; cut <= 3; cut++) {
      const stem = t.slice(0, -cut);
      if (stem.length >= 5 && has(stem)) put(stem, 0.7 - cut * 0.05);
    }
  }

  // typo tolerance, only when nothing exact was found
  let corrected = "";
  // words we already know (synonym groups) are real words, not typos
  if (!exact && t.length >= 4 && !idx.synMap.has(t)) {
    const maxEd = t.length >= 9 ? 2 : 1;
    const bucket = idx.vocabByFirst.get(t[0]) || [];
    const cands = [];
    for (let i = 0; i < bucket.length; i++) {
      const term = bucket[i];
      if (Math.abs(term.length - t.length) > maxEd) continue;
      const d = boundedEdit(t, term, maxEd);
      if (d <= maxEd) cands.push({ term, d, df: idx.postings.get(term).d.length });
    }
    cands.sort((a, b) => a.d - b.d || b.df - a.df);
    cands.slice(0, 6).forEach(c => put(c.term, 0.62 - c.d * 0.12));
    if (cands.length && found.size === cands.slice(0, 6).length) corrected = cands[0].term;
  }

  const list = [];
  found.forEach((v, term) => list.push([term, v.w, v.kind]));
  const res = { list, corrected, exact };
  idx.expCache.set(t, res);
  return res;
}

function emptySearch(terms) {
  return { hits: [], terms: terms || [], termInfos: [], nTerms: 0, nEff: 0, corrected: "", topCoverage: 0 };
}

function mifasaSearch(rawQuery, limit = 40) {
  ensureIndex();
  const idx = MifasaIndex;
  if (!idx.N) return emptySearch();

  const qKey = currentLang + "|" + mifasaNorm(rawQuery) + "|" + limit;
  const hitCache = idx.queryCache.get(qKey);
  if (hitCache) return hitCache;

  let terms = [...new Set(tokenize(rawQuery).filter(t => t.length > 1 && !MIFASA_STOP_WORDS.has(t)))];
  if (terms.length === 0) return emptySearch();
  terms = terms.slice(0, 12);
  const nTerms = terms.length;

  const { scores, termBest, mask, lens, avgLen, N } = idx;
  const touched = [];
  const termInfos = [];
  let corrected = [];

  for (let i = 0; i < nTerms; i++) {
    const exp = expandTerm(terms[i]);
    corrected.push(exp.corrected || terms[i]);
    const set = new Set();
    const synSet = new Set();
    const tbTouched = [];

    for (let e = 0; e < exp.list.length; e++) {
      const [term, w, kind] = exp.list[e];
      if (w >= 0.55) (kind === "s" ? synSet : set).add(term);
      const p = idx.postings.get(term);
      const df = p.d.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let k = 0; k < df; k++) {
        const d = p.d[k];
        const tfw = p.w[k];
        const norm = (tfw * (MIFASA_BM25_K1 + 1)) / (tfw + MIFASA_BM25_K1 * (1 - MIFASA_BM25_B + MIFASA_BM25_B * lens[d] / avgLen));
        const c = idf * norm * w;
        if (termBest[d] === 0) tbTouched.push(d);
        if (c > termBest[d]) termBest[d] = c;
      }
    }
    for (let k = 0; k < tbTouched.length; k++) {
      const d = tbTouched[k];
      if (mask[d] === 0) touched.push(d);
      scores[d] += termBest[d];
      mask[d] |= (1 << i);
      termBest[d] = 0;
    }
    termInfos.push({ term: terms[i], set, synSet, matched: exp.list.length > 0 });
  }

  // filler words that match nothing ("how", "doing", "ibyerekeye") must not lower confidence
  const nEff = Math.max(1, termInfos.filter(x => x.matched).length);

  // rank: coverage-aware, then re-rank the best candidates with title / phrase / freshness signals
  const cand = new Array(touched.length);
  for (let k = 0; k < touched.length; k++) {
    const d = touched[k];
    let m = mask[d], bits = 0;
    while (m) { bits += m & 1; m >>>= 1; }
    const cov = Math.min(1, bits / nEff);
    cand[k] = { d, cov, s: scores[d] * (0.25 + 0.75 * cov * cov) };
    scores[d] = 0;
    mask[d] = 0;
  }
  cand.sort((a, b) => b.s - a.s);

  const phrase = terms.join(" ");
  const maxTs = allNews.length ? (allNews[0]._ts || 0) : 0;
  const docsArr = idx.docs;
  const top = cand.slice(0, Math.max(limit * 2, 60));
  for (let k = 0; k < top.length; k++) {
    const c = top[k];
    const a = docsArr[c.d];
    let tHits = 0;
    for (let i = 0; i < nTerms; i++) {
      if (a._tnorm.indexOf(" " + terms[i] + " ") !== -1) tHits++;
    }
    let boost = 1 + 0.4 * Math.min(1, tHits / nEff);
    if (nTerms >= 2 && a._tnorm.indexOf(" " + phrase + " ") !== -1) boost *= 1.5;
    if (a._ts && maxTs) {
      const ageDays = (maxTs - a._ts) / 864e5;
      boost *= 1 + 0.06 * Math.max(0, 1 - ageDays / 365);
    }
    c.s *= boost;
  }
  top.sort((a, b) => b.s - a.s);

  const best = top.length ? top[0].s : 0;
  const hits = [];
  for (let k = 0; k < top.length && hits.length < limit; k++) {
    if (top[k].s < best * 0.18) break;
    hits.push({ article: docsArr[top[k].d], score: top[k].s, cov: top[k].cov });
  }

  const correctedStr = corrected.join(" ");
  const result = {
    hits,
    terms,
    termInfos,
    nTerms,
    nEff,
    corrected: correctedStr !== terms.join(" ") ? correctedStr : "",
    topCoverage: hits.length ? hits[0].cov : 0
  };

  if (idx.queryCache.size > 80) idx.queryCache.delete(idx.queryCache.keys().next().value);
  idx.queryCache.set(qKey, result);
  return result;
}

/* ---------------------------------------------------------- */
/* ANSWER SYNTHESIS (reads the real content, writes an answer)  */
/* ---------------------------------------------------------- */

let mifasaConv = { query: "", offset: 0 };

function splitSentences(text) {
  const parts = String(text || "").replace(/\s+/g, " ").match(/[^.!?…\n]+[.!?…]?/g) || [];
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.length >= 25 && p.length <= 420) out.push(p);
  }
  return out;
}

// "First aid does not replace medical care." matches many questions but answers none: it must never beat a real answer sentence
const MIFASA_DISCLAIMER_RE = /\b(does not replace|do not replace|not a substitute|is not medical advice|ntibisimbura|ntibusimbura|ntisimbura)\b/i;

function pickAnswerSentences(search, docs, rawQuery) {
  const qnorm = mifasaNorm(rawQuery || "");
  const infos = search.termInfos.filter(i => i.matched);
  const cands = [];
  docs.forEach((h, rank) => {
    const a = h.article;
    const pool = [
      ...splitSentences(currentLang === "en" ? a.summary_en : a.summary_rw).map((s, i) => ({ s, pos: i, src: "sum" })),
      ...splitSentences((a._body || "").slice(0, 3500)).map((s, i) => ({ s, pos: i + 3, src: "body" }))
    ];
    pool.forEach(({ s, pos, src }) => {
      const toks = new Set(indexTokens(s));
      let covered = 0, weak = 0;
      for (let i = 0; i < infos.length; i++) {
        let hit = false, whit = false;
        for (const t of toks) {
          if (infos[i].set.has(t)) { hit = true; break; }
          if (infos[i].synSet.has(t)) whit = true;
        }
        if (hit) covered++; else if (whit) weak++;
      }
      if (covered === 0) return;
      const score = covered * 3 + weak * 0.8 + (covered / infos.length) * 3 + (src === "sum" ? 1 : 0) - rank * 0.9 - pos * 0.05 + questionBoost(qnorm, s) - (MIFASA_DISCLAIMER_RE.test(s) ? 5 : 0);
      cands.push({ s, score, rank, pos, covered, toks });
    });
  });

  cands.sort((x, y) => y.score - x.score);
  const chosen = [];
  for (const c of cands) {
    if (chosen.length >= 3) break;
    if (infos.length >= 3 && c.covered < 2 && chosen.length >= 1) continue;
    const dup = chosen.some(o => {
      let shared = 0;
      c.toks.forEach(t => { if (o.toks.has(t)) shared++; });
      return shared / Math.max(1, Math.min(c.toks.size, o.toks.size)) > 0.7;
    });
    if (!dup) chosen.push(c);
  }
  chosen.sort((x, y) => x.rank - y.rank || x.pos - y.pos);
  return chosen.map(c => c.s);
}

/* "Are you feeling good today?", "do you like music?", "uri umuntu?": a question about the assistant, not about our articles.
   When the search is only weakly matching, answer honestly and show what MIFASA AI can do, instead of an unrelated article. */
function mifasaAboutAssistant(q) {
  const s = String(q || "").toLowerCase().replace(/[’‘`]/g, "'").trim();
  return /^(?:hey |hi |hello |please )?(?:are|do|can|will|have|did|would|could|were|is|don't|can't) (?:you|u)\b/.test(s) || /\bhow (?:are|is) (?:you|your)\b/.test(s) || /^(?:what|who) are you\b/.test(s)
      || /^(?:uri|urashobora|ushobora|urazi|ukunda|wumva|ubona|urumva|uzi)\b/.test(s) && /\b(?:wowe|uyu munsi|neza|nabi|umuntu|ikiremwa)\b/.test(s);
}
function askMifasaAI(query, searchResult) {
  if (!query || query.trim().length < 2) return null;

  const greet = getMifasaGreeting(query);
  if (greet) return greet;

  const search = searchResult || mifasaSearch(query);
  if (search.nTerms === 0) return null;

  // show the subject ("politics"), not the whole request ("tell me about politics")
  const rawTopic = String(query).replace(/\s+/g, " ").trim().slice(0, 70);
  const subject = tokenize(rawTopic).filter(t => t.length > 1 && !MIFASA_STOP_WORDS.has(t)).join(" ");
  const topic = subject && subject.length >= 3 ? subject : rawTopic;

  if (search.latest && search.hits.length) {
    const top = search.hits.slice(0, 5).map(h => "• " + getTitle(h.article)).join("\n");
    const t = search.latestTopic;
    return {
      type: "latest",
      text_rw: `🤖 **MIFASA AI**\n\n🆕 ${t ? `Dore amakuru mashya kuri **${t}**:` : "Dore amakuru mashya cyane:"}\n${top}`,
      text_en: `🤖 **MIFASA AI**\n\n🆕 ${t ? `Here's the newest on **${t}**:` : "Here's what's newest:"}\n${top}`
    };
  }

  if (search.hits.length === 0) {
    const bf = mifasaBrainFallback(topic, search.corrected);
    if (bf) return bf;
    const tips = topicSuggestions(3).join('", "');
    const didRw = search.corrected ? `\n🔎 Ese washakaga kuvuga **"${search.corrected}"**?` : "";
    const didEn = search.corrected ? `\n🔎 Did you mean **"${search.corrected}"**?` : "";
    return {
      type: "knowledge_fallback",
      text_rw: `🤖 **MIFASA AI**: Nta makuru arambuye ndabona kuri **"${topic}"** ubu.${didRw}${tips ? `\nGerageza kubaza ku nsanganyamatsiko nka: *"${tips}"*.` : ""}`,
      text_en: `🤖 **MIFASA AI**: I couldn't find anything solid on **"${topic}"** yet.${didEn}${tips ? `\nTry asking about: *"${tips}"*.` : ""}`
    };
  }

  const offset = Math.min(mifasaConv.offset, Math.max(0, search.hits.length - 1));
  const docs = search.hits.slice(offset, offset + 3);
  const main = docs[0].article;
  const mainTitle = getTitle(main);
  const lowConfidence = search.nEff > 1 && search.topCoverage < 0.6;
  if (lowConfidence && offset === 0 && mifasaAboutAssistant(query)) {
    const rwA = "🤖 **MIFASA AI**\n\n💬 Ndi umufasha w'ubwenge buhangano (porogaramu, si umuntu), kandi niteguye kugufasha. 😊\nNshobora gusubiza ibibazo ku Rwanda, amakuru, imibare, amagambo n'ubumenyi rusange.\nGerageza nka: **amakuru ya siporo**, **ijambo ry'umunsi**, **sobanura u Rwanda**.";
    const enA = "🤖 **MIFASA AI**\n\n💬 I'm an AI assistant (a program, not a person), and I'm ready to help. 😊\nI can answer questions about Rwanda, the news, maths, words and general knowledge.\nTry: **sports news**, **word of the day**, **explain Rwanda**.";
    return { type: "smart_insight", text_rw: rwA, text_en: enA };
  }

  // 1) a stored question/answer pair that matches the question closely answers directly
  let sentences = [];
  if (offset === 0 && main._ans && docs[0].cov >= 0.7) {
    sentences = [String(main._ans).replace(/\s+/g, " ").trim().slice(0, 600)];
  } else {
    sentences = pickAnswerSentences(search, docs, query);
  }
  if (sentences.length === 0) {
    const sm = getSummary(main);
    if (sm && sm !== MIFASA_NO_SUMMARY) sentences = [sm.slice(0, 400)];
  }

  const mainIsCore = !!(search.hits[offset] && search.hits[offset].article._core);
  const related = search.hits.slice(offset + 1, offset + 6).filter(h => mainIsCore || !h.article._core).slice(0, 3).map(h => getTitle(h.article)).filter(t => t && t !== mainTitle);

  const introRw = offset > 0
    ? pickVariant("more_rw", ["Dore ibindi nabonye:", "Ibi na byo bijyanye n'ikibazo cyawe:"])
    : lowConfidence
      ? `Ntabwo mbyizeye 100%, ariko dore ibyegereye ikibazo cyawe:`
      : pickVariant("ans_rw", [`Dore icyo nabonye kuri **${topic}**:`, `Kuri **${topic}** nasanze ibi:`, `Nakurebeye kuri **${topic}**, dore igisubizo:`]);
  const introEn = offset > 0
    ? pickVariant("more_en", ["Here's more I found:", "This is also relevant:"])
    : lowConfidence
      ? `I'm not 100% sure, but here's the closest I found:`
      : pickVariant("ans_en", [`Here's what I found on **${topic}**:`, `On **${topic}**, I found this:`, `I looked into **${topic}**, here's the answer:`]);

  const didRw = search.corrected && offset === 0 ? `🔎 Nakomeje ushakisha **"${search.corrected}"**.\n\n` : "";
  const didEn = search.corrected && offset === 0 ? `🔎 I searched for **"${search.corrected}"** instead.\n\n` : "";

  const body = sentences.map(s => `• ${s}`).join("\n");

  let rw = `🤖 **MIFASA AI**\n\n${didRw}💡 ${introRw}\n${body}\n\n📌 **${mainTitle}**`;
  let en = `🤖 **MIFASA AI**\n\n${didEn}💡 ${introEn}\n${body}\n\n📌 **${mainTitle}**`;
  if (related.length) {
    rw += `\n\n🔗 **Wasoma n'ibi bifitanye isano:**\n${related.map(t => "• " + t).join("\n")}`;
    en += `\n\n🔗 **You might also like:**\n${related.map(t => "• " + t).join("\n")}`;
  }
  if (search.hits.length > offset + 3) {
    rw += `\n\n💬 Andika **"ibindi"** nkubwire ibindi.`;
    en += `\n\n💬 Type **"more"** and I'll tell you more.`;
  }

  return { type: "smart_insight", text_rw: rw, text_en: en };
}

/* ---------------------------------------------------------- */
/* 9a. MIFASA BRAND (one place to edit your identity)          */
/* ---------------------------------------------------------- */
// Everything the site says about its owner comes from here. Fill in the empty links.
const MIFASA_BRAND = {
  name: "MIFASA",
  founder: "Mizero Fabrice Samuel",
  site: "",                       // leave "" to use the address the page is opened on
  tagline_rw: "Amakuru n'ubumenyi mu Kinyarwanda no mu Cyongereza",
  tagline_en: "News and knowledge in Kinyarwanda and English",
  // The name MIFASA = MIzero FAbrice SAmuel. Set both to "" if you don't want the AI to say this.
  nameOrigin_rw: "Izina MIFASA rikomoka ku mazina ye: MIzero FAbrice SAmuel.",
  nameOrigin_en: "The name MIFASA comes from his name: MIzero FAbrice SAmuel.",
  social: { whatsapp: "", youtube: "", instagram: "", x: "", facebook: "", tiktok: "", linkedin: "", email: "" },
  showFooter: true,
  addSharing: true
};

function mifasaSiteUrl() {
  if (MIFASA_BRAND.site) return MIFASA_BRAND.site.replace(/\/$/, "");
  try { return window.location.origin || ""; } catch (e) { return ""; }
}

function mifasaSocialLinks() {
  const s = MIFASA_BRAND.social || {};
  return Object.keys(s)
    .filter(k => s[k] && k !== "whatsapp" && k !== "email")
    .map(k => s[k])
    .filter(u => /^https?:\/\//i.test(String(u)));
}

// Text added to everything people share, so the name travels with it
function mifasaSignature() {
  return `— ${MIFASA_BRAND.name} · ${MIFASA_BRAND.founder}`;
}

function absoluteUrl(href) {
  try { return new URL(href, window.location.href).href; } catch (e) { return href; }
}

/* Inkuru zose (n'iz'izindi mbuga) zifungurirwa MURI story.html; link y'isoko iboneka kuri story.html gusa (buto "Soma ku isoko"). */
function mifasaStoryHref(a) {
  if (!a) return "#";
  const l = String(a.link || "");
  if (l && !/^(https?:)?\/\//i.test(l)) return l;            // already an internal page
  const id = a.share_id || a.id;
  if (!id) return l || "#";
  return `story.html?news=${encodeURIComponent(id)}&cat=${encodeURIComponent(a.category || a.source || "")}&lang=${encodeURIComponent(currentLang)}`;
}

function buildShareText(article) {
  const title = getTitle(article);
  const link = mifasaStoryHref(article);
  // Share the STATIC page s/<share_id>.html (real meta tags inside the HTML: WhatsApp/Facebook do not run JavaScript)
  const sid = String(article.share_id || "");
  let url;
  if (/^[A-Za-z0-9_.-]{3,120}$/.test(sid)) url = `${(article._hub && typeof mifasaHubBase === "function" && mifasaHubBase() ? mifasaHubBase() : mifasaSiteUrl()).replace(/\/+$/, "")}/s/${encodeURIComponent(sid)}.html${currentLang === "en" ? "?lang=en" : ""}`;
  else url = absoluteUrl(safeHref(link));
  return { title, url, text: `${title}\n\n${mifasaSignature()}` };
}

/* Static page s/<id>.html exists only after the crawler made + uploaded it. Check first; if it is missing, share the reader link (story.html?news=ID) that ALWAYS works. */
const __mifasaStaticOk = {};
async function mifasaStaticPageExists(url) {
  if (__mifasaStaticOk[url]) return true;
  try {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 2500);
    const r = await fetch(url, { method: "HEAD", cache: "no-store", signal: c.signal });
    clearTimeout(t);
    if (r.ok) __mifasaStaticOk[url] = true;      // only "yes" is remembered: a missing page may appear later
    return r.ok;
  } catch (e) { return false; }
}

async function shareArticle(share_id) {
  const a = allNews.find(x => String(x.share_id) === String(share_id));
  if (!a) return;
  const p = buildShareText(a);
  const readerUrl = absoluteUrl(safeHref(mifasaStoryHref(a)));
  if (p.url !== readerUrl && !(await mifasaStaticPageExists(p.url.split("?")[0]))) p.url = readerUrl;
  if (typeof navigator !== "undefined" && navigator.share) {
    navigator.share({ title: p.title, text: p.text, url: p.url }).catch(err => {
      if (err && err.name === "AbortError") return;            // person closed the share sheet
      window.open("https://wa.me/?text=" + encodeURIComponent(`${p.title}\n${p.url}\n\n${mifasaSignature()}`), "_blank", "noopener");
    });
  } else {
    window.open("https://wa.me/?text=" + encodeURIComponent(`${p.title}\n${p.url}\n\n${mifasaSignature()}`), "_blank", "noopener");
  }
}

// Structured data + author tags + footer credit. Search engines then connect MIFASA with the founder's name.
function mifasaInjectBrand() {
  if (typeof document === "undefined" || !document.head) return;
  const B = MIFASA_BRAND, site = mifasaSiteUrl();
  try {
    if (!document.querySelector('script[data-mifasa-ld]')) {
      const ld = document.createElement("script");
      ld.type = "application/ld+json";
      ld.setAttribute("data-mifasa-ld", "1");
      const person = { "@type": "Person", "@id": site + "/#founder", name: B.founder, url: site || undefined, brand: { "@type": "Brand", name: B.name } };
      const same = mifasaSocialLinks();
      if (same.length) person.sameAs = same;
      ld.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", "@id": site + "/#website", name: B.name, url: site || undefined, inLanguage: ["rw", "en"], description: B.tagline_en, publisher: { "@id": site + "/#founder" }, creator: { "@id": site + "/#founder" } },
          person
        ]
      });
      document.head.appendChild(ld);
    }
    const addMeta = (attr, key, content) => {
      if (document.querySelector(`meta[${attr}="${key}"]`)) return;
      const m = document.createElement("meta");
      m.setAttribute(attr, key); m.setAttribute("content", content);
      document.head.appendChild(m);
    };
    addMeta("name", "author", B.founder);
    addMeta("name", "description", `${B.name} — ${B.tagline_en}. ${B.tagline_rw}.`);
    addMeta("property", "og:site_name", B.name);
    addMeta("property", "og:type", "website");
  } catch (e) { /* branding must never break the site */ }

  try {
    if (B.showFooter && document.body && !document.getElementById("mifasaCredit")) {
      const links = mifasaSocialLinks().map(u => {
        let host = u; try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
        return `<a href="${escapeHTML(u)}" target="_blank" rel="noopener noreferrer" style="margin:0 6px;">${escapeHTML(host)}</a>`;
      }).join("");
      const f = document.createElement("div");
      f.id = "mifasaCredit";
      f.style.cssText = "text-align:center;padding:16px 10px;font-size:12px;opacity:.8;";
      f.innerHTML = `© ${new Date().getFullYear()} <strong>${escapeHTML(B.name)}</strong> · ${escapeHTML(B.founder)}${links ? "<div style='margin-top:6px;'>" + links + "</div>" : ""}`;
      document.body.appendChild(f);
    }
  } catch (e) {}
}

if (typeof document !== "undefined" && !MIFASA_API_ONLY) {
  document.addEventListener("DOMContentLoaded", mifasaInjectBrand);
}
try {
  console.log(`%c${MIFASA_BRAND.name} AI%c  by ${MIFASA_BRAND.founder}`, "background:#007bff;color:#fff;padding:3px 8px;border-radius:4px;font-weight:bold;", "color:#007bff;font-weight:bold;");
} catch (e) {}

/* ---------------------------------------------------------- */
/* 9b. GREETING INTELLIGENCE (human-like, context-aware)       */
/* ---------------------------------------------------------- */

let mifasaLastGreetingKey = "";

function mifasaNorm(str) {
  // Normalize accents, punctuation, repeated symbols and common math symbols consistently.
  // The original raw query is retained for calculators and display; this is the matching form.
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[−–—]/g, " minus ")
    .replace(/[×✕]/g, " times ")
    .replace(/[÷]/g, " divided ")
    .replace(/=/g, " equals ")
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A lightweight question profile: it does not invent facts; it helps select a relevant next question.
function mifasaAnalyzeQuestion(raw) {
  const normalized = mifasaNorm(brainFixQuery(String(raw || "")));
  const qtype = brainQType(normalized);
  const rw = /\b(iki|ikihe|nde|ninde|kuki|gute|ryari|hehe|ese|mbese|nsobanurira|sobanura|gereranya|intambwe)\b/.test(normalized);
  const goal = /\b(why|kuki|impamvu)\b/.test(normalized) ? "cause"
    : /\b(how|gute|steps|intambwe|uko|nategura|nkemura)\b/.test(normalized) ? "procedure"
    : /\b(compare|difference|gereranya|itandukaniro)\b/.test(normalized) ? "comparison"
    : /\b(define|meaning|bisobanura iki|igisobanuro|what is|ni iki)\b/.test(normalized) ? "definition"
    : /\b(who|nde|ninde)\b/.test(normalized) ? "identity"
    : "general";
  const topic = /\b(mifasa|mifasarw|ai|ubwenge buhangano|assistant)\b/.test(normalized) ? "mifasa_ai"
    : /\b(umeze|amakuru yawe|how are you|feel|agahinda|ibyishimo|lonely|loneliness)\b/.test(normalized) ? "wellbeing"
    : /\b(kwiga|study|school|exam|ikizamini|amasomo)\b/.test(normalized) ? "learning"
    : /\b(code|coding|website|html|javascript|json|programming|porogaramu)\b/.test(normalized) ? "programming"
    : /\b(amakuru|news|politics|politiki|sports|siporo|football|umupira)\b/.test(normalized) ? "news"
    : /\b(science|siyansi|physics|biology|chemistry|math|imibare)\b/.test(normalized) ? "science"
    : "general";
  return { raw: String(raw || ""), normalized, qtype, goal, topic, looksLikeQuestion: /[?？]$/.test(String(raw || "").trim()) || /\b(iki|nde|ninde|kuki|gute|ryari|hehe|what|who|why|how|when|where|can|does|is|are)\b/.test(normalized), hasMultipleParts: /\b(and|na|kandi|also|plus|then|hanyuma)\b/.test(normalized) };
}

// Buttons are generated from the user's current topic, not from a fixed generic greeting.
function mifasaRelevantFollowups(rawQuery, existing = []) {
  const q = mifasaNorm(rawQuery);
  const rw = currentLang !== "en";
  const make = pairs => pairs.map(([rwLabel, enLabel, rwAsk, enAsk]) => ({
    label: rw ? rwLabel : enLabel, ask: rw ? rwAsk : enAsk
  }));
  if (/\b(who is mifasa|what is mifasa|mifasa ai|mifasarw ai|uri nde|witwa nde|who are you|what are you|your name|mifasa ni nde|mifasa ni iki|nde wagukoze|wakozwe na nde|creator|developer)\b/.test(q)) {
    return make([
      ["MIFASA AI ikora iki?", "What can MIFASA AI do?", "MIFASA AI ishobora gukora iki?", "What can MIFASA AI do?"],
      ["Yakozwe na nde?", "Who created it?", "MIFASA AI yakozwe na nde?", "Who created MIFASA AI?"],
      ["Ikora ite nta API?", "How does it work without an API?", "MIFASA AI ikora ite idakoresheje API?", "How does MIFASA AI work without an API?"]
    ]);
  }
  if (/\b(how are you|how r u|how's it going|how is it going|hows it going|whats up|what's up|what is up|amakuru yawe|umeze ute|mumeze mute|ni gute)\b/.test(q)) {
    return make([
      ["Wowe se umeze ute?", "How are you feeling?", "Wowe se umeze ute?", "How are you feeling?"],
      ["Twaganira ku ki?", "What can we talk about?", "Twaganira ku ki?", "What can we talk about?"],
      ["Mfasha kwiga ikintu gishya", "Teach me something new", "Mfasha kwiga ikintu gishya", "Teach me something new"]
    ]);
  }
  if (/\b(kwiga|study|school|exam|ikizamini|amasomo|learning)\b/.test(q)) return make([
    ["Mpa gahunda yo kwiga", "Make me a study plan", "Mpa gahunda yo kwiga", "Make me a study plan"],
    ["Mpa ibibazo by'imyitozo", "Give me practice questions", "Mpa ibibazo by'imyitozo", "Give me practice questions"],
    ["Nakwibuka nte ibyo nize?", "How can I remember what I learn?", "Nakwibuka nte ibyo nize?", "How can I remember what I learn?"]
  ]);
  if (/\b(code|coding|website|html|javascript|json|programming|porogaramu|script)\b/.test(q)) return make([
    ["Nsobanurira intambwe ku yindi", "Explain it step by step", "Nsobanurira intambwe ku yindi", "Explain it step by step"],
    ["Reba amakosa muri code", "Help debug the code", "Mfasha gushaka amakosa muri code", "Help me debug the code"],
    ["Mpa urugero rukora", "Show a working example", "Mpa urugero rwa code rukora", "Show a working code example"]
  ]);
  if (/\b(kuki|why|impamvu)\b/.test(q)) return make([
    ["Sobanura impamvu mu buryo burambuye", "Explain the reasons in more detail", "Sobanura impamvu mu buryo burambuye", "Explain the reasons in more detail"],
    ["Tanga urugero", "Give an example", "Tanga urugero", "Give an example"],
    ["Ni ikihe kimenyetso kibyemeza?", "What evidence supports it?", "Ni ikihe kimenyetso kibyemeza?", "What evidence supports it?"]
  ]);
  if (/\b(how|gute|uko|steps|intambwe|nkemura)\b/.test(q)) return make([
    ["Mpa intambwe zo kubikora", "Give me the steps", "Mpa intambwe zo kubikora", "Give me the steps"],
    ["Tanga urugero rufatika", "Give a practical example", "Tanga urugero rufatika", "Give a practical example"],
    ["Ni ayahe makosa nakwirinda?", "What mistakes should I avoid?", "Ni ayahe makosa nakwirinda?", "What mistakes should I avoid?"]
  ]);
  return Array.isArray(existing) ? existing : [];
}

function pickVariant(key, list) {
  if (!list.length) return "";
  let choice = list[Math.floor(Math.random() * list.length)];
  // never say the exact same thing twice in a row
  if (list.length > 1 && mifasaLastGreetingKey === key + choice) {
    choice = list[(list.indexOf(choice) + 1) % list.length];
  }
  mifasaLastGreetingKey = key + choice;
  return choice;
}

function getMifasaUserName() {
  return localStorage.getItem("mifasa_user_name") || "";
}

function learnUserName(norm) {
  const m = norm.match(/\b(?:nitwa|izina ryanjye ni|my name is|i am called|call me)\s+([a-z']{2,20})\b/);
  if (!m) return "";
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  try { localStorage.setItem("mifasa_user_name", name); } catch (e) {}
  return name;
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function getVisitInfo() {
  let visits = parseInt(localStorage.getItem("mifasa_visit_count") || "0", 10);
  const last = parseInt(localStorage.getItem("mifasa_last_seen") || "0", 10);
  const hoursAway = last ? (Date.now() - last) / 36e5 : 0;
  return { visits, hoursAway, returning: visits > 1 };
}

// Counted once per page load, not on every greeting
(function trackVisit() {
  try {
    const n = parseInt(localStorage.getItem("mifasa_visit_count") || "0", 10) + 1;
    localStorage.setItem("mifasa_visit_count", String(n));
  } catch (e) {}
})();

function topicSuggestions(count = 3) {
  if (!allNews || allNews.length === 0) return [];
  const pool = allNews.slice(0, 40);
  const picks = [];
  while (picks.length < Math.min(count, pool.length)) {
    const t = getTitle(pool[Math.floor(Math.random() * pool.length)]);
    if (t && !picks.includes(t)) picks.push(t);
  }
  return picks;
}

const MIFASA_GREETING_RULES = [
  { id: "joke",    re: /\b(urwenya|nsetsa|joke|make me laugh|tell me a joke)\b/ },
  { id: "praise",  re: /^(ni byiza cyane|uri umunyabwenge|uri mwiza|good job|well done|great job|you are (great|smart|good|amazing|awesome)|you're (great|smart|good|amazing|awesome)|nice one)\b/ },
  { id: "sorry",   re: /^(mbabarira|ihangane|sorry|my bad)\b/ },
  { id: "name",   re: /\b(nitwa|izina ryanjye ni|my name is|call me)\b/ },
  { id: "bye",    re: /^(murabeho|urabeho|tuzongera guhura|ni bye|bye|goodbye|see you|good night|ijoro ryiza)\b/ },
  { id: "thanks", re: /^(murakoze|urakoze|ndagushimiye|thanks|thank you|thx)\b/ },
  { id: "creator", re: /\b(nde wagukoze|wakozwe na nde|wakozwe nande|ni nde wagukoze|nde wagukoze|ni nde wagukoze|who (made|created|built|developed|owns) you|who is your (creator|developer|founder|owner)|your (creator|developer|founder|owner)|who is mifasa|what is mifasa|mifasa ni iki|mifasa ni nde|who is mizero|mizero fabrice|fabrice samuel|washinze mifasa|founder of mifasa)\b/ },
  { id: "who",    re: /\b(uri nde|witwa nde|who are you|what are you|your name)\b/ },
  { id: "help",   re: /\b(ushobora gukora iki|wamfasha|mfasha|nfasha|what can you do|help me|can you help)\b/ },
  { id: "how",    re: /^(amakuru( yawe| yanyu| se| ki| y uyu munsi)?|mumeze mute|umeze ute|ni gute|how are you|how r u|how's it going|how is it going|hows it going|whats up|what's up|what is up|sup)( today| doing| going)?$/ },
  { id: "hello",  re: /^(muraho|mwaramutse|waramutse|mwiriwe|wiriwe|bite|yoo|hello|hi|hey|hola|salut|good (morning|afternoon|evening)|murakaza neza|welcome)\b/ }
];

// Only treat the message as small talk when it is short. "Muraho, mbwira kuri politiki"
// contains real intent, so it is greeted AND answered by the normal search.
function detectGreeting(value) {
  const norm = mifasaNorm(value);
  if (!norm) return null;
  const words = norm.split(" ").length;
  if (words > 6) return null;
  if (MIFASA_LATEST_RE.test(norm)) return null;      // "amakuru mashya" is a request, not small talk
  for (const rule of MIFASA_GREETING_RULES) {
    if (rule.re.test(norm)) {
      let rest = "";
      if (rule.id === "hello") {
        // "Muraho, mbwira kuri politiki": greet AND answer
        rest = norm.replace(/^(muraho|mwaramutse|waramutse|mwiriwe|wiriwe|bite|yoo|hello|hi|hey|hola|salut|good (morning|afternoon|evening)|murakaza neza|welcome)\b[\s,]*(neza|cyane|bose|mwese)?\s*/, "").trim();
        if (!indexTokens(rest).length) rest = "";
      }
      return { id: rule.id, norm, words, rest };
    }
  }
  return null;
}

function getMifasaGreeting(value) {
  const hit = detectGreeting(value);
  if (!hit) return null;

  const learned = hit.id === "name" ? learnUserName(hit.norm) : "";
  const name = learned || getMifasaUserName();
  const nameRw = name ? ` ${name}` : "";
  const nameEn = name ? `, ${name}` : "";
  const tod = getTimeOfDay();
  const { returning, hoursAway } = getVisitInfo();
  const tips = topicSuggestions(3);
  const tipsLine = tips.length
    ? { rw: `\n\n✨ Ubu abantu benshi barimo gusoma kuri:\n${tips.map(t => "• " + t).join("\n")}`,
        en: `\n\n✨ People are reading about these right now:\n${tips.map(t => "• " + t).join("\n")}` }
    : { rw: "", en: "" };

  const timeRw = tod === "morning" ? "Mwaramutse" : "Mwiriwe";
  const timeEn = tod === "morning" ? "Good morning" : tod === "afternoon" ? "Good afternoon" : "Good evening";
  const dayPartRw = tod === "morning" ? "Mugitondo cyiza" : tod === "afternoon" ? "Amanywa meza" : "Nimugoroba mwiza";

  let rw = "", en = "";

  switch (hit.id) {
    case "hello": {
      const back = returning && hoursAway > 20;
      rw = pickVariant("hello_rw", [
        `${timeRw}${nameRw}! 👋 Nishimiye kukubona. Wifuza kumenya iki uyu munsi?`,
        `Muraho${nameRw}! 😊 ${dayPartRw}. Mbwira icyo ushaka, ndagufasha.`,
        back ? `Murakaza neza${nameRw}, wagarutse! 🎉 Hari icyo wifuza kumenya?` : `Murakaza neza${nameRw}! Ndi MIFASA AI, ndi hano ngo ngufashe.`
      ]) + tipsLine.rw;
      en = pickVariant("hello_en", [
        `${timeEn}${nameEn}! 👋 Great to see you. What would you like to know today?`,
        `Hey${nameEn}! 😊 Ask me anything and I'll help.`,
        back ? `Welcome back${nameEn}! 🎉 What are we exploring today?` : `Welcome${nameEn}! I'm MIFASA AI, here to help.`
      ]) + tipsLine.en;
      break;
    }
    case "how":
      rw = pickVariant("how_rw", [
        `Ndi amahoro rwose${nameRw}, urakoze kubaza! 😄 Wowe se amakuru?`,
        `Meze neza cyane${nameRw}! Nteguye gusubiza ibibazo byawe. Wowe umeze ute?`
      ]);
      en = pickVariant("how_en", [
        `Doing great${nameEn}, thanks for asking! 😄 How about you?`,
        `All good here${nameEn}! Ready for your questions. How are you?`
      ]);
      break;
    case "thanks":
      rw = pickVariant("thx_rw", [`Ntacyo${nameRw}! 🙏 Nishimiye ko nagufashije.`, `Nta kibazo${nameRw}, ni iby'agaciro kugufasha! 😊`]);
      en = pickVariant("thx_en", [`You're welcome${nameEn}! 🙏`, `Happy to help${nameEn}! 😊`]);
      break;
    case "bye":
      rw = pickVariant("bye_rw", [`Murabeho${nameRw}! 👋 Uzagaruke vuba.`, `Urabeho${nameRw}! Tuzongera guhura. 🌟`]);
      en = pickVariant("bye_en", [`Goodbye${nameEn}! 👋 Come back soon.`, `See you later${nameEn}! 🌟`]);
      break;
    case "who":
      rw = `Ndi **MIFASA AI** 🤖, umufasha wawe w'ubwenge, nakozwe na **${MIFASA_BRAND.founder}**. Nshobora kugusubiza ibibazo, kugusobanurira, no kukwereka inkuru n'ubushakashatsi bijyanye n'ibyo ushaka.`;
      en = `I'm **MIFASA AI** 🤖, your smart assistant, created by **${MIFASA_BRAND.founder}**. I can answer questions, explain topics, and point you to stories and research that match what you're after.`;
      break;
    case "creator":
      rw = `**${MIFASA_BRAND.name}** yakozwe na **${MIFASA_BRAND.founder}**. ${MIFASA_BRAND.nameOrigin_rw} ${MIFASA_BRAND.tagline_rw}.`.replace(/\s+/g, " ").trim();
      en = `**${MIFASA_BRAND.name}** was created by **${MIFASA_BRAND.founder}**. ${MIFASA_BRAND.nameOrigin_en} ${MIFASA_BRAND.tagline_en}.`.replace(/\s+/g, " ").trim();
      break;
    case "help":
      rw = `Birashoboka${nameRw}! 💪 Mbwira umutwe ushaka (urugero: ikoranabuhanga, ubuzima, amateka, siporo) cyangwa ubaze ikibazo nkuko wabibaza inshuti.` + tipsLine.rw;
      en = `Absolutely${nameEn}! 💪 Name a topic (tech, health, history, sports) or just ask a question the way you'd ask a friend.` + tipsLine.en;
      break;
    case "joke":
      rw = pickVariant("joke_rw", [
        "😄 Kuki mudasobwa yagiye kwa muganga? Kubera ko yari ifite **virusi**!",
        "😄 Mudasobwa yabwiye internet iti: «Wowe uri inshuti nziza, ntujya untera «offline»!» (usibye iyo umuriro wagiye 😅)",
        "😄 Umunyeshuri yabajije mudasobwa ati: «Uzi byose?» Na yo iti: «Oya, mbanza **gushakisha**!»"
      ]);
      en = pickVariant("joke_en", [
        "😄 Why did the computer go to the doctor? It caught a **virus**!",
        "😄 Why was the web developer broke? He used up all his **cache**!",
        "😄 I would tell you a UDP joke, but you might not get it."
      ]);
      break;
    case "praise":
      rw = pickVariant("praise_rw", [`Murakoze cyane${nameRw}! 😊 Ni ibyishimo kugufasha.`, `Warakoze${nameRw}! 🌟 Mbwira ikindi wifuza kumenya.`]);
      en = pickVariant("praise_en", [`Thank you${nameEn}! 😊 Happy to help.`, `That means a lot${nameEn}! 🌟 What else can I look up?`]);
      break;
    case "sorry":
      rw = `Nta kibazo${nameRw}! 🙂 Komeza ubaze.`;
      en = `No worries${nameEn}! 🙂 Go ahead and ask.`;
      break;
    case "name":
      rw = learned
        ? `Nishimiye kukumenya, **${learned}**! 🤝 Ubu ngubu ndakwita ${learned}. Ni iki nagufasha?`
        : `Nishimiye kukumenya! Ni iki nagufasha?`;
      en = learned
        ? `Nice to meet you, **${learned}**! 🤝 What can I help you with?`
        : `Nice to meet you! What can I help you with?`;
      break;
  }

  try { localStorage.setItem("mifasa_last_seen", String(Date.now())); } catch (e) {}

  return {
    type: "greeting",
    text_rw: `🤖 **MIFASA AI**\n\n${rw}`,
    text_en: `🤖 **MIFASA AI**\n\n${en}`
  };
}

// Turn internal file/category names (mfs12, politics_2026-09-24...) into friendly topic labels
function friendlyCategory(raw) {
  const c = String(raw || "").trim();
  if (!c || /\d{2,}|_|\.json|^mfs|^data$|^users?/i.test(c)) {
    return currentLang === "en" ? "what I know" : "ibyo nzi";
  }
  return c.replace(/[-_]+/g, " ");
}


/* ---------------------------------------------------------- */
/* 9c. SMART TOOLS: calculator, date/time, compare, language   */
/* ---------------------------------------------------------- */

/* ---- auto-detect the language the person is writing in (per message) ---- */
const MIFASA_EN_WORDS = new Set(["the","is","are","what","whats","who","how","why","when","where","tell","me","about","of","and","to","in","you","can","please","show","give","explain","more","latest","news","my","do","does","i","it","this","that","with","for","from","compare","difference","between","calculate","joke","thanks","thank","hello","hi","hey","today","time","date",
  "keep","want","need","have","has","had","was","were","will","would","should","could","an","at","on","by","if","or","not","yes","but","as","be","been","am","your","his","her","our","their","its","they","we","which","there","here","than","then","very","most","some","any","all","new","old","good","bad","best","help","make","made","find","know","learn","learning","start","stop","get","going","see","use","using","working","study","read","write","eat","sleep","feel","feeling","love","like","many","much","long","tall","big","small","first","last","name","capital","country","people","live","lives","after","before","without","exam","job","money","water","food","health","school","life","day","night","week","year","month","hungry","tired","happy","sad","angry","lonely","afraid","scared","procrastinating","scholarships","scholarship","interview","tips","advice","career","english","speak","fluently","password","phone","battery","internet","website","computer","history","science","education","technology","politics","sports","football","weather","rain","explain","describe","define","meaning","example","examples","steps","guide","free","online","courses","course","practice","question","questions","quiz","answer","lesson","homework","essay","write","summary","summarize","translate","calculate","convert","miles","kilometers","pounds","kilograms","percent","percentage","vaccine","disease","symptoms","treatment","medicine","doctor","hospital"]);
const MIFASA_RW_WORDS = new Set(["ni","na","mu","ku","kuri","ya","wa","bya","cya","mbwira","sobanura","ibyo","icyo","ese","ryari","ninde","iki","gute","kuki","amakuru","muraho","mwaramutse","mwiriwe","ndashaka","nshaka","none","ubu","urakoze","murakoze","uyu","munsi","itariki","isaha","ingahe","angahe","bangahe","gereranya","itandukaniro","urwenya","ibindi","nyereka","erekana",
  "ndi","uri","ari","turi","muri","bari","ndumva","mfite","ufite","afite","dufite","mufite","bafite","nta","ntabwo","cyane","cyangwa","kandi","ariko","kubera","kugira","gukora","kwiga","kuvuga","gusoma","kwandika","gufasha","mpa","nyabuneka","ikibazo","ibibazo","inama","amasomo","akazi","amafaranga","ubuzima","uburezi","ubukungu","amateka","umuco","igihugu","abantu","umuntu","umwana","abana","urugo","umunsi","ijoro","igitondo","nimugoroba","bite","yego","oya","sawa","neza","nabi","gato","menshi","byinshi","nyinshi","ibyiza","ikinyarwanda","icyongereza","ururimi","hano","aho","hehe","ngo","kuko","nyuma","mbere","buri","byose","cyose","wese","wowe","njye","twe","mwe","bo","nakwiga","nabona","nahindura","ndarambiwe","ndananiwe","nkeneye","nkuko","uko","ntegura","nirinda","ibiryo","amazi","ishuri","amashuri","umuhanda","ubwoko","umwuga","buruse","imyaka","iminsi","icyumweru","ukwezi","umwaka"]);
const MIFASA_EN_STRONG = new Set(["hello","hi","hey","thanks","joke","calculate","compare","latest","trending","today","time"]);

function detectQueryLang(value) {
  const toks = mifasaNorm(value).split(" ").filter(Boolean);
  if (!toks.length) return null;
  let en = 0, rw = 0, strong = 0;
  for (const t of toks) {
    if (MIFASA_RW_WORDS.has(t)) rw++;
    else if (MIFASA_EN_WORDS.has(t)) { en++; if (MIFASA_EN_STRONG.has(t)) strong++; }
  }
  if (en >= 2 && rw === 0) return "en";
  if (en >= 1 && strong >= 1 && rw === 0 && toks.length <= 3) return "en";
  if (en >= 1 && rw === 0 && en / toks.length >= 0.5) return "en";   // e.g. "scholarships" / "capital kenya"
  if (rw >= 1 && en === 0) return "rw";
  if (rw >= 2 && rw > en * 2) return "rw";
  return null;
}

/* ---- safe calculator (no eval) ---- */
function mifasaFormatNumber(n) {
  if (!isFinite(n)) return String(n);
  const r = Math.abs(n) >= 1e15 ? n.toExponential(6) : Number(n.toPrecision(12));
  return typeof r === "number" ? r.toLocaleString("en-US", { maximumFractionDigits: 8 }) : String(r);
}

function mifasaEvalExpr(str) {
  const toks = str.match(/\d+(?:\.\d+)?|[-+*\/^()%]/g) || [];
  let pos = 0, steps = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const guard = () => { if (++steps > 400) throw new Error("complex"); };

  function expr() {
    let v = term();
    while (peek() === "+" || peek() === "-") { guard(); const op = next(); const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = power();
    while (peek() === "*" || peek() === "/") {
      guard(); const op = next(); const r = power();
      if (op === "/" && r === 0) throw new Error("div0");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function power() {
    const b = unary();
    if (peek() === "^") { guard(); next(); const e = power(); return Math.pow(b, e); }
    return b;
  }
  function unary() {
    if (peek() === "-") { next(); return -unary(); }
    if (peek() === "+") { next(); return unary(); }
    return primary();
  }
  function primary() {
    const t = next();
    if (t === undefined) throw new Error("syntax");
    let v;
    if (t === "(") { v = expr(); if (next() !== ")") throw new Error("syntax"); }
    else if (/^\d/.test(t)) v = parseFloat(t);
    else throw new Error("syntax");
    while (peek() === "%") { next(); v = v / 100; }
    return v;
  }
  const out = expr();
  if (pos !== toks.length) throw new Error("syntax");
  return out;
}

function tryCalculate(raw) {
  let s = String(raw || "").toLowerCase().trim();
  if (!s || s.length > 90) return null;

  let prefixed = false;
  const stripped = s.replace(/^(bara|kubara|calculate|calc|compute|what is|what's|whats|ni angahe|ni ingahe|angahe|ingahe|=)\s*/, "");
  if (stripped !== s) { prefixed = true; s = stripped; }
  s = s.replace(/[?=]+$/g, "").trim();

  // "15% of 2000" / "15% ya 2000"
  const pm = s.match(/^(\d+(?:[.,]\d+)?)\s*%\s*(?:of|ya|za|wa|y')\s*(\d+(?:[.,]\d+)?)$/);
  if (pm) {
    const a = parseFloat(pm[1].replace(",", ".")), b = parseFloat(pm[2].replace(",", "."));
    return { expr: `${pm[1]}% × ${pm[2]}`, value: a / 100 * b };
  }

  s = s
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\b(plus|ongeraho|hamwe na)\b/g, "+")
    .replace(/\b(minus|kuramo|ukuyemo)\b/g, "-")
    .replace(/\b(times|multiplied by|kugwiza|gwiza)\b/g, "*")
    .replace(/\b(divided by|gabanya kuri|gabanya)\b/g, "/")
    .replace(/(?<=[\d)])\s*[x×]\s*(?=[\d(])/g, "*")
    .replace(/×/g, "*").replace(/÷/g, "/")
    .replace(/\s+/g, " ").trim();

  if (!/^[\d+\-*\/^().%\s]+$/.test(s)) return null;
  if (!/\d/.test(s)) return null;
  if (!prefixed && !/[+*\/^%()]|\s-\s/.test(s)) return null;     // "2024-2025" is not a sum
  if (!/[+\-*\/^%]/.test(s)) return null;

  try {
    const value = mifasaEvalExpr(s.replace(/\s+/g, ""));
    if (!isFinite(value)) return { error: "range" };
    return { expr: s.replace(/\*/g, " × ").replace(/\//g, " ÷ ").replace(/\s+/g, " ").trim(), value };
  } catch (e) {
    return { error: e.message === "div0" ? "div0" : "syntax" };
  }
}

/* ---- date & time (Rwanda time) ---- */
const MIFASA_DAYS_RW = ["ku cyumweru", "kuwa mbere", "kuwa kabiri", "kuwa gatatu", "kuwa kane", "kuwa gatanu", "kuwa gatandatu"];
const MIFASA_MONTHS_RW = ["Mutarama", "Gashyantare", "Werurwe", "Mata", "Gicurasi", "Kamena", "Nyakanga", "Kanama", "Nzeri", "Ukwakira", "Ugushyingo", "Ukuboza"];
const MIFASA_DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MIFASA_MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function kigaliNow() {
  try {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Kigali" }));
  } catch (e) { return new Date(); }
}

const MIFASA_TIME_RE = /^(isaha (ni )?ingahe|saa ngahe|ni saa ngahe|isaha y'ubu|what time is it|what's the time|what is the time|whats the time|current time|time now|time)$/;
const MIFASA_DATE_RE = /^(itariki (ni )?ingahe|itariki y'uyu munsi|itariki yuyu munsi|uyu munsi ni itariki ingahe|uyu munsi ni uwuhe munsi|ni uwuhe munsi|today's date|todays date|what's the date|what is the date|what is today's date|what's today's date|whats the date|what day is it|what day is today|the date|date today|today)$/;

function tryDateTime(raw) {
  const n = mifasaNorm(raw);
  const isTime = MIFASA_TIME_RE.test(n);
  const isDate = MIFASA_DATE_RE.test(n);
  if (!isTime && !isDate) return null;
  const d = kigaliNow();
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  const rwDate = `${MIFASA_DAYS_RW[d.getDay()]}, ${d.getDate()} ${MIFASA_MONTHS_RW[d.getMonth()]} ${d.getFullYear()}`;
  const enDate = `${MIFASA_DAYS_EN[d.getDay()]}, ${d.getDate()} ${MIFASA_MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
  if (isTime) {
    return { rw: `🕒 Ubu ni saa **${hh}:${mm}** (isaha y'u Rwanda).`, en: `🕒 It's **${hh}:${mm}** in Rwanda right now.` };
  }
  return { rw: `📅 Uyu munsi ni **${rwDate}**.`, en: `📅 Today is **${enDate}**.` };
}

/* ---- compare "A vs B" ---- */
const MIFASA_COMPARE_RES = [
  /^(?:compare|gereranya|difference between|itandukaniro (?:rya|hagati ya|ry'))\s*(.+?)\s+(?:and|na|with|vs|versus)\s+(.+)$/,
  /^(.+?)\s+(?:vs|versus)\s+(.+)$/
];

function tryCompare(raw) {
  const n = mifasaNorm(raw);
  if (n.split(" ").length > 12) return null;
  for (const re of MIFASA_COMPARE_RES) {
    const m = n.match(re);
    if (m) return { a: m[1].trim(), b: m[2].trim() };
  }
  return null;
}

function compareSide(label) {
  const s = mifasaSearch(label, 6);
  if (!s.hits.length) return null;
  const sents = pickAnswerSentences(s, s.hits.slice(0, 2), label);
  const top = s.hits[0].article;
  let line = sents[0] || getSummary(top);
  if (!line || line === MIFASA_NO_SUMMARY) line = "";
  return { title: getTitle(top), line: String(line).slice(0, 320) };
}

function buildComparison(c) {
  const A = compareSide(c.a), B = compareSide(c.b);
  const rwHead = `🤖 **MIFASA AI**\n\n⚖️ Gereranya **${c.a}** na **${c.b}**:\n`;
  const enHead = `🤖 **MIFASA AI**\n\n⚖️ Comparing **${c.a}** and **${c.b}**:\n`;
  if (!A && !B) return { rw: `${rwHead}\nNta makuru ahagije mbona ku mpande zombi ubu.`, en: `${enHead}\nI couldn't find enough on either side yet.` };
  const fmt = (lab, x) => x ? `\n📌 **${lab}** — ${x.title}\n${x.line || ""}` : "";
  const missRw = (lab, x) => x ? "" : `\n📌 **${lab}** — nta makuru ahagije nabonye.`;
  const missEn = (lab, x) => x ? "" : `\n📌 **${lab}** — I didn't find enough on this one.`;
  return {
    rw: rwHead + fmt(c.a, A) + missRw(c.a, A) + fmt(c.b, B) + missRw(c.b, B),
    en: enHead + fmt(c.a, A) + missEn(c.a, A) + fmt(c.b, B) + missEn(c.b, B)
  };
}

/* ---------------------------------------------------------- */
/* 9c-2. EXTRA TOOLS (v5.1): converter, dates & age, number words */
/*       Each tool returns { rw, en } or null. They run BEFORE the */
/*       brain (see mifasaPrecise) because they need real numbers. */
/* ---------------------------------------------------------- */

// ---- A. UNIT & CURRENCY CONVERTER ----------------------------
// Rates are APPROXIMATE (1 USD = ...). Edit here, or set
//   window.MIFASA_RATES = { updated: "2026-11-01", perUSD: { USD:1, RWF:1480, KES:129 } }
// in the page BEFORE script.js loads. Currencies listed in MIFASA_CUR_ALIASES
// but missing from perUSD get a polite "no rate yet" answer.
const MIFASA_RATES = (typeof window !== "undefined" && window.MIFASA_RATES) || {
  updated: "2026-10-02",
  perUSD: { USD: 1, RWF: 1476, EUR: 0.876, GBP: 0.744 }   // add KES, UGX, TZS, BIF, CDF... when you have verified rates
};

const MIFASA_CUR_ALIASES = {
  USD: ["usd", "dollar", "dollars", "us dollar", "us dollars", "dolari", "amadolari", "idolari"],
  RWF: ["rwf", "frw", "rwandan franc", "rwandan francs", "franc", "francs", "ifaranga", "amafaranga", "amafaranga y'u rwanda"],
  EUR: ["eur", "euro", "euros", "ama euro", "ayero"],
  GBP: ["gbp", "sterling", "british pound", "british pounds", "pound sterling"],
  KES: ["kes", "kenyan shilling", "kenyan shillings"],
  UGX: ["ugx", "ugandan shilling", "ugandan shillings"],
  TZS: ["tzs", "tanzanian shilling", "tanzanian shillings"],
  BIF: ["bif", "burundian franc", "burundian francs"],
  CDF: ["cdf", "congolese franc", "congolese francs"]
};

// [category, label, factor to base unit, aliases]
const MIFASA_UNITS = [
  ["length", "m", 1, ["m", "meter", "meters", "metre", "metres", "metero"]],
  ["length", "km", 1000, ["km", "kms", "kilometer", "kilometers", "kilometre", "kilometres", "kilometero"]],
  ["length", "cm", 0.01, ["cm", "centimeter", "centimeters", "centimetre", "centimetres", "santimetero"]],
  ["length", "mm", 0.001, ["mm", "millimeter", "millimeters", "millimetre", "millimetres", "milimetero"]],
  ["length", "miles", 1609.344, ["mi", "mile", "miles"]],
  ["length", "yards", 0.9144, ["yd", "yds", "yard", "yards"]],
  ["length", "ft", 0.3048, ["ft", "foot", "feet", "fit"]],
  ["length", "inches", 0.0254, ["inch", "inches"]],
  ["mass", "kg", 1, ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramu"]],
  ["mass", "g", 0.001, ["g", "gram", "grams", "garama"]],
  ["mass", "lb", 0.45359237, ["lb", "lbs", "pound", "pounds", "pawundi"]],
  ["mass", "oz", 0.028349523125, ["oz", "ounce", "ounces"]],
  ["mass", "tonnes", 1000, ["t", "tonne", "tonnes", "ton", "tons", "toni"]],
  ["volume", "L", 1, ["l", "lt", "litre", "litres", "liter", "liters", "litiro"]],
  ["volume", "mL", 0.001, ["ml", "millilitre", "millilitres", "milliliter", "milliliters", "mililitiro"]],
  ["volume", "gallons", 3.785411784, ["gal", "gallon", "gallons"]],
  ["area", "m²", 1, ["m2", "sqm", "sq m", "square meter", "square meters", "square metre", "square metres"]],
  ["area", "km²", 1e6, ["km2", "sq km", "square kilometer", "square kilometers", "square kilometre", "square kilometres"]],
  ["area", "ha", 10000, ["ha", "hectare", "hectares", "hegitari"]],
  ["area", "acres", 4046.8564224, ["acre", "acres", "akeri"]],
  ["speed", "km/h", 1 / 3.6, ["km/h", "kmh", "kph", "kmph"]],
  ["speed", "mph", 0.44704, ["mph"]],
  ["speed", "m/s", 1, ["m/s", "mps"]],
  ["time", "seconds", 1, ["s", "sec", "secs", "second", "seconds", "isegonda", "amasegonda"]],
  ["time", "minutes", 60, ["min", "mins", "minute", "minutes", "umunota", "iminota"]],
  ["time", "hours", 3600, ["h", "hr", "hrs", "hour", "hours", "isaha", "amasaha"]],
  ["time", "days", 86400, ["day", "days", "umunsi", "iminsi"]],
  ["time", "weeks", 604800, ["week", "weeks", "icyumweru", "ibyumweru"]]
];
const MIFASA_TEMPS = [
  ["C", "°C", ["c", "celsius", "centigrade", "selisiyusi"]],
  ["F", "°F", ["f", "fahrenheit", "farenayiti"]],
  ["K", "K", ["k", "kelvin"]]
];

let mifasaUnitMap = null;
function mifasaBuildUnitMap() {
  const m = new Map();
  MIFASA_UNITS.forEach(u => u[3].forEach(a => m.set(a, { kind: "unit", cat: u[0], label: u[1], f: u[2] })));
  MIFASA_TEMPS.forEach(t => t[2].forEach(a => m.set(a, { kind: "temp", code: t[0], label: t[1] })));
  Object.keys(MIFASA_CUR_ALIASES).forEach(code => MIFASA_CUR_ALIASES[code].forEach(a => m.set(a, { kind: "cur", code, label: code })));
  return m;
}
function mifasaFindUnit(str) {
  if (!mifasaUnitMap) mifasaUnitMap = mifasaBuildUnitMap();
  const k = String(str || "").trim().replace(/\.$/, "").replace(/\s+/g, " ");
  return mifasaUnitMap.get(k) || null;
}

function mifasaFmtConv(n, isCur, code) {
  if (!isFinite(n)) return String(n);
  const a = Math.abs(n);
  const d = isCur ? (code === "RWF" && a >= 1 ? 0 : (a >= 1 ? 2 : 6)) : (a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8);
  return Number(n.toFixed(d)).toLocaleString("en-US", { maximumFractionDigits: d });
}

function tryConvert(raw) {
  let s = String(raw || "").toLowerCase().trim();
  if (!s || s.length > 90) return null;
  s = s.replace(/[?!]+$/, "")
    .replace(/\$\s*(\d[\d.,]*)/g, "$1 usd")
    .replace(/€\s*(\d[\d.,]*)/g, "$1 eur")
    .replace(/£\s*(\d[\d.,]*)/g, "$1 gbp")
    .replace(/°/g, "").replace(/\b(degrees?|dogere)\b/g, "")
    .replace(/^(?:please |nyabuneka )?(?:convert|hindura|guhindura|kuhindura)\s+/, "")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s+/g, " ").trim();

  const NUM = "(-?\\d+(?:\\.\\d+)?)";
  const UNIT = "([a-z][a-z0-9/²' ]*?)";
  let value, fromStr, toStr, m;

  // "5 km to miles" / "5 km muri miles" / "50 usd ni angahe muri rwf"
  m = s.match(new RegExp(`^${NUM}\\s*${UNIT}\\s+(?:ni\\s+(?:angahe|ingahe|zingahe|bingahe)\\s+)?(?:to|in|into|as|muri|mu|=)\\s+([a-z][a-z0-9/²' ]*)$`));
  if (m) { value = parseFloat(m[1]); fromStr = m[2]; toStr = m[3]; }
  else {
    // "how many miles in 5 km"
    m = s.match(new RegExp(`^how (?:many|much) ([a-z][a-z0-9/²' ]*?) (?:is|are|in|is in|are in) ${NUM}\\s*([a-z][a-z0-9/²' ]*)$`));
    if (m) { toStr = m[1]; value = parseFloat(m[2]); fromStr = m[3]; }
  }
  if (!m || !isFinite(value)) return null;

  const a = mifasaFindUnit(fromStr), b = mifasaFindUnit(toStr);
  if (!a || !b) return null;                         // not a conversion we understand -> leave it to the search

  const lab = (u, v) => u.kind === "cur" ? u.code : u.label;
  const fmtIn = mifasaFmtConv(value, a.kind === "cur", a.code);

  if (a.kind !== b.kind || (a.kind === "unit" && a.cat !== b.cat)) {
    return {
      rw: `📏 Sinshobora guhindura **${lab(a)}** muri **${lab(b)}** kuko ari ibipimo bitandukanye.`,
      en: `📏 I can't convert **${lab(a)}** to **${lab(b)}** because they measure different things.`
    };
  }

  let out, note = null, isCur = false;
  if (a.kind === "temp") {
    const toC = { C: v => v, F: v => (v - 32) * 5 / 9, K: v => v - 273.15 }[a.code](value);
    if (toC < -273.15) return { rw: "🌡️ Ubushyuhe buri munsi ya zero ntarengwa (-273.15 °C) ntibushoboka.", en: "🌡️ That's below absolute zero (-273.15 °C), which isn't possible." };
    out = { C: v => v, F: v => v * 9 / 5 + 32, K: v => v + 273.15 }[b.code](toC);
  } else if (a.kind === "cur") {
    const r = MIFASA_RATES.perUSD || {};
    if (!r[a.code] || !r[b.code]) {
      const miss = !r[a.code] ? a.code : b.code;
      return {
        rw: `💱 Nta giciro cya **${miss}** mfite ubu. Mfite: ${Object.keys(r).join(", ")}.`,
        en: `💱 I don't have a rate for **${miss}** yet. I can do: ${Object.keys(r).join(", ")}.`
      };
    }
    out = value / r[a.code] * r[b.code];
    isCur = true;
    const one = mifasaFmtConv(r[b.code] / r[a.code], true, b.code);
    note = {
      rw: `\n💱 1 ${a.code} ≈ ${one} ${b.code} · ibiciro bigereranyije (${MIFASA_RATES.updated}); kubona igiciro nyacyo reba banki cyangwa Mobile Money.`,
      en: `\n💱 1 ${a.code} ≈ ${one} ${b.code} · approximate rate (${MIFASA_RATES.updated}); check your bank or mobile money for the exact rate.`
    };
  } else {
    out = value * a.f / b.f;
  }
  const line = `${a.kind === "cur" ? "💱" : a.kind === "temp" ? "🌡️" : "📏"} ${fmtIn} ${lab(a)} = **${mifasaFmtConv(out, isCur, b.code)} ${lab(b)}**`;
  return { rw: line + (note ? note.rw : ""), en: line + (note ? note.en : "") };
}

// ---- B. DATES: age, countdown, difference ---------------------
const MIFASA_MON_MAP = (() => {
  const mm = {};
  const add = (names, i) => names.forEach(n => { mm[n] = i; });
  add(["mutarama", "january", "jan"], 1);   add(["gashyantare", "february", "feb"], 2);
  add(["werurwe", "march", "mar"], 3);      add(["mata", "april", "apr"], 4);
  add(["gicurasi", "may"], 5);              add(["kamena", "june", "jun"], 6);
  add(["nyakanga", "july", "jul"], 7);      add(["kanama", "august", "aug"], 8);
  add(["nzeri", "september", "sept", "sep"], 9); add(["ukwakira", "october", "oct"], 10);
  add(["ugushyingo", "november", "nov"], 11); add(["ukuboza", "december", "dec"], 12);
  return mm;
})();
const MIFASA_MON_RE = Object.keys(MIFASA_MON_MAP).sort((a, b) => b.length - a.length).join("|");

const MIFASA_EVENTS = [
  { keys: ["ubwigenge", "independence"], m: 7, d: 1, rw: "Umunsi w'Ubwigenge", en: "Independence Day" },
  { keys: ["kwibohora", "liberation"], m: 7, d: 4, rw: "Umunsi wo Kwibohora", en: "Liberation Day" },
  { keys: ["intwari", "heroes"], m: 2, d: 1, rw: "Umunsi w'Intwari", en: "Heroes' Day" },
  { keys: ["kwibuka", "commemoration"], m: 4, d: 7, rw: "Kwibuka", en: "Kwibuka (7 April)" },
  { keys: ["noheli", "christmas"], m: 12, d: 25, rw: "Noheli", en: "Christmas" },
  { keys: ["umwaka mushya", "new year"], m: 1, d: 1, rw: "Umwaka Mushya", en: "New Year" },
  { keys: ["umuganura", "harvest"], m: 8, d: 0, rw: "Umuganura", en: "Umuganura", firstFriday: true }
];

function mifasaTodayTs() {
  const d = kigaliNow();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}
function mifasaYMD(ts) { const d = new Date(ts); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; }
function mifasaValidDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function mifasaFirstFriday(y, m) {
  for (let d = 1; d <= 7; d++) { if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 5) return d; }
  return 1;
}
function mifasaDiffYMD(fromTs, toTs) {
  const [y1, m1, d1] = mifasaYMD(fromTs), [y2, m2, d2] = mifasaYMD(toTs);
  let y = y2 - y1, m = m2 - m1, d = d2 - d1;
  if (d < 0) { m--; d += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  return { y, m, d };
}

// finds dates anywhere in the text; each: { y|null, m|null, d|null, idx }
function mifasaFindDates(text) {
  const s = String(text || "").toLowerCase().replace(/[’`]/g, "'");
  const claimed = new Array(s.length).fill(false);
  const found = [];
  const free = (a, b) => { for (let i = a; i < b; i++) if (claimed[i]) return false; return true; };
  const take = (mt, y, m, d) => {
    const a = mt.index, b = mt.index + mt[0].length;
    if (!free(a, b)) return;
    if (m != null && (m < 1 || m > 12)) return;
    if (d != null && y != null && m != null && !mifasaValidDate(y, m, d)) return;
    if (d != null && m != null && y == null && !mifasaValidDate(2000, m, d)) return;   // 2000 is a leap year
    for (let i = a; i < b; i++) claimed[i] = true;
    found.push({ y, m, d, idx: a });
  };
  const P = [
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, mt => [+mt[1], +mt[2], +mt[3]]],
    [/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/g, mt => [+mt[3], +mt[2], +mt[1]]],
    [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MIFASA_MON_RE})\\b(?:\\s*(?:,|ya|mu|muri|of)?\\s*(\\d{4})\\b)?`, "g"), mt => [mt[3] ? +mt[3] : null, MIFASA_MON_MAP[mt[2]], +mt[1]]],
    [new RegExp(`\\b(${MIFASA_MON_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "g"), mt => [+mt[3], MIFASA_MON_MAP[mt[1]], +mt[2]]],
    [new RegExp(`\\b(${MIFASA_MON_RE})\\s*(?:ya\\s+|mu\\s+|of\\s+|,\\s*)?(\\d{4})\\b`, "g"), mt => [+mt[2], MIFASA_MON_MAP[mt[1]], null]],
    [/\b(19\d\d|20\d\d)\b/g, mt => [+mt[1], null, null]]
  ];
  P.forEach(([re, pick]) => { let mt; while ((mt = re.exec(s))) { const [y, m, d] = pick(mt); take(mt, y, m, d); } });
  return found.sort((a, b) => a.idx - b.idx);
}

function mifasaPlural(n, one, many) { return n === 1 ? one : many; }
function mifasaFmtYMD(df) {
  return {
    rw: `imyaka ${df.y}, amezi ${df.m} n'iminsi ${df.d}`,
    en: `${df.y} ${mifasaPlural(df.y, "year", "years")}, ${df.m} ${mifasaPlural(df.m, "month", "months")} and ${df.d} ${mifasaPlural(df.d, "day", "days")}`
  };
}
function mifasaDateLabel(ts) {
  const [y, m, d] = mifasaYMD(ts);
  return { rw: `${d} ${MIFASA_MONTHS_RW[m - 1]} ${y}`, en: `${d} ${MIFASA_MONTHS_EN[m - 1]} ${y}` };
}

function tryDates(raw) {
  const text = String(raw || "").toLowerCase().replace(/[’`]/g, "'").trim();
  if (!text || text.length > 140) return null;
  const n = mifasaNorm(text);
  const today = mifasaTodayTs();
  const [ty] = mifasaYMD(today);
  const dates = mifasaFindDates(text);

  // 1) AGE: "mfite imyaka ingahe navutse 12 mata 2001" / "how old am i, born 2001"
  const askAge = /\b(imyaka|age|how old|old am i|old is)\b/.test(n);
  const bornWord = /\b(navutse|navukiye|nabyawe|yavutse|amavuko|born|birth|birthday|dob)\b/.test(n);
  if (askAge && bornWord && dates.length) {
    const b = dates[0];
    if (b.y == null) return null;
    if (b.y > ty || b.y < 1900) return { rw: "🎂 Umwaka wavutsemo ntumvikana. Gerageza nka **navutse 12 Mata 2001**.", en: "🎂 That birth year doesn't look right. Try something like **born 12 April 2001**." };
    if (b.m && b.d) {
      const birth = Date.UTC(b.y, b.m - 1, b.d);
      if (birth > today) return { rw: "🎂 Iyo tariki iracyari mu gihe kizaza. 🙂", en: "🎂 That date is still in the future. 🙂" };
      const df = mifasaDiffYMD(birth, today), f = mifasaFmtYMD(df);
      let nb = Date.UTC(ty, b.m - 1, b.d); if (nb < today) nb = Date.UTC(ty + 1, b.m - 1, b.d);
      const left = Math.round((nb - today) / 86400000);
      const bl = mifasaDateLabel(birth);
      const extraRw = left === 0 ? "\n🎉 Uyu munsi ni isabukuru yawe! Isabukuru nziza!" : `\n🎈 Isabukuru yawe ikurikira iri mu minsi **${left}**.`;
      const extraEn = left === 0 ? "\n🎉 Today is your birthday! Happy birthday!" : `\n🎈 Your next birthday is in **${left}** ${mifasaPlural(left, "day", "days")}.`;
      return {
        rw: `🎂 Wavutse ku itariki ya ${bl.rw}, none ufite imyaka **${df.y}** (${f.rw}).${extraRw}`,
        en: `🎂 Born ${bl.en}, you are **${df.y}** years old (${f.en}).${extraEn}`
      };
    }
    const hi = ty - b.y, lo = hi - 1;
    return {
      rw: `🎂 Wavutse mu **${b.y}**: ufite imyaka **${lo}** cyangwa **${hi}**, bitewe n'ko isabukuru yawe y'uyu mwaka yarenze cyangwa itaragera. Ongeraho itariki yose (urugero **12 Mata ${b.y}**) mbone imyaka nyayo.`,
      en: `🎂 Born in **${b.y}**: you are **${lo}** or **${hi}**, depending on whether your birthday has passed this year. Add the full date (e.g. **12 April ${b.y}**) and I'll be exact.`
    };
  }

  const countWord = /\b(hasigaye|isigaye|ngo|iminsi ingahe|days? (?:until|to|till|left|before|since|between|from)|how many days|countdown|hagati ya|itandukaniro ry'iminsi|days between)\b/.test(n);
  if (!countWord) return null;

  // 2) DIFFERENCE between two dates
  if (dates.length >= 2) {
    const mk = d => (d.m && d.d) ? Date.UTC(d.y == null ? ty : d.y, d.m - 1, d.d) : null;
    const a = mk(dates[0]), b = mk(dates[1]);
    if (a == null || b == null) return null;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const days = Math.round((hi - lo) / 86400000), f = mifasaFmtYMD(mifasaDiffYMD(lo, hi));
    const la = mifasaDateLabel(lo), lb = mifasaDateLabel(hi);
    return {
      rw: `📅 Hagati ya **${la.rw}** na **${lb.rw}** hari iminsi **${days.toLocaleString("en-US")}** (${f.rw}).`,
      en: `📅 Between **${la.en}** and **${lb.en}** there are **${days.toLocaleString("en-US")}** days (${f.en}).`
    };
  }

  // 3) COUNTDOWN to / since ONE date or a known event
  let target = null, label = null, tY = null;
  if (dates.length === 1 && dates[0].m && dates[0].d) {
    const d = dates[0];
    if (d.y != null) target = Date.UTC(d.y, d.m - 1, d.d);
    else { target = Date.UTC(ty, d.m - 1, d.d); if (target < today) target = Date.UTC(ty + 1, d.m - 1, d.d); }
  } else if (!dates.some(d => d.m && d.d)) {
    for (const ev of MIFASA_EVENTS) {
      if (ev.keys.some(k => n.includes(k))) {
        const at = y => Date.UTC(y, ev.m - 1, ev.firstFriday ? mifasaFirstFriday(y, ev.m) : ev.d);
        target = at(ty); if (target < today) target = at(ty + 1);
        label = ev; break;
      }
    }
  }
  if (target == null) return null;
  const days = Math.round((target - today) / 86400000);
  const tl = mifasaDateLabel(target);
  const nameRw = label ? `**${label.rw}** (${tl.rw})` : `**${tl.rw}**`;
  const nameEn = label ? `**${label.en}** (${tl.en})` : `**${tl.en}**`;
  if (days === 0) return { rw: `📅 ${nameRw} ni uyu munsi! 🎉`, en: `📅 ${nameEn} is today! 🎉` };
  const abs = Math.abs(days), wk = Math.floor(abs / 7), rest = abs % 7;
  const wRw = abs >= 7 ? ` (ibyumweru ${wk} n'iminsi ${rest})` : "";
  const wEn = abs >= 7 ? ` (${wk} ${mifasaPlural(wk, "week", "weeks")} and ${rest} ${mifasaPlural(rest, "day", "days")})` : "";
  if (days > 0) return { rw: `⏳ Kugeza kuri ${nameRw} hasigaye iminsi **${days.toLocaleString("en-US")}**${wRw}.`, en: `⏳ ${nameEn} is in **${days.toLocaleString("en-US")}** ${mifasaPlural(days, "day", "days")}${wEn}.` };
  return { rw: `📅 ${nameRw} yarangiye mu minsi **${abs.toLocaleString("en-US")}** ishize${wRw}.`, en: `📅 ${nameEn} was **${abs.toLocaleString("en-US")}** ${mifasaPlural(abs, "day", "days")} ago${wEn}.` };
}

// ---- C. NUMBERS IN KINYARWANDA WORDS --------------------------
const MIFASA_RW_UNITS = {
  def: ["", "rimwe", "kabiri", "gatatu", "kane", "gatanu", "gatandatu", "karindwi", "umunani", "icyenda"],
  c8: ["", "kimwe", "bibiri", "bitatu", "bine", "bitanu", "bitandatu", "birindwi", "umunani", "icyenda"],   // with ibihumbi
  c9: ["", "imwe", "ebyiri", "eshatu", "enye", "eshanu", "esheshatu", "indwi", "umunani", "icyenda"]       // with miliyoni / miliyari
};
const MIFASA_RW_TENS = ["", "icumi", "makumyabiri", "mirongo itatu", "mirongo ine", "mirongo itanu", "mirongo itandatu", "mirongo irindwi", "mirongo inani", "mirongo cyenda"];
const MIFASA_RW_HUND = ["", "ijana", "magana abiri", "magana atatu", "magana ane", "magana atanu", "magana atandatu", "magana arindwi", "magana inani", "magana cyenda"];

function mifasaRwJoin(parts) {
  let out = parts[0] || "";
  for (let i = 1; i < parts.length; i++) out += (/^[aeiou]/.test(parts[i]) ? " n'" : " na ") + parts[i];
  return out;
}
function mifasaRwUnder1000(n, cls) {
  const parts = [], h = Math.floor(n / 100), r = n % 100, t = Math.floor(r / 10), u = r % 10;
  if (h) parts.push(MIFASA_RW_HUND[h]);
  if (r === 10) parts.push("icumi");
  else if (r > 10 && r < 20) { const x = MIFASA_RW_UNITS[cls][u]; parts.push("cumi " + (/^[aeiou]/.test(x) ? "n'" : "na ") + x); }
  else if (r >= 20) { parts.push(MIFASA_RW_TENS[t]); if (u) parts.push(MIFASA_RW_UNITS[cls][u]); }
  else if (r > 0) parts.push(MIFASA_RW_UNITS[cls][u]);
  return mifasaRwJoin(parts);
}
function mifasaRwNumber(n) {
  if (n === 0) return "zeru";
  const b = Math.floor(n / 1e9), m = Math.floor((n % 1e9) / 1e6), t = Math.floor((n % 1e6) / 1e3), r = n % 1000, parts = [];
  if (b) parts.push("miliyari " + mifasaRwUnder1000(b, "c9"));
  if (m) parts.push("miliyoni " + mifasaRwUnder1000(m, "c9"));
  if (t) parts.push(t === 1 ? "igihumbi" : "ibihumbi " + mifasaRwUnder1000(t, "c8"));
  if (r) parts.push(mifasaRwUnder1000(r, "def"));
  return mifasaRwJoin(parts);
}

function tryNumberWords(raw) {
  const s = String(raw || "").toLowerCase().trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
  if (!s || s.length > 80) return null;
  const m = s.match(/^(?:(?:andika|write|say|spell|vuga|number|umubare wa|umubare|how do you say|how to say|how to write|how do you write|ni gute handika|ni gute bavuga)\s+)?(\d{1,3}(?:[, ]\d{3})+|\d{1,12})\s+(?:mu magambo|mu kinyarwanda|mu nyuguti|in words|in kinyarwanda(?: words)?|in rw)(?:\s+ni iki)?$/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[, ]/g, ""), 10);
  if (!isFinite(n) || n >= 1e12) return { rw: "🔢 Uwo mubare ni munini cyane kuri njye. Gerageza uri munsi ya miliyari 1000.", en: "🔢 That number is too large for me. Try one below a trillion." };
  const shown = n.toLocaleString("en-US");
  const words = mifasaRwNumber(n);
  return { rw: `🔢 **${shown}** mu Kinyarwanda ni **${words}**.`, en: `🔢 **${shown}** in Kinyarwanda is **${words}**.` };
}

/* ---------------------------------------------------------- */
/* 9d. SITE AWARENESS, NEWS ANALYSIS, ENGLISH BRIDGE (v8)     */
/* ---------------------------------------------------------- */

// ---- A. Known websites: what they are, and age cautions. Adult sites are never opened or linked.
const MIFASA_ADULT_BRANDS = ["xvideos", "xnxx", "pornhub", "xhamster", "redtube", "youporn", "spankbang", "brazzers", "onlyfans", "chaturbate", "stripchat", "porntrex", "eporner", "tube8", "porn", "xxx", "hentai"];
function mifasaHostAdult(host) {
  const h = String(host || "").toLowerCase();
  const labels = h.split(/[.\-]/);
  return MIFASA_ADULT_BRANDS.some(b => b.length >= 4 ? h.indexOf(b) > -1 : labels.indexOf(b) > -1) || labels.indexOf("sex") > -1;
}
const MIFASA_SITE_INFO = {
  facebook:  { rw: "urubuga nkoranyambaga rwashinzwe mu 2004, ubu rufitwe na Meta", en: "a social network founded in 2004, now owned by Meta", social: 1 },
  instagram: { rw: "urubuga rwo gusangiza amafoto n'amashusho, rufitwe na Meta", en: "a photo and video sharing app owned by Meta", social: 1 },
  whatsapp:  { rw: "porogaramu yo guhererekanya ubutumwa n'amajwi, ifitwe na Meta", en: "a messaging and calling app owned by Meta", social: 1 },
  tiktok:    { rw: "porogaramu yo gusangiza amashusho magufi, ya sosiyete ByteDance", en: "a short-video app made by ByteDance", social: 1 },
  youtube:   { rw: "urubuga rwo kureba no gusangiza amashusho, rufitwe na Google", en: "a video sharing platform owned by Google", social: 1 },
  twitter:   { rw: "urubuga nkoranyambaga rwiswe X ubu, rwahoze rwitwa Twitter", en: "the social network now called X, formerly Twitter", social: 1 },
  telegram:  { rw: "porogaramu yo guhererekanya ubutumwa", en: "a messaging app", social: 1 },
  snapchat:  { rw: "porogaramu yo gusangiza amafoto n'amashusho by'igihe gito", en: "a photo and short-lived video sharing app", social: 1 },
  linkedin:  { rw: "urubuga nkoranyambaga rw'abakozi n'akazi, rufitwe na Microsoft", en: "a professional networking site owned by Microsoft" },
  google:    { rw: "moteri ishakisha ku murandasi ya sosiyete Google", en: "the web search engine made by Google" },
  wikipedia: { rw: "inkoranyamagambo y'ubumenyi y'ubuntu ku murandasi, iyoborwa na Wikimedia Foundation", en: "a free online encyclopedia run by the Wikimedia Foundation" },
  github:    { rw: "urubuga rubika kandi rugasangiza code za porogaramu, rufitwe na Microsoft", en: "a platform for hosting and sharing source code, owned by Microsoft" },
  netflix:   { rw: "urubuga rwo kureba filimi n'ibiganiro mu buryo bwo kwishyura buri kwezi", en: "a subscription streaming service for films and series" },
  amazon:    { rw: "urubuga runini rwo kugura no kugurisha ku murandasi, rufite na serivisi za cloud", en: "a large online store that also runs cloud services" }
};
const MIFASA_BET_BRANDS = ["betway", "sportpesa", "1xbet", "bet365", "betpawa", "mozzartbet", "melbet", "betika", "22bet", "parimatch"];
const MIFASA_SITE_FILLER = new Set(["ni", "iki", "what", "is", "urubuga", "rwa", "website", "site", "about", "ibyerekeye", "sobanura", "mbwira", "kuri", "tell", "me", "link", "ya", "com", "www", "https", "http", "org", "net", "tv", "explain", "mu", "gihe", "ruvuga", "iki", "ruhe", "rukora", "rukora", "ni", "ese", "is", "the", "a"]);
function trySiteInfo(raw) {
  const q = mifasaNorm(String(raw || "")).replace(/[./]/g, " ");
  const toks = q.split(" ").filter(Boolean);
  if (!toks.length || toks.length > 12) return null;
  const core = toks.filter(t => !MIFASA_SITE_FILLER.has(t));
  const adult = MIFASA_ADULT_BRANDS.find(b => b.length >= 4 ? toks.some(t => t.indexOf(b) > -1) : toks.indexOf(b) > -1);
  if (adult && !((adult.length < 4 || adult === "porn" || adult === "hentai") && core.length > 2)) {   // a sentence about porn ("i watch porn too much") is a person asking for help, not a site lookup
    const name = adult.charAt(0).toUpperCase() + adult.slice(1);
    return {
      rw: `⚠️ **${name}** ni urubuga rutangaza amashusho y'abakuze (urukozasoni). Ni rumwe mu mbuga zivugwa ko zisurwa cyane ku isi, ariko **si byiza kururebaho utarageza imyaka 18**: rwagenewe abakuze gusa, kandi amashusho nk'ayo ashobora kugira ingaruka ku mitekerereze, ku mibanire no ku myitwarire, kandi mu bihugu byinshi amategeko abuza abatarageza imyaka y'ubukure kuyabona.\n\nSinshobora kurukingura, kuguha link yarwo cyangwa gusoma ibirurimo. Niba ufite ikibazo ku mubiri wawe, ku bwangavu cyangwa ku mibanire, mbaza — nzagusubiza mu buryo bwizewe, cyangwa wegere umubyeyi, umwarimu cyangwa umuganga wizeye.`,
      en: `⚠️ **${name}** is a website with adult video content. It is said to be among the most visited sites in the world, but it is **not appropriate for anyone under 18**: it is made for adults only, such content can affect thinking, relationships and behaviour, and many countries legally restrict minors from viewing it.\n\nI can't open it, give you its link, or read its content. If you have questions about your body, growing up or relationships, ask me — I'll answer in a safe way, or talk to a parent, teacher or a doctor you trust.`
    };
  }
  const isXcom = /\bx\.com\b/i.test(String(raw || ""));
  if (core.length !== 1 && !isXcom) return null;
  const t = isXcom ? "twitter" : core[0];
  const bet = MIFASA_BET_BRANDS.find(b => t === b || t.indexOf(b) > -1);
  if (bet) {
    return {
      rw: `🎲 **${bet}** ni urubuga rw'imikino y'amahirwe (betting). Rwagenewe abakuze gusa (**imyaka 18 no hejuru**). Uburyo bw'ayo mikino bushobora gutuma ubura amafaranga kandi bukaba ingeso igoye kureka. Niba ubishaka, shyiraho umupaka w'amafaranga wemerewe kandi wirinde kwiyambaza inguzanyo.`,
      en: `🎲 **${bet}** is a betting website for adults only (**18 and over**). Betting can lead to losing money and to habits that are hard to stop. If you do bet, set a strict spending limit and never borrow to gamble.`
    };
  }
  const info = MIFASA_SITE_INFO[t];
  if (info) {
    const ageRw = info.social ? " Imbuga nyinshi nk'iyi zisaba nibura imyaka 13 (hamwe ni 16); abana bakwiye kuyikoresha bayobowe n'umubyeyi." : "";
    const ageEn = info.social ? " Platforms like this usually require users to be at least 13 (16 in some places); younger children should use them with a parent's guidance." : "";
    const nm = t.charAt(0).toUpperCase() + t.slice(1);
    return { rw: `🌐 **${nm}** ni ${info.rw}.${ageRw}`, en: `🌐 **${nm}** is ${info.en}.${ageEn}` };
  }
  return null;
}

// ---- B. News analysis: summary, key points, who/where/when, tone, reliability signals (honest, rule-based)
const MIFASA_POS_WORDS = ["intsinzi", "gutsinda", "iterambere", "amahoro", "ibyishimo", "inyungu", "kunguka", "umutekano", "amahirwe", "gushimwa", "success", "growth", "peace", "win", "wins", "improve", "improved", "progress", "gain", "benefit", "record"];
const MIFASA_NEG_WORDS = ["intambara", "urupfu", "impanuka", "inzara", "ubukene", "igihombo", "ruswa", "umwuzure", "indwara", "kwiba", "ihohoterwa", "war", "death", "deaths", "killed", "accident", "crisis", "loss", "corruption", "flood", "disease", "attack", "collapse", "decline"];
const MIFASA_SENSATIONAL = ["shocking", "unbelievable", "you won't believe", "miracle", "secret", "exposed", "biteye ubwoba", "bidasanzwe", "uzatungurwa", "amabanga", "birakaze", "yatunguranye"];
const MIFASA_HEDGES = ["bivugwa", "ngo", "reportedly", "allegedly", "rumoured", "rumored", "ashobora", "birashoboka", "it is claimed", "some say"];
const MIFASA_ATTRIB = ["nk'uko", "yatangaje", "yavuze ko", "ibivugwa na", "according to", "said", "told", "announced", "stated", "yabwiye", "ministeri", "minisitiri", "police", "polisi", "raporo", "report"];
const MIFASA_PLACES = ["rwanda", "kigali", "uganda", "kenya", "tanzania", "burundi", "congo", "goma", "huye", "musanze", "rubavu", "rusizi", "nyagatare", "muhanga", "rwamagana", "afurika", "africa", "europe", "america", "china", "india", "france", "ubufaransa", "ubwongereza", "uk", "usa", "ukraine", "russia"];
function mifasaAnalyzeText(text, title) {
  const en = currentLang === "en";
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length < 80) return null;
  const sents = splitSentences(clean).filter(x => x.length > 25).slice(0, 80);
  if (!sents.length) return null;
  const words = clean.split(" ");
  const lc = " " + mifasaNorm(clean) + " ";
  const count = list => list.reduce((n, w) => n + (lc.split(" " + w + " ").length - 1), 0);
  const pos = count(MIFASA_POS_WORDS), neg = count(MIFASA_NEG_WORDS);
  const tone = neg > pos + 1 ? (en ? "mostly negative or worrying" : "ahanini habonetsemo ibibazo cyangwa ibitera impungenge")
    : pos > neg + 1 ? (en ? "mostly positive" : "ahanini harimo ibyiza")
    : (en ? "neutral / mixed" : "ntibyerekeza ku ruhande rumwe (hagati)");
  // key sentences: frequent content words + numbers + position
  const freq = new Map();
  tokenize(clean).filter(t => t.length > 3 && !MIFASA_STOP_WORDS.has(t)).forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
  const scored = sents.map((x, i) => {
    let sc = tokenize(x).reduce((n, t) => n + (freq.get(t) || 0), 0) / Math.sqrt(x.length);
    if (/\d/.test(x)) sc += 1.2;
    if (i === 0) sc += 1.5;
    return { x, i, sc };
  });
  const key = scored.sort((a, b) => b.sc - a.sc).slice(0, 3).sort((a, b) => a.i - b.i).map(o => o.x);
  // who / where / when / numbers
  const ents = {};
  (clean.match(/(?:^|[.!?]\s+|\s)([A-ZÀ-Ý][\p{L}'’-]{2,}(?:\s+[A-ZÀ-Ý][\p{L}'’-]{2,}){0,3})/gu) || []).forEach(m => {
    const e = m.replace(/^[.!?]?\s*/, "").trim();
    if (e.length > 2 && !/^(Ni|Iyo|Iyi|Iri|Uyu|Uru|Aba|Abo|Icyo|Ibyo|Ariko|Kandi|The|This|That|And|But|For|With|Mutarama|Gashyantare|Werurwe|Mata|Gicurasi|Kamena|Nyakanga|Kanama|Nzeri|Ukwakira|Ugushyingo|Ukuboza|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(e)) ents[e] = (ents[e] || 0) + 1;
  });
  const who = Object.keys(ents).filter(e => MIFASA_PLACES.indexOf(e.toLowerCase()) < 0).sort((a, b) => ents[b] - ents[a]).slice(0, 5);
  const where = MIFASA_PLACES.filter(pl => lc.indexOf(" " + pl + " ") > -1).slice(0, 4).map(pl => pl.charAt(0).toUpperCase() + pl.slice(1));
  const dates = (clean.match(/\b(\d{1,2}\s+(?:Mutarama|Gashyantare|Werurwe|Mata|Gicurasi|Kamena|Nyakanga|Kanama|Nzeri|Ukwakira|Ugushyingo|Ukuboza|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:Mutarama|Gashyantare|Werurwe|Mata|Gicurasi|Kamena|Nyakanga|Kanama|Nzeri|Ukwakira|Ugushyingo|Ukuboza|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|20\d{2})\b/gi) || []).slice(0, 3);
  const nums = (clean.match(/\b\d[\d.,]*\s?(?:%|FRW|RWF|USD|\$|million|miliyoni|miliyari|billion)?/gi) || []).map(x => x.trim().replace(/[.,]+$/, "")).filter(x => x.length > 1 && !/^20\d{2}$/.test(x)).slice(0, 5);
  // reliability signals
  const quotes = (clean.match(/["“«][^"”»]{12,}["”»]/g) || []).length;
  const attrib = count(MIFASA_ATTRIB), hedge = count(MIFASA_HEDGES), sens = count(MIFASA_SENSATIONAL);
  const caps = words.filter(w => w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w)).length;
  const excl = (clean.match(/!/g) || []).length;
  const flags = [];
  if (sens) flags.push(en ? "sensational wording" : "amagambo yo gukurura abantu cyane");
  if (caps > 4 || excl > 3) flags.push(en ? "lots of CAPITALS or exclamation marks" : "inyuguti nkuru cyangwa utwambu twinshi");
  if (hedge > 2) flags.push(en ? "many unconfirmed phrases (\"reportedly\", \"ngo\")" : "amagambo menshi y'ibitaremezwa (\"bivugwa\", \"ngo\")");
  if (!attrib && !quotes) flags.push(en ? "no named source or quote" : "nta nkomoko ivugwa cyangwa amagambo yavuzwe");
  if (words.length < 120) flags.push(en ? "very short text" : "inyandiko ngufi cyane");
  let score = 3 + (attrib ? 1 : 0) + (quotes ? 1 : 0) + (nums.length || dates.length ? 1 : 0) - flags.length;
  score = Math.max(1, Math.min(5, score));
  const label = [en ? "very weak" : "ntirimo gihamya", en ? "weak" : "rurakeya", en ? "fair" : "rurajyanye", en ? "good" : "rukomeye", en ? "strong" : "rukomeye cyane"][score - 1];
  const mins = Math.max(1, Math.round(words.length / 200));
  const b = (a) => a.length ? a.join(", ") : (en ? "not clear" : "ntibigaragara");
  const sig = "— Mifasa Mizero Fabrice Samuel · MIFASA AI";
  return en
    ? `🔎 **News analysis**${title ? ": " + title : ""}\n\n**Main points**\n${key.map(k => "• " + k).join("\n")}\n\n**Who / what:** ${b(who)}\n**Where:** ${b(where)}\n**When:** ${b(dates)}\n**Numbers:** ${b(nums)}\n\n**Tone:** ${tone}\n**Length:** about ${words.length} words (~${mins} min read)\n**Source signals:** ${attrib} attribution cue(s), ${quotes} quote(s)${flags.length ? "\n**Be careful about:** " + flags.join("; ") : ""}\n**Evidence strength of the text:** ${score}/5 (${label})\n\n_This is a rule-based reading of the text, not proof that it is true or false. To verify: find the original source and check 2 independent outlets._\n\n${sig}`
    : `🔎 **Ubusesenguzi bw'inkuru**${title ? ": " + title : ""}\n\n**Ingingo z'ingenzi**\n${key.map(k => "• " + k).join("\n")}\n\n**Bavugwaho:** ${b(who)}\n**Aho byabereye:** ${b(where)}\n**Igihe:** ${b(dates)}\n**Imibare:** ${b(nums)}\n\n**Imiterere y'inkuru:** ${tone}\n**Uburebure:** amagambo ~${words.length} (gusoma ~iminota ${mins})\n**Ibimenyetso by'inkomoko:** ${attrib} by'inkomoko, ${quotes} by'amagambo yavuzwe${flags.length ? "\n**Ibyo kwitondera:** " + flags.join("; ") : ""}\n**Imbaraga z'ibimenyetso mu nyandiko:** ${score}/5 (${label})\n\n_Ni isesengura rishingiye ku mategeko ryo gusoma inyandiko, si gihamya ko ari ukuri cyangwa ikinyoma. Kugenzura: shaka inkomoko y'ibanze, urebe ibitangazamakuru 2 bitandukanye._\n\n${sig}`;
}
const MIFASA_ANALYZE_CUE = /\b(sesengura|isesengure|ubusesenguzi|analy[sz]e|analysis|fact[- ]?check|verify|genzura)\b/i;
function tryNewsAnalysis(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^\s*(?:sesengura|isesengure|ubusesenguzi bwa|ubusesenguzi|analy[sz]e|analysis of|fact[- ]?check|genzura)\s+(?:iyi nkuru|iyi|this|the|inkuru|news|story|article)?\s*(?:ya|y'|about|on|:)?\s*(.+)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  if (mifasaExtractUrl(rest)) return null;                    // links are handled by the link reader
  if (rest.length >= 200) {                                     // pasted text
    const r = mifasaAnalyzeText(rest, "");
    return r ? { rw: r, en: r } : null;
  }
  if (!mifasaLoaded || rest.length < 3) return null;
  const hit = mifasaSearch(rest, 8).hits.filter(h => !h.article._core)[0];
  if (!hit) return null;
  const a = hit.article;
  const body = [a.content, a.body, a.text, a.description, getSummary(a)].filter(Boolean).join(". ");
  const r = mifasaAnalyzeText(body, getTitle(a));
  return r ? { rw: r, en: r } : null;
}

// ---- C. English bridge: Kinyarwanda words -> English using the dictionary, so the AI can reuse its English knowledge
let mifasaBridge = null;                 // Map: normalized Kinyarwanda word/phrase -> English (or "" to drop)
let mifasaBridgeMax = 1;
const MIFASA_EXTRA_DICT = [];            // entries added from dictionary.json
function mifasaBridgeBuild() {
  mifasaBridge = new Map(); mifasaBridgeMax = 1;
  const put = (rw, en) => {
    const k = mifasaNorm(String(rw || "").replace(/'/g, " "));
    if (!k) return;
    const v = String(Array.isArray(en) ? en[0] : en || "").replace(/^to /, "").trim();
    if (!mifasaBridge.has(k)) { mifasaBridge.set(k, v === "-" ? "" : v); mifasaBridgeMax = Math.max(mifasaBridgeMax, k.split(" ").length); }
  };
  MIFASA_EXTRA_DICT.forEach(e => put(e.rw, e.en));          // curated entries win
  if (!mifasaDictRw) mifasaDictBuild();
  mifasaDictRw.forEach((e, k) => put(e.rw, e.en));
}
function mifasaBridgeEn(raw) {
  if (!mifasaBridge) mifasaBridgeBuild();
  const q = mifasaSplitCompounds(String(raw || "")).toLowerCase().replace(/\b[a-z]['’]/g, " ");
  const toks = mifasaNorm(q).split(" ").filter(Boolean);
  if (!toks.length || toks.length > 24) return null;
  const out = []; let changed = false;
  for (let i = 0; i < toks.length;) {
    let hit = null, len = 0;
    for (let n = Math.min(mifasaBridgeMax, toks.length - i); n >= 1; n--) {
      const k = toks.slice(i, i + n).join(" ");
      if (mifasaBridge.has(k)) { hit = mifasaBridge.get(k); len = n; break; }
    }
    if (len) { changed = true; if (hit) out.push(hit); i += len; } else { out.push(toks[i]); i++; }
  }
  const res = out.join(" ").replace(/\s+/g, " ").trim();
  return changed && res && res !== toks.join(" ") ? res : null;
}
function mifasaAddDictionary(entries) {
  let list = entries;
  if (list && !Array.isArray(list) && Array.isArray(list.entries)) list = list.entries;
  if (list && !Array.isArray(list) && typeof list === "object") list = Object.keys(list).map(k => ({ rw: k, en: list[k] }));
  if (!Array.isArray(list)) return 0;
  let added = 0;
  list.forEach(e => {
    if (!e || !e.rw) return;
    const en = (Array.isArray(e.en) ? e.en : String(e.en || "").split(/\s*;\s*/)).map(x => String(x).trim()).filter(Boolean);
    if (!en.length) return;
    MIFASA_EXTRA_DICT.push({ rw: String(e.rw).trim(), en });
    added++;
    if (e.group !== false) mifasaDictGroup(e.rw, en);   // "group": false = translate only, do not merge into synonym groups (keeps generic words like remember/steps from hijacking intents)
    // also let the "X mu Cyongereza ni iki" tool know the word
    if (!mifasaDictRw) mifasaDictBuild();
    const key = mifasaNorm(e.rw);
    if (key && !mifasaDictRw.has(key) && en[0] !== "-") {
      mifasaDictRw.set(key, { rw: String(e.rw).trim(), en });
      en.forEach(x => { const k = mifasaNorm(x).replace(/^(to|a|an|the) /, ""); if (!mifasaDictEn.has(k)) mifasaDictEn.set(k, []); mifasaDictEn.get(k).push(String(e.rw).trim()); });
    }
  });
  mifasaBridge = null;                     // rebuild on next use
  if (added) {                             // new related words: search + brain must see them
    mifasaVocab = null; MifasaIndex.synMap = null; MifasaIndex.dirty = true;
    try { if (MIFASA_BRAIN_MODULES.size) mifasaBrainLoadSingle(mifasaMergeBrainModules()); } catch (e) { console.warn("MIFASA dictionary refresh", e); }
  }
  return added;
}
async function mifasaLoadDictionary(file) {
  let total = 0;
  for (const f of (file ? [file] : ["dictionary.json", "grammar.json", "dictionary-auto.json"])) {     // grammar.json = small words like ndi = "i am"
    try {
      const res = await fetchWithTimeout(f, 10000, "no-store");
      if (res.ok) total += mifasaAddDictionary(await res.json());
    } catch (e) {}
  }
  return total;
}

// Used by the brain gate and by mifasaSmartTool
function mifasaPrecise(value) {
  try { return trySiteInfo(value) || tryNewsAnalysis(value) || tryConvert(value) || tryDates(value) || tryNumberWords(value) || tryMathExtras(value) || tryRandom(value) || tryLessons(value) || tryWordSenses(value) || tryDictionary(value) || (typeof tryVideoFeed === "function" && tryVideoFeed(value)) || (typeof tryNewsFeed === "function" && tryNewsFeed(value)) || (typeof tryWordNews === "function" && tryWordNews(value)) || (typeof trySmallTalk === "function" && trySmallTalk(value)) || null; }
  catch (e) { console.warn("MIFASA precise tool", e); return null; }
}

/* ---------------------------------------------------------- */
/* 9c-3. MORE TOOLS (v6): maths helpers, dictionary, random,   */
/*       follow-up memory, and a private log of unanswered     */
/*       questions. All run in the browser; nothing is sent.   */
/* ---------------------------------------------------------- */

function mifasaMoney(n) {
  if (!isFinite(n)) return String(n);
  return Number(n.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function mifasaNumList(str) {
  const t = String(str || "").replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  return (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter(isFinite);
}
function mifasaNum(str) { return parseFloat(String(str).replace(/(\d),(\d{3})(?!\d)/g, "$1$2").replace(",", ".")); }

// ---- D. MATHS HELPERS: BMI, loans, interest, discount, percentages, averages
function tryMathExtras(raw) {
  const s0 = String(raw || "").toLowerCase().trim().replace(/[?!]+$/, "").replace(/\s+/g, " ");
  if (!s0 || s0.length > 120) return null;
  let m;

  // "20 is what percent of 80" / "20 ni ijanisha ringahe rya 80"
  m = s0.match(/^(\d[\d.,]*)\s+(?:is|ni)\s+(?:what percent(?:age)?|ijanisha (?:ringahe|angahe|ry'ingahe)|ijanisha)\s+(?:of|rya|bya|ku|kuri)\s+(\d[\d.,]*)$/);
  if (m) {
    const a = mifasaNum(m[1]), b = mifasaNum(m[2]);
    if (b === 0) return { rw: "🧮 Sinshobora kugabanya ku busa (0).", en: "🧮 I can't divide by zero." };
    const p = a / b * 100;
    return { rw: `🧮 **${mifasaMoney(a)}** ni **${mifasaMoney(p)}%** bya **${mifasaMoney(b)}**.`, en: `🧮 **${mifasaMoney(a)}** is **${mifasaMoney(p)}%** of **${mifasaMoney(b)}**.` };
  }

  // percentage change: "percent change from 50 to 75"
  if (/\b(percent|percentage|ijanisha)\b/.test(s0) && /\b(from|kuva)\b/.test(s0) && /\b(change|increase|decrease|izamuka|igabanuka|ry'izamuka|ry'igabanuka)\b/.test(s0)) {
    const nums = mifasaNumList(s0);
    if (nums.length === 2) {
      const [a, b] = nums;
      if (a === 0) return { rw: "🧮 Ntibishoboka kubara ijanisha uhereye kuri 0.", en: "🧮 I can't work out a percentage change starting from 0." };
      const p = (b - a) / Math.abs(a) * 100, up = p >= 0;
      return {
        rw: `📈 Kuva kuri **${mifasaMoney(a)}** ukagera kuri **${mifasaMoney(b)}** ${up ? "ni izamuka rya" : "ni igabanuka rya"} **${mifasaMoney(Math.abs(p))}%**.`,
        en: `📈 From **${mifasaMoney(a)}** to **${mifasaMoney(b)}** is ${up ? "an increase" : "a decrease"} of **${mifasaMoney(Math.abs(p))}%**.`
      };
    }
  }

  // average / sum / min / max / median of a list
  m = s0.match(/^(average|mean|avg|impuzandengo|sum|total|igiteranyo|max|maximum|min|minimum|median)(?:\s+(?:of|ya|y'|cya|za))?\s*:?\s*([\d.,;\s]+(?:(?:and|na|,)\s*[\d.,;\s]+)*)$/);
  if (m) {
    const xs = mifasaNumList(m[2].replace(/\b(and|na)\b/g, " "));
    if (xs.length >= 2 && xs.length <= 200) {
      const k = m[1], sum = xs.reduce((p, c) => p + c, 0), sorted = xs.slice().sort((p, c) => p - c);
      const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      let rw, en, v;
      if (/^(average|mean|avg|impuzandengo)$/.test(k)) { v = sum / xs.length; rw = "impuzandengo"; en = "Average"; }
      else if (/^(sum|total|igiteranyo)$/.test(k)) { v = sum; rw = "igiteranyo"; en = "Sum"; }
      else if (/^max/.test(k)) { v = sorted[sorted.length - 1]; rw = "umubare munini"; en = "Largest"; }
      else if (/^min/.test(k)) { v = sorted[0]; rw = "umubare muto"; en = "Smallest"; }
      else { v = med; rw = "umubare wo hagati (median)"; en = "Median"; }
      return { rw: `🧮 Mu mibare ${xs.length} (${xs.join(", ")}), ${rw} ni **${mifasaMoney(v)}**.`, en: `🧮 ${en} of ${xs.length} numbers (${xs.join(", ")}) is **${mifasaMoney(v)}**.` };
    }
  }

  // BMI: "bmi 70 kg 175 cm"
  if (/\bbmi\b/.test(s0)) {
    const w = s0.match(/(\d+(?:[.,]\d+)?)\s*kg/), h = s0.match(/(\d+(?:[.,]\d+)?)\s*(cm|m)\b/);
    if (!w || !h) return { rw: "⚖️ Andika uburemere n'uburebure, urugero: **bmi 70 kg 175 cm**.", en: "⚖️ Give me weight and height, for example **bmi 70 kg 175 cm**." };
    const kg = mifasaNum(w[1]); let hm = mifasaNum(h[1]); if (h[2] === "cm") hm /= 100;
    if (!(kg > 2 && kg < 400 && hm > 0.5 && hm < 2.8)) return { rw: "⚖️ Imibare mwanditse ntigaragara neza. Gerageza nka **bmi 70 kg 175 cm**.", en: "⚖️ Those numbers don't look right. Try **bmi 70 kg 175 cm**." };
    const b = kg / (hm * hm), v = Math.round(b * 10) / 10;
    const cat = b < 18.5 ? ["ufite ibiro bike", "underweight"] : b < 25 ? ["ufite ibiro bisanzwe", "in the normal range"] : b < 30 ? ["ufite ibiro byinshi", "overweight"] : ["ufite ibiro byinshi cyane (obesity)", "in the obesity range"];
    return {
      rw: `⚖️ BMI yawe ni **${v}** — ${cat[0]} (ukurikije ibyiciro bya WHO ku bantu bakuru).\n_Ni igipimo rusange gusa, si isuzuma ry'abaganga. Ku buzima bwawe baza umuganga._`,
      en: `⚖️ Your BMI is **${v}**, which is ${cat[1]} (WHO adult categories).\n_This is a rough screening number, not a diagnosis. Ask a health professional about your own health._`
    };
  }

  // loan payment / interest
  const isLoan = /\b(loan|inguzanyo|mortgage)\b/.test(s0), isInt = /\b(interest|inyungu)\b/.test(s0);
  const askExplain = /\b(formula|what is|how to|how do|explain|example)\b/.test(s0) && !/\d/.test(s0);   // "simple interest formula" is a question for the brain, not the calculator
  if ((isLoan || isInt) && !askExplain) {
    const s1 = s0.replace(/(?:mu\s+|muri\s+|n'|na\s+)?(?:imyaka|myaka)\s*(\d+(?:\.\d+)?)/g, " $1 years ").replace(/(?:mu\s+|muri\s+|n'|na\s+)?(?:amezi|mezi)\s*(\d+(?:\.\d+)?)/g, " $1 months ");
    const mm = [...s1.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(%|percent|ku ijana|years?|yrs?|imyaka|umwaka|months?|amezi|ukwezi)?/g)];
    let rate = null, months = null; const plain = [];
    mm.forEach(x => {
      const v = mifasaNum(x[1]), u = x[2] || "";
      if (/%|percent|ku ijana/.test(u)) rate = v;
      else if (/year|yrs?|imyaka|umwaka/.test(u)) months = v * 12;
      else if (/month|amezi|ukwezi/.test(u)) months = v;
      else plain.push(v);
    });
    const P = plain.length ? Math.max(...plain) : null;
    if (P && rate != null && months) {
      const years = months / 12;
      if (isLoan) {
        const r = rate / 1200, pay = r === 0 ? P / months : P * r / (1 - Math.pow(1 + r, -months)), total = pay * months;
        return {
          rw: `🏦 Inguzanyo ya **${mifasaMoney(P)}** kuri **${rate}%** ku mwaka mu mezi **${months}**:\n• Kwishyura buri kwezi: **${mifasaMoney(pay)}**\n• Yose hamwe: **${mifasaMoney(total)}** (inyungu: ${mifasaMoney(total - P)})\n_Ni ukubara kw'ibanze; banki yawe ishobora kongeraho amafaranga y'inyongera._`,
          en: `🏦 A loan of **${mifasaMoney(P)}** at **${rate}%** a year over **${months}** months:\n• Monthly payment: **${mifasaMoney(pay)}**\n• Total repaid: **${mifasaMoney(total)}** (interest: ${mifasaMoney(total - P)})\n_This is the basic calculation; your bank may add fees._`
        };
      }
      const simple = P * rate / 100 * years, comp = P * Math.pow(1 + rate / 100, years) - P;
      const wantSimple = /\bsimple\b/.test(s0), wantComp = /\bcompound\b/.test(s0);
      const rwSimple = `• Inyungu y'ibanze (simple): **${mifasaMoney(simple)}** → yose **${mifasaMoney(P + simple)}**`, enSimple = `• Simple interest: **${mifasaMoney(simple)}** → total **${mifasaMoney(P + simple)}**`;
      const rwComp = `• Inyungu y'inyongera ku nyungu (compound, buri mwaka): **${mifasaMoney(comp)}** → yose **${mifasaMoney(P + comp)}**`, enComp = `• Compound interest (yearly): **${mifasaMoney(comp)}** → total **${mifasaMoney(P + comp)}**`;
      const rwList = wantComp && !wantSimple ? rwComp : wantSimple && !wantComp ? rwSimple : rwSimple + "\n" + rwComp;
      const enList = wantComp && !wantSimple ? enComp : wantSimple && !wantComp ? enSimple : enSimple + "\n" + enComp;
      return { rw: `💰 **${mifasaMoney(P)}** kuri **${rate}%** ku mwaka mu myaka **${Math.round(years * 100) / 100}**:\n${rwList}`, en: `💰 **${mifasaMoney(P)}** at **${rate}%** a year for **${Math.round(years * 100) / 100}** years:\n${enList}` };
    }
    if (isLoan) return { rw: "🏦 Andika inguzanyo, ijanisha n'igihe, urugero: **inguzanyo 1000000 kuri 12% mu myaka 5**.", en: "🏦 Give me the amount, rate and time, e.g. **loan 1000000 at 12% for 5 years**." };
    return { rw: "💰 Andika amafaranga, ijanisha n'igihe, urugero: **inyungu 100000 kuri 5% mu myaka 3**.", en: "💰 Give me the amount, rate and time, e.g. **interest 100000 at 5% for 3 years**." };
  }

  // discount: "200 with 15% discount" / "15% off 200" / "200 igabanyijeho 15%"
  if (/\b(discount|off|igabanyijeho|igabanyirizwa|igabanywa|ikigabanyirizwa)\b/.test(s0)) {
    const pc = s0.match(/(\d+(?:[.,]\d+)?)\s*(?:%|percent|ku ijana)/);
    if (pc) {
      const rest = s0.replace(pc[0], " ");
      const nums = mifasaNumList(rest);
      if (nums.length === 1) {
        const P = nums[0], p = mifasaNum(pc[1]), save = P * p / 100;
        return { rw: `🏷️ **${mifasaMoney(P)}** igabanyijeho **${p}%** ni **${mifasaMoney(P - save)}** (uzigama ${mifasaMoney(save)}).`, en: `🏷️ **${mifasaMoney(P)}** with **${p}%** off is **${mifasaMoney(P - save)}** (you save ${mifasaMoney(save)}).` };
      }
    }
  }
  return null;
}

// ---- E. RANDOM: coin, dice, number, password
function mifasaRandInt(lo, hi) {
  const span = hi - lo + 1;
  try {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const a = new Uint32Array(1), lim = Math.floor(4294967296 / span) * span;
      do { crypto.getRandomValues(a); } while (a[0] >= lim);
      return lo + (a[0] % span);
    }
  } catch (e) {}
  return lo + Math.floor(Math.random() * span);
}
function tryRandom(raw) {
  const s = String(raw || "").toLowerCase().trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
  if (!s || s.length > 80) return null;
  let m;
  if (/^(?:please )?(?:flip|toss)(?: a)? coin$|^tera igiceri$/.test(s)) {
    const h = mifasaRandInt(0, 1) === 0;
    return { rw: `🪙 Igiceri cyaguye ku **${h ? "mutwe (heads)" : "murizo (tails)"}**.`, en: `🪙 It landed on **${h ? "heads" : "tails"}**.` };
  }
  m = s.match(/^(?:roll|throw)(?: a)?(?: (\d{1,2})d(\d{1,3})| (?:die|dice))$|^tera dice$/);
  if (m) {
    const n = m[1] ? +m[1] : 1, sides = m[2] ? +m[2] : 6;
    if (n < 1 || n > 20 || sides < 2 || sides > 1000) return null;
    const rolls = Array.from({ length: n }, () => mifasaRandInt(1, sides)), tot = rolls.reduce((p, c) => p + c, 0);
    const txt = n === 1 ? `**${rolls[0]}**` : `${rolls.join(" + ")} = **${tot}**`;
    return { rw: `🎲 Wabonye ${txt}.`, en: `🎲 You rolled ${txt}.` };
  }
  m = s.match(/^(?:random number|umubare uwo ari wo wose|hitamo umubare)(?: between| hagati ya| from| kuva kuri)?\s*(-?\d+)\s*(?:and|na|to|kugeza kuri|kugera kuri|-)\s*(-?\d+)$/);
  if (m) {
    let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a];
    if (b - a > 1e9) return null;
    const v = mifasaRandInt(a, b);
    return { rw: `🎯 Umubare nahisemo hagati ya ${a} na ${b} ni **${v}**.`, en: `🎯 My random number between ${a} and ${b} is **${v}**.` };
  }
  m = s.match(/^(?:generate|make|create|kora|tegura)\s+(?:a\s+)?(?:strong\s+|random\s+)?(?:password|ijambo ry'ibanga)(?:\s+(?:of|with|rya|rifite|ry'inyuguti)?\s*(\d{1,2})(?:\s*(?:characters|chars|inyuguti))?)?$/);
  if (m) {
    const len = Math.max(8, Math.min(64, m[1] ? +m[1] : 14));
    const sets = ["abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+?"];
    const all = sets.join(""), out = sets.map(x => x[mifasaRandInt(0, x.length - 1)]);
    while (out.length < len) out.push(all[mifasaRandInt(0, all.length - 1)]);
    for (let i = out.length - 1; i > 0; i--) { const j = mifasaRandInt(0, i); [out[i], out[j]] = [out[j], out[i]]; }
    const pw = out.join("");
    return {
      rw: `🔐 Ijambo ry'ibanga rishya (inyuguti ${len}):\n\`${pw}\`\n_Ryakorewe aha kuri iyi page gusa. Ribike mu buryo bwizewe (password manager), kandi ntuzarikoreshe ahantu henshi._`,
      en: `🔐 A new password (${len} characters):\n\`${pw}\`\n_Generated on this page only. Store it in a password manager and don't reuse it elsewhere._`
    };
  }
  return null;
}

// ---- F. SMALL DICTIONARY Kinyarwanda <-> English
// Format: "kinyarwanda = english; other meaning". Add your own lines freely.
const MIFASA_DICT_SRC = `
amazi = water
umuriro = fire; electricity
inzu = house
ishuri = school
umwarimu = teacher
umunyeshuri = student
igitabo = book
ubwenge = intelligence; wisdom
urukundo = love
amahoro = peace
ubuzima = life; health
ibiryo = food
umuntu = person
umwana = child
umugore = woman; wife
umugabo = man; husband
inshuti = friend
umuryango = family
igihugu = country
umujyi = city
umuhanda = road
imodoka = car
igare = bicycle
ikawa = coffee
icyayi = tea
amata = milk
umugati = bread
inyama = meat
ifi = fish
umuceri = rice
ibirayi = potatoes
ibishyimbo = beans
ibitoki = bananas
inyanya = tomatoes
igitunguru = onion
ubwato = boat
indege = airplane
ijuru = sky; heaven
izuba = sun
ukwezi = moon; month
inyenyeri = star
imvura = rain
umuyaga = wind
ubushyuhe = heat
imbeho = cold
umunsi = day
ijoro = night
igitondo = morning
nimugoroba = evening
uyu munsi = today
none = now
ubu = now
hano = here
yego = yes
oya = no
murakoze = thank you
urakoze = thank you
muraho = hello
mwaramutse = good morning
mwiriwe = good afternoon; good evening
murabeho = goodbye
ndagukunda = i love you
mbabarira = sorry; excuse me
ndakwinginze = please
amakuru = news; how are you
telefoni = phone
mudasobwa = computer
interineti = internet
amafaranga = money
banki = bank
isoko = market
ubucuruzi = business; trade
akazi = work; job
umushahara = salary
ubuhinzi = agriculture; farming
ubworozi = livestock keeping
ibitaro = hospital
umuganga = doctor
umuti = medicine
politiki = politics
amatora = elections
perezida = president
minisitiri = minister
itegeko = law
ubutabera = justice
umutekano = security; safety
uburezi = education
ubukungu = economy
siporo = sport; sports
umuziki = music
filimi = film; movie
inkuru = story; news
kurya = to eat
kunywa = to drink
gusinzira = to sleep
kujya = to go
kuza = to come
gukora = to work; to do
kwiga = to study; to learn
gusoma = to read
kwandika = to write
kuvuga = to speak; to say
kumva = to hear; to understand
kureba = to look; to see
gukunda = to love; to like
gutanga = to give
gufata = to take; to hold
kugura = to buy
kugurisha = to sell
gufasha = to help
gutekereza = to think
kubaza = to ask
gusubiza = to answer
kurira = to cry
guseka = to laugh
gukina = to play
kwiruka = to run
kugenda = to walk; to travel
kubaho = to live
gupfa = to die
gutangira = to start
kurangiza = to finish
gutegereza = to wait
guhitamo = to choose
nziza = good; beautiful
mbi = bad
nini = big
nto = small
ndende = tall; long
ngufi = short
nshya = new
vuba = fast; soon
buhoro = slowly
`;
let mifasaDictRw = null, mifasaDictEn = null;
function mifasaDictBuild() {
  mifasaDictRw = new Map(); mifasaDictEn = new Map();
  MIFASA_DICT_SRC.split("\n").forEach(line => {
    const i = line.indexOf("=");
    if (i < 0) return;
    const rw = mifasaNorm(line.slice(0, i)), ens = line.slice(i + 1).split(";").map(x => x.trim()).filter(Boolean);
    if (!rw || !ens.length) return;
    mifasaDictRw.set(rw, { rw: line.slice(0, i).trim(), en: ens });
    ens.forEach(e => {
      const k = mifasaNorm(e).replace(/^(to|a|an|the) /, "");
      if (!mifasaDictEn.has(k)) mifasaDictEn.set(k, []);
      mifasaDictEn.get(k).push(line.slice(0, i).trim());
    });
  });
}
// ---- LESSON CARDS: the learning page (flashcards) can teach the AI its words in Kinyarwanda, English, French and Swahili
let mifasaLessonIdx = new Map();
const MIFASA_LESSON_LANGS = {
  rw: { f: "kinyarwanda", nRw: "Kinyarwanda", nEn: "Kinyarwanda", flag: "🇷🇼" },
  en: { f: "english", nRw: "Cyongereza", nEn: "English", flag: "🇬🇧" },
  fr: { f: "french", nRw: "Gifaransa", nEn: "French", flag: "🇫🇷" },
  sw: { f: "swahili", nRw: "Giswahili", nEn: "Swahili", flag: "🇹🇿" }
};
function mifasaLessonSplit(v) { return String(v || "").split(/\s*[\/;]\s*/).map(x => x.trim()).filter(Boolean); }
function mifasaSetLessons(list) {
  const idx = new Map();
  (Array.isArray(list) ? list : []).forEach(it => {
    if (!it || !it.kinyarwanda) return;
    Object.keys(MIFASA_LESSON_LANGS).forEach(code => {
      mifasaLessonSplit(it[MIFASA_LESSON_LANGS[code].f]).forEach(v => {
        const k = mifasaNorm(v).replace(/^(to|a|an|the) /, "");
        if (k && !idx.has(k)) idx.set(k, { item: it, code });
      });
    });
  });
  mifasaLessonIdx = idx;
  return idx.size;
}
function mifasaLangCode(t) {
  t = mifasaNorm(t || "");
  if (/kinyarwanda/.test(t)) return "rw";
  if (/english|cyongereza/.test(t)) return "en";
  if (/french|gifaransa|francais/.test(t)) return "fr";
  if (/swahili/.test(t)) return "sw";
  return "";
}
function tryLessons(raw) {
  if (!mifasaLessonIdx.size) return null;
  const s = String(raw || "").toLowerCase().trim().replace(/[?!.]+$/, "").replace(/["“”]/g, "").replace(/\s+/g, " ");
  if (!s || s.length > 80) return null;
  const L = "(english|kinyarwanda|cyongereza|icyongereza|ikinyarwanda|french|igifaransa|gifaransa|swahili|igiswahili|giswahili|kiswahili)";
  let m, word, target = "";
  if ((m = s.match(new RegExp(`^(?:what is|what's|whats|how do you say|how to say|how do i say|say|translate|translation of)\\s+(.+?)\\s+(?:in|to|into)\\s+${L}$`)))) { word = m[1]; target = m[2]; }
  else if ((m = s.match(new RegExp(`^(?:hindura|guhindura|translate)\\s+(.+?)\\s+(?:mu|muri|to|into|in)\\s+${L}$`)))) { word = m[1]; target = m[2]; }
  else if ((m = s.match(new RegExp(`^(.+?)\\s+(?:mu|muri|in)\\s+${L}\\s+ni iki$`)))) { word = m[1]; target = m[2]; }
  else if ((m = s.match(new RegExp(`^(.+?)\\s+bivuga iki(?:\\s+mu\\s+${L})?$`)))) { word = m[1]; target = m[2] || ""; }
  else if ((m = s.match(new RegExp(`^(.+?)\\s+(?:in|mu)\\s+${L}$`)))) { word = m[1]; target = m[2]; }
  else return null;
  if (word.split(" ").length > 4) return null;
  const hit = mifasaLessonIdx.get(mifasaNorm(word).replace(/^(to|a|an|the) /, ""));
  if (!hit) return null;
  const tcode = mifasaLangCode(target), it = hit.item, G = MIFASA_LESSON_LANGS;
  if (tcode && tcode !== hit.code) {
    const vals = mifasaLessonSplit(it[G[tcode].f]).join(" / ");
    if (!vals) return null;
    return { rw: `🗂️ **${word}** mu ${G[tcode].nRw} ni **${vals}**.`, en: `🗂️ **${word}** in ${G[tcode].nEn} is **${vals}**.` };
  }
  const lines = Object.keys(G).filter(c => c !== hit.code && mifasaLessonSplit(it[G[c].f]).length)
    .map(c => `${G[c].flag} ${G[c].nEn}: **${mifasaLessonSplit(it[G[c].f]).join(" / ")}**`);
  if (!lines.length) return null;
  const head = G[hit.code].flag + " **" + word + "** → ";
  return { rw: head + "\n" + lines.join("\n"), en: head + "\n" + lines.join("\n") };
}
/* ---- WORD SENSES: one word, several meanings (plan -> umushinga / umupangu / gahunda;  amayeri -> trick / strategy / mystery) ----
   Data lives in any ai*.json module:  "lexicon": [ {"en":"plan","rw":[["umushinga","a project ..."],["gahunda","a programme ..."]]},
                                                    {"rw":"amayeri","en":[["trick","cunning tricks"],["mystery","something hidden"]]} ]   */
const MIFASA_LEXICON = { en: new Map(), rw: new Map() };
function mifasaLexiconLoad(src) {
  try {
    if (!src || !Array.isArray(src.lexicon)) return;
    const put = (side, word, pair) => {
      const k = mifasaNorm(word); if (!k) return;
      const m = MIFASA_LEXICON[side];
      if (!m.has(k)) m.set(k, { word: String(word).trim(), senses: [] });
      const e = m.get(k);
      const parts = String(pair[0]).split("/").map(x => mifasaNorm(x)).filter(Boolean);
      if (!e.senses.some(s => String(s[0]).split("/").some(x => parts.indexOf(mifasaNorm(x)) > -1))) e.senses.push(pair);   // no duplicate meanings
    };
    const ordered = src.lexicon.filter(it => it && typeof it.rw === "string").concat(src.lexicon.filter(it => !(it && typeof it.rw === "string")));   // hand-written Kinyarwanda-first entries win
    ordered.forEach(it => {
      if (!it) return;
      const clean = a => (Array.isArray(a) ? a : []).map(p => Array.isArray(p) ? [mifasaStrip(p[0], 60), mifasaStrip(p[1], 220)] : [mifasaStrip(p, 60), ""]).filter(p => p[0]);
      if (it.en && it.rw) {
        if (Array.isArray(it.rw)) { const list = clean(it.rw); list.forEach(p => put("en", it.en, p)); list.forEach(p => put("rw", p[0], [String(it.en), p[1]])); }
        else if (Array.isArray(it.en)) { const list = clean(it.en); list.forEach(p => put("rw", it.rw, p)); }
      } else if (it.rw && Array.isArray(it.en)) {
        const list = clean(it.en); list.forEach(p => put("rw", it.rw, p)); list.forEach(p => put("en", p[0], [String(it.rw), p[1]]));
      } else if (it.en && Array.isArray(it.rw)) { const list = clean(it.rw); list.forEach(p => put("en", it.en, p)); list.forEach(p => put("rw", p[0], [String(it.en), p[1]])); }
    });
  } catch (e) { /* optional */ }
}
function tryWordSenses(raw) {
  if (!MIFASA_LEXICON.en.size && !MIFASA_LEXICON.rw.size) return null;
  const s = String(raw || "").toLowerCase().trim().replace(/[?!.]+$/, "").replace(/["“”]/g, "").replace(/(^|\s)['‘’]+|['‘’]+(?=\s|$)/g, "$1").replace(/\s+/g, " ");
  if (!s || s.length > 70) return null;
  const RW = "(?:kinyarwanda|ikinyarwanda)", EN = "(?:english|cyongereza|icyongereza)";
  let m, word, side = "";
  if ((m = s.match(new RegExp(`^(?:what is|what's|whats|how do you say|how to say|how do i say|say|translate|translation of|meaning of)\\s+(.+?)\\s+(?:in|to|into)\\s+${RW}$`)))) { word = m[1]; side = "en"; }
  else if ((m = s.match(new RegExp(`^(?:what is|what's|whats|how do you say|how to say|translate|translation of|meaning of)\\s+(.+?)\\s+(?:in|to|into)\\s+${EN}$`)))) { word = m[1]; side = "rw"; }
  else if ((m = s.match(new RegExp(`^(?:hindura|guhindura|translate)\\s+(.+?)\\s+(?:mu|muri|to|into|in)\\s+${RW}$`)))) { word = m[1]; side = "en"; }
  else if ((m = s.match(new RegExp(`^(?:hindura|guhindura|translate)\\s+(.+?)\\s+(?:mu|muri|to|into|in)\\s+${EN}$`)))) { word = m[1]; side = "rw"; }
  else if ((m = s.match(new RegExp(`^(.+?)\\s+(?:mu|muri|in)\\s+${RW}(?:\\s+ni iki)?$`)))) { word = m[1]; side = "en"; }
  else if ((m = s.match(new RegExp(`^(.+?)\\s+(?:mu|muri|in)\\s+${EN}(?:\\s+ni iki)?$`)))) { word = m[1]; side = "rw"; }
  else if ((m = s.match(/^(?:what does|what do)\s+(.+?)\s+mean$/))) { word = m[1]; }
  else if ((m = s.match(/^(?:meaning of|synonyms? of|ibisobanuro bya|icyo)\s+(.+?)(?:\s+bivuga|\s+bisobanura)?$/))) { word = m[1]; }
  else if ((m = s.match(/^(?:ijambo\s+)?(.+?)\s+(?:bivuga iki|bisobanura iki|risobanura iki|ryitwa iki|bishatse kuvuga iki|meaning|means|ni iki)$/))) { word = m[1]; }
  else return null;
  word = word.replace(/^(?:the word|ijambo|word)\s+/, "").replace(/^(to|a|an|the) /, "");
  if (!word || word.split(" ").length > 3) return null;
  const k = mifasaNorm(word);
  const pick = side ? [side] : ["rw", "en"];
  for (const sd of pick) {
    const e = MIFASA_LEXICON[sd].get(k);
    if (!e || !e.senses.length) continue;
    const lines = e.senses.map((x, i) => `${i + 1}. **${x[0]}**${x[1] ? " — " + x[1] : ""}`).join("\n");
    const head = sd === "en" ? `📘 **${e.word}** in Kinyarwanda can be:` : `📘 **${e.word}** (Kinyarwanda) can mean:`;
    const tail = e.senses.length > 1 ? (sd === "en" ? "\nWhich one to use depends on the sentence." : "\nWhich meaning fits depends on the sentence.") : "";
    return { rw: head + "\n" + lines + tail, en: head + "\n" + lines + tail };
  }
  return null;
}
function tryDictionary(raw) {
  let s = String(raw || "").toLowerCase().trim().replace(/[?!.]+$/, "").replace(/["“”]/g, "").replace(/(^|\s)['‘’]+|['‘’]+(?=\s|$)/g, "$1").replace(/\s+/g, " ");
  if (!s || s.length > 70) return null;
  const LANG = "(english|kinyarwanda|cyongereza|icyongereza|ikinyarwanda)";
  let m, word, target;
  if ((m = s.match(new RegExp(`^(?:what is|what's|whats|how do you say|how to say|how do i say|say|translate|translation of)\\s+(.+?)\\s+(?:in|to|into)\\s+${LANG}$`)))) { word = m[1]; target = m[2]; }
  else if ((m = s.match(new RegExp(`^(?:hindura|guhindura|translate)\\s+(.+?)\\s+(?:mu|muri|to|into|in)\\s+${LANG}$`)))) { word = m[1]; target = m[2]; }
  else if ((m = s.match(new RegExp(`^(.+?)\\s+(?:mu|muri|in)\\s+${LANG}\\s+ni iki$`)))) { word = m[1]; target = m[2]; }
  else if ((m = s.match(new RegExp(`^(.+?)\\s+bivuga iki(?:\\s+mu\\s+${LANG})?$`)))) { word = m[1]; target = m[2] || "english"; }
  else return null;
  if (word.split(" ").length > 3) return null;
  if (!mifasaDictRw) mifasaDictBuild();
  const key = mifasaNorm(word);
  const toRw = /kinyarwanda/.test(target);
  if (!toRw) {                                       // Kinyarwanda -> English
    const e = mifasaDictRw.get(key);
    if (!e) {
      const r = mifasaRelatedWord(key, false);
      if (!r) return null;
      return { rw: `🌍 **${word}** is closely related to **${r.via}** — in English: **${r.out}**.`, en: `🌍 **${word}** is closely related to **${r.via}** — in English: **${r.out}**.` };
    }
    const en = e.en.join(" / ");
    return { rw: `🌍 **${e.rw}** mu Cyongereza ni **${en}**.`, en: `🌍 **${e.rw}** (Kinyarwanda) means **${en}**.` };
  }
  const list = mifasaDictEn.get(key.replace(/^(to|a|an|the) /, ""));   // English -> Kinyarwanda
  if (!list) {
    const r = mifasaRelatedWord(key, true);
    if (!r) return null;
    return { rw: `🌍 **${word}** is closely related to **${r.via}**, which in Kinyarwanda is **${r.out}**.`, en: `🌍 **${word}** is closely related to **${r.via}**, which in Kinyarwanda is **${r.out}**.` };
  }
  const rw = [...new Set(list)].join(" / ");
  return { rw: `🌍 **${word}** mu Kinyarwanda ni **${rw}**.`, en: `🌍 **${word}** in Kinyarwanda is **${rw}**.` };
}

// ---- G. FOLLOW-UP MEMORY: "Ni nde Kagame?" ... "Ese yavukiye he?"   "capital of Kenya" ... "and Uganda?"
let mifasaTopicQ = "";          // the last real topic the person asked about (kept in memory only)
let mifasaTopicSwap = false;    // set by mifasaResolveFollowUp when the new question replaced the subject
const MIFASA_PRON = new Set(["he", "she", "it", "they", "him", "her", "his", "its", "their", "them", "that", "this", "those", "these", "there", "uwo", "uyu", "uriya", "iyo", "iryo", "icyo", "ibyo", "abo", "aho", "yo", "wo", "ryo", "cyo", "byo", "bo", "yaryo", "wayo", "rwayo", "cyayo", "byayo", "bayo"]);
const MIFASA_CUE_RE = /\b(he|she|it|they|him|her|his|its|their|them|that|this|those|these|there|uwo|uyu|uriya|iyo|iryo|icyo|ibyo|abo|aho|yo|wayo|rwayo|cyayo|byayo|bayo|yavukiye|yavutse|yize|yakoze|yabaye|yatangiye|yarangiye|yapfuye|yabereye|yabayeho|akora|ni we|ni ryo|ni cyo|ituwe|iherereye)\b/;
const MIFASA_Q_STOP = new Set(["ese", "he", "ryari", "nde", "iki", "gute", "kuki", "angahe", "ingahe", "bangahe", "zingahe", "who", "what", "when", "where", "why", "how", "many", "much", "is", "are", "was", "were", "did", "do", "does", "the", "a", "an", "of", "in", "on", "at", "to", "ni", "na", "n", "me", "tell", "about", "more", "and", "uwuhe", "iyihe", "ihe", "bihe", "ibihe", "mbwira", "kuri", "ku", "mu", "ya", "wa", "se", "none", "should", "can", "could", "would", "will", "with", "for", "by", "from", "if", "or", "but", "so", "as", "be"]);
const MIFASA_FOLLOW_OK = new Set(["born", "die", "died", "age", "old", "family", "wife", "husband", "children", "kids", "parents", "school", "education", "job", "career", "history", "located", "location", "population", "founded", "meaning", "mean", "work", "works", "lives", "live", "married", "tall", "height", "size", "big", "large", "long", "far", "fast", "cost", "price", "important", "importance", "prevent", "prevented", "prevention", "cause", "causes", "caused", "treatment", "treated", "cure", "symptoms", "symptom", "benefits", "benefit", "risks", "risk", "example", "examples", "used", "uses", "use", "people", "citizens", "currency", "president", "capital", "language", "languages", "area", "weather", "umugore", "umugabo", "abana", "ababyeyi", "umuryango", "imyaka", "akazi", "amashuri", "amateka", "aherereye", "abaturage", "abantu", "ituwe", "ingano", "uburebure", "ubugari", "igiciro", "akamaro", "impamvu", "ibimenyetso", "imiti", "kuvura", "kwirinda", "uburyo", "ifaranga", "perezida", "indimi", "ururimi", "umuco", "ahantu", "ubukerarugendo"]);
function mifasaResolveFollowUp(value) {
  mifasaTopicSwap = false;
  const prevRaw = mifasaTopicQ || (mifasaConv && mifasaConv.query);
  if (!prevRaw) return value;
  const prev = mifasaNorm(prevRaw);
  const n = mifasaNorm(value);
  const toks = n.split(" ").filter(Boolean).map(t => t.replace(/^[nwyrbckz]'(?=[a-z])/, ""));   // n'abantu -> abantu
  if (!toks.length || toks.length > 7 || n === prev) return value;
  const pt = prev.split(" ").filter(Boolean);

  // 1) "and Uganda?" / "na Uganda?" / "what about TB?" -> same question, new subject
  const sw = n.match(/^(?:and what about|and|what about|how about|na|ese|n)\s+(.+)$/);
  if (sw && pt.length >= 2) {
    const rest = sw[1].split(" ").filter(Boolean);
    const plain = rest.length && rest.length <= 3 && rest.length < pt.length && !rest.some(t => MIFASA_Q_STOP.has(t) || MIFASA_PRON.has(t) || MIFASA_FOLLOW_OK.has(t));
    if (plain) { mifasaTopicSwap = true; return pt.slice(0, pt.length - rest.length).concat(rest).join(" "); }
  }

  // 2) pronoun / attribute questions: "how tall is it?", "ituwe n'abantu bangahe?", "why is it important?"
  const content = toks.filter(t => !MIFASA_Q_STOP.has(t) && !MIFASA_PRON.has(t));
  const hasCue = MIFASA_CUE_RE.test(n);
  const attrOnly = content.length >= 1 && content.length <= 4 && content.every(t => MIFASA_FOLLOW_OK.has(t));
  if (!(hasCue && content.every(t => MIFASA_FOLLOW_OK.has(t) || MIFASA_CUE_RE.test(t)) || attrOnly)) return value;
  if (content.length > 4) return value;
  const ALIAS = { tall: "height", ituwe: "population", abantu: "population", abaturage: "population", people: "population", citizens: "population", prevented: "prevention", prevent: "prevention", located: "location", iherereye: "location", aherereye: "location", kwirinda: "prevention" };
  const mapped = [...new Set(content.map(t => ALIAS[t] || t))];
  return (prev + " " + mapped.join(" ")).trim();
}

// ---- H. PRIVATE LOG OF UNANSWERED QUESTIONS (stays in this browser only)
const MIFASA_MISS_KEY = "mifasa_unanswered_v1";
function mifasaLogMiss(q) {
  try {
    const t = String(q || "").trim().slice(0, 140);
    if (t.length < 3) return;
    const key = mifasaNorm(t);
    let list = JSON.parse(localStorage.getItem(MIFASA_MISS_KEY) || "[]");
    if (!Array.isArray(list)) list = [];
    const hit = list.find(x => x.k === key);
    if (hit) { hit.n++; hit.t = Date.now(); }
    else list.push({ k: key, q: t, n: 1, t: Date.now() });
    list.sort((a, b) => b.t - a.t);
    localStorage.setItem(MIFASA_MISS_KEY, JSON.stringify(list.slice(0, 200)));
  } catch (e) {}
}
function mifasaGetMisses() {
  try {
    const list = JSON.parse(localStorage.getItem(MIFASA_MISS_KEY) || "[]");
    return (Array.isArray(list) ? list : []).sort((a, b) => b.n - a.n || b.t - a.t).map(x => ({ question: x.q, times: x.n, last: new Date(x.t).toISOString() }));
  } catch (e) { return []; }
}

// One entry point used by doSearch. Returns {text_rw, text_en} or null.
function mifasaSmartTool(value) {
  const site = trySiteInfo(value) || tryNewsAnalysis(value);
  if (site) return { type: "site", text_rw: `🤖 **MIFASA AI**\n\n${site.rw}`, text_en: `🤖 **MIFASA AI**\n\n${site.en}` };
  const dt = tryDateTime(value);
  if (dt) return { type: "datetime", text_rw: `🤖 **MIFASA AI**\n\n${dt.rw}`, text_en: `🤖 **MIFASA AI**\n\n${dt.en}` };

  const calc = tryCalculate(value);
  if (calc) {
    if (calc.error) {
      const rw = calc.error === "div0" ? "Ntibishoboka kugabanya na zero. 🙂" : "Sinabashije gusobanukirwa iyo mibare. Gerageza nka **12 × (3 + 4)** cyangwa **15% ya 2000**.";
      const en = calc.error === "div0" ? "Can't divide by zero. 🙂" : "I couldn't read that calculation. Try something like **12 × (3 + 4)** or **15% of 2000**.";
      return { type: "calc", text_rw: `🤖 **MIFASA AI**\n\n🧮 ${rw}`, text_en: `🤖 **MIFASA AI**\n\n🧮 ${en}` };
    }
    const v = mifasaFormatNumber(calc.value);
    return {
      type: "calc",
      text_rw: `🤖 **MIFASA AI**\n\n🧮 ${calc.expr} = **${v}**`,
      text_en: `🤖 **MIFASA AI**\n\n🧮 ${calc.expr} = **${v}**`
    };
  }

  const pre = mifasaPrecise(value);
  if (pre) return { type: "tool", text_rw: `🤖 **MIFASA AI**\n\n${pre.rw}`, text_en: `🤖 **MIFASA AI**\n\n${pre.en}` };

  const cmp = tryCompare(value);
  if (cmp && mifasaLoaded) {
    const r = buildComparison(cmp);
    return { type: "compare", text_rw: r.rw, text_en: r.en };
  }
  return null;
}

/* ---------------------------------------------------------- */
/* 9d. BUILT-IN KNOWLEDGE (always available, even offline)     */
/* ---------------------------------------------------------- */
// Core facts the AI knows by itself. They are indexed with everything else,
// so a question is answered from the best source, but they never show up as news cards.

const MIFASA_CORE_KNOWLEDGE = [
  { id: "mifasa", cat: "mifasa",
    t_rw: "MIFASA na " + MIFASA_BRAND.founder, t_en: "MIFASA and " + MIFASA_BRAND.founder,
    s_rw: `${MIFASA_BRAND.name} ni urubuga n'umufasha w'ubwenge (AI) wakozwe na ${MIFASA_BRAND.founder}. ${MIFASA_BRAND.nameOrigin_rw} ${MIFASA_BRAND.tagline_rw}.`.replace(/\s+/g, " ").trim(),
    s_en: `${MIFASA_BRAND.name} is a website and AI assistant created by ${MIFASA_BRAND.founder}. ${MIFASA_BRAND.nameOrigin_en} ${MIFASA_BRAND.tagline_en}.`.replace(/\s+/g, " ").trim(),
    kw: ["mifasa", "mizero", "fabrice", "samuel", "mizero fabrice samuel", "founder", "creator", "washinze", "wakoze", "wakozwe", "uwakoze", "umuyobozi", "owner", "developer", "who made", "about"] },
  { id: "capital", cat: "rwanda",
    t_rw: "Umurwa mukuru w'u Rwanda", t_en: "Capital of Rwanda",
    s_rw: "Umurwa mukuru w'u Rwanda ni Kigali. Ni wo mujyi munini mu gihugu kandi ni ho Guverinoma ikorera.",
    s_en: "The capital of Rwanda is Kigali. It is the largest city in the country and the seat of government.",
    kw: ["umurwa mukuru", "capital", "kigali", "umujyi", "city"] },
  { id: "independence", cat: "rwanda",
    t_rw: "Ubwigenge bw'u Rwanda", t_en: "Rwanda's independence",
    s_rw: "U Rwanda rwabonye ubwigenge ku itariki ya 1 Nyakanga 1962, rwigobotora ubutegetsi bw'Ababiligi.",
    s_en: "Rwanda gained independence from Belgium on 1 July 1962.",
    kw: ["ubwigenge", "independence", "1962", "ububiligi", "belgium", "abagande", "colonial"] },
  { id: "languages", cat: "rwanda",
    t_rw: "Indimi zikoreshwa mu Rwanda", t_en: "Languages of Rwanda",
    s_rw: "Indimi zemewe mu Rwanda ni Ikinyarwanda, Icyongereza, Igifaransa n'Igiswahili. Ikinyarwanda ni rwo rurimi kavukire rw'Abanyarwanda.",
    s_en: "Rwanda's official languages are Kinyarwanda, English, French and Swahili. Kinyarwanda is the national language spoken by almost everyone.",
    kw: ["indimi", "ururimi", "language", "languages", "ikinyarwanda", "kinyarwanda", "icyongereza", "igifaransa", "igiswahili", "swahili"] },
  { id: "currency", cat: "rwanda",
    t_rw: "Ifaranga ry'u Rwanda", t_en: "Rwanda's currency",
    s_rw: "Amafaranga akoreshwa mu Rwanda yitwa Ifaranga ry'u Rwanda, mu mpine RWF.",
    s_en: "Rwanda's currency is the Rwandan franc, abbreviated RWF.",
    kw: ["ifaranga", "amafaranga", "currency", "money", "rwf", "franc"] },
  { id: "admin", cat: "rwanda",
    t_rw: "Intara n'uturere tw'u Rwanda", t_en: "Provinces and districts of Rwanda",
    s_rw: "U Rwanda rufite uturere 30, dukubiye mu ntara enye n'Umujyi wa Kigali: Amajyaruguru, Amajyepfo, Iburasirazuba n'Iburengerazuba.",
    s_en: "Rwanda has 30 districts, grouped into four provinces and the City of Kigali: Northern, Southern, Eastern and Western.",
    kw: ["intara", "uturere", "akarere", "province", "provinces", "district", "districts", "amajyaruguru", "amajyepfo", "iburasirazuba", "iburengerazuba"] },
  { id: "location", cat: "rwanda",
    t_rw: "Aho u Rwanda ruherereye", t_en: "Where Rwanda is located",
    s_rw: "U Rwanda ruri mu Burasirazuba bwa Afurika kandi nta nyanja rugira. Rugabana imbibi na Uganda, Tanzaniya, Burundi na Repubulika Iharanira Demokarasi ya Kongo. Ubuso bwarwo ni hafi ya kilometero kare ibihumbi 26.",
    s_en: "Rwanda is a landlocked country in East Africa, bordered by Uganda, Tanzania, Burundi and the Democratic Republic of the Congo. Its area is about 26,000 square kilometres.",
    kw: ["aho ruherereye", "location", "located", "imipaka", "imbibi", "borders", "neighbours", "neighbors", "uganda", "tanzania", "tanzaniya", "burundi", "kongo", "congo", "landlocked", "ubuso", "area", "imisozi igihumbi", "thousand hills"] },
  { id: "mountains", cat: "rwanda",
    t_rw: "Umusozi muremure n'ikiyaga kinini mu Rwanda", t_en: "Highest mountain and largest lake in Rwanda",
    s_rw: "Umusozi muremure mu Rwanda ni Karisimbi, ufite uburebure bwa metero zigera ku 4,507. Ikiyaga kinini ni Kivu.",
    s_en: "The highest mountain in Rwanda is Karisimbi, at about 4,507 metres. The largest lake is Lake Kivu.",
    kw: ["karisimbi", "kivu", "umusozi muremure", "highest mountain", "largest lake", "ikiyaga", "lake", "mountain", "ibirunga", "volcano"] },
  { id: "population", cat: "rwanda",
    t_rw: "Abaturage b'u Rwanda", t_en: "Population of Rwanda",
    s_rw: "Ibarura rusange ryo mu 2022 ryagaragaje ko u Rwanda rufite abaturage barenga miliyoni 13.",
    s_en: "Rwanda's 2022 census counted more than 13 million people.",
    kw: ["abaturage", "population", "ibarura", "census", "2022", "people"] },
  { id: "kwibuka", cat: "rwanda",
    t_rw: "Kwibuka Jenoside yakorewe Abatutsi", t_en: "Remembering the genocide against the Tutsi",
    s_rw: "Jenoside yakorewe Abatutsi yabaye guhera muri Mata kugeza muri Nyakanga 1994, yicwamo abarenga miliyoni imwe. Kwibuka bitangira buri mwaka ku itariki ya 7 Mata.",
    s_en: "The genocide against the Tutsi took place between April and July 1994 and more than a million people were killed. The annual commemoration, Kwibuka, begins on 7 April.",
    kw: ["jenoside", "genocide", "1994", "kwibuka", "7 mata", "commemoration", "abatutsi", "tutsi"] },
  { id: "liberation", cat: "rwanda",
    t_rw: "Umunsi wo Kwibohora", t_en: "Liberation Day",
    s_rw: "Umunsi wo Kwibohora wizihizwa buri mwaka ku itariki ya 4 Nyakanga, wibutsa ukwibohora kw'igihugu mu 1994.",
    s_en: "Liberation Day is celebrated every year on 4 July, marking the liberation of the country in 1994.",
    kw: ["kwibohora", "liberation", "4 nyakanga", "4 july", "umunsi mukuru", "holiday"] },
  { id: "umuganura", cat: "rwanda",
    t_rw: "Umuganura", t_en: "Umuganura (harvest festival)",
    s_rw: "Umuganura ni umunsi mukuru w'umuco wizihizwa ku wa Gatanu wa mbere w'ukwezi kwa Kanama, ugamije gushimira ibyagezweho no gusangira umusaruro.",
    s_en: "Umuganura is Rwanda's national harvest festival, celebrated on the first Friday of August to give thanks and share the harvest.",
    kw: ["umuganura", "harvest", "kanama", "august", "umuco", "culture", "festival", "umunsi mukuru"] },
  { id: "heroes", cat: "rwanda",
    t_rw: "Umunsi w'Intwari", t_en: "Heroes' Day",
    s_rw: "Umunsi w'Intwari z'u Rwanda wizihizwa buri mwaka ku itariki ya 1 Gashyantare.",
    s_en: "Rwanda's Heroes' Day is celebrated every year on 1 February.",
    kw: ["intwari", "heroes", "1 gashyantare", "1 february", "umunsi"] },
  { id: "symbols", cat: "rwanda",
    t_rw: "Intego n'ibendera by'u Rwanda", t_en: "Rwanda's motto and flag",
    s_rw: "Intego y'igihugu ni Ubumwe, Umurimo, Gukunda Igihugu. Ibendera ry'u Rwanda rifite ibara ry'ubururu, umuhondo n'icyatsi kibisi, rikagira n'izuba.",
    s_en: "Rwanda's national motto is Unity, Work, Patriotism. The flag is blue, yellow and green with a sun.",
    kw: ["intego", "motto", "ibendera", "flag", "ubumwe", "umurimo", "gukunda igihugu", "symbols", "ibimenyetso"] },
  { id: "parks", cat: "rwanda",
    t_rw: "Pariki z'igihugu z'u Rwanda", t_en: "National parks of Rwanda",
    s_rw: "U Rwanda rufite pariki enye z'igihugu: Ibirunga, Akagera, Nyungwe na Gishwati-Mukura. Pariki y'Ibirunga ni ho ingagi zo mu misozi ziba.",
    s_en: "Rwanda has four national parks: Volcanoes, Akagera, Nyungwe and Gishwati-Mukura. Volcanoes National Park is home to the mountain gorillas.",
    kw: ["pariki", "park", "parks", "ingagi", "gorillas", "gorilla", "akagera", "nyungwe", "ibirunga", "volcanoes", "gishwati", "mukura", "tourism", "ubukerarugendo", "tourists"] },
  { id: "eac", cat: "rwanda",
    t_rw: "U Rwanda mu miryango mpuzamahanga", t_en: "Rwanda's regional memberships",
    s_rw: "U Rwanda rwinjiye mu Muryango wa Afurika y'Iburasirazuba (EAC) mu 2007, kandi rwinjiye muri Commonwealth mu 2009.",
    s_en: "Rwanda joined the East African Community (EAC) in 2007 and the Commonwealth in 2009.",
    kw: ["eac", "umuryango", "community", "commonwealth", "2007", "2009", "afurika y'iburasirazuba", "east african community", "membership"] },
  { id: "seasons", cat: "rwanda",
    t_rw: "Ibihe by'u Rwanda", t_en: "Seasons in Rwanda",
    s_rw: "Mu Rwanda hari ibihe bine: itumba (imvura nyinshi, Werurwe–Gicurasi), impeshyi (izuba ryinshi, Kamena–Kanama), umuhindo (imvura y'umuhindo, Nzeri–Ugushyingo) n'urugaryi (Ukuboza–Gashyantare).",
    s_en: "Rwanda has four seasons: the long rains (March to May), the long dry season (June to August), the short rains (September to November) and the short dry season (December to February).",
    kw: ["ibihe", "season", "seasons", "itumba", "impeshyi", "umuhindo", "urugaryi", "imvura", "rain", "ikirere", "weather", "climate"] },
  { id: "days", cat: "rwanda",
    t_rw: "Iminsi y'icyumweru mu Kinyarwanda", t_en: "Days of the week in Kinyarwanda",
    s_rw: "Iminsi y'icyumweru ni: kuwa mbere, kuwa kabiri, kuwa gatatu, kuwa kane, kuwa gatanu, kuwa gatandatu no ku cyumweru.",
    s_en: "The days of the week in Kinyarwanda are: kuwa mbere (Monday), kuwa kabiri (Tuesday), kuwa gatatu (Wednesday), kuwa kane (Thursday), kuwa gatanu (Friday), kuwa gatandatu (Saturday) and ku cyumweru (Sunday).",
    kw: ["iminsi", "icyumweru", "days", "week", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
  { id: "months", cat: "rwanda",
    t_rw: "Amezi y'umwaka mu Kinyarwanda", t_en: "Months of the year in Kinyarwanda",
    s_rw: "Amezi y'umwaka ni: Mutarama, Gashyantare, Werurwe, Mata, Gicurasi, Kamena, Nyakanga, Kanama, Nzeri, Ukwakira, Ugushyingo n'Ukuboza.",
    s_en: "The months in Kinyarwanda are: Mutarama (January), Gashyantare (February), Werurwe (March), Mata (April), Gicurasi (May), Kamena (June), Nyakanga (July), Kanama (August), Nzeri (September), Ukwakira (October), Ugushyingo (November) and Ukuboza (December).",
    kw: ["amezi", "ukwezi", "months", "month", "mutarama", "gashyantare", "werurwe", "mata", "gicurasi", "kamena", "nyakanga", "kanama", "nzeri", "ukwakira", "ugushyingo", "ukuboza"] },
  { id: "africa", cat: "world",
    t_rw: "Afurika", t_en: "Africa",
    s_rw: "Afurika ifite ibihugu 54 byemewe n'Umuryango w'Abibumbye. Ni yo mugabane wa kabiri ku isi mu bunini no mu baturage.",
    s_en: "Africa has 54 countries recognised by the United Nations. It is the second-largest and second most populous continent.",
    kw: ["afurika", "africa", "ibihugu", "countries", "umugabane", "continent", "54"] },
  { id: "ai", cat: "technology",
    t_rw: "Ubwenge buhangano (AI)", t_en: "Artificial intelligence (AI)",
    s_rw: "Ubwenge buhangano (AI) ni ikoranabuhanga ryigisha mudasobwa gukora ibisanzwe bisaba ubwenge bw'umuntu, nko gusobanukirwa ururimi, kumenya amashusho no gufata ibyemezo.",
    s_en: "Artificial intelligence (AI) is technology that lets computers do tasks that normally need human intelligence, such as understanding language, recognising images and making decisions.",
    kw: ["ai", "ubwenge buhangano", "ubwenge", "artificial intelligence", "intelligence", "machine learning", "robot"] },
  { id: "internet", cat: "technology",
    t_rw: "Murandasi (Internet)", t_en: "The internet",
    s_rw: "Murandasi ni urusobe rw'amamudasobwa menshi ahujwe ku isi hose, rutuma abantu basangira amakuru kandi bakavugana.",
    s_en: "The internet is a worldwide network of connected computers that lets people share information and communicate.",
    kw: ["murandasi", "internet", "urubuga", "website", "web", "online", "network", "urusobe"] },
  { id: "computer", cat: "technology",
    t_rw: "Mudasobwa", t_en: "What a computer is",
    s_rw: "Mudasobwa ni icyuma gikoresha porogaramu kigafata, kikabika kandi kigatunganya amakuru ukacyandikiramo amategeko.",
    s_en: "A computer is a machine that follows instructions in programs to take in, store and process information.",
    kw: ["mudasobwa", "computer", "porogaramu", "program", "software", "hardware", "laptop"] },
  { id: "malaria", cat: "health",
    t_rw: "Malariya", t_en: "Malaria",
    s_rw: "Malariya iterwa n'agakoko gakwirakwizwa n'imibu y'ingore yo mu bwoko bwa Anopheles. Kuyirinda bikorwa murara mu nzitiramubu, kandi wagira umuriro ugahita ujya kwa muganga. Ibi ntibisimbura inama za muganga.",
    s_en: "Malaria is caused by a parasite spread by female Anopheles mosquitoes. Sleeping under a mosquito net helps prevent it, and anyone with a fever should see a health worker. This does not replace medical advice.",
    kw: ["malariya", "malaria", "imibu", "mosquito", "umuriro", "fever", "inzitiramubu", "nzitiramubu", "ubuzima", "health"] }
];

let mifasaCoreDocs = null;
function getCoreDocs() {
  if (mifasaCoreDocs) return mifasaCoreDocs;
  mifasaCoreDocs = MIFASA_CORE_KNOWLEDGE.map(k => {
    const a = normalizeArticle({
      id: "core-" + k.id, share_id: "core-" + k.id,
      title_rw: k.t_rw, title_en: k.t_en,
      summary_rw: k.s_rw, summary_en: k.s_en,
      keywords: k.kw.slice(), category: k.cat
    }, "core");
    if (a) { a._core = true; a._body = ""; a._ts = 0; }
    return a;
  }).filter(Boolean).concat(mifasaBrainFactDocs());
  return mifasaCoreDocs;
}

/* 9d-2. MORE BUILT-IN KNOWLEDGE (Kinyarwanda + English)
   Adds many facts to MIFASA_CORE_KNOWLEDGE (part 170). Same rules: always available offline, answered from, never shown as news cards.
   Each row = [id, category, title_rw, title_en, text_rw, text_en, "keyword|keyword|..."]
   To add more later: add rows at the end of MIFASA_MORE_KNOWLEDGE (lowercase keywords, both languages, no double quotes inside strings).
   Rows whose id already exists are skipped, so nothing in part 170 is overwritten. */

const MIFASA_MORE_KNOWLEDGE = [

/* ================= RWANDA: government, history, society ================= */
["gov", "rwanda", "Ubutegetsi bw'u Rwanda", "How Rwanda is governed",
 "U Rwanda ni Repubulika ifite ubutegetsi butatu: Guverinoma (Perezida, Minisitiri w'Intebe n'Abaminisitiri), Inteko Ishinga Amategeko (Umutwe w'Abadepite ufite abadepite 80 na Sena ifite abasenateri 26) n'Ubucamanza. Itegeko Nshinga ririmo ryemejwe mu 2003 kandi ryavuguruwe mu 2015. Manda ya Perezida ni imyaka itanu. Abagore bagize hejuru ya 60% by'abadepite, ni ho ku isi hari abagore benshi mu nteko.",
 "Rwanda is a republic with three branches: the Executive (President, Prime Minister and Cabinet), the Legislature (Chamber of Deputies with 80 seats and a Senate with 26) and the Judiciary. The current constitution was adopted in 2003 and amended in 2015. A presidential term is five years. Women hold more than 60% of seats in the Chamber of Deputies, among the highest shares in the world.",
 "ubutegetsi|guverinoma|government|itegeko nshinga|constitution|inteko|parliament|sena|senate|abadepite|deputies|perezida|president|minisitiri w'intebe|prime minister|ubucamanza|judiciary|repubulika|republic|abagore mu nteko|women in parliament"],
["presidents", "rwanda", "Abaperezida b'u Rwanda kuva ku bwigenge", "Presidents of Rwanda since independence",
 "Abaperezida b'u Rwanda ni: Grégoire Kayibanda (1962–1973), Juvénal Habyarimana (1973–1994), Pasteur Bizimungu (1994–2000) na Paul Kagame uyobora igihugu kuva muri Mata 2000.",
 "Rwanda's presidents since independence are: Grégoire Kayibanda (1962–1973), Juvénal Habyarimana (1973–1994), Pasteur Bizimungu (1994–2000) and Paul Kagame, in office since April 2000.",
 "abaperezida|perezida|presidents|president|kayibanda|habyarimana|bizimungu|kagame|umukuru w'igihugu|head of state|list of presidents"],
["monarchy", "rwanda", "Ubwami bw'u Rwanda", "The Rwandan monarchy",
 "U Rwanda rwayobowe n'abami (Abami) mu binyejana byinshi mbere y'ubukoloni. Umwami Kigeli Rwabugiri yagutse igihugu mu kinyejana cya 19. Umwami Mutara III Rudahigwa yategetse kuva 1931 kugeza apfuye muri Nyakanga 1959, naho Kigeli V Ndahindurwa yategetse kugeza 1961 ubwo ubwami bwakurwaho.",
 "Rwanda was ruled by kings (Abami) for many centuries before colonial rule. King Kigeli Rwabugiri expanded the kingdom in the 19th century. Mutara III Rudahigwa reigned from 1931 until his death in July 1959, and Kigeli V Ndahindurwa reigned until the monarchy was abolished in 1961.",
 "ubwami|umwami|abami|monarchy|king|kings|rwabugiri|rudahigwa|mutara|kigeli|ndahindurwa|ingoma|kingdom|nyiginya|royal"],
["colonial", "rwanda", "Ubukoloni mu Rwanda", "Colonial period in Rwanda",
 "U Rwanda rwabaye igice cya Afurika y'Iburasirazuba y'Abadage guhera mu mpera z'ikinyejana cya 19. Nyuma y'Intambara ya Mbere y'Isi yose, mu 1916, Ababiligi barufashe, nyuma ruba munsi yabo nk'agace kashyizwe munsi y'Umuryango w'Amahanga. Rwabonye ubwigenge ku itariki ya 1 Nyakanga 1962.",
 "Rwanda was part of German East Africa from the late 19th century. After the First World War, in 1916, Belgium took control and later governed it under a League of Nations mandate. Rwanda became independent on 1 July 1962.",
 "ubukoloni|colonial|colonialism|abadage|german|germany|ababiligi|belgian|belgium|1916|mandate|amateka|history|ubwigenge|1962"],
["genocide-memorials", "rwanda", "Inzibutso za Jenoside n'urukiko rwa Arusha", "Genocide memorials and the Arusha tribunal",
 "Jenoside yakorewe Abatutsi mu 1994 yamaze iminsi igera ku 100. Inzibutso zizwi ni urwa Kigali i Gisozi (rwafunguwe mu 2004), Nyamata, Ntarama, Murambi na Bisesero. Urukiko mpuzamahanga rwashyiriweho u Rwanda (ICTR) rwakoreraga Arusha muri Tanzaniya, rwashinzwe mu 1994 rurangiza imirimo mu 2015.",
 "The genocide against the Tutsi in 1994 lasted about 100 days. Well-known memorials include Kigali Genocide Memorial at Gisozi (opened in 2004), Nyamata, Ntarama, Murambi and Bisesero. The International Criminal Tribunal for Rwanda (ICTR) sat in Arusha, Tanzania; it was set up in 1994 and finished its work in 2015.",
 "inzibutso|urwibutso|memorial|memorials|gisozi|nyamata|ntarama|murambi|bisesero|ictr|arusha|tribunal|iminsi 100|100 days|kigali genocide memorial|jenoside"],
["gacaca", "rwanda", "Inkiko Gacaca", "Gacaca courts",
 "Inkiko Gacaca ni inkiko zishingiye ku muco zakoreshejwe mu gucira imanza abakoze Jenoside. Zatangiye mu buryo bw'igerageza mu 2002, zikora mu gihugu hose guhera mu 2005, zisoza imirimo mu 2012 zimaze kuburanisha imanza zigera kuri miliyoni ebyiri.",
 "Gacaca courts were community-based courts used to try people accused of genocide crimes. They started as a pilot in 2002, worked nationwide from 2005 and closed in 2012 after handling close to two million cases.",
 "gacaca|inkiko gacaca|courts|inkiko|justice|ubutabera|abakoze jenoside|trials|community courts"],
["unity", "rwanda", "Ubumwe n'ubwiyunge", "Unity and reconciliation",
 "Komisiyo y'Igihugu y'Ubumwe n'Ubwiyunge (NURC) yashinzwe mu 1999. Gahunda nka Ndi Umunyarwanda (yatangiye mu 2013), ingando n'itorero zigamije guteza imbere ubumwe, indangagaciro n'ubwiyunge hagati y'Abanyarwanda.",
 "The National Unity and Reconciliation Commission (NURC) was created in 1999. Programmes such as Ndi Umunyarwanda (launched in 2013), ingando and itorero aim to build unity, shared values and reconciliation among Rwandans.",
 "ubumwe|ubwiyunge|unity|reconciliation|nurc|ndi umunyarwanda|ingando|itorero|indangagaciro|values"],
["umuganda", "rwanda", "Umuganda", "Umuganda (community work)",
 "Umuganda ni umurimo ukorwa ku bushake n'abaturage mu gufatanya gukora ibikorwa by'iterambere. Ukorwa buri wa gatandatu wa nyuma w'ukwezi, mu gitondo. Ibikorwa birimo gusukura, gutera ibiti no kubaka amashuri n'amazu y'abatishoboye.",
 "Umuganda is community work in which citizens come together to carry out development and cleaning tasks. It takes place on the last Saturday of every month, in the morning. Typical activities include cleaning, planting trees and building classrooms and homes for vulnerable families.",
 "umuganda|community work|last saturday|wa gatandatu wa nyuma|gusukura|isuku|volunteer|gufatanya"],
["girinka", "rwanda", "Girinka Munyarwanda", "Girinka (One Cow per Poor Family)",
 "Girinka ni gahunda yatangijwe mu 2006 yo guha inka umuryango utishoboye kugira ngo wiyongerere amata, ifumbire n'amafaranga. Uwayihawe agomba guha inyana mugenzi we utishoboye iyo inka ibyaye (kwitura).",
 "Girinka is a programme launched in 2006 that gives a cow to a poor family to improve its milk supply, manure and income. When the cow calves, the family passes the first female calf on to another family in need.",
 "girinka|inka|cow|one cow per poor family|kwitura|amata|milk|abatishoboye|poverty|gahunda"],
["imihigo", "rwanda", "Imihigo", "Imihigo (performance contracts)",
 "Imihigo ni umuco wa kera wo kwiha intego no kuzesa. Muri iki gihe ni amasezerano y'ibikorwa agirwa hagati ya Perezida n'inzego z'ibanze n'abayobozi, hakarebwa uko ibyo biyemeje byagezweho.",
 "Imihigo is an old Rwandan tradition of setting goals and pledging to achieve them. Today it is a system of performance contracts in which leaders and local governments commit to targets that are then evaluated.",
 "imihigo|performance contracts|intego|goals|targets|abayobozi|leaders|local government|inzego z'ibanze"],
["social-protection", "rwanda", "Ubwisungane mu kwivuza n'ubwiteganyirize", "Health insurance and social security",
 "Mituweli (ubwisungane mu kwivuza) ifasha Abanyarwanda benshi kwishyura serivisi z'ubuvuzi. RSSB (Rwanda Social Security Board) ishinzwe ubwiteganyirize n'ubwishingizi bw'abakozi. Ejo Heza ni gahunda yo kwizigamira y'igihe kirekire yatangiye mu 2018, yemerera umuntu wese kuzigama ku giti cye.",
 "Mutuelle de santé (community-based health insurance) helps most Rwandans pay for health services. The Rwanda Social Security Board (RSSB) manages social security and employee insurance. Ejo Heza is a long-term savings scheme launched in 2018 that lets anyone save for retirement.",
 "mituweli|mutuelle|ubwisungane|kwivuza|health insurance|rssb|ejo heza|pension|retirement|ubwiteganyirize|social security|kwizigamira"],
["vision", "rwanda", "Icyerekezo 2050", "Rwanda Vision 2050",
 "Icyerekezo 2020 cyatangiye mu 2000 kigamije guhindura u Rwanda igihugu gifite ubukungu bushingiye ku bumenyi. Icyerekezo 2050, cyatangijwe mu 2020, kigamije ko u Rwanda rugera ku bukungu buringaniye bwo hejuru mu 2035 no ku bukungu buri hejuru mu 2050.",
 "Vision 2020 was launched in 2000 to turn Rwanda into a knowledge-based economy. Vision 2050, launched in 2020, aims for Rwanda to reach upper-middle-income status by 2035 and high-income status by 2050.",
 "icyerekezo|vision 2050|vision 2020|development|iterambere|ubukungu|economy|middle income|high income|2035|2050"],
["facts-quick", "rwanda", "Amakuru y'ingenzi ku Rwanda", "Quick facts about Rwanda",
 "Kode y'igihugu ya telefoni ni +250 naho izina ry'urubuga ni .rw. Abantu batwara ibinyabiziga iburyo. Igihe gikoreshwa ni CAT (UTC+2). Amashanyarazi ni 230 V, imiyoboro ni ubwoko bwa C na J.",
 "Rwanda's telephone country code is +250 and its internet domain is .rw. People drive on the right. The time zone is CAT (UTC+2). The electricity supply is 230 V with Type C and J sockets.",
 "+250|calling code|kode ya telefoni|.rw|domain|drive on the right|gutwara iburyo|time zone|igihe|utc+2|cat|amashanyarazi|electricity|socket|plug|voltage"],
["holidays", "rwanda", "Iminsi mikuru y'u Rwanda", "Public holidays in Rwanda",
 "Iminsi mikuru ihoraho: 1 Mutarama (Intangiriro z'umwaka), 1 Gashyantare (Intwari), 7 Mata (Kwibuka), 1 Gicurasi (Umunsi mpuzamahanga w'umurimo), 1 Nyakanga (Ubwigenge), 4 Nyakanga (Kwibohora), Umuganura (ku wa Gatanu wa mbere wa Kanama), 15 Kanama (Asomusiyo), 25 Ukuboza (Noheli) na 26 Ukuboza (Boxing Day). Hiyongeraho Eid al-Fitr, Eid al-Adha, Ku wa Gatanu Mutagatifu na Pasika, bihinduka buri mwaka.",
 "Fixed public holidays: 1 January (New Year), 1 February (Heroes' Day), 7 April (Kwibuka), 1 May (Labour Day), 1 July (Independence Day), 4 July (Liberation Day), Umuganura (first Friday of August), 15 August (Assumption), 25 December (Christmas) and 26 December (Boxing Day). Eid al-Fitr, Eid al-Adha, Good Friday and Easter vary each year.",
 "iminsi mikuru|umunsi mukuru|holidays|public holidays|holiday|noheli|christmas|pasika|easter|eid|labour day|umunsi w'umurimo|1 gicurasi|1 may|new year|asomusiyo|assumption|boxing day"],
["kigali", "rwanda", "Umujyi wa Kigali", "The City of Kigali",
 "Kigali yashinzwe mu 1907 n'Umudage Richard Kandt, iba umurwa mukuru ku bwigenge mu 1962. Igizwe n'uturere dutatu: Gasabo, Kicukiro na Nyarugenge. Ahazwi: Kigali Convention Centre (2016), BK Arena (2019), Urwibutso rwa Kigali i Gisozi n'ikibuga cy'indege cya Kanombe. Kigali izwiho isuku n'umutekano.",
 "Kigali was founded in 1907 by the German Richard Kandt and became the capital at independence in 1962. It has three districts: Gasabo, Kicukiro and Nyarugenge. Landmarks include the Kigali Convention Centre (2016), BK Arena (2019), the Kigali Genocide Memorial at Gisozi and Kanombe International Airport. Kigali is known for its cleanliness and safety.",
 "kigali|umujyi wa kigali|city of kigali|gasabo|kicukiro|nyarugenge|kandt|convention centre|bk arena|kanombe|airport|ikibuga cy'indege|isuku|clean city"],
["secondary-cities", "rwanda", "Imijyi yunganira Kigali", "Rwanda's secondary cities",
 "Imijyi itandatu yunganira Kigali ni: Huye, Muhanga, Musanze, Nyagatare, Rubavu na Rusizi.",
 "Rwanda's six secondary cities are Huye, Muhanga, Musanze, Nyagatare, Rubavu and Rusizi.",
 "imijyi|secondary cities|huye|muhanga|musanze|nyagatare|rubavu|rusizi|cities|umujyi|towns"],
["districts-north", "rwanda", "Uturere tw'Intara y'Amajyaruguru", "Districts of the Northern Province",
 "Intara y'Amajyaruguru ifite uturere dutanu: Burera, Gakenke, Gicumbi, Musanze na Rulindo.",
 "The Northern Province has five districts: Burera, Gakenke, Gicumbi, Musanze and Rulindo.",
 "amajyaruguru|northern province|burera|gakenke|gicumbi|musanze|rulindo|uturere|districts"],
["districts-south", "rwanda", "Uturere tw'Intara y'Amajyepfo", "Districts of the Southern Province",
 "Intara y'Amajyepfo ifite uturere umunani: Gisagara, Huye, Kamonyi, Muhanga, Nyamagabe, Nyanza, Nyaruguru na Ruhango.",
 "The Southern Province has eight districts: Gisagara, Huye, Kamonyi, Muhanga, Nyamagabe, Nyanza, Nyaruguru and Ruhango.",
 "amajyepfo|southern province|gisagara|huye|kamonyi|muhanga|nyamagabe|nyanza|nyaruguru|ruhango|uturere|districts"],
["districts-east", "rwanda", "Uturere tw'Intara y'Iburasirazuba", "Districts of the Eastern Province",
 "Intara y'Iburasirazuba ifite uturere birindwi: Bugesera, Gatsibo, Kayonza, Kirehe, Ngoma, Nyagatare na Rwamagana.",
 "The Eastern Province has seven districts: Bugesera, Gatsibo, Kayonza, Kirehe, Ngoma, Nyagatare and Rwamagana.",
 "iburasirazuba|eastern province|bugesera|gatsibo|kayonza|kirehe|ngoma|nyagatare|rwamagana|uturere|districts"],
["districts-west", "rwanda", "Uturere tw'Intara y'Iburengerazuba", "Districts of the Western Province",
 "Intara y'Iburengerazuba ifite uturere birindwi: Karongi, Ngororero, Nyabihu, Nyamasheke, Rubavu, Rusizi na Rutsiro.",
 "The Western Province has seven districts: Karongi, Ngororero, Nyabihu, Nyamasheke, Rubavu, Rusizi and Rutsiro.",
 "iburengerazuba|western province|karongi|ngororero|nyabihu|nyamasheke|rubavu|rusizi|rutsiro|uturere|districts"],

/* ================= RWANDA: nature, tourism, economy ================= */
["rivers-lakes", "rwanda", "Imigezi n'ibiyaga by'u Rwanda", "Rivers and lakes of Rwanda",
 "Imigezi minini ni Nyabarongo (ni wo muremure mu Rwanda), Akagera na Rusizi. Akagera ijya mu kiyaga cya Victoria kandi ifatwa nk'imwe mu nkomoko za Nili. Ibiyaga bizwi: Kivu, Burera, Ruhondo, Muhazi, Ihema, Mugesera na Rweru. Ikiyaga cya Kivu gifite ubujyakuzimu bwa metero zigera kuri 475 kandi gifite gaze metani ikoreshwa mu gukora amashanyarazi.",
 "The main rivers are the Nyabarongo (Rwanda's longest), the Akagera and the Rusizi. The Akagera flows into Lake Victoria and is regarded as one of the Nile's sources. Well-known lakes include Kivu, Burera, Ruhondo, Muhazi, Ihema, Mugesera and Rweru. Lake Kivu is about 475 metres deep and contains methane gas used to generate electricity.",
 "imigezi|umugezi|river|rivers|nyabarongo|akagera|rusizi|nili|nile|ibiyaga|lakes|burera|ruhondo|muhazi|ihema|mugesera|rweru|kivu|methane|metani|victoria"],
["volcanoes", "rwanda", "Ibirunga by'u Rwanda", "Rwanda's volcanoes",
 "Mu misozi y'Ibirunga y'u Rwanda hari ibirunga bitanu: Karisimbi, Bisoke, Muhabura, Sabyinyo na Gahinga. Karisimbi ni cyo kirekire (metero 4,507).",
 "Five of the Virunga volcanoes are in Rwanda: Karisimbi, Bisoke, Muhabura, Sabyinyo and Gahinga. Karisimbi is the highest at about 4,507 metres.",
 "ibirunga|volcano|volcanoes|virunga|karisimbi|bisoke|muhabura|sabyinyo|gahinga|umusozi|mountain|hike|gutembera"],
["gorillas", "rwanda", "Ingagi zo mu misozi", "Mountain gorillas and Kwita Izina",
 "Ingagi zo mu misozi ziba muri Pariki y'Ibirunga. Ku isi hose hasigaye ingagi zigera ku 1,000 gusa. Kwita Izina ni umuhango wo guha amazina ibyana by'ingagi, watangiye mu 2005. Dian Fossey yashinze ikigo cy'ubushakashatsi cya Karisoke mu 1967.",
 "Mountain gorillas live in Volcanoes National Park, and only about 1,000 remain in the wild worldwide. Kwita Izina is the annual gorilla-naming ceremony, started in 2005. Dian Fossey founded the Karisoke Research Center in 1967.",
 "ingagi|gorilla|gorillas|mountain gorilla|kwita izina|naming ceremony|dian fossey|karisoke|silverback|amazina y'ingagi|primates"],
["akagera", "rwanda", "Pariki y'Akagera", "Akagera National Park",
 "Pariki y'Akagera iri mu Burasirazuba bw'u Rwanda kandi ni yo pariki ya savane yonyine y'igihugu. Ifite 'Big Five': intare (zagaruwe mu 2015), inkura (zagaruwe mu 2017), inzovu, imbogo n'ingwe. Ifite kandi imvubu, inzovu n'ibindi bikoko byinshi.",
 "Akagera National Park is in eastern Rwanda and is the country's only savannah park. It now has the Big Five: lions (reintroduced in 2015), rhinos (reintroduced in 2017), elephants, buffalo and leopards, along with hippos, giraffes and many other animals.",
 "akagera|akagera national park|savannah|savane|big five|intare|lion|lions|inkura|rhino|rhinos|inzovu|elephant|imbogo|buffalo|ingwe|leopard|imvubu|hippo|safari"],
["nyungwe", "rwanda", "Ishyamba rya Nyungwe", "Nyungwe Forest",
 "Nyungwe ni imwe mu mashyamba y'inzitane ya kera muri Afurika. Irimo ubwoko 13 bw'inguge, harimo n'impundu (chimpanzees), kandi ifite inzira yo hejuru y'ibiti (canopy walk) yafunguwe mu 2010. Ni imwe mu nkomoko za Nili.",
 "Nyungwe is one of Africa's oldest rainforests. It is home to 13 primate species, including chimpanzees, and has a canopy walkway that opened in 2010. It is also considered a source of the Nile.",
 "nyungwe|ishyamba|forest|rainforest|inguge|primates|impundu|chimpanzee|chimpanzees|canopy walk|canopy|tourism|birds|inyoni"],
["tourism-sites", "rwanda", "Ahantu nyaburanga hagenderwa mu Rwanda", "Top places to visit in Rwanda",
 "Ahantu hazwi: Pariki y'Ibirunga (ingagi), Nyungwe, Akagera, Ikiyaga cya Kivu na Congo Nile Trail (km 227), Urwibutso rwa Kigali, Ingoro y'Umwami i Nyanza, Ingoro Ndangamurage y'Ubuvanganzo n'Amoko i Huye na Inema Arts Center i Kigali.",
 "Popular places: Volcanoes National Park (gorillas), Nyungwe, Akagera, Lake Kivu and the 227 km Congo Nile Trail, Kigali Genocide Memorial, the King's Palace Museum in Nyanza, the Ethnographic Museum in Huye and Inema Arts Center in Kigali.",
 "ubukerarugendo|tourism|tourist|ahantu nyaburanga|places to visit|visit rwanda|congo nile trail|nyanza|king's palace|ingoro y'umwami|ingoro ndangamurage|museum|huye|inema|travel|gutembera"],
["economy", "rwanda", "Ubukungu bw'u Rwanda", "Rwanda's economy",
 "Ibyoherezwa mu mahanga bikomeye ni ikawa, icyayi, amabuye y'agaciro (tin, tungsten, tantalum na zahabu) n'ubukerarugendo bwinjiza amadovize. Urwego rwa serivisi ni rwo runini mu bukungu. Ikigo cy'Igihugu gishinzwe Iterambere (RDB) cyashinzwe mu 2008 kugira ngo gishyigikire ishoramari.",
 "Rwanda's main exports are coffee, tea and minerals (tin, tungsten, tantalum and gold), and tourism earns foreign currency. Services are the largest sector of the economy. The Rwanda Development Board (RDB), created in 2008, promotes investment.",
 "ubukungu|economy|exports|ibyoherezwa|ikawa|coffee|icyayi|tea|amabuye y'agaciro|minerals|tin|tungsten|tantalum|zahabu|gold|rdb|investment|ishoramari|gdp|business"],
["agriculture", "rwanda", "Ubuhinzi mu Rwanda", "Agriculture in Rwanda",
 "Ubuhinzi ni bwo bukorwa n'abaturage benshi mu Rwanda. Ibihingwa by'ingenzi: ibishyimbo, ibigori, ibirayi, imyumbati, ibitoki, ikawa n'icyayi. Ibihembwe by'ihinga ni bitatu: Igihembwe A (Nzeri–Mutarama), B (Gashyantare–Kamena) na C (igihe cy'izuba, Nyakanga–Kanama, mu bishanga). Hakoreshwa amaterasi n'ifumbire mu kurwanya isuri.",
 "Agriculture employs most Rwandans. Key crops are beans, maize, potatoes, cassava, bananas, coffee and tea. There are three farming seasons: Season A (September to January), B (February to June) and C (the dry season, July to August, mostly in marshlands). Terracing and fertiliser are used to fight soil erosion.",
 "ubuhinzi|agriculture|farming|ihinga|igihembwe a|igihembwe b|igihembwe c|season a|season b|ibishyimbo|beans|ibigori|maize|ibirayi|potatoes|imyumbati|cassava|ibitoki|bananas|amaterasi|terraces|ifumbire|fertilizer|umuhinzi|farmer|crops"],
["coffee-tea", "rwanda", "Ikawa n'icyayi by'u Rwanda", "Rwandan coffee and tea",
 "Ikawa y'u Rwanda ni iy'ubwoko bwa Arabica (cyane cyane Bourbon) kandi izwiho uburyohe ku isoko mpuzamahanga. Icyayi cyera cyane mu Majyepfo n'Iburengerazuba, nko hafi ya Nyungwe. Ibi bihingwa byombi byinjiza amadovize menshi.",
 "Rwandan coffee is mostly Arabica (especially Bourbon variety) and is prized abroad for its flavour. Tea grows well in the south and west, notably near Nyungwe. Both crops bring in significant export income.",
 "ikawa|coffee|arabica|bourbon|icyayi|tea|specialty coffee|washing station|uruganda rw'ikawa|export"],
["energy", "rwanda", "Amashanyarazi mu Rwanda", "Electricity in Rwanda",
 "Amashanyarazi mu Rwanda aturuka ku mazi (nka Ntaruka na Rusizi), kuri gaze metani yo mu Kivu (KivuWatt), ku zuba n'ahandi. Urugomero rw'izuba rwa Rwamagana (megawati 8.5, rwafunguwe mu 2014) rwabaye urwa mbere runini mu Burasirazuba bwa Afurika. Rwanda Energy Group (REG) ishinzwe ibikorwa byayo.",
 "Rwanda's electricity comes from hydropower (such as Ntaruka and Rusizi), Lake Kivu methane (KivuWatt), solar and other sources. The 8.5 MW Rwamagana solar plant, opened in 2014, was East Africa's first utility-scale solar plant. Rwanda Energy Group (REG) manages the sector.",
 "amashanyarazi|electricity|power|ingufu|energy|izuba|solar|hydropower|amazi|ntaruka|kivuwatt|reg|rwanda energy group|rwamagana solar|biyomasi"],
["environment", "rwanda", "Kurengera ibidukikije mu Rwanda", "Protecting the environment in Rwanda",
 "U Rwanda rwabujije imifuka ya pulasitiki (nylon) mu 2008. Muri Kigali habaho 'Car Free Day' inshuro ebyiri mu kwezi, abantu bagakora siporo mu mihanda. Kwita ku mashyamba, gutera ibiti n'umuganda ni imwe mu ngamba zo kurengera ikirere.",
 "Rwanda banned plastic bags in 2008. Kigali holds Car Free Day twice a month, when streets are closed to traffic for exercise. Forest protection, tree planting and umuganda are among the country's environmental measures.",
 "ibidukikije|environment|pulasitiki|plastic|nylon|imifuka|plastic ban|car free day|gutera ibiti|tree planting|amashyamba|forests|climate|ikirere|isuku|green"],
["transport", "rwanda", "Ingendo mu Rwanda", "Getting around in Rwanda",
 "Mu Rwanda ingendo zikorwa n'amabisi, tagisi-moto, tagisi-voiture n'amagare. Muri Kigali ishyirwa mu bikorwa ry'ikarita yo kwishyura ingendo (Tap&Go). Ikibuga cy'indege mpuzamahanga ni Kanombe i Kigali, kandi RwandAir ni sosiyete y'indege y'igihugu.",
 "In Rwanda people travel by bus, moto-taxi, taxi-cab and bicycle. In Kigali, buses can be paid with the Tap&Go card. The main international airport is Kanombe in Kigali, and RwandAir is the national airline.",
 "ingendo|transport|bus|ibisi|moto|tagisi|taxi|tap&go|tap and go|rwandair|airline|indege|flight|airport|kanombe|bugesera airport|gutwara|travel"],
["emergency", "rwanda", "Imibare yo guhamagara ku bibazo byihutirwa", "Emergency numbers in Rwanda",
 "Imibare yo kwihutira gutabaza mu Rwanda: 112 (Polisi y'u Rwanda), 912 (ambulance/SAMU), 114 (Ikigo cy'Igihugu cy'Ubuzima, RBC, kuri telefoni y'ubuntu). Imibare ishobora guhinduka, wemeze neza ku mbuga za Leta cyangwa Polisi.",
 "Emergency numbers in Rwanda: 112 (Rwanda National Police), 912 (ambulance/SAMU) and 114 (Rwanda Biomedical Centre toll-free health line). Numbers can change, so confirm on official government or police sources.",
 "112|912|114|emergency|byihutirwa|polisi|police|ambulance|samu|rbc|gutabaza|ubutabazi|help|number|umubare|hotline"],
["sports-rw", "rwanda", "Siporo mu Rwanda", "Sports in Rwanda",
 "Umupira w'amaguru ni wo ukunzwe cyane. Ikipe y'igihugu Amavubi yakinnye igikombe cya Afurika (CAN) mu 2004 muri Tuniziya. Amakipe azwi ni APR FC na Rayon Sports. Isiganwa ry'amagare Tour du Rwanda ritangira mu 1988, kandi muri Nzeri 2025 Kigali yakiriye Shampiyona y'Isi y'Amagare (UCI), ibaye iya mbere muri Afurika.",
 "Football is the most popular sport. The national team, Amavubi, played at the Africa Cup of Nations in 2004 in Tunisia. Well-known clubs include APR FC and Rayon Sports. The cycling race Tour du Rwanda began in 1988, and in September 2025 Kigali hosted the UCI Road World Championships, the first ever held in Africa.",
 "siporo|sports|umupira|football|soccer|amavubi|apr|apr fc|rayon sports|rayon|tour du rwanda|amagare|cycling|uci|can|afcon|basketball|basketball mu rwanda|bk arena|marathon|peace marathon"],
["technology-rw", "technology", "Ikoranabuhanga mu Rwanda", "Technology in Rwanda",
 "Irembo ni urubuga rwa Leta rwo gusaba serivisi, rwatangiye mu 2014. MTN MoMo na Airtel Money bikoreshwa mu kwishyura. Rwanda yatangije indege nto zitwara amaraso n'imiti (Zipline) mu 2016, kandi Kigali Innovation City ni umushinga wo guteza imbere ikoranabuhanga. Murandasi ya 4G ikoreshwa mu gihugu.",
 "Irembo is the government portal for online services, launched in 2014. MTN MoMo and Airtel Money are widely used for mobile payments. Rwanda started drone deliveries of blood and medicines with Zipline in 2016, and Kigali Innovation City is a technology hub project. 4G internet is available across much of the country.",
 "irembo|momo|mtn momo|airtel money|mobile money|zipline|drone|drones|kigali innovation city|4g|ikoranabuhanga|ict|e-government|serivisi|startup|innovation|*182#"],
["education-rw", "rwanda", "Uburezi mu Rwanda", "Education in Rwanda",
 "Uburezi bw'ibanze bw'imyaka 12 (12YBE) bwatangiye mu 2012: imyaka 6 y'amashuri abanza, 3 y'icyiciro rusange na 3 y'icyiciro cya kabiri. Icyongereza cyabaye ururimi rwigishwamo mu 2008. Kaminuza y'u Rwanda yashinzwe mu 2013 ihurije hamwe amashuri makuru ya Leta. Ikigo REB gishinzwe uburezi bw'ibanze.",
 "Twelve-Year Basic Education (12YBE) began in 2012: six years of primary, three of lower secondary and three of upper secondary. English became the language of instruction in 2008. The University of Rwanda was created in 2013 by merging public higher-learning institutions. The Rwanda Education Board (REB) oversees basic education.",
 "uburezi|education|amashuri|school|schools|12ybe|reb|rwanda education board|kaminuza|university|university of rwanda|ur|abanza|primary|secondary|inshuke|students|abanyeshuri|curriculum|isomero"],
["universities", "rwanda", "Kaminuza zo mu Rwanda", "Universities in Rwanda",
 "Kaminuza n'amashuri makuru azwi mu Rwanda arimo Kaminuza y'u Rwanda (UR), AUCA, INES-Ruhengeri, Mount Kenya University Rwanda, Carnegie Mellon University Africa, African Leadership University na Kepler. Komisiyo ishinzwe amashuri makuru ni HEC.",
 "Well-known universities and colleges in Rwanda include the University of Rwanda (UR), AUCA, INES-Ruhengeri, Mount Kenya University Rwanda, Carnegie Mellon University Africa, African Leadership University and Kepler. The Higher Education Council (HEC) regulates the sector.",
 "kaminuza|universities|university|ur|auca|ines|ines ruhengeri|mount kenya|carnegie mellon|african leadership university|alu|kepler|hec|amashuri makuru|college|scholarship|buruse"],

/* ================= CULTURE & LANGUAGE ================= */
["culture", "culture", "Umuco nyarwanda", "Rwandan culture",
 "Umuco nyarwanda urangwa n'imbyino ya Intore, ingoma, inanga, umuduri, imigongo (ubugeni bukorerwa i Kirehe), agaseke (igitenge cy'ubudodo) n'ibyivugo. Gusangira, kwakira abashyitsi no gutabarana ni indangagaciro z'ingenzi.",
 "Rwandan culture is known for Intore dance, drums (ingoma), the inanga zither, the umuduri musical bow, imigongo art (from Kirehe), woven agaseke baskets and oral poetry (ibyivugo). Hospitality, sharing and mutual help are core values.",
 "umuco|culture|culture nyarwanda|intore|imbyino|dance|ingoma|drum|drums|inanga|umuduri|imigongo|agaseke|basket|ibyivugo|poetry|ubugeni|art|traditional|gakondo|umushagiriro|ikinimba"],
["greetings", "language", "Indamutso mu Kinyarwanda", "Greetings in Kinyarwanda",
 "Muraho = Hello. Mwaramutse = Good morning. Mwiriwe = Good afternoon/evening. Murabeho = Goodbye. Murakoze = Thank you. Mbabarira = Sorry/Excuse me. Yego = Yes. Oya = No. Amakuru? = How are you? Meze neza = I'm fine. Urakaza neza = You are welcome (when someone arrives).",
 "Kinyarwanda greetings: Muraho = Hello. Mwaramutse = Good morning. Mwiriwe = Good afternoon/evening. Murabeho = Goodbye. Murakoze = Thank you. Mbabarira = Sorry/Excuse me. Yego = Yes. Oya = No. Amakuru? = How are you? Meze neza = I'm fine. Urakaza neza = Welcome.",
 "indamutso|greetings|muraho|mwaramutse|mwiriwe|murabeho|murakoze|mbabarira|yego|oya|amakuru|meze neza|urakaza neza|hello in kinyarwanda|thank you in kinyarwanda|how to say|uko bavuga"],
["numbers", "language", "Imibare mu Kinyarwanda", "Numbers in Kinyarwanda",
 "1 rimwe, 2 kabiri, 3 gatatu, 4 kane, 5 gatanu, 6 gatandatu, 7 karindwi, 8 umunani, 9 icyenda, 10 icumi, 20 makumyabiri, 30 mirongo itatu, 100 ijana, 1000 igihumbi, miliyoni 1 = miliyoni imwe.",
 "Kinyarwanda numbers: 1 rimwe, 2 kabiri, 3 gatatu, 4 kane, 5 gatanu, 6 gatandatu, 7 karindwi, 8 umunani, 9 icyenda, 10 icumi, 20 makumyabiri, 30 mirongo itatu, 100 ijana, 1000 igihumbi, one million = miliyoni imwe.",
 "imibare|numbers|rimwe|kabiri|gatatu|kane|gatanu|gatandatu|karindwi|umunani|icyenda|icumi|makumyabiri|ijana|igihumbi|count|gukuramo|kubara|counting in kinyarwanda"],
["colors", "language", "Amabara mu Kinyarwanda", "Colours in Kinyarwanda",
 "Umutuku = red, ubururu = blue, icyatsi kibisi = green, umuhondo = yellow, umweru = white, umukara = black, orange = orange.",
 "Colours in Kinyarwanda: umutuku = red, ubururu = blue, icyatsi kibisi = green, umuhondo = yellow, umweru = white, umukara = black, orange = orange.",
 "amabara|ibara|colors|colours|color|umutuku|ubururu|icyatsi|umuhondo|umweru|umukara|red|blue|green|yellow|white|black"],
["family-words", "language", "Amagambo y'umuryango", "Family words in Kinyarwanda",
 "Umuryango = family, umwana = child, umuhungu = son/boy, umukobwa = daughter/girl, umugabo = man/husband, umugore = woman/wife, sogokuru = grandfather, nyogokuru = grandmother, mukuru = elder sibling, murumuna = younger sibling, inshuti = friend.",
 "Family words: umuryango = family, umwana = child, umuhungu = son/boy, umukobwa = daughter/girl, umugabo = man/husband, umugore = woman/wife, sogokuru = grandfather, nyogokuru = grandmother, mukuru = elder sibling, murumuna = younger sibling, inshuti = friend.",
 "umuryango|family|umwana|child|umuhungu|son|umukobwa|daughter|umugabo|husband|umugore|wife|sogokuru|grandfather|nyogokuru|grandmother|mukuru|murumuna|sibling|inshuti|friend|abavandimwe|relatives"],
["body-words", "language", "Ibice by'umubiri mu Kinyarwanda", "Body parts in Kinyarwanda",
 "Umutwe = head, ijisho (amaso) = eye(s), izuru = nose, ugutwi (amatwi) = ear(s), umunwa = mouth, amenyo = teeth, ukuboko = arm/hand, ukuguru = leg, ikirenge = foot, umutima = heart, inda = stomach.",
 "Body parts: umutwe = head, ijisho (amaso) = eye(s), izuru = nose, ugutwi (amatwi) = ear(s), umunwa = mouth, amenyo = teeth, ukuboko = arm/hand, ukuguru = leg, ikirenge = foot, umutima = heart, inda = stomach.",
 "umubiri|body|body parts|umutwe|head|ijisho|amaso|eye|izuru|nose|ugutwi|ear|umunwa|mouth|amenyo|teeth|ukuboko|hand|arm|ukuguru|leg|ikirenge|foot|umutima|heart|inda|stomach"],
["animals-words", "language", "Amatungo n'inyamaswa mu Kinyarwanda", "Animals in Kinyarwanda",
 "Inka = cow, ihene = goat, intama = sheep, inkoko = chicken, imbwa = dog, injangwe = cat, intare = lion, inzovu = elephant, imvubu = hippo, ingwe = leopard, ingagi = gorilla, inyoni = bird, ifi = fish, inzoka = snake.",
 "Animals: inka = cow, ihene = goat, intama = sheep, inkoko = chicken, imbwa = dog, injangwe = cat, intare = lion, inzovu = elephant, imvubu = hippo, ingwe = leopard, ingagi = gorilla, inyoni = bird, ifi = fish, inzoka = snake.",
 "inyamaswa|amatungo|animals|animal|inka|ihene|intama|inkoko|imbwa|injangwe|intare|inzovu|imvubu|ingwe|ingagi|inyoni|ifi|inzoka|cow|goat|sheep|chicken|dog|cat|lion|elephant|hippo|bird|fish|snake"],
["food-words", "language", "Ibiryo by'u Rwanda", "Rwandan foods",
 "Ibiryo bikunzwe: ibishyimbo (beans), ibirayi (potatoes), ibitoki (bananas/matoke), umuceri (rice), ubugari (stiff porridge), isombe (cassava leaves), ibijumba (sweet potatoes), imyumbati (cassava), akabenzi (pork), brochette n'umutsima. Ibinyobwa: amata, igikoma, icyayi n'ikawa.",
 "Popular foods: ibishyimbo (beans), ibirayi (potatoes), ibitoki (bananas/matoke), umuceri (rice), ubugari (stiff porridge), isombe (cassava leaves), ibijumba (sweet potatoes), imyumbati (cassava), akabenzi (pork) and brochettes. Drinks include amata (milk), igikoma (porridge drink), icyayi (tea) and ikawa (coffee).",
 "ibiryo|food|foods|ibishyimbo|ibirayi|ibitoki|matoke|umuceri|rice|ubugari|isombe|ibijumba|imyumbati|akabenzi|brochette|amata|igikoma|icyayi|ikawa|ifunguro|meal|gutegura|traditional food"],
["kinyarwanda-facts", "language", "Ikinyarwanda", "The Kinyarwanda language",
 "Ikinyarwanda ni ururimi rwo mu muryango w'indimi z'Ababantu, rukoreshwa n'abarenga miliyoni 12 mu Rwanda no mu bihugu bihana imbibi. Ni ururimi rufite amajwi (tonal), rufite inyajwi eshanu (a, e, i, o, u). Rujya gusa cyane n'Ikirundi cy'u Burundi.",
 "Kinyarwanda is a Bantu language spoken by more than 12 million people in Rwanda and neighbouring countries. It is a tonal language with five vowels (a, e, i, o, u), and is very close to Kirundi, the language of Burundi.",
 "ikinyarwanda|kinyarwanda|language|ururimi|bantu|bantu language|tonal|inyajwi|vowels|ikirundi|kirundi|grammar|ikibonezamvugo|inyuguti|alphabet|speakers|abavuga"],
["kinyarwanda-grammar", "language", "Ibibonezamvugo by'Ikinyarwanda", "Kinyarwanda grammar basics",
 "Mu Kinyarwanda amazina agabanyijwe mu byiciro (nk'umu-/aba-: umuntu/abantu, iki-/ibi-: igitabo/ibitabo, in-/in-: inka/inka). Inshinga ihinduka bitewe n'uwo ivugwaho, igihe n'inshinga ishyigikira (urugero: ndarya = I eat, urarya = you eat, arya = he/she eats). Iyi ni incamake gusa.",
 "In Kinyarwanda, nouns are grouped into classes (such as umu-/aba-: umuntu/abantu = person/people; iki-/ibi-: igitabo/ibitabo = book/books). Verbs change with the subject and tense (for example: ndarya = I eat, urarya = you eat, arya = he/she eats). This is only a brief overview.",
 "ibibonezamvugo|grammar|inshinga|verb|verbs|izina|noun|nouns|ibyiciro|noun class|umuntu|abantu|igitabo|ibitabo|tense|igihe|conjugation|kwiga ikinyarwanda|learn kinyarwanda"],
["phrasebook", "language", "Amagambo y'ingenzi mu ndimi enye", "Basic phrases in four languages",
 "Muraho = Hello = Bonjour = Jambo. Murakoze = Thank you = Merci = Asante. Yego = Yes = Oui = Ndiyo. Oya = No = Non = Hapana. Murabeho = Goodbye = Au revoir = Kwaheri. Murakaza neza = Welcome = Bienvenue = Karibu. Mbabarira = Sorry = Pardon = Samahani.",
 "Basic phrases (Kinyarwanda = English = French = Swahili): Muraho = Hello = Bonjour = Jambo. Murakoze = Thank you = Merci = Asante. Yego = Yes = Oui = Ndiyo. Oya = No = Non = Hapana. Murabeho = Goodbye = Au revoir = Kwaheri. Murakaza neza = Welcome = Bienvenue = Karibu. Mbabarira = Sorry = Pardon = Samahani.",
 "phrasebook|amagambo|phrases|swahili|igiswahili|french|igifaransa|bonjour|merci|jambo|asante|karibu|kwaheri|hapana|ndiyo|samahani|translate|guhindura|how do you say|uko bavuga"],
["english-grammar", "language", "Ibyibanze mu Cyongereza", "English grammar basics",
 "Amagambo y'Icyongereza ni: noun (izina), verb (inshinga), adjective (inyito), adverb (inshinga-ngereka) na pronoun (ikinyazina). Ibihe by'ingenzi: present (I eat), past (I ate) na future (I will eat). Urugero rw'ikibazo: 'Do you speak English?' = 'Uvuga Icyongereza?'",
 "The main parts of speech in English are nouns, verbs, adjectives, adverbs and pronouns. The three basic tenses are present (I eat), past (I ate) and future (I will eat). Example question: 'Do you speak English?' = 'Uvuga Icyongereza?'",
 "icyongereza|english|english grammar|grammar|noun|verb|adjective|adverb|pronoun|tense|tenses|present|past|future|kwiga icyongereza|learn english|parts of speech|ibihe"],
["swahili", "language", "Igiswahili", "Swahili",
 "Igiswahili ni ururimi rwemewe mu Rwanda kandi ruvugwa mu Burasirazuba bwa Afurika n'ahandi. Ni rwo rurimi rukuru muri Tanzaniya na Kenya, kandi rukoreshwa n'abantu babarirwa muri za miliyoni. Imvugo nka 'Jambo' (hello), 'Asante' (thank you) na 'Karibu' (welcome) zizwi cyane.",
 "Swahili is an official language of Rwanda and is widely spoken across East Africa. It is a national language in Tanzania and Kenya and is used by tens of millions of people. Words such as 'Jambo' (hello), 'Asante' (thank you) and 'Karibu' (welcome) are very well known.",
 "igiswahili|swahili|kiswahili|jambo|asante|karibu|hakuna matata|east africa language|tanzania|kenya"],

/* ================= AFRICA & WORLD ================= */
["au", "africa", "Umuryango wa Afurika Yunze Ubumwe", "The African Union",
 "Umuryango wa Afurika Yunze Ubumwe (AU) washinzwe mu 2002 usimbura OAU yashinzwe mu 1963. Icyicaro cyawo kiri Addis Ababa muri Etiyopiya. Isoko rusange rya Afurika (AfCFTA) ryatangiye gukoreshwa mu 2021.",
 "The African Union (AU) was founded in 2002, replacing the Organisation of African Unity (OAU), which was created in 1963. Its headquarters are in Addis Ababa, Ethiopia. The African Continental Free Trade Area (AfCFTA) began trading in 2021.",
 "au|african union|umuryango wa afurika yunze ubumwe|oau|addis ababa|etiyopiya|ethiopia|afcfta|free trade|isoko rusange|summit|inama"],
["eac-members", "africa", "Ibihugu bigize EAC", "Members of the East African Community",
 "Umuryango wa Afurika y'Iburasirazuba (EAC) ufite ibihugu umunani: Burundi, Repubulika Iharanira Demokarasi ya Kongo, Kenya, u Rwanda, Somaliya, Sudani y'Epfo, Tanzaniya na Uganda. Icyicaro kiri Arusha muri Tanzaniya.",
 "The East African Community (EAC) has eight members: Burundi, the Democratic Republic of the Congo, Kenya, Rwanda, Somalia, South Sudan, Tanzania and Uganda. Its headquarters are in Arusha, Tanzania.",
 "eac|east african community|members|ibihugu bigize eac|arusha|burundi|kenya|somalia|somaliya|south sudan|sudani y'epfo|tanzania|uganda|kongo|drc|umuryango"],
["africa-records", "africa", "Afurika mu mibare", "Africa's records and extremes",
 "Umusozi muremure muri Afurika ni Kilimanjaro (metero 5,895) muri Tanzaniya. Uruzi rurerure ni Nili (hafi km 6,650). Ikiyaga kinini ni Victoria. Ubutayu bunini ni Sahara. Igihugu kinini mu buso ni Alijeriya, naho gifite abaturage benshi ni Nijeriya. Seychelles ni cyo gito mu buso.",
 "Africa's highest mountain is Kilimanjaro (5,895 m) in Tanzania. The longest river is the Nile (about 6,650 km). The largest lake is Lake Victoria and the largest desert is the Sahara. Algeria is the largest country by area and Nigeria the most populous. Seychelles is the smallest by area.",
 "kilimanjaro|nile|nili|victoria|sahara|ubutayu|desert|alijeriya|algeria|nijeriya|nigeria|largest country|smallest country|igihugu kinini|igihugu gito|seychelles|africa facts|africa records|longest river|highest mountain"],
["african-capitals", "africa", "Imijyi mikuru y'ibihugu bya Afurika", "African capital cities",
 "Imijyi mikuru: Kenya – Nairobi, Uganda – Kampala, Tanzaniya – Dodoma (Dar es Salaam ni umujyi munini), Burundi – Gitega (Bujumbura ni umujyi munini), DR Kongo – Kinshasa, Etiyopiya – Addis Ababa, Misiri – Cairo, Nijeriya – Abuja, Afurika y'Epfo – Pretoria (n'iyindi), Gana – Accra, Senegali – Dakar, Maroc – Rabat.",
 "Capitals: Kenya – Nairobi, Uganda – Kampala, Tanzania – Dodoma (Dar es Salaam is the largest city), Burundi – Gitega (Bujumbura is the largest city), DR Congo – Kinshasa, Ethiopia – Addis Ababa, Egypt – Cairo, Nigeria – Abuja, South Africa – Pretoria (plus others), Ghana – Accra, Senegal – Dakar, Morocco – Rabat.",
 "imijyi mikuru|capitals|capital cities|umurwa mukuru|nairobi|kampala|dodoma|dar es salaam|gitega|bujumbura|kinshasa|addis ababa|cairo|abuja|pretoria|accra|dakar|rabat|capital of kenya|capital of uganda|capital of tanzania|capital of burundi"],
["african-leaders", "africa", "Abayobozi n'intwari bo muri Afurika", "Notable African figures",
 "Nelson Mandela yabaye Perezida wa Afurika y'Epfo kuva 1994 kugeza 1999 amaze imyaka myinshi afunzwe kubera kurwanya ivangura. Kwame Nkrumah yayoboye Gana ibonye ubwigenge mu 1957. Julius Nyerere yayoboye Tanzaniya. Wangari Maathai (Kenya) yahawe igihembo cy'amahoro cya Nobel mu 2004. Patrice Lumumba yabaye Minisitiri w'Intebe wa mbere wa Kongo mu 1960.",
 "Nelson Mandela was President of South Africa from 1994 to 1999 after decades fighting apartheid, much of it in prison. Kwame Nkrumah led Ghana to independence in 1957. Julius Nyerere led Tanzania. Wangari Maathai of Kenya won the Nobel Peace Prize in 2004. Patrice Lumumba became the Congo's first prime minister in 1960.",
 "mandela|nelson mandela|nkrumah|kwame nkrumah|nyerere|julius nyerere|wangari maathai|maathai|lumumba|patrice lumumba|apartheid|ivangura|abayobozi|leaders|intwari|heroes|african leaders|africa history|amateka ya afurika"],
["world-basics", "world", "Isi mu ncamake", "The world at a glance",
 "Ku isi hari imigabane irindwi n'inyanja eshanu (Pasifika, Atalantika, Indiya, Arctic na Antarctic). Pasifika ni yo nini cyane. Igihugu kinini ni Uburusiya, gito ni Vatikani. Igihugu gifite abaturage benshi ni Ubuhinde. Abaturage b'isi barenze miliyari 8 kuva mu 2022.",
 "The world has seven continents and five oceans (Pacific, Atlantic, Indian, Arctic and Southern). The Pacific is the largest. Russia is the largest country by area and Vatican City the smallest. India is the most populous country. The world's population passed 8 billion in 2022.",
 "isi|world|imigabane|continents|inyanja|oceans|pasifika|pacific|atlantic|indian ocean|russia|uburusiya|vatican|ubuhinde|india|population|abaturage b'isi|world population|largest country|smallest country|geography|ubumenyi bw'isi"],
["un", "world", "Umuryango w'Abibumbye", "The United Nations",
 "Umuryango w'Abibumbye (UN) washinzwe mu 1945 nyuma y'Intambara ya Kabiri y'Isi yose, ufite icyicaro i New York. Ufite ibihugu 193 binyamuryango. Ugamije amahoro, uburenganzira bwa muntu n'iterambere.",
 "The United Nations (UN) was founded in 1945 after the Second World War and is headquartered in New York. It has 193 member states and works for peace, human rights and development.",
 "un|umuryango w'abibumbye|united nations|1945|new york|193|member states|security council|akanama k'umutekano|peace|amahoro|human rights|uburenganzira bwa muntu|unicef|who|unesco"],
["world-wars", "history", "Intambara z'Isi", "The World Wars",
 "Intambara ya Mbere y'Isi yose yabaye kuva 1914 kugeza 1918, iya Kabiri iba kuva 1939 kugeza 1945. Iya Kabiri yarangiye nyuma y'aho Umuryango w'Abibumbye ushingwa.",
 "The First World War lasted from 1914 to 1918 and the Second World War from 1939 to 1945. The United Nations was founded after the Second World War.",
 "intambara|war|wars|world war|world war 1|world war 2|ww1|ww2|1914|1918|1939|1945|intambara ya mbere y'isi|intambara ya kabiri y'isi|hitler|history"],
["inventions", "history", "Ibyahimbwe bikomeye", "Famous inventions and inventors",
 "Alexander Graham Bell yahimbye telefoni (1876). Thomas Edison yakoze itara rikoresha ingufu z'amashanyarazi rigezweho (1879). Abavandimwe Wright bagurutse bwa mbere mu ndege mu 1903. Alexander Fleming yavumbuye penisilini mu 1928. Tim Berners-Lee yatangije urubuga rw'isi (World Wide Web) mu 1989.",
 "Alexander Graham Bell patented the telephone (1876). Thomas Edison developed a practical light bulb (1879). The Wright brothers made the first powered flight in 1903. Alexander Fleming discovered penicillin in 1928. Tim Berners-Lee proposed the World Wide Web in 1989.",
 "ibyahimbwe|inventions|invention|inventor|inventors|telefoni|telephone|bell|edison|light bulb|itara|wright brothers|aeroplane|indege|penicillin|penisilini|fleming|berners-lee|www|world wide web|uwahimbye"],

/* ================= SCIENCE & SPACE ================= */
["solar-system", "science", "Imibumbe y'izuba", "The Solar System",
 "Sisitemu y'Izuba ifite imibumbe umunani: Mercure, Venusi, Isi (Earth), Mars, Jupiter, Saturne, Uranus na Neptune. Jupiter ni wo munini. Izuba ni inyenyeri; urumuri rwaryo rugera ku Isi mu minota hafi 8.",
 "The Solar System has eight planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune. Jupiter is the largest. The Sun is a star, and its light takes about 8 minutes to reach Earth.",
 "imibumbe|planets|planet|solar system|sisitemu y'izuba|izuba|sun|mercury|venus|earth|isi|mars|jupiter|saturn|uranus|neptune|inyenyeri|star|space|ikirere|galaxy|universe"],
["moon", "science", "Ukwezi n'urugendo rwa mbere", "The Moon and the first landing",
 "Ukwezi ni ryo bumbe rimwe rizenguruka Isi mu buryo karemano. Ruzenguruka Isi mu minsi hafi 27. Ku itariki ya 20 Nyakanga 1969, Neil Armstrong na Buzz Aldrin ni bo bantu ba mbere bagenze ku kwezi mu butumwa bwa Apollo 11.",
 "The Moon is Earth's only natural satellite and orbits Earth in about 27 days. On 20 July 1969, Neil Armstrong and Buzz Aldrin became the first people to walk on the Moon during the Apollo 11 mission.",
 "ukwezi|moon|apollo|apollo 11|armstrong|aldrin|1969|lunar|nasa|space travel|satellite|umubumbe|iminsi 27|eclipse|ubwirakabiri"],
["physics-basics", "science", "Ibyibanze mu bugenge", "Physics basics",
 "Uburemere bw'Isi butuma ibintu bigwa hasi (gravity), Isaac Newton yabisobanuye. Urumuri rugenda ku muvuduko wa kilometero zigera ku 299,792 ku isegonda. Amazi akonja agasa n'urubura kuri 0°C, kandi aratogota kuri 100°C ku nyanja.",
 "Gravity pulls objects toward Earth, as explained by Isaac Newton. Light travels at about 299,792 kilometres per second. Water freezes at 0°C and boils at 100°C at sea level.",
 "ubugenge|physics|gravity|uburemere|newton|isaac newton|urumuri|light|speed of light|umuvuduko|water freezes|amazi|0°c|100°c|boiling point|freezing point|energy|ingufu|force|atom|atome"],
["water-cycle", "science", "Uruzinduko rw'amazi", "The water cycle",
 "Uruzinduko rw'amazi ni uko amazi ava mu nyanja, ibiyaga n'imigezi akazamuka nk'umwuka (guhumuka), agakonja akaba ibicu, agasubira ku butaka nk'imvura (gutonyanga), akongera akisuka mu migezi.",
 "The water cycle describes how water evaporates from oceans, lakes and rivers, condenses into clouds, falls back as rain (precipitation) and flows back into rivers and seas.",
 "amazi|water|water cycle|uruzinduko rw'amazi|imvura|rain|ibicu|clouds|evaporation|guhumuka|condensation|precipitation|ikirere|weather"],
["photosynthesis", "science", "Fotosintezi", "Photosynthesis",
 "Fotosintezi ni uburyo ibimera bikoresha urumuri rw'izuba, amazi na karubone dioxide (CO₂) bikabyara isukari n'umwuka wa ogisijeni (oxygen). Bikorerwa mu bibabi, aho ibara ry'icyatsi (chlorophyll) riba.",
 "Photosynthesis is how plants use sunlight, water and carbon dioxide (CO₂) to make sugar and release oxygen. It takes place in the leaves, in the green pigment called chlorophyll.",
 "fotosintezi|photosynthesis|ibimera|plants|plant|chlorophyll|ibibabi|leaves|oxygen|ogisijeni|co2|carbon dioxide|izuba|sunlight|biology|ibinyabuzima"],
["human-body", "science", "Umubiri w'umuntu", "The human body",
 "Umuntu mukuru afite amagufwa 206. Umutima utera amaraso mu mubiri wose, ibihaha bifasha guhumeka, impyiko zisukura amaraso, ubwonko bukayobora umubiri. Umuntu w'umuzima agomba kunywa amazi ahagije, gusinzira no gukora imyitozo ngororamubiri.",
 "An adult human has 206 bones. The heart pumps blood around the body, the lungs help us breathe, the kidneys filter blood and the brain controls the body. Staying healthy takes enough water, sleep and regular exercise.",
 "umubiri|human body|amagufwa|bones|206|umutima|heart|ibihaha|lungs|impyiko|kidneys|ubwonko|brain|amaraso|blood|guhumeka|breathing|anatomy|organs|ingingo|skeleton|imitsi|muscles"],
["dna-cells", "science", "Utunyangingo n'ADN", "Cells and DNA",
 "Utunyangingo (cells) ni uduce duto tw'ibanze tw'ibinyabuzima. ADN (DNA) ibika amakuru y'uko ikiremwa kimeze, ikaba ifite imiterere y'agafuni gafatanye kabiri (double helix), yasobanuwe na Watson na Crick mu 1953.",
 "Cells are the basic building blocks of living things. DNA stores the instructions that define an organism and has a double-helix shape, described by Watson and Crick in 1953.",
 "dna|adn|cells|utunyangingo|genes|ingirabuzimafatizo|double helix|watson|crick|genetics|genetique|heredity|biology|ibinyabuzima|chromosome"],
["earth-facts", "science", "Amakuru ku Isi", "Facts about Earth",
 "Isi ifite imyaka hafi miliyari 4.5. Hafi 71% by'ubuso bwayo ni amazi. Izenguruka izuba mu minsi 365 (umwaka), kandi ikizenguruka mu masaha 24 (umunsi). Umwaka w'impurirane ugira iminsi 366 buri myaka ine.",
 "Earth is about 4.5 billion years old. About 71% of its surface is covered by water. It orbits the Sun in about 365 days (a year) and rotates once in about 24 hours (a day). A leap year has 366 days and comes every four years.",
 "isi|earth|imyaka y'isi|age of earth|71%|amazi|ocean|iminsi 365|umwaka|year|leap year|umwaka w'impurirane|366|day|umunsi|gutaha|rotation|orbit|geography"],
["climate-change", "science", "Imihindagurikire y'ibihe", "Climate change",
 "Imihindagurikire y'ibihe ni izamuka ry'ubushyuhe bw'isi giterwa ahanini no gutwika ibicanwa bya fosile bitanga imyuka ihumanya (nka CO₂). Ingaruka zirimo imyuzure, amapfa n'izamuka ry'inyanja. Gutera ibiti, gukoresha ingufu zisubiranya n'ubuhinzi bwiza biragabanya ingaruka.",
 "Climate change is the long-term rise in global temperatures, mainly caused by burning fossil fuels that release greenhouse gases such as CO₂. Effects include floods, droughts and rising seas. Planting trees, renewable energy and better farming help reduce the impact.",
 "imihindagurikire y'ibihe|climate change|global warming|ubushyuhe|greenhouse|imyuka|co2|fosile|fossil fuels|imyuzure|floods|amapfa|drought|renewable|ingufu zisubiranya|environment|ibidukikije|sea level"],
["maths-formulas", "math", "Amategeko y'imibare y'ibanze", "Basic maths formulas",
 "Ubuso bw'urukiramende = uburebure × ubugari. Ubuso bw'inyabutatu = ½ × umusingi × uburebure. Ubuso bw'uruziga = π × r² (π ≈ 3.14159). Ihame rya Pythagoras: a² + b² = c². Ijanisha = (igice ÷ ikiyigize) × 100.",
 "Area of a rectangle = length × width. Area of a triangle = ½ × base × height. Area of a circle = π × r² (π ≈ 3.14159). Pythagorean theorem: a² + b² = c². Percentage = (part ÷ whole) × 100.",
 "imibare|maths|math|formulas|area|ubuso|rectangle|urukiramende|triangle|inyabutatu|circle|uruziga|pi|π|pythagoras|pythagorean|percentage|ijanisha|perimeter|geometry|ijyanye n'imibare"],
["units", "math", "Ibipimo", "Units of measurement",
 "1 kilometero = metero 1,000. 1 kilogarama = garama 1,000. 1 litiro = mililitiro 1,000. 1 isaha = iminota 60. Kuva kuri Celsius ujya kuri Fahrenheit: °F = °C × 9/5 + 32.",
 "1 kilometre = 1,000 metres. 1 kilogram = 1,000 grams. 1 litre = 1,000 millilitres. 1 hour = 60 minutes. Celsius to Fahrenheit: °F = °C × 9/5 + 32.",
 "ibipimo|units|measurement|kilometero|km|metero|kilogarama|kg|litiro|celsius|fahrenheit|conversion|guhindura ibipimo|gram|mile|inch|pound|ubushyuhe|temperature"],
["primes", "math", "Imibare y'umwihariko", "Prime numbers and basics",
 "Umubare w'umwihariko (prime) ni umubare urenze 1 ugabanywa gusa na 1 n'wo ubwawo, urugero: 2, 3, 5, 7, 11, 13. 2 ni wo mubare w'umwihariko w'umwe w'ingana (even).",
 "A prime number is greater than 1 and divisible only by 1 and itself, for example 2, 3, 5, 7, 11, 13. The number 2 is the only even prime.",
 "prime|prime number|umubare w'umwihariko|imibare|even|odd|ingana|zidahwanye|divisible|factor|multiple|gukuba|kugabanya"],

/* ================= TECHNOLOGY & DIGITAL LIFE ================= */
["html-css-js", "technology", "HTML, CSS na JavaScript", "HTML, CSS and JavaScript",
 "HTML ni ururimi rwubaka imiterere y'urubuga (imitwe, paragarafu, amashusho). CSS rutunganya isura (amabara, imyandikire, imiterere). JavaScript rutuma urubuga rukora ibikorwa (nka buto, ibibazo, imikino). Byose uko ari bitatu bikorana mu kubaka urubuga.",
 "HTML defines the structure of a web page (headings, paragraphs, images). CSS controls its look (colours, fonts, layout). JavaScript makes it interactive (buttons, forms, games). The three work together to build a website.",
 "html|css|javascript|js|web development|urubuga|website|gukora urubuga|kubaka urubuga|code|coding|gutegura porogaramu|frontend|front-end|browser|developer"],
["programming", "technology", "Gutegura porogaramu", "Programming basics",
 "Porogaramu ni urutonde rw'amabwiriza mudasobwa ikurikiza. Indimi zizwi ni Python, JavaScript, Java na C++. Algorithm ni intambwe zikurikirana zo gukemura ikibazo. Database ibika amakuru kandi API ituma porogaramu zivugana.",
 "A program is a list of instructions a computer follows. Popular languages include Python, JavaScript, Java and C++. An algorithm is a step-by-step method for solving a problem. A database stores data and an API lets programs talk to each other.",
 "porogaramu|programming|program|python|java|c++|algorithm|algorithme|database|api|variable|function|loop|code|coder|developer|software|gutegura porogaramu|kwiga programming|learn to code"],
["cybersecurity", "technology", "Kurinda amakuru yawe kuri murandasi", "Staying safe online",
 "Koresha ijambobanga rirerire (nibura inyuguti 12) ritandukanye kuri buri konti. Fungura 2FA (kwemeza kabiri). Ntukande ku mahuza adasobanutse (phishing) kandi ntugire uwo uha ijambobanga cyangwa kode ya SMS. Vugurura porogaramu zawe.",
 "Use a long password (at least 12 characters) that is different for each account. Turn on two-factor authentication (2FA). Don't click suspicious links (phishing) and never share your password or SMS codes. Keep your apps updated.",
 "ijambobanga|password|passwords|2fa|two-factor|phishing|scam|uburiganya|hack|hacking|umutekano|security|cybersecurity|kurinda konti|account safety|virus|malware|privacy|ibanga"],
["fake-news", "technology", "Uko wamenya amakuru y'ikinyoma", "How to spot misinformation",
 "Reba inkomoko (urubuga cyangwa umunyamakuru uzwi), itariki, kandi urebe niba ibindi binyamakuru byizewe bibivuga. Itondere imitwe iteye ubwoba, amashusho yahinduwe n'inkuru zidafite isoko. Mbere yo gusangiza, banza ugenzure.",
 "Check the source (a known outlet or journalist), the date, and whether other reliable outlets report it too. Be wary of shocking headlines, edited images and stories with no source. Verify before you share.",
 "amakuru y'ikinyoma|ikinyoma|fake news|misinformation|disinformation|fact check|gusuzuma amakuru|verify|source|inkomoko|propaganda|hoax|rumor|ibihuha|amakuru y'impamo|credible"],
["ai-llm", "technology", "Chatbot n'ubwenge buhangano", "Chatbots and large language models",
 "Chatbot ni porogaramu ikubwira ibisubizo mu buryo bw'ikiganiro. Ibisubizo byinshi bigezweho bikoreshwa n'ibishushanyo bikuru by'indimi (LLM) byatojwe ku nyandiko nyinshi. Ibisubizo birashobora kuba bifite amakosa, bityo ugomba kubigenzura.",
 "A chatbot is a program that answers you in conversation. Many modern chatbots run on large language models (LLMs) trained on huge amounts of text. Their answers can contain mistakes, so it is wise to double-check important information.",
 "chatbot|llm|large language model|ubwenge buhangano|artificial intelligence|machine learning|ai|ikiganiro|conversation|prompt|gpt|assistant|umufasha|deep learning|neural network"],
["blockchain-crypto", "technology", "Bitcoin na blockchain", "Bitcoin and blockchain",
 "Blockchain ni urutonde rw'inyandiko z'ibyakozwe zibitswe ku mashini nyinshi, zitoroshye guhindurwa. Bitcoin ni ifaranga rya digitale ryatangijwe mu 2009 n'umuntu cyangwa itsinda ryitwa Satoshi Nakamoto. Ishoramari muri crypto rishobora gutera igihombo gikomeye, bityo ubanze wige mbere.",
 "A blockchain is a shared record of transactions stored across many computers, hard to alter. Bitcoin is a digital currency launched in 2009 by a person or group known as Satoshi Nakamoto. Crypto investing can mean big losses, so learn the risks first.",
 "bitcoin|blockchain|crypto|cryptocurrency|ifaranga rya digitale|satoshi|ethereum|ishoramari|investment|digital currency|wallet|nft"],
["email-social", "technology", "Imbuga nkoranyambaga", "Social media and email basics",
 "Imbuga nkoranyambaga nka WhatsApp, Facebook, Instagram, YouTube na X zituma abantu basangira amakuru. Imeri (email) igizwe n'izina, '@' n'urubuga (nka izina@urugero.com). Wirinde gusangiza amakuru bwite n'amafoto utifuza ko abantu bose babona.",
 "Social platforms such as WhatsApp, Facebook, Instagram, YouTube and X let people share information. An email address has a name, '@' and a domain (such as name@example.com). Be careful about sharing personal details and photos you don't want everyone to see.",
 "imbuga nkoranyambaga|social media|whatsapp|facebook|instagram|youtube|x|twitter|tiktok|email|imeri|gmail|konti|account|post|share|gusangiza|followers|inbox"],

/* ================= HEALTH (general information only) ================= */
["hiv", "health", "Virusi itera SIDA (VIH)", "HIV",
 "VIH ni virusi yibasira ubudahangarwa bw'umubiri. Ikwirakwizwa mu mibonano mpuzabitsina idakingiye, mu maraso no ku mubyeyi ujya ku mwana. Gupimwa ni ubuntu mu bigo nderabuzima, kandi imiti igabanya ubukana (ARV) ituma umuntu abaho ubuzima bwiza kandi akaba atakwanduza abandi iyo virusi yabaye nke cyane mu maraso. Genda ku kigo nderabuzima ugire inama.",
 "HIV is a virus that weakens the immune system. It spreads through unprotected sex, blood and from mother to child. Testing is available at health centres, and antiretroviral treatment (ART) lets people live long, healthy lives; when the virus is undetectable it cannot be passed on sexually. Visit a health centre for advice.",
 "vih|hiv|sida|aids|virus|virusi|arv|art|gupimwa|testing|ikigo nderabuzima|health centre|prep|condoms|agakingirizo|kwirinda sida|prevention|u=u"],
["tb", "health", "Igituntu", "Tuberculosis (TB)",
 "Igituntu ni indwara ifata ibihaha ikwirakwizwa mu mwuka. Ibimenyetso birimo gukorora ibyumweru birenze bibiri, umuriro n'ibyuya nijoro, kunanuka. Kiravurwa kigakira iyo umuntu afashe imiti yose uko yayandikiwe (hafi amezi 6). Genda ku kigo nderabuzima.",
 "Tuberculosis (TB) is an illness that mostly affects the lungs and spreads through the air. Symptoms include a cough lasting over two weeks, fever, night sweats and weight loss. It is curable when the full course of medicine (about six months) is taken. See a health centre.",
 "igituntu|tb|tuberculosis|gukorora|cough|ibihaha|lungs|umuriro|fever|ibyuya nijoro|night sweats|kunanuka|weight loss|ubuzima|health"],
["covid", "health", "COVID-19", "COVID-19",
 "COVID-19 ni indwara iterwa na virusi ya SARS-CoV-2. Umuryango w'Abibumbye ushinzwe ubuzima (WHO) wavuze ko ari icyorezo ku isi muri Werurwe 2020, utangaza ko ikibazo cyihutirwa cyarangiye muri Gicurasi 2023. Inkingo, gukaraba intoki no kwambara agapfukamunwa igihe bikenewe biraburinda.",
 "COVID-19 is caused by the SARS-CoV-2 virus. The World Health Organization declared it a pandemic in March 2020 and ended the global health emergency in May 2023. Vaccines, handwashing and masks when appropriate help protect people.",
 "covid|covid-19|coronavirus|corona|sars-cov-2|pandemic|icyorezo|guma murugo|lockdown|urukingo|vaccine|vaccination|agapfukamunwa|mask|who|2020"],
["hygiene", "health", "Isuku n'ubuzima", "Hygiene and staying healthy",
 "Karaba intoki n'isabune n'amazi amara nibura amasegonda 20, cyane mbere yo kurya no nyuma yo gukoresha ubwiherero. Nywa amazi meza (yatetswe cyangwa yatunganyijwe), urye indyo yuzuye, usinzire bihagije kandi ukore imyitozo ngororamubiri. Genda kwa muganga mu gihe urwaye.",
 "Wash your hands with soap and water for at least 20 seconds, especially before eating and after using the toilet. Drink safe water (boiled or treated), eat a balanced diet, sleep enough and exercise regularly. See a health worker when you are ill.",
 "isuku|hygiene|gukaraba intoki|handwashing|isabune|soap|amazi meza|safe water|indyo yuzuye|balanced diet|nutrition|imirire|sleep|gusinzira|exercise|siporo|ubuzima|health|wellness|healthy"],
["cholera-diarrhoea", "health", "Impiswi n'ubukonje bwo mu mara", "Diarrhoea and dehydration",
 "Impiswi ikomeye ituma umubiri ubura amazi. Nywa amazi arimo umunyu n'isukari (ORS) kandi ukomeze kurya. Jya kwa muganga vuba iyo umuntu, cyane umwana, atagishobora kunywa, afite umuriro cyangwa amaraso mu mwanda. Gukaraba intoki no kunywa amazi meza biraburinda.",
 "Severe diarrhoea can cause dangerous dehydration. Give oral rehydration solution (ORS) and keep eating. Seek care quickly if a person, especially a child, cannot drink, has a fever or has blood in their stool. Handwashing and safe water help prevent it.",
 "impiswi|diarrhoea|diarrhea|cholera|kolera|ors|dehydration|kubura amazi|amara|stomach|inda|kuruka|vomiting|typhoid|water-borne"],
["blood-pressure-diabetes", "health", "Umuvuduko w'amaraso na diyabete", "High blood pressure and diabetes",
 "Umuvuduko ukabije w'amaraso (hypertension) na diyabete (isukari nyinshi mu maraso) ni indwara zitandura zigenda ziyongera. Kuzirinda bifasha: kugabanya umunyu n'isukari, gukora imyitozo, kudakoresha itabi n'inzoga nyinshi no kwisuzumisha buri gihe. Bipimwa ku kigo nderabuzima.",
 "High blood pressure (hypertension) and diabetes (high blood sugar) are common non-communicable diseases that are on the rise. Reducing salt and sugar, exercising, avoiding tobacco and heavy drinking, and regular check-ups all help. Both can be tested at a health centre.",
 "umuvuduko w'amaraso|hypertension|blood pressure|diyabete|diabetes|isukari|sugar|umunyu|salt|ndc|non-communicable|indwara zitandura|itabi|tobacco|check-up|kwisuzumisha|gupimwa"],
["mental-wellbeing", "health", "Ubuzima bwo mu mutwe", "Mental wellbeing",
 "Kumva wihebye, ufite agahinda gakabije cyangwa guhangayika ni ibintu bishobora kubaho kandi bikavurwa. Ganira n'inshuti, umuryango cyangwa umujyanama, kandi usabe ubufasha ku kigo nderabuzima. Mu gihe ushaka ubufasha bwihuse, hamagara 114 cyangwa ujye ku kigo nderabuzima kikwegereye.",
 "Feeling very low, deeply sad or anxious can happen to anyone and is treatable. Talk with a friend, family member or counsellor, and ask for help at a health centre. If you need urgent support, call 114 or go to your nearest health centre.",
 "ubuzima bwo mu mutwe|mental health|stress|guhangayika|anxiety|agahinda|sadness|depression|kwiheba|trauma|ihungabana|counselling|umujyanama|ubufasha|help|114|wellbeing|self-care"],
["first-aid", "health", "Ubutabazi bw'ibanze", "Basic first aid",
 "Ku gikomere kivirirana: kanda ahava amaraso ukoresheje igitambaro gisukuye. Ku kwotsa: suka amazi akonje (atari urubura) iminota 10–20. Ku muntu waguye igihumure adahumeka: hamagara 912 cyangwa 112 vuba. Ubutabazi bw'ibanze ntibusimbura muganga.",
 "For a bleeding wound, press firmly on it with a clean cloth. For a burn, cool it under running (not icy) water for 10–20 minutes. For a person who is unconscious and not breathing, call 912 or 112 immediately. First aid does not replace medical care.",
 "ubutabazi bw'ibanze|first aid|igikomere|wound|bleeding|amaraso|kwotsa|burn|burns|cpr|unconscious|guhumeka|choking|gutabara|emergency|912|112|ambulance|ubutabazi"],

/* ================= MONEY & WORK ================= */
["banks-rw", "economy", "Amabanki n'inzego z'imari mu Rwanda", "Banks and finance in Rwanda",
 "Banki Nkuru y'u Rwanda (BNR) ni yo igenzura amabanki n'ifaranga. Amabanki azwi: Bank of Kigali (BK), I&M Bank, Equity Bank, Access Bank, Ecobank n'ayandi. Isoko ry'imigabane rya Kigali (RSE) ryatangiye mu 2005. Ikigo gishinzwe imisoro ni RRA kandi TVA ni 18%.",
 "The National Bank of Rwanda (BNR) regulates banks and the currency. Well-known banks include Bank of Kigali (BK), I&M Bank, Equity Bank, Access Bank and Ecobank. The Rwanda Stock Exchange (RSE) started in 2005. The tax authority is the Rwanda Revenue Authority (RRA), and VAT is 18%.",
 "banki|bank|banks|bnr|national bank of rwanda|bank of kigali|bk|i&m|equity|access bank|ecobank|rse|stock exchange|imigabane|shares|rra|imisoro|tax|taxes|tva|vat|18%|amafaranga|finance|imari"],
["budgeting", "economy", "Gutegura ingengo y'imari", "Budgeting and saving",
 "Itegeko rizwi rya 50/30/20: 50% by'amafaranga yawe ajya ku by'ibanze (icumbi, ibiryo, ingendo), 30% ku byo ushaka, 20% ku kuzigama no kwishyura imyenda. Andika amafaranga winjiza n'ayo ukoresha, ugire ikigega cy'ubutabazi, kandi wirinde imyenda y'inyungu nyinshi.",
 "A common guideline is the 50/30/20 rule: 50% of income for needs (rent, food, transport), 30% for wants and 20% for saving and paying off debt. Track your income and spending, build an emergency fund and avoid high-interest debt.",
 "ingengo y'imari|budget|budgeting|kuzigama|saving|savings|izigama|50/30/20|umwenda|debt|loan|inguzanyo|inyungu|interest|emergency fund|ikigega cy'ubutabazi|amafaranga|money management|kwizigamira|sacco"],
["business-start", "economy", "Gutangiza ubucuruzi mu Rwanda", "Starting a business in Rwanda",
 "Kwiyandikisha kw'ikigo cy'ubucuruzi bikorerwa ku rubuga rwa RDB (Irembo). Ukeneye kwerekana izina ry'ubucuruzi, ubwoko bw'ikigo (urugero: kampani, ubucuruzi bwite), kandi ukiyandikisha ku musoro (RRA). Gutegura gahunda y'ubucuruzi (business plan) bifasha kubona inguzanyo.",
 "Business registration in Rwanda is done online through RDB (via Irembo). You need a business name and legal form (for example a company or sole proprietorship), and you must register for tax with RRA. A written business plan helps when seeking a loan.",
 "ubucuruzi|business|gutangiza ubucuruzi|start a business|kwiyandikisha|registration|rdb|irembo|kampani|company|business plan|gahunda y'ubucuruzi|entrepreneur|rwiyemezamirimo|startup|inguzanyo|loan|isoko|market"],
["cv-interview", "work", "CV n'ikiganiro cy'akazi", "CV and job interview tips",
 "CV nziza ni ngufi (urupapuro 1–2), ifite amakuru y'itumanaho, uburezi, uburambe n'ubumenyi, kandi ihuye n'akazi usaba. Ku kiganiro: wiga ibyerekeye ikigo, ugere kare, wite ku myambarire, usubize ukoresheje ingero, kandi ugire ibibazo byo kubaza.",
 "A good CV is short (1–2 pages), lists contact details, education, experience and skills, and is tailored to the job. For the interview: research the company, arrive early, dress neatly, answer with real examples and prepare questions to ask.",
 "cv|resume|curriculum vitae|akazi|job|jobs|ikiganiro cy'akazi|interview|job interview|gusaba akazi|apply|application letter|ibaruwa isaba akazi|cover letter|career|umwuga|employment|kubona akazi|find a job"],
["study-tips", "education", "Uko wiga neza", "How to study effectively",
 "Kora gahunda y'ibyo uziga buri munsi, wige iminota 25 uruhuke 5 (uburyo bwa Pomodoro), wisuzume wibaza ibibazo aho kongera gusoma gusa, ubone ibitotsi bihagije kandi wirinde ibikurangaza nka telefoni. Subiramo mu gihe kigenda cyiyongera.",
 "Plan what to study each day, study for 25 minutes then rest for 5 (the Pomodoro technique), test yourself with questions instead of only re-reading, get enough sleep and avoid distractions like your phone. Review material at spaced intervals.",
 "kwiga|study|studying|study tips|uko wiga neza|pomodoro|exam|ikizamini|ibizamini|revision|gusubiramo|memory|kwibuka|time management|gukoresha igihe|focus|kwita ku masomo|learn|students|abanyeshuri"]
];

/* merge into the core knowledge (skip ids that already exist) */
const mifasaKnownIds = new Set(MIFASA_CORE_KNOWLEDGE.map(k => k.id));
MIFASA_MORE_KNOWLEDGE.forEach(r => {
  if (!Array.isArray(r) || r.length < 7 || mifasaKnownIds.has(r[0])) return;
  mifasaKnownIds.add(r[0]);
  MIFASA_CORE_KNOWLEDGE.push({ id: r[0], cat: r[1], t_rw: r[2], t_en: r[3], s_rw: r[4], s_en: r[5], kw: r[6].split("|").map(s => s.trim()).filter(Boolean) });
});
/* 9d-3. MORE BUILT-IN KNOWLEDGE: music history, genres, riddles, proverbs, novels, tenses and verbs (Kinyarwanda + English)
   Same format and rules as part 175. Row = [id, category, title_rw, title_en, text_rw, text_en, "keyword|keyword|..."]
   NOTE: riddles and proverbs are cultural content. Ask elders / a Kinyarwanda teacher to confirm wording before publishing, and add more rows at the end. */

const MIFASA_MORE_KNOWLEDGE_2 = [

/* ================= MUSIC: ancient and classical history ================= */
["music-origins", "music", "Inkomoko y'umuziki", "Origins of music",
 "Umuziki ni umwe mu bintu bya kera cyane mu mateka y'abantu. Imyironge ya kera ikozwe mu magufwa, yabonywe i Hohle Fels mu Budage, ifite imyaka hafi 40,000, ni zimwe mu bikoresho by'umuziki bya kera bizwi. Abantu bakoreshaga kandi ijwi, gukomeza amashyi n'ingoma mu mihango, mu kazi no mu bitaramo.",
 "Music is one of the oldest human activities. Bone flutes found at Hohle Fels in Germany, about 40,000 years old, are among the oldest known musical instruments. People also used voice, clapping and drums in ceremonies, work and gatherings.",
 "umuziki|music|inkomoko y'umuziki|origin of music|history of music|amateka y'umuziki|ancient music|umuziki wa kera|bone flute|flute|umuyonga|imyironge|hohle fels|prehistoric|oldest instrument|ibikoresho by'umuziki|instruments"],
["music-ancient-civilizations", "music", "Umuziki w'ubwami bwa kera", "Music in ancient civilizations",
 "Muri Sumeri (Iraki y'ubu), inanga y'i Uri ya hafi 2500 mbere ya Yesu ni imwe mu bikoresho bya kera. 'Hurrian Hymn No. 6' yo mu 1400 mbere ya Yesu ni yo ndirimbo ya kera yanditswe mu nyandiko z'umuziki yabonetse. Misiri ya kera yakoreshaga inanga, imyironge na sistrum. Ubugereki bwa kera bwize ibipimo by'amajwi (Pythagoras), kandi 'Seikilos epitaph' ni yo ndirimbo yuzuye ya kera yabonetse.",
 "In Sumer (modern Iraq), the Lyre of Ur from about 2500 BCE is one of the oldest instruments. The Hurrian Hymn No. 6 from about 1400 BCE is the oldest surviving notated melody. Ancient Egypt used harps, flutes and the sistrum. Ancient Greece studied sound ratios (Pythagoras), and the Seikilos epitaph is the oldest complete surviving song with notation.",
 "sumeri|sumer|lyre of ur|inanga y'uri|hurrian hymn|seikilos|ancient egypt|misiri ya kera|sistrum|harp|ancient greece|ubugereki|pythagoras|oldest song|ndirimbo ya kera|ancient civilizations|mesopotamia"],
["music-notation", "music", "Inyandiko z'umuziki", "Musical notation",
 "Inyandiko z'umuziki zakozwe kugira ngo indirimbo zibikwe. Mu kinyejana cya 11, umumonaki Guido d'Arezzo yavumbuye uburyo bw'imirongo (staff) n'amazina y'inoti (ut-re-mi-fa-sol-la), ari yo ntangiriro ya do-re-mi-fa-sol-la-si. Inoti ndwi z'ingenzi ni do, re, mi, fa, sol, la na si.",
 "Musical notation lets songs be written down and preserved. In the 11th century the monk Guido of Arezzo developed the staff and note names (ut-re-mi-fa-sol-la), the basis of do-re-mi-fa-sol-la-ti. The seven main notes are do, re, mi, fa, sol, la and ti.",
 "inoti|notes|do re mi|solfege|guido|guido d'arezzo|notation|inyandiko z'umuziki|staff|sheet music|scale|umurongo|amajwi|pitch|tempo|rhythm|injyana|melody|harmony|chords"],
["music-medieval", "music", "Umuziki wo mu bihe bya kera by'u Burayi", "Medieval and early European music",
 "Mu Burayi bwo hambere, indirimbo za gisiriguru z'itorero zizwi nka 'Gregorian chant' zakwirakwiriye guhera mu kinyejana cya 9. Nyuma haje indirimbo z'abatoni (troubadours) n'umuziki w'amajwi menshi (polyphony). Opera yatangiriye mu Butaliyani nko mu 1600, ikomeza na Monteverdi mu 1607 ('L'Orfeo').",
 "In early Europe, church plainchant known as Gregorian chant spread from around the 9th century. Later came the songs of troubadours and polyphonic (multi-voice) music. Opera began in Italy around 1600, with Monteverdi's 'L'Orfeo' in 1607.",
 "gregorian chant|medieval music|renaissance|troubadours|polyphony|opera|monteverdi|itorero|church music|plainchant|early music|muziki wa kera"],
["music-classical-eras", "music", "Ibihe by'umuziki wa kera w'Iburayi", "Classical music periods",
 "Baroque (1600–1750): Bach, Handel, Vivaldi. Classical (1750–1820): Haydn, Mozart (1756–1791), Beethoven (1770–1827). Romantic (1820–1900): Chopin, Schubert, Tchaikovsky. Mu kinyejana cya 20 haje ubwoko bushya nka impressionism (Debussy) n'umuziki wa none. Symphony ya Cyenda ya Beethoven yatangiye gucurangwa mu 1824.",
 "Baroque (1600–1750): Bach, Handel, Vivaldi. Classical (1750–1820): Haydn, Mozart (1756–1791), Beethoven (1770–1827). Romantic (1820–1900): Chopin, Schubert, Tchaikovsky. The 20th century brought impressionism (Debussy) and modern styles. Beethoven's Ninth Symphony premiered in 1824.",
 "baroque|classical|romantic|bach|handel|vivaldi|haydn|mozart|beethoven|chopin|schubert|tchaikovsky|debussy|symphony|orchestra|orchestre|classical music|umuziki w'abazungu|composer|abahimbyi b'umuziki|1824|ninth symphony"],
["music-recording", "music", "Gufata amajwi n'itangazamakuru ry'umuziki", "Recorded music and broadcasting",
 "Thomas Edison yahimbye phonograph mu 1877, naho Emile Berliner ahimba gramophone mu 1887. Radio yatangiye gukwirakwiza umuziki mu myaka ya 1920. Kaseti, CD (1982), MP3 n'iby'iki gihe nka Spotify na YouTube byahinduye uko abantu bumva umuziki.",
 "Thomas Edison invented the phonograph in 1877 and Emile Berliner the gramophone in 1887. Radio spread music widely in the 1920s. Cassettes, CDs (1982), MP3s and today's streaming services such as Spotify and YouTube changed how people listen.",
 "phonograph|edison|gramophone|berliner|vinyl|radio|cassette|kaseti|cd|mp3|spotify|youtube|streaming|recording|gufata amajwi|studio|album|single"],

/* ================= MUSIC: genre origins (world) ================= */
["genres-overview", "music", "Ubwoko bw'umuziki (genres)", "Music genres: overview",
 "Ubwoko bw'umuziki (genre) bukomoka ku buryo n'aho umuziki wakorewe. Ubuzwi cyane: blues, jazz, rock, pop, hip hop, reggae, gospel, country, salsa, samba, afrobeat, rumba, K-pop na muziki wa elegitoroniki. Buri bwoko bufite inkomoko n'amateka yabwo, nsobanura mu bindi bisubizo.",
 "A music genre is a style defined by sound, culture and where it developed. Popular ones include blues, jazz, rock, pop, hip hop, reggae, gospel, country, salsa, samba, afrobeat, rumba, K-pop and electronic music. Each has its own origin story.",
 "genre|genres|ubwoko bw'umuziki|ubwoko|styles|music genres|ganger|ibyiciro by'umuziki|umuziki wa|types of music|which genre|inkomoko y'ubwoko bw'umuziki"],
["genre-blues-jazz", "music", "Blues na Jazz", "Origins of blues and jazz",
 "Blues yatangiye mu mpera z'ikinyejana cya 19 mu majyepfo ya Amerika (cyane Mississippi Delta), ikomoka ku ndirimbo z'Abanyafurika b'Abanyamerika. W. C. Handy yitwa 'Se wa Blues'. Jazz yavukiye i New Orleans mu ntangiriro z'ikinyejana cya 20, ivanze blues, ragtime n'injyana z'Abanyafurika. Louis Armstrong ni umwe mu bayigize ikomeye.",
 "Blues began in the late 19th century in the American South (especially the Mississippi Delta), rooted in African American songs. W. C. Handy is called the 'Father of the Blues'. Jazz was born in New Orleans in the early 20th century, mixing blues, ragtime and African rhythms. Louis Armstrong was one of its biggest stars.",
 "blues|jazz|new orleans|mississippi delta|handy|louis armstrong|b.b. king|ragtime|swing|improvisation|african american|abanyamerika b'abirabura|umuziki w'abirabura|bebop|duke ellington"],
["genre-rock", "music", "Rock and roll na Rock", "Origins of rock and roll",
 "Rock and roll yavutse mu myaka ya 1950 muri Amerika, ivanze blues, country na gospel. Elvis Presley, Chuck Berry na Little Richard bayigize ikomeye. Mu myaka ya 1960, The Beatles bo mu Bwongereza (Liverpool) bakwirakwije rock ku isi yose. Heavy metal yatangiye mu mpera za 1960 na Black Sabbath, naho punk mu myaka ya 1970.",
 "Rock and roll emerged in the 1950s in the USA, mixing blues, country and gospel. Elvis Presley, Chuck Berry and Little Richard were key figures. In the 1960s the Beatles from Liverpool, England, spread rock worldwide. Heavy metal grew from late-1960s bands such as Black Sabbath, and punk arose in the 1970s.",
 "rock|rock and roll|elvis|elvis presley|chuck berry|little richard|beatles|liverpool|rolling stones|heavy metal|black sabbath|punk|guitar|gitari|band|itsinda|led zeppelin|nirvana"],
["genre-hiphop", "music", "Hip hop n'inkomoko yawo", "Origins of hip hop",
 "Hip hop yavukiye mu Bronx, New York, mu myaka ya 1970. Itariki ikunze kuvugwa ni 11 Kanama 1973, ubwo DJ Kool Herc yakoraga ibirori. Ifite inkingi enye: DJing, MCing (rap), breakdancing na graffiti. Indirimbo 'Rapper's Delight' (1979) yamenyekanye cyane nka rap ya mbere yageze ku isoko rinini.",
 "Hip hop was born in the Bronx, New York, in the 1970s. The date often cited is 11 August 1973, when DJ Kool Herc threw a party. It has four main elements: DJing, MCing (rapping), breakdancing and graffiti. 'Rapper's Delight' (1979) was among the first rap records to reach a wide audience.",
 "hip hop|hiphop|rap|rapper|bronx|new york|dj kool herc|kool herc|1973|breakdance|graffiti|dj|mc|rapper's delight|sugarhill gang|beatbox|beat|freestyle|umuraperi"],
["genre-gangsta-rap", "music", "Gangsta rap (ganger)", "Origins of gangsta rap",
 "Gangsta rap ni ubwoko bwa rap bwatangiye mu mpera za 1980 muri Los Angeles, Amerika, buvuga ku buzima bwo mu mihanda. Abayitangije ni Schoolly D na Ice-T (1986), hanyuma N.W.A yamenyekanishije 'Straight Outta Compton' mu 1988. Amagambo yayo akunze kuba arimo ibyiyumvo bikomeye, bityo ntibikwiriye abana.",
 "Gangsta rap is a rap style that emerged in the late 1980s in Los Angeles, describing street life. Early pioneers were Schoolly D and Ice-T (1986), and N.W.A made it famous with 'Straight Outta Compton' in 1988. Its lyrics often contain strong themes, so it is not suited to young listeners.",
 "gangsta rap|gangster rap|ganger|gangsta|n.w.a|nwa|ice-t|schoolly d|compton|los angeles|straight outta compton|dr. dre|tupac|2pac|notorious b.i.g.|west coast|east coast|drill|trap"],
["genre-reggae", "music", "Reggae na Jamaica", "Origins of reggae",
 "Reggae yavukiye muri Jamaica mu mpera za 1960, ikomoka kuri ska (1950) na rocksteady. Bob Marley (1945–1981) n'itsinda rye The Wailers bayimenyekanishije ku isi, indirimbo zivuga ubutabera, amahoro n'ubwigenge. Igitekerezo cya Rastafari cyagize uruhare rukomeye muri yo.",
 "Reggae originated in Jamaica in the late 1960s, growing out of ska (1950s) and rocksteady. Bob Marley (1945–1981) and The Wailers made it known worldwide with songs about justice, peace and freedom. The Rastafari movement strongly shaped it.",
 "reggae|jamaica|bob marley|marley|wailers|ska|rocksteady|rastafari|dancehall|peter tosh|kingston|one love|exodus|dub|lucky dube"],
["genre-disco-funk-electronic", "music", "Disco, Funk, House na Techno", "Origins of disco, funk, house and techno",
 "Funk yazanywe na James Brown mu myaka ya 1960. Disco yakunzwe mu myaka ya 1970 (filime 'Saturday Night Fever', 1977). House yavutse i Chicago mu ntangiriro za 1980 (Frankie Knuckles), naho techno ivuka i Detroit mu mpera za 1980. Bifite umuvuduko w'ingoma n'ibikoresho bya elegitoroniki.",
 "Funk was shaped by James Brown in the 1960s. Disco became hugely popular in the 1970s (the film 'Saturday Night Fever', 1977). House music began in Chicago in the early 1980s (Frankie Knuckles) and techno emerged in Detroit in the late 1980s. They rely on drum machines and electronic instruments.",
 "funk|james brown|disco|saturday night fever|house|house music|techno|edm|electronic|detroit|chicago|frankie knuckles|dj|synthesizer|drum machine|club|umuziki wa elegitoroniki|electronic music|bee gees|donna summer"],
["genre-country-gospel-pop", "music", "Country, Gospel na Pop", "Origins of country, gospel and pop",
 "Country yakomotse mu majyepfo ya Amerika mu myaka ya 1920; Grand Ole Opry yatangiye mu 1925 i Nashville. Gospel ikomoka ku ndirimbo z'amatorero y'Abanyafurika b'Abanyamerika. Pop (popular music) ni umuziki ukundwa na benshi, ugahora uhinduka; Michael Jackson (1958–2009) n'alubumu ye 'Thriller' (1982) bari ku isonga.",
 "Country music grew in the American South in the 1920s; the Grand Ole Opry began in 1925 in Nashville. Gospel comes from African American church singing. Pop (popular music) is music aimed at a wide audience and always changing; Michael Jackson (1958–2009) and his album 'Thriller' (1982) were landmark examples.",
 "country|nashville|grand ole opry|gospel|gospel music|indirimbo z'agakiza|worship|pop|pop music|michael jackson|thriller|madonna|beyonce|king of pop|church|itorero|indirimbo zo guhimbaza"],
["genre-latin", "music", "Umuziki wa Amerika y'Epfo n'u Bwongereza bwa Karayibe", "Latin music: samba, tango, salsa, reggaeton",
 "Tango yavukiye muri Buenos Aires na Montevideo mu myaka ya 1880. Samba yavukiye muri Brazil (Rio), indirimbo 'Pelo Telefone' (1916–17) ifatwa nk'iya mbere yanditswe; bossa nova yaje mu mpera za 1950 (João Gilberto). Salsa yakomotse ku njyana za Cuba na Puerto Rico, ikamenyekana i New York mu myaka ya 1960–70. Reggaeton yaje muri Puerto Rico na Panama mu myaka ya 1990.",
 "Tango was born in Buenos Aires and Montevideo in the 1880s. Samba developed in Rio, Brazil, with 'Pelo Telefone' (1916–17) often cited as the first recorded samba; bossa nova arrived in the late 1950s (João Gilberto). Salsa grew from Cuban and Puerto Rican rhythms and was popularised in New York in the 1960s and 70s. Reggaeton emerged in Puerto Rico and Panama in the 1990s.",
 "tango|samba|bossa nova|salsa|reggaeton|latin|latin music|cuba|puerto rico|brazil|argentina|flamenco|spain|merengue|bachata|joao gilberto|celia cruz|daddy yankee|despacito|umuziki wa latin"],
["genre-kpop", "music", "Amateka ya K-pop", "History and origins of K-pop",
 "K-pop ni umuziki wa pop wo muri Koreya y'Epfo, kandi itsinda Seo Taiji and Boys ryatangiye mu 1992 rifatwa nk'iritangije igihe gishya. Amasosiyete nka SM, YG na JYP yateguye amatsinda. BTS (yatangiye mu 2013) ni rimwe mu matsinda yamenyekanye cyane ku isi.",
 "K-pop is pop music from South Korea, and Seo Taiji and Boys, who debuted in 1992, are often seen as starting its modern era. Companies such as SM, YG and JYP trained and launched groups. BTS (debuted 2013) became one of the world's best-known groups.",
 "k-pop|k pop|amateka ya k-pop|inkomoko ya k-pop|k-pop history|origin of k-pop|kpop|korea|koreya|south korea|bts|blackpink|seo taiji|sm entertainment|yg|jyp|idol|idols|korean wave|hallyu|exo|twice"],

/* ================= MUSIC: Africa ================= */
["music-africa-overview", "music", "Umuziki wa Afurika", "African music overview",
 "Umuziki wa Afurika ukungahaye cyane, wubakiye ku njyana z'ingoma, kuririmbana (call and response) n'imbyino. Wagize uruhare rukomeye mu gushinga blues, jazz, rumba, salsa n'ibindi bikunzwe ku isi. Ubwoko bukomeye muri iki gihe: rumba, highlife, afrobeat, afrobeats, amapiano, bongo flava, benga, taarab n'ibindi.",
 "African music is very rich, built on drum rhythms, call-and-response singing and dance. It strongly influenced blues, jazz, rumba, salsa and many other global styles. Major styles today include rumba, highlife, afrobeat, afrobeats, amapiano, bongo flava, benga and taarab.",
 "umuziki wa afurika|african music|afrobeat|highlife|rumba|amapiano|bongo flava|benga|taarab|kwaito|soukous|african rhythm|call and response|drums|ingoma|mbira|kora|djembe|talking drum"],
["genre-rumba-soukous", "music", "Rumba ya Kongo na Soukous", "Congolese rumba and soukous",
 "Rumba ya Kongo yavutse mu myaka ya 1940–50 mu mijyi ya Kinshasa na Brazzaville, ikomoka ku njyana za Kongo zihuye n'iza Cuba. Franco Luambo, Grand Kallé na Tabu Ley Rochereau ni ibyamamare. Soukous ni uburyo bwayo bwihuta bw'amagitari. UNESCO yashyize rumba ya Kongo ku rutonde rw'umurage ndangamuco udashobora gukorwaho mu 2021. Papa Wemba yamenyekanye cyane.",
 "Congolese rumba emerged in the 1940s–50s in Kinshasa and Brazzaville, mixing Congolese rhythms with Cuban influences. Franco Luambo, Grand Kallé and Tabu Ley Rochereau are legends. Soukous is its faster, guitar-driven offshoot. UNESCO added Congolese rumba to its intangible cultural heritage list in 2021. Papa Wemba also became very famous.",
 "rumba|congolese rumba|rumba ya kongo|soukous|kinshasa|brazzaville|franco|franco luambo|tabu ley|grand kalle|papa wemba|unesco|kongo|congo|drc|fally ipupa|koffi olomide|lingala"],
["genre-west-africa", "music", "Highlife, Afrobeat, Afrobeats na Amapiano", "Highlife, Afrobeat, Afrobeats and Amapiano",
 "Highlife yavukiye muri Gana na Nijeriya mu ntangiriro y'ikinyejana cya 20. Afrobeat (idafite 's') yahimbwe na Fela Kuti (1938–1997) na Tony Allen mu mpera za 1960 no mu myaka ya 1970 muri Nijeriya. Afrobeats (ifite 's') ni ijambo ry'umuziki wa pop wa none wo muri Nijeriya na Gana (Burna Boy, Wizkid, Davido). Amapiano yavutse muri Afurika y'Epfo mu myaka ya 2010, ivanze house n'injyana z'aho.",
 "Highlife developed in Ghana and Nigeria in the early 20th century. Afrobeat (no 's') was created by Fela Kuti (1938–1997) and Tony Allen in Nigeria in the late 1960s and 70s. Afrobeats (with an 's') is the modern pop umbrella from Nigeria and Ghana (Burna Boy, Wizkid, Davido). Amapiano emerged in South Africa in the 2010s, blending house with local sounds.",
 "highlife|afrobeat|afrobeats|fela kuti|fela|tony allen|burna boy|wizkid|davido|tiwa savage|amapiano|south africa|house|nigeria|ghana|nijeriya|gana|afropop|angelique kidjo|youssou n'dour|salif keita|miriam makeba|mama africa|kwaito"],
["genre-east-africa", "music", "Umuziki wa Afurika y'Iburasirazuba", "East African music",
 "Taarab yo muri Zanzibar yatangiye mu mpera z'ikinyejana cya 19, ikoranye injyana z'Abarabu, Ubuhinde n'Abanyafurika. Benga yo muri Kenya yamamaye mu myaka ya 1950–60. Bongo Flava yo muri Tanzaniya yatangiye mu myaka ya 1990 ivanze hip hop na R&B n'Igiswahili. Abahanzi bazwi: Diamond Platnumz, Sauti Sol, Eddy Kenzo.",
 "Zanzibar's taarab began in the late 19th century, blending Arab, Indian and African influences. Kenya's benga rose to fame in the 1950s–60s. Tanzania's Bongo Flava began in the 1990s, mixing hip hop and R&B with Swahili. Well-known artists include Diamond Platnumz, Sauti Sol and Eddy Kenzo.",
 "taarab|zanzibar|benga|kenya|bongo flava|tanzania|diamond platnumz|sauti sol|eddy kenzo|uganda|swahili music|east african music|umuziki wa afurika y'iburasirazuba|kapuka|gengetone|afrigo"],
["music-rwanda-traditional", "music", "Umuziki gakondo w'u Rwanda", "Traditional Rwandan music",
 "Umuziki gakondo w'u Rwanda (karahanyuze) ukoresha ibikoresho nka inanga (ikoranwa n'indirimbo z'amateka), ingoma, umuduri, iningiri n'amakondera. Intore ni imbyino y'ubutwari ikorwa n'abagabo n'abagore. Umuganura washyizwe n'UNESCO ku rutonde rw'umurage ndangamuco udashobora gukorwaho mu 2020.",
 "Traditional Rwandan music (karahanyuze) uses instruments such as the inanga (a zither accompanying historical songs), drums (ingoma), the umuduri musical bow, the iningiri one-string fiddle and horns (amakondera). Intore is a heroic dance performed by men and women. Umuganura was inscribed by UNESCO on its intangible heritage list in 2020.",
 "karahanyuze|umuziki gakondo|traditional rwandan music|inanga|ingoma|umuduri|iningiri|amakondera|intore|imbyino|umushagiriro|ikinimba|ubusizi|ibyivugo|unesco|rwandan instruments|ibikoresho by'umuziki by'u rwanda|ingoma z'abami"],
["music-rwanda-artists", "music", "Abahanzi b'Abanyarwanda", "Rwandan musicians",
 "Mu bahanzi bazwi mu Rwanda harimo: Cécile Kayirebwa, Masamba Intore, Mariya Yohana (umuhanzi ukomeye wa gakondo), The Ben, Meddy, Bruce Melodie, Knowless Butera na Riderman. Injyana zikoreshwa ni gakondo, gospel, afrobeat, R&B na hip hop mu Kinyarwanda. Uru ni urutonde rugufi, atari rwose.",
 "Well-known Rwandan musicians include Cécile Kayirebwa, Masamba Intore, Mariya Yohana (a major traditional singer), The Ben, Meddy, Bruce Melodie, Knowless Butera and Riderman. Styles include traditional, gospel, afrobeat, R&B and Kinyarwanda hip hop. This is a short list, not a complete one.",
 "abahanzi|abahanzi b'abanyarwanda|rwandan musicians|rwandan artists|cecile kayirebwa|kayirebwa|masamba intore|mariya yohana|the ben|meddy|bruce melodie|knowless|knowless butera|riderman|umuhanzi|singer|umuririmbyi|indirimbo|songs|music rwanda"],
["music-famous-legends", "music", "Ibyamamare by'umuziki ku isi", "Music legends from around the world",
 "Johann Sebastian Bach (1685–1750), Wolfgang Amadeus Mozart (1756–1791) na Ludwig van Beethoven (1770–1827) ni ibyamamare by'umuziki wa kera. Bob Marley (1945–1981), Fela Kuti (1938–1997), Miriam Makeba (1932–2008) na Michael Jackson (1958–2009) ni ibyamamare by'umuziki wa none ku isi.",
 "Johann Sebastian Bach (1685–1750), Wolfgang Amadeus Mozart (1756–1791) and Ludwig van Beethoven (1770–1827) are giants of classical music. Bob Marley (1945–1981), Fela Kuti (1938–1997), Miriam Makeba (1932–2008) and Michael Jackson (1958–2009) are global modern legends.",
 "legends|ibyamamare|famous musicians|abahanzi bakomeye|greatest musicians|bach|mozart|beethoven|bob marley|fela kuti|miriam makeba|michael jackson|whitney houston|aretha franklin|prince|beatles|louis armstrong|who is the greatest"],

/* ================= IBISAKUZO (RIDDLES), IMIGANI (PROVERBS), NOVELS ================= */
["riddle-format", "culture", "Ibisakuzo mu muco nyarwanda", "Riddles (ibisakuzo) in Rwandan culture",
 "Ibisakuzo ni imikino y'amagambo y'abana n'abakuru. Bitangwa n'uvuga ati 'Sakwe sakwe!' undi agasubiza ati 'Soma!', hanyuma ugisakuza agatanga igisakuzo undi agashaka igisubizo. Bifasha gukarisha ubwenge no kwiga ururimi.",
 "Riddles (ibisakuzo) are word games for children and adults. A riddler calls 'Sakwe sakwe!', the other answers 'Soma!', and then the riddle is told and the listener tries to guess the answer. They sharpen the mind and teach the language.",
 "ibisakuzo|igisakuzo|riddle|riddles|sakwe sakwe|soma|imikino|games|puzzle|brain teaser|ikibazo|gusakuza|ubwenge|guess|umukino w'amagambo|bedtime"],
["riddle-umuneke", "culture", "Igisakuzo: Sogokuru aryoha aboze", "Riddle: Grandfather tastes sweetest when he is rotten",
 "Igisubizo cy'igisakuzo 'Sogokuru aryoha aboze' ni umuneke (igitoki cyeze cyane, cyanyoye). Igitoki cyeze neza kirushaho kuryoha.",
 "The answer to the riddle 'Grandfather tastes sweetest when he is rotten' is umuneke (a very ripe banana). A banana becomes sweeter as it ripens.",
 "sogokuru aryoha aboze|sogokuru|aboze|umuneke|igitoki|banana|ripe banana|igisakuzo cya sogokuru|riddle banana|sogokuru aryoha"],
["riddles-kinyarwanda", "culture", "Ibindi bisakuzo by'Ikinyarwanda", "More Kinyarwanda riddles",
 "1) Inzu idafite urugi n'idirishya, irimo umuhondo n'umweru? Igisubizo: Igi. 2) Ngendana nawe hose ntunsige, ariko sinkwiye kukubona nijoro? Igisubizo: Igicucu. 3) Ngira amaboko ntakora, ngira isura ntakubwira? Igisubizo: Isaha. 4) Ndisuka sinzapfa ngo mbure? Igisubizo: Imvura (iyo iguye isubira mu bicu). Bimwe muri ibi nabihimbye mu buryo bw'ibisakuzo; ugenzure n'abakuru.",
 "1) A house with no door or window, with yellow and white inside? Answer: an egg (igi). 2) I go with you everywhere but you cannot see me at night? Answer: a shadow (igicucu). 3) I have hands that do no work and a face that tells nothing? Answer: a clock (isaha). 4) I fall without dying, and return? Answer: rain (imvura). Some of these were composed in the riddle style, so please check them with elders.",
 "ibisakuzo|igisakuzo|riddle|riddles|igi|egg|igicucu|shadow|isaha|clock|imvura|rain|kinyarwanda riddles|ibisakuzo by'ikinyarwanda|ibindi bisakuzo|more riddles|puzzle"],
["riddles-english", "culture", "Ibisakuzo mu Cyongereza", "English riddles",
 "1) What has keys but cannot open locks? Igisubizo: Piano. 2) What gets wetter the more it dries? Igisubizo: Igitambaro (towel). 3) The more you take, the more you leave behind. What am I? Igisubizo: Intambwe (footsteps). 4) I speak without a mouth and hear without ears. What am I? Igisubizo: Echo (ijwi risubiramo).",
 "1) What has keys but cannot open locks? A piano. 2) What gets wetter the more it dries? A towel. 3) The more you take, the more you leave behind. What am I? Footsteps. 4) I speak without a mouth and hear without ears. What am I? An echo.",
 "english riddles|riddles in english|what has keys|piano|towel|footsteps|echo|brain teaser|puzzle|riddle me this|joke|ibisakuzo by'icyongereza|riddle and answer"],
["proverbs-intro", "culture", "Imigani y'Ikinyarwanda", "Kinyarwanda proverbs",
 "Imigani ni amagambo make y'ubwenge atanga inyigisho. Mu muco nyarwanda, imigani ikoreshwa mu gutanga inama no kwigisha abana. Dore iy'ingenzi nzi neza: 'Ijoro ribara uwariraye' (ugikora ikintu ni we ukimenya); 'Utazi ubwenge ashima ubwe' (utazi ibyo abandi bazi yishimira ibye); 'Amagara aruta amagana' (ubuzima buruta ubutunzi); 'Ushaka inka aryama nka zo' (ushaka ikintu ahagira ibyo yigomwa). Ugenzure n'abakuru ibisobanuro byuzuye.",
 "Proverbs (imigani) are short wise sayings that teach lessons, used in Rwandan culture to advise and teach children. Some well-known ones: 'Ijoro ribara uwariraye' (only the one who stayed up knows how long the night was, i.e. you only know a hardship by living it); 'Utazi ubwenge ashima ubwe' (the one who does not know wisdom praises his own); 'Amagara aruta amagana' (life is worth more than wealth); 'Ushaka inka aryama nka zo' (whoever wants cows must live as they do, i.e. effort and sacrifice come with the goal). Please confirm full meanings with elders.",
 "imigani|umugani|proverb|proverbs|kinyarwanda proverbs|imigani y'ikinyarwanda|ijoro ribara uwariraye|utazi ubwenge ashima ubwe|amagara aruta amagana|ushaka inka aryama nka zo|wisdom|ubwenge|inyigisho|sayings|inama|imvugo|ijambo ry'ubwenge"],
["proverbs-world", "culture", "Imigani yo ku isi", "Famous proverbs from around the world",
 "Imigani yo mu bindi bihugu: 'Urugendo rw'ibirometero ibihumbi rutangirana n'intambwe imwe' (Lao Tzu, Ubushinwa). 'Niba ushaka kugenda vuba genda wenyine; niba ushaka kugera kure, mugende muri benshi' (bikunze kuvugwa ko ari umugani wo muri Afurika). 'Kurera umwana bisaba umudugudu wose' (umugani wo muri Afurika). 'Ibikorwa biruta amagambo' (Icyongereza).",
 "A journey of a thousand miles begins with a single step (Lao Tzu, China). If you want to go fast, go alone; if you want to go far, go together (widely quoted as an African proverb). It takes a village to raise a child (African proverb). A stitch in time saves nine (English). Actions speak louder than words (English).",
 "proverbs|world proverbs|african proverb|chinese proverb|journey of a thousand miles|lao tzu|go far go together|village to raise a child|stitch in time|actions speak louder|quotes|inshamarenga|ijambo|wisdom sayings|imigani yo ku isi"],
["novels-world", "literature", "Ibitabo by'ibitekerezo bizwi ku isi", "Famous novels of the world",
 "'Don Quixote' (Cervantes, 1605) ikunze kwitwa roman ya mbere ya none. 'Pride and Prejudice' (Jane Austen, 1813). 'Les Misérables' (Victor Hugo, 1862). 'War and Peace' (Leo Tolstoy, 1869). '1984' (George Orwell, 1949). 'To Kill a Mockingbird' (Harper Lee, 1960). 'The Alchemist' (Paulo Coelho, 1988). 'Roman' ni inkuru ndende y'ibitekerezo.",
 "'Don Quixote' (Cervantes, 1605) is often called the first modern novel. 'Pride and Prejudice' (Jane Austen, 1813). 'Les Misérables' (Victor Hugo, 1862). 'War and Peace' (Leo Tolstoy, 1869). '1984' (George Orwell, 1949). 'To Kill a Mockingbird' (Harper Lee, 1960). 'The Alchemist' (Paulo Coelho, 1988). A novel is a long work of fiction.",
 "novel|novels|roman|ibitabo|igitabo|famous novels|don quixote|cervantes|pride and prejudice|jane austen|les miserables|victor hugo|war and peace|tolstoy|1984|orwell|to kill a mockingbird|the alchemist|coelho|literature|ubuvanganzo|fiction|inkuru mpimbano|author|umwanditsi"],
["novels-africa", "literature", "Ibitabo bizwi bya Afurika", "Famous African novels and writers",
 "'Things Fall Apart' (Chinua Achebe, Nijeriya, 1958) ni cyo gitabo cy'Abanyafurika gisomwa cyane. Ngũgĩ wa Thiong'o (Kenya) yanditse 'Weep Not, Child' (1964) na 'A Grain of Wheat' (1967). Chimamanda Ngozi Adichie yanditse 'Half of a Yellow Sun' (2006). Wole Soyinka (Nijeriya) yahawe Nobel y'ubuvanganzo mu 1986.",
 "'Things Fall Apart' (Chinua Achebe, Nigeria, 1958) is among the most widely read African novels. Ngũgĩ wa Thiong'o (Kenya) wrote 'Weep Not, Child' (1964) and 'A Grain of Wheat' (1967). Chimamanda Ngozi Adichie wrote 'Half of a Yellow Sun' (2006). Wole Soyinka of Nigeria won the Nobel Prize in Literature in 1986.",
 "things fall apart|chinua achebe|achebe|ngugi wa thiong'o|ngugi|weep not child|a grain of wheat|chimamanda|adichie|half of a yellow sun|wole soyinka|soyinka|nobel|african literature|ubuvanganzo bwa afurika|african novels|african writers|abanditsi b'abanyafurika"],
["literature-rwanda", "literature", "Ubuvanganzo bw'u Rwanda", "Rwandan literature",
 "Alexis Kagame (1912–1981) yari padiri, umushakashatsi n'umusizi; yanditse 'Inganji Karinga', ivuga amateka y'u Rwanda mu mivugo. Scholastique Mukasonga yanditse 'Notre-Dame du Nil' (2012), yatsindiye igihembo cya Renaudot, na 'Inyenzi ou les cafards'. Ubuvanganzo bwo mu kanwa (imigani, ibisakuzo, ibyivugo, amazina y'inka) ni bwo bwa kera.",
 "Alexis Kagame (1912–1981) was a priest, scholar and poet who wrote 'Inganji Karinga', a poetic account of Rwandan history. Scholastique Mukasonga wrote 'Our Lady of the Nile' (2012), which won the Prix Renaudot, and 'Inyenzi ou les cafards'. Oral literature (proverbs, riddles, praise poems, cattle names) is the oldest tradition.",
 "ubuvanganzo|ubuvanganzo bw'u rwanda|rwandan literature|alexis kagame|kagame alexis|inganji karinga|scholastique mukasonga|mukasonga|notre-dame du nil|our lady of the nile|renaudot|ibyivugo|amazina y'inka|oral literature|ubuvanganzo bwo mu kanwa|abanditsi|writers|umusizi|poet|poetry|ubusizi"],

/* ================= TENSES AND VERBS ================= */
["english-tenses", "grammar", "Ibihe by'inshinga mu Cyongereza", "English verb tenses",
 "Ibihe 12 by'Icyongereza (ni ingero n'inshinga 'eat'): Simple present: I eat. Present continuous: I am eating. Present perfect: I have eaten. Present perfect continuous: I have been eating. Simple past: I ate. Past continuous: I was eating. Past perfect: I had eaten. Past perfect continuous: I had been eating. Simple future: I will eat. Future continuous: I will be eating. Future perfect: I will have eaten. Future perfect continuous: I will have been eating.",
 "The 12 English tenses (using 'eat'): Simple present: I eat. Present continuous: I am eating. Present perfect: I have eaten. Present perfect continuous: I have been eating. Simple past: I ate. Past continuous: I was eating. Past perfect: I had eaten. Past perfect continuous: I had been eating. Simple future: I will eat. Future continuous: I will be eating. Future perfect: I will have eaten. Future perfect continuous: I will have been eating.",
 "tenses|tense|ibihe by'inshinga|ibihe|english tenses|simple present|present continuous|present perfect|simple past|past continuous|past perfect|simple future|future perfect|12 tenses|grammar|ibibonezamvugo by'icyongereza|verb tenses|inshinga|learn english"],
["english-verbs-irregular", "grammar", "Inshinga z'Icyongereza zidakurikiza amategeko", "Common irregular English verbs",
 "Base – Past – Past participle: be – was/were – been; have – had – had; do – did – done; go – went – gone; see – saw – seen; eat – ate – eaten; drink – drank – drunk; write – wrote – written; read – read – read; take – took – taken; give – gave – given; come – came – come; know – knew – known; speak – spoke – spoken; buy – bought – bought; make – made – made; say – said – said; run – ran – run.",
 "Base – Past – Past participle: be – was/were – been; have – had – had; do – did – done; go – went – gone; see – saw – seen; eat – ate – eaten; drink – drank – drunk; write – wrote – written; read – read – read; take – took – taken; give – gave – given; come – came – come; know – knew – known; speak – spoke – spoken; buy – bought – bought; make – made – made; say – said – said; run – ran – run.",
 "irregular verbs|inshinga zidakurikiza amategeko|past tense|past participle|be|go|went|gone|eat|ate|eaten|write|wrote|written|see|saw|seen|take|took|taken|verbs|inshinga z'icyongereza|list of verbs|verb forms"],
["english-modal-auxiliary", "grammar", "Inshinga zifasha n'inshinga z'ubushobozi", "Auxiliary and modal verbs",
 "Inshinga zifasha: be, have, do. Modal verbs: can (gushobora), could, may/might (kubasha), must (kugomba), should (ukwiye), will/would. Ingero: I can swim (Nshobora koga). You must go (Ugomba kugenda). She should study (Agomba kwiga).",
 "Auxiliary verbs: be, have, do. Modal verbs: can (ability), could, may/might (possibility), must (obligation), should (advice), will/would. Examples: I can swim. You must go. She should study.",
 "modal verbs|auxiliary verbs|can|could|may|might|must|should|will|would|inshinga zifasha|gushobora|kugomba|helping verbs|do does did|have has had|am is are"],
["english-parts-of-speech", "grammar", "Ibice by'imvugo mu Cyongereza", "Parts of speech",
 "Ibice by'imvugo mu Cyongereza ni umunani: noun (izina), pronoun (ikinyazina), verb (inshinga), adjective (inyito), adverb (inshinga-ngereka), preposition (ikinyazina-nteko), conjunction (ihuza) na interjection (indagi). Urugero: 'She quickly ate a big mango.' (She = pronoun, quickly = adverb, ate = verb, big = adjective, mango = noun).",
 "English has eight parts of speech: noun, pronoun, verb, adjective, adverb, preposition, conjunction and interjection. Example: 'She quickly ate a big mango.' (She = pronoun, quickly = adverb, ate = verb, big = adjective, mango = noun).",
 "parts of speech|noun|pronoun|verb|adjective|adverb|preposition|conjunction|interjection|izina|inshinga|inyito|ikinyazina|ibice by'imvugo|word classes|grammar"],
["kinyarwanda-verbs", "grammar", "Inshinga z'Ikinyarwanda", "Common Kinyarwanda verbs",
 "Inshinga mu Kinyarwanda zitangirira ku 'ku-', 'gu-' cyangwa 'kw-'. Ingero: kurya (to eat), kunywa (to drink), kugenda (to go), kuza (to come), gukora (to work/do), kwiga (to study/learn), gusoma (to read), kwandika (to write), kuvuga (to speak), kubona (to see), kumenya (to know), gukunda (to love/like), kugura (to buy), gusinzira (to sleep).",
 "Kinyarwanda verbs begin with 'ku-', 'gu-' or 'kw-' (the infinitive). Examples: kurya (to eat), kunywa (to drink), kugenda (to go), kuza (to come), gukora (to work/do), kwiga (to study/learn), gusoma (to read), kwandika (to write), kuvuga (to speak), kubona (to see), kumenya (to know), gukunda (to love/like), kugura (to buy), gusinzira (to sleep).",
 "inshinga|inshinga z'ikinyarwanda|kinyarwanda verbs|verbs in kinyarwanda|kurya|kunywa|kugenda|kuza|gukora|kwiga|gusoma|kwandika|kuvuga|kubona|kumenya|gukunda|kugura|gusinzira|infinitive|to eat|to drink|to go|to come"],
["kinyarwanda-tenses", "grammar", "Ibihe by'inshinga mu Kinyarwanda", "Kinyarwanda verb tenses (with 'kurya')",
 "Ingero n'inshinga 'kurya': Ubu (present): ndarya = I eat. Ubu ukomeje: ndimo kurya = I am eating. Ibyahise (past): nariye = I ate/have eaten. Ibyahise bisanzwe: naryaga = I used to eat. Ibizaza (future): nzarya = I will eat. Abandi bantu: urarya (you eat), arya (he/she eats), turarya (we eat), murarya (you pl.), bararya (they eat). Ibi ni incamake; Ikinyarwanda gifite ibihe byinshi kurusha ibi.",
 "Examples with 'kurya' (to eat): Present: ndarya = I eat. Continuous: ndimo kurya = I am eating. Past: nariye = I ate / have eaten. Habitual past: naryaga = I used to eat. Future: nzarya = I will eat. Other subjects: urarya (you eat), arya (he/she eats), turarya (we eat), murarya (you pl. eat), bararya (they eat). This is a summary; Kinyarwanda has more tenses than shown here.",
 "ibihe by'inshinga|ibihe mu kinyarwanda|kinyarwanda tenses|ndarya|nariye|naryaga|nzarya|ndimo kurya|urarya|arya|turarya|murarya|bararya|present|past|future|ubu|ibyahise|ibizaza|conjugation|guhindura inshinga"],
["kinyarwanda-verbs-conjugated", "grammar", "Inshinga z'ingenzi zihinduwe", "Key Kinyarwanda verbs conjugated",
 "kugenda (to go): ndagenda (I go), nagiye (I went), nzagenda (I will go). kuza (to come): ndaza, naje, nzaza. gukora (to work): ndakora, nakoze, nzakora. kwiga (to learn): niga, nize, nziga. gusoma (to read): ndasoma, nasomye, nzasoma. kwandika (to write): ndandika, nanditse, nzandika. kuvuga (to speak): ndavuga, navuze, nzavuga. kubona (to see): ndabona, nabonye, nzabona. kunywa (to drink): ndanywa, nanyweye, nzanywa.",
 "Present / past / future with 'I': kugenda (to go): ndagenda, nagiye, nzagenda. kuza (to come): ndaza, naje, nzaza. gukora (to work): ndakora, nakoze, nzakora. kwiga (to learn): niga, nize, nziga. gusoma (to read): ndasoma, nasomye, nzasoma. kwandika (to write): ndandika, nanditse, nzandika. kuvuga (to speak): ndavuga, navuze, nzavuga. kubona (to see): ndabona, nabonye, nzabona. kunywa (to drink): ndanywa, nanyweye, nzanywa.",
 "ndagenda|nagiye|nzagenda|ndaza|naje|nzaza|ndakora|nakoze|nzakora|niga|nize|nziga|ndasoma|nasomye|nzasoma|ndandika|nanditse|nzandika|ndavuga|navuze|nzavuga|ndabona|nabonye|nzabona|ndanywa|nanyweye|nzanywa|conjugated verbs|inshinga zihinduwe"],
["kinyarwanda-negation", "grammar", "Guhakana mu Kinyarwanda", "Negation in Kinyarwanda",
 "Guhakana bikorwa bakoresha 'nta-', 'si-' cyangwa 'ntabwo'. Ingero: sindya (I do not eat), ntabwo ndya (I do not eat), sinzarya (I will not eat), ntabwo nariye (I have not eaten), ntagenda (he/she does not go). 'Oya' = no, 'si' = is not.",
 "Negation in Kinyarwanda uses 'nta-', 'si-' or 'ntabwo'. Examples: sindya (I do not eat), ntabwo ndya (I do not eat), sinzarya (I will not eat), ntabwo nariye (I have not eaten). 'Oya' = no, 'si' = is not.",
 "guhakana|negation|negative|sindya|ntabwo|sinzarya|nta|si|oya|not|ntabwo ndya|negative sentences|ibibazo mu kinyarwanda|asking questions|ibibazo"]
];

const mifasaKnownIds2 = new Set(MIFASA_CORE_KNOWLEDGE.map(k => k.id));
MIFASA_MORE_KNOWLEDGE_2.forEach(r => {
  if (!Array.isArray(r) || r.length < 7 || mifasaKnownIds2.has(r[0])) return;
  mifasaKnownIds2.add(r[0]);
  MIFASA_CORE_KNOWLEDGE.push({ id: r[0], cat: r[1], t_rw: r[2], t_en: r[3], s_rw: r[4], s_en: r[5], kw: r[6].split("|").map(s => s.trim()).filter(Boolean) });
});
/* ---------------------------------------------------------- */
/* 9e. MIFASA BRAIN (ai.json): understands the question first  */
/* ---------------------------------------------------------- */
// ai.json holds the "intelligence": what people may ask (patterns / keywords),
// what MIFASA AI answers, how to ask back when the question is unclear,
// extra facts, synonyms and spelling fixes. Everything else (all the other
// JSON files) keeps working exactly as before: the brain answers when it is
// sure, otherwise the question goes to the normal search over ALL files.

const MIFASA_BRAIN_FILE_RE = /^ai(?:\d+)?(?:json)?$/i; // ai.json, ai2json.json, ai3.json, etc.
const MIFASA_LEARNING_KEY = "mifasa_brain_learning_v1";
const MIFASA_LEARNING_LIMIT = 200;

const MifasaBrain = {
  ready: false,
  intents: [],
  facts: [],
  canon: new Map(),
  corrections: new Map(),
  phrases: [],
  emoji: new Map(),
  globalGroups: [],
  fallback: null,
  lastIntent: "",
  forceId: "",
  cfg: {
    high: 0.8,          // at or above this: answer directly
    low: 0.5,           // between low and high: ask back (needs a label), below low: normal search
    margin: 0.12,       // two intents closer than this are "ambiguous"
    maxClarify: 3,
    clarify_rw: "Ndashaka kumenya neza icyo ushaka. Urashaka kuvuga:",
    clarify_en: "I want to be sure I get this right. Do you mean:",
    confirm_rw: "Ese urashaka kuvuga **{label}**?",
    confirm_en: "Do you mean **{label}**?",
    yes_rw: "Yego",
    yes_en: "Yes"
  }
};

function mifasaIsBrainFile(file) {
  // Examples: ai.json, ai2json.json, ai3.json, ai4json.json
  return MIFASA_BRAIN_FILE_RE.test(getFileBaseName(file));
}

// Each module is kept separately, then compiled together. Add a new filename here
// only if it is not already listed in MIFASA_JSON_FILES / a JSON manifest.
const MIFASA_PHOTO_DB = { aliases: {
  trump: "Donald Trump", obama: "Barack Obama", biden: "Joe Biden", kagame: "Paul Kagame", putin: "Vladimir Putin", macron: "Emmanuel Macron",
  museveni: "Yoweri Museveni", ruto: "William Ruto", tshisekedi: "Felix Tshisekedi", mandela: "Nelson Mandela", messi: "Lionel Messi",
  ronaldo: "Cristiano Ronaldo", mbappe: "Kylian Mbappe", musk: "Elon Musk", gates: "Bill Gates", zuckerberg: "Mark Zuckerberg",
  karisimbi: "Mount Karisimbi", nyungwe: "Nyungwe National Park", akagera: "Akagera National Park", kivu: "Lake Kivu", ibirunga: "Virunga Mountains"
}, images: [] };
const MIFASA_BRAIN_MODULES = new Map();

function mifasaMergeBrainModules() {
  const ordered = [...MIFASA_BRAIN_MODULES.entries()]
    .sort((a, b) => {
      const rank = name => {
        const base = getFileBaseName(name).toLowerCase();
        return base === "ai" ? 0 : Number((base.match(/^ai(\d+)/) || [])[1] || 999);
      };
      return rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]);
    })
    .map(entry => entry[1]);

  const merged = {
    intents: [], knowledge: [], synonyms: [], local_synonyms: [],
    corrections: {}, emoji: {}, extra_stop_words: [], settings: {}, fallback: {}
  };
  // ai.json is the base brain. Supplement modules (ai2, ai3, ...) ADD intents, facts, synonyms,
  // corrections and stop words, but never replace the base settings, fallback or an existing id/key.
  const seenIntent = new Set(), seenFact = new Set();
  const addMissing = (to, from) => {
    if (from && typeof from === "object") Object.keys(from).forEach(k => { if (!(k in to)) to[k] = from[k]; });
  };
  for (const src of ordered) {
    if (!src || typeof src !== "object") continue;
    const normalized = Array.isArray(src) ? { intents: src } : src;
    const priorI = new Set(seenIntent), priorF = new Set(seenFact);
    if (Array.isArray(normalized.intents)) normalized.intents.forEach(it => {
      const id = it && it.id ? String(it.id) : "";
      if (id && priorI.has(id)) return;          // an earlier module already owns this id
      if (id) seenIntent.add(id);
      merged.intents.push(it);
    });
    if (Array.isArray(normalized.knowledge)) normalized.knowledge.forEach(f => {
      const id = f && f.id ? String(f.id) : "";
      if (id && priorF.has(id)) return;
      if (id) seenFact.add(id);
      merged.knowledge.push(f);
    });
    if (Array.isArray(normalized.synonyms)) merged.synonyms.push(...normalized.synonyms);
    if (Array.isArray(normalized.local_synonyms)) merged.local_synonyms.push(...normalized.local_synonyms);
    if (Array.isArray(normalized.extra_stop_words)) merged.extra_stop_words.push(...normalized.extra_stop_words);
    addMissing(merged.corrections, normalized.corrections);
    addMissing(merged.emoji, normalized.emoji);
    addMissing(merged.settings, normalized.settings);
    addMissing(merged.fallback, normalized.fallback);
  }
  return merged;
}

function brainStrList(v) {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).filter(x => typeof x === "string" && x.trim()).map(x => x.trim());
}

function brainCanon(t) {
  return MifasaBrain.canon.get(t) || t;
}

// content words of a text (stop words removed, synonyms folded); keeps everything if the text is only stop words ("uri nde")
function brainToks(str) {
  const all = mifasaNorm(str).split(" ").filter(Boolean);
  const content = all.filter(t => t.length > 1 && !MIFASA_STOP_WORDS.has(t));
  return (content.length ? content : all).map(brainCanon);
}

/* ---- compile ai.json ---- */
function brainCompileIntent(raw, i) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || ("intent" + i));

  const pats = [
    ...brainStrList(raw.patterns), ...brainStrList(raw.patterns_rw),
    ...brainStrList(raw.patterns_en), ...brainStrList(raw.questions)
  ].map(p => mifasaExpandContractions(p)).map(p => ({ norm: mifasaNorm(p), toks: brainToks(p) })).filter(p => p.toks.length);

  const toGroup = g => brainStrList(g).map(mifasaExpandContractions).map(mifasaNorm).filter(Boolean);
  const must = (Array.isArray(raw.must) ? raw.must : raw.must ? [raw.must] : []).map(toGroup).filter(g => g.length);
  const any = brainStrList(raw.any).map(mifasaExpandContractions).map(mifasaNorm).filter(Boolean);
  const not = brainStrList(raw.not).map(mifasaExpandContractions).map(mifasaNorm).filter(Boolean);

  const answer_rw = brainStrList(raw.answer_rw ?? raw.answer);
  const answer_en = brainStrList(raw.answer_en ?? raw.answer);
  const thenSearch = raw.then_search === true || typeof raw.then_search === "string" ||
    (raw.then_search && typeof raw.then_search === "object") ? raw.then_search : null;

  if (!pats.length && !must.length) return null;           // nothing to recognise it by
  if (!answer_rw.length && !answer_en.length && !thenSearch) return null; // nothing to do when recognised

  const kwTokens = [...new Set([...must.flat(), ...any].flatMap(t => t.split(" ")).map(brainCanon))];
  const baseList = v => brainStrList(v).map(x => getFileBaseName(x).toLowerCase());

  return {
    id,
    pats, must, any, not, kwTokens,
    partial: !!raw.partial,
    priority: Number.isFinite(raw.priority) ? Math.max(0, Math.min(10, raw.priority)) : 5,
    qtype: brainStrList(raw.qtype).map(x => x.toLowerCase()),
    after: brainStrList(raw.after),
    needsContext: !!raw.needs_context,
    answer_rw, answer_en,
    followRw: brainStrList(raw.follow_ups_rw ?? raw.follow_ups),
    followEn: brainStrList(raw.follow_ups_en ?? raw.follow_ups),
    label_rw: typeof raw.label_rw === "string" ? raw.label_rw : (typeof raw.label === "string" ? raw.label : ""),
    label_en: typeof raw.label_en === "string" ? raw.label_en : (typeof raw.label === "string" ? raw.label : ""),
    thenSearch,
    sources: baseList(raw.sources),
    onlySources: baseList(raw.only_sources)
  };
}

function mifasaBrainLoad(data, file = "ai.json") {
  // Ignore ordinary legacy article JSON files; they continue through the normal article pipeline.
  const looksLikeIntent = x => x && typeof x === "object" &&
    (x.patterns || x.patterns_rw || x.patterns_en || x.questions || x.must);
  const src = Array.isArray(data)
    ? (data.some(looksLikeIntent) ? { intents: data } : null)
    : data;
  if (!src || typeof src !== "object" || !Array.isArray(src.intents)) return false;
  mifasaPhotoDbLoad(src);
  mifasaLexiconLoad(src);

  MIFASA_BRAIN_MODULES.set(String(file || "ai.json"), src);
  return mifasaBrainLoadSingle(mifasaMergeBrainModules());
}

function mifasaBrainLoadSingle(data) {
  // a bare list only counts as a brain if its items look like intents (an old list of articles is still ingested normally)
  const looksLikeIntent = x => x && typeof x === "object" && (x.patterns || x.patterns_rw || x.patterns_en || x.questions || x.must);
  const src = Array.isArray(data) ? (data.some(looksLikeIntent) ? { intents: data } : null) : data;
  if (!src || typeof src !== "object" || !Array.isArray(src.intents)) return false;   // old-style file: ingest normally
  const B = MifasaBrain;
  try {
    // synonyms: "local_synonyms" help only the brain, "synonyms" also help the whole-site search
    B.canon = new Map();
    const allGroups = [
      ...(Array.isArray(src.local_synonyms) ? src.local_synonyms : []),
      ...(Array.isArray(src.synonyms) ? src.synonyms : []),
      ...MIFASA_DICT_GROUPS.filter(g => g.length <= 5)      // dictionary.json: football = soccer = umupira
    ].filter(Array.isArray);
    const par = new Map(), ord = new Map();
    const find = x => { let r = x; while (par.get(r) !== r) r = par.get(r); while (par.get(x) !== r) { const n = par.get(x); par.set(x, r); x = n; } return r; };
    allGroups.forEach(group => {
      const words = group.map(mifasaNorm).filter(w => w && w.indexOf(" ") < 0);
      words.forEach(w => { if (!par.has(w)) { par.set(w, w); ord.set(w, ord.size); } });
      for (let k = 1; k < words.length; k++) {
        const ra = find(words[0]), rb = find(words[k]);
        if (ra === rb) continue;
        if (ord.get(ra) <= ord.get(rb)) par.set(rb, ra); else par.set(ra, rb);   // earliest word stays the canonical one
      }
    });
    par.forEach((_, w) => { const r = find(w); if (r !== w) B.canon.set(w, r); });

    B.globalGroups.forEach(g => { const k = MIFASA_SYNONYM_GROUPS.indexOf(g); if (k > -1) MIFASA_SYNONYM_GROUPS.splice(k, 1); });
    B.globalGroups = (Array.isArray(src.synonyms) ? src.synonyms : [])
      .filter(Array.isArray).map(g => g.filter(x => typeof x === "string" && x.trim())).filter(g => g.length > 1);
    B.globalGroups.forEach(g => MIFASA_SYNONYM_GROUPS.push(g));

    // spelling fixes (single words): "politiks" -> "politiki"
    B.corrections = new Map();
    B.phrases = [];
    B.emoji = new Map();
    if (src.emoji && typeof src.emoji === "object") {
      Object.keys(src.emoji).forEach(k => {
        const key = String(k).replace(/[\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "");
        const val = String(src.emoji[k] || "").trim();
        if (key && val) B.emoji.set(key, val);
      });
    }
    if (src.corrections && typeof src.corrections === "object") {
      Object.keys(src.corrections).forEach(k => {
        const from = mifasaNorm(k), to = mifasaNorm(src.corrections[k]);
        if (from && to && from.indexOf(" ") < 0) B.corrections.set(from, to);
        else if (from && to) B.phrases.push([from, to]);
      });
    }

    brainStrList(src.extra_stop_words).forEach(w => { const n = mifasaNorm(w); if (n) MIFASA_STOP_WORDS.add(n); });

    const s = src.settings && typeof src.settings === "object" ? src.settings : {};
    const base = { ...B.cfg };
    ["high", "low", "margin", "maxClarify"].forEach(k => { if (Number.isFinite(s[k])) base[k] = s[k]; });
    ["clarify_rw", "clarify_en", "confirm_rw", "confirm_en", "yes_rw", "yes_en"].forEach(k => { if (typeof s[k] === "string" && s[k]) base[k] = s[k]; });
    B.cfg = base;

    B.intents = src.intents.map(brainCompileIntent).filter(Boolean);
    B.facts = Array.isArray(src.knowledge) ? src.knowledge.filter(f => f && typeof f === "object") : [];
    B.fallback = src.fallback && typeof src.fallback === "object" ? {
      rw: brainStrList(src.fallback.answer_rw ?? src.fallback.answer),
      en: brainStrList(src.fallback.answer_en ?? src.fallback.answer)
    } : null;
    B.ready = B.intents.length > 0 || B.facts.length > 0;

    // the search index must see the new synonyms and facts
    mifasaCoreDocs = null;
    MifasaIndex.synMap = null;
    MifasaIndex.dirty = true;
    console.log(`🧩 MIFASA brain: ${B.intents.length} intents, ${B.facts.length} facts`);
  } catch (e) {
    console.warn("MIFASA brain could not be read", e);
    return false;
  }
  return true;
}

// facts written in ai.json ("knowledge") join the built-in knowledge: answered from, never shown as news cards
function mifasaBrainFactDocs() {
  const out = [];
  MifasaBrain.facts.forEach((f, i) => {
    const key = "brain-" + (f.id || i);
    const a = normalizeArticle({ ...f, id: key, share_id: key, category: f.category || f.cat || "knowledge" }, "core");
    if (a) { a._core = true; a._ts = 0; out.push(a); }
  });
  return out;
}

/* ---- understand the question ---- */
// emoji -> words (from ai.json "emoji"), so 😂 or "mfite agahinda 😢" can be understood
function brainEmojiExpand(raw) {
  const map = MifasaBrain.emoji;
  if (!map || !map.size) return raw;
  // Decode mapped emoji even when they appear beside words, e.g. "mfite agahinda 😢".
  let s = String(raw || "").replace(/[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu, "");
  s = s.replace(/(\p{Extended_Pictographic})\1+/gu, "$1");   // 😂😂😂 -> 😂
  let changed = false;
  map.forEach((words, emo) => {
    if (s.indexOf(emo) > -1) { s = s.split(emo).join(" " + words + " "); changed = true; }
  });
  return changed ? s : raw;
}

const MIFASA_CONTRACTIONS = {"ain't": "is not", "aint": "is not", "aren't": "are not", "arent": "are not", "can't": "can not", "cant": "can not", "couldn't": "could not", "couldnt": "could not", "didn't": "did not", "didnt": "did not", "doesn't": "does not", "doesnt": "does not", "don't": "do not", "dont": "do not", "hadn't": "had not", "hadnt": "had not", "hasn't": "has not", "hasnt": "has not", "haven't": "have not", "havent": "have not", "he'd": "he would", "he'll": "he will", "he's": "he is", "here's": "here is", "heres": "here is", "how's": "how is", "hows": "how is", "i'd": "i would", "i'll": "i will", "i'm": "i am", "i've": "i have", "im": "i am", "isn't": "is not", "isnt": "is not", "it'd": "it would", "it'll": "it will", "it's": "it is", "ive": "i have", "let's": "let us", "mustn't": "must not", "mustnt": "must not", "she'd": "she would", "she'll": "she will", "she's": "she is", "shouldn't": "should not", "shouldnt": "should not", "that's": "that is", "thats": "that is", "there's": "there is", "theres": "there is", "they'd": "they would", "they'll": "they will", "they're": "they are", "they've": "they have", "theyre": "they are", "theyve": "they have", "wasn't": "was not", "wasnt": "was not", "we'd": "we would", "we'll": "we will", "we're": "we are", "we've": "we have", "were": "we are", "weren't": "were not", "werent": "were not", "weve": "we have", "what's": "what is", "whats": "what is", "when's": "when is", "where's": "where is", "wheres": "where is", "who's": "who is", "whos": "who is", "why's": "why is", "won't": "will not", "wont": "will not", "wouldn't": "would not", "wouldnt": "would not", "you'd": "you would", "you'll": "you will", "you're": "you are", "you've": "you have", "youre": "you are", "youve": "you have"};
// "it's" -> "it is", "don't" -> "do not" ... (also curly \u2019 and forms typed without the apostrophe).
// Works on the raw text, so numbers, symbols and other words are left exactly as typed.
function mifasaExpandContractions(raw) {
  return String(raw == null ? "" : raw).replace(/[A-Za-z]+(?:['\u2019][A-Za-z]+)?/g, w => {
    const hit = MIFASA_CONTRACTIONS[w.toLowerCase().replace(/\u2019/g, "'")];
    return hit || w;
  });
}

/* ---- SPELL GUARD + RELATED WORDS (v7) ----
   1. unknown words that are one small slip away from a word the AI knows ("lete" -> "let", "footbal" -> "football")
      are repaired, using the neighbouring words to choose when two candidates tie.
   2. every dictionary.json entry links its words as synonyms (football = soccer = umupira), for search AND the brain. */
const MIFASA_BASE_WORDS = ("a about above after again all also always am an and any are as ask at away back bad be because been before being best better big but by call can come could day did do does done down each easy end even ever every few find first for from get give go going gone good great had has have he hear help her here him his home how if in into is it its just keep kind know last late learn leave left less let life like little long look lost love make many may me mean more most much must my need never new next no not now of off old on one only open or other our out over own people play please put read really right run said same say see she should show since so some something song soon start still stop such sure take talk tell than thank thanks that the their them then there these they thing think this those through time to today together too try turn under until up us use very want was watch way we well went were what when where which while who why will with without word work world would write wrong year yes yet you young your").split(" ");
const MIFASA_DICT_GROUPS = [];
const MIFASA_DICT_GROUP_KEYS = new Set();
let mifasaVocab = null, mifasaVocabStamp = "", mifasaBigrams = null;
let mifasaSpellFixes = [];               // [[typed, understood], ...] for the question being answered now

function mifasaDictGroup(rw, en) {
  const one = x => { const t = mifasaNorm(String(x || "").replace(/^to /, "")); return /^[a-z]{3,}$/.test(t) && !MIFASA_STOP_WORDS.has(t) ? t : ""; };
  const uniq = [...new Set([one(rw), ...en.map(one)].filter(Boolean))];
  if (uniq.length < 2) return;
  const key = uniq.slice().sort().join("|");
  if (MIFASA_DICT_GROUP_KEYS.has(key)) return;
  MIFASA_DICT_GROUP_KEYS.add(key);
  MIFASA_DICT_GROUPS.push(uniq);
  MIFASA_SYNONYM_GROUPS.push(uniq);
}

function mifasaVocabGet() {
  const B = MifasaBrain;
  const stamp = [B.intents.length, MIFASA_EXTRA_DICT.length, MIFASA_SYNONYM_GROUPS.length, B.corrections.size].join("|");
  if (mifasaVocab && stamp === mifasaVocabStamp) return mifasaVocab;
  const v = new Map(), bi = new Set();
  const add = (w, wt) => { if (/^[a-z]{3,}$/.test(w)) v.set(w, Math.max(v.get(w) || 0, wt)); };
  const addText = (t, wt) => {
    const ws = mifasaNorm(t).split(" ").filter(Boolean);
    ws.forEach(w => add(w, wt));
    for (let i = 0; i + 1 < ws.length; i++) bi.add(ws[i] + " " + ws[i + 1]);
  };
  MIFASA_BASE_WORDS.forEach(w => add(w, 3));
  MIFASA_STOP_WORDS.forEach(w => add(String(w).toLowerCase(), 3));
  if (!mifasaDictRw) mifasaDictBuild();
  mifasaDictRw.forEach((e, k) => { addText(k, 3); e.en.forEach(x => addText(x, 3)); });
  MIFASA_SYNONYM_GROUPS.forEach(g => g.forEach(x => addText(x, 2)));
  B.corrections.forEach(to => addText(to, 2));
  B.intents.forEach(it => {
    it.pats.forEach(p => addText(p.norm, 2));
    it.must.forEach(g => g.forEach(x => addText(x, 2)));
    it.any.forEach(x => addText(x, 2));
  });
  mifasaVocab = v; mifasaBigrams = bi; mifasaVocabStamp = stamp;
  return v;
}

// Damerau-Levenshtein (a swapped pair like "teh" -> "the" counts as ONE slip)
function mifasaSlips(a, b, max) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= al; i++) { d[i] = [i]; }
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) for (let j = 1; j <= bl; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[al][bl];
}

function mifasaSpellFix(raw) {
  const text = String(raw == null ? "" : raw);
  if (!MifasaBrain.ready || text.length > 400 || /https?:|www\.|@/i.test(text)) return text;
  const vocab = mifasaVocabGet(), idx = MifasaIndex;
  const known = w => vocab.has(w) || MifasaBrain.corrections.has(w) || (idx.postings && idx.postings.has(w)) ||
    ["s", "es", "ed", "d", "ing", "ly", "er", "est"].some(suf => w.endsWith(suf) && w.length - suf.length >= 3 &&
      (vocab.has(w.slice(0, -suf.length)) || vocab.has(w.slice(0, -suf.length) + "e")));
  // the words around each one, so "never lete me" can prefer "let" (never let / let me) over "late"
  const words = [];
  text.replace(/[A-Za-z]+/g, (w, off) => { words.push({ w, off, lw: w.toLowerCase() }); return w; });
  const fixed = new Map();
  words.forEach((it, k) => {
    const { w, off, lw } = it;
    if (lw.length < 4 || known(lw)) return;
    if (w === w.toUpperCase()) return;                                  // acronyms
    if (/[0-9]/.test(text[off - 1] || "") || /[0-9]/.test(text[off + w.length] || "")) return;
    if (w[0] !== w[0].toLowerCase() && k > 0 && !/[.?!]\s*$/.test(text.slice(0, off))) return;   // names: Kagame, Musanze
    const max = lw.length >= 9 ? 2 : 1;
    const prev = k > 0 ? words[k - 1].lw : "", next = k + 1 < words.length ? words[k + 1].lw : "";
    const cands = [];
    vocab.forEach((wt, cand) => {
      if (cand[0] !== lw[0] && !(lw.length >= 6 && cand[1] === lw[1])) return;
      if (Math.abs(cand.length - lw.length) > max) return;
      const d = mifasaSlips(lw, cand, max);
      if (d > max) return;
      const ctx = (prev && mifasaBigrams.has(prev + " " + cand) ? 1 : 0) + (next && mifasaBigrams.has(cand + " " + next) ? 1 : 0);
      cands.push({ cand, score: d * 10 - wt - ctx * 4 });
    });
    if (!cands.length) return;
    cands.sort((a, b) => a.score - b.score);
    if (cands.length > 1 && cands[1].score - cands[0].score < 1) return;   // two equally good guesses: do not guess
    let to = cands[0].cand;
    if (w[0] !== w[0].toLowerCase()) to = to[0].toUpperCase() + to.slice(1);
    fixed.set(off, { len: w.length, to, from: w });
  });
  if (!fixed.size) return text;
  let out = "", pos = 0;
  [...fixed.keys()].sort((a, b) => a - b).forEach(off => {
    const f = fixed.get(off);
    out += text.slice(pos, off) + f.to; pos = off + f.len;
    mifasaSpellFixes.push([f.from, f.to]);
  });
  return out + text.slice(pos);
}

function mifasaSpellNote() {
  if (!mifasaSpellFixes.length) return "";
  const list = mifasaSpellFixes.slice(0, 4).map(([a, b]) => `**${a}** → **${b}**`).join(", ");
  mifasaSpellFixes = [];
  return `✏️ _I spotted a typo and read it as: ${list}_\n\n`;
}

// a word that is not in the dictionary but sits in a synonym group with one that is (football -> soccer -> umupira)
function mifasaRelatedWord(key, toRw) {
  if (!/^[a-z]{3,}$/.test(key)) return null;
  for (const g of MIFASA_SYNONYM_GROUPS.slice().sort((x, y) => x.length - y.length)) {
    const toks = g.map(x => mifasaNorm(x)).filter(x => x && x.indexOf(" ") < 0);
    if (toks.indexOf(key) < 0) continue;
    for (const m of toks) {
      if (m === key) continue;
      if (toRw) { const list = mifasaDictEn.get(m); if (list && list.length) return { via: m, out: [...new Set(list)].join(" / ") }; }
      else { const e = mifasaDictRw.get(m); if (e) return { via: m, out: e.en.join(" / ") }; }
    }
  }
  return null;
}

/* ---- WORD GAPS + JOINED WORDS (v8) ----
   mifasaHarvestUnknown : every word the AI does not know is counted (in this browser), so you can fill dictionary.json fast.
   mifasaSplitCompounds : "ndigutekereza" -> "ndi gutekereza", but ONLY when both halves are dictionary words. */
const MIFASA_UNKNOWN_KEY = "mifasa_unknown_words_v1";

function mifasaIsKnownWord(w) {
  if (!mifasaDictRw) mifasaDictBuild();
  return mifasaDictRw.has(w) || mifasaDictEn.has(w) || MIFASA_STOP_WORDS.has(w) || mifasaVocabGet().has(w) ||
    (MifasaIndex.postings && MifasaIndex.postings.has(w)) || MifasaBrain.corrections.has(w) || MifasaBrain.canon.has(w);
}

function mifasaSplitCompounds(raw) {
  const text = String(raw == null ? "" : raw);
  if (!MifasaBrain.ready || !mifasaDictRw || text.length > 400 || /https?:|www\.|@/i.test(text)) return text;
  return text.replace(/[A-Za-z]{6,}/g, w => {
    const lw = w.toLowerCase();
    if (mifasaIsKnownWord(lw)) return w;
    let best = null, tie = false;
    for (let i = 2; i <= lw.length - 3; i++) {
      const a = lw.slice(0, i), b = lw.slice(i);
      if (!mifasaDictRw.has(a) || !mifasaDictRw.has(b)) continue;
      const score = Math.min(a.length, b.length);
      if (!best || score > best.score) { best = { a, b, score }; tie = false; }
      else if (score === best.score) tie = true;
    }
    return best && !tie ? best.a + " " + best.b : w;
  });
}

function mifasaUnknownRead() { return readLS(MIFASA_UNKNOWN_KEY, []); }

function mifasaHarvestUnknown(raw) {
  try {
    if (!MifasaBrain.ready) return;
    const q = mifasaNorm(raw);
    if (!q || q.length > 200) return;
    const words = [...new Set(q.split(" ").filter(w => /^[a-z]{3,}$/.test(w) && !mifasaIsKnownWord(w)))].slice(0, 8);
    if (!words.length) return;
    const lang = detectQueryLang(raw) || "";
    let list = mifasaUnknownRead();
    if (!Array.isArray(list)) list = [];
    words.forEach(w => {
      const hit = list.find(x => x.w === w);
      if (hit) { hit.n++; hit.t = Date.now(); if (lang) hit.l = lang; }
      else list.push({ w, n: 1, t: Date.now(), l: lang });
    });
    list.sort((a, b) => b.n - a.n || b.t - a.t);
    writeLS(MIFASA_UNKNOWN_KEY, list.slice(0, 600));
  } catch (e) {}
}

// {"module":"dictionary", entries:[{rw, en:[""]}]} - fill in "en" and drop the file into dictionary.json
function mifasaExportUnknown(includeEnglish) {
  const list = mifasaUnknownRead().filter(x => includeEnglish || x.l !== "en");
  return JSON.stringify({ module: "dictionary", version: 1, entries: list.map(x => ({ rw: x.w, en: [""], seen: x.n })) }, null, 1);
}
function mifasaDownloadUnknown(includeEnglish) {
  const blob = new Blob([mifasaExportUnknown(includeEnglish)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "unknown_words.json";
  document.body.appendChild(a); a.click(); a.remove();
}

function brainFixQuery(raw) {
  raw = brainEmojiExpand(raw);
  raw = mifasaExpandContractions(raw);
  raw = mifasaSplitCompounds(raw);
  raw = mifasaSpellFix(raw);
  if (!MifasaBrain.corrections.size && !MifasaBrain.phrases.length) return raw;
  let changed = false;
  let qn = mifasaNorm(raw);
  if (MifasaBrain.phrases.length) {
    let padded = " " + qn + " ";
    MifasaBrain.phrases.forEach(([from, to]) => {
      const f = " " + from + " ";
      if (padded.indexOf(f) > -1) { padded = padded.split(f).join(" " + to + " "); changed = true; }
    });
    qn = padded.trim();
  }
  const out = qn.split(" ").map(w => {
    const fix = MifasaBrain.corrections.get(w);
    if (fix) { changed = true; return fix; }
    return w;
  });
  return changed ? out.join(" ") : raw;
}

function brainQType(qn) {
  if (/\b(ryari|igihe|when|what year|which year|mu mwaka)\b/.test(qn)) return "when";
  if (/\b(angahe|bangahe|zingahe|ingahe|how many|how much|umubare)\b/.test(qn)) return "count";
  if (/\b(ninde|nde|who)\b/.test(qn)) return "who";
  if (/\b(kuki|why|impamvu)\b/.test(qn)) return "why";
  if (/\b(gute|how)\b/.test(qn)) return "how";
  if (/\b(hehe|ahahe|where)\b/.test(qn)) return "where";
  if (/\b(iki|icyo|what)\b/.test(qn)) return "what";
  return "";
}

// does the question contain this word / phrase? (typo tolerant for words of 5+ letters)
function brainHas(qa, qpad, term) {
  if (term.indexOf(" ") > -1) return qpad.indexOf(" " + term + " ") > -1;
  const c = brainCanon(term);
  for (let i = 0; i < qa.length; i++) {
    if (qa[i] === c) return true;
    if (c.length >= 5 && qa[i].length >= 5 && wordSimilarity(qa[i], c) >= 0.82) return true;
  }
  return false;
}

// how well a pattern explains the question: covers the pattern's words AND leaves few words unexplained
function brainPatternScore(Q, qn, pat, partial) {
  if (qn === pat.norm) return 1;
  const used = new Uint8Array(Q.length);
  let matched = 0, hitQ = 0;
  for (let k = 0; k < pat.toks.length; k++) {
    const pt = pat.toks[k];
    let best = 0, bi = -1;
    for (let i = 0; i < Q.length; i++) {
      if (used[i]) continue;
      const s = pt === Q[i] ? 1 : wordSimilarity(pt, Q[i]);
      if (s > best) { best = s; bi = i; if (s === 1) break; }
    }
    if (best >= 0.75) { matched += best; used[bi] = 1; hitQ++; }
  }
  const recall = matched / pat.toks.length;
  if (partial) return recall;
  return recall * (0.4 + 0.6 * (hitQ / Q.length));
}

function brainScoreIntent(it, ctx) {
  const { Q, qn, qa, qpad, qtype } = ctx;

  // "not" words block keyword matches, but never a question that equals one of the intent's own patterns
  if (it.not.length && !it.pats.some(p => p.norm === qn)) {
    for (let i = 0; i < it.not.length; i++) if (brainHas(qa, qpad, it.not[i])) return 0;
  }

  if (it.needsContext && !it.after.includes(MifasaBrain.lastIntent)) return 0;

  let s = 0;
  for (let i = 0; i < it.pats.length; i++) {
    const v = brainPatternScore(Q, qn, it.pats[i], it.partial);
    if (v > s) s = v;
    if (s === 1) break;
  }

  if (it.must.length) {
    let ok = true;
    for (let g = 0; g < it.must.length && ok; g++) {
      ok = it.must[g].some(t => brainHas(qa, qpad, t));
    }
    if (ok) {
      let hits = 0;
      for (let a = 0; a < it.any.length; a++) if (brainHas(qa, qpad, it.any[a])) hits++;
      const bonus = it.any.length ? Math.min(1, hits / Math.min(2, it.any.length)) : 1;
      let kw = 0.6 + 0.4 * bonus;
      if (!it.partial) {
        let explained = 0;
        for (let i = 0; i < Q.length; i++) {
          if (it.kwTokens.some(k => k === Q[i] || (k.length >= 5 && Q[i].length >= 5 && wordSimilarity(k, Q[i]) >= 0.82))) explained++;
        }
        kw *= 0.6 + 0.4 * (explained / Q.length);
      }
      if (kw > s) s = kw;
    }
  }
  if (s <= 0) return 0;

  if (it.qtype.length && qtype) s = it.qtype.includes(qtype) ? Math.min(1, s + 0.05) : s * 0.88;
  if (it.after.length && it.after.includes(MifasaBrain.lastIntent)) s = Math.min(1, s + 0.1);
  s *= 0.97 + 0.006 * it.priority;                 // priority 5 (default) = 1.0
  return Math.min(1, s);
}

function brainScoreAll(rawQuery) {
  const qn = mifasaNorm(brainFixQuery(rawQuery));
  if (!qn || qn.length < 2 || qn.split(" ").length > 25) return [];
  const ctx = {
    Q: brainToks(qn), qn,
    qa: qn.split(" ").map(brainCanon),
    qpad: " " + qn + " ",
    qtype: brainQType(qn)
  };
  if (!ctx.Q.length) return [];
  const scored = [];
  for (let i = 0; i < MifasaBrain.intents.length; i++) {
    const it = MifasaBrain.intents[i];
    const s = brainScoreIntent(it, ctx);
    if (s >= 0.3) scored.push({ it, s, exact: it.pats.some(p => p.norm === qn) });
  }
  // equal scores: an intent whose pattern matches the question word-for-word beats one matched only by keywords,
  // then the higher priority wins. (Keeps the answer stable when many intents overlap.)
  scored.sort((a, b) => (b.s - a.s) || ((b.exact ? 1 : 0) - (a.exact ? 1 : 0)) || (b.it.priority - a.it.priority));
  return scored;
}

// decision: answer / clarify / confirm / null (let the normal search handle it)
function mifasaBrainMatch(rawQuery) {
  if (!MifasaBrain.ready || !MifasaBrain.intents.length) return null;

  if (MifasaBrain.forceId) {                         // the person tapped one of the options
    const id = MifasaBrain.forceId;
    MifasaBrain.forceId = "";
    const it = MifasaBrain.intents.find(x => x.id === id);
    if (it) return { kind: "answer", it, score: 1 };
  }

  const scored = brainScoreAll(rawQuery);
  if (!scored.length) return null;
  const c = MifasaBrain.cfg;
  const top = scored[0];
  const second = scored[1];
  const gap = second ? top.s - second.s : 1;

  if (top.s >= c.high && gap >= c.margin) return { kind: "answer", it: top.it, score: top.s };
  // the question is word-for-word one of this intent's own patterns and no other intent can say that: answer, do not ask back
  if (top.exact && top.s >= c.high && !(second && second.exact)) return { kind: "answer", it: top.it, score: top.s };

  const close = scored.filter(x => x.s >= c.low && top.s - x.s < c.margin);
  const labeled = close.filter(x => x.it.label_rw || x.it.label_en).slice(0, c.maxClarify);
  if (close.length > 1 && labeled.length > 1) return { kind: "clarify", options: labeled.map(x => x.it), score: top.s };

  if (top.s >= c.high) return { kind: "answer", it: top.it, score: top.s };
  if (top.s >= c.low && (top.it.label_rw || top.it.label_en)) return { kind: "confirm", it: top.it, score: top.s };
  return null;
}

/* ---- say the answer ---- */
function brainVars(rawQuery) {
  const rw = currentLang !== "en";
  const d = kigaliNow();
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  const tod = getTimeOfDay();
  const bullets = list => list.length ? list.map(t => "• " + t).join("\n") : "";
  return {
    name: getMifasaUserName(),
    greeting: rw ? (tod === "morning" ? "Mwaramutse" : "Mwiriwe") : (tod === "morning" ? "Good morning" : tod === "afternoon" ? "Good afternoon" : "Good evening"),
    time: `${hh}:${mm}`,
    date: rw
      ? `${MIFASA_DAYS_RW[d.getDay()]}, ${d.getDate()} ${MIFASA_MONTHS_RW[d.getMonth()]} ${d.getFullYear()}`
      : `${MIFASA_DAYS_EN[d.getDay()]}, ${d.getDate()} ${MIFASA_MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`,
    tips: bullets(topicSuggestions(3)),
    latest: bullets((allNews || []).slice(0, 3).map(getTitle).filter(Boolean)),
    brand: MIFASA_BRAND.name,
    founder: MIFASA_BRAND.founder,
    origin: rw ? MIFASA_BRAND.nameOrigin_rw : MIFASA_BRAND.nameOrigin_en,
    site: mifasaSiteUrl(),
    topic: tokenize(rawQuery).filter(t => t.length > 1 && !MIFASA_STOP_WORDS.has(t)).join(" ")
  };
}

function brainFill(text, vars) {
  return String(text)
    .replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m))
    .replace(/[ \t]+([!?.,:;])/g, "$1")
    .replace(/,\s*([!?.])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function brainLabel(it) {
  return currentLang === "en" ? (it.label_en || it.label_rw) : (it.label_rw || it.label_en);
}

function brainThenQuery(it, rawQuery) {
  const t = it.thenSearch;
  if (!t) return "";
  if (t === true) return rawQuery;
  if (typeof t === "string") return t;
  return (currentLang === "en" ? (t.en || t.rw) : (t.rw || t.en)) || rawQuery;
}

// returns null (let the normal flow continue) or { text, buttons, thenQuery, sources, onlySources }
/* ---- local, user-approved learning (no API / no external model) ---- */
function mifasaLearningRead() {
  try {
    const raw = localStorage.getItem(MIFASA_LEARNING_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(x => x && typeof x === "object" && x.enabled !== false) : [];
  } catch (e) { return []; }
}

function mifasaLearningWrite(list) {
  try {
    localStorage.setItem(MIFASA_LEARNING_KEY, JSON.stringify(list.slice(-MIFASA_LEARNING_LIMIT)));
    return true;
  } catch (e) { return false; }
}

function mifasaTokenOverlap(a, b) {
  const A = [...new Set(brainToks(a))], B = [...new Set(brainToks(b))];
  if (!A.length || !B.length) return 0;
  const used = new Set(); let hits = 0;
  for (const x of A) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < B.length; i++) {
      if (used.has(i)) continue;
      const score = x === B[i] ? 1 : (x.length >= 5 && B[i].length >= 5 ? wordSimilarity(x, B[i]) : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0 && bestScore >= 0.9) { hits++; used.add(best); }
  }
  return (2 * hits) / (A.length + B.length);
}

function mifasaFindLearnedAnswer(rawQuery) {
  const q = mifasaNorm(brainFixQuery(String(rawQuery || "")));
  if (q.length < 3) return null;
  const list = mifasaLearningRead();
  let best = null;
  for (const item of list) {
    if (!item.approved || item.enabled === false || !item.query_norm) continue;
    const score = q === item.query_norm ? 1 : mifasaTokenOverlap(q, item.query_norm);
    // Conservative matching: only exact or near-identical questions may reuse taught answers.
    if (score >= 0.94 && (!best || score > best.score)) best = { item, score };
  }
  if (!best) return null;
  const rw = currentLang !== "en";
  const answer = rw ? (best.item.answer_rw || best.item.answer_en) : (best.item.answer_en || best.item.answer_rw);
  if (!answer || !String(answer).trim()) return null;
  return { answer: String(answer), score: best.score, item: best.item };
}

function mifasaTeach(query, answer, options) {
  const q = String(query == null ? "" : query).trim();
  const opts = options && typeof options === "object" ? options : {};
  const answerRw = String(opts.answer_rw || (currentLang !== "en" ? answer || "" : "")).trim();
  const answerEn = String(opts.answer_en || (currentLang === "en" ? answer || "" : "")).trim();
  if (q.length < 3 || (!answerRw && !answerEn)) return { ok: false, reason: "query_and_answer_required" };
  const qn = mifasaNorm(brainFixQuery(q));
  if (!qn) return { ok: false, reason: "invalid_query" };
  const list = mifasaLearningRead();
  const existing = list.findIndex(x => x.query_norm === qn);
  const record = {
    id: "learned_" + qn.replace(/[^a-z0-9]+/g, "_").slice(0, 48),
    query: q.slice(0, 500), query_norm: qn,
    answer_rw: answerRw.slice(0, 5000), answer_en: answerEn.slice(0, 5000),
    approved: true, enabled: true, helpful: 0, unhelpful: 0,
    updated_at: new Date().toISOString(), source: "user_taught"
  };
  if (existing >= 0) {
    const prev = list[existing];
    record.helpful = Number(prev.helpful) || 0;
    record.unhelpful = Number(prev.unhelpful) || 0;
    list.splice(existing, 1);
  }
  list.push(record);
  const ok = mifasaLearningWrite(list);
  return { ok, id: record.id, reason: ok ? "saved_locally" : "storage_unavailable", count: ok ? Math.min(list.length, MIFASA_LEARNING_LIMIT) : list.length };
}

function mifasaRateLearning(query, helpful) {
  const qn = mifasaNorm(brainFixQuery(String(query || "")));
  if (!qn) return { ok: false, reason: "query_required" };
  let list;
  try {
    const raw = localStorage.getItem(MIFASA_LEARNING_KEY);
    list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
  } catch (e) { list = []; }
  const item = list.find(x => x && x.query_norm === qn);
  if (!item) return { ok: false, reason: "learned_answer_not_found" };
  if (helpful) item.helpful = (Number(item.helpful) || 0) + 1;
  else { item.unhelpful = (Number(item.unhelpful) || 0) + 1; item.enabled = false; }
  item.last_feedback_at = new Date().toISOString();
  const ok = mifasaLearningWrite(list);
  return { ok, enabled: item.enabled !== false, helpful: item.helpful || 0, unhelpful: item.unhelpful || 0 };
}

function mifasaLearningExport() {
  try {
    const raw = localStorage.getItem(MIFASA_LEARNING_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

function mifasaLearningClear() {
  try { localStorage.removeItem(MIFASA_LEARNING_KEY); return true; }
  catch (e) { return false; }
}

function mifasaBrainAnalyze(rawQuery) {
  const q = String(rawQuery == null ? "" : rawQuery).trim();
  const scores = brainScoreAll(q).slice(0, 5);
  const top = scores[0] || null, second = scores[1] || null;
  const gap = top ? top.s - (second ? second.s : 0) : 0;
  const learned = mifasaFindLearnedAnswer(q);
  let decision = "normal_search";
  if (learned) decision = "learned_answer";
  else if (top && top.s >= MifasaBrain.cfg.high && gap >= MifasaBrain.cfg.margin) decision = "answer_intent";
  else if (top && top.s >= MifasaBrain.cfg.low && second && top.s - second.s < MifasaBrain.cfg.margin) decision = "clarify";
  else if (top && top.s >= MifasaBrain.cfg.low) decision = "confirm_or_search";
  return {
    query: q, normalized: mifasaNorm(brainFixQuery(q)), ready: MifasaBrain.ready,
    confidence: learned ? learned.score : (top ? Number(top.s.toFixed(4)) : 0), margin: Number(gap.toFixed(4)), decision,
    learned: !!learned,
    candidates: scores.map(x => ({ id: x.it.id, label: brainLabel(x.it), score: Number(x.s.toFixed(4)) }))
  };
}


/* ---------------------------------------------------------- */
/* 9f. UNDERSTANDING LAYER (ai_core.json)                      */
/* ---------------------------------------------------------- */
// concepts = words grouped into ideas (SELF, HAVE, PROBLEM, MONEY ...); frames = rules that combine ideas
// ("I" + "have" + "problem" + "money"). It runs ONLY when the normal brain is not sure, never replaces a
// confident brain answer, and CRISIS / ABUSE words send the person to the safety intents.
const MifasaCore = { ready: false, concepts: new Map(), frames: [], safety: {}, yieldPrefixes: [], personal: ["SELF", "HAVE", "NEED", "WANT", "HELP", "SAD", "STRESS"] };
let mifasaCoreRaw = "", mifasaCoreRawFixed = "";   // what the person typed before spelling repair (repair can damage words like "hits"), and its repaired form
const MIFASA_CORE_INFO_RE = /^(what is|what are|what was|who is|who was|who are|define|explain|describe|tell me about|history of|sobanura|mbwira kuri|ni iki|ni nde)\b/;
const MIFASA_CORE_WEAK_SAD = /\b(?:feel|feeling|am|so|very|really|been|ndumva|ndi)\s+(?:\w+\s+)?(?:down|alone|upset|cry)\b/;

function mifasaCoreLoad(data) {
  if (!data || typeof data !== "object" || !data.concepts || !Array.isArray(data.frames)) return false;
  const C = MifasaCore;
  try {
    const norm = x => mifasaNorm(String(x)).replace(/'/g, " ").replace(/\s+/g, " ").trim();
    C.concepts = new Map();
    Object.keys(data.concepts).forEach(name => {
      const words = new Set(), phrases = [];
      (Array.isArray(data.concepts[name]) ? data.concepts[name] : []).forEach(w => {
        const n = norm(w);
        if (!n) return;
        if (n.indexOf(" ") < 0) words.add(n); else phrases.push(" " + n + " ");
      });
      C.concepts.set(name, { words, phrases });
    });
    const list = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
    C.frames = data.frames.filter(f => f && typeof f === "object" && f.id && (list(f.all).length || list(f.any).length)).map((f, i) => ({
      id: String(f.id), lead: !!f.lead, priority: Number.isFinite(f.priority) ? f.priority : 1, order: i,
      all: list(f.all), any: list(f.any), none: list(f.none),
      text_rw: f.text_rw || "", text_en: f.text_en || "", also_rw: f.also_rw || "", also_en: f.also_en || "",
      buttons: Array.isArray(f.buttons) ? f.buttons.filter(b => b && (b.label_en || b.label_rw)) : [],
      search: typeof f.search === "string" ? f.search : ""
    }));
    C.safety = data.safety && typeof data.safety === "object" ? data.safety : {};
    C.yieldPrefixes = list(data.yield_prefixes);
    if (Array.isArray(data.personal) && data.personal.length) C.personal = list(data.personal);
    C.ready = C.frames.length > 0;
    console.log(`🧩 MIFASA core: ${C.concepts.size} concepts, ${C.frames.length} frames`);
  } catch (e) { console.warn("MIFASA core could not be read", e); C.ready = false; return false; }
  return true;
}

// which ideas appear in the text? (typed text AND spelling-repaired text, so one cannot hide the other)
function mifasaCoreConcepts(...texts) {
  const found = new Set();
  texts.filter(Boolean).forEach(t => {
    const n = mifasaNorm(t).replace(/'/g, " ").replace(/\s+/g, " ").trim();
    if (!n) return;
    const pad = " " + n + " ", toks = new Set(n.split(" "));
    const weakSadOk = MIFASA_CORE_WEAK_SAD.test(n);
    MifasaCore.concepts.forEach((c, name) => {
      if (found.has(name)) return;
      let hit = false;
      for (const w of toks) {
        if (!c.words.has(w) && !(w.length > 3 && w.endsWith("s") && c.words.has(w.slice(0, -1)))) continue;   // problems = problem
        if (name === "SAD" && (w === "down" || w === "alone" || w === "upset" || w === "cry") && !weakSadOk) continue;   // "shut down", "leave it alone"
        hit = true; break;
      }
      if (!hit) hit = c.phrases.some(p => pad.indexOf(p) > -1);
      if (hit) found.add(name);
    });
  });
  return found;
}

function mifasaCoreYields(intentId) { return MifasaCore.yieldPrefixes.some(p => String(intentId).indexOf(p) === 0); }

function mifasaCoreMatch(rawQuery) {
  const C = MifasaCore;
  if (!C.ready) return null;
  const typed = mifasaCoreRaw && mifasaCoreRaw.length < 600 && mifasaCoreRawFixed === rawQuery ? mifasaCoreRaw : "";   // only for the question it belongs to
  const set = mifasaCoreConcepts(typed, rawQuery);
  if (!set.size) return null;
  // safety first: the right safety intent answers, even when the brain was unsure
  for (const key of ["CRISIS", "ABUSE"]) {
    if (set.has(key) && C.safety[key]) {
      const it = MifasaBrain.intents.find(x => x.id === C.safety[key]);
      if (it) return { kind: "safety", it, concepts: set };
    }
  }
  const feeling = set.has("SAD") || set.has("STRESS");
  if (!C.personal.some(c => set.has(c))) return null;                                    // not about the person: a normal question
  if (!feeling && MIFASA_CORE_INFO_RE.test(mifasaNorm(rawQuery))) return null;            // "what is / explain ..." stays with the search
  const hit = C.frames.filter(f =>
    f.all.every(c => set.has(c)) && (!f.any.length || f.any.some(c => set.has(c))) && !f.none.some(c => set.has(c))
  ).sort((a, b) => (b.lead - a.lead) || (b.priority - a.priority) || (a.order - b.order));
  if (!hit.length) return null;
  return { kind: "frames", frames: hit, concepts: set };
}

function mifasaCoreRespond(rawQuery) {
  const rw = currentLang !== "en";
  let m = null;
  try { m = mifasaCoreMatch(rawQuery); } catch (e) { return null; }      // the layer must never break an answer
  if (!m) return null;
  if (m.kind === "safety") return mifasaBrainAnswerFor(m.it, rawQuery);
  const pick = (f, k) => (rw ? (f[k + "_rw"] || f[k + "_en"]) : (f[k + "_en"] || f[k + "_rw"])) || "";
  const lead = m.frames[0];
  const parts = [pick(lead, "text")];
  m.frames.slice(1, 3).forEach(f => { const t = pick(f, "also"); if (t) parts.push(t); });
  const text = parts.filter(Boolean).join("\n\n");
  if (!text) return null;
  const seen = new Set(), buttons = [];
  m.frames.slice(0, 3).forEach(f => f.buttons.forEach(b => {
    const label = (rw ? (b.label_rw || b.label_en) : (b.label_en || b.label_rw));
    const key = b.intent || b.ask || label;
    if (!label || seen.has(key) || buttons.length >= 6) return;
    seen.add(key);
    buttons.push(b.intent ? { label, intent: b.intent } : { label, ask: b.ask || label });
  }));
  MifasaBrain.lastIntent = "core_" + lead.id;
  return { text, buttons, thenQuery: lead.search || "", sources: [], onlySources: [], core: lead.id };
}

// the built-in knowledge already has ONE clear answer (strong score and well ahead of the next one): answer it instead of asking "Do you mean...?"
function mifasaKnowledgeIsClear(rawQuery) {
  try {
    const s = mifasaSearch(rawQuery, 5), h = (s && s.hits) || [];
    if (!h.length || !h[0].article || !h[0].article._core) return false;
    const a = +h[0].score || 0, b = h[1] ? (+h[1].score || 0) : 0;
    if (a >= 30 || (a >= 15 && a >= b * 1.35)) return true;   // 30+ = a clearly strong match (unrelated questions score under 20)
    // two knowledge entries about the same thing (a core row and a brain fact with the same title words) are not a real doubt
    if (a >= 14 && h[1] && h[1].article._core) {
      const q = new Set(tokenize(rawQuery).filter(t => t.length > 2 && !MIFASA_STOP_WORDS.has(t)));
      const shares = x => tokenize((x.article.title_rw || "") + " " + (x.article.title_en || "")).some(t => q.has(t));
      return shares(h[0]) && shares(h[1]);
    }
    return false;
  } catch (e) { return false; }
}

function mifasaBrainRespond(rawQuery) {
  const learned = mifasaFindLearnedAnswer(rawQuery);
  if (learned) return { text: learned.answer, buttons: [], thenQuery: "", sources: [], onlySources: [], learned: true, confidence: learned.score };
  let m = mifasaBrainMatch(rawQuery);
  if (!m || m.kind !== "answer") {
    const alt = mifasaBridgeEn(rawQuery);
    if (alt) {
      const m2 = mifasaBrainMatch(alt);
      if (m2 && m2.kind === "answer" && (!m || (m2.score || 0) > (m.score || 0))) { m = m2; rawQuery = alt; }
    }
  }
  // the brain is not sure: let the understanding layer (ai_core.json) try before the normal search
  // (a bare topic overview, topic_*, also gives way: "I have a problem with my health" is not "tell me about health")
  if (!m || m.kind !== "answer" || mifasaCoreYields(m.it.id)) {
    const core = mifasaCoreRespond(rawQuery);
    if (core) return core;
  }
  if (!m) return null;
  const rw = currentLang !== "en";
  const vars = brainVars(rawQuery);
  const cfg = MifasaBrain.cfg;

  if ((m.kind === "clarify" || m.kind === "confirm") && mifasaKnowledgeIsClear(rawQuery)) return null;

  if (m.kind === "clarify") {
    return {
      text: brainFill(rw ? cfg.clarify_rw : cfg.clarify_en, vars),
      buttons: m.options.map(it => ({ label: brainLabel(it), intent: it.id })),
      thenQuery: "", sources: [], onlySources: []
    };
  }

  if (m.kind === "confirm") {
    return {
      text: brainFill((rw ? cfg.confirm_rw : cfg.confirm_en).replace("{label}", brainLabel(m.it)), vars),
      buttons: [{ label: rw ? cfg.yes_rw : cfg.yes_en, intent: m.it.id }],
      thenQuery: "", sources: [], onlySources: []
    };
  }

  return mifasaBrainAnswerFor(m.it, rawQuery);
}

// the answer of one intent (used by the brain and by the understanding layer's safety routes)
function mifasaBrainAnswerFor(it, rawQuery) {
  const rw = currentLang !== "en";
  const vars = brainVars(rawQuery);
  MifasaBrain.lastIntent = it.id;
  const list = (rw ? it.answer_rw : it.answer_en).length ? (rw ? it.answer_rw : it.answer_en) : (rw ? it.answer_en : it.answer_rw);
  const text = list.length ? brainFill(pickVariant("brain_" + it.id + (rw ? "_rw" : "_en"), list), vars) : "";
  const follow = (rw ? it.followRw : it.followEn).length ? (rw ? it.followRw : it.followEn) : (rw ? it.followEn : it.followRw);
  return {
    text,
    buttons: follow.map(f => ({ label: brainFill(f, vars), ask: brainFill(f, vars) })),
    thenQuery: brainThenQuery(it, rawQuery),
    sources: it.sources,
    onlySources: it.onlySources
  };
}

function mifasaBrainFallback(topic, corrected) {
  const B = MifasaBrain;
  if (!B.ready || !B.fallback) return null;
  const rw = currentLang !== "en";
  const list = (rw ? B.fallback.rw : B.fallback.en).length ? (rw ? B.fallback.rw : B.fallback.en) : (rw ? B.fallback.en : B.fallback.rw);
  if (!list.length) return null;
  const vars = brainVars(topic);
  vars.topic = topic;
  vars.didyoumean = corrected ? (rw ? `\n🔎 Ese washakaga kuvuga **"${corrected}"**?` : `\n🔎 Did you mean **"${corrected}"**?`) : "";
  const text = "🤖 **MIFASA AI**: " + brainFill(pickVariant("brain_fallback" + (rw ? "_rw" : "_en"), list), vars);
  return { type: "knowledge_fallback", text_rw: text, text_en: text };
}

// "reading the best sources first": the intent can prefer (sources) or require (only_sources) some files
function mifasaBrainApplySources(search, b) {
  if (!search || !search.hits || !search.hits.length || !b) return search;
  const base = h => getFileBaseName(h.article._sourceFile).toLowerCase();
  if (b.onlySources && b.onlySources.length) {
    const only = search.hits.filter(h => b.onlySources.includes(base(h)));
    if (only.length) return { ...search, hits: only };
  }
  if (b.sources && b.sources.length) {
    const hits = search.hits.map(h => (b.sources.includes(base(h)) ? { ...h, score: h.score * 1.3 } : h));
    hits.sort((x, y) => y.score - x.score);
    return { ...search, hits };
  }
  return search;
}

function mifasaBrainButtons(buttons) {
  if (!buttons || !buttons.length) return "";
  const style = "display:inline-block;margin:4px 6px 0 0;padding:6px 12px;border:1px solid #007bff;background:#fff;color:#007bff;border-radius:16px;cursor:pointer;font-size:.9em;";
  return `<div style="margin-top:10px;white-space:normal;">` + buttons.map(b => {
    const attr = b.intent ? `data-brain-intent="${escapeHTML(b.intent)}"` : `data-brain-ask="${escapeHTML(b.ask || b.label)}"`;
    return `<button type="button" ${attr} style="${style}">${escapeHTML(b.label)}</button>`;
  }).join("") + `</div>`;
}

// one delegated listener for the option buttons
if (results && !results.dataset.brainBound) {
  results.dataset.brainBound = "1";
  results.addEventListener("click", e => {
    const el = e.target.closest && e.target.closest("[data-brain-ask],[data-brain-intent]");
    if (!el) return;
    const id = el.getAttribute("data-brain-intent");
    const ask = el.getAttribute("data-brain-ask");
    if (id) MifasaBrain.forceId = id;
    if (ask && input) input.value = ask;
    doSearch();
  });
}

// developer helper: open the browser console and type  mifasaBrainTest("ibyo wabajije")
// to see which intents the brain thinks of, and what it decides
if (typeof window !== "undefined") {
  window.mifasaBrainTest = function (q) {
    const all = brainScoreAll(q);
    console.table(all.slice(0, 6).map(x => ({ intent: x.it.id, score: +x.s.toFixed(3) })));
    const prev = MifasaBrain.forceId; MifasaBrain.forceId = "";
    const m = mifasaBrainMatch(q);
    MifasaBrain.forceId = prev;
    const out = m ? { decision: m.kind, intent: m.it ? m.it.id : (m.options || []).map(o => o.id) } : { decision: "normal search" };
    console.log(out);
    return out;
  };
}

/* ---------------------------------------------------------- */
/* 10. SMART SEARCH + HISTORY                                */
/* ---------------------------------------------------------- */

if (input) {
  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { doSearch(); }, 90);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim() === "") showSearchHistory();
  });
}

function getSearchHistory() {
  const visitorID = localStorage.getItem("mifasa_visitor_id") || "";
  try {
    return JSON.parse(localStorage.getItem("search_history_" + visitorID) || "[]");
  } catch (e) {
    return [];
  }
}

function saveSearchHistory(term) {
  if (!term || term.trim().length < 2) return;
  const visitorID = localStorage.getItem("mifasa_visitor_id") || "";
  let history = getSearchHistory().filter(t => t.toLowerCase() !== term.toLowerCase());
  history.unshift(term);
  history = history.slice(0, 8);
  try {
    localStorage.setItem("search_history_" + visitorID, JSON.stringify(history));
  } catch (e) {}
}

function showSearchHistory() {
  const history = getSearchHistory();
  if (!suggestions) return;
  if (history.length === 0) {
    suggestions.innerHTML = "";
    return;
  }

  suggestions.innerHTML =
    `<div style="padding:8px;font-weight:bold;font-size:12px;border-bottom:1px solid #ccc;">` +
    `${currentLang === "en" ? "Recent searches" : "Ibyo washatse vuba"}` +
    `</div>` +
    history.map(term => {
      const safe = escapeHTML(term);
      return `<div class="suggestion-item" style="padding:6px 12px;cursor:pointer;" data-search-term="${safe}">🔍 ${safe}</div>`;
    }).join("");

  suggestions.querySelectorAll("[data-search-term]").forEach(el => {
    el.addEventListener("click", () => { fillSearch(el.getAttribute("data-search-term") || ""); });
  });
}

function fillSearch(term) {
  if (input) {
    input.value = term;
    doSearch();
  }
}

function renderSuggestions(scoredMatches) {
  if (!suggestions) return;
  if (scoredMatches.length === 0) {
    suggestions.innerHTML = "";
    return;
  }

  suggestions.innerHTML = scoredMatches.slice(0, 5).map(s => {
    const title = escapeHTML(getTitle(s.article));
    return `<div class="suggestion-item" style="padding:6px 12px;cursor:pointer;" data-search-term="${title}">🔍 ${title}</div>`;
  }).join("");

  suggestions.querySelectorAll("[data-search-term]").forEach(el => {
    el.addEventListener("click", () => { fillSearch(el.getAttribute("data-search-term") || ""); });
  });
}

function renderAIText(text) {
  // safe: escape first, then turn [label](https://link) into a real link, **bold** into <strong>, *italic* into <em>.
  // Only http(s) links are linked; the href can never contain a raw quote or "<" because everything was escaped first.
  return escapeHTML(text)
    .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)"<>*]+)\)/g,
      (m, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

const MIFASA_AI_BOX_STYLE = "background:#eef9ff;border-left:4px solid #007bff;padding:14px;margin:12px 0;border-radius:6px;font-family:sans-serif;white-space:pre-line;line-height:1.5;";

// one delegated listener instead of re-attaching a handler to every button on every render
if (results && !results.dataset.audioBound) {
  results.dataset.audioBound = "1";
  results.addEventListener("click", e => {
    const btn = e.target.closest && e.target.closest("[data-audio-id]");
    if (btn) toggleAudio(btn.getAttribute("data-audio-id"));
  });
}

function doSearchCore() {
  let value = input ? input.value.trim() : "";
  value = value.slice(0, mifasaExtractUrl(value) ? 2000 : 300);   // long pasted text must not freeze the page

  if (suggestions) suggestions.innerHTML = "";
  if (results) results.innerHTML = "";
  if (noResultsMsg) noResultsMsg.innerHTML = "";
  try { mifasaMediaAugment(value); } catch (e) { /* free web sources are optional */ }

  if (value.length < 2) {
    if (noResultsMsg) {
      noResultsMsg.innerText = currentLang === "en" ? "Type to search..." : "Andika ushake...";
    }
    if (value.length === 0) showSearchHistory();
    return;
  }

  // LINK READER: when a user pastes a public URL into the normal MIFASARW search/chat,
  // read it first and show the AI's analysis in the same result area.
  // No API key or external model is used. If a site blocks direct browser reading (CORS), a free public reader is tried.
  if (mifasaExtractUrl(value)) {
    if (results) results.innerHTML = `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(currentLang === "en" ? "🔗 **MIFASA AI**\n\nReading the link and analyzing its text…" : "🔗 **MIFASA AI**\n\nNdimo gusoma link no gusesengura inyandiko yayo…")}</div>`;
    if (noResultsMsg) noResultsMsg.innerText = "";
    mifasaAskWithLink(value, 40).then(answer => {
      if (results) results.innerHTML = answer && answer.html ? answer.html : `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(currentLang === "en" ? "I couldn't analyze that link." : "Sinabashije gusesengura iyo link.")}</div>`;
      if (typeof attachCardAudioHandlers === "function") attachCardAudioHandlers();
    }).catch(err => {
      const msg = err && err.message ? err.message : (currentLang === "en" ? "Link reading failed." : "Gusoma link byanze.");
      if (results) results.innerHTML = `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText("🤖 **MIFASA AI**\n\n" + msg)}</div>`;
    });
    return;
  }

  // MIFASA BRAIN (ai.json): understand the question first.
  // Sure -> answer. Unsure between two things -> ask back with buttons. Otherwise -> normal search over ALL files.
  mifasaSpellFixes = [];
  mifasaCoreRaw = value;
  value = brainFixQuery(value);
  mifasaCoreRawFixed = value;
  mifasaHarvestUnknown(value);
  let brainBoxHtml = "";
  let brainPlan = null;
  if (!(MIFASA_FOLLOWUP_RE.test(mifasaNorm(value)) && mifasaConv.query) && !mifasaPrecise(value)) {
    const brain = mifasaBrainRespond(value);
    if (brain) {
      if (brain.text) {
        const contextualButtons = mifasaRelevantFollowups(value, brain.buttons);
        brainBoxHtml = `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText("🤖 **MIFASA AI**\n\n" + brain.text)}${mifasaBrainButtons(contextualButtons)}</div>`;
      }
      if (brain.thenQuery) {            // answer, then also look through all the files
        brainPlan = brain;
        value = brain.thenQuery;
      } else if (brainBoxHtml) {
        if (results) results.innerHTML = brainBoxHtml;
        return;
      }
    }
  }

  // data still downloading on a first visit: say so, and doSearch re-runs when ready
  // (built-in knowledge, small talk, maths and the clock work immediately, no download needed)
  if (!mifasaLoaded && !detectGreeting(value) && !tryCalculate(value) && !tryDateTime(value) && !mifasaPrecise(value)) {
    const early = mifasaSearch(value, 3);
    if (!early.hits.length) {
      if (noResultsMsg) {
        noResultsMsg.innerText = currentLang === "en" ? "Getting my knowledge ready..." : "Ndimo gutegura ubumenyi bwanjye...";
      }
      if (brainBoxHtml && results) results.innerHTML = brainBoxHtml;
      return;
    }
  }

  // "Muraho, mbwira kuri politiki": short hello, then answer the real question
  let helloPrefix = null;
  const g0 = detectGreeting(value);
  if (g0 && g0.id === "hello" && g0.rest) {
    const nm = getMifasaUserName();
    const tod = getTimeOfDay();
    helloPrefix = {
      rw: `${tod === "morning" ? "Mwaramutse" : "Muraho"}${nm ? " " + nm : ""}! 👋`,
      en: `${tod === "morning" ? "Good morning" : "Hi"}${nm ? ", " + nm : ""}! 👋`
    };
    value = g0.rest;
  }

  // Small talk first: greet like a person, don't dump search results
  const greeting = helloPrefix ? null : getMifasaGreeting(value);
  if (greeting && results) {
    const gText = currentLang === "en" ? greeting.text_en : greeting.text_rw;
    const contextButtons = mifasaRelevantFollowups(value, []);
    results.innerHTML = `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(gText)}${mifasaBrainButtons(contextButtons)}</div>`;
    return;
  }

  // calculator / date & time / compare
  const tool = mifasaSmartTool(value);
  if (tool && results) {
    const tText = currentLang === "en" ? tool.text_en : tool.text_rw;
    results.innerHTML = `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(tText)}${mifasaBrainButtons(mifasaRelevantFollowups(value, []))}</div>`;
    return;
  }

  // "ibindi" / "more": continue the previous topic instead of searching for the word itself
  if (MIFASA_FOLLOWUP_RE.test(mifasaNorm(value)) && mifasaConv.query) {
    mifasaConv.offset += 3;
    value = mifasaConv.query;
  } else {
    mifasaConv = { query: value, offset: 0 };
  }

  const latestInfo = splitLatestIntent(value);
  let search = latestInfo ? mifasaLatestSearch(latestInfo, 40) : mifasaSearch(value, 40);
  if (brainPlan) search = mifasaBrainApplySources(search, brainPlan);
  const scoredMatches = search.hits.filter(h => !h.article._core).map(h => ({ article: h.article, score: h.score }));

  renderSuggestions(scoredMatches);

  let html = brainBoxHtml;

  const aiInsight = askMifasaAI(value, search);
  if (aiInsight) {
    let aiText = currentLang === "en" ? aiInsight.text_en : aiInsight.text_rw;
    if (helloPrefix) {
      const pre = currentLang === "en" ? helloPrefix.en : helloPrefix.rw;
      aiText = aiText.replace(/^(🤖 \*\*MIFASA AI\*\*:?\s*)/, (m0, g1) => g1 + pre + "\n\n");
    }
    html += `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(aiText)}</div>`;
  }

  if (scoredMatches.length === 0) {
    if (results) results.innerHTML = html;
    if (search.hits.length === 0 && aiInsight && aiInsight.type === "knowledge_fallback") mifasaWebAugment(value, html);
    if (search.hits.length > 0) {            // answered from what the AI knows by itself
      if (mifasaConv.offset === 0) saveSearchHistory(value);
      return;
    }
    mifasaLogMiss(value);
    if (noResultsMsg) {
      noResultsMsg.innerText = currentLang === "en" ? `No results for "${value}".` : `Nta bisubizo bya "${value}".`;
    }
    return;
  }

  if (mifasaConv.offset === 0) saveSearchHistory(value);
  if (!results) return;

  const parts = [];
  for (let i = 0; i < Math.min(15, scoredMatches.length); i++) {
    const a = scoredMatches[i].article;
    const isExternal = false;                                  // always open inside story.html
    const targetUrl = mifasaStoryHref(a);

    parts.push(`
      <div class="search-item" style="display:flex;gap:10px;padding:8px;border-bottom:1px solid #eee;">
        <img src="${escapeHTML(a.image)}" alt="${escapeHTML(getTitle(a))}" loading="lazy" style="width:50px;height:50px;object-fit:cover;border-radius:4px;">
        <div>
          <h4>
            <a href="${escapeHTML(safeHref(targetUrl))}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ""}>
              ${escapeHTML(getTitle(a))}
            </a>
          </h4>
          <p>${escapeHTML(getSummary(a).substring(0, 120))}...</p>
          <small>
            <button type="button" data-audio-id="${escapeHTML(a.share_id)}">
              🔊 ${currentLang === "en" ? "Listen" : "Umva"}
            </button>
          </small>
        </div>
      </div>`);
  }

  results.innerHTML = html + parts.join("");   // ONE DOM write (was one per result)
}

// Answer in the language the person just wrote in (even if the site is set to the other one)
function doSearch() {
  const detected = detectQueryLang(input ? input.value : "");
  if (detected && detected !== currentLang) {
    const keep = currentLang;
    currentLang = detected;
    try { doSearchCore(); } finally { currentLang = keep; }
  } else {
    doSearchCore();
  }
}

/* ---------------------------------------------------------- */
/* 11. DISPLAY ENGINE + INFINITE SCROLL                      */
/* ---------------------------------------------------------- */

/* The home page lists only OUR news. Crawled news (crawl-news.json, flagged _external) and Wikipedia entries (crawl-knowledge.json, flagged _knowledge) stay in allNews for the AI
   and is shown in its own box by parts/265-crawl-box.js. */
let mifasaHomeSrc = null, mifasaHomeList = [];
/* Crawled news (crawl-news.json) is part of the regular home news. To go back to the old separate box set  window.MIFASA_CRAWL_IN_HOME = false  before script.js. */
function mifasaCrawlInHome() { return !(typeof window !== "undefined" && window.MIFASA_CRAWL_IN_HOME === false); }
function mifasaHomeNews() {
  if (mifasaHomeSrc !== allNews) { mifasaHomeSrc = allNews; mifasaHomeList = allNews.filter(a => !(a && (a._knowledge || (a._external && !mifasaCrawlInHome())))); }
  return mifasaHomeList;
}

/* A story that is a video (crawled from a YouTube feed: article.video = { provider:"youtube", id }) shows its picture with a play button;
   a tap swaps it for the official YouTube player (youtube-nocookie embed, no key, no download). */
function mifasaVideoWrap(article, imgHtml) {
  const id = article && article.video && /^[\w-]{11}$/.test(String(article.video.id || "")) ? article.video.id : "";
  if (!id || !imgHtml) return imgHtml;
  return `<div class="mf-vid" data-vid="${id}" role="button" tabindex="0" aria-label="Play video" style="position:relative;cursor:pointer;">${imgHtml}<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:52px;color:#fff;text-shadow:0 2px 14px #000b;pointer-events:none;">▶</span></div>`;
}
function renderCardHTML(article) {
  const isExternal = false;                                    // always open inside story.html
  const newsLink = mifasaStoryHref(article);

  const en0 = currentLang === "en", ext = !!article._external;
  const imgTag = `<img ${ext ? 'data-ext-pic referrerpolicy="no-referrer" ' : ""}src="${escapeHTML(article.image)}" alt="${escapeHTML(getTitle(article))}" loading="lazy" decoding="async" style="width:100%;height:180px;object-fit:cover;">`;
  const pic = mifasaVideoWrap(article, imgTag);
  const credit = ext ? `<small style="opacity:.75;display:block;padding:6px 2px 0">${article.video ? "▶️" : "🌐"} ${escapeHTML(article.source || "")}${article.date ? " · " + escapeHTML(String(article.date).slice(0, 10)) : ""}</small>` : "";
  return `
    <div class="card">
      ${pic}
      ${credit}
      <h3>${escapeHTML(getTitle(article))}</h3>
      <p>${escapeHTML(getSummary(article))}</p>
      <div>
        <a href="${escapeHTML(safeHref(newsLink))}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ""}>
          ${article.video ? (en0 ? "Full story →" : "Inkuru yose →") : (en0 ? "Read →" : "Soma →")}
        </a>
        ${article.video && /^[\w-]{11}$/.test(String(article.video.id || "")) ? `<button type="button" data-play-card="1">▶ ${en0 ? "Watch" : "Reba"}</button>` : ""}
        <button type="button" data-audio-id="${escapeHTML(article.share_id)}">
          🔊 ${currentLang === "en" ? "Listen" : "Umva"}
        </button>
        ${MIFASA_BRAND.addSharing ? `<button type="button" data-share-id="${escapeHTML(article.share_id)}">📤 ${currentLang === "en" ? "Share" : "Sangiza"}</button>` : ""}
      </div>
    </div>`;
}

function attachCardAudioHandlers(container) {
  if (!container) return;
  if (typeof mifasaDropBrokenPics === "function") mifasaDropBrokenPics(container);
  container.querySelectorAll("[data-audio-id]").forEach(btn => {
    btn.addEventListener("click", () => { toggleAudio(btn.getAttribute("data-audio-id")); });
  });
  container.querySelectorAll("[data-share-id]").forEach(btn => {
    btn.addEventListener("click", () => { shareArticle(btn.getAttribute("data-share-id")); });
  });
}

function renderNextNewsPage() {
  if (!latestNewsBox) return;
  const nextBatch = mifasaHomeNews().slice(mifasaRenderedCount, mifasaRenderedCount + MIFASA_PAGE_SIZE);
  if (nextBatch.length === 0) return;

  latestNewsBox.innerHTML += nextBatch.map(renderCardHTML).join("");
  mifasaRenderedCount += nextBatch.length;
  attachCardAudioHandlers(latestNewsBox);
}

function loadLatestNews() {
  if (!latestNewsBox) return;
  latestNewsBox.innerHTML = "";
  mifasaRenderedCount = 0;

  renderNextNewsPage();

  if (mifasaScrollObserver) {
    mifasaScrollObserver.disconnect();
    mifasaScrollObserver = null;
  }

  if ("IntersectionObserver" in window) {
    const sentinel = document.createElement("div");
    sentinel.id = "mifasa-scroll-sentinel";
    sentinel.style.height = "1px";
    latestNewsBox.appendChild(sentinel);

    mifasaScrollObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        const before = mifasaRenderedCount;
        renderNextNewsPage();
        if (mifasaRenderedCount === before) {
          mifasaScrollObserver.disconnect();
        } else {
          latestNewsBox.appendChild(sentinel);
        }
      }
    }, { rootMargin: "600px" });

    mifasaScrollObserver.observe(sentinel);
  }
}

let hotNewsTimer = null;
function loadHotNews() {
  if (mifasaHotNews().length === 0 || !hotImage) return;

  if (hotNewsTimer) {
    clearInterval(hotNewsTimer);
    hotNewsTimer = null;
  }

  const update = () => {
    const list = mifasaHotNews();
    if (!list.length) return;
    hotIndex = hotIndex % list.length;
    const news = list[hotIndex];
    if (news) {
      const ext = !!news._external;
      hotImage.onerror = () => { hotImage.onerror = null; hotImage.referrerPolicy = ""; hotImage.src = "default.jpg"; };   // other site's picture gone: use ours
      hotImage.referrerPolicy = ext ? "no-referrer" : "";
      hotImage.src = news.image;
      hotImage.alt = getTitle(news);
      if (hotTitle) hotTitle.innerText = getTitle(news);
      if (hotSummary) hotSummary.innerText = getSummary(news);
      const hotBadge = document.getElementById("hotBadge");
      if (hotBadge) hotBadge.innerText = ext ? "📡 " + (news.source || "") : "";

      const hotReadMore = document.getElementById("hotReadMore");
      if (hotReadMore) {
        hotReadMore.removeAttribute("target");                          // every story (also other sites') opens in story.html
        hotReadMore.removeAttribute("rel");
        hotReadMore.href = mifasaStoryHref(news);
        hotReadMore.innerText = currentLang === "en" ? "Read Full Story →" : "Soma Inkuru Yose →";
      }
    }
    hotIndex = (hotIndex + 1) % list.length;
  };

  update();
  hotNewsTimer = setInterval(update, 5000);
}

let trendingTimer = null;
function extractTrends() {
  trendWords = [];
  const seen = new Set();
  for (let i = 0; i < allNews.length; i++) {
    if (allNews[i] && allNews[i]._knowledge) continue;     // Wikipedia topics are not "trending"
    const title = getTitle(allNews[i]);
    if (!title) continue;
    const toks = tokenize(title);
    for (let k = 0; k < toks.length; k++) {
      const w = toks[k];
      if (w.length > 4 && !MIFASA_STOP_WORDS.has(w) && !seen.has(w)) {
        seen.add(w);
        trendWords.push(w);
      }
    }
  }
}

function startTrending() {
  extractTrends();

  if (trendingTimer) {
    clearInterval(trendingTimer);
    trendingTimer = null;
  }

  if (!trendBox || trendWords.length === 0) return;

  const update = () => {
    const word = trendWords[trendIndex];
    if (!word) return;

    trendBox.innerHTML = `<span data-trend-word="${escapeHTML(word)}">#${escapeHTML(word)}</span>`;
    const trendEl = trendBox.querySelector("[data-trend-word]");
    if (trendEl) {
      trendEl.addEventListener("click", () => fillSearch(word));
    }
    trendIndex = (trendIndex + 1) % trendWords.length;
  };

  update();
  trendingTimer = setInterval(update, 3000);
}

let tickerAnimationId = null;
function loadTicker() {
  if (!tickerContent) return;

  if (tickerAnimationId) {
    cancelAnimationFrame(tickerAnimationId);
    tickerAnimationId = null;
  }

  tickerContent.innerHTML = mifasaTickerNews().map(mifasaTickerItemHTML).join("");
  mifasaDropBrokenPics(tickerContent);
  let pos = 0;

  function animate() {
    if (!tickerContent.isConnected) return;
    pos -= 0.4;
    const limit = Math.max(tickerContent.scrollWidth / 2, 1);
    if (Math.abs(pos) >= limit) pos = 0;
    tickerContent.style.transform = `translate3d(${pos}px,0,0)`;
    tickerAnimationId = requestAnimationFrame(animate);
  }

  animate();
}

let dailyNewsTimer = null;
function loadDailyNews() {
  if (!newsText || mifasaTickerNews().length === 0) return;

  if (dailyNewsTimer) {
    clearInterval(dailyNewsTimer);
    dailyNewsTimer = null;
  }

  const update = () => {
    const list = mifasaTickerNews();                 // our news + the newest stories from other sites (shown with their source)
    if (!list.length) return;
    newsIndex = newsIndex % list.length;
    const n = list[newsIndex];
    if (n) newsText.innerHTML = n._external ? `📰 <b>${escapeHTML(n.source || "")}</b>: ${escapeHTML(getTitle(n))}` : `📰 ${escapeHTML(getTitle(n))}`;
    newsIndex = (newsIndex + 1) % list.length;
  };

  update();
  dailyNewsTimer = setInterval(update, 4000);
}

/* ---------------------------------------------------------- */
/* 12. INITIALIZATION                                         */
/* ---------------------------------------------------------- */

if (!MIFASA_API_ONLY) document.addEventListener("DOMContentLoaded", function () {
  let visitorID = localStorage.getItem("mifasa_visitor_id") || Math.random().toString(36).substr(2, 9);
  localStorage.setItem("mifasa_visitor_id", visitorID);

  const themeSelect = document.getElementById("themeSelect");
  const langSelect = document.getElementById("langSelect");
  const sizeSelect = document.getElementById("sizeSelect");
  const darkModeToggle = document.getElementById("darkModeToggle");

  // mifasa-look.js (loaded before this script) already handles theme, page width and dark mode: then we skip our own copy
  const lookExternal = !!window.MIFASA_LOOK;

  const savedTheme = localStorage.getItem("theme_" + visitorID) || "mifasastyle";
  const savedSize = localStorage.getItem("size_" + visitorID) || "normal";
  const savedDarkMode = localStorage.getItem("darkmode_" + visitorID) === "on";

  const urlLang = getQueryParam("lang");
  if (urlLang === "rw" || urlLang === "en") {
    currentLang = urlLang;
    localStorage.setItem("siteLang", currentLang);
  }

  if (!lookExternal) {
    if (themeSelect) {
      themeSelect.value = savedTheme;
      changeTheme(savedTheme);
      themeSelect.addEventListener("change", function () {
        localStorage.setItem("theme_" + visitorID, themeSelect.value);
        changeTheme(themeSelect.value);
      });
    } else {
      changeTheme(savedTheme);
    }
  }

  if (langSelect) {
    langSelect.value = currentLang;
    setLanguage(currentLang, false);
    langSelect.addEventListener("change", function () {
      localStorage.setItem("lang_" + visitorID, langSelect.value);
      setLanguage(langSelect.value, true);
    });
  }

  if (!lookExternal) {
    function applySize(sizeValue) {
      const validSizes = ["normal", "full", "narrow"];
      if (!validSizes.includes(sizeValue)) sizeValue = "normal";
      document.body.classList.remove("size-normal", "size-full", "size-narrow");
      document.body.classList.add("size-" + sizeValue);
    }

    if (sizeSelect) {
      sizeSelect.value = savedSize;
      applySize(savedSize);
      sizeSelect.addEventListener("change", function () {
        localStorage.setItem("size_" + visitorID, sizeSelect.value);
        applySize(sizeSelect.value);
      });
    } else {
      applySize(savedSize);
    }
  }

  if (!lookExternal) {
    function applyDarkMode(isOn) {
      if (isOn) {
        document.body.classList.add("dark-mode");
      } else {
        document.body.classList.remove("dark-mode");
      }

      if (darkModeToggle) {
        darkModeToggle.innerText = isOn
          ? (currentLang === "en" ? "☀ Light" : "☀ Umucyo")
          : (currentLang === "en" ? "🌙 Dark" : "🌙 Umwijima");
      }
    }

    if (darkModeToggle) {
      applyDarkMode(savedDarkMode);
      darkModeToggle.addEventListener("click", function () {
        const isOn = !document.body.classList.contains("dark-mode");
        localStorage.setItem("darkmode_" + visitorID, isOn ? "on" : "off");
        applyDarkMode(isOn);
      });
    } else {
      applyDarkMode(savedDarkMode);
    }
  }

  document.addEventListener("click", function (event) {
    if (input && suggestions && !input.contains(event.target) && !suggestions.contains(event.target)) {
      suggestions.innerHTML = "";
    }
  });

  const urlSearchQuery = getQueryParam("search") || getQueryParam("q") || getQueryParam("index");
  if (urlSearchQuery && input) {
    try {
      input.value = decodeURIComponent(urlSearchQuery);
    } catch (e) {
      input.value = urlSearchQuery;
    }
    setTimeout(() => { doSearch(); }, 600);
  }

  loadSearchData();
});

/* ---------------------------------------------------------- */
/* 13. PUBLIC API: window.MifasaAI                             */
/*     search.html na story.html bayikoresha (nta DOM ikoraho) */
/* ---------------------------------------------------------- */

const mifasaWaiters = [];
const mifasaUpdateCbs = [];

function mifasaNotify(releaseAll) {
  // onUpdate listeners: data changed
  if (mifasaLoaded) mifasaUpdateCbs.slice().forEach(cb => { try { cb(); } catch (e) { console.warn("MifasaAI onUpdate", e); } });
  // whenReady waiters: ready (or released because loading finished)
  if (mifasaLoaded || releaseAll) {
    mifasaWaiters.splice(0).forEach(w => { clearTimeout(w.t); try { w.cb(); } catch (e) { console.warn("MifasaAI whenReady", e); } });
  }
}

function mifasaAnswerBox(text, buttonsHtml) {
  return `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(mifasaSpellNote() + text)}${buttonsHtml || ""}</div>`;
}

// Same brain -> greeting -> tools -> search -> answer pipeline as the home page, but returns data instead of touching the DOM.
// returns { items:[articles], corrected:"", html:"<div>…</div>" }
function mifasaAskCore(rawQuery, limit) {
  const out = { items: [], corrected: "", html: "" };
  let value = String(rawQuery == null ? "" : rawQuery).trim().slice(0, 400);
  value = brainEmojiExpand(value).trim();   // a lone emoji is a one-character message
  if (value.length < 2) return out;
  limit = limit || 40;

  mifasaSpellFixes = [];
  mifasaCoreRaw = value;
  value = brainFixQuery(value);
  mifasaCoreRawFixed = value;
  mifasaHarvestUnknown(value);
  const typedValue = value;
  if (!MIFASA_FOLLOWUP_RE.test(mifasaNorm(value))) value = mifasaResolveFollowUp(value);   // "and Uganda?" -> "capital of Uganda"
  const resolvedNow = value !== typedValue;
  const keepTopic = resolvedNow && !mifasaTopicSwap;      // "how tall is it?" keeps the topic; "and Uganda?" replaces it
  let brainHtml = "";
  let brainPlan = null;
  if (!(MIFASA_FOLLOWUP_RE.test(mifasaNorm(value)) && mifasaConv.query) && !mifasaPrecise(value)) {
    const brain = mifasaBrainRespond(value);
    if (brain) {
      if (brain.text) brainHtml = mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + brain.text, mifasaBrainButtons(brain.buttons));
      if (brain.thenQuery) { brainPlan = brain; value = brain.thenQuery; }
      else if (brainHtml) {
        // remember what the answer was about (not for small talk, safety or site help)
        if (!keepTopic && !/^(smalltalk|greeting|thanks|goodbye|good_night|ai_|crisis|emergency|gbv|not_understood|clarify|suggest|site_|time_now|date_today|practice_|trending|symptoms)/.test(MifasaBrain.lastIntent || "")) mifasaTopicQ = value;
        out.html = brainHtml; return out;
      }
    }
  }

  let helloPrefix = null;
  const g0 = detectGreeting(value);
  if (g0 && g0.id === "hello" && g0.rest) {
    const nm = getMifasaUserName();
    const tod = getTimeOfDay();
    helloPrefix = {
      rw: `${tod === "morning" ? "Mwaramutse" : "Muraho"}${nm ? " " + nm : ""}! 👋`,
      en: `${tod === "morning" ? "Good morning" : "Hi"}${nm ? ", " + nm : ""}! 👋`
    };
    value = g0.rest;
  }

  const greeting = helloPrefix ? null : getMifasaGreeting(value);
  if (greeting) { out.html = mifasaAnswerBox(currentLang === "en" ? greeting.text_en : greeting.text_rw); return out; }

  const tool = mifasaSmartTool(value);
  if (tool) { out.html = mifasaAnswerBox(currentLang === "en" ? tool.text_en : tool.text_rw); return out; }

  value = mifasaResolveFollowUp(value);   // "Ese yavukiye he?" -> adds the topic of the last question
  if (MIFASA_FOLLOWUP_RE.test(mifasaNorm(value)) && mifasaConv.query) {
    mifasaConv.offset += 3;
    value = mifasaConv.query;
  } else {
    mifasaConv = { query: value, offset: 0 };
  }

  const latestInfo = splitLatestIntent(value);
  let search = latestInfo ? mifasaLatestSearch(latestInfo, limit) : mifasaSearch(value, limit);
  if (brainPlan) search = mifasaBrainApplySources(search, brainPlan);

  out.items = search.hits.filter(h => !h.article._core).map(h => h.article);
  out.corrected = search.corrected || "";
  out._viaSearch = !latestInfo; out._cov = search.topCoverage; out._nEff = search.nEff;   // used by the free-AI fallback

  let html = brainHtml;
  const insight = askMifasaAI(value, search);
  if (insight) {
    let t = currentLang === "en" ? insight.text_en : insight.text_rw;
    if (helloPrefix) {
      const pre = currentLang === "en" ? helloPrefix.en : helloPrefix.rw;
      t = t.replace(/^(🤖 \*\*MIFASA AI\*\*:?\s*)/, (m0, g1) => g1 + pre + "\n\n");
    }
    html += mifasaAnswerBox(t);
  }
  if (!out.items.length && (!insight || insight.type === "knowledge_fallback")) mifasaLogMiss(value);
  else if (!keepTopic) mifasaTopicQ = value;
  out.html = html;
  return out;
}

// answers in the language the person wrote in (like doSearch on the home page)
function mifasaAskApi(rawQuery, limit) {
  const detected = detectQueryLang(rawQuery || "");
  if (detected && detected !== currentLang) {
    const keep = currentLang;
    currentLang = detected;
    try { return mifasaAskCore(rawQuery, limit); } finally { currentLang = keep; }
  }
  return mifasaAskCore(rawQuery, limit);
}

const MifasaAI = {
  version: 7,
  ready: () => !!mifasaLoaded,
  all: () => allNews.filter(a => !a._core),
  whenReady(cb, timeoutMs) {
    if (typeof cb !== "function") return;
    if (mifasaLoaded) { setTimeout(cb, 0); return; }
    const w = { cb, t: 0 };
    // never wait forever: after the timeout the page gets called anyway and can fall back to its own loader
    w.t = setTimeout(() => {
      const k = mifasaWaiters.indexOf(w);
      if (k >= 0) { mifasaWaiters.splice(k, 1); try { cb(); } catch (e) {} }
    }, timeoutMs || 12000);
    mifasaWaiters.push(w);
  },
  onUpdate(cb) { if (typeof cb === "function") mifasaUpdateCbs.push(cb); },
  ask: mifasaAskApi,
  // chat widget: a tapped option button forces that intent for the next question, whatever the button label says
  forceIntent(id) { MifasaBrain.forceId = String(id || ""); },
  search(query, limit) {
    limit = limit || 12;
    if (!mifasaLoaded || !query || String(query).trim().length < 2) return [];
    const r = mifasaSearch(String(query), limit + 6);
    return r.hits.filter(h => !h.article._core).map(h => h.article).slice(0, limit);
  },
  forceIntent(id) { if (id) MifasaBrain.forceId = String(id); },
  brainReady: () => !!MifasaBrain.ready,
  analyze: mifasaBrainAnalyze,
  analyzeQuestion: mifasaAnalyzeQuestion,
  relevantFollowups: mifasaRelevantFollowups,
  // Teaching is explicit and local to this browser; nothing is sent to a server.
  teach: mifasaTeach,
  feedback: mifasaRateLearning,
  learning: () => mifasaLearningExport(),
  clearLearning: mifasaLearningClear,
  downloadLearning() {
    const blob = new Blob([JSON.stringify(mifasaLearningExport(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "mifasa-learning.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  capabilities: () => ({ externalAI: false, externalAPIRequired: false, localLearning: true, reasoning: true, knowledgeSearch: true, persistentMemory: typeof localStorage !== "undefined", maxLearnedEntries: MIFASA_LEARNING_LIMIT }),
  // questions this browser asked that the AI could not answer (never sent anywhere)
  unanswered: mifasaGetMisses,
  clearUnanswered() { try { localStorage.removeItem(MIFASA_MISS_KEY); } catch (e) {} },
  downloadUnanswered() {
    const blob = new Blob([JSON.stringify(mifasaGetMisses(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "mifasa-unanswered.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
};

/* ---------------------------------------------------------- */
/* 13b. MIFASA LINK READER — browser-only, no external model  */
/* Reads public URLs when the destination allows browser CORS. */
/* ---------------------------------------------------------- */
const MIFASA_LINK_READER = {
  timeoutMs: 10000,
  maxChars: 45000,
  maxPages: 5,
  pages: [],
  // When a site blocks direct browser reading (CORS), these free public readers (no API key) are tried.
  // The link is then sent to that service, and the answer says so. Set to false to read directly only.
  useReaders: true,
  readers: ["jina", "allorigins"]
};

// finds a link in what the person typed: "https://x.org/a", "www.x.org", or "bbc.com/news" -> { raw, url }
function mifasaExtractUrl(text) {
  const s = String(text || "");
  let m = s.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return { raw: m[0], url: m[0].replace(/[),.!?;:]+$/, "") };
  m = s.match(/(?:^|\s)((?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|co|rw|ke|ug|tz|cd|bi|info|news|africa|app|dev|ai|me|tv|int)(?:\/[^\s<>"']*)?)(?=$|[\s,;!?])/i);
  if (m) return { raw: m[1], url: "https://" + m[1].replace(/[),.!?;:]+$/, "") };
  return null;
}

// true for localhost, private/reserved IPv4 + IPv6 ranges, and single-label (intranet) hostnames
function mifasaIsPrivateHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
      h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (h.includes(":")) {                                   // IPv6
    if (h === "::" || h === "::1") return true;
    if (/^::ffff:/.test(h)) return true;                   // IPv4-mapped: refuse, can hide 127.x / 10.x
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;         // fc00::/7  unique-local
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;         // fe80::/10 link-local
    return false;
  }
  if (!h.includes(".")) return true;                       // "router", "nas", "intranet" ...
  const p = h.split(".");
  if (p.length === 4 && p.every(x => /^\d{1,3}$/.test(x))) {
    const a = Number(p[0]), b = Number(p[1]);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;     // carrier-grade NAT
  }
  return false;
}

function mifasaValidatePublicUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (e) {
    throw new Error(currentLang === "en" ? "That doesn't look like a valid link." : "Iyo link ntabwo isa n'iyemewe.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(currentLang === "en" ? "Only HTTP/HTTPS links are supported." : "Nemera links za HTTP cyangwa HTTPS gusa.");
  }
  if (u.username || u.password || mifasaIsPrivateHost(u.hostname)) {
    throw new Error(currentLang === "en" ? "For safety, I can't read private/local network addresses." : "Kubera umutekano, sinshobora gusoma address za private/local network.");
  }
  u.hash = "";
  return u.href;
}

// reads at most maxBytes of a response (a huge page must not fill the visitor's memory)
async function mifasaReadBodyLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function" || typeof TextDecoder === "undefined") {
    return (await res.text()).slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let out = "", got = 0;
  while (got < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
    out += dec.decode(value, { stream: true });
  }
  try { await reader.cancel(); } catch (e) {}
  return out;
}

// "[label](url)" that cannot be broken by brackets / parentheses / spaces inside the title or url
function mifasaLinkMd(title, url) {
  const label = String(title || "").replace(/[\[\]\r\n]+/g, " ").trim().slice(0, 160) || "link";
  const href = String(url || "").replace(/[()\s*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
  return `[${label}](${href})`;
}

function mifasaReadablePageText(html, contentType) {
  if (/application\/json/i.test(contentType || "")) {
    try {
      const j = JSON.parse(html);
      return { title: "JSON document", text: JSON.stringify(j, null, 2) };
    } catch (e) { return { title: "JSON document", text: html }; }
  }
  if (/text\/plain/i.test(contentType || "")) return { title: "Text document", text: html };
  if (typeof DOMParser === "undefined") throw new Error("This browser cannot parse webpage HTML.");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = (doc.querySelector("meta[property='og:title']")?.content || doc.title || "Webpage").trim();
  doc.querySelectorAll("script,style,noscript,svg,canvas,iframe,nav,footer,header,form,button,aside,[aria-hidden='true']").forEach(n => n.remove());
  const main = doc.querySelector("article,main,[role='main']") || doc.body;
  const text = (main?.innerText || main?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { title: title.slice(0, 240), text };
}

async function mifasaReadLinkDirect(rawUrl) {
  const url = mifasaValidatePublicUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIFASA_LINK_READER.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Accept": "text/html, text/plain, application/json;q=0.9, */*;q=0.5" }
    });
    if (!res.ok) throw new Error(`The website returned HTTP ${res.status}.`);
    if (res.url) mifasaValidatePublicUrl(res.url);          // a redirect must not lead to a private address
    const type = res.headers.get("content-type") || "";
    if (!/(text\/html|text\/plain|application\/json|\+json)/i.test(type)) {
      throw new Error(currentLang === "en" ? "This link points to a file type I can't read as text." : "Iyi link iyerekeza kuri file ntashobora gusoma nk'inyandiko.");
    }
    const raw = await mifasaReadBodyLimited(res, MIFASA_LINK_READER.maxChars * 6);
    const parsed = mifasaReadablePageText(raw.slice(0, MIFASA_LINK_READER.maxChars * 3), type);
    const text = String(parsed.text || "").slice(0, MIFASA_LINK_READER.maxChars).trim();
    if (text.length < 80) throw new Error(currentLang === "en" ? "The page contains too little readable text." : "Urwo rupapuro rufite inyandiko nke cyane zisomeka.");
    const result = { ok: true, url: res.url || url, title: parsed.title || "Webpage", text, readAt: Date.now(), contentType: type };
    MIFASA_LINK_READER.pages = MIFASA_LINK_READER.pages.filter(p => p.url !== result.url);
    MIFASA_LINK_READER.pages.unshift(result);
    MIFASA_LINK_READER.pages = MIFASA_LINK_READER.pages.slice(0, MIFASA_LINK_READER.maxPages);
    return result;
  } catch (err) {
    const msg = err && err.name === "AbortError"
      ? (currentLang === "en" ? "Reading the page timed out." : "Gusoma urwo rupapuro byarengeje igihe.")
      : (err && err.message === "Failed to fetch"
          ? (currentLang === "en"
              ? "This website blocks browser reading (CORS), or the connection failed. I can't bypass that restriction without a permitted proxy/server. Try another public link."
              : "Urwo rubuga rufunga gusomwa na browser (CORS), cyangwa connection yanze. Sinshobora kurenga kuri iryo tegeko nta proxy/server yemerewe. Gerageza indi link rusange.")
          : (err?.message || "Could not read that link."));
    return { ok: false, url: String(rawUrl || ""), error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// one public reader attempt; returns a page result or null
async function mifasaReadViaReader(name, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIFASA_LINK_READER.timeoutMs + 4000);
  try {
    let endpoint, host;
    if (name === "jina") { endpoint = "https://r.jina.ai/" + url; host = "r.jina.ai"; }
    else if (name === "allorigins") { endpoint = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url); host = "allorigins.win"; }
    else return null;
    const res = await fetch(endpoint, { method: "GET", mode: "cors", credentials: "omit", cache: "no-store", signal: controller.signal, headers: { "Accept": "text/plain, text/html;q=0.9" } });
    if (!res.ok) return null;
    const raw = await mifasaReadBodyLimited(res, MIFASA_LINK_READER.maxChars * 6);
    let title = "", text = "";
    if (name === "jina") {
      const t = raw.match(/^Title:\s*(.+)$/m);
      title = t ? t[1].trim() : "";
      const i = raw.indexOf("Markdown Content:");
      text = (i > -1 ? raw.slice(i + 17) : raw).replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    } else {
      const parsed = mifasaReadablePageText(raw.slice(0, MIFASA_LINK_READER.maxChars * 3), "text/html");
      title = parsed.title; text = parsed.text;
    }
    text = text.slice(0, MIFASA_LINK_READER.maxChars).trim();
    if (text.length < 80) return null;
    return { ok: true, url, title: (title || new URL(url).hostname).slice(0, 240), text, readAt: Date.now(), contentType: "text/plain", via: host };
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

// reads a link: first directly in the browser, then (if the site blocks that) through a free public reader
async function mifasaReadLink(rawUrl) {
  const url = mifasaValidatePublicUrl(rawUrl);
  try { if (mifasaHostAdult(new URL(url).hostname)) return { ok: false, adult: true, error: (trySiteInfo(new URL(url).hostname) || { rw: "Uru rubuga ntirwemerewe gusomwa." })[currentLang === "en" ? "en" : "rw"] }; } catch (e) {}
  const first = await mifasaReadLinkDirect(url);
  if (first.ok || !MIFASA_LINK_READER.useReaders) return first;
  for (const name of MIFASA_LINK_READER.readers) {
    const got = await mifasaReadViaReader(name, url);
    if (got) {
      MIFASA_LINK_READER.pages = MIFASA_LINK_READER.pages.filter(p => p.url !== got.url);
      MIFASA_LINK_READER.pages.unshift(got);
      MIFASA_LINK_READER.pages = MIFASA_LINK_READER.pages.slice(0, MIFASA_LINK_READER.maxPages);
      return got;
    }
  }
  return first;
}

/* ---------------------------------------------------------- */
/* 13d. WEB MIND: reasons over the open internet, no API key  */
/* Searches Wikipedia (free, browser-friendly), picks the     */
/* sentences that best fit the question, and cites sources.   */
/* ---------------------------------------------------------- */
const MIFASA_WEB = { enabled: true, timeoutMs: 8000, token: 0 };

async function mifasaWebFetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MIFASA_WEB.timeoutMs);
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", signal: controller.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function mifasaWikiSearch(lang, terms) {
  const api = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(terms)}&gsrlimit=4&prop=extracts&exintro=1&explaintext=1&exlimit=4&format=json&formatversion=2&origin=*`;
  const j = await mifasaWebFetchJson(api);
  const pages = (j && j.query && Array.isArray(j.query.pages)) ? j.query.pages : [];
  return pages.slice().sort((a, b) => (a.index || 99) - (b.index || 99))
    .filter(p => p && p.extract && p.title)
    .map(p => ({ lang, title: p.title, text: p.extract, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}` }));
}

// decides which page and which sentences really answer the question (returns null when nothing fits well)
function mifasaWebReason(query, pages) {
  const qt = [...new Set(tokenize(query).filter(t => t.length > 1 && !MIFASA_STOP_WORDS.has(t)))];
  if (!qt.length || !pages.length) return null;
  const hits = txt => { const n = " " + mifasaNorm(txt) + " "; let c = 0; qt.forEach(t => { if (n.indexOf(" " + t) > -1) c++; }); return c; };
  const scored = pages.map(pg => {
    const titleHit = hits(pg.title);
    const sents = splitSentences(pg.text).slice(0, 14).map((s, i) => ({ s, i, sc: hits(s) + (i === 0 ? 0.5 : 0) }));
    const top = sents.slice().sort((a, b) => b.sc - a.sc).slice(0, 3);
    const pageScore = titleHit * 2 + top.reduce((x, y) => x + y.sc, 0);
    return { pg, titleHit, sents, top, pageScore };
  }).sort((a, b) => b.pageScore - a.pageScore);
  const best = scored[0];
  const need = Math.min(2, qt.length);
  if (!(best.titleHit >= 1 || best.top[0].sc >= need)) return null;
  const chosen = best.top.filter(x => x.sc > 0.5 || x.i === 0).sort((a, b) => a.i - b.i).map(x => x.s);
  if (!chosen.length) return null;
  const extra = scored[1] && scored[1].pageScore >= best.pageScore * 0.7 && scored[1].pageScore > 1.5 ? scored[1] : null;
  const agree = scored.filter(x => x.pageScore >= best.pageScore * 0.5).length;
  return { sentences: chosen, best: best.pg, extra: extra ? { pg: extra.pg, s: extra.top[0].s } : null, agree };
}

async function mifasaWebResearch(query) {
  const terms = tokenize(query).filter(t => t.length > 1 && !MIFASA_STOP_WORDS.has(t)).join(" ");
  if (!MIFASA_WEB.enabled || terms.length < 3) return null;
  const rw = (detectQueryLang(query) || currentLang) !== "en";
  const bridged = rw ? mifasaBridgeEn(query) : null;
  const plan = rw ? [["rw", terms, query]] : [];
  plan.push(["en", bridged ? tokenize(bridged).filter(t => t.length > 1 && !MIFASA_STOP_WORDS.has(t)).join(" ") : terms, bridged || query]);
  for (const [lg, tq, rq] of plan) {
    try {
      const pages = await mifasaWikiSearch(lg, tq);
      const r = mifasaWebReason(rq, pages);
      if (r) return r;
    } catch (e) { /* offline or blocked: try the next language, then give up quietly */ }
  }
  return null;
}

function mifasaWebAnswerText(r) {
  const en = currentLang === "en";
  let t = (en ? "🌐 **From the open internet (Wikipedia)**\n\n" : "🌐 **Biturutse kuri murandasi (Wikipedia)**\n\n") + r.sentences.join(" ");
  if (r.extra) t += "\n\n" + (en ? "Another source adds: " : "Indi nkomoko yongeraho: ") + r.extra.s;
  t += "\n\n" + (en ? "**Sources:** " : "**Inkomoko:** ") + mifasaLinkMd(r.best.title, r.best.url);
  if (r.extra) t += " · " + mifasaLinkMd(r.extra.pg.title, r.extra.pg.url);
  t += "\n" + (en
    ? "_I picked these sentences because they match your question best. Please verify important facts on the source page._"
    : "_Nahisemo izi nteruro kuko ari zo zihuye n'ikibazo cyawe kurusha izindi. Genzura ibintu by'ingenzi ku rupapuro rw'inkomoko._");
  return t;
}

// shows "searching…" under the local answer, then the web answer (ignores outdated replies)
function mifasaWebAugment(value, baseHtml) {
  if (!results || !MIFASA_WEB.enabled) return;
  const my = ++MIFASA_WEB.token;
  const en = currentLang === "en";
  results.innerHTML = baseHtml + `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(en ? "🌐 Checking the open internet…" : "🌐 Ndimo gushakisha kuri murandasi…")}</div>`;
  mifasaWebResearch(value).then(r => {
    if (my !== MIFASA_WEB.token || !results) return;
    results.innerHTML = baseHtml + (r ? `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(mifasaWebAnswerText(r))}</div>` : "");
  }).catch(() => { if (my === MIFASA_WEB.token && results) results.innerHTML = baseHtml; });
}

// For chat widgets: understands links, analysis requests and falls back to the open internet
async function mifasaAskAsync(message, limit) {
  const raw = String(message || "").trim();
  if (mifasaExtractUrl(raw)) return mifasaAskWithLink(raw, limit);
  if (MIFASA_WS.enabled) {                  // "show me a photo of Trump" / "nyereka ifoto ya Kagame": the photos ARE the answer
    try {
      const wi = mifasaMediaIntent(raw);
      if (wi && wi.kinds.length === 1 && wi.kinds[0] === "photo" && !wi.defaultTopic) {
        const mh = await mifasaMediaHtml(raw, wi);
        if (mh) {
          const en = (detectQueryLang(raw) || currentLang) === "en";
          const intro = en ? `📷 **MIFASA AI**\n\nHere are photos of **${wi.q}** from my own files and free open sources:` : `📷 **MIFASA AI**\n\nDore amafoto ya **${wi.q}** avuye mu bubiko bwanjye no ku nkomoko z'ubuntu zemewe:`;
          return { items: [], corrected: "", html: `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(intro)}</div>` + mh, media: true };
        }
      }
    } catch (e) { /* fall through to the normal answer */ }
  }
  const r = mifasaAskApi(raw, limit);
  const noAnswer = r && !r.html && (!r.items || !r.items.length);
  const weak = r && r.html && /(nta makuru ndabona|nta bisubizo|couldn't find|no results)/i.test(r.html) && (!r.items || !r.items.length);
  if ((noAnswer || weak) && raw.length >= 6 && typeof mifasaLearnLookup === "function") {          // what the external AI already answered once (part 295)
    const lm = await mifasaLearnLookup(raw);
    if (lm) return lm;
  }
  if ((noAnswer || weak || mifasaKbFresh(raw)) && raw.length >= 6 && (typeof MIFASA_SAFETY_RE === "undefined" || !MIFASA_SAFETY_RE.test(raw))) {
    const kb = await mifasaKbAnswer(raw);          // MIFASA KB (Cloudflare D1 + Vectorize): only a strong hit; otherwise continue below
    if (kb) return kb;
  }
  if ((noAnswer || weak) && raw.length >= 6 && typeof mifasaHubAnswer === "function") {          // stories stored on the hub (+ their full text) come before the web
    const hb = await mifasaHubAnswer(raw);
    if (hb) return hb;
  }
  if ((noAnswer || weak) && raw.length >= 6) {
    const w = await mifasaWebResearch(raw);
    if (w) {
      let tail = "";
      if (MIFASA_WS.enabled) { try { const wi = mifasaMediaIntent(raw); if (wi) tail = await mifasaMediaHtml(raw, wi); } catch (e) { /* optional */ } }
      return { items: [], corrected: "", html: mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + mifasaWebAnswerText(w)) + tail };
    }
  }
  const lowConf = !!(r && r.html && (/(Ntabwo mbyizeye 100%|not 100% sure)/i.test(r.html) || (r._viaSearch && ((r._nEff > 1 && r._cov < 0.75) || /\b(write|code|python|javascript|html|css|explain|analogy|essay|poem|story|draw|generate|translate|how do i|how to|why|what if|difference between)\b|\b(andika|sobanura|kuki|nigute|ni iki gitandukanya)\b/i.test(raw)))));   // "closest I found" = MIFASA AI has no real answer
  if (lowConf && !noAnswer && !weak && raw.length >= 6 && typeof mifasaHubAnswer === "function") {
    const hb2 = await mifasaHubAnswer(raw);
    if (hb2) return hb2;
  }
  if ((noAnswer || weak || lowConf) && raw.length >= 6) {          // free external AI, only as the last resort (needs window.MIFASA_LLM_URL)
    const l = await mifasaLlmAnswer(raw);
    if (l) return l;
  }
  if (r && MIFASA_WS.enabled) {             // photos / videos / this week's news from free open sources, added UNDER the local answer
    try { const wi = mifasaMediaIntent(raw); if (wi) { const mh = await mifasaMediaHtml(raw, wi); if (mh) r.html = (r.html || "") + mh; } } catch (e) { /* optional */ }
  }
  return r;
}

async function mifasaAskWithLink(message, limit) {
  const raw = String(message || "").trim();
  const found = mifasaExtractUrl(raw);
  if (!found) return mifasaAskApi(raw, limit);
  const match = [found.raw];
  const url = found.url;
  const page = await mifasaReadLink(url);
  if (!page.ok) return {
    items: [], corrected: "", html: mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + page.error)
  };
  const question = raw.replace(match[0], " ").replace(/\b(read|open|visit|analyze|analyse|summari[sz]e|explain|this link|this page|iyi link|iyi page|soma|isesengure|nsobanurira)\b/gi, " ").replace(/\s+/g, " ").trim();
  const sourceId = "mifasa-user-link-" + generateSlug(page.url).slice(0, 48);
  const article = normalizeArticle({
    id: sourceId, share_id: sourceId, title: page.title, title_rw: page.title, title_en: page.title,
    summary: page.text.slice(0, 900), summary_rw: page.text.slice(0, 900), summary_en: page.text.slice(0, 900),
    content: page.text, body: page.text, text: page.text, description: page.text,
    link: page.url, source: new URL(page.url).hostname, category: "web-link", publish: new Date().toISOString()
  }, "mifasa-user-link.json");
  if (article) {
    const fileKey = "mifasa-user-link:" + page.url;
    mifasaFileArticles.set(fileKey, [article]);
    mifasaFileOrder = mifasaFileOrder.filter(f => !String(f).startsWith("mifasa-user-link:"));
    mifasaFileOrder.unshift(fileKey);
    // Remove old transient link records from the map; keep the most recently read page searchable.
    for (const key of [...mifasaFileArticles.keys()]) {
      if (String(key).startsWith("mifasa-user-link:") && key !== fileKey) mifasaFileArticles.delete(key);
    }
    rebuildAllNews();
  }
  if (MIFASA_ANALYZE_CUE.test(raw)) {
    const an = mifasaAnalyzeText(page.text, page.title);
    if (an) return { items: [], corrected: "", html: mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + an + `\n\n**${currentLang === "en" ? "Source read" : "Aho amakuru yavuye"}:** ${mifasaLinkMd(page.title, page.url)}`), linkRead: { url: page.url, title: page.title } };
  }
  const prompt = question || (currentLang === "en" ? "Summarize the main points of this webpage" : "Sobanura ingingo z'ingenzi z'uru rupapuro");
  const answer = mifasaAskApi(prompt, limit);
  const viaEn = page.via ? ` (read through the free public reader ${page.via}, because the site blocks direct reading)` : "";
  const viaRw = page.via ? ` (nasomye binyuze kuri ${page.via}, kuko urubuga rufunga gusomwa ako kanya)` : "";
  const sourceLine = currentLang === "en" ? `\n\n**Source read:** ${mifasaLinkMd(page.title, page.url)}${viaEn}` : `\n\n**Aho amakuru yavuye:** ${mifasaLinkMd(page.title, page.url)}${viaRw}`;
  answer.html = (answer.html || "") + mifasaAnswerBox(sourceLine);
  answer.linkRead = { url: page.url, title: page.title };
  return answer;
}


/* ---------------------------------------------------------- */
/* 13d. WEB SOURCES: free, keyless servers for photos, videos */
/* and this week's news. Sits ON TOP of the local JSON answer */
/* (never replaces it). No API key, no AI service. Every      */
/* provider fails silently; results are cached in the browser.*/
/* Works from https://mifasarw.neocities.org and localhost.   */
/* Console: MifasaAI.webSources.ping() shows which providers  */
/* really answer from YOUR browser (CORS differs per site).   */
/* ---------------------------------------------------------- */
const MIFASA_WS = {
  enabled: true,
  cacheKey: "mifasa_web_cache_v1",
  ttl: { photo: 24 * 36e5, video: 24 * 36e5, news: 3 * 36e5 },
  maxCache: 40,
  breakerFails: 3, breakerPauseMs: 10 * 60e3,
  state: new Map(),     // provider id -> { fails, until, err }
  net: { ok: 0, fail: 0, skip: 0 },   // counters: lets the UI tell "nothing found" from "could not reach the servers"
  inflight: new Map(),
  gate: new Map(),      // provider id -> time of last request (for providers with a minimum gap)
  token: 0
};
function mifasaHttps(url) { try { const u = new URL(String(url || "")); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; } }
function mifasaHostOk(url, hosts) {
  try { const u = new URL(String(url || "")); return u.protocol === "https:" && hosts.some(h => u.hostname === h || u.hostname.endsWith("." + h)); } catch (e) { return false; }
}
function mifasaStrip(s, n) { return String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, n || 160); }

function mifasaParseCommons(j, kind) {
  const pages = j && j.query && Array.isArray(j.query.pages) ? j.query.pages : [];
  return pages.slice().sort((a, b) => (a.index || 99) - (b.index || 99)).map(p => {
    const ii = p && Array.isArray(p.imageinfo) ? p.imageinfo[0] : null;
    if (!ii) return null;
    const md = ii.extmetadata || {}, mime = String(ii.mime || "");
    if (kind === "photo" && !/^image\/(jpeg|png|gif|webp)$/.test(mime)) return null;   // skips svg/tiff/pdf
    if (kind === "video" && !/^(video\/|application\/ogg)/.test(mime)) return null;
    const thumb = mifasaHostOk(ii.thumburl, ["upload.wikimedia.org"]) ? ii.thumburl : "";
    const media = mifasaHostOk(ii.url, ["upload.wikimedia.org"]) ? ii.url : "";
    const page = mifasaHostOk(ii.descriptionurl, ["commons.wikimedia.org"]) ? ii.descriptionurl : "";
    if (!page || (kind === "photo" && !thumb)) return null;
    return { kind, title: mifasaStrip(String(p.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "), 120) || "Wikimedia Commons file",
      thumb, media, page, mime, source: "Wikimedia Commons",
      license: mifasaStrip(md.LicenseShortName && md.LicenseShortName.value, 40), by: mifasaStrip(md.Artist && md.Artist.value, 60) };
  }).filter(Boolean);
}
function mifasaParseOpenverse(j) {
  const arr = j && Array.isArray(j.results) ? j.results : [];
  return arr.map(r => {
    const thumb = mifasaHostOk(r && r.thumbnail, ["api.openverse.org"]) ? r.thumbnail : "";
    const page = mifasaHttps(r && (r.foreign_landing_url || r.url));
    if (!thumb || !page) return null;
    return { kind: "photo", title: mifasaStrip(r.title, 120) || "image", thumb, media: "", page, mime: "",
      source: mifasaStrip(r.source || "Openverse", 40), license: mifasaStrip(((r.license || "") + " " + (r.license_version || "")).toUpperCase(), 30), by: mifasaStrip(r.creator, 60) };
  }).filter(Boolean);
}
function mifasaParseNasa(j) {          // NASA Image and Video Library: free, no key
  const arr = j && j.collection && Array.isArray(j.collection.items) ? j.collection.items : [];
  return arr.map(it => {
    const d = (it && Array.isArray(it.data) && it.data[0]) || {}, l = (it && Array.isArray(it.links) && (it.links.find(x => x && x.render === "image") || it.links[0])) || {};
    const thumb = mifasaHostOk(l.href, ["nasa.gov"]) ? l.href : "", id = String(d.nasa_id || "");
    if (!thumb || !/^[\w.\-]+$/.test(id)) return null;
    return { kind: "photo", title: mifasaStrip(d.title, 120) || "NASA image", thumb, media: "", page: "https://images.nasa.gov/details/" + encodeURIComponent(id), mime: "image/jpeg",
      source: "NASA", license: "NASA media (usually public domain)", by: mifasaStrip(d.photographer || d.secondary_creator || d.center, 60) };
  }).filter(Boolean);
}
function mifasaParseArchive(j) {
  const docs = j && j.response && Array.isArray(j.response.docs) ? j.response.docs : [];
  return docs.map(d => {
    const id = String(d && d.identifier || "");
    if (!/^[A-Za-z0-9._-]{2,100}$/.test(id)) return null;
    const lic = String(d.licenseurl || "").match(/creativecommons\.org\/(?:licenses|publicdomain)\/([a-z-]+)(?:\/([0-9.]+))?/i);
    return { kind: "video", title: mifasaStrip(Array.isArray(d.title) ? d.title[0] : d.title, 120) || id,
      thumb: "https://archive.org/services/img/" + encodeURIComponent(id), media: "", page: "https://archive.org/details/" + encodeURIComponent(id), mime: "",
      source: "Internet Archive", license: lic ? ("CC " + lic[1] + (lic[2] ? " " + lic[2] : "")).toUpperCase() : "", by: "" };
  }).filter(Boolean);
}
function mifasaParseGdelt(j) {
  const arr = j && Array.isArray(j.articles) ? j.articles : [];
  const seen = new Set();
  return arr.map(a => {
    const url = mifasaHttps(a && a.url), title = mifasaStrip(a && a.title, 160);
    if (!url || !title) return null;
    if (a.language && !/^(english|french|kinyarwanda|swahili)$/i.test(String(a.language))) return null;   // readers of MIFASARW: en / fr / rw / sw
    const key = mifasaNorm(title).slice(0, 60);
    if (seen.has(key)) return null; seen.add(key);
    const m = String(a.seendate || "").match(/^(\d{4})(\d{2})(\d{2})/);
    return { kind: "news", title, page: url, thumb: "", media: "", source: mifasaStrip(a.domain, 60) || new URL(url).hostname, date: m ? `${m[1]}-${m[2]}-${m[3]}` : "", license: "", by: "", lang: mifasaStrip(a.language, 20) };
  }).filter(Boolean);
}
const MIFASA_WS_PROVIDERS = {
  photo: [
    { id: "commons_photo", max: 6, url: q => "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap") + "&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=480&format=json&formatversion=2&origin=*", parse: j => mifasaParseCommons(j, "photo") },
    { id: "openverse_photo", max: 6, url: q => "https://api.openverse.org/v1/images/?page_size=6&mature=false&q=" + encodeURIComponent(q), parse: mifasaParseOpenverse },
    { id: "nasa_photo", max: 5, url: q => "https://images-api.nasa.gov/search?media_type=image&page_size=6&q=" + encodeURIComponent(q), parse: mifasaParseNasa }
  ],
  video: [
    { id: "commons_video", max: 4, url: q => "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=6&gsrsearch=" + encodeURIComponent(q + " filetype:video") + "&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=480&format=json&formatversion=2&origin=*", parse: j => mifasaParseCommons(j, "video") },
    { id: "archive_video", max: 4, url: q => "https://archive.org/advancedsearch.php?q=" + encodeURIComponent("(" + q + ") AND mediatype:movies") + "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&rows=5&page=1&output=json", parse: mifasaParseArchive }
  ],
  news: [
    { id: "gdelt_news", max: 8, minGap: 5500, url: q => "https://api.gdeltproject.org/api/v2/doc/doc?mode=ArtList&format=json&sort=DateDesc&maxrecords=12&timespan=1w&query=" + encodeURIComponent(q), parse: mifasaParseGdelt }
  ]
};

async function mifasaWsCall(p, q) {
  const now = Date.now();
  const st = MIFASA_WS.state.get(p.id) || { fails: 0, until: 0 };
  if (st.until > now) { MIFASA_WS.net.skip++; return null; }                 // provider is resting after repeated failures
  if (p.minGap) { const last = MIFASA_WS.gate.get(p.id) || 0; if (now - last < p.minGap) { MIFASA_WS.net.skip++; return null; } MIFASA_WS.gate.set(p.id, now); }
  try {
    const j = await mifasaWebFetchJson(p.url(q));                           // CORS, no credentials, 8 s timeout
    const items = p.parse(j).slice(0, p.max || 6);
    MIFASA_WS.state.set(p.id, { fails: 0, until: 0 });
    MIFASA_WS.net.ok++;
    return items;
  } catch (e) {
    MIFASA_WS.net.fail++; st.err = String(e && e.message || e).slice(0, 120);
    st.fails++; if (st.fails >= MIFASA_WS.breakerFails) { st.until = now + MIFASA_WS.breakerPauseMs; st.fails = 0; }
    MIFASA_WS.state.set(p.id, st);
    return null;
  }
}
function mifasaWsGet(kind, q) {
  const key = kind + "|" + mifasaNorm(mifasaStrip(q, 80));
  if (MIFASA_WS.inflight.has(key)) return MIFASA_WS.inflight.get(key);      // page + chat asking for the same thing = one request
  const pr = mifasaWsGetInner(kind, q).finally(() => MIFASA_WS.inflight.delete(key));
  MIFASA_WS.inflight.set(key, pr);
  return pr;
}
async function mifasaWsGetInner(kind, q) {
  q = mifasaStrip(q, 80);
  if (!MIFASA_WS.enabled || q.length < 3 || !MIFASA_WS_PROVIDERS[kind]) return [];
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return [];
  const ck = kind + "|" + mifasaNorm(q);
  const cache = readLS(MIFASA_WS.cacheKey, {});
  const hit = cache[ck];
  if (hit && Array.isArray(hit.items) && Date.now() - hit.t < MIFASA_WS.ttl[kind]) return hit.items;
  if (kind === "photo") {                 // photos: ask every free source at once and mix them, so there are many to choose from
    const all = await Promise.all(MIFASA_WS_PROVIDERS.photo.map(p => mifasaWsCall(p, q)));
    const seen = new Set(), mixed = [];
    for (let i = 0; i < 6; i++) all.forEach(list => { const x = list && list[i]; if (x && !seen.has(x.thumb)) { seen.add(x.thumb); mixed.push(x); } });
    if (mixed.length) {
      cache[ck] = { t: Date.now(), q, items: mixed };
      Object.keys(cache).sort((a, b) => cache[b].t - cache[a].t).slice(MIFASA_WS.maxCache).forEach(k => delete cache[k]);
      writeLS(MIFASA_WS.cacheKey, cache);
      return mixed;
    }
    return (hit && Array.isArray(hit.items)) ? hit.items : [];
  }
  for (const p of MIFASA_WS_PROVIDERS[kind]) {
    const items = await mifasaWsCall(p, q);
    if (items && items.length) {
      cache[ck] = { t: Date.now(), q, items };
      const keys = Object.keys(cache).sort((a, b) => cache[b].t - cache[a].t);
      keys.slice(MIFASA_WS.maxCache).forEach(k => delete cache[k]);
      writeLS(MIFASA_WS.cacheKey, cache);
      return items;
    }
  }
  return (hit && Array.isArray(hit.items)) ? hit.items : [];                // an old answer beats an empty one
}

// this week's articles already inside MIFASARW's own JSON files (shown first)
function mifasaLocalWeek(topic, any) {
  const now = Date.now(), cut = now - 7 * 864e5;
  const tk = tokenize(topic || "").filter(t => t.length > 2 && !MIFASA_STOP_WORDS.has(t));
  return (allNews || []).filter(a => a && a._ts >= cut && a._ts <= now + 864e5 && a.category !== "web-link").filter(a => {
    if (any || !tk.length) return true;
    const hay = mifasaNorm(getTitle(a) + " " + (a.summary || a.description || ""));
    return tk.some(t => hay.indexOf(t) > -1);
  }).slice(0, 5).map(a => {
    const href = mifasaHttps(absoluteUrl(a.link || a.url || ""));
    return href ? { kind: "news", title: mifasaStrip(getTitle(a), 160), page: href, thumb: "", media: "", source: "MIFASARW", local: true,
      date: new Date(a._ts).toISOString().slice(0, 10), license: "", by: "" } : null;
  }).filter(Boolean);
}

const MIFASA_WS_CUES = {
  photo: /\b(photos?|pictures?|images?|pics?|ifoto|amafoto|foto)\b/i,
  video: /\b(videos?|videwo|clips?|footage)\b/i,
  news: /\b(news|headlines)\b|amakuru\s+(?:mashya|agezweho|y['’]?\s*icyumweru)/i
};
const MIFASA_WS_FILLER = new Set(["show", "me", "give", "find", "get", "a", "an", "the", "of", "about", "for", "some", "any", "please", "photo", "photos", "picture", "pictures", "image", "images", "pic", "pics",
  "video", "videos", "clip", "clips", "footage", "news", "headlines", "latest", "recent", "current", "this", "week", "weeks", "today", "from", "on", "in", "and", "with", "tell", "can", "you", "i", "want",
  "see", "watch", "to", "is", "are", "new", "top", "ifoto", "amafoto", "foto", "videwo", "amakuru", "mashya", "agezweho", "icyumweru", "mpa", "nyereka", "ndashaka", "ya", "y", "pls", "plz"]);
/* ---- PHOTO ASSISTANT: names -> full names, photos found inside MIFASA's own JSON files, safety filter ---- */
// Short names people type -> the name that finds the right photos on Wikimedia Commons / Openverse.
// You can add more WITHOUT touching script.js: put  "photo_aliases": { "trump": "Donald Trump" }  in any ai*.json module.

// optional hand-picked photos, in any ai*.json module:  "images": [ { "title_rw":"..", "title_en":"..", "url":"https://..jpg", "page":"https://..", "keywords":["trump"], "credit":".." } ]
function mifasaPhotoDbLoad(src) {
  try {
    if (src && src.photo_aliases && typeof src.photo_aliases === "object") Object.keys(src.photo_aliases).forEach(k => { const v = mifasaStrip(src.photo_aliases[k], 80); if (v) MIFASA_PHOTO_DB.aliases[mifasaNorm(k)] = v; });
    if (src && Array.isArray(src.images)) src.images.forEach(im => { const url = mifasaHttps(im && im.url); if (!url) return; MIFASA_PHOTO_DB.images.push({ url, page: mifasaHttps(im.page) || url, title: mifasaStrip(im.title_en || im.title_rw || im.title || "photo", 120), keywords: [].concat(im.keywords || []).map(k => mifasaNorm(String(k))).filter(Boolean), credit: mifasaStrip(im.credit, 60) }); });
  } catch (e) { /* optional */ }
}
const MIFASA_PHOTO_BLOCK = /\b(porn\w*|xxx|nudes?|naked|nsfw|erotic|sex\s*tape|gore|beheading|kwambara\s+ubusa|ubusa)\b/i;   // never fetched, never shown
function mifasaPhotoAlias(topic) {
  const A = MIFASA_PHOTO_DB.aliases, words = String(topic || "").split(" ").filter(Boolean);
  const out = [];
  words.forEach((w, i) => {
    const full = A[w];
    if (!full) { out.push(w); return; }
    const have = mifasaNorm(full).split(" ");
    const alreadyThere = have.some(h => h !== w && words.includes(h));       // "donald trump" stays as typed
    if (!alreadyThere) out.push(full); else out.push(w);
  });
  return out.join(" ").trim();
}
function mifasaLocalPhotos(topic) {
  const tk = tokenize(topic || "").filter(t => t.length > 2 && !MIFASA_STOP_WORDS.has(t));
  if (!tk.length) return [];
  const need = tk.length <= 2 ? tk.length : Math.ceil(tk.length / 2);
  const hit = hay => tk.filter(t => hay.indexOf(t) > -1).length >= need;
  const out = [];
  MIFASA_PHOTO_DB.images.forEach(im => { if (hit(mifasaNorm(im.title + " " + im.keywords.join(" ")))) out.push({ kind: "photo", title: im.title, thumb: im.url, media: "", page: im.page, mime: "", source: "MIFASARW", license: "", by: im.credit, local: true }); });
  (allNews || []).forEach(a => {
    if (!a || a.category === "web-link") return;
    const img = mifasaHttps(absoluteUrl(a.image || a.thumbnail || "")), page = mifasaHttps(absoluteUrl(a.link || a.url || ""));
    if (!img || !page) return;
    if (hit(mifasaNorm(getTitle(a) + " " + (a.summary || a.description || "")))) out.push({ kind: "photo", title: mifasaStrip(getTitle(a), 120), thumb: img, media: "", page, mime: "", source: "MIFASARW", license: "", by: "", local: true });
  });
  const seen = new Set();
  return out.filter(x => { if (seen.has(x.thumb)) return false; seen.add(x.thumb); return true; }).slice(0, 8);
}
function mifasaMediaIntent(raw) {
  const s = String(raw || "").trim();
  if (s.length < 4 || s.length > 200 || mifasaExtractUrl(s)) return null;
  if (MIFASA_PHOTO_BLOCK.test(s)) return null;
  const kinds = Object.keys(MIFASA_WS_CUES).filter(k => MIFASA_WS_CUES[k].test(s));
  if (!kinds.length) return null;
  const topic = mifasaPhotoAlias(mifasaNorm(s).split(" ").filter(w => w && !MIFASA_WS_FILLER.has(w)).join(" ").trim());
  const rw = (detectQueryLang(s) || currentLang) !== "en";
  let q = topic;
  if (rw && topic && !Object.values(MIFASA_PHOTO_DB.aliases).some(v => mifasaNorm(v) === topic)) { try { const b = mifasaBridgeEn(topic); if (b) { const c = b.split(/\s+/).filter(w => w && w !== "-" && !MIFASA_WS_FILLER.has(w)).join(" "); if (c) q = c; } } catch (e) { /* keep the original words */ } }
  const wantsNews = kinds.includes("news");
  return { kinds, topic, q: q || "Rwanda", defaultTopic: !q };
}

function mifasaWsLabel(key) {
  const en = currentLang === "en";
  const L = {
    photo: en ? "📷 Photos from open sources" : "📷 Amafoto",
    video: en ? "🎬 Videos from open sources" : "🎬 Videwo",
    news: en ? "📰 News this week" : "📰 Amakuru y'icyumweru",
    foot: en ? "Free open sources: Wikimedia Commons, Openverse, Internet Archive, GDELT. Check each licence before reusing." : "Inkomoko: Wikimedia Commons, Openverse, Internet Archive, GDELT. Reba license kuri buri rupapuro mbere yo gukoresha.",
    open: en ? "Open" : "Fungura",
    noPlay: en ? "▶ Open the video page" : "▶ Fungura urupapuro rwa videwo",
    local: en ? "from MIFASARW" : "kuri MIFASARW"
  };
  return L[key];
}
function mifasaWsRender(blocks, plain) {
  const E = escapeHTML, sm = plain ? "font-size:12px;opacity:.75;" : "font-size:12px;color:#456;";   // card has its own light background + dark text (works in dark mode too)
  const parts = [];
  if (blocks.news && blocks.news.length) {
    parts.push(`<div style="font-weight:bold;margin-top:4px;">${E(mifasaWsLabel("news"))}</div><ul style="margin:6px 0 10px 18px;padding:0;">` + blocks.news.map(n =>
      `<li style="margin:4px 0;"><a href="${E(n.page)}" target="_blank" rel="noopener noreferrer" ${plain ? "" : 'style="color:#0b57d0;"'}>${E(n.title)}</a> <span style="${sm}">${E(n.local ? mifasaWsLabel("local") : n.source)}${n.date ? " · " + E(n.date) : ""}</span></li>`).join("") + "</ul>");
  }
  if (blocks.photo && blocks.photo.length) {
    parts.push(`<div style="font-weight:bold;margin-top:4px;">${E(mifasaWsLabel("photo"))}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:6px 0 10px;">` + blocks.photo.map(p =>
      `<figure style="margin:0;"><a href="${E(p.page)}" target="_blank" rel="noopener noreferrer"><img src="${E(p.thumb)}" alt="${E(p.title)}" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:110px;object-fit:cover;border-radius:4px;background:#dde;"></a><figcaption style="${sm}">${E(p.title)}<br>${E([p.license, p.source].filter(Boolean).join(" · "))}</figcaption></figure>`).join("") + "</div>");
  }
  if (blocks.video && blocks.video.length) {
    parts.push(`<div style="font-weight:bold;margin-top:4px;">${E(mifasaWsLabel("video"))}</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin:6px 0 10px;">` + blocks.video.map(v => {
      const playable = v.media && /^(video\/(webm|ogg|mp4)|application\/ogg)/.test(v.mime);
      const body = playable
        ? `<video controls preload="none" ${v.thumb ? `poster="${E(v.thumb)}"` : ""} src="${E(v.media)}" style="width:100%;max-height:200px;border-radius:4px;background:#000;"></video>`
        : `<a href="${E(v.page)}" target="_blank" rel="noopener noreferrer">${v.thumb ? `<img src="${E(v.thumb)}" alt="${E(v.title)}" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:120px;object-fit:cover;border-radius:4px;background:#dde;">` : ""}<div style="${sm}">${E(mifasaWsLabel("noPlay"))}</div></a>`;
      return `<figure style="margin:0;">${body}<figcaption style="${sm}"><a href="${E(v.page)}" target="_blank" rel="noopener noreferrer">${E(v.title)}</a><br>${E([v.license, v.source].filter(Boolean).join(" · "))}</figcaption></figure>`;
    }).join("") + "</div>");
  }
  if (!parts.length) return "";
  if (plain) return `<div class="mifasa-web-sources">${parts.join("")}<div style="${sm}">${E(mifasaWsLabel("foot"))}</div></div>`;
  return `<div class="mifasa-web-sources" style="background:#f7fbf9;border-left:4px solid #1a9b6c;padding:12px;margin:12px 0;border-radius:6px;font-family:sans-serif;line-height:1.45;color:#1a1a2e;">${parts.join("")}<div style="${sm}">${E(mifasaWsLabel("foot"))}</div></div>`;
}
async function mifasaMediaHtml(raw, intent) {
  const it = intent || mifasaMediaIntent(raw);
  if (!it) return "";
  const blocks = {}, n0 = Object.assign({}, MIFASA_WS.net);
  await Promise.all(it.kinds.map(async k => {
    try {
      if (k === "news") {
        const local = mifasaLocalWeek(it.defaultTopic ? "" : it.q, it.defaultTopic);
        const web = await mifasaWsGet("news", it.q);
        const seen = new Set(local.map(x => mifasaNorm(x.title).slice(0, 60)));
        blocks.news = local.concat(web.filter(x => !seen.has(mifasaNorm(x.title).slice(0, 60)))).slice(0, 10);
      } else if (k === "photo") {
        const local = it.defaultTopic ? [] : mifasaLocalPhotos(it.q);
        const web = await mifasaWsGet("photo", it.q);
        const seen = new Set(local.map(x => x.thumb));
        blocks.photo = local.concat(web.filter(x => !seen.has(x.thumb))).slice(0, 18);
      } else blocks[k] = await mifasaWsGet(k, it.q);
    } catch (e) { blocks[k] = []; }
  }));
  const html = mifasaWsRender(blocks);
  if (html) return html;
  const reached = MIFASA_WS.net.ok > n0.ok, blocked = (MIFASA_WS.net.fail + MIFASA_WS.net.skip) > (n0.fail + n0.skip);
  const msg = reached ? `🌐 I found no open photos, videos or news for “${it.q}”. Try other words.`
    : blocked ? "🌐 I couldn’t reach the free open sources just now (offline, blocked by the browser, or resting after errors). Try again in a few minutes." : "";
  return msg ? `<div class="mifasa-web-sources" style="font-size:12px;opacity:.8;margin:8px 0;">${escapeHTML(msg)}</div>` : "";
}
// search page: the web block lives in its own box under #searchResults, so the local answer is never overwritten
function mifasaMediaBox() {
  if (typeof document === "undefined" || !results || !results.parentNode) return null;
  let b = document.getElementById("mifasaMediaBox");
  if (!b) { b = document.createElement("div"); b.id = "mifasaMediaBox"; results.parentNode.insertBefore(b, results.nextSibling); }
  return b;
}
async function mifasaMediaAugment(value) {
  const my = ++MIFASA_WS.token;
  const box = mifasaMediaBox();
  if (box) box.innerHTML = "";
  if (!box || !MIFASA_WS.enabled) return;
  const it = mifasaMediaIntent(value);
  if (!it) return;
  box.innerHTML = `<div style="${MIFASA_AI_BOX_STYLE}">${renderAIText(currentLang === "en" ? "🌐 Checking free open sources…" : "🌐 Ndimo gushakisha kuri murandasi…")}</div>`;
  let html = "";
  try { html = await mifasaMediaHtml(value, it); } catch (e) { html = ""; }
  if (my === MIFASA_WS.token) box.innerHTML = html;
}
async function mifasaWsPing() {
  const out = [];
  for (const kind of Object.keys(MIFASA_WS_PROVIDERS)) for (const p of MIFASA_WS_PROVIDERS[kind]) {
    const t0 = Date.now();
    try { const j = await mifasaWebFetchJson(p.url(kind === "news" ? "rwanda" : "kigali")); out.push({ provider: p.id, kind, ok: true, items: p.parse(j).length, ms: Date.now() - t0 }); }
    catch (e) { out.push({ provider: p.id, kind, ok: false, error: String(e && e.message || e), ms: Date.now() - t0 }); }
  }
  return out;
}
async function mifasaWeekNews() {
  const items = await mifasaWsGet("news", "Rwanda");
  return items.slice(0, 6);
}
function mifasaAutoNewsBox() {
  if (typeof document === "undefined" || MIFASA_API_ONLY) return null;
  let b = document.getElementById("mifasaWebNews");                          // optional: put <div id="mifasaWebNews"></div> anywhere you like
  if (b) return b;
  if (!document.getElementById("hotTitle")) return null;                     // auto-create only on the home page
  const grid = document.getElementById("latestNews");
  if (!grid || !grid.parentNode) return null;
  b = document.createElement("div"); b.id = "mifasaWebNews";
  const before = grid.previousElementSibling && /section-title/.test(grid.previousElementSibling.className || "") ? grid.previousElementSibling : grid;
  grid.parentNode.insertBefore(b, before);
  return b;
}
async function mifasaAutoNews() {
  const box = mifasaAutoNewsBox();
  if (!box || !MIFASA_WS.enabled) return;
  let items = [];
  try { items = await mifasaWeekNews(); } catch (e) { items = []; }
  const html = items.length ? mifasaWsRender({ news: items }) : "";
  if (html) { box.innerHTML = html; box.style.maxWidth = "900px"; box.style.margin = "0 auto"; } else if (!box.innerHTML) box.innerHTML = "";
}
async function mifasaNewsHtml() { try { const n = await mifasaWeekNews(); return n.length ? mifasaWsRender({ news: n }, true) : ""; } catch (e) { return ""; } }
function mifasaWsExport() {
  const cache = readLS(MIFASA_WS.cacheKey, {});
  return { module: "web-cache", generated: new Date().toISOString(), note: "Fetched from free open sources. Review licences before reusing.", entries: Object.keys(cache).map(k => ({ key: k, query: cache[k].q, fetched: new Date(cache[k].t).toISOString(), items: cache[k].items })) };
}
if (typeof document !== "undefined" && !MIFASA_API_ONLY) {       // home page: fresh weekly news on load, then every 3 hours while the page stays open
  const goAuto = () => { try { mifasaAutoNews(); } catch (e) { /* optional */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", goAuto); else goAuto();
  setInterval(goAuto, 3 * 36e5 + 5000);
}
MifasaAI.webSources = {
  intent: mifasaMediaIntent, get: mifasaWsGet, newsHtml: mifasaNewsHtml, autoNews: mifasaAutoNews, html: mifasaMediaHtml, ping: mifasaWsPing, exportCache: mifasaWsExport,
  setEnabled: on => { MIFASA_WS.enabled = !!on; },
  clearCache: () => writeLS(MIFASA_WS.cacheKey, {}),
  status: () => ({ enabled: MIFASA_WS.enabled, net: MIFASA_WS.net, providers: Object.fromEntries([...MIFASA_WS.state].map(([k, v]) => [k, (v.until > Date.now() ? "resting until " + new Date(v.until).toLocaleTimeString() : "ok") + (v.err ? " (last error: " + v.err + ")" : "")])) }),
  downloadCache: () => { try { const b = new Blob([JSON.stringify(mifasaWsExport(), null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "web_cache.json"; a.click(); } catch (e) { console.warn("MIFASA web cache download", e); } }
};

/* ---------------------------------------------------------- */
/* 265. CRAWL BOX: "Amakuru yo kuri izindi mbuga:"            */
/* Shown at the TOP of the home page, above our own news.     */
/* Data: crawl-news.json (written by crawl.js, flagged        */
/* _external in parts/060). Only title + short summary + link */
/* to the owner's site are shown, never the full story.       */
/* Optional: put <div id="mifasaCrawlNews"></div> anywhere in */
/* index.html to choose the place yourself.                   */
/* ---------------------------------------------------------- */
const MIFASA_CRAWL_BOX = { id: "mifasaCrawlNews", first: 8, step: 8, max: 40 };
let mifasaCrawlShown = MIFASA_CRAWL_BOX.first;
let mifasaCrawlCat = "all";
const MIFASA_CRAWL_CATS = {                                                   // filter buttons (only those that have items are shown)
  news:          { rw: "Amakuru",        en: "News" },
  politics:      { rw: "Politiki",       en: "Politics" },
  sports:        { rw: "Imikino",        en: "Sports" },
  entertainment: { rw: "Imyidagaduro",   en: "Entertainment" },
  tech:          { rw: "Ikoranabuhanga", en: "Tech" },
  health:        { rw: "Ubuzima",        en: "Health" },
  business:      { rw: "Ubukungu",       en: "Business" },
  science:       { rw: "Siyansi",        en: "Science" },
  world:         { rw: "Isi",            en: "World" }
};
/* "politics" and "africa" are not feed categories: they are found from the words of the story / the name of the source */
const MIFASA_POLITICS_RE = /\b(perezida|president|minisitiri|minister|guverinoma|government|politiki|politic\w*|amatora|election\w*|inteko|parliament|senat\w*|abadepite|depite|ubutegetsi|opposition|ambasaderi|ambassador|diplomat\w*|treaty|ceasefire|sanctions|inama nkuru|summit)\b/i;
/* Feeds like Kigali Today / BBC Gahuza are one general "news" feed, so the category is also found from the words of the story. */
const MIFASA_CAT_WORDS = {
  sports:        /\b(umupira|imikino|umukino|ikipe|abakinnyi|umukinnyi|shampiyona|igikombe|rayon|apr fc|amavubi|caf|fifa|uefa|olempike|olympic\w*|football|soccer|goal|league|tennis|basketball|cycling|tour du rwanda|siporo|sports?)\b/i,
  entertainment: /\b(umuhanzi|abahanzi|indirimbo|filime|sinema|imyidagaduro|album|concert|film|movie|music|musician|celebrit\w*|actor|actress|singer)\b/i,
  health:        /\b(ubuzima|indwara|ibitaro|ivuriro|amavuriro|umuti|inkingo|urukingo|virusi|malariya|sida|oms|health|hospital|disease|vaccine\w*|cancer|ebola|cholera|marburg)\b/i,
  business:      /\b(ubukungu|banki|ifaranga|ishoramari|isoko|ubucuruzi|business|economy|economic|market\w*|bank\w*|inflation|trade|investment|imports?|exports?)\b/i,
  tech:          /\b(ikoranabuhanga|telefoni|murandasi|internet|porogaramu|ai|tech\w*|software|cyber\w*|startup|smartphone|robot\w*|digital)\b/i
};
function mifasaCrawlCatsOf(a) {                                                  // every category a story belongs to
  const out = [String(a.category || "news").toLowerCase()];
  const text = String((a.title || "") + " " + (a.summary || ""));
  for (const k in MIFASA_CAT_WORDS) if (out.indexOf(k) < 0 && MIFASA_CAT_WORDS[k].test(text)) out.push(k);
  if (MIFASA_POLITICS_RE.test(text)) out.push("politics");
  return out;
}
function mifasaCrawlCatMatch(a, cat) {
  if (!cat || cat === "all") return true;
  if (cat === "africa") return /africa/i.test(a.source || "");
  return mifasaCrawlCatsOf(a).indexOf(cat) >= 0;
}
function mifasaCrawlSetCat(cat) { mifasaCrawlCat = cat; mifasaCrawlShown = MIFASA_CRAWL_BOX.first; mifasaPaintCrawlBox(); }

function mifasaCrawlItems() {
  const out = [];
  for (let i = 0; i < allNews.length && out.length < MIFASA_CRAWL_BOX.max; i++) if (allNews[i] && allNews[i]._external) out.push(allNews[i]);
  return out;
}

function mifasaCrawlBoxEl() {
  if (typeof document === "undefined") return null;
  let b = document.getElementById(MIFASA_CRAWL_BOX.id);
  if (b) return b;
  if (!document.getElementById("hotTitle")) return null;                       // auto-create only on the home page ...
  try { if (!/(^|\/)(index\.html)?$/i.test(location.pathname)) return null; } catch (e) {}   // ... and only there (other pages: add <div id="mifasaCrawlNews" data-category="sports"></div> yourself)
  const grid = document.getElementById("latestNews");
  if (!grid || !grid.parentNode) return null;
  b = document.createElement("div"); b.id = MIFASA_CRAWL_BOX.id;
  let anchor = grid.previousElementSibling && /section-title/.test(grid.previousElementSibling.className || "") ? grid.previousElementSibling : grid;
  const web = document.getElementById("mifasaWebNews");                        // weekly web-news box: we sit above it too
  if (web && web.parentNode === anchor.parentNode) anchor = web;
  anchor.parentNode.insertBefore(b, anchor);
  return b;
}

function mifasaCrawlPic(a) {                                                   // real picture from the feed, or "" (never default.jpg)
  const u = a && (a.thumbnail || a.image) ? String(a.thumbnail || a.image) : "";
  return /^https?:\/\//i.test(u) && !/(^|\/)default\.jpg$/i.test(u) ? u : "";
}
function mifasaDropBrokenPics(root) {                                          // hotlink blocked / picture gone: just hide it
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("img[data-ext-pic]").forEach(i => i.addEventListener("error", () => i.remove(), { once: true }));
}

function mifasaCrawlFresh(all, en) {                                           // "Latest: 05 Nov, 07:42 · " (only when the story has a real time)
  let best = null;
  for (const a of all) if (String(a.date || "").length > 10 && (!best || (a._ts || 0) > (best._ts || 0))) best = a;
  if (!best || !best._ts) return "";
  const d = new Date(best._ts);
  const t = d.toLocaleString(en ? "en-GB" : "rw-RW", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (en ? "Latest story: " : "Inkuru ya nyuma: ") + escapeHTML(t) + " · ";
}

function mifasaCrawlCardHTML(a) {
  const pic = mifasaCrawlPic(a);
  const link = safeHref(a.link, "");
  const date = String(a.date || "").slice(0, 10);
  const sum = String(getSummary(a) || "");
  const short = sum.length > 180 ? sum.slice(0, 180).replace(/\s+\S*$/, "") + "…" : sum;
  const en = currentLang === "en";
  return `
    <div class="card">
      ${pic ? mifasaVideoWrap(a, `<img data-ext-pic src="${escapeHTML(pic)}" alt="${escapeHTML(getTitle(a))}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="width:100%;height:180px;object-fit:cover;">`) : ""}
      <small style="opacity:.75;display:block;padding:6px 2px 0">🌐 ${escapeHTML(a.source || "")}${date ? " · " + escapeHTML(date) : ""}</small>
      <h3>${escapeHTML(getTitle(a))}</h3>
      <p>${escapeHTML(short)}</p>
      <div>
        ${link && link !== "#" ? `<a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${en ? "Read at source →" : "Soma ku rubuga →"}</a>` : ""}
        <button type="button" data-audio-id="${escapeHTML(a.share_id)}">🔊 ${en ? "Listen" : "Umva"}</button>
      </div>
    </div>`;
}

function mifasaPaintCrawlBox() {
  const box = mifasaCrawlBoxEl();
  if (!box) return;
  if (mifasaCrawlInHome() && !(box.getAttribute && box.getAttribute("data-category"))) { box.innerHTML = ""; return; }   // crawled news is already in the main list: no second box on the home page
  const all = mifasaCrawlItems();
  if (!all.length) { box.innerHTML = ""; return; }
  const en = currentLang === "en";
  const fixed = String((box.getAttribute && box.getAttribute("data-category")) || "").toLowerCase();   // page chose its own category
  const counts = {};
  all.forEach(a => mifasaCrawlCatsOf(a).forEach(c => { counts[c] = (counts[c] || 0) + 1; }));
  const cat = fixed && fixed !== "all" ? fixed : mifasaCrawlCat;
  if (cat !== "all" && !fixed && !counts[cat]) mifasaCrawlCat = "all";                  // category vanished after a new crawl
  const active = fixed && fixed !== "all" ? fixed : mifasaCrawlCat;
  const items = all.filter(a => mifasaCrawlCatMatch(a, active));
  if (!items.length) { box.innerHTML = ""; return; }
  const shown = items.slice(0, mifasaCrawlShown);
  const chip = (key, label, n) => `<button type="button" data-crawl-cat="${escapeHTML(key)}" style="margin:3px;padding:6px 12px;border-radius:999px;border:1px solid currentColor;background:none;color:inherit;cursor:pointer;opacity:${active === key ? 1 : .65};font-weight:${active === key ? 700 : 400}">${escapeHTML(label)} (${n})</button>`;
  const chips = !fixed && Object.keys(counts).length > 1
    ? `<div style="text-align:center;margin:6px 0 10px">${chip("all", en ? "All" : "Byose", all.length)}${Object.keys(MIFASA_CRAWL_CATS).filter(k => counts[k]).concat(Object.keys(counts).filter(k => !MIFASA_CRAWL_CATS[k])).map(k => chip(k, MIFASA_CRAWL_CATS[k] ? MIFASA_CRAWL_CATS[k][en ? "en" : "rw"] : k, counts[k])).join("")}</div>`
    : "";
  const cls = latestNewsBox && latestNewsBox.className ? ` class="${escapeHTML(latestNewsBox.className)}"` : ` style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px"`;
  box.innerHTML =
    `<h2 class="section-title">📡 ${en ? "News from other websites" : "Amakuru ava kuzindi mbuga"}</h2>` + chips +
    `<div${cls}>${shown.map(mifasaCrawlCardHTML).join("")}</div>` +
    `<p style="text-align:center;font-size:.8em;opacity:.7;margin:8px 0">${mifasaCrawlFresh(all, en)}${en ? "Headlines from their owners' websites. Tap to read the full story at the source." : "Imitwe y'inkuru zo ku mbuga zaba nyirazo. Kanda kugira ngo usome inkuru yose ku rubuga rwa nyirayo."}</p>` +
    (items.length > shown.length ? `<div style="text-align:center;margin:8px 0"><button type="button" data-crawl-more>${en ? "Show more ↓" : "Ongeraho ↓"}</button></div>` : "");
  attachCardAudioHandlers(box);
  mifasaDropBrokenPics(box);
  box.querySelectorAll("[data-crawl-cat]").forEach(b => b.addEventListener("click", () => mifasaCrawlSetCat(b.getAttribute("data-crawl-cat"))));
  const more = box.querySelector("[data-crawl-more]");
  if (more) more.addEventListener("click", () => { mifasaCrawlShown += MIFASA_CRAWL_BOX.step; mifasaPaintCrawlBox(); });
}

/* ---- Ticker: our news + the 20 newest crawled items, each crawled one with its picture and its source ---- */
function mifasaTickerNews() {
  const own = mifasaHomeNews(), ext = [];
  if (mifasaCrawlInHome()) return own.slice().sort((a, b) => (b._ts || 0) - (a._ts || 0)).slice(0, 30);   // already contains the crawled stories
  for (let i = 0; i < allNews.length && ext.length < 20; i++) if (allNews[i] && allNews[i]._external) ext.push(allNews[i]);
  return ext.length ? own.concat(ext).sort((a, b) => (b._ts || 0) - (a._ts || 0)) : own;
}
function mifasaTickerItemHTML(n) {
  if (!n || !n._external) return `<span>⚡ ${escapeHTML(getTitle(n))}</span>`;
  const pic = mifasaCrawlPic(n);
  return `<span>${pic ? `<img data-ext-pic src="${escapeHTML(pic)}" alt="" referrerpolicy="no-referrer" style="height:1.5em;width:auto;max-width:3.2em;object-fit:cover;vertical-align:middle;border-radius:4px;margin-right:6px">` : "⚡ "}<b>${escapeHTML(n.source || "")}</b>: ${escapeHTML(getTitle(n))}</span>`;
}

/* ---- Hot news hero: the freshest stories of BOTH worlds (ours + other sites), newest first ---- */
let mifasaHotSrc = null, mifasaHotList = [];
function mifasaHotNews() {
  if (mifasaHotSrc !== allNews) {
    mifasaHotSrc = allNews;
    const own = mifasaHomeNews(), ext = [];
    if (mifasaCrawlInHome()) { mifasaHotList = own.slice().sort((a, b) => (b._ts || 0) - (a._ts || 0)).slice(0, 20); return mifasaHotList; }   // already contains the crawled stories
    for (let i = 0; i < allNews.length && ext.length < 8; i++) if (allNews[i] && allNews[i]._external) ext.push(allNews[i]);
    mifasaHotList = ext.length ? own.slice(0, 12).concat(ext).sort((a, b) => (b._ts || 0) - (a._ts || 0)) : own;   // no other-site news: exactly as before
  }
  return mifasaHotList;
}
/* ---------------------------------------------------------- */
/* 266. CRAWL BRAIN: lets MIFASA AI answer from the crawled    */
/* news and LEARN words from it.                               */
/*  - "amakuru ya siporo", "incamake y'umunsi" -> real stories  */
/*    (title + source + link) from crawl-news.json             */
/*  - "ijambo ry'umunsi", "X rikoreshwa gute", "itandukaniro   */
/*    ry'amagambo X na Y" -> uses crawl-words.json (words that */
/*    really appear in Kinyarwanda news, with example headlines */
/*    and the words they travel with) + the dictionary/lexicon */
/* Nothing is invented: if the data is missing, tools return   */
/* null and the normal brain answers.                          */
/* ---------------------------------------------------------- */
const MIFASA_CW = { map: new Map(), list: [], loaded: false, stories: 0, date: "" };

async function mifasaCrawlWordsLoad() {
  try {
    const res = await fetchWithTimeout("crawl-words.json", 10000, "no-store");
    if (!res.ok) return 0;
    const j = await res.json();
    if (!j || !Array.isArray(j.words)) return 0;
    MIFASA_CW.map = new Map(); MIFASA_CW.list = [];
    j.words.forEach(e => { if (e && e.w) { MIFASA_CW.map.set(mifasaNorm(e.w), e); MIFASA_CW.list.push(e); } });
    MIFASA_CW.loaded = MIFASA_CW.list.length > 0; MIFASA_CW.stories = j.stories || 0; MIFASA_CW.date = j.generated || "";
    return MIFASA_CW.list.length;
  } catch (e) { return 0; }
}

/* ---------- A. news from other sites ---------- */
const MIFASA_NEWS_CATS = [                                  // [words people type, category key, rw label, en label, rw phrase]
  [/^(politiki|politics|politike)$/, "politics", "Politiki", "Politics", "ya politiki"],
  [/^(imikino|siporo|sports?)$/, "sports", "Imikino", "Sports", "y'imikino"],
  [/^(imyidagaduro|entertainment|showbiz)$/, "entertainment", "Imyidagaduro", "Entertainment", "y'imyidagaduro"],
  [/^(ikoranabuhanga|tech|technology)$/, "tech", "Ikoranabuhanga", "Tech", "y'ikoranabuhanga"],
  [/^(ubuzima|health)$/, "health", "Ubuzima", "Health", "y'ubuzima"],
  [/^(ubukungu|business|economy)$/, "business", "Ubukungu", "Business", "y'ubukungu"],
  [/^(siyansi|science)$/, "science", "Siyansi", "Science", "ya siyansi"],
  [/^(isi|world)$/, "world", "Isi", "World", "y'isi"],
  [/^(africa|afurika)$/, "africa", "Afurika", "Africa", "ya afurika"]
];
function mifasaCleanLabel(t) { return String(t || "").replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120); }

/* Nothing from other sites for this subject: never talk about "the crawl". Offer our own stories on it, else say there is none right now. */
function mifasaNewsNothing(cat) {
  const label = cat ? cat[2] : "";
  let own = [];
  try {
    if (cat && typeof mifasaSearch === "function") {
      own = mifasaSearch(label + (cat[3] ? " " + cat[3] : ""), 8).hits.filter(h => h && h.article && !h.article._core && !h.article._external).slice(0, 3).map(h => h.article);
    }
  } catch (e) { own = []; }
  const list = own.map((a, i) => { const link = safeHref(a.link || a.url || "", ""); const t = mifasaCleanLabel(getTitle(a)); return `${i + 1}. ${link && link !== "#" ? `[${t}](${link})` : t}`; }).join("\n");
  const rw = cat
    ? `📡 Nta makuru mashya **${cat[4]}** mbonye ubu.${list ? "\n\nDore inkuru zacu zihuye na yo:\n" + list : "\n\nGerageza ikindi cyiciro (politiki, imikino, ubuzima, ubukungu) cyangwa umbaze izina ry'ikipe, umuntu cyangwa ahantu."}`
    : "📡 Nta makuru mashya ava ku zindi mbuga mbonye ubu. Gerageza ikindi cyiciro cyangwa umbaze ku nkuru runaka.";
  const en = cat
    ? `📡 I don't have fresh **${cat[3]}** stories right now.${list ? "\n\nHere are our own related stories:\n" + list : "\n\nTry another topic (politics, sports, health, business) or ask me about a team, a person or a place."}`
    : "📡 I don't have fresh stories from other websites right now. Try a topic or ask about a specific story.";
  return { rw, en };
}

function tryNewsFeed(raw) {
  const s = String(raw || "").toLowerCase().replace(/[’‘`]/g, "'").trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
  if (!s || s.length > 60) return null;
  let m, cat = null, digest = false, label = null;
  if ((m = s.match(/^(?:amakuru|inkuru|news)\s+(?:ya|y'|yo kuri|of|about|on)?\s*([a-z']+)$/))) {
    cat = MIFASA_NEWS_CATS.find(c => c[0].test(m[1]));
    if (!cat) return null;
  } else if ((m = s.match(/^(?:latest\s+)?([a-z]+)\s+news$/)) && MIFASA_NEWS_CATS.some(c => c[0].test(m[1]))) {      // "sports news", "tech news"
    cat = MIFASA_NEWS_CATS.find(c => c[0].test(m[1]));
  } else if (/^(?:amakuru|inkuru|news)\s+(?:ava|yo|aturuka)?\s*(?:kuri|ku|from)?\s*(?:izindi mbuga|zindi mbuga|other (?:sites|websites))$/.test(s)
    || /^(?:incamake y'umunsi|incamake y'amakuru|daily digest|news digest|top news|top stories|amakuru y'ingenzi)$/.test(s)) {
    digest = true;
  } else return null;
  const all = (typeof allNews !== "undefined" ? allNews : []).filter(a => a && a._external);
  let pool = cat ? all.filter(a => mifasaCrawlCatMatch(a, cat[1])) : all;
  if (!pool.length) return mifasaNewsNothing(cat);
  const wantRw = typeof currentLang === "undefined" || currentLang !== "en";
  pool = pool.slice().sort((a, b) => (b._ts || 0) - (a._ts || 0));
  const perSource = {}, pick = [];                      // newest first, at most 2 per source so one site cannot fill the list
  const prefer = pool.filter(a => (a.lang === "rw") === wantRw).concat(pool.filter(a => (a.lang === "rw") !== wantRw));
  for (const a of prefer) { const k = a.source || "?"; if ((perSource[k] || 0) >= 2) continue; perSource[k] = (perSource[k] || 0) + 1; pick.push(a); if (pick.length >= 6) break; }
  const lines = pick.map((a, i) => {
    const link = safeHref(a.link, "");
    const t = mifasaCleanLabel(getTitle(a));
    const date = String(a.date || "").slice(0, 10);
    return `${i + 1}. ${link && link !== "#" ? `[${t}](${link})` : t}\n   🌐 ${a.source || ""}${date ? " · " + date : ""}`;
  }).join("\n");
  const head = digest ? ["📡 **Incamake y'amakuru y'ingenzi** (ava ku zindi mbuga):", "📡 **Top stories** (from other websites):"]
                      : [`📡 **Amakuru ${cat[4]}** (ava ku zindi mbuga):`, `📡 **${cat[3]} news** (from other websites):`];
  const tail = ["\nKanda umutwe usome inkuru yose ku rubuga rwa nyirayo.", "\nTap a headline to read the full story at its source."];
  return { rw: head[0] + "\n" + lines + tail[0], en: head[1] + "\n" + lines + tail[1] };
}

/* ---------- A2. videos (YouTube) the crawler found: "videwo nshya", "trending videos", "amashusho ya siporo", "videwo za mifasarw" ---------- */
function tryVideoFeed(raw) {
  const s = String(raw || "").toLowerCase().replace(/[’‘`]/g, "'").trim().replace(/[?!.,]+$/g, "").replace(/\s+/g, " ");
  if (!s || s.length > 60 || !/(^|\s)(videwo|videos?|amashusho)(\s|$)/.test(s)) return null;
  const FILLER = /^(videwo|videos?|amashusho|nshya|zigezweho|zikunzwe|agezweho|trending|latest|new|top|popular|ya|za|y'|of|about|on|kuri|mu|rwanda|today|uyu|munsi|none|ndashaka|mpa|mbwira|nyereka|reba|show|me|the|i|want|to|see|watch|give|some|any|ziri|zose|byose|ibya|iby|zo|izo)$/;
  const rest = s.split(/\s+/).map(w => w.replace(/^(y'|z'|w'|n')/, "")).filter(w => w && !FILLER.test(w));   // "y'imikino" -> "imikino"
  let cat = null, onlyOurs = false;
  for (const w of rest) {
    if (/^(mifasarw|mifasa)$/.test(w)) { onlyOurs = true; continue; }
    const c = MIFASA_NEWS_CATS.find(c => c[0].test(w));
    if (c) { cat = c; continue; }
    return null;                                           // a real subject ("amashusho ya filime X"): not for this tool
  }
  const wantRw = typeof currentLang === "undefined" || currentLang !== "en";
  let pool = (typeof allNews !== "undefined" ? allNews : []).filter(a => a && a._external && a.video && a.video.id);
  if (onlyOurs) pool = pool.filter(a => /mifasarw/i.test(a.source || ""));
  if (cat) pool = pool.filter(a => mifasaCrawlCatMatch(a, cat[1]));
  if (!pool.length) {
    return { rw: onlyOurs ? "▶️ Nta videwo za MIFASARW mbonye ubu." : "▶️ Nta videwo zigezweho mbonye ubu. Gerageza nyuma gato.",
             en: onlyOurs ? "▶️ I don't see any MIFASARW videos right now." : "▶️ I don't have fresh videos right now. Try again in a little while." };
  }
  pool = pool.slice().sort((a, b) => (b._ts || 0) - (a._ts || 0));
  const perSource = {}, pick = [], seen = new Set();
  const prefer = pool.filter(a => (a.lang === "rw") === wantRw).concat(pool.filter(a => (a.lang === "rw") !== wantRw));
  for (const a of prefer) {
    if (seen.has(a.video.id)) continue;
    const k = a.source || "?"; if ((perSource[k] || 0) >= 3) continue;      // so one source cannot fill the list
    perSource[k] = (perSource[k] || 0) + 1; seen.add(a.video.id); pick.push(a); if (pick.length >= 6) break;
  }
  const lines = pick.map((a, i) => {
    const link = safeHref(a.link || ("https://www.youtube.com/watch?v=" + a.video.id), "");
    const t = mifasaCleanLabel(getTitle(a));
    const date = String(a.date || "").slice(0, 10);
    return `${i + 1}. ▶️ ${link && link !== "#" ? `[${t}](${link})` : t}\n   🎬 ${/trending/i.test(a.source || "") ? "YouTube · trending" : (a.source || "YouTube")}${date ? " · " + date : ""}`;
  }).join("\n");
  const tag = onlyOurs ? ["za MIFASARW", "from MIFASARW"] : (cat ? [cat[4], "(" + cat[3] + ")"] : ["zigezweho", "trending now"]);
  return { rw: `▶️ **Videwo ${tag[0]}**:\n${lines}\n\nUmutwe ukanzeho ufungura videwo kuri YouTube. Ushobora no kuzireba ku rupapuro rw'ibanze (kanda ▶ ku ifoto).`,
           en: `▶️ **Videos ${tag[1]}**:\n${lines}\n\nTap a title to watch on YouTube. You can also play them on the home page (tap ▶ on the picture).` };
}

/* ---------- B. learning words from real news ---------- */
function mifasaWordMeaning(k) {                           // dictionary / lexicon meaning for a normalized word, or ""
  try {
    const lx = typeof MIFASA_LEXICON !== "undefined" ? MIFASA_LEXICON.rw.get(k) : null;
    if (lx && lx.senses && lx.senses.length) return lx.senses.slice(0, 3).map(x => x[0]).join("; ");
    if (typeof mifasaDictRw !== "undefined" && !mifasaDictRw && typeof mifasaDictBuild === "function") mifasaDictBuild();
    const d = typeof mifasaDictRw !== "undefined" && mifasaDictRw ? mifasaDictRw.get(k) : null;
    if (d && d.en) return String(Array.isArray(d.en) ? d.en.slice(0, 3).join("; ") : d.en);
  } catch (e) {}
  return "";
}
function mifasaWordExamples(e, rwOnly) {
  return (e && e.ex ? e.ex : []).map(x => `• ${x.u ? `[${mifasaCleanLabel(x.t)}](${x.u})` : mifasaCleanLabel(x.t)}${x.s ? " — " + x.s : ""}`).join("\n");
}

/* Word of the day from MIFASA's own lexicon: always available (no crawl needed), the same word all day. */
function mifasaLexiconWordOfDay() {
  if (typeof MIFASA_LEXICON === "undefined" || !MIFASA_LEXICON.rw.size) return null;
  const pool = [];
  MIFASA_LEXICON.rw.forEach(e => { if (e && e.word && e.word.length >= 4 && !/\s/.test(e.word) && e.senses && e.senses.length && String(e.senses[0][0]).length < 40) pool.push(e); });
  if (!pool.length) return null;
  return pool[Math.floor(Date.now() / 864e5) % pool.length];
}
function tryWordOfDayLexicon(s) {
  if (!/^(?:ijambo ry'umunsi|ijambo rishya|ijambo rishya ry'umunsi|word of the day|new word|learn a word)$/.test(s)) return null;
  const e = mifasaLexiconWordOfDay(); if (!e) return null;
  const lines = e.senses.slice(0, 3).map((x, i) => `${i + 1}. **${x[0]}**${x[1] ? " — " + x[1] : ""}`).join("\n");
  return { rw: `📖 **Ijambo ry'umunsi: ${e.word}**\nRishobora gusobanura (mu Cyongereza):\n${lines}\n\nShaka irindi? Baza **"${e.word} rikoreshwa gute"** cyangwa **"ijambo rishya"** ejo.`,
           en: `📖 **Word of the day: ${e.word}** (Kinyarwanda)\nIt can mean:\n${lines}\n\nCome back tomorrow for a new one.` };
}

function tryWordNews(raw) {
  const s = String(raw || "").toLowerCase().replace(/[’‘`]/g, "'").trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
  if (!s || s.length > 80) return null;
  let m;
  if (!MIFASA_CW.loaded) return tryWordOfDayLexicon(s);          // crawl-words.json not there (yet): use the built-in lexicon

  // word of the day: a frequent word from today's Kinyarwanda news (same word all day)
  if (/^(?:ijambo ry'umunsi|ijambo rishya|ijambo rishya ry'umunsi|word of the day|new word|learn a word|amagambo mashya|new words)$/.test(s)) {
    const pool = MIFASA_CW.list.slice(0, 80).filter(e => e.ex && e.ex.length && (e.w || "").length >= 5);
    if (!pool.length) return tryWordOfDayLexicon(s);
    const e = pool[Math.floor(Date.now() / 864e5) % pool.length];
    const mean = mifasaWordMeaning(mifasaNorm(e.w));
    const rw = `📖 **Ijambo ry'umunsi: ${e.w}**\n${mean ? "Risobanura: " + mean : "Iri jambo riri mu makuru nyayo, ariko sindarimenya neza mu nkoranyamagambo yanjye."}\nRikoreshwa mu makuru:\n${mifasaWordExamples(e)}${e.ctx && e.ex ? "\nAmagambo ribana na yo: " + e.ctx.slice(0, 5).join(", ") : ""}`;
    const en = `📖 **Word of the day: ${e.w}**\n${mean ? "Meaning: " + mean : "This word appears in real news, but it is not in my dictionary yet."}\nSeen in the news:\n${mifasaWordExamples(e)}${e.ctx ? "\nOften appears with: " + e.ctx.slice(0, 5).join(", ") : ""}`;
    return { rw, en };
  }

  // how is a word used: "ubukungu rikoreshwa gute", "examples of ubukungu"
  if ((m = s.match(/^(?:ijambo\s+)?([a-zà-ÿ']{3,25})\s+(?:rikoreshwa|ryakoreshwa|rikoreshwa se)\s+gute(?:\s+mu makuru)?$/))
      || (m = s.match(/^(?:ingero za|ingero z'ijambo|examples? of(?: the word)?)\s+([a-zà-ÿ']{3,25})(?:\s+(?:mu makuru|in (?:the )?news))?$/))) {
    const k = mifasaNorm(m[1]), e = MIFASA_CW.map.get(k);
    if (!e) return null;
    const mean = mifasaWordMeaning(k);
    return {
      rw: `📖 **${e.w}** — ryagaragaye mu nkuru **${e.n}** z'amakuru yo mu Kinyarwanda.${mean ? "\nRisobanura: " + mean : ""}\n${mifasaWordExamples(e)}${e.ctx && e.ctx.length ? "\nRibana n'amagambo: " + e.ctx.join(", ") : ""}`,
      en: `📖 **${e.w}** — seen in **${e.n}** Kinyarwanda news stories.${mean ? "\nMeaning: " + mean : ""}\n${mifasaWordExamples(e)}${e.ctx && e.ctx.length ? "\nOften appears with: " + e.ctx.join(", ") : ""}`
    };
  }

  // telling two words apart: only when the person says "words" so we never steal "difference between Kigali and Nairobi"
  if ((m = s.match(/^itandukaniro (?:ry'amagambo|hagati y'amagambo|hagati y'ijambo|ry'ijambo)\s+([a-zà-ÿ']{3,25})\s+na\s+([a-zà-ÿ']{3,25})$/))
      || (m = s.match(/^difference between (?:the )?words?\s+([a-zà-ÿ']{3,25})\s+and\s+([a-zà-ÿ']{3,25})$/))) {
    const ka = mifasaNorm(m[1]), kb = mifasaNorm(m[2]);
    const ea = MIFASA_CW.map.get(ka), eb = MIFASA_CW.map.get(kb);
    const ma = mifasaWordMeaning(ka), mb = mifasaWordMeaning(kb);
    if (!(ea || ma) || !(eb || mb)) return null;
    const ca = new Set((ea && ea.ctx) || []), cb = new Set((eb && eb.ctx) || []);
    const only = (x, y) => [...x].filter(w => !y.has(w));
    const shared = [...ca].filter(w => cb.has(w));
    const side = (w, mean, e, mine, other) => `• **${w}**${mean ? " — " + mean : ""}${e ? ` (mu nkuru ${e.n})` : ""}${mine.length ? "\n   Ribana na: " + mine.join(", ") : ""}`;
    const sideEn = (w, mean, e, mine) => `• **${w}**${mean ? " — " + mean : ""}${e ? ` (in ${e.n} stories)` : ""}${mine.length ? "\n   Appears with: " + mine.join(", ") : ""}`;
    const oa = only(ca, cb), ob = only(cb, ca);
    return {
      rw: `🔎 **${m[1]}** na **${m[2]}** — ikinyuranyo gishingiye ku makuru nyayo n'inkoranyamagambo:\n${side(m[1], ma, ea, oa)}\n${side(m[2], mb, eb, ob)}${shared.length ? "\nAmagambo bombi bahuriraho: " + shared.join(", ") : ""}\n(Ni ishusho ishingiye ku mikoreshereze yo mu makuru, ntabwo ari ibisobanuro bya gihanga byuzuye.)`,
      en: `🔎 **${m[1]}** vs **${m[2]}** — based on real news and the dictionary:\n${sideEn(m[1], ma, ea, oa)}\n${sideEn(m[2], mb, eb, ob)}${shared.length ? "\nShared context words: " + shared.join(", ") : ""}\n(This reflects how the words are used in the news, not a full linguistic definition.)`
    };
  }
  return null;
}

if (typeof document !== "undefined" && typeof setTimeout === "function") setTimeout(() => { try { mifasaCrawlWordsLoad(); } catch (e) {} }, 3000);

/* ---------- C. LIVE REFRESH: the open page picks up new crawled stories by itself (no reload) ---------- */
/* Every 3 minutes (only while the tab is visible) the browser asks the server whether crawl-news.json changed.        */
/* The server answers "unchanged" (304) almost for free; only when there is something new is the file downloaded.      */
/* If the server gives no way to tell (no ETag / Last-Modified) we ask only every 15 minutes, to protect mobile data.   */
const MIFASA_LIVE = { file: "crawl-news.json", fast: 3 * 60 * 1000, slow: 15 * 60 * 1000, rec: null, busy: false, last: 0, timer: null };

async function mifasaLiveRefresh(force) {
  if (MIFASA_LIVE.busy) return false;
  if (typeof document !== "undefined" && document.hidden && !force) return false;                      // nobody is looking
  const gap = MIFASA_LIVE.rec && !(MIFASA_LIVE.rec.etag || MIFASA_LIVE.rec.lm) ? MIFASA_LIVE.slow : MIFASA_LIVE.fast;
  if (!force && Date.now() - MIFASA_LIVE.last < gap - 1000) return false;
  MIFASA_LIVE.busy = true; MIFASA_LIVE.last = Date.now();
  try {
    const res = await fetchFileRecord(MIFASA_LIVE.file, MIFASA_LIVE.rec, "no-cache");
    if (!res || !res.changed) return false;
    MIFASA_LIVE.rec = res.record;
    ingestFile(MIFASA_LIVE.file, res.record.data);
    if (mifasaFileOrder.indexOf(MIFASA_LIVE.file) < 0) mifasaFileOrder.push(MIFASA_LIVE.file);
    rebuildAllNews();
    paintUI(false);
    try { idbSet(MIFASA_LIVE.file, res.record); } catch (e) {}
    try { mifasaCrawlWordsLoad(); } catch (e) {}                                                       // words follow the news
    return true;
  } catch (e) { return false; }
  finally { MIFASA_LIVE.busy = false; }
}
function mifasaLiveStart() {
  if (MIFASA_LIVE.timer || typeof setInterval !== "function") return;
  MIFASA_LIVE.timer = setInterval(() => { mifasaLiveRefresh(false); }, 60 * 1000);                     // wakes every minute, asks only when the gap has passed
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", () => { if (!document.hidden) mifasaLiveRefresh(false); });
  setTimeout(() => { mifasaLiveRefresh(true); }, 20000);                                              // first check 20 s after the page opened
}
if (typeof document !== "undefined") mifasaLiveStart();


/* ---------- D. small talk to the assistant (honest and short) ---------- */
function trySmallTalk(raw) {
  const s = String(raw || "").toLowerCase().replace(/[’‘`]/g, "'").trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
  if (!s || s.length > 60) return null;
  if (/^(?:are you|r u|are u)\s+(?:feeling\s+|doing\s+)?(?:good|ok|okay|fine|well|alright|happy|great)(?:\s+(?:today|now|right now))?$/.test(s) || /^(?:uri|urameze|umeze)\s+neza(?:\s+uyu munsi)?$/.test(s) || /^(?:uriteguye|wumva umeze ute)(?:\s+uyu munsi)?$/.test(s)) {
    return { rw: "😊 Ndi umufasha w'ubwenge buhangano, ntumva nk'abantu, ariko ndi mu murongo kandi niteguye kugufasha! Wowe se umeze ute uyu munsi?",
             en: "😊 I'm an AI assistant, so I don't feel things the way people do, but I'm up and ready to help! How are you today?" };
  }
  if (/^(?:are you|r u|are u)\s+(?:a\s+|an\s+)?(?:human|real person|person|real|robot|bot|ai|alive)$/.test(s) || /^(?:uri|urumuntu|uri umuntu)(?:\s+nyawe|\s+koko)?$/.test(s) && /umuntu/.test(s)) {
    return { rw: "🤖 Ndi MIFASA AI, umufasha w'ubwenge buhangano wa MIFASARW, wakozwe na Mifasa Mizero Fabrice Samuel. Si umuntu, kandi nshobora kwibeshya, rero genzura amakuru y'ingenzi.",
             en: "🤖 I'm MIFASA AI, an AI assistant for MIFASARW made by Mifasa Mizero Fabrice Samuel. I'm not a person, and I can make mistakes, so please double-check important facts." };
  }
  if (/^(?:can you|could you|will you)\s+help(?:\s+me)?$/.test(s) || /^(?:ushobora|urashobora)\s+kumfasha$/.test(s)) {
    return { rw: "Yego, nshobora kugufasha. 😊 Mbwira icyo ukeneye: amakuru, ibisobanuro, imibare, amagambo cyangwa gusoma link.", en: "Yes, I can help. 😊 Tell me what you need: news, explanations, maths, words, or reading a link." };
  }
  return null;
}
/* ---------------------------------------------------------- */
/* 13c. SELF-TEST: MifasaAI.runTests("mifasa_tests.json")     */
/* Reads question -> expected words, asks the AI, reports.    */
/* ---------------------------------------------------------- */
async function mifasaRunTests(file, opts) {
  opts = opts || {};
  const mode = opts.mode === "any" ? "any" : "all";          // "all" = every expected word must appear
  let data;
  try {
    const res = await fetchWithTimeout(file || "mifasa_tests.json", 10000, "no-store");
    if (!res.ok) return { ok: false, error: "HTTP " + res.status };
    data = await res.json();
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }

  // accepted shapes: [{q, expect}] | {tests:[...]} | {"question": "word1, word2"} | [["question", ["w1","w2"]]]
  let list = Array.isArray(data) ? data : (data && Array.isArray(data.tests) ? data.tests : null);
  if (!list && data && typeof data === "object") list = Object.keys(data).map(k => ({ q: k, expect: data[k] }));
  if (!Array.isArray(list)) return { ok: false, error: "Unrecognised test file format" };

  await new Promise(r => MifasaAI.whenReady(r, 20000));
  const textOf = h => new DOMParser().parseFromString(String(h || ""), "text/html").body.textContent.toLowerCase();

  const failures = [];
  let total = 0, pass = 0;
  for (let t of list) {
    if (Array.isArray(t)) t = { q: t[0], expect: t[1] };
    if (!t || typeof t !== "object") continue;
    const q = t.q || t.question || t.input || t.ask || t.query;
    let exp = t.expect != null ? t.expect : t.expected != null ? t.expected : t.contains != null ? t.contains
            : t.words != null ? t.words : t.keywords != null ? t.keywords : t.answer != null ? t.answer : t.a;
    if (!q || exp == null) continue;
    exp = (Array.isArray(exp) ? exp : String(exp).split(/\s*[|;]\s*|\s*,\s*/))
      .map(x => String(x).toLowerCase().trim()).filter(Boolean);
    if (!exp.length) continue;

    mifasaConv = { query: "", offset: 0 };                     // every test starts without follow-up context
    let ans = "";
    try { const r = mifasaAskApi(String(q), 6); ans = textOf(r && r.html); }
    catch (e) { ans = "error: " + ((e && e.message) || e); }

    const missing = exp.filter(w => !ans.includes(w));
    const ok = mode === "any" ? missing.length < exp.length : missing.length === 0;
    total++;
    if (ok) pass++; else failures.push({ question: q, missing: missing.join(", "), got: ans.slice(0, 160) });
  }
  mifasaConv = { query: "", offset: 0 };
  const rate = total ? Math.round((pass / total) * 1000) / 10 : 0;
  if (typeof console !== "undefined") {
    console.log(`MIFASA tests: ${pass}/${total} passed (${rate}%)`);
    if (failures.length && console.table) console.table(failures.slice(0, 60));
  }
  return { ok: true, mode, total, pass, failed: failures.length, rate, failures };
}

MifasaAI.runTests = mifasaRunTests;
MifasaAI.safeHref = safeHref;
MifasaAI.isPrivateHost = mifasaIsPrivateHost;

MifasaAI.readLink = mifasaReadLink;
MifasaAI.askAsync = mifasaAskAsync;
MifasaAI.addDictionary = mifasaAddDictionary;
MifasaAI.loadDictionary = mifasaLoadDictionary;
MifasaAI.unknownWords = mifasaUnknownRead;
MifasaAI.exportUnknownWords = mifasaExportUnknown;
MifasaAI.downloadUnknownWords = mifasaDownloadUnknown;
MifasaAI.clearUnknownWords = () => writeLS(MIFASA_UNKNOWN_KEY, []);
MifasaAI.translateToEnglish = mifasaBridgeEn;
MifasaAI.analyzeNews = mifasaAnalyzeText;
MifasaAI.siteInfo = trySiteInfo;
MifasaAI.webResearch = mifasaWebResearch;
MifasaAI.addLessons = list => mifasaSetLessons(list);
MifasaAI.setPublicReaders = on => { MIFASA_LINK_READER.useReaders = !!on; MIFASA_WEB.enabled = !!on; };
MifasaAI.askWithLink = mifasaAskWithLink;
MifasaAI.linkReaderStatus = () => ({
  enabled: true,
  mode: "browser-fetch; no external model/API",
  corsRequired: true,
  recentPages: MIFASA_LINK_READER.pages.map(p => ({ url: p.url, title: p.title, readAt: p.readAt }))
});

if (typeof window !== "undefined") {
  window.MifasaAI = MifasaAI;
  if (!MIFASA_API_ONLY) {
    // Pages that use script.js normally (index.html, politics.html, ...) still find their globals.
    Object.assign(window, { absoluteUrl, askMifasaAI, safeHref, attachCardAudioHandlers, boundedEdit, brainCanon, brainCompileIntent, brainFill, brainFixQuery, brainHas, brainLabel, brainPatternScore, brainQType, mifasaAnalyzeQuestion, mifasaRelevantFollowups, brainScoreAll, brainScoreIntent, brainStrList, brainThenQuery, brainToks, brainVars, buildComparison, buildSearchIndex, buildShareText, buildSynonymMap, changeTheme, collectBodyText, compareSide, detectGreeting, detectQueryLang, discoverJSONFiles, doSearch, doSearchCore, emptySearch, ensureIndex, escapeHTML, expandTerm, extractItemsFromJSON, extractTrends, fetchFileRecord, fetchWithTimeout, fillSearch, friendlyCategory, generateSlug, getArticleCategory, getArticleId, getCoreDocs, getFileBaseName, getMifasaGreeting, getMifasaUserName, getQueryParam, getSearchHistory, getSummary, getTimeOfDay, getTitle, getVisitInfo, idbGetAll, idbSet, indexTokens, ingestFile, kigaliNow, learnUserName, levenshtein, loadDailyNews, loadHotNews, loadLatestNews, loadSearchData, loadTicker, lowerBound, mifasaAnswerBox, mifasaAskApi, mifasaAskCore, mifasaBrainApplySources, mifasaBrainAnalyze, mifasaBrainButtons, mifasaBrainFactDocs, mifasaBrainFallback, mifasaBrainLoad, mifasaBrainLoadSingle, mifasaMergeBrainModules, mifasaBrainMatch, mifasaBrainRespond, mifasaCoreLoad, mifasaCoreMatch, mifasaCoreRespond, mifasaLearningClear, mifasaLearningExport, mifasaLearningRead, mifasaLearningWrite, mifasaFindLearnedAnswer, mifasaRateLearning, mifasaTeach, mifasaTokenOverlap, mifasaDB, mifasaEvalExpr, mifasaFormatNumber, mifasaInjectBrand, mifasaIsBrainFile, mifasaLatestSearch, mifasaNorm, mifasaNotify, mifasaSearch, mifasaSignature, mifasaSiteUrl, mifasaSmartTool, mifasaSocialLinks, normalizeArticle, normalizeUrl, onDataReady, paintUI, pickAnswerSentences, pickVariant, playArticleAudio, questionBoost, readLS, rebuildAllNews, removeDuplicates, renderAIText, renderCardHTML, renderNextNewsPage, renderSuggestions, runPool, saveSearchHistory, scheduleIndexBuild, setLanguage, shareArticle, showSearchHistory, splitLatestIntent, splitSentences, startTrending, toggleAudio, tokenize, topicSuggestions, tryCalculate, tryConvert, tryDates, tryNumberWords, tryMathExtras, tryRandom, tryDictionary, mifasaPrecise, mifasaResolveFollowUp, mifasaLogMiss, mifasaGetMisses, tryCompare, tryDateTime, updateAllLinksWithLang, wordSimilarity, writeLS });
    Object.defineProperty(window, "currentLang", { get: () => currentLang, set: v => { currentLang = v; }, configurable: true });
    Object.defineProperty(window, "allNews", { get: () => allNews, configurable: true });
  }
}

// API-only pages have no DOMContentLoaded UI step: start loading data straight away
if (MIFASA_API_ONLY) loadSearchData();

// the extra Kinyarwanda -> English dictionary (dictionary.json) helps the AI understand what was typed
mifasaLoadDictionary();

/* MIFASA part 280: AI y'ubuntu (via proxy) ikoreshwa GUSA iyo AI ya MIFASARW ibuze igisubizo.
   Iyo window.MIFASA_LLM_URL itashyizweho, iyi mikorere irahagarara (ntacyo ihindura). */
const MIFASA_LLM = { day: "", n: 0, busy: false, perDay: 12, history: [] };

function mifasaLlmQuota() {
  const day = new Date().toISOString().slice(0, 10);
  try { const s = JSON.parse(localStorage.getItem("mifasa_llm_q") || "{}"); MIFASA_LLM.day = s.day === day ? day : day; MIFASA_LLM.n = s.day === day ? (s.n || 0) : 0; } catch (e) { MIFASA_LLM.n = 0; }
  return MIFASA_LLM.n < MIFASA_LLM.perDay;
}
function mifasaLlmCount() {
  MIFASA_LLM.n++;
  try { localStorage.setItem("mifasa_llm_q", JSON.stringify({ day: MIFASA_LLM.day, n: MIFASA_LLM.n })); } catch (e) {}
}

/* Ubumenyi bwa MIFASA (ai.json, knowledge, amakuru ya crawl) bwoherezwa kuri LLM kugira ngo isubize ishingiye kuri byo. */
function mifasaLlmContext(raw) {
  const out = [];
  try {
    const sc = brainScoreAll(raw);                                   // intent yegeranye cyane muri ai*.json
    if (sc && sc[0] && sc[0].s >= 0.45) {
      const it = sc[0].it, en = currentLang === "en";
      const a = (en ? (it.answer_en || it.answer_rw) : (it.answer_rw || it.answer_en)) || it.answer;
      const txt = Array.isArray(a) ? a[0] : a;
      if (txt) out.push({ src: "brain", text: String(txt).replace(/\s+/g, " ").slice(0, 400) });
    }
  } catch (e) {}
  try {
    const hits = (mifasaSearch(raw, 6).hits || []).slice(0, 4);     // knowledge + amakuru ya crawl
    for (const h of hits) {
      const a = h.article; if (!a || h.cov < 0.5) continue;
      const t = (getTitle(a) + ": " + getSummary(a)).replace(/\s+/g, " ").trim();
      if (t.length > 20) out.push({ src: (a._core || a._knowledge) ? "knowledge" : "news", text: t.slice(0, 400) });
    }
  } catch (e) {}
  const nm = typeof mifasaConvName === "function" ? mifasaConvName() : "";
  try {
    const mem = typeof mifasaMemContext === "function" ? mifasaMemContext() : "";
    if (mem) out.unshift({ src: "user_memory", text: "Things the user told you earlier (long-term memory, use only when relevant): " + mem });
    const coach = typeof mifasaCoachHint === "function" ? mifasaCoachHint(raw) : "";
    if (coach) out.unshift({ src: "style", text: coach });
  } catch (e) {}
  if (nm) out.unshift({ src: "user", text: "The user's name is " + nm + ". You may use it naturally now and then; do not overuse it." });
  return out.slice(0, 7);
}

async function mifasaLlmAnswer(raw, opt) {          // opt.web = "search": force a live web search on the server
  const url = typeof window !== "undefined" && window.MIFASA_LLM_URL;
  if (typeof mifasaLearnLookup === "function") { const mem = await mifasaLearnLookup(raw, opt); if (mem) return mem; }      // saved answers work even without a URL or quota (part 295)
  if (!url || MIFASA_LLM.busy || !mifasaLlmQuota()) return null;
  const en = (detectQueryLang(raw) || currentLang) === "en";
  MIFASA_LLM.busy = true;
  const prevQ = (() => { for (let i = MIFASA_CONV.turns.length - 1; i >= 0; i--) if (MIFASA_CONV.turns[i].r === "u") return MIFASA_CONV.turns[i].t; return ""; })();
  const ctx = mifasaLlmContext(prevQ && mifasaConvIsFollowUp(raw) ? prevQ + " " + raw : raw);      // a follow-up is searched together with the question before it
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ q: raw, q_en: (typeof mifasaLearnPivot === "function" ? mifasaLearnPivot(raw) : undefined), lang: en ? "en" : "rw", history: mifasaConvHistory(), context: ctx, web: opt && opt.web ? opt.web : undefined }) });
    clearTimeout(t);
    if (res.status === 429) {
      mifasaSpellFixes = [];
      return mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + (en ? "I couldn't find this in my own knowledge, and my extra helper has reached its free limit for now. Please try again later." : "Ntabwo mbisanze mu bumenyi bwanjye, kandi umufasha wanjye w'inyongera ugeze ku mupaka w'ubuntu. Ongera ugerageze nyuma."));
    }
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !d.text) return null;
    if (!d.taught) mifasaLlmCount(); if (typeof mifasaLearnCapture === "function") mifasaLearnCapture(raw, d, { en, ctx: ctx.length > 0, opt });            // answers the owner taught (/teach) are free and do not use the daily quota
    const g = ctx.length > 0;
    let note = g ? (en ? "\n\n_⚠️ Based on MIFASA's own knowledge, completed by a free external AI. It may contain mistakes; double-check important facts. Your question was sent to that service._"
                         : "\n\n_⚠️ Gishingiye ku bumenyi bwa MIFASA, cyongerwaho na AI y'ubuntu yo hanze. Gishobora kwibeshya; genzura ibyingenzi. Ikibazo cyawe cyoherejwe kuri iyo serivisi._")
    : en ? "\n\n_⚠️ Not found in MIFASA's own knowledge: answered by a free external AI. Please double-check important facts. Your question was sent to that service._"
                    : "\n\n_⚠️ Ntibiri mu bumenyi bwa MIFASA: byasubijwe na AI y'ubuntu yo hanze. Genzura ibyingenzi. Ikibazo cyawe cyoherejwe kuri iyo serivisi._";
    if (d.taught) note = "";                    // taught by the owner: it is MIFASA's own knowledge, no "external AI" warning
    else if (d.kb && !d.web) note = en ? "\n\n_📚 Based on MIFASA's knowledge base, completed by a free external AI. Double-check important facts._" : "\n\n_📚 Gishingiye ku bubiko bw'ubumenyi bwa MIFASA, cyongerwaho na AI y'ubuntu. Genzura ibyingenzi._";
    else if (d.web) note = en ? "\n\n_🌐 Based on a live web search plus MIFASA's knowledge. Check the sources; they may be wrong or out of date._" : "\n\n_🌐 Gishingiye ku byashakishijwe kuri murandasi hamwe n'ubumenyi bwa MIFASA. Genzura aho byavuye; bishobora kuba bitari byo cyangwa bishaje._";
    mifasaSpellFixes = [];      // the external AI saw the raw question: no "I fixed a typo" note from the local spell-checker
    return { items: [], corrected: "", html: mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + d.text + (Array.isArray(d.sources) && d.sources.length ? "\n\n📚 " + (en ? "Sources: " : "Aho byavuye: ") + d.sources.slice(0, 3).map(x => String(x.title || "").slice(0, 60) + " (" + String(x.url || "") + ")").join("; ") : "") + note), llm: true };
  } catch (e) { return null; }
  finally { MIFASA_LLM.busy = false; }
}
/* MIFASA part 281: KB ya Cloudflare (D1 + Vectorize) - ubumenyi bubitse kuri seriveri aho kuba muri ai*.json (Neocities 1GB).
   Ikoresha GET {MIFASA_LLM_URL}/api/search?q=...  (cyangwa window.MIFASA_KB_URL). Iyo URL itashyizweho, iyi mikorere irahagarara (ntacyo ihindura).
   Igisubizo cya KB cyerekanwa ako kanya (nta AI, nta mupaka wa LLM) GUSA iyo seriveri ivuze ko gikomeye (strong); ubundi bikurikira nka mbere
   (web -> AI), kandi seriveri ubwayo yongera KB muri context ya AI. */
const MIFASA_KB = { day: "", n: 0, perDay: 40, cache: new Map() };
const MIFASA_KB_FRESH_RE = /\b(today|tonight|currently|latest|recent|recently|news|breaking|this (?:week|month|year)|yesterday|price of|exchange rate|weather|forecast|ubu|uyu munsi|ejo hashize|amakuru|mashya|vuba aha|igiciro|ikirere|uyu mwaka|iki cyumweru)\b/i;

function mifasaKbUrl() {
  if (typeof window === "undefined") return "";
  if (window.MIFASA_KB_URL) return String(window.MIFASA_KB_URL);
  return window.MIFASA_LLM_URL ? String(window.MIFASA_LLM_URL).replace(/\/+$/, "") + "/api/search" : "";
}
function mifasaKbFresh(raw) { return MIFASA_KB_FRESH_RE.test(String(raw || "")); }
function mifasaKbQuota(count) {
  const day = new Date().toISOString().slice(0, 10);
  try { const s = JSON.parse(localStorage.getItem("mifasa_kb_q") || "{}"); MIFASA_KB.day = day; MIFASA_KB.n = s.day === day ? (s.n || 0) : 0; } catch (e) { MIFASA_KB.n = 0; }
  if (MIFASA_KB.n >= MIFASA_KB.perDay) return false;
  if (count) { MIFASA_KB.n++; try { localStorage.setItem("mifasa_kb_q", JSON.stringify({ day, n: MIFASA_KB.n })); } catch (e) {} }
  return true;
}

async function mifasaKbSearch(raw, limit) {          // -> { results:[{id,title,snippet,source_url,category,strong}], mode } | null
  const base = mifasaKbUrl(), q = String(raw || "").trim().slice(0, 300);
  if (!base || q.length < 3) return null;
  const key = q.toLowerCase();
  if (MIFASA_KB.cache.has(key)) return MIFASA_KB.cache.get(key);
  if (!mifasaKbQuota(true)) return null;
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(base + "?q=" + encodeURIComponent(q) + "&limit=" + (limit || 3), { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !Array.isArray(d.results)) return null;
    if (MIFASA_KB.cache.size > 60) MIFASA_KB.cache.clear();
    MIFASA_KB.cache.set(key, d);
    return d;
  } catch (e) { return null; }
}

async function mifasaKbAnswer(raw) {                  // answer object (like mifasaLlmAnswer) or null
  const d = await mifasaKbSearch(raw, 3);
  if (!d || !d.results.length) return null;
  const top = d.results.filter(x => x.strong).slice(0, 2);
  if (!top.length) return null;                       // not sure enough: let web / AI handle it (the server also gives them the KB)
  const en = (detectQueryLang(raw) || currentLang) === "en";
  const body = top.map(x => String(x.snippet || "").replace(/\s+/g, " ").trim().slice(0, 600)).filter(Boolean).join("\n\n");
  if (!body) return null;
  const srcs = top.filter(x => /^https?:\/\//.test(x.source_url || "")).map(x => "[" + String(x.title || "").replace(/[\[\]]/g, "").slice(0, 60) + "](" + x.source_url + ")");
  const tail = srcs.length ? "\n\n📚 " + (en ? "Sources: " : "Aho byavuye: ") + srcs.join(", ") : "";
  mifasaSpellFixes = [];
  return { items: [], corrected: "", html: mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + body + tail), kb: true };
}
/* MIFASA part 285: ikiganiro gifite kwibuka. MIFASA AI yibuka ibyavuzwe byose (ibisubizo byayo byombi n'ibya AI y'inyongera), isobanukirwa ibibazo bikurikirana
   ("na Kenya se?", "sobanura neza", "kuki?") kandi ikibuka izina ry'umukoresha. Ibibazo by'ubutabazi bikomeza kujya kuri MIFASA ubwayo. */
const MIFASA_CONV = { turns: [] };            // { r: "u" | "b", t: "text" }, last 12 only
const MIFASA_SAFETY_RE = /\b(suicid\w*|kill myself|want to die|end my life|hurt myself|self.?harm|abus\w+|rap(e|ed|ist)|beat(ing)? me|hits? me|ambulance|emergency|poison\w*|overdose|114|112|912|kwiyahura|ndashaka gupfa|gufata ku ngufu|nafashwe ku ngufu|ndakubitwa|ambilansi|ubutabazi|impanuka)\b/i;

function mifasaPlainText(h) { return String(h || "").replace(/<[^>]+>/g, " ").replace(/&#039;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); }
function mifasaConvPush(role, text) {
  const t = mifasaPlainText(text).slice(0, 500); if (!t) return;
  MIFASA_CONV.turns.push({ r: role, t }); MIFASA_CONV.turns = MIFASA_CONV.turns.slice(-12);
}
function mifasaConvHistory() { return MIFASA_CONV.turns.map(x => ({ role: x.r === "u" ? "user" : "model", text: x.t })); }
function mifasaConvName() { try { return localStorage.getItem("mifasa_user_name") || ""; } catch (e) { return ""; } }
function mifasaConvLearnName(q) {
  const m = /\b(?:my name is|i am called|call me|nitwa|izina ryanjye ni)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{1,19})\b/i.exec(q);
  if (!m) return;
  const nm = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  if (/^(not|a|the|so|very|here|fine|ok|okay|good|sad|tired|hungry)$/i.test(nm)) return;
  try { localStorage.setItem("mifasa_user_name", nm); } catch (e) {}
}
/* Ikibazo gikurikira icyabanje (gikeneye ibyavuzwe mbere): moteri y'ibibazo bisanzwe ntiyabisobanukirwa, bityo bijya kuri LLM hamwe n'amateka yose. */
function mifasaConvIsFollowUp(q) {
  if (!MIFASA_CONV.turns.length) return false;
  const words = q.split(/\s+/).filter(Boolean).length;
  if (words > 9 || /https?:\/\/|^[\/#]/i.test(q)) return false;
  const strict = /^(more|continue|go on|tell me more|explain( more| again| that| it| better)?|example|give me an example|elaborate|and you|ongera|komeza|sobanura( neza| byinshi| ibyo)?|byisobanure|urugero|nawe|na wowe)\b/i;
  const shortLead = /^(and|but|so|then|also|what about|how about|why|how|what if|really|ok|okay|na|ariko|none se|none|kuki|bite|ubwo|ese)\b/i;
  const ref = /\b(it|its|that|this|they|them|those|these|he|she|him|her|there|yo|ibyo|iyo|iyi|uyu|uwo|abo|ho|byo|cyo)\b/i;
  return strict.test(q) || (words <= 4 && shortLead.test(q)) || (words <= 6 && ref.test(q));
}

async function mifasaAskConversation(message, limit) {
  const q = String(message || "").trim();
  mifasaConvLearnName(q);
  const memCmd = typeof mifasaMemHandle === "function" ? mifasaMemHandle(q) : null;      // "remember that...", "what do you remember", "forget everything"
  if (memCmd) return memCmd;
  const own = typeof mifasaOwnHandle === "function" ? await mifasaOwnHandle(q) : null;      // /owner login, owner chat and owner commands (part 287)
  if (own) { if (own.keep && own.r && own.r.html) { mifasaConvPush("u", q); mifasaConvPush("b", own.r.html); } return own.r; }
  let r = null;
  const wm = /^\/(?:web|shakisha)\s+(.{3,})$/is.exec(q);                       // "/web ikibazo": search the web, then answer from what was found
  if (wm && typeof window !== "undefined" && window.MIFASA_LLM_URL && !MIFASA_SAFETY_RE.test(wm[1])) { try { r = await mifasaLlmAnswer(wm[1].trim(), { web: "search" }); } catch (e) { r = null; } }
  if (!r && typeof mifasaGoalHandle === "function") { try { r = await mifasaGoalHandle(q); } catch (e) { r = null; } }      // long personal goal (part 290)
  if (!r && typeof window !== "undefined" && window.MIFASA_LLM_URL && q.length >= 2 && !MIFASA_SAFETY_RE.test(q) && mifasaConvIsFollowUp(q)) {
    try { r = await mifasaLlmAnswer(q); } catch (e) { r = null; }          // follow-up: the AI sees the whole conversation
  }
  if (!r) r = await mifasaAskAsync(q, limit);
  if (q && r && r.html) { mifasaConvPush("u", q); mifasaConvPush("b", r.html); }
  return r;
}
MifasaAI.askAsync = mifasaAskConversation;
MifasaAI.setConversation = turns => { MIFASA_CONV.turns = (Array.isArray(turns) ? turns : []).filter(x => x && (x.r === "u" || x.r === "b") && typeof x.t === "string").map(x => ({ r: x.r, t: mifasaPlainText(x.t).slice(0, 500) })).slice(-12); };
MifasaAI.resetConversation = () => { MIFASA_CONV.turns = []; };
MifasaAI.conversation = () => MIFASA_CONV.turns.slice();
/* MIFASA part 286: kwibuka igihe kirekire (long-term memory). Ibyo umukoresha avuze ku giti cye (akazi, kwiga, aho atuye, ibyo akunda)
   bibikwa kuri telefone ye gusa (localStorage) kandi bigahabwa AI yo hanze nk'ikibonezamvugo. Ashobora kubibona no kubisiba igihe cyose. */
const MIFASA_MEM_KEY = "mifasa_memory_v1", MIFASA_MEM_MAX = 40;
const MIFASA_MEM_SKIP_RE = /(password|passcode|\bpin\b|ijambo ry.ibanga|\b\d{6,}\b|@\w+\.\w+|\bhiv\b|cancer|diagnos|suicid)/i;
function mifasaMemList() { try { const a = JSON.parse(localStorage.getItem(MIFASA_MEM_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function mifasaMemSave(a) { try { localStorage.setItem(MIFASA_MEM_KEY, JSON.stringify(a.slice(-MIFASA_MEM_MAX))); } catch (e) {} }
function mifasaMemAdd(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").slice(0, 140);
  if (t.length < 4 || MIFASA_MEM_SKIP_RE.test(t)) return false;
  const a = mifasaMemList(), key = t.toLowerCase();
  if (a.some(x => x.t.toLowerCase() === key)) return false;
  a.push({ t, ts: Date.now() }); mifasaMemSave(a); return true;
}
function mifasaMemContext() { const a = mifasaMemList(); return a.length ? a.slice(-12).map(x => x.t).join("; ") : ""; }
const MIFASA_MEM_AUTO_RE = /^(?:i work (?:as|at|in|for)|i study|i(?:'m| am) studying|i live in|my job is|my business is|i like|i love|nkora|niga|ntuye|akazi kanjye ni|nkunda)\b.{3,}/i;
const MIFASA_MEM_SAVE_RE = /^(?:please )?(?:remember(?: that)?|nibuka ko|ibuka ko|wibuke ko|nyibuka ko)\s+(.{3,})$/i;
const MIFASA_MEM_SHOW_RE = /\b(what do you (?:remember|know) about me|what have you remembered|ibyo wibuka|ibyo uzi kuri jye|umbwire ibyo uzi)\b/i;
const MIFASA_MEM_CLEAR_RE = /\b(forget everything|forget me|clear (?:my )?memory|wibagirwe byose|siba ibyo wibuka)\b/i;

/* Returns a result object when the message is a memory command, otherwise null (normal answering continues). */
function mifasaMemHandle(q) {
  const en = (typeof detectQueryLang === "function" ? detectQueryLang(q) : "") === "en" || (currentLang === "en" && !/\b(ibyo|nibuka|wibagirwe|siba)\b/i.test(q));
  const box = txt => ({ items: [], corrected: "", html: mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + txt), memory: true });
  if (MIFASA_MEM_CLEAR_RE.test(q)) {
    mifasaMemSave([]);
    return box(en ? "Done. I have forgotten everything I remembered about you. 🧹" : "Nabikoze. Nibagiwe ibyose nibukaga kuri wowe. 🧹");
  }
  if (MIFASA_MEM_SHOW_RE.test(q)) {
    const a = mifasaMemList();
    if (!a.length) return box(en ? "I don't remember anything about you yet. Tell me, for example: \"remember that I work as a teacher\"." : "Nta cyo nibuka kuri wowe kugeza ubu. Mbwira, urugero: \"nibuka ko nkora ubwarimu\".");
    return box((en ? "Here is what I remember (kept only on your device; say \"forget everything\" to delete it):\n\n" : "Dore ibyo nibuka (bibitswe kuri telefone yawe gusa; vuga \"wibagirwe byose\" ubisibe):\n\n") + a.map(x => "• " + x.t).join("\n"));
  }
  const s = MIFASA_MEM_SAVE_RE.exec(q);
  if (s) {
    return box(mifasaMemAdd(s[1])
      ? (en ? "Got it, I will remember that. ✅" : "Nabyumvise, nzabyibuka. ✅")
      : (en ? "I could not save that (too short, or it looks private, like a password or a number)." : "Sinashoboye kubibika (ni bigufi cyane, cyangwa bisa n'ibanga nk'ijambo ry'ibanga cyangwa nimero)."));
  }
  if (q.length <= 140 && MIFASA_MEM_AUTO_RE.test(q)) mifasaMemAdd(q);      // learns quietly, the normal answer still follows
  return null;
}

/* A work/study/life question gets a coaching hint so the external AI answers like a practical adviser. */
const MIFASA_COACH_RE = /\b(advice|advise|inama|how (?:do|can|should) i|nakora iki|nabigenza nte|career|cv|resume|interview|business plan|startup|salary|boss|manager|project|deadline|productivity|study plan|ndashaka kubaka|akazi|umushinga)\b/i;
function mifasaCoachHint(q) {
  return MIFASA_COACH_RE.test(q) ? "Act as a practical adviser: give a short answer first, then 3-5 concrete steps, and mention one risk or trade-off. If key details are missing, ask ONE clarifying question at the end. Be encouraging and honest." : "";
}
MifasaAI.memory = { list: () => mifasaMemList().map(x => x.t), add: mifasaMemAdd, clear: () => mifasaMemSave([]), context: mifasaMemContext };
/* MIFASA part 287: OWNER MODE. Wowe wubatse MIFASA AI ushobora kuyivugisha nk'uwayubatse (iyo uzi ijambo ryawe ry'ibanga).
   - Andika  /owner  mu kiganiro: hakingurwa agasanduku k'ibanga (ijambo ntirigaragara mu kiganiro, ntirinabikwa, ntirinaba muri script.js).
   - Ijambo risuzumwa kuri seriveri (worker.js, secret OWNER_SECRET). Iyo ari ryo, uhabwa "owner token" yasinywe, ibikwa kuri iyi telefone/browser gusa.
   - Mu gihe owner mode ifunguye, ubutumwa bwawe bujya ku AI ikomeye (ifite amateka y'ikiganiro) kandi izi ko ivugana nuwayubatse.
     Ibibazo by'ubutabazi (112/114/912) bikomeza gusubizwa na MIFASA ubwayo kugira ngo bitagira ikibyangiza.
   - Amabwiriza: /owner (injira) · /owner off (sohoka) · /help · /status · /newkey izina · /keys · /revoke prefix
   Iyi mikorere ihagarara iyo window.MIFASA_LLM_URL itashyizweho. */
const MIFASA_OWN_KEY = "mifasa_owner_v1";
const MIFASA_OWN_CMD_RE = /^\/(help|status|newkey|keys|revoke|unanswered|teach|taught|unteach|learned|forget)\b/i;

function mifasaOwnState() {
  try { const s = JSON.parse(localStorage.getItem(MIFASA_OWN_KEY) || "null"); if (s && typeof s.t === "string" && s.exp > Date.now()) return s; } catch (e) {}
  return null;
}
function mifasaOwnToken() { const s = mifasaOwnState(); return s ? s.t : ""; }
function mifasaOwnSet(t, exp) { try { localStorage.setItem(MIFASA_OWN_KEY, JSON.stringify({ t, exp })); } catch (e) {} }
function mifasaOwnClear() { try { localStorage.removeItem(MIFASA_OWN_KEY); } catch (e) {} }
function mifasaOwnBox(txt) { mifasaSpellFixes = []; return { items: [], corrected: "", html: mifasaAnswerBox("👑 **MIFASA AI**\n\n" + txt), llm: true, owner: true }; }

/* Agasanduku k'ibanga: password input, no innerHTML, Esc/gukanda hanze birahagarika. */
function mifasaOwnAskSecret(en) {
  return new Promise(resolve => {
    try { const old = document.getElementById("mifasa-own-modal"); if (old) old.remove(); } catch (e) {}
    const wrap = document.createElement("div"); wrap.id = "mifasa-own-modal";
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(2,6,23,.75);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif";
    const form = document.createElement("form"); form.setAttribute("autocomplete", "off");
    form.style.cssText = "background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;padding:18px;max-width:340px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.5)";
    const h = document.createElement("div"); h.textContent = "👑 MIFASA Owner"; h.style.cssText = "font-weight:700;font-size:17px;margin-bottom:6px";
    const p = document.createElement("div"); p.style.cssText = "font-size:13px;line-height:1.45;color:#94a3b8;margin-bottom:12px";
    p.textContent = en ? "Type your private secret. It is checked on the server; it is not shown in the chat and not saved." : "Andika ijambo ryawe ry'ibanga. Risuzumwa kuri seriveri; ntirigaragara mu kiganiro kandi ntirabikwa.";
    const inp = document.createElement("input"); inp.type = "password"; inp.maxLength = 300; inp.autocomplete = "off"; inp.setAttribute("aria-label", en ? "Secret" : "Ijambo ry'ibanga");
    inp.style.cssText = "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #475569;background:#020617;color:#fff;font-size:16px;outline:none";
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:14px";
    const no = document.createElement("button"); no.type = "button"; no.textContent = en ? "Cancel" : "Reka";
    no.style.cssText = "padding:9px 14px;border-radius:10px;border:1px solid #475569;background:transparent;color:#cbd5e1;font-size:14px;cursor:pointer";
    const ok = document.createElement("button"); ok.type = "submit"; ok.textContent = en ? "Unlock" : "Fungura";
    ok.style.cssText = "padding:9px 16px;border-radius:10px;border:0;background:#10b981;color:#fff;font-weight:700;font-size:14px;cursor:pointer";
    row.appendChild(no); row.appendChild(ok); form.appendChild(h); form.appendChild(p); form.appendChild(inp); form.appendChild(row); wrap.appendChild(form); document.body.appendChild(wrap);
    const done = v => { try { document.removeEventListener("keydown", onKey, true); wrap.remove(); } catch (e) {} resolve(v); };
    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    form.addEventListener("submit", e => { e.preventDefault(); const v = inp.value; done(v && v.trim() ? v : null); });
    no.addEventListener("click", () => done(null));
    wrap.addEventListener("mousedown", e => { if (e.target === wrap) done(null); });
    setTimeout(() => { try { inp.focus(); } catch (e) {} }, 30);
  });
}

async function mifasaOwnLogin(en) {
  const url = typeof window !== "undefined" && window.MIFASA_LLM_URL;
  if (!url) return mifasaOwnBox(en ? "Owner mode needs the MIFASA AI server (window.MIFASA_LLM_URL) on this page." : "Owner mode ikeneye seriveri ya MIFASA AI (window.MIFASA_LLM_URL) kuri uru rupapuro.");
  const secret = await mifasaOwnAskSecret(en);
  if (!secret) return mifasaOwnBox(en ? "Cancelled. Nothing was changed." : "Byahagaritswe. Nta cyahindutse.");
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ action: "owner_login", secret }) });
    clearTimeout(t);
    const d = await res.json().catch(() => null);
    if (res.ok && d && d.token) {
      mifasaOwnSet(d.token, d.exp);
      return mifasaOwnBox(en
        ? "✅ **Owner mode is ON.** I know I am talking with my creator. Talk to me normally; I will use my strongest AI and I am not limited by the public daily limit.\n\nCommands: `/status` · `/unanswered` · `/teach question => answer` · `/learned` · `/newkey name` · `/keys` · `/web question` · `/help` · `/owner off`"
        : "✅ **Owner mode irafunguye.** Nzi ko ndi kuvugana nuwanyubatse. Ganira nanjye nk'uko bisanzwe; ndakoresha AI ikomeye kandi nta mupaka wa rubanda wa buri munsi unkoma imbere.\n\nAmabwiriza: `/status` · `/unanswered` · `/teach ikibazo => igisubizo` · `/learned` · `/newkey izina` · `/keys` · `/web ikibazo` · `/help` · `/owner off`");
    }
    if (res.status === 401) return mifasaOwnBox(en ? "That secret is not correct." : "Ijambo ry'ibanga si ryo.");
    if (res.status === 429) return mifasaOwnBox(en ? "Too many wrong attempts. It is locked for today." : "Wagerageje inshuro nyinshi nabi. Byafunzwe kugeza ejo.");
    if (res.status === 403) return mifasaOwnBox(en ? "Owner mode is not set up on the server yet: add the secret OWNER_SECRET (at least 8 characters) in Cloudflare." : "Owner mode ntirashyirwaho kuri seriveri: shyiraho secret OWNER_SECRET (nibura inyuguti 8) muri Cloudflare.");
    return mifasaOwnBox(en ? "The server did not answer correctly. Try again." : "Seriveri ntiyashubije neza. Ongera ugerageze.");
  } catch (e) { return mifasaOwnBox(en ? "Could not reach the server. Check your internet and try again." : "Seriveri ntibonetse. Reba internet wongere ugerageze."); }
}

async function mifasaOwnChat(raw0) {
  const wm = /^\/(?:web|shakisha)\s+(.{3,})$/is.exec(raw0), raw = wm ? wm[1].trim() : raw0;          // /web ikibazo => live web search
  const url = typeof window !== "undefined" && window.MIFASA_LLM_URL, tok = mifasaOwnToken();
  if (!url || !tok) return null;
  const en = (detectQueryLang(raw) || currentLang) === "en", cmd = MIFASA_OWN_CMD_RE.test(raw0);
  let ctx = [];
  if (!cmd) {
    const prevQ = (() => { for (let i = MIFASA_CONV.turns.length - 1; i >= 0; i--) if (MIFASA_CONV.turns[i].r === "u") return MIFASA_CONV.turns[i].t; return ""; })();
    try { ctx = mifasaLlmContext(prevQ && mifasaConvIsFollowUp(raw) ? prevQ + " " + raw : raw); } catch (e) { ctx = []; }
  }
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 90000);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ q: raw, lang: en ? "en" : "rw", history: cmd ? [] : mifasaConvHistory(), context: ctx, owner: tok, web: wm ? "search" : undefined }) });
    clearTimeout(t);
    if (res.status === 401) { mifasaOwnClear(); return { expired: true }; }
    if (res.status === 429) return mifasaOwnBox(en ? "Owner daily safety limit reached. Try again tomorrow." : "Umupaka w'umutekano wa buri munsi wa owner wagezweho. Ongera ugerageze ejo.");
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !d.text) return null;
    return mifasaOwnBox(d.text + (d.via && !cmd ? "\n\n_via " + String(d.via).slice(0, 20) + "_" : ""));
  } catch (e) { return null; }
}

/* Returns { r: result, keep: boolean } when the message was handled here, otherwise null (normal answering continues). keep = remember it in the conversation. */
async function mifasaOwnHandle(q) {
  const en = currentLang === "en";
  if (/^\/owner\b/i.test(q)) {
    const rest = q.replace(/^\/owner\b/i, "").trim();
    if (/^(off|logout|exit|sohoka)$/i.test(rest)) { mifasaOwnClear(); return { r: mifasaOwnBox(en ? "Owner mode is OFF. See you! 👋" : "Owner mode irahagaritswe. Murabeho! 👋"), keep: false }; }
    if (!rest || /^(on|login|start|fungura)$/i.test(rest)) return { r: await mifasaOwnLogin(en), keep: false };
    return { r: mifasaOwnBox(en
      ? "Do not type your secret in the chat (it would stay in the chat history). Send only `/owner` and a private box will open. If you already typed it here, delete this chat."
      : "Ntukandike ijambo ryawe ry'ibanga mu kiganiro (ryaguma mu mateka yacyo). Andika `/owner` gusa maze agasanduku k'ibanga karakingurwa. Niba waryanditse hano, siba iki kiganiro."), keep: false };
  }
  if (!mifasaOwnToken()) return null;
  if (MIFASA_SAFETY_RE.test(q) || /^https?:\/\//i.test(q)) return null;          // ubutabazi n'amalinks bikomeza kuri MIFASA ubwayo
  const r = await mifasaOwnChat(q);
  if (r && r.expired) return { r: mifasaOwnBox(en ? "Your owner session ended (expired or the secret was changed). Send `/owner` to unlock again." : "Igihe cya owner mode cyarangiye (cyangwa ijambo ry'ibanga ryahinduwe). Andika `/owner` wongere ufungure."), keep: false };
  if (r) return { r, keep: !MIFASA_OWN_CMD_RE.test(q) };
  return null;                                                                   // seriveri ntibonetse: moteri isanzwe irasubiza
}
if (typeof window !== "undefined") window.MifasaOwner = { token: mifasaOwnToken, active: () => !!mifasaOwnToken(), logout: mifasaOwnClear };

/* ---------------------------------------------------------- */
/* 267. HUB: MIFASARW reads its long-term story DATABASE from  */
/* https://mizeromifasa.neocities.org/ (news-archive/*.json).  */
/* Everything is still SHOWN on mifasarw; the hub only STORES. */
/*  - newest HUB_DAYS days load at start (cached in IndexedDB) */
/*  - older days load only when the user searches (on demand)  */
/*  - if the hub is down / blocks CORS: nothing breaks         */
/* Set window.MIFASA_HUB = false (or a different URL) to change */
/* ---------------------------------------------------------- */
const MIFASA_HUB = { base: "https://mizeromifasa.neocities.org/", days: 30, loaded: new Set(), all: [], busy: false, ok: null };
function mifasaHubBase() {
  const w = typeof window !== "undefined" ? window.MIFASA_HUB : undefined;
  if (w === false) return "";
  return String(typeof w === "string" && w ? w : MIFASA_HUB.base).replace(/\/*$/, "/");
}
function mifasaHubIsHost() { try { return !!mifasaHubBase() && location.origin === mifasaHubBase().replace(/\/$/, ""); } catch (e) { return false; } }
async function mifasaHubJSON(path, timeout) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), timeout || 12000);
  try {
    const r = await fetch(mifasaHubBase() + path, { mode: "cors", credentials: "omit", cache: "no-cache", signal: c.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
/* index.json can be: ["2026-11-14", ...] | ["2026-11-14.json"] | [{file|date|path}] | {days|files|dates|archive:[...]} */
function mifasaHubFileList(ix) {
  let list = Array.isArray(ix) ? ix : (ix && (ix.days || ix.files || ix.dates || ix.archive || ix.index)) || [];
  if (!Array.isArray(list)) list = Object.keys(list);
  const out = [];
  list.forEach(x => {
    let s = typeof x === "string" ? x : x && (x.file || x.path || x.date || x.day || x.name);
    if (!s) return; s = String(s).trim();
    const m = s.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m) return;
    out.push({ day: m[1], path: /\.json$/i.test(s) && /\//.test(s) ? s.replace(/^\/+/, "") : "news-archive/" + m[1] + ".json" });
  });
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}
function mifasaHubIngest(key, data) {
  ingestFile(key, data);
  (mifasaFileArticles.get(key) || []).forEach(a => { a._external = true; a._hub = true; });   // stored stories: kept for search/AI + crawl box, not flooding the home
  if (mifasaFileOrder.indexOf(key) < 0) mifasaFileOrder.push(key);
}
async function mifasaHubLoad(limit, force) {
  if (!mifasaHubBase() || mifasaHubIsHost() || MIFASA_HUB.busy) return 0;
  MIFASA_HUB.busy = true;
  let added = 0;
  try {
    if (!MIFASA_HUB.all.length) {
      const ix = await mifasaHubJSON("news-archive/index.json", 10000);
      MIFASA_HUB.all = mifasaHubFileList(ix);
      MIFASA_HUB.ok = MIFASA_HUB.all.length > 0;
    }
    const cache = await idbGetAll();
    const todo = MIFASA_HUB.all.filter(f => !MIFASA_HUB.loaded.has(f.path)).slice(0, limit || MIFASA_HUB.days);
    await runPool(todo, 4, async f => {
      const key = "hub:" + f.path, rec = cache[key];
      const fresh = rec && rec.data && !force && (Date.now() - rec.time < 6 * 3600 * 1000 || f.day < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10));   // old days never change: keep the cache
      if (fresh) { mifasaHubIngest(key, rec.data); MIFASA_HUB.loaded.add(f.path); added++; return; }
      const data = await mifasaHubJSON(f.path, 20000);
      if (!data) { if (rec && rec.data) { mifasaHubIngest(key, rec.data); MIFASA_HUB.loaded.add(f.path); added++; } return; }
      mifasaHubIngest(key, data); MIFASA_HUB.loaded.add(f.path); added++;
      idbSet(key, { time: Date.now(), data });
    });
    if (added) { rebuildAllNews(); paintUI(false); scheduleIndexBuild(); }
  } catch (e) { /* the hub is optional */ }
  finally { MIFASA_HUB.busy = false; }
  return added;
}
/* older days: called when the user searches (loads 30 more days per call, max once every 20 s) */
let __mifasaHubMoreAt = 0;
async function mifasaHubMore() {
  if (Date.now() - __mifasaHubMoreAt < 20000 || !MIFASA_HUB.all.length) return 0;
  __mifasaHubMoreAt = Date.now();
  return mifasaHubLoad(30);
}
if (typeof document !== "undefined" && typeof setTimeout === "function") {
  setTimeout(() => { try { mifasaHubLoad(MIFASA_HUB.days); } catch (e) {} }, 6000);                 // after the main data is ready
  setInterval(() => { try { if (!document.hidden) { MIFASA_HUB.all.slice(0, 3).forEach(f => MIFASA_HUB.loaded.delete(f.path)); MIFASA_HUB.all = []; mifasaHubLoad(3, true).then(() => { if (typeof mifasaHubLoadAll === "function") mifasaHubLoadAll(); }); } } catch (e) {} }, 30 * 60 * 1000);   // newest 3 days refreshed; days already loaded are KEPT (the old code forgot them)   // newest 3 days every 30 min
}
/* full text of one story (stored on the hub in news-full/<day>.json): MifasaAI.hubFull(article).then(text => ...) */
async function mifasaHubFull(a) {
  try {
    const day = String((a && (a.date || a.publish)) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !a.share_id) return "";
    const j = await mifasaHubJSON("news-full/" + day + ".json", 15000), it = j && j.items && j.items[a.share_id];
    return (it && it.t) || "";
  } catch (e) { return ""; }
}
MifasaAI.hubFull = mifasaHubFull;
MifasaAI.hubLoad = mifasaHubLoad;
MifasaAI.hubMore = mifasaHubMore;
MifasaAI.hubStatus = () => ({ base: mifasaHubBase(), ok: MIFASA_HUB.ok, days: MIFASA_HUB.all.length, loaded: MIFASA_HUB.loaded.size });


/* ---------------------------------------------------------- */
/* 285. HUB -> AI: the AI answers from the stories STORED on   */
/* the hub (mizeromifasa.neocities.org), including their FULL  */
/* TEXT (news-full/<day>.json), and loads older days when the  */
/* question needs them.                                        */
/*  1) local search finds nothing / weak  -> load 30 older days */
/*  2) best story from the hub -> read its full text           */
/*  3) pick the 2-3 sentences that answer the question         */
/*  4) answer with the source name + link (nothing invented)   */
/* Needs part 280. If the hub is off or down, returns null and */
/* the normal pipeline (KB -> web -> LLM) continues.           */
/* ---------------------------------------------------------- */
const MIFASA_HUB_AI = { fullCache: new Map(), answered: 0, lastQ: "" };

/* one network call per day-file, reused for every story of that day */
async function mifasaHubFullDay(day) {
  if (MIFASA_HUB_AI.fullCache.has(day)) return MIFASA_HUB_AI.fullCache.get(day);
  const j = await mifasaHubJSON("news-full/" + day + ".json", 15000);
  const items = (j && j.items) || null;
  if (items || MIFASA_HUB_AI.fullCache.size < 80) MIFASA_HUB_AI.fullCache.set(day, items);
  return items;
}
async function mifasaHubFullText(a) {
  try {
    const day = String((a && (a.date || a.publish)) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !a.share_id) return "";
    const items = await mifasaHubFullDay(day), it = items && items[a.share_id];
    return (it && it.t) || "";
  } catch (e) { return ""; }
}

/* the sentences of a long text that share the most words with the question (kept in reading order) */
function mifasaHubPickSentences(text, query, max) {
  const qt = [...new Set(tokenize(String(query || "")).filter(t => t.length > 2 && !MIFASA_STOP_WORDS.has(t)))];
  if (!qt.length) return [];
  const sents = splitSentences(text);
  const scored = sents.map((s, i) => {
    const low = s.toLowerCase();
    let hit = 0; qt.forEach(t => { if (low.includes(t)) hit++; });
    return { s, i, hit, score: hit / qt.length - (MIFASA_DISCLAIMER_RE.test(s) ? 1 : 0) };
  }).filter(x => x.hit >= Math.min(2, qt.length) && x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, max || 3).sort((a, b) => a.i - b.i).map(x => x.s);
}

function mifasaHubStoryUrl(a) {
  const base = mifasaHubBase();
  return base && a && a.share_id && /^[A-Za-z0-9_.-]{3,120}$/.test(a.share_id) ? base.replace(/\/+$/, "") + "/s/" + encodeURIComponent(a.share_id) + ".html" : (a && a.link) || "";
}

/* DEEP SEARCH: the question's words are looked for INSIDE the full text of the stored stories, day after day (newest first), without
   keeping everything in memory (one day-file at a time, the last 80 are cached). Used when the title/summary index finds nothing. */
function mifasaHubArticleById(day, id) {
  const list = mifasaFileArticles.get("hub:news-archive/" + day + ".json") || [];
  for (let i = 0; i < list.length; i++) if (list[i].share_id === id) return list[i];
  return null;
}
async function mifasaHubDeepSearch(q, maxDays) {
  const qt = [...new Set(tokenize(String(q || "")).filter(t => t.length > 2 && !MIFASA_STOP_WORDS.has(t)))];
  if (!qt.length || !MIFASA_HUB.all.length) return [];
  const need = qt.length === 1 ? 1 : Math.max(2, Math.ceil(qt.length * 0.6)), found = [];
  const days = MIFASA_HUB.all.map(f => f.day).slice(0, maxDays || 90);
  await runPool(days, 4, async day => {
    if (found.length >= 12) return;
    const items = await mifasaHubFullDay(day);
    if (!items) return;
    for (const id of Object.keys(items)) {
      const it = items[id], t = it && it.t; if (!t) continue;
      const low = t.toLowerCase(); let hit = 0; qt.forEach(w => { if (low.includes(w)) hit++; });
      if (hit >= need) found.push({ day, id, text: t, source: it.source || "", link: it.link || "", score: hit / qt.length });
    }
  });
  return found.sort((a, b) => b.score - a.score || (a.day < b.day ? 1 : -1)).slice(0, 3);
}

async function mifasaHubAnswer(raw) {
  try {
    if (!mifasaHubBase() || typeof mifasaSearch !== "function") return null;
    const q = String(raw || "").trim();
    if (q.length < 6 || (typeof MIFASA_SAFETY_RE !== "undefined" && MIFASA_SAFETY_RE.test(q))) return null;
    const find = () => mifasaSearch(q, 12).hits.filter(h => h && h.article && h.article._external && h.article.share_id && h.cov >= 0.5).slice(0, 3);
    let hits = find();
    if (!hits.length && MIFASA_HUB.all.length > MIFASA_HUB.loaded.size) {      // not found among the loaded days: load 30 older days, then look again
      if (await mifasaHubMore()) hits = find();
    }
    const en = (typeof detectQueryLang === "function" ? detectQueryLang(q) : "") === "en" || (currentLang === "en" && typeof detectQueryLang !== "function");
    const picked = [];
    for (const h of hits) {
      const a = h.article;
      const text = (await mifasaHubFullText(a)) || [getSummary(a), a._body].filter(Boolean).join(". ");
      const s = mifasaHubPickSentences(text, q, 3);
      if (s.length) picked.push({ a, s });
      if (picked.length >= 2) break;
    }
    if (!picked.length) {                                              // last local step: search the FULL TEXT of every stored day
      const deep = await mifasaHubDeepSearch(q);
      for (const d of deep) {
        const s = mifasaHubPickSentences(d.text, q, 3);
        if (!s.length) continue;
        const known = mifasaHubArticleById(d.day, d.id);
        const a = known || { share_id: d.id, date: d.day, source: d.source, link: d.link, title_en: d.text.replace(/\s+/g, " ").slice(0, 70) + "…", title_rw: d.text.replace(/\s+/g, " ").slice(0, 70) + "…" };
        picked.push({ a, s });
        if (picked.length >= 2) break;
      }
    }
    if (!picked.length) return null;
    MIFASA_HUB_AI.answered++; MIFASA_HUB_AI.lastQ = q;
    const block = p => {
      const url = mifasaHubStoryUrl(p.a), when = String(p.a.date || p.a.publish || "").slice(0, 10);
      return p.s.map(x => "• " + x).join("\n") + `\n📌 **${getTitle(p.a)}** (${p.a.source || "hub"}${when ? ", " + when : ""})` + (url ? `\n🔗 ${url}` : "");
    };
    const head = en ? "💡 From the stories saved on MIFASA's news hub:" : "💡 Dore icyo nasanze mu nkuru zibitse kuri hub ya MIFASA:";
    const text = "🤖 **MIFASA AI**\n\n" + head + "\n" + picked.map(block).join("\n\n");
    return { items: picked.map(p => p.a), corrected: "", html: mifasaAnswerBox(text), hub: true };
  } catch (e) { return null; }       // the hub is optional: never break the normal answer
}

/* READ EVERYTHING: after the newest 30 days, the AI keeps loading ALL older days of the archive in the background (40 days, then a 4 s pause,
   only while the page is visible, never on "data saver"). Every day is cached on the device, so the next visit is instant.
   window.MIFASA_HUB_MAX_DAYS = 365 limits it, window.MIFASA_HUB_ALL = false switches it off. */
async function mifasaHubLoadAll() {
  if (MIFASA_HUB_AI.allBusy || typeof window === "undefined" || window.MIFASA_HUB_ALL === false) return;
  MIFASA_HUB_AI.allBusy = true;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let stall = 0;
  try {
    while (stall < 3) {
      if (!mifasaHubBase() || mifasaHubIsHost()) break;
      if (typeof navigator !== "undefined" && navigator.connection && navigator.connection.saveData) break;
      if (typeof document !== "undefined" && document.hidden) { await sleep(8000); continue; }
      const cap = +window.MIFASA_HUB_MAX_DAYS || Infinity;
      if (MIFASA_HUB.all.length && MIFASA_HUB.loaded.size >= Math.min(cap, MIFASA_HUB.all.length)) break;
      const n = await mifasaHubLoad(40);
      stall = n ? 0 : stall + 1;
      await sleep(4000);
    }
  } catch (e) { /* optional */ }
  finally { MIFASA_HUB_AI.allBusy = false; }
}
if (typeof document !== "undefined" && typeof setTimeout === "function") setTimeout(() => { try { mifasaHubLoadAll(); } catch (e) {} }, 25000);
MifasaAI.hubLoadAll = mifasaHubLoadAll;
MifasaAI.hubDeepSearch = mifasaHubDeepSearch;
MifasaAI.hubAnswer = mifasaHubAnswer;
MifasaAI.hubAiStatus = () => ({ answered: MIFASA_HUB_AI.answered, cachedDays: MIFASA_HUB_AI.fullCache.size, hub: MifasaAI.hubStatus() });

/* ---------------------------------------------------------- */
/* 290. GOAL MENTOR: a long personal request such as           */
/*   "I'm a young Rwandan developer, I want to learn hacking   */
/*    and become one of the best"                              */
/* is first ANALYSED (who is asking, what they want, which     */
/* field, what level they already have), the AI says what it   */
/* understood, gives a first plan, adds related stories from   */
/* the hub, remembers the person's goal, and asks ONE question */
/* to start the conversation. If window.MIFASA_LLM_URL is set, */
/* the external AI writes the personalised plan on top of that */
/* analysis (so the local analysis is never wasted).           */
/* Security questions are always answered as LEGAL / ETHICAL   */
/* security (labs, CTFs, permission-based testing).            */
/* ---------------------------------------------------------- */
const MIFASA_GOAL = { state: null, ttl: 15 * 60 * 1000 };
const MIFASA_GOAL_INTENT_RE = /\b(ndashaka|nifuza|nkeneye|ndifuza|umfashe|mfasha|mpa inama)\b|\bi (?:want|would like|wish|need|plan|am trying) to (?:learn|study|become|be|start|build|get|master|work)|\bhelp me (?:to )?(?:learn|become|start|build|get|plan|study)|\bhow (?:do|can|should) i (?:become|learn|start|get into)/i;
const MIFASA_GOAL_WHO = {
  country: [/\b(rwandans?|umunyarwanda|abanyarwanda|rwanda|kigali)\b/i, "Rwandan", "Umunyarwanda"],
  age: [/\b(young|teen(?:ager)?|umusore|umukobwa|nkiri muto|nkiri umwana)\b|\b(1[4-9]|2[0-9]) ?(?:years?|yrs?|imyaka)\b/i, "young", "ukiri muto"],
  role: [/\b(developers?|programmers?|coders?|software engineers?|dev)\b|\bumuteza imbere porogaramu\b/i, "developer", "developer"],
  role2: [/\b(students?|umunyeshuri|abanyeshuri)\b/i, "student", "umunyeshuri"],
  role3: [/\b(entrepreneur|umushoramari|founder|umucuruzi)\b/i, "entrepreneur", "umushoramari"]
};
const MIFASA_GOAL_LANGS = /\b(python|javascript|typescript|java|php|c\+\+|c#|golang|rust|kotlin|swift|html|css|react|node(?:\.js)?|django|flask|laravel|sql|linux|bash|networking)\b/gi;
const MIFASA_GOAL_DOMAINS = {
  security: {
    re: /\b(hack(?:ing|ers?)?|cyber ?security|cybersecurity|pentest\w*|penetration test\w*|ethical hack\w*|red team|bug bounty|ctf|umutekano wa (?:interineti|murandasi|sisitemu)|gucengera muri)\b/i,
    en: "cybersecurity (ethical hacking)", rw: "umutekano wa murandasi (ethical hacking)", newsQ: "cyber security hacking",
    goal_en: "become one of the best ethical hackers (security professionals)", goal_rw: "kuba umwe mu ba hackers beza (ethical hacking)",
    stages: [
      ["Foundations: networking (TCP/IP, DNS, HTTP), the Linux command line and one scripting language (Python or Bash).", "Ibanze: network (TCP/IP, DNS, HTTP), Linux command line n'ururimi rumwe rwa scripting (Python cyangwa Bash)."],
      ["Web security: learn the OWASP Top 10 by doing (PortSwigger Web Security Academy is free).", "Umutekano wa web: iga OWASP Top 10 ukora (PortSwigger Web Security Academy ni ubuntu)."],
      ["Practice only in legal labs: TryHackMe, Hack The Box, OverTheWire, picoCTF or your own home lab.", "Itoze mu masomero yemewe gusa: TryHackMe, Hack The Box, OverTheWire, picoCTF cyangwa lab yawe bwite."],
      ["Specialise in one path: web/app security, network pentesting, malware analysis or defence (blue team).", "Hitamo inzira imwe: web/app security, network pentesting, gusesengura malware cyangwa kwirinda (blue team)."],
      ["Prove it: write-ups, CTF teams, then certifications (e.g. Security+, eJPT, later OSCP) and bug bounty, only inside a programme's allowed scope.", "Bigaragaze: andika write-ups, injira mu matsinda ya CTF, hanyuma impamyabumenyi (nka Security+, eJPT, nyuma OSCP) na bug bounty, ariko mu byo gahunda yemera gusa."],
      ["Ethics and law: real professionals work WITH permission. Entering a system without permission is a crime.", "Imyitwarire n'amategeko: abahanga nyabo bakora BABYEMEREWE. Kwinjira muri sisitemu utabyemerewe ni icyaha."]
    ],
    plan30: [
      ["Week 1: networking + Linux basics (TryHackMe intro paths).", "Icyumweru 1: network + Linux (inzira z'intangiriro za TryHackMe)."],
      ["Week 2: Python scripts that automate tasks in your own lab (logs, file checks, simple HTTP requests).", "Icyumweru 2: Python scripts zikora imirimo muri lab yawe (logs, kugenzura dosiye, HTTP requests zoroshye)."],
      ["Week 3: OWASP Top 10 labs on PortSwigger Academy.", "Icyumweru 3: amasomero ya OWASP Top 10 kuri PortSwigger Academy."],
      ["Week 4: your first beginner CTF (picoCTF) and a short write-up of what you learned.", "Icyumweru 4: CTF yawe ya mbere (picoCTF) wandike na write-up ngufi y'ibyo wize."]
    ],
    q: ["Which languages and tools do you already use well, and do you prefer attacking (pentest) or defending (blue team)?", "Ni izihe ndimi n'ibikoresho usanzwe uzi neza, kandi ukunda gutera (pentest) cyangwa kurinda (blue team)?"],
    ethic: "Teach ONLY legal, ethical security: labs, CTFs, own equipment, permission-based testing and authorised bug bounty. No instructions for attacking real systems or writing malware."
  },
  web: {
    re: /\b(web ?dev\w*|website|front ?end|back ?end|full ?stack|react|javascript|html|css|software engineer\w*|app development|gukora (?:website|porogaramu)|porogaramu)\b/i,
    en: "software / web development", rw: "gukora porogaramu na web", newsQ: "technology software developers",
    goal_en: "grow as a software developer", goal_rw: "gukura nk'umuteza imbere porogaramu",
    stages: [
      ["Fundamentals: HTML, CSS, JavaScript, then Git.", "Ibanze: HTML, CSS, JavaScript, hanyuma Git."],
      ["A framework (React) and one backend (Node.js or Python) with a database (SQL).", "Framework (React) na backend imwe (Node.js cyangwa Python) hamwe na database (SQL)."],
      ["Build and deploy 3 real projects that solve Rwandan problems (payments, schools, farming, transport).", "Kubaka no gushyira kuri murandasi imishinga 3 nyayo ikemura ibibazo by'Abanyarwanda (kwishyura, amashuri, ubuhinzi, ubwikorezi)."],
      ["Portfolio + open source contributions, then freelance or internships.", "Portfolio + gutanga umusanzu muri open source, hanyuma freelance cyangwa internship."]
    ],
    plan30: [
      ["Week 1: finish a small static site and put it on GitHub.", "Icyumweru 1: zuza website ntoya uyishyire kuri GitHub."],
      ["Week 2: JavaScript: a to-do app without a framework.", "Icyumweru 2: JavaScript: to-do app nta framework."],
      ["Week 3: a small API with a database.", "Icyumweru 3: API ntoya ifite database."],
      ["Week 4: connect them and deploy the project online.", "Icyumweru 4: bihuze ushyire umushinga kuri murandasi."]
    ],
    q: ["What have you already built, and what kind of work do you want (job, freelance or your own product)?", "Ni iki umaze kubaka, kandi ushaka akazi ki (akazi gahoraho, freelance cyangwa igicuruzwa cyawe)?"]
  },
  ai: {
    re: /\b(artificial intelligence|machine learning|deep learning|data scien\w+|\bai\b|\bml\b|ubwenge buhangano)\b/i,
    en: "AI / data science", rw: "AI / data science", newsQ: "artificial intelligence",
    goal_en: "learn AI and data science", goal_rw: "kwiga AI na data science",
    stages: [
      ["Python, basic maths (statistics, linear algebra) and pandas/NumPy.", "Python, imibare y'ibanze (statistics, linear algebra) na pandas/NumPy."],
      ["Classic machine learning with scikit-learn on small real datasets.", "Machine learning ya kera ukoresheje scikit-learn ku makuru mato nyayo."],
      ["A project with Kinyarwanda or Rwandan data (text, farming, health).", "Umushinga ukoresha amakuru ya Kinyarwanda cyangwa y'u Rwanda (inyandiko, ubuhinzi, ubuzima)."],
      ["Deep learning, then publish your work (GitHub, Kaggle, a short blog).", "Deep learning, hanyuma bishyire ahagaragara (GitHub, Kaggle, blog ngufi)."]
    ],
    plan30: [
      ["Week 1: Python + NumPy/pandas.", "Icyumweru 1: Python + NumPy/pandas."],
      ["Week 2: statistics basics and charts.", "Icyumweru 2: statistics y'ibanze n'ibishushanyo."],
      ["Week 3: your first model with scikit-learn.", "Icyumweru 3: model yawe ya mbere na scikit-learn."],
      ["Week 4: a small project and a short write-up.", "Icyumweru 4: umushinga muto n'inyandiko ngufi."]
    ],
    q: ["Do you already know Python and some maths, and which problem would you like your first AI project to solve?", "Usanzwe uzi Python n'imibare, kandi ni ikihe kibazo wifuza ko umushinga wawe wa mbere wa AI ukemura?"]
  }
};

function mifasaGoalParse(raw) {
  const q = String(raw || "").replace(/\s+/g, " ").trim();
  if (q.length < 25 || !MIFASA_GOAL_INTENT_RE.test(q)) return null;
  if (typeof MIFASA_SAFETY_RE !== "undefined" && MIFASA_SAFETY_RE.test(q)) return null;
  const who = [];
  Object.keys(MIFASA_GOAL_WHO).forEach(k => { const w = MIFASA_GOAL_WHO[k]; if (w[0].test(q)) who.push({ en: w[1], rw: w[2], k }); });
  let dom = null;
  for (const k of Object.keys(MIFASA_GOAL_DOMAINS)) if (MIFASA_GOAL_DOMAINS[k].re.test(q)) { dom = k; break; }
  if (!dom && who.length < 2) return null;                         // an unclear short wish is left to the normal engine
  const langs = [...new Set((q.match(MIFASA_GOAL_LANGS) || []).map(x => x.toLowerCase()))];
  const top = /\b(best|top|greatest|expert|master|professional|beza|mbere|umwe mu|ntunganye|ruta)\b/i.test(q);
  const beginner = /\b(beginner|just start\w*|new to|from scratch|ntangiye|nta cyo nzi|sinzi)\b/i.test(q);
  return { q, who, domain: dom, langs, top, beginner, en: (typeof detectQueryLang === "function" ? detectQueryLang(q) : "") === "en" };
}

function mifasaGoalSummary(g) {
  const d = g.domain ? MIFASA_GOAL_DOMAINS[g.domain] : null, en = g.en;
  const person = g.who.map(x => en ? x.en : x.rw).join(en ? " " : ", ");
  const lines = [];
  lines.push(en ? `👤 **Who you are:** ${person || "not stated yet"}` : `👤 **Uwo uri we:** ${person || "ntabwo urabivuga"}`);
  lines.push(en ? `🎯 **Your goal:** ${d ? d.goal_en : "(I need a bit more detail)"}${g.top ? " (at a high level)" : ""}` : `🎯 **Icyo ushaka:** ${d ? d.goal_rw : "(nkeneye ibisobanuro bike)"}${g.top ? " (ku rwego rwo hejuru)" : ""}`);
  if (d) lines.push(en ? `📚 **Field:** ${d.en}` : `📚 **Urwego:** ${d.rw}`);
  const lvl = g.langs.length ? (en ? `you already work with ${g.langs.join(", ")}` : `usanzwe ukoresha ${g.langs.join(", ")}`) : g.beginner ? (en ? "beginner" : "utangiye") : g.who.some(x => x.k === "role") ? (en ? "you already code, so we can skip the very basics" : "usanzwe ukora code, bityo twasimbuka ibya mbere cyane") : (en ? "not stated yet" : "ntabwo urabivuga");
  lines.push(en ? `📈 **Your level:** ${lvl}` : `📈 **Urwego rwawe:** ${lvl}`);
  return lines.join("\n");
}

function mifasaGoalRelatedNews(d, en) {
  try {
    if (!d || typeof mifasaSearch !== "function") return "";
    const hits = mifasaSearch(d.newsQ, 10).hits.filter(h => h && h.article && h.article._external && h.cov >= 0.5).slice(0, 3);
    if (!hits.length) return "";
    const lines = hits.map(h => { const a = h.article, u = typeof mifasaHubStoryUrl === "function" && a._hub ? mifasaHubStoryUrl(a) : a.link; return `• ${getTitle(a)} (${a.source || ""})${u ? "\n  🔗 " + u : ""}`; });
    return (en ? "\n\n📰 **Related stories I have stored:**\n" : "\n\n📰 **Inkuru zijyanye n'ibi mfite:**\n") + lines.join("\n");
  } catch (e) { return ""; }
}

async function mifasaGoalHandle(raw) {
  const q = String(raw || "").trim();
  const st = MIFASA_GOAL.state;
  /* 2nd turn: a short answer about the person's level, while the goal is still fresh */
  if (st && Date.now() - st.ts < MIFASA_GOAL.ttl && !(typeof window !== "undefined" && window.MIFASA_LLM_URL)) {
    const words = q.split(/\s+/).filter(Boolean).length, d = MIFASA_GOAL_DOMAINS[st.domain];
    if (d && words >= 2 && words <= 30 && /(\bnzi\b|\bnkoresha\b|ntangiye|\bi know\b|\bi use\b|\bi(?:'m| am) (?:a )?(?:beginner|intermediate|advanced)|intermediate|advanced|pentest|blue team|attack|defen[cs]e|gutera|kurinda|job|freelance|akazi|product|igicuruzwa)\b|\b(python|javascript|php|java|linux|react|sql)\b/i.test(q)) {
      const en = (typeof detectQueryLang === "function" ? detectQueryLang(q) : st.en ? "en" : "rw") === "en";
      const langs = [...new Set((q.match(MIFASA_GOAL_LANGS) || []).map(x => x.toLowerCase()))];
      if (langs.length) st.langs = [...new Set([...(st.langs || []), ...langs])];
      MIFASA_GOAL.state = Object.assign(st, { ts: Date.now() });
      const plan = d.plan30.map(x => "• " + (en ? x[0] : x[1])).join("\n");
      const text = "🤖 **MIFASA AI**\n\n" + (en ? `Thanks, that helps. ${st.langs && st.langs.length ? "With " + st.langs.join(", ") + " you can move faster. " : ""}Here is a first 30-day plan:\n` : `Murakoze, binyunguye. ${st.langs && st.langs.length ? "Ukoresheje " + st.langs.join(", ") + " wakwihuta. " : ""}Dore gahunda y'ibanze y'iminsi 30:\n`) + plan +
        (en ? "\n\n💬 Tell me which week feels hardest, or ask me for a project idea for this field, and we continue from there." : "\n\n💬 Mbwira icyumweru kikugora cyane, cyangwa unsabe igitekerezo cy'umushinga muri uru rwego, dukomeze.");
      return { items: [], corrected: "", html: mifasaAnswerBox(text), goal: true };
    }
  }
  const g = mifasaGoalParse(q);
  if (!g) return null;
  const d = g.domain ? MIFASA_GOAL_DOMAINS[g.domain] : null, en = g.en;
  MIFASA_GOAL.state = { ts: Date.now(), domain: g.domain, en, langs: g.langs };
  try {                                                         // remember the goal (on this device only; it is also given to the external AI as context)
    const who = g.who.map(x => x.en).join(" ");
    if (typeof mifasaMemAdd === "function" && d) mifasaMemAdd(`I am ${who ? "a " + who : "a learner"} and I want to ${d.goal_en}`);
  } catch (e) {}
  let text = "🤖 **MIFASA AI**\n\n" + (en ? "🔍 **Here is how I understood your request:**\n" : "🔍 **Dore uko nsobanukiwe ikibazo cyawe:**\n") + mifasaGoalSummary(g);
  const llmOn = typeof window !== "undefined" && window.MIFASA_LLM_URL && typeof mifasaLlmAnswer === "function";
  let llmHtml = "";
  if (llmOn) {
    const persona = g.who.map(x => x.en).join(" ") || "learner";
    const brief = `\n\n[MIFASA mentor mode: the user is a ${persona}${g.langs.length ? " who already uses " + g.langs.join(", ") : ""}. Goal: ${d ? d.goal_en : "see the message"}. ${d && d.ethic ? d.ethic + " " : ""}Give a short personalised plan with Rwanda context, then ask ONE question about their current level and keep the conversation going.]`;
    try { const l = await mifasaLlmAnswer(q + brief); if (l && l.html) llmHtml = l.html; } catch (e) { llmHtml = ""; }
  }
  if (!llmHtml) {                                               // local plan (no external AI, or it did not answer)
    if (d) {
      text += (en ? "\n\n🗺️ **A first roadmap:**\n" : "\n\n🗺️ **Inzira y'ibanze:**\n") + d.stages.map((s, i) => `${i + 1}. ${en ? s[0] : s[1]}`).join("\n");
      text += mifasaGoalRelatedNews(d, en);
      text += `\n\n💬 ${en ? d.q[0] : d.q[1]}`;
    } else {
      text += (en ? "\n\n💬 I understood the person, but not the field yet. Which exact skill or job do you want in the next 3 months?" : "\n\n💬 Nsobanukiwe uwo uri we, ariko sindamenya urwego. Ni uwuhe mwuga cyangwa ubumenyi ushaka mu mezi 3 ari imbere?");
    }
    return { items: [], corrected: "", html: mifasaAnswerBox(text), goal: true };
  }
  text += mifasaGoalRelatedNews(d, en);
  return { items: [], corrected: "", html: mifasaAnswerBox(text) + llmHtml, goal: true, llm: true };
}
MifasaAI.goalAnalyze = mifasaGoalParse;
MifasaAI.goalHandle = mifasaGoalHandle;
MifasaAI.goalState = () => MIFASA_GOAL.state;
MifasaAI.goalReset = () => { MIFASA_GOAL.state = null; };

/* ---------------------------------------------------------- */
/* 295. LEARNING LOOP: everything the external AI answers is   */
/* kept, so MIFASA needs the external AI less every day.       */
/*                                                             */
/* What is stored for each answer (one record):                */
/*   q_raw      exactly what the user typed (private data is   */
/*              never stored, see mifasaLearnPrivate)          */
/*   lang       rw | en                                        */
/*   q_norm     the question after spelling fix + normalising  */
/*   q_en/key_en the question in ENGLISH (pivot): from the     */
/*              external AI (d.q_en), from a translator, or    */
/*              from the dictionary (marked rough)             */
/*   understood how the external AI understood the question    */
/*              (d.understood_en) + MIFASA's own analysis      */
/*   answer + answer_lang (+ answer_alt: other languages)      */
/*   status     candidate -> verified (thumbs up) -> approved  */
/*              (owner reviewed on the server) | rejected      */
/* Before the external AI is called, the store is searched     */
/* (same language OR via the English pivot), so a question     */
/* asked once in Kinyarwanda is also answered when asked later */
/* in English. Nothing time-sensitive (news, prices, weather),  */
/* no follow-up and no private question is ever stored/reused. */
/* Optional (off by default): window.MIFASA_LEARN_SYNC = true  */
/* sends candidates to the owner's Worker (/api/learn) where   */
/* they WAIT for the owner's approval before anyone sees them. */
/* ---------------------------------------------------------- */
const MIFASA_LEARN = { mem: new Map(), db: null, ready: null, tcache: new Map(), queue: new Set(), timer: 0,
  max: 20000, ttlDays: 180, stats: { hits: 0, saved: 0, skipped: 0, synced: 0, translated: 0 } };
const MIFASA_LEARN_PRIVATE_RE = /(password|passcode|\bpin\b|ijambo ry.ibanga|\b\d{6,}\b|(?:\+?250|\b07\d)[\s-]?\d{2}[\s-]?\d{3}|@\w+\.\w+|\bhiv\b|cancer|diagnos|suicid|\bcvv\b|card number|nimero ya konti)/i;
const MIFASA_LEARN_STOP = new Set("the and for are was were what how why who when where which with from this that have has you your not can will nta si ni na wa ya mu cya bya iyi uyu uwo iki kuki gute ese".split(" "));

function mifasaLearnBase() {
  if (typeof window === "undefined") return "";
  if (window.MIFASA_LEARN_URL) return String(window.MIFASA_LEARN_URL).replace(/\/+$/, "");
  return window.MIFASA_LLM_URL ? String(window.MIFASA_LLM_URL).replace(/\/+$/, "") : "";
}
function mifasaLearnSync() { return typeof window !== "undefined" && window.MIFASA_LEARN_SYNC === true && !!mifasaLearnBase(); }
function mifasaLearnId(lang, qn) {            // small stable hash (FNV-1a), the same question always gets the same id
  let h = 2166136261; const s = lang + "|" + qn;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return "L" + h.toString(36) + s.length.toString(36);
}
function mifasaLearnQLang(q) { const l = typeof detectQueryLang === "function" ? detectQueryLang(q) : ""; return l === "en" ? "en" : l === "rw" ? "rw" : (currentLang === "en" ? "en" : "rw"); }
function mifasaLearnNorm(q) { return mifasaNorm(brainFixQuery(String(q || ""))); }
function mifasaLearnToks(s) { return String(s || "").split(" ").filter(t => t.length > 2 && !MIFASA_LEARN_STOP.has(t)); }

/* may this question/answer be stored or reused at all? */
function mifasaLearnEligible(raw, opt) {
  const q = String(raw || "").trim();
  if (q.length < 6 || q.length > 400) return false;
  if (/\[MIFASA mentor mode/.test(q)) return false;                                   // personal goal answers depend on the person
  if (opt && opt.web) return false;                                                    // live web search = fresh by definition
  if (MIFASA_LEARN_PRIVATE_RE.test(q)) return false;
  if (typeof MIFASA_SAFETY_RE !== "undefined" && MIFASA_SAFETY_RE.test(q)) return false;
  if (typeof mifasaKbFresh === "function" && mifasaKbFresh(q)) return false;           // news, prices, weather, "today"...
  if (typeof mifasaConvIsFollowUp === "function" && mifasaConvIsFollowUp(q)) return false;   // depends on what was said before
  return true;
}

/* ---- storage: IndexedDB when there is one, memory otherwise ---- */
function mifasaLearnOpen() {
  return new Promise(res => {
    try {
      if (typeof indexedDB === "undefined") return res(null);
      const r = indexedDB.open("mifasa_learn", 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore("items", { keyPath: "id" }); } catch (e) {} };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
}
function mifasaLearnLoad() {
  if (MIFASA_LEARN.ready) return MIFASA_LEARN.ready;
  MIFASA_LEARN.ready = (async () => {
    MIFASA_LEARN.db = await mifasaLearnOpen();
    if (MIFASA_LEARN.db) {
      await new Promise(done => {
        try {
          const q = MIFASA_LEARN.db.transaction("items", "readonly").objectStore("items").getAll();
          q.onsuccess = () => { (q.result || []).forEach(r => { if (r && r.id) MIFASA_LEARN.mem.set(r.id, r); }); done(); };
          q.onerror = () => done();
        } catch (e) { done(); }
      });
    }
    mifasaLearnLoadStatic();                         // approved answers from the owner's server (no wait)
    return true;
  })();
  return MIFASA_LEARN.ready;
}
function mifasaLearnPut(rec) {
  MIFASA_LEARN.mem.set(rec.id, rec);
  try { if (MIFASA_LEARN.db) MIFASA_LEARN.db.transaction("items", "readwrite").objectStore("items").put(rec); } catch (e) {}
}
function mifasaLearnDel(id) {
  MIFASA_LEARN.mem.delete(id);
  try { if (MIFASA_LEARN.db) MIFASA_LEARN.db.transaction("items", "readwrite").objectStore("items").delete(id); } catch (e) {}
}
function mifasaLearnPrune() {
  if (MIFASA_LEARN.mem.size <= MIFASA_LEARN.max) return;
  const rank = { rejected: 0, candidate: 1, verified: 2, approved: 3 };
  const list = [...MIFASA_LEARN.mem.values()].sort((a, b) => (rank[a.status] - rank[b.status]) || ((a.last_used || a.updated) - (b.last_used || b.updated)));
  list.slice(0, MIFASA_LEARN.mem.size - MIFASA_LEARN.max).forEach(r => mifasaLearnDel(r.id));
}
/* approved answers kept on the owner's server (GET /api/learned/export), refreshed every 6 hours */
/* answers learned every day by learn-daily.js (GitHub Actions) and published on the site itself: learned/index.json -> learned/part-000N.json.
   No Worker needed. A part is downloaded again only when its size changed; learned/banned.json removes answers the owner banned. */
async function mifasaLearnLoadSite() {
  if (typeof fetch === "undefined" || typeof localStorage === "undefined") return 0;
  const getJ = async f => { const c = new AbortController(), t = setTimeout(() => c.abort(), 12000); try { const r = await fetch(f, { signal: c.signal, cache: "no-cache", credentials: "omit" }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); } };
  const idx = await getJ("learned/index.json"); if (!idx || !Array.isArray(idx.parts)) return 0;
  let seen = {}; try { seen = JSON.parse(localStorage.getItem("mifasa_learn_site_v1") || "{}") || {}; } catch (e) {}
  if (!MIFASA_LEARN.mem.size) seen = {};                                              // browser storage was cleared: load everything again
  let n = 0; const batch = [];
  for (const p of idx.parts) {
    if (!p || !/^part-\d{4}\.json$/.test(p.file) || seen[p.file] === p.count) continue;
    const d = await getJ("learned/" + p.file); if (!d || !Array.isArray(d.items)) continue;
    d.items.forEach(x => { if (!x || !x.id || !x.answer || MIFASA_LEARN.mem.has(x.id) && MIFASA_LEARN.mem.get(x.id).site) return;
      const old = MIFASA_LEARN.mem.get(x.id);
      if (old && (old.status === "approved" || old.status === "rejected") && !old.site) return;                       // the owner's own decision wins
      const rec = Object.assign({}, old || {}, x, { status: "approved", site: true, uses: (old && old.uses) || 0, updated: Date.now() });
      MIFASA_LEARN.mem.set(rec.id, rec); batch.push(rec); n++; });
    seen[p.file] = p.count;
  }
  const ban = await getJ("learned/banned.json");
  if (ban) { const ids = new Set(ban.ids || []), ws = new Set((ban.words || []).map(w => String(w).toLowerCase()));
    [...MIFASA_LEARN.mem.values()].forEach(r => { if (r.site && (ids.has(r.id) || ws.has(String(r.word || "").toLowerCase()))) mifasaLearnDel(r.id); }); }
  if (batch.length && MIFASA_LEARN.db) { try { const tx = MIFASA_LEARN.db.transaction("items", "readwrite"), st = tx.objectStore("items"); batch.forEach(r => st.put(r)); } catch (e) {} }     // ONE transaction for the whole batch
  try { localStorage.setItem("mifasa_learn_site_v1", JSON.stringify(seen)); } catch (e) {}
  return n;
}
async function mifasaLearnLoadStatic() {
  try {
    try { await mifasaLearnLoadSite(); } catch (e) { /* optional */ }
    const base = mifasaLearnBase(); if (!base) return;
    const last = +localStorage.getItem("mifasa_learn_static_ts") || 0;
    if (Date.now() - last < 6 * 3600 * 1000) return;
    const c = new AbortController(), t = setTimeout(() => c.abort(), 12000);
    const r = await fetch(base + "/api/learned/export", { signal: c.signal, credentials: "omit" }); clearTimeout(t);
    if (!r.ok) return;
    const j = await r.json(), items = (j && j.items) || [];
    let n = 0;
    items.forEach(x => {
      if (!x || !x.id || !x.answer) return;
      const old = MIFASA_LEARN.mem.get(x.id);
      mifasaLearnPut(Object.assign({}, old || {}, x, { status: "approved", server: true, uses: (old && old.uses) || 0, updated: Date.now() })); n++;
    });
    localStorage.setItem("mifasa_learn_static_ts", String(Date.now()));
    return n;
  } catch (e) { /* optional */ }
}

/* ---- translation chain: external AI said it -> translator API -> dictionary (rough) ---- */
async function mifasaLearnTranslate(text, from, to) {
  const t = String(text || "").trim();
  if (!t || from === to) return { text: t, via: "same" };
  const ck = from + ">" + to + ":" + t.slice(0, 500);
  if (MIFASA_LEARN.tcache.has(ck)) return MIFASA_LEARN.tcache.get(ck);
  let out = null;
  const url = (typeof window !== "undefined" && window.MIFASA_TRANSLATE_URL) || (mifasaLearnBase() ? mifasaLearnBase() + "/api/translate" : "");
  if (url && (typeof window === "undefined" || window.MIFASA_TRANSLATE !== false)) {
    try {
      const c = new AbortController(), tm = setTimeout(() => c.abort(), 9000);
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t.slice(0, 6000), from, to }), signal: c.signal, credentials: "omit" });
      clearTimeout(tm);
      if (r.ok) { const j = await r.json(); if (j && j.text && String(j.text).trim()) { out = { text: String(j.text).trim(), via: "api" }; MIFASA_LEARN.stats.translated++; } }
    } catch (e) { out = null; }
  }
  if (!out && from === "rw" && to === "en" && typeof mifasaBridgeEn === "function") {
    const b = mifasaBridgeEn(t);
    if (b) out = { text: b, via: "dictionary", rough: true };                      // word-for-word: good enough as a search key, never shown as a translation
  }
  if (out) { if (MIFASA_LEARN.tcache.size > 400) MIFASA_LEARN.tcache.clear(); MIFASA_LEARN.tcache.set(ck, out); }
  return out;
}
/* the English form of a question that is already known (used by the external-AI request as q_en) */
function mifasaLearnPivot(raw) {
  const q = String(raw || "").trim(); if (!q) return undefined;
  if (mifasaLearnQLang(q) === "en") return undefined;
  const c = MIFASA_LEARN.tcache.get("rw>en:" + q.slice(0, 500));
  return c && !c.rough ? c.text : undefined;
}

/* ---- finding a stored answer ---- */
function mifasaLearnFind(qn, qen, lang) {
  const A = new Set([...mifasaLearnToks(qn), ...mifasaLearnToks(qen)]);
  if (!A.size) return null;
  let best = null;
  for (const r of MIFASA_LEARN.mem.values()) {
    if (r.status === "rejected" || !r.answer) continue;
    if (r.status !== "approved" && r.status !== "verified" && Date.now() - (r.updated || 0) > MIFASA_LEARN.ttlDays * 864e5) continue;   // unchecked answers go stale
    let s = 0;
    if (r.q_norm === qn && r.lang === lang) s = 1;
    else if (qen && r.key_en && r.key_en === qen) s = 0.98;
    else {
      const B = new Set([...mifasaLearnToks(r.q_norm), ...mifasaLearnToks(r.key_en)]);
      let common = 0; A.forEach(t => { if (B.has(t)) common++; });
      if (common >= 2 && common / Math.max(A.size, B.size) >= 0.6) s = Math.max(mifasaTokenOverlap(qn, r.q_norm), qen && r.key_en ? mifasaTokenOverlap(qen, r.key_en) : 0);
    }
    const need = r.status === "approved" || r.status === "verified" ? 0.9 : 0.97;           // unchecked answers must match (almost) exactly
    if (s >= need && (!best || s > best.s)) best = { r, s };
  }
  return best;
}

async function mifasaLearnLookup(raw, opt) {
  try {
    if (!mifasaLearnEligible(raw, opt)) return null;
    await mifasaLearnLoad();
    if (!MIFASA_LEARN.mem.size) { if (mifasaLearnQLang(raw) !== "en") mifasaLearnTranslate(raw, "rw", "en"); return null; }
    const lang = mifasaLearnQLang(raw), qn = mifasaLearnNorm(raw);
    let qen = lang === "en" ? qn : "";
    if (lang !== "en") { const tr = await mifasaLearnTranslate(raw, lang, "en"); if (tr && tr.text) qen = mifasaLearnNorm(tr.text); }
    const hit = mifasaLearnFind(qn, qen, lang);
    if (!hit) return null;
    const r = hit.r, want = lang === "en" ? "en" : "rw";
    let text = (r.answer_alt && r.answer_alt[want]) || (r.answer_lang === want ? r.answer : "");
    let langNote = "";
    if (!text) {                                                                       // the answer is saved in the other language: translate it (and save the translation)
      const tr = await mifasaLearnTranslate(r.answer, r.answer_lang || "en", want);
      if (tr && tr.text && !tr.rough) { text = tr.text; r.answer_alt = Object.assign({}, r.answer_alt, { [want]: text }); }
      else { text = r.answer; langNote = want === "en" ? "\n\n_(This answer was saved in Kinyarwanda.)_" : "\n\n_(Iki gisubizo cyabitswe mu Cyongereza.)_"; }
    }
    r.uses = (r.uses || 0) + 1; r.last_used = Date.now(); mifasaLearnPut(r);
    MIFASA_LEARN.stats.hits++;
    const checked = r.status === "approved" || r.status === "verified";
    const note = want === "en"
      ? (checked ? "\n\n_📚 From MIFASA's own checked knowledge._" : "\n\n_📚 Saved from an earlier answer by a free external AI. Double-check important facts._")
      : (checked ? "\n\n_📚 Gishingiye ku bumenyi bwa MIFASA bwamaze kugenzurwa._" : "\n\n_📚 Cyabitswe mu gisubizo cyatanzwe mbere na AI y'ubuntu yo hanze. Genzura ibyingenzi._");
    return { items: [], corrected: "", html: mifasaAnswerBox("🤖 **MIFASA AI**\n\n" + text + langNote + note), learned: true, learnId: r.id, llm: false };
  } catch (e) { return null; }       // the store is optional: never break answering
}

/* ---- saving what the external AI answered ---- */
async function mifasaLearnCapture(raw, d, ctx) {
  try {
    const opt = ctx && ctx.opt;
    if (!d || !d.text || d.taught || !mifasaLearnEligible(raw, opt)) { MIFASA_LEARN.stats.skipped++; return null; }
    const ans = String(d.text).trim();
    if (ans.length < 20 || ans.length > 6000 || MIFASA_LEARN_PRIVATE_RE.test(String(raw))) { MIFASA_LEARN.stats.skipped++; return null; }
    await mifasaLearnLoad();
    const lang = mifasaLearnQLang(raw), ansLang = ctx && ctx.en ? "en" : (lang === "en" ? "en" : "rw"), qn = mifasaLearnNorm(raw);
    if (qn.length < 3) return null;
    let qen = lang === "en" ? qn : (d.q_en ? mifasaLearnNorm(d.q_en) : "");
    let via = d.q_en ? "external_ai" : "";
    if (!qen && lang !== "en") { const tr = await mifasaLearnTranslate(raw, lang, "en"); if (tr && tr.text) { qen = mifasaLearnNorm(tr.text); via = tr.via; } }
    if (lang === "en") via = "same";
    let analysis = {};
    try { const a = mifasaAnalyzeQuestion(raw); analysis = { qtype: a.qtype, goal: a.goal, topic: a.topic, question: !!a.looksLikeQuestion }; } catch (e) {}
    const id = mifasaLearnId(lang, qn), now = Date.now(), old = MIFASA_LEARN.mem.get(id);
    if (old && (old.status === "approved" || old.status === "rejected")) return old;      // the owner's decision is never overwritten by a new AI answer
    const rec = Object.assign({}, old || {}, {
      id, v: 1, lang, q_raw: String(raw).trim().slice(0, 400), q_norm: qn, q_en: qen, key_en: qen, q_en_via: via,
      understood: String(d.understood_en || d.understood || "").slice(0, 400), analysis, intent: d.intent || analysis.goal || "",
      answer: ans, answer_lang: ansLang, answer_alt: old && old.answer_lang === ansLang ? (old.answer_alt || {}) : {},
      grounded: !!(d.web || d.kb || (ctx && ctx.ctx)), sources: Array.isArray(d.sources) ? d.sources.slice(0, 3).map(x => ({ title: String(x.title || "").slice(0, 80), url: String(x.url || "").slice(0, 200) })) : [],
      status: old && old.status === "verified" ? "verified" : "candidate", uses: (old && old.uses) || 0, helpful: (old && old.helpful) || 0, unhelpful: (old && old.unhelpful) || 0,
      created: (old && old.created) || now, updated: now, synced: false
    });
    mifasaLearnPut(rec); mifasaLearnPrune();
    MIFASA_LEARN.stats.saved++;
    if (mifasaLearnSync()) { MIFASA_LEARN.queue.add(id); mifasaLearnSchedule(); }
    return rec;
  } catch (e) { return null; }
}

/* ---- owner's server: candidates go there to WAIT for approval ---- */
function mifasaLearnSchedule() { if (MIFASA_LEARN.timer || typeof setTimeout !== "function") return; MIFASA_LEARN.timer = setTimeout(() => { MIFASA_LEARN.timer = 0; mifasaLearnFlush(); }, 20000); }
async function mifasaLearnFlush() {
  if (!mifasaLearnSync()) return 0;
  const ids = [...MIFASA_LEARN.queue].slice(0, 20), items = ids.map(i => MIFASA_LEARN.mem.get(i)).filter(r => r && r.status !== "rejected" && !r.server);
  if (!items.length) { MIFASA_LEARN.queue.clear(); return 0; }
  try {
    const body = items.map(r => ({ id: r.id, lang: r.lang, q_raw: r.q_raw, q_norm: r.q_norm, q_en: r.q_en, key_en: r.key_en, understood: r.understood, intent: r.intent, answer: r.answer, answer_lang: r.answer_lang, grounded: r.grounded, sources: r.sources }));
    const res = await fetch(mifasaLearnBase() + "/api/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: body }), credentials: "omit" });
    if (!res.ok) return 0;
    ids.forEach(i => { MIFASA_LEARN.queue.delete(i); const r = MIFASA_LEARN.mem.get(i); if (r) { r.synced = true; mifasaLearnPut(r); } });
    MIFASA_LEARN.stats.synced += items.length;
    if (MIFASA_LEARN.queue.size) mifasaLearnSchedule();
    return items.length;
  } catch (e) { mifasaLearnSchedule(); return 0; }
}

/* ---- feedback: 👍 makes an answer "verified" on this device, 👎 stops it from ever being reused ---- */
function mifasaLearnRate(id, good) {
  const r = MIFASA_LEARN.mem.get(id); if (!r) return { ok: false, reason: "not_found" };
  if (good) { r.helpful = (r.helpful || 0) + 1; if (r.status === "candidate") r.status = "verified"; }
  else { r.unhelpful = (r.unhelpful || 0) + 1; if (r.status !== "approved") r.status = "rejected"; }
  r.updated = Date.now(); mifasaLearnPut(r);
  try { if (mifasaLearnSync()) fetch(mifasaLearnBase() + "/api/learn/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, good: !!good }), credentials: "omit" }).catch(() => {}); } catch (e) {}
  return { ok: true, status: r.status };
}

MifasaAI.learn = {
  stats: () => Object.assign({ stored: MIFASA_LEARN.mem.size, sync: mifasaLearnSync(), queued: MIFASA_LEARN.queue.size }, MIFASA_LEARN.stats),
  list: () => [...MIFASA_LEARN.mem.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0)),
  export: () => JSON.stringify({ version: 1, items: [...MIFASA_LEARN.mem.values()] }, null, 1),
  import: list => { let n = 0; (Array.isArray(list) ? list : (list && list.items) || []).forEach(x => { if (x && x.id && x.answer && x.q_norm) { mifasaLearnPut(Object.assign({ status: "candidate", updated: Date.now() }, x)); n++; } }); return n; },
  clear: () => { [...MIFASA_LEARN.mem.keys()].forEach(mifasaLearnDel); MIFASA_LEARN.queue.clear(); return true; },
  rate: mifasaLearnRate, lookup: mifasaLearnLookup, capture: mifasaLearnCapture, translate: mifasaLearnTranslate, flush: mifasaLearnFlush, load: mifasaLearnLoad
};
if (typeof document !== "undefined" && typeof setTimeout === "function") setTimeout(() => { try { mifasaLearnLoad(); } catch (e) {} }, 8000);
})();
