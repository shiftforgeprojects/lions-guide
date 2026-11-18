(function () {
  "use strict";
  var KB = window.LION_KB, S = window.LionSearch;
  var idx = S.build({ entries: KB.entries });
  var byId = {}; KB.entries.forEach(function (e) { byId[e.id] = e; });
  var chat = document.getElementById("chat");
  var params = new URLSearchParams(location.search);
  var ADMIN = params.get("admin") === "1";

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var state = { mode: store.get("lg_mode", "new"), last: null, tour: -1, docIndex: null, docCache: {}, deferredInstall: null, version: null };

  /* ---------- tiny DOM helper (text only, never innerHTML, so content can't inject markup) ---------- */
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function asQuestion(s) { s = cap(s.trim()); return /[?.!]$/.test(s) ? s : s + "?"; }
  function log(rec) {
    var l = store.get("lg_log", []); rec.t = new Date().toISOString(); l.push(rec);
    store.set("lg_log", l.slice(-300));
  }

  /* ---------- message plumbing ---------- */
  function addUser(text) {
    chat.appendChild(h("div", { class: "msg me" }, [h("span", { text: text })]));
  }
  function addBot(nodes) {
    var m = h("div", { class: "msg bot" }, nodes);
    chat.appendChild(m);
    requestAnimationFrame(function () { m.scrollIntoView({ block: "start" }); });
    return m;
  }
  function chips(list, cls) {
    return h("div", { class: "chips" }, list.map(function (c) {
      return h("button", { class: "chip " + (c.primary ? "primary" : "") + (cls || ""), type: "button", text: c.label, onclick: c.run });
    }));
  }
  function askChip(question, label) { return { label: label || asQuestion(question), run: function () { ask(question); } }; }

  /* ---------- cards ---------- */
  function badge(tier) {
    return h("span", { class: "badge " + (tier === "official" ? "official" : "affiliate"), text: tier === "official" ? "Official" : tier === "general" ? "General guide" : "Lions-affiliated" });
  }
  function sourcesRow(ids) {
    var seen = {}, els = [];
    ids.forEach(function (id) {
      var s = KB.sources[id]; if (!s || seen[s.url]) return; seen[s.url] = 1;
      els.push(h("a", { class: "src", href: s.url, target: "_blank", rel: "noopener" }, [badge(s.tier), h("span", { text: s.label })]));
    });
    var wrap = h("div", { class: "srcs", "aria-label": "Sources" }, els.slice(0, 2));
    if (els.length > 2) {
      var more = h("button", { class: "src", type: "button", text: "+" + (els.length - 2) + " more sources" });
      more.addEventListener("click", function () { more.remove(); els.slice(2).forEach(function (e) { wrap.appendChild(e); }); });
      wrap.appendChild(more);
    }
    return wrap;
  }
  function feedbackRow(entry) {
    var up = h("button", { class: "act", type: "button", text: "Helpful", "aria-pressed": "false" });
    var down = h("button", { class: "act", type: "button", text: "Not helpful", "aria-pressed": "false" });
    function vote(btn, other, v) {
      btn.setAttribute("aria-pressed", "true"); other.setAttribute("aria-pressed", "false");
      log({ type: "feedback", id: entry.id, v: v, q: state.lastQuery || "" });
    }
    up.addEventListener("click", function () { vote(up, down, 1); });
    down.addEventListener("click", function () { vote(down, up, -1); });
    var share = h("button", { class: "act", type: "button", text: "Share", onclick: function () {
      var url = location.origin + location.pathname + "#e=" + entry.id;
      var text = entry.title + ": " + entry.answer;
      if (navigator.share) navigator.share({ title: entry.title, text: text, url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text + "\n" + url).then(function () { share.textContent = "Copied"; });
    } });
    return h("div", { class: "actions" }, [up, down, share]);
  }
  function entryCard(e, extra) {
    var kids = [];
    if (extra) kids.push(extra);
    kids.push(h("span", { class: "cat", text: e.cat }));
    kids.push(h("h2", { text: e.title }));
    kids.push(h("p", { text: e.answer }));
    if (e.facts && e.facts.length) {
      kids.push(h("div", { class: "lead", text: "Key points" }));
      kids.push(h("ul", { class: "pts" }, e.facts.map(function (f) { return h("li", { text: f }); })));
    }
    kids.push(sourcesRow(e.src || []));
    kids.push(feedbackRow(e));
    return h("article", { class: "card" }, kids);
  }
  function relatedChips(e, skip) {
    var list = (e.related || []).filter(function (r) { return byId[r] && r !== skip; }).slice(0, 8).map(function (r) {
      return askChip(byId[r].questions[0], byId[r].title);
    });
    return list.length ? [h("div", { class: "lead", text: "Go deeper" }), chips(list)] : [];
  }
  function passageCards(ps, bare) {
    return h(bare ? "div" : "article", { class: bare ? "" : "card" }, (bare ? [] : [h("span", { class: "cat", text: "From the documents" })]).concat(ps.map(function (p) {
      var c = p.chunk, where = [c.h && c.h !== c.doc.t ? c.h : null, c.p ? "page " + c.p : null].filter(Boolean).join(" · ");
      return h("div", { class: "pass" }, [
        h("b", { text: c.doc.t }),
        where ? h("div", { class: "where", text: where }) : null,
        h("p", { text: p.excerpt }),
        h("div", { class: "srcs" }, [h("a", { class: "src", href: c.doc.u, target: "_blank", rel: "noopener" }, [badge(c.doc.tier), h("span", { text: "Open the full document" })])])
      ]);
    })));
  }
  function fallbackCard(q, near) {
    var sug = near.slice(0, 3).map(function (r) { return askChip(r.entry.questions[0]); });
    sug.push({ label: "Browse all topics", run: openTopics });
    return [h("article", { class: "card" }, [
      h("span", { class: "cat", text: "Not in my sources" }),
      h("h2", { text: "I couldn't find that" }),
      h("p", { text: "I would rather say so than guess. Try different words, or pick a topic. For anything official, the Lions team can help directly." }),
      h("div", { class: "srcs" }, [
        h("a", { class: "src", href: "https://www.lionsclubs.org/en/search-results", target: "_blank", rel: "noopener" }, [badge("official"), h("span", { text: "Search lionsclubs.org" })]),
        h("a", { class: "src", href: "mailto:membership@lionsclubs.org", text: "membership@lionsclubs.org" })
      ])
    ]), chips(sug)];
  }

  /* ---------- documents lane ---------- */
  function loadDoc(id) {
    if (state.docCache[id]) return state.docCache[id];
    state.docCache[id] = fetch("d/" + id + ".json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return state.docCache[id];
  }
  function docLane(q) {
    var di = state.docIndex;
    if (!di || !di.docs || !di.docs.length) return Promise.resolve([]);
    var ds = S.docSearch(di, q, 4);
    if (!ds.docs.length) return Promise.resolve([]);
    return Promise.all(ds.docs.map(function (d) {
      return loadDoc(d.doc.id).then(function (data) {
        if (!data) return [];
        return data.chunks.map(function (c) { return { doc: { id: d.doc.id, t: data.t, u: data.u, tier: data.tier }, h: c.h, p: c.p, t: c.t }; });
      });
    })).then(function (parts) { return S.passageSearch([].concat.apply([], parts), q, 3); });
  }

  /* ---------- conversation ---------- */
  function ask(q) {
    q = String(q || "").trim(); if (!q) return;
    addUser(q);
    state.lastQuery = q;
    var it = S.intent(q);
    if (it === "greet") return addBot([h("article", { class: "card" }, [h("p", { text: "Hello! I explain Lions in plain words: what it is, what Lions do, how to join, and the rules and meetings behind it. What would you like to know?" })]), chips(starters())]);
    if (it === "thanks") return addBot([h("article", { class: "card" }, [h("p", { text: "You're welcome. Ask me anything else about Lions." })]), chips(starters().slice(0, 3))]);
    if (it === "tour") return startTour();
    if (it === "more") {
      var L = state.last;
      if (!L) return addBot([h("article", { class: "card" }, [h("p", { text: "Ask me something first, then I can tell you more. Here are some ideas." })]), chips(starters())]);
      var card = entryCard(L); var dt = card.querySelector("details"); if (dt) dt.open = true;
      return addBot([card].concat(relatedChips(L)));
    }
    if (it === "topics") return openTopics();

    var res = S.search(idx, q, { mode: state.mode });
    var shortQ = S.tokens(q).length <= 3;
    // Only borrow the previous topic for a genuinely dependent follow-up: every word is one the guide knows.
    // A word it does not know (e.g. "quorum") must NOT be glued onto the last topic; it goes to the documents instead.
    if (!res.confident && !res.tentative && state.last && shortQ && res.unknown === 0) {
      var r2 = S.search(idx, q + " " + state.last.title, { mode: state.mode });
      if (r2.confident) res = r2;
    }
    // A reference back to the last answer ("who elects them", "and the fees?", "what about for students") is read in that topic's context.
    if (state.last && S.tokens(q).length <= 6) {
      var pron = /\b(them|it|they|those|these|that|this|there|their)\b/i.test(q), lead = /^\s*(and|also|what about|how about|then|so)\b/i.test(q);
      if (pron || (lead && !res.confident)) {
        var r3 = S.search(idx, q + " " + state.last.title, { mode: state.mode });
        if (r3.confident || r3.tentative) res = r3;
      }
    }
    var msg = addBot([]);
    var top = (res.confident || res.tentative) ? res.results[0].entry : null;
    if (top) {
      state.last = top;
      if (!res.confident) {
        log({ type: "tentative", q: q, id: top.id });
        msg.appendChild(h("div", { class: "lead", text: "This is the closest match I have. Tell me if it isn't what you meant." }));
      }
      msg.appendChild(entryCard(top));
      var also = res.results.slice(1, 3).filter(function (r) { return r.score > res.results[0].score * 0.6 && r.coverage >= 0.5; });
      if (also.length) {
        msg.appendChild(h("div", { class: "lead", text: "Related to your question" }));
        also.slice(0, 1).forEach(function (r) { msg.appendChild(entryCard(r.entry)); });
      }
    }
    docLane(q).then(function (ps) {
      if (ps.length) {
        if (top) {   // a written answer already exists: keep the exact passages one tap away so the phone screen stays short
          var det = h("details", { class: "card docs" }, [h("summary", { text: "What the documents say (" + ps.length + ")" })]);
          det.appendChild(passageCards(ps, true));
          msg.appendChild(det);
        } else {
          msg.appendChild(h("div", { class: "lead", text: "Here is what the documents say:" }));
          msg.appendChild(passageCards(ps));
        }
      }
      if (top) relatedChips(top).forEach(function (n) { msg.appendChild(n); });
      if (!top && !ps.length) {
        log({ type: "unanswered", q: q });
        fallbackCard(q, res.results).forEach(function (n) { msg.appendChild(n); });
      }
      if (!top && ps.length) msg.appendChild(chips(starters().slice(0, 3)));
      quick(q, msg, res, top);
      generate(q, msg, res, top, ps);
      libLane(q, msg, !!top).then(function (n) {
        if (!top && !ps.length && n) { var fb = msg.querySelector(".card h2"); if (fb && /couldn't find/.test(fb.textContent)) fb.closest("article").remove(); }
      });
    });
  }

  /* ---------- free, always-on conversational reply: picks the sentences that answer the question ---------- */
  function sentences(t) { return String(t).split(/(?<=[.!?])\s+(?=[A-Z0-9(])/).filter(function (x) { return x.length > 12; }); }
  function tuck(msg, say) {
    var cards = [].slice.call(msg.children).filter(function (n) { return n !== say && n.tagName === "ARTICLE" && !n.classList.contains("gen"); });
    if (!cards.length) return;
    var det = h("details", { class: "card docs" }, [h("summary", { text: "Full written answer and sources" })]);
    cards[0].parentNode.insertBefore(det, cards[0]);
    cards.forEach(function (c) { det.appendChild(c); });
  }
  function quick(q, msg, res, top) {
    if (!top || !res.confident) return;
    var qt = {}; S.tokens(q).forEach(function (t) { qt[t] = 1; });
    var pool = [], seen = {}, df = {};
    res.results.slice(0, 1).forEach(function (r, ri) {
      sentences(r.entry.answer).concat(r.entry.facts || []).forEach(function (sn, i) {
        if (seen[sn] || /^(Based on the standard|From the International|Ask 'the)/.test(sn)) return; seen[sn] = 1;
        var set = {}; S.tokens(sn).forEach(function (t) { set[t] = 1; });
        Object.keys(set).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
        pool.push({ s: sn, set: set, i: pool.length, ri: ri, k: i });
      });
    });
    pool.forEach(function (x) {
      var w = 0, hit = 0;
      Object.keys(qt).forEach(function (t) { if (x.set[t]) { hit++; var idf = Math.log(1 + pool.length / df[t]); w += idf * idf; } });
      x.hit = hit; x.w = w * 10 - x.k * 0.01;
    });
    if (!pool.length) return;
    var first = pool[0], best = pool.slice().sort(function (a, b) { return b.w - a.w; }).slice(0, 2);
    best = best.filter(function (x) { return x.hit > 0 && x.w >= best[0].w * 0.6; });
    if (!best.length) best = [first];
    best.sort(function (a, b) { return a.i - b.i; });
    var say = h("article", { class: "card gen quick" }, [h("p", { text: best.map(function (x) { return x.s; }).join(" ") })]);
    msg.insertBefore(say, msg.firstChild);
    tuck(msg, say);
  }

  /* ---------- library: every form, guide, presentation and video on the Resource Center ---------- */
  var LIBP = null, LIBU = "https://www.lionsclubs.org/v2/resource/download/";
  function loadLib() {
    if (!LIBP) LIBP = fetch("library.json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    return LIBP;
  }
  var TYPE_WORD = { video: "video", mp4: "video", pdf: "PDF", pptx: "Presentation", ppt: "Presentation", docx: "Word", doc: "Word", xlsx: "Excel", jpg: "Image", page: "Web page", ai: "Design file" };
  function libSearch(lib, q, n) {
    var qt = S.tokens(q), browse = /\b(documents?|videos?|forms?|library|downloads?|resources?|brochures?|flyers?|presentations?|applications?|guides?|handbooks?)\b/i.test(q);
    var want = /\bvideos?\b/i.test(q) ? "video" : null;
    var rare = qt.filter(function (t) { return !/^(document|video|form|librari|download|resourc|brochur|flyer|present|applic|guid|handbook|show|find|need|want|get|lion|club)/.test(t); });
    var out = [];
    lib.forEach(function (x) {
      if (want && x.y !== "mp4") return;
      var tt = {}, dd = {}; S.tokens(x.t).forEach(function (t) { tt[t] = 1; }); S.tokens(x.s + " " + x.c).forEach(function (t) { dd[t] = 1; });
      var sc = 0, hit = 0; qt.forEach(function (t) { if (tt[t]) { sc += 3; hit++; } else if (dd[t]) { sc += 1; hit++; } });
      var need = rare.length ? Math.min(rare.length, 2) : 0;
      var rh = rare.filter(function (t) { return tt[t] || dd[t]; }).length;
      if (sc > 0 && rh >= need && (rare.length || browse)) out.push({ x: x, sc: sc + (browse ? 0.01 : 0) });
    });
    out.sort(function (a, b) { return b.sc - a.sc || (b.x.d > a.x.d ? 1 : -1); });
    return out.slice(0, n);
  }
  function libCard(list, title) {
    return h("article", { class: "card lib" }, [h("span", { class: "cat", text: title || "Documents and videos" })].concat(list.map(function (r) {
      var x = r.x || r;
      return h("a", { class: "libitem", href: x.u || LIBU + x.i, target: "_blank", rel: "noopener" }, [
        h("b", { text: x.t }),
        h("div", { class: "where", text: [TYPE_WORD[x.y] || x.y, x.p ? x.p + (x.p === "1" ? " page" : " pages") : null, x.c, x.d].filter(Boolean).join(" · ") }),
        x.s ? h("p", { text: x.s }) : null
      ]);
    })));
  }
  function libLane(q, msg, shown) {
    return loadLib().then(function (lib) {
      var hits = libSearch(lib, q, shown ? 3 : 5);
      if (hits.length) { var c = libCard(hits); var rel = msg.querySelector(".chips"); if (rel) msg.insertBefore(c, rel); else msg.appendChild(c); }
      return hits.length;
    });
  }
  function openLibrary() {
    loadLib().then(function (lib) {
      var body = h("div", null, []), groups = {}, order = [];
      lib.forEach(function (x) { var k = x.y === "mp4" ? "Videos" : x.y === "page" ? "Resource Center pages" : x.c.replace(/^./, function (m) { return m.toUpperCase(); }); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(x); });
      order.sort();
      order.forEach(function (k) {
        body.appendChild(h("div", { class: "grp", text: k + " (" + groups[k].length + ")" }));
        groups[k].forEach(function (x) { body.appendChild(h("a", { class: "row", href: x.u || LIBU + x.i, target: "_blank", rel: "noopener", text: x.t })); });
      });
      openSheet("Library: " + lib.length + " documents, videos and pages", body);
    });
  }

  /* ---------- conversational layer (optional): writes the reply from the passages the search found ---------- */
  state.hist = [];
  function generate(q, msg, res, top, ps) {
    var url = window.LION_CHAT && window.LION_CHAT.url;
    if (!url || !navigator.onLine) return;
    var ctx = [];
    res.results.slice(0, 3).forEach(function (r) {
      if (r.coverage >= 0.4 || r === res.results[0]) ctx.push({ title: r.entry.title, text: r.entry.answer + " " + (r.entry.facts || []).join(" ") });
    });
    ps.slice(0, 3).forEach(function (p) { ctx.push({ title: p.chunk.doc.t, text: p.excerpt }); });
    if (!top && !ps.length) return;
    var say = h("article", { class: "card gen" }, [h("p", { class: "typing", text: "Thinking…" })]);
    var qk = msg.querySelector(".quick"); if (qk) qk.style.display = "none";
    msg.insertBefore(say, msg.firstChild);
    var t = setTimeout(function () { ctrl.abort(); }, 20000), ctrl = new AbortController();
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ q: q, history: state.hist, context: ctx }) })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        clearTimeout(t);
        if (!d.answer) throw 0;
        say.textContent = "";
        d.answer.split(/\n{2,}/).forEach(function (para) {
          var lines = para.split("\n").filter(Boolean);
          if (lines.length > 1 && lines.every(function (l) { return /^\s*([-*•]|\d+[.)])\s+/.test(l); })) {
            say.appendChild(h("ul", { class: "pts" }, lines.map(function (l) { return h("li", { text: l.replace(/^\s*([-*•]|\d+[.)])\s+/, "") }); })));
          } else say.appendChild(h("p", { text: para.replace(/\*\*/g, "") }));
        });
        state.hist.push({ role: "user", content: q }, { role: "assistant", content: d.answer });
        state.hist = state.hist.slice(-8);
        // tuck the written cards behind one tap so the reply reads like a conversation
        if (qk) qk.remove();
        say.appendChild(feedbackRow(top || { id: "gen", title: "", answer: d.answer }));
      })
      .catch(function () { clearTimeout(t); say.remove(); if (qk) qk.style.display = ""; });
  }

  function starters() {
    var n = [
      "What is Lions Clubs International?", "What do Lions actually do?", "How do I join a Lions club?", "How much does it cost to join?", "What is the Lions Code of Ethics?"
    ], m = [
      "How do I start a Leo club?", "What is the Global Service Team?", "How do I grow my club's membership?", "How is Lions organised?", "What do LCIF grants pay for?"
    ];
    return (state.mode === "member" ? m : n).map(function (q) { return askChip(q.replace(/\?$/, "").toLowerCase(), q); });
  }

  function welcome() {
    chat.textContent = "";
    state.last = null;
    addBot([h("article", { class: "card" }, [
      h("span", { class: "cat", text: "Welcome" }),
      h("h2", { text: "Understand Lionism, in plain words" }),
      h("p", { text: "Ask about Lions Clubs International: what it is, what Lions do, how to join, and the rules and meetings behind it. Every answer shows where it comes from." }),
      h("p", { class: "small", text: "Always confirm important decisions at lionsclubs.org." }),
      h("p", { class: "small", id: "ver", text: "Version " + (KB.meta.version || "?") + " · " + (KB.meta.build || KB.meta.built || "") }),
      (function () {
        var c = KB.meta.checked; if (!c) return null;
        var days = Math.floor((Date.now() - new Date(c + "T00:00:00Z").getTime()) / 864e5), old = days > 31;
        return h("p", { class: "small", id: "fresh", text: "Information last checked: " + c + (old ? ". This is over a month old, so please confirm important details on lionsclubs.org." : ".") });
      })(),
      chips([{ label: "Take the 2-minute tour", primary: true, run: startTour }].concat(starters()))
    ])]);
    chat.scrollTop = 0;
  }

  /* ---------- guided tour ---------- */
  function startTour() { state.tour = 0; showTour(0); }
  function showTour(i) {
    var ids = KB.tour, e = byId[ids[i]];
    if (!e) return;
    state.last = e;
    var dots = h("div", { class: "dots" }, ids.map(function (_, k) { return h("i", { class: k <= i ? "on" : "" }); }));
    var head = h("div", null, [h("div", { class: "step", text: "Tour: step " + (i + 1) + " of " + ids.length }), dots]);
    var next = i + 1 < ids.length ? byId[ids[i + 1]] : null;
    var c = next
      ? chips([{ label: "Next: " + next.title, primary: true, run: function () { addUser("Next"); showTour(i + 1); } }, { label: "Stop the tour", run: function () { state.tour = -1; addBot([h("article", { class: "card" }, [h("p", { text: "No problem. Ask me anything, or open Topics to browse." })]), chips(starters().slice(0, 3))]); } }])
      : chips([askChip("how do i join lions", "How do I join?"), askChip("what are the global causes", "See the global causes"), { label: "Browse topics", run: openTopics }]);
    addBot([entryCard(e, head), c]);
  }

  /* ---------- sheet (menu / topics / about) ---------- */
  var sheet = document.getElementById("sheet"), scrim = document.getElementById("scrim");
  function openSheet(title, body) {
    document.getElementById("sheetTitle").textContent = title;
    var b = document.getElementById("sheetBody"); b.textContent = ""; b.appendChild(body);
    sheet.classList.add("open"); scrim.classList.add("open");
    document.getElementById("sheetClose").focus();
  }
  function closeSheet() { sheet.classList.remove("open"); scrim.classList.remove("open"); }
  scrim.addEventListener("click", closeSheet);
  document.getElementById("sheetClose").addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

  function row(label, fn, sub) {
    return h("button", { class: "row", type: "button", onclick: function () { closeSheet(); fn(); } }, [h("span", { text: label }), sub ? h("small", { class: "small", text: sub }) : null]);
  }
  function openTopics() {
    var groups = {}, order = [];
    KB.entries.forEach(function (e) { if (!groups[e.cat]) { groups[e.cat] = []; order.push(e.cat); } groups[e.cat].push(e); });
    var body = h("div", null, []);
    order.forEach(function (c) {
      body.appendChild(h("div", { class: "grp", text: c }));
      groups[c].forEach(function (e) { body.appendChild(row(e.title, function () { ask(e.questions[0]); })); });
    });
    openSheet("Browse topics", body);
  }
  function setSize(px) { document.documentElement.style.setProperty("--fs", px + "px"); store.set("lg_size", px); }
  function openMenu() {
    var body = h("div", null, [
      row("Take the 2-minute tour", startTour),
      row("Browse all topics", openTopics),
      row("Library: forms, guides, videos", openLibrary),
      h("div", { class: "grp", text: "Text size" }),
      h("div", { class: "size" }, [16, 17, 19, 22].map(function (p, i) { return h("button", { type: "button", text: ["Small", "Normal", "Large", "Largest"][i], onclick: function () { setSize(p); } }); }))
    ]);
    if (state.deferredInstall) body.appendChild(row("Install on this phone", function () { state.deferredInstall.prompt(); state.deferredInstall = null; }));
    else if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone) body.appendChild(h("p", { class: "small", text: "To install on iPhone: tap the Share button in Safari, then Add to Home Screen." }));
    body.appendChild(row("About this guide", openAbout));
    body.appendChild(row("Clear conversation", welcome));
    if (ADMIN) body.appendChild(row("Review log (admin)", openLog));
    openSheet("Menu", body);
  }
  function openAbout() {
    var di = state.docIndex, n = di && di.docs ? di.docs.length : 0;
    openSheet("About this guide", h("div", null, [
      h("p", { text: "Lions Guide is a free guide that helps anyone understand Lionism. It is not published by Lions Clubs International." }),
      h("p", { text: "Answers are plain-language summaries with links to where each fact comes from. A green Official badge means the page is on lionsclubs.org. An amber Lions-affiliated badge means a Lions club or district site that repeats official text. Always confirm anything important at lionsclubs.org." }),
      h("p", { text: "Created by Ln. Mukesh Kumar Pandey." }),
      h("p", { class: "small", text: "Version " + (KB.meta.version || "?") + " (" + (KB.meta.build || "") + ")" }),
      h("p", { class: "small", text: KB.entries.length + " written answers · " + n + " documents indexed · content updated " + (KB.meta.built || "") }),
      h("p", null, [h("a", { href: "https://www.lionsclubs.org/en/member-resource-center", target: "_blank", rel: "noopener", text: "Open the official Member Resource Center" })])
    ]));
  }
  function openLog() {
    var l = store.get("lg_log", []), un = l.filter(function (r) { return r.type === "unanswered"; });
    var fb = l.filter(function (r) { return r.type === "feedback" && r.v < 0; });
    var body = h("div", null, [h("p", { class: "small", text: "Stored on this device only. " + un.length + " unanswered, " + fb.length + " marked not helpful." })]);
    un.slice(-40).reverse().forEach(function (r) { body.appendChild(h("div", { class: "row", text: r.q })); });
    body.appendChild(h("button", { class: "chip", type: "button", text: "Copy log as JSON", onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(l, null, 1)); } }));
    openSheet("Review log", body);
  }

  /* ---------- wiring ---------- */
  var form = document.getElementById("form"), input = document.getElementById("q"), send = document.getElementById("send");
  form.addEventListener("submit", function (ev) { ev.preventDefault(); var v = input.value; input.value = ""; send.disabled = true; input.blur(); ask(v); });
  input.addEventListener("input", function () { send.disabled = !input.value.trim(); });
  send.disabled = true;
  document.getElementById("topicsBtn").addEventListener("click", openTopics);
  document.getElementById("menuBtn").addEventListener("click", openMenu);

  var segBtns = document.querySelectorAll(".seg button");
  function paintMode() { segBtns.forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.mode === state.mode ? "true" : "false"); }); }
  segBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      state.mode = b.dataset.mode; store.set("lg_mode", state.mode); paintMode();
      if (chat.querySelectorAll(".msg").length <= 1) welcome();
    });
  });
  paintMode();

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = document.getElementById("mic");
  if (SR) {
    mic.style.display = "grid";
    var rec = null;
    mic.addEventListener("click", function () {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = navigator.language || "en-IN"; rec.interimResults = false;
      mic.classList.add("on"); mic.setAttribute("aria-label", "Stop listening");
      rec.onresult = function (e) { var t = e.results[0][0].transcript; input.value = ""; ask(t); };
      rec.onend = function () { rec = null; mic.classList.remove("on"); mic.setAttribute("aria-label", "Speak your question"); };
      rec.onerror = function () { if (rec) rec.stop(); };
      rec.start();
    });
  }

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); state.deferredInstall = e; });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  // Logo: shown when logo.png loads; otherwise the "L" stays.
  (function () {
    var mark = document.getElementById("mark"), img = document.getElementById("logo");
    function ok() { mark.classList.add("has-logo"); img.hidden = false; var sp = mark.querySelector("span"); if (sp) sp.hidden = true; }
    if (img.complete && img.naturalWidth) ok(); else img.addEventListener("load", ok);
  })();

  var sz = store.get("lg_size", null); if (sz) setSize(sz);
  fetch("docindex.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { state.docIndex = d; }).catch(function () {});

  function showHash() {
    var m = /#e=([\w-]+)/.exec(location.hash);
    if (m && byId[m[1]]) { state.last = byId[m[1]]; addBot([entryCard(byId[m[1]])].concat(relatedChips(byId[m[1]]))); return true; }
    return false;
  }
  welcome();
  if (!showHash() && params.get("q")) ask(params.get("q"));
  window.addEventListener("hashchange", showHash);

  window.__lg = { ask: ask, state: state, idx: idx, KB: KB, S: S, docReady: function () { return state.docIndex; } };
})();
