/* MIFASARW Plus v1: hub y'imikino, quiz, ibikoresho, streak/XP, kwibutsa. Nta library. Ikora kuri web no muri APK.
   Shyira <script src="/mifasa-plus.js" defer></script> nyuma ya mifasa-app.js. Amakuru yose ni localStorage "mifasaPlus". */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var K = "mifasaPlus", S = {};
  try { S = JSON.parse(localStorage.getItem(K)) || {}; } catch (e) {}
  function put() { try { localStorage.setItem(K, JSON.stringify(S)); } catch (e) {} }
  function dk(d) { d = d || new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  var today = dk(), yest = dk(new Date(Date.now() - 864e5));
  S.xp = S.xp || 0; S.streak = S.streak || 0; S.best = S.best || 0; S.t = S.t || {}; S.notes = S.notes || "";
  if (S.last !== today) { S.streak = S.last === yest ? S.streak + 1 : 1; S.last = today; S.xp += 10; S.best = Math.max(S.best, S.streak); }
  if (S.dd !== today) { S.dd = today; S.done = {}; S.reads = []; }
  put();
  function xp(n) { S.xp += n; put(); }
  function lvl() { return Math.floor(Math.sqrt(S.xp / 40)) + 1; }
  function toast(m) {
    var t = document.createElement("div"); t.className = "mp-toast"; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function quest(n, bonus) { if (!S.done[n]) { S.done[n] = 1; xp(bonus); toast("🎯 Intego irangiye: +" + bonus + " XP"); } }

  /* igihe umaze muri app + inkuru zasomwe uyu munsi */
  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    S.t[today] = (S.t[today] || 0) + 15;
    Object.keys(S.t).forEach(function (k) { if (Object.keys(S.t).length > 14 && k !== today) delete S.t[k]; });
    if (S.t[today] >= 1800) quest("time", 30);
    put();
  }, 15000);
  try {
    var sid = new URLSearchParams(location.search).get("news");
    if (/story\.html$/.test(location.pathname) && sid && S.reads.indexOf(sid) < 0) { S.reads.push(sid); put(); if (S.reads.length >= 3) quest("read", 20); }
  } catch (e) {}

  /* native (Capacitor) */
  var C = window.Capacitor, native = !!(C && C.isNativePlatform && C.isNativePlatform()), P = (C && C.Plugins) || {};
  if (native) { try { P.StatusBar.setBackgroundColor({ color: "#e63946" }); } catch (e) {} }
  async function remind(on) {
    if (!P.LocalNotifications) return false;
    try {
      var p = await P.LocalNotifications.requestPermissions(); if (p.display !== "granted") return false;
      await P.LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }] });
      if (on) await P.LocalNotifications.schedule({ notifications: [
        { id: 1, title: "MIFASARW 📰", body: "Amakuru y'uyu munsi arakwiteguye.", schedule: { on: { hour: 7, minute: 30 }, allowWhileIdle: true } },
        { id: 2, title: "MIFASARW 🔥", body: "Ntucikwe: komeza iminsi uhora uza!", schedule: { on: { hour: 19, minute: 0 }, allowWhileIdle: true } }] });
      return true;
    } catch (e) { return false; }
  }

  /* ---------- ibibazo bya quiz (shyiramo ibindi uko ushaka) ---------- */
  var Q = [
    ["Umurwa mukuru w'u Rwanda ni uwuhe?", ["Kigali", "Huye", "Musanze", "Rubavu"], 0],
    ["U Rwanda rwabonye ubwigenge mu mwaka wa?", ["1959", "1962", "1994", "1980"], 1],
    ["Ikiyaga kinini cy'u Rwanda ni?", ["Muhazi", "Ruhondo", "Kivu", "Ihema"], 2],
    ["Ikirunga kirekire mu Rwanda ni?", ["Karisimbi", "Bisoke", "Muhabura", "Sabyinyo"], 0],
    ["Uturere tungahe tugize u Rwanda?", ["20", "27", "30", "35"], 2],
    ["Ingagi zo mu misozi ziboneka muri pariki iyihe?", ["Akagera", "Ibirunga", "Gishwati", "Nyungwe"], 1],
    ["Pariki ya Akagera iherereye mu ntara iyihe?", ["Iburasirazuba", "Amajyepfo", "Iburengerazuba", "Amajyaruguru"], 0],
    ["Ikicaro cya EAC (East African Community) kiri muri?", ["Kigali", "Nairobi", "Arusha", "Kampala"], 2],
    ["Amazi agizwe na?", ["CO2", "H2O", "O2", "NaCl"], 1],
    ["Ni uwuhe mubumbe wegereye izuba cyane?", ["Venus", "Mars", "Mercure", "Isi"], 2],
    ["Kontineti zose ku isi ni zingahe?", ["5", "6", "7", "8"], 2],
    ["7 × 8 = ?", ["54", "56", "58", "64"], 1],
    ["AI ni impfunge ya?", ["Artificial Intelligence", "Auto Internet", "Advanced Input", "All Info"], 0],
    ["WWW bivuga iki?", ["World Wide Web", "Web With Words", "Wide World Wire", "Web World Window"], 0]
  ];
  function seeded(n) { var s = 0, d = today; for (var i = 0; i < d.length; i++) s = (s * 31 + d.charCodeAt(i)) % 9973; return function () { s = (s * 1103 + 12345) % 9973; return s / 9973; }; }
  function dailyQs() { var r = seeded(), a = Q.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a.slice(0, 5); }

  function quiz(box) {
    if (S.quizDay === today) { box.innerHTML = '<p class="mp-s">✅ Wamaze gukora ikibazo cy\'uyu munsi (amanota: ' + S.quizScore + '/5). Garuka ejo!</p>'; return; }
    var qs = dailyQs(), i = 0, sc = 0;
    (function show() {
      if (i >= qs.length) { S.quizDay = today; S.quizScore = sc; xp(sc * 5); put(); quest("quiz", 25); box.innerHTML = '<h3>🎉 ' + sc + '/5</h3><p class="mp-s">Wungutse XP ' + (sc * 5 + 25) + '.</p>'; return; }
      var q = qs[i];
      box.innerHTML = '<p class="mp-s">Ikibazo ' + (i + 1) + '/5</p><h3>' + esc(q[0]) + '</h3>' + q[1].map(function (o, k) { return '<button class="mp-b mp-o" data-k="' + k + '">' + esc(o) + "</button>"; }).join("");
      box.onclick = function (e) {
        var b = e.target.closest(".mp-o"); if (!b || box.dataset.lock) return; box.dataset.lock = 1;
        var ok = +b.dataset.k === q[2]; if (ok) sc++; b.classList.add(ok ? "ok" : "bad");
        if (!ok) box.querySelectorAll(".mp-o")[q[2]].classList.add("ok");
        setTimeout(function () { delete box.dataset.lock; i++; show(); }, 900);
      };
    })();
  }

  /* ---------- imikino ---------- */
  function memory(box) {
    var em = ["🦍", "🌋", "☕", "🥁", "🌿", "🚲", "⚽", "📰"], c = em.concat(em).sort(function () { return Math.random() - .5; }), open = [], found = 0, moves = 0;
    box.innerHTML = '<p class="mp-s">Intambwe: <b id="mm">0</b></p><div class="mp-g4">' + c.map(function (e, i) { return '<button data-i="' + i + '">?</button>'; }).join("") + "</div>";
    $(".mp-g4", box).onclick = function (ev) {
      var t = ev.target.closest("button"); if (!t || open.length > 1 || t.dataset.on) return;
      t.textContent = c[t.dataset.i]; t.dataset.on = 1; open.push(t);
      if (open.length === 2) {
        moves++; $("#mm", box).textContent = moves; var a = open[0], b = open[1];
        if (a.textContent === b.textContent) { found++; open = []; a.classList.add("ok"); b.classList.add("ok"); if (found === 8) { xp(15); quest("game", 10); toast("🎉 Watsinze! +15 XP"); } }
        else setTimeout(function () { [a, b].forEach(function (x) { x.textContent = "?"; delete x.dataset.on; }); open = []; }, 700);
      }
    };
  }
  function math(box) {
    var sc = 0, t = 45, a, b, o, ans, iv;
    box.innerHTML = '<p class="mp-s">Igihe: <b id="mt">45</b>s · Amanota: <b id="ms">0</b></p><h2 id="mq"></h2><input id="mi" class="mp-i" type="number" inputmode="numeric" placeholder="Igisubizo"><button class="mp-b" id="mg">Emeza</button>';
    function q() { o = "+−×"[Math.random() * 3 | 0]; var m = o === "×" ? 11 : 49; a = 1 + Math.random() * m | 0; b = 1 + Math.random() * m | 0; if (o === "−" && b > a) { var x = a; a = b; b = x; } ans = o === "+" ? a + b : o === "−" ? a - b : a * b; $("#mq", box).textContent = a + " " + o + " " + b + " = ?"; $("#mi", box).value = ""; $("#mi", box).focus(); }
    function go() { if (t <= 0) return; if (+$("#mi", box).value === ans && $("#mi", box).value !== "") { sc++; $("#ms", box).textContent = sc; } q(); }
    $("#mg", box).onclick = go; $("#mi", box).onkeydown = function (e) { if (e.key === "Enter") go(); };
    iv = setInterval(function () {
      if (!document.body.contains(box)) { clearInterval(iv); return; }
      $("#mt", box).textContent = --t;
      if (t <= 0) { clearInterval(iv); xp(sc); quest("game", 10); box.innerHTML = '<h3>⏱️ Warangije: ' + sc + '</h3><p class="mp-s">+' + sc + " XP</p>"; }
    }, 1000);
    q();
  }
  function g2048(box) {
    var b = Array(16).fill(0), score = 0, won = false;
    function add() { var e = []; for (var i = 0; i < 16; i++) if (!b[i]) e.push(i); if (e.length) b[e[Math.random() * e.length | 0]] = Math.random() < .9 ? 2 : 4; }
    function line(a) { var r = a.filter(Boolean), o = []; for (var i = 0; i < r.length; i++) { if (r[i] === r[i + 1]) { o.push(r[i] * 2); score += r[i] * 2; i++; } else o.push(r[i]); } while (o.length < 4) o.push(0); return o; }
    function mv(d) {
      var old = b.join(","), i, j;
      for (i = 0; i < 4; i++) { var idx = []; for (j = 0; j < 4; j++) idx.push(d < 2 ? i * 4 + j : j * 4 + i); if (d % 2) idx.reverse(); var l = line(idx.map(function (k) { return b[k]; })); idx.forEach(function (k, n) { b[k] = l[n]; }); }
      if (b.join(",") !== old) { add(); draw(); }
    }
    function dead() { for (var i = 0; i < 16; i++) { if (!b[i]) return false; if (i % 4 < 3 && b[i] === b[i + 1]) return false; if (i < 12 && b[i] === b[i + 4]) return false; } return true; }
    function draw() {
      $(".mp-g4", box).innerHTML = b.map(function (v) { return '<div class="t" style="background:' + (v ? "hsl(" + (355 - Math.log2(v) * 12) + ",70%," + Math.max(35, 75 - Math.log2(v) * 3) + '%)' : "#8883") + '">' + (v || "") + "</div>"; }).join("");
      $("#ms", box).textContent = score;
      if (!won && Math.max.apply(0, b) >= 128) { won = true; xp(10); quest("game", 10); toast("🔥 128! +10 XP"); }
      if (dead()) toast("Umukino warangiye: " + score);
    }
    box.innerHTML = '<p class="mp-s">Amanota: <b id="ms">0</b> · Kurura ukoresheje urutoki</p><div class="mp-g4 g2048"></div>';
    var el = $(".mp-g4", box), sx, sy; add(); add(); draw();
    el.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
    el.addEventListener("touchend", function (e) { var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; mv(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 1) : (dy < 0 ? 2 : 3)); });
  }

  /* ---------- ibikoresho ---------- */
  var WX = function (c) { return c === 0 ? "☀️" : c < 4 ? "⛅" : c < 50 ? "🌫️" : c < 70 ? "🌧️" : c < 90 ? "🌦️" : "⛈️"; };
  async function weather(box) {
    function show(w, old) { box.innerHTML = "<h3>" + WX(w.c) + " Kigali: " + Math.round(w.n) + "°C</h3><p class=\"mp-s\">Uyu munsi " + Math.round(w.lo) + "–" + Math.round(w.hi) + "°C · imvura " + w.p + "%" + (old ? " · (bibitswe, nta internet)" : "") + "</p>"; }
    try {
      var r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=-1.9441&longitude=30.0619&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Africa%2FKigali");
      var j = await r.json(); S.w = { n: j.current.temperature_2m, c: j.current.weather_code, lo: j.daily.temperature_2m_min[0], hi: j.daily.temperature_2m_max[0], p: j.daily.precipitation_probability_max[0] }; put(); show(S.w);
    } catch (e) { if (S.w) show(S.w, 1); else box.innerHTML = '<p class="mp-s">Ikirere ntikiboneka nta internet.</p>'; }
  }
  async function fx(box) {
    var C2 = ["RWF", "USD", "EUR", "KES", "UGX", "TZS"];
    box.innerHTML = '<input id="fa" class="mp-i" type="number" inputmode="decimal" value="1000"><div class="mp-row"><select id="ff" class="mp-i"></select><select id="ft" class="mp-i"></select></div><h3 id="fo">…</h3><p class="mp-s" id="fn"></p>';
    C2.forEach(function (c, i) { $("#ff", box).add(new Option(c, c, 0, i === 0)); $("#ft", box).add(new Option(c, c, 0, i === 1)); });
    try { var r = await fetch("https://open.er-api.com/v6/latest/USD"), j = await r.json(); if (j.rates) { S.fx = { t: Date.now(), r: j.rates }; put(); } } catch (e) {}
    function calc() {
      if (!S.fx) { $("#fo", box).textContent = "—"; $("#fn", box).textContent = "Nta rate irabikwa. Fungura ufite internet."; return; }
      var v = +$("#fa", box).value || 0, f = S.fx.r[$("#ff", box).value], t = S.fx.r[$("#ft", box).value];
      $("#fo", box).textContent = (v / f * t).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + $("#ft", box).value;
      $("#fn", box).textContent = "Rate yo ku " + new Date(S.fx.t).toLocaleDateString();
    }
    box.oninput = calc; box.onchange = calc; calc();
  }
  var ft = null;
  function focus(box) {
    box.innerHTML = '<h2 id="fc">25:00</h2><button class="mp-b" id="fs">▶ Tangira (iminota 25)</button><p class="mp-s">Kwiga/gukora utuje. Urangiza ubona +10 XP.</p>';
    var left = 1500; function fmt() { return String(left / 60 | 0).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0"); }
    $("#fs", box).onclick = function () {
      if (ft) { clearInterval(ft); ft = null; left = 1500; $("#fc", box).textContent = fmt(); this.textContent = "▶ Tangira (iminota 25)"; return; }
      this.textContent = "⏹ Hagarika";
      ft = setInterval(function () { left--; var e = $("#fc"); if (e) e.textContent = fmt(); if (left <= 0) { clearInterval(ft); ft = null; xp(10); toast("✅ Warangije! +10 XP"); try { navigator.vibrate(300); } catch (e) {} } }, 1000);
    };
  }
  function notes(box) { box.innerHTML = '<textarea class="mp-i" rows="6" placeholder="Andika hano… (bibikwa muri telefoni yawe)"></textarea>'; var t = $("textarea", box); t.value = S.notes; t.oninput = function () { S.notes = t.value; put(); }; }

  /* ---------- UI ---------- */
  var css = "#mpTabs,#mpHub{--bg:#fff;--fg:#1a1a1f;--cd:#f4f4f6;--mu:#777;font-family:system-ui,Segoe UI,Roboto,sans-serif}@media(prefers-color-scheme:dark){#mpTabs,#mpHub{--bg:#15151a;--fg:#eee;--cd:#202027;--mu:#aaa}}" +
    "body{padding-bottom:calc(64px + env(safe-area-inset-bottom,0px))!important}#mifasaInstallBtn{bottom:calc(72px + env(safe-area-inset-bottom,0px))!important}#mfBtn{bottom:136px!important}#mfWin{bottom:206px!important}" +
    "#mpTabs{position:fixed;left:0;right:0;bottom:0;z-index:10001;display:flex;background:var(--bg);color:var(--fg);border-top:1px solid #8884;padding-bottom:env(safe-area-inset-bottom,0px)}" +
    "#mpTabs a,#mpTabs button{flex:1;border:0;background:none;color:inherit;text-decoration:none;text-align:center;padding:8px 2px 6px;font:600 .68rem system-ui;cursor:pointer}#mpTabs span{display:block;font-size:1.35rem;line-height:1.2}#mpTabs .on{color:#e63946}" +
    "#mpHub{position:fixed;inset:0 0 calc(56px + env(safe-area-inset-bottom,0px)) 0;z-index:10000;background:var(--bg);color:var(--fg);overflow:auto;display:none;padding-top:env(safe-area-inset-top,0px)}#mpHub.on{display:block}" +
    ".mp-top{position:sticky;top:0;background:#e63946;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-weight:700}.mp-top button{border:0;background:none;color:#fff;font-size:1.2rem}" +
    "#mpB{max-width:640px;margin:0 auto;padding:14px 16px 24px}#mpB h2,#mpB h3{margin:.4em 0}.mp-c{background:var(--cd);border-radius:14px;padding:14px;margin:12px 0}.mp-s{color:var(--mu);margin:.3em 0;font-size:.9rem}" +
    ".mp-b{display:block;width:100%;box-sizing:border-box;border:0;border-radius:12px;background:#e63946;color:#fff;padding:13px;margin:8px 0;font:700 1rem system-ui;cursor:pointer;text-align:left;text-decoration:none}.mp-o{background:var(--cd);color:var(--fg)}.mp-o.ok,.mp-g4 .ok{background:#2a9d5b!important;color:#fff}.mp-o.bad{background:#e63946;color:#fff}" +
    ".mp-i{width:100%;box-sizing:border-box;border:1px solid #8886;border-radius:10px;padding:11px;margin:6px 0;background:var(--bg);color:var(--fg);font:1rem system-ui}.mp-row{display:flex;gap:8px}" +
    ".mp-g4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-width:360px;margin:10px auto}.mp-g4 button,.mp-g4 .t{aspect-ratio:1;border:0;border-radius:10px;background:#e63946;color:#fff;font:700 1.6rem system-ui;display:flex;align-items:center;justify-content:center}.g2048{touch-action:none}" +
    ".mp-bar{height:8px;border-radius:6px;background:#8883;overflow:hidden}.mp-bar i{display:block;height:100%;background:#e63946}.mp-toast{position:fixed;left:50%;transform:translateX(-50%);top:calc(16px + env(safe-area-inset-top,0px));z-index:10010;background:#222;color:#fff;padding:10px 16px;border-radius:12px;font:600 .9rem system-ui}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var tabs = document.createElement("div"); tabs.id = "mpTabs";
  tabs.innerHTML = '<a href="/"><span>🏠</span>Ahabanza</a><button data-t="games"><span>🎮</span>Gukina</button><button data-t="tools"><span>🧰</span>Ibikoresho</button><button data-t="me"><span>🏆</span>Njyewe</button>';
  var hub = document.createElement("div"); hub.id = "mpHub"; hub.innerHTML = '<div class="mp-top"><span id="mpT"></span><button data-t="">✕</button></div><div id="mpB"></div>';
  function mount() { document.body.appendChild(hub); document.body.appendChild(tabs); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  var cur = "";
  function card(title, sub, act) { return '<button class="mp-b" data-g="' + act + '">' + title + '<br><small style="font-weight:400;opacity:.85">' + sub + "</small></button>"; }
  function sub(title, fn, back) { $("#mpT").textContent = title; var b = $("#mpB"); b.innerHTML = '<button class="mp-b mp-o" data-t="' + back + '" style="width:auto;display:inline-block;padding:8px 14px">← Subira</button><div id="mpX"></div>'; fn($("#mpX")); }
  function view(t) {
    cur = t; hub.classList.toggle("on", !!t);
    [].forEach.call(tabs.querySelectorAll("button"), function (b) { b.classList.toggle("on", b.dataset.t === t); });
    if (!t) return; var b = $("#mpB");
    if (t === "games") {
      $("#mpT").textContent = "🎮 Gukina & Wiga";
      b.innerHTML = '<p class="mp-s">Kina, wunguke XP, ukomeze streak yawe 🔥</p>' + card("🧠 Ikibazo cy'umunsi", "Ibibazo 5 bishya buri munsi · +25 XP", "quiz") + card("🃏 Memory", "Shaka imibare ihuje", "memory") + card("🔢 2048", "Kurura urutoki", "g2048") + card("⚡ Imibare yihuse", "Amasegonda 45", "math");
    } else if (t === "tools") {
      $("#mpT").textContent = "🧰 Ibikoresho";
      b.innerHTML = '<div class="mp-c" id="wx">…</div>' + card("💱 Amafaranga (RWF ⇄ USD…)", "Rate ya none", "fx") + card("⏳ Kwiga/Gukora utuje", "Iminota 25 · +10 XP", "focus") + card("📝 Ikayi", "Wandike hano, bikabikwa", "notes") + '<a class="mp-b" href="/offline.html">📚 Inkuru zibitswe offline</a>';
      weather($("#wx"));
    } else if (t === "me") {
      var L = lvl(), lo = 40 * (L - 1) * (L - 1), hi = 40 * L * L, m = Math.round((S.t[today] || 0) / 60), rec = [];
      try { rec = JSON.parse(localStorage.getItem("mifasaRecent") || "[]").slice(0, 6); } catch (e) {}
      var Qs = [["read", "📰 Soma inkuru 3 (" + Math.min(S.reads.length, 3) + "/3)"], ["quiz", "🧠 Kora ikibazo cy'umunsi"], ["game", "🎮 Kina umukino umwe"], ["time", "⏱️ Umara iminota 30 (" + Math.min(m, 30) + "/30)"]];
      $("#mpT").textContent = "🏆 Njyewe";
      b.innerHTML = '<div class="mp-c"><h2>🔥 ' + S.streak + " iminsi ikurikiranye</h2><p class=\"mp-s\">Ikirenga: " + S.best + " · Urwego " + L + " · " + S.xp + ' XP</p><div class="mp-bar"><i style="width:' + Math.min(100, (S.xp - lo) / (hi - lo) * 100) + '%"></i></div><p class="mp-s">Uyu munsi umaze iminota ' + m + ' muri app.</p></div>' +
        '<div class="mp-c"><h3>🎯 Intego z\'uyu munsi</h3>' + Qs.map(function (x) { return "<p>" + (S.done[x[0]] ? "✅" : "⬜") + " " + x[1] + "</p>"; }).join("") + "</div>" +
        (rec.length ? '<div class="mp-c"><h3>🕘 Komeza gusoma</h3>' + rec.map(function (x) { return '<p><a style="color:inherit" href="' + esc(x.url || "") + '">' + esc(x.title || x.id) + "</a></p>"; }).join("") + "</div>" : "") +
        '<button class="mp-b" data-g="rem">⏰ ' + (S.rem ? "Kuzimya kunyibutsa" : "Nyibutsa buri munsi (7:30 & 19:00)") + '</button><button class="mp-b mp-o" data-g="bell">🔔 Menyeshwa inkuru nshya</button><button class="mp-b mp-o" data-g="share">↗ Sangiza MIFASARW inshuti</button><a class="mp-b mp-o" href="/install.html">📲 Shyira app</a>';
    }
  }
  var G = { quiz: ["🧠 Ikibazo cy'umunsi", quiz], memory: ["🃏 Memory", memory], g2048: ["🔢 2048", g2048], math: ["⚡ Imibare yihuse", math], fx: ["💱 Amafaranga", fx], focus: ["⏳ Kwiga", focus], notes: ["📝 Ikayi", notes] };
  document.addEventListener("click", async function (e) {
    var t = e.target.closest("[data-t]"), g = e.target.closest("[data-g]");
    if (t && (tabs.contains(t) || hub.contains(t))) { view(t.dataset.t === cur && tabs.contains(t) ? "" : t.dataset.t); return; }
    if (!g || !hub.contains(g)) return; var a = g.dataset.g;
    if (G[a]) sub(G[a][0], G[a][1], /^(quiz|memory|g2048|math)$/.test(a) ? "games" : "tools");
    else if (a === "rem") { S.rem = !S.rem; if (native) { var ok = await remind(S.rem); if (!ok) { S.rem = false; toast("Ntibyemewe. Emera notifications muri settings."); } } else if (S.rem) toast("Kunyibutsa bikora muri APK. Hano koresha 🔔."); put(); view("me"); }
    else if (a === "bell") { var nb = document.getElementById("navBell"); view(""); if (nb) nb.click(); }
    else if (a === "share") { var d = { title: "MIFASARW", text: "Amakuru, inkuru n'imikino mu Kinyarwanda", url: location.origin }; try { if (P.Share) P.Share.share(d); else if (navigator.share) navigator.share(d); else { await navigator.clipboard.writeText(d.url); toast("✅ Link yandukuwe"); } } catch (er) {} }
  });
})();
