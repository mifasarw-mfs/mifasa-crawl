/* MIFASARW Offline v1  (no library, works on web + Android APK)
   1) story.html : "💾 Bika offline" button  -> saves page + its data/images in cache "mifasarw-saved" and list "mifasaSaved"
                   (same keys offline.html and sw.js already use)
   2) offline.html: "📂 Open a file" reader   -> opens YOUR files from the phone with no internet
                    (txt, md, csv, json, html, pdf, images, audio, video)
   3) offline.html: "⬇️ Download"             -> download a saved story (.html) or the whole saved list (.json), and import it back
   Videos: YouTube embeds cannot play offline. We save the video's title + thumbnail + link. Your OWN video files can be opened with the file reader. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var en = false; try { en = localStorage.getItem("siteLang") === "en"; } catch (e) {}
  var T = function (rw, e) { return en ? e : rw; };
  var SAVED = "mifasarw-saved", KEY = "mifasaSaved";
  function list() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function setList(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function toast(m) {
    var t = document.createElement("div"); t.textContent = m;
    t.style.cssText = "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:12px;z-index:99999;font:600 14px system-ui;max-width:90%;text-align:center";
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800);
  }
  function meta(p) { var m = document.querySelector('meta[property="' + p + '"]'); return m ? m.content : ""; }

  /* ---------------- 1) save a story offline ---------------- */
  function isStory() { return /story\.html$/.test(location.pathname) || /^\/s\/.+\.html$/.test(location.pathname); }
  function storyId() { var q = new URLSearchParams(location.search).get("news"); return q || location.pathname + location.search; }

  async function saveStory(btn) {
    if (!("caches" in window)) { toast(T("Telefone yawe ntibishyigikira.", "Not supported on this browser.")); return; }
    btn.disabled = true; var old = btn.textContent; btn.textContent = "⏳";
    try {
      var c = await caches.open(SAVED), urls = {};
      urls[location.pathname + location.search] = 1;
      performance.getEntriesByType("resource").forEach(function (r) {
        try {
          var u = new URL(r.name);
          if (u.origin === location.origin && /\.(json|css|js|png|jpg|jpeg|webp|svg|woff2?)$/i.test(u.pathname)) urls[u.pathname + u.search] = 1;
        } catch (e) {}
      });
      var ok = 0;
      await Promise.all(Object.keys(urls).map(async function (u) {
        try { var r = await fetch(u, { cache: "reload" }); if (r.ok) { await c.put(new Request(u), r); ok++; } } catch (e) {}
      }));
      var img = meta("og:image"), hero = document.querySelector("#storyImage, .story img, article img");
      img = img || (hero && hero.src) || "";
      if (img) { try { var ir = await fetch(img, { mode: "no-cors" }); await c.put(new Request(img, { mode: "no-cors" }), ir); } catch (e) {} }
      var a = list(), id = storyId();
      a = a.filter(function (x) { return x.id !== id; });
      a.unshift({ id: id, url: location.pathname + location.search, title: (document.title || id).replace(/\s*[|\-–]\s*MIFASARW.*$/i, ""), img: img, t: Date.now() });
      setList(a);
      btn.textContent = "✅ " + T("Yabitswe", "Saved");
      toast(T("Inkuru yabitswe: isomeka nta internet.", "Story saved: opens without internet."));
    } catch (e) { btn.textContent = old; toast(T("Ntibyakunze.", "Could not save.")); }
    btn.disabled = false;
  }

  function addSaveButton() {
    if (!isStory() || $("mfoSave")) return;
    if (/Bika offline|Save offline/i.test(document.body.innerText || "")) return;   // another script already added it
    var b = document.createElement("button"); b.id = "mfoSave"; b.type = "button";
    var has = list().some(function (x) { return x.id === storyId(); });
    b.textContent = has ? "✅ " + T("Yabitswe", "Saved") : "💾 " + T("Bika offline", "Save offline");
    b.style.cssText = "position:fixed;right:14px;bottom:18px;z-index:9999;background:#e63946;color:#fff;border:0;border-radius:26px;padding:12px 18px;font:700 14px system-ui;box-shadow:0 4px 14px #0004;cursor:pointer";
    b.onclick = function () { saveStory(b); };
    document.body.appendChild(b);
  }

  /* ---------------- 2+3) offline.html: file reader + downloads ---------------- */
  function dl(name, blob) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var lastUrl = null;

  function openFile(f, out) {
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
    var n = f.name || "", t = f.type || "", ext = (n.split(".").pop() || "").toLowerCase();
    out.innerHTML = "<p class='s'><b>" + esc(n) + "</b> · " + (f.size / 1024).toFixed(1) + " KB</p>";
    var body = document.createElement("div"); out.appendChild(body);
    if (/^(txt|md|csv|log|json|xml|js|css)$/.test(ext) || /^text\//.test(t) || t === "application/json") {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result);
        if (ext === "json") { try { s = JSON.stringify(JSON.parse(s), null, 2); } catch (e) {} }
        body.innerHTML = "<pre style='white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;margin:0'>" + esc(s.slice(0, 400000)) + "</pre>";
      };
      r.readAsText(f);
    } else if (/^(html|htm)$/.test(ext)) {
      lastUrl = URL.createObjectURL(f);
      body.innerHTML = "<iframe sandbox style='width:100%;height:60vh;border:0;background:#fff' src='" + lastUrl + "'></iframe>";   // sandbox: scripts inside the file cannot run
    } else if (t.indexOf("image/") === 0) {
      lastUrl = URL.createObjectURL(f); body.innerHTML = "<img src='" + lastUrl + "' style='max-width:100%;border-radius:10px'>";
    } else if (t.indexOf("video/") === 0) {
      lastUrl = URL.createObjectURL(f); body.innerHTML = "<video src='" + lastUrl + "' controls playsinline style='width:100%;border-radius:10px'></video>";
    } else if (t.indexOf("audio/") === 0) {
      lastUrl = URL.createObjectURL(f); body.innerHTML = "<audio src='" + lastUrl + "' controls style='width:100%'></audio>";
    } else if (ext === "pdf" || t === "application/pdf") {
      lastUrl = URL.createObjectURL(f); body.innerHTML = "<iframe style='width:100%;height:65vh;border:0' src='" + lastUrl + "'></iframe><p class='s'><a href='" + lastUrl + "' target='_blank'>" + T("Fungura ukwayo", "Open separately") + "</a></p>";
    } else {
      body.innerHTML = "<p class='s'>" + T("Iyi format ntishobora gufungurwa hano. Kanda hasi ugire download.", "This format cannot be shown here. Use download below.") + "</p>";
      lastUrl = URL.createObjectURL(f);
    }
    var d = document.createElement("a"); d.className = "btn d"; d.textContent = "⬇️ " + T("Bika kuri telefone", "Download copy"); d.href = lastUrl || "#"; d.download = n; d.style.cssText = "display:inline-block;margin-top:8px;text-decoration:none";
    if (!lastUrl) d.onclick = function (e) { e.preventDefault(); dl(n, f); };
    out.appendChild(d);
  }

  async function downloadStory(x) {
    var r = await caches.match(x.url, { ignoreSearch: false });
    if (!r) { toast(T("Iyi nkuru ntabitswe neza.", "This story is not cached.")); return; }
    dl((String(x.id).replace(/[^\w-]+/g, "_").slice(0, 60) || "story") + ".html", await r.blob());
  }

  function offlinePanel() {
    if (!/offline\.html$/.test(location.pathname) || $("mfoBox")) return;
    var main = document.querySelector("main"); if (!main) return;
    var box = document.createElement("div"); box.id = "mfoBox"; box.className = "box";
    box.innerHTML =
      "<h2 style='margin:0 0 6px'>📂 " + T("Fungura dosiye yawe", "Open your file") + "</h2>" +
      "<p class='s'>" + T("Ikora nta internet: txt, json, csv, html, pdf, ifoto, amajwi, video.", "Works with no internet: txt, json, csv, html, pdf, images, audio, video.") + "</p>" +
      "<input type='file' id='mfoFile' style='display:none'>" +
      "<button class='btn' id='mfoPick'>📂 " + T("Hitamo dosiye", "Choose file") + "</button>" +
      "<div id='mfoOut' style='margin-top:10px'></div>" +
      "<h2 style='margin:18px 0 6px'>⬇️ " + T("Download / Subiza", "Download / Restore") + "</h2>" +
      "<div id='mfoDl'></div>" +
      "<button class='btn d' id='mfoExp'>⬇️ " + T("Bika urutonde (.json)", "Download saved list (.json)") + "</button>" +
      "<button class='btn d' id='mfoImp'>⬆️ " + T("Subiza urutonde", "Import list") + "</button>" +
      "<input type='file' id='mfoImpF' accept='.json,application/json' style='display:none'>";
    var h = $("home"); main.insertBefore(box, h || null);
    $("mfoPick").onclick = function () { $("mfoFile").click(); };
    $("mfoFile").onchange = function (e) { var f = e.target.files[0]; if (f) openFile(f, $("mfoOut")); };
    $("mfoExp").onclick = function () { dl("mifasarw-saved.json", new Blob([JSON.stringify(list(), null, 2)], { type: "application/json" })); };
    $("mfoImp").onclick = function () { $("mfoImpF").click(); };
    $("mfoImpF").onchange = function (e) {
      var f = e.target.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () {
        try {
          var inc = JSON.parse(r.result); if (!Array.isArray(inc)) throw 0;
          var cur = list(), ids = {}; cur.forEach(function (x) { ids[x.id] = 1; });
          inc.forEach(function (x) { if (x && x.id && !ids[x.id]) cur.push({ id: String(x.id), url: x.url, title: x.title, img: x.img, t: x.t || Date.now() }); });
          setList(cur); toast(T("Byasubijwemo. Fungura page ukongere.", "Imported. Reload the page.")); setTimeout(function () { location.reload(); }, 1200);
        } catch (er) { toast(T("Dosiye ntiboneye.", "Invalid file.")); }
      };
      r.readAsText(f);
    };
    var dlBox = $("mfoDl");
    list().slice(0, 20).forEach(function (x) {
      var b = document.createElement("button"); b.className = "btn d"; b.style.cssText = "display:block;margin:4px 0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      b.textContent = "⬇️ " + (x.title || x.id); b.onclick = function () { downloadStory(x); }; dlBox.appendChild(b);
    });
  }

  function init() { addSaveButton(); offlinePanel(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
