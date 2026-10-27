/* RCI Serve team switcher — the same file in all four team apps (keep the copies identical).
   When someone on two or more teams opens this app inside RCI Serve (or in a normal browser tab),
   a Switch Team button appears beside the logo. It opens a sheet with All Teams Home and each of their teams.
   RCI Serve (the hub at the top of the site) saves who is signed in and which teams they're on in
   localStorage "rci-serve:state"; this file only reads it, and keeps this team's request count up to date in it.
   The app calls RCIServe.extra(pendingCount(), S.me) from updateBadge(); inside RCI Serve the app-icon number
   also includes the other teams' requests. */
(function(){
  "use strict";
  var TEAMS = [
    { key: "productions", name: "Productions", path: "/rci-productions/", tl: "#0B3A6E", td: "#6FA4E0", icon: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8z"/>' },
    { key: "security", name: "Security", path: "/rci-security/", tl: "#7A1F1F", td: "#EB9393", icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
    { key: "ushers", name: "Ushers & Altar Workers", path: "/rci-ushers/", tl: "#1E5E43", td: "#6CC69C", icon: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M10 21v-6h4v6"/>' },
    { key: "worship", name: "Worship & Arts", path: "/rci-worship-arts/", tl: "#4A2F7A", td: "#B9A1EA", icon: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' }
  ];
  var here = TEAMS.filter(function(t){ return location.pathname.indexOf(t.path) === 0; })[0];
  if (!here) { window.RCIServe = { extra: function(){ return 0; } }; return; }
  var KEY = "rci-serve:state";
  var inHub = false; try { inHub = sessionStorage.getItem("rci-serve:hub") === "1"; } catch(e){}
  var standalone = function(){ return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; };
  var me = null;
  var svg = function(inner, w){ return '<svg viewBox="0 0 24 24" width="' + (w || 18) + '" height="' + (w || 18) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; };
  var esc = function(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };

  function read(){ try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch(e){ return null; } }
  function mine(){
    var s = read();
    if (!s || !me || !me.emails || !s.emails) return null;
    var hit = s.emails.some(function(e){ return me.emails.indexOf(e) >= 0; });
    return hit && Array.isArray(s.teams) ? s : null;
  }
  function shown(){
    var s = mine();
    return !!s && s.teams.length >= 2 && s.teams.some(function(t){ return t.key === here.key; }) && (inHub || !standalone());
  }
  function othersPending(s){
    return s.teams.filter(function(t){ return t.key !== here.key; }).reduce(function(a, t){ return a + (Number(t.count) || 0); }, 0);
  }

  /* ---- styles (uses each app's own colour variables) ---- */
  var css = document.createElement("style");
  css.textContent =
    ".rs-btn{flex:none;display:inline-flex;align-items:center;gap:4px;height:40px;padding:0 10px 0 8px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:inherit;font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;position:relative;cursor:pointer}" +
    ".rs-btn .rs-dot{position:absolute;top:-2px;right:-2px;width:11px;height:11px;border-radius:50%;background:var(--bad,#B3261E);border:2px solid var(--surface)}" +
    ".rs-back{position:fixed;inset:0;z-index:90;background:rgba(3,17,31,.55)}" +
    ".rs-sheet{position:fixed;left:0;right:0;bottom:0;z-index:91;max-width:560px;margin:0 auto;background:var(--surface);color:var(--fg);border-radius:20px 20px 0 0;padding:10px 16px calc(24px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:6px;box-shadow:0 -8px 30px rgba(3,17,31,.3);max-height:85vh;overflow:auto}" +
    ".rs-grab{width:40px;height:5px;border-radius:3px;background:var(--line);align-self:center;margin-bottom:6px}" +
    ".rs-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}" +
    ".rs-head h2{margin:0;font-family:var(--display,inherit);font-weight:700;font-size:24px;letter-spacing:.04em;text-transform:uppercase}" +
    ".rs-x{width:40px;height:40px;border-radius:50%;border:0;background:var(--surface-2);color:var(--fg);display:grid;place-items:center;cursor:pointer}" +
    ".rs-row{display:flex;align-items:center;gap:12px;min-height:58px;padding:0 12px;border-radius:12px;border:1px solid var(--line);text-decoration:none;color:var(--fg)}" +
    ".rs-row.rs-home{background:var(--accent-soft);border-color:transparent}" +
    ".rs-row.rs-here{border:2px solid var(--t)}" +
    ".rs-ic{width:36px;height:36px;border-radius:10px;background:var(--tl);color:#FFFFFF;display:grid;place-items:center;flex:none}" +
    ".rs-home .rs-ic{background:#0B1D33;color:#D2B07C}" +
    ".rs-info{flex:1;min-width:0}.rs-info b{display:block;font-weight:700}.rs-info small{display:block;font-size:12px;color:var(--muted)}" +
    ".rs-count{min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:var(--bad,#B3261E);color:#FFFFFF;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}" +
    ".rs-label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:10px 0 2px 4px}" +
    ".rs-t{--t:var(--tl)}" +
    "@media (prefers-color-scheme: dark){:root:not([data-theme=\"light\"]) .rs-t{--t:var(--td)}}:root[data-theme=\"dark\"] .rs-t{--t:var(--td)}";
  document.head.appendChild(css);

  /* ---- the button beside the logo (re-added after every screen change) ---- */
  function place(){
    var wrap = document.querySelector("header.top .wrap"); if (!wrap) return;
    var btn = wrap.querySelector(".rs-btn");
    if (!shown()){ if (btn) btn.remove(); return; }
    var s = mine(), dot = othersPending(s) > 0;
    var html = svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', 16) + "Teams" + svg('<path d="m6 9 6 6 6-6"/>', 14) + (dot ? '<span class="rs-dot" aria-hidden="true"></span>' : "");
    if (!btn){
      btn = document.createElement("button");
      btn.type = "button"; btn.className = "rs-btn";
      btn.addEventListener("click", open);
      var brand = wrap.querySelector(".brand");
      if (brand && brand.nextSibling) wrap.insertBefore(btn, brand.nextSibling); else wrap.appendChild(btn);
    }
    var sig = dot ? "1" : "0";
    if (btn.getAttribute("data-sig") !== sig){ btn.setAttribute("data-sig", sig); btn.innerHTML = html; }
    btn.setAttribute("aria-label", "Switch team" + (dot ? ", requests waiting on your other teams" : ""));
  }
  new MutationObserver(function(){ place(); }).observe(document.body, { childList: true, subtree: true });

  /* ---- the sheet ---- */
  var back = null, sheet = null, opener = null;
  function close(){
    if (back) back.remove(); if (sheet) sheet.remove(); back = sheet = null;
    if (opener && opener.isConnected) opener.focus();
  }
  function open(e){
    var s = mine(); if (!s) return;
    opener = e && e.currentTarget;
    close();
    var total = s.teams.reduce(function(a, t){ return a + (t.key === here.key ? 0 : Number(t.count) || 0); }, 0);
    var rows = s.teams.map(function(st){
      var t = TEAMS.filter(function(x){ return x.key === st.key; })[0]; if (!t) return "";
      var isHere = t.key === here.key, n = Number(st.count) || 0;
      var sub = isHere ? "You're here" + (st.admin ? " · Admin" : "") : n ? n + (n === 1 ? " needs a reply" : " need a reply") : (st.admin ? "Admin · Nothing waiting" : "Nothing waiting");
      return '<a class="rs-row rs-t' + (isHere ? " rs-here" : "") + '" style="--tl:' + t.tl + ";--td:" + t.td + '" href="' + t.path + '"' + (isHere ? ' aria-current="page"' : "") + '>' +
        '<span class="rs-ic">' + svg(t.icon) + '</span><span class="rs-info"><b>' + esc(t.name) + '</b><small>' + esc(sub) + '</small></span>' +
        (n && !isHere ? '<span class="rs-count">' + n + '</span>' : "") +
        (isHere ? '<span style="color:var(--t)">' + svg('<path d="M20 6 9 17l-5-5"/>', 20) + '</span>' : "") + '</a>';
    }).join("");
    back = document.createElement("div"); back.className = "rs-back"; back.addEventListener("click", close);
    sheet = document.createElement("section"); sheet.className = "rs-sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Switch team");
    sheet.innerHTML = '<div class="rs-grab" aria-hidden="true"></div><div class="rs-head"><h2>Switch Team</h2><button type="button" class="rs-x" aria-label="Close">' + svg('<path d="M18 6 6 18M6 6l12 12"/>') + '</button></div>' +
      '<a class="rs-row rs-home" href="/"><span class="rs-ic">' + svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>') + '</span>' +
      '<span class="rs-info"><b>All Teams Home</b><small>' + (total ? total + (total === 1 ? " request" : " requests") + " on your other teams" : "RCI Serve") + '</small></span><span style="color:var(--accent)">' + svg('<path d="m9 6 6 6-6 6"/>') + '</span></a>' +
      '<div class="rs-label">Your teams</div>' + rows;
    sheet.querySelector(".rs-x").addEventListener("click", close);
    sheet.addEventListener("keydown", function(ev){ if (ev.key === "Escape") close(); });
    document.body.appendChild(back); document.body.appendChild(sheet);
    sheet.querySelector(".rs-x").focus();
  }

  window.RCIServe = {
    /* n = this app's own pending-request count. Returns the number to ADD to this app's icon number:
       the other teams' requests when open inside RCI Serve, otherwise 0. */
    extra: function(n, who){
      if (who && who.emails) me = who;
      var s = mine();
      if (s){
        var row = s.teams.filter(function(t){ return t.key === here.key; })[0];
        if (row && row.count !== n){ row.count = n; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch(e){} }
      }
      place();
      return s && inHub ? othersPending(s) : 0;
    }
  };
})();
