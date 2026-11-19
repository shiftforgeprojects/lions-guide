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
  if (/[?&]embed=1\b/.test(location.search)) document.documentElement.classList.add("embed");
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
    // answers grow after they first appear (documents, details): keep the top of the answer in view for a moment, unless the reader scrolls
    if (window.ResizeObserver) {
      var moved = false, mark = function () { moved = true; };
      chat.addEventListener("wheel", mark, { once: true, passive: true }); chat.addEventListener("touchmove", mark, { once: true, passive: true });
      var ro = new ResizeObserver(function () { if (!moved && chat.lastElementChild === m) m.scrollIntoView({ block: "start" }); });
      ro.observe(m); setTimeout(function () { ro.disconnect(); }, 4000);
    }
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
    var sh = 0; for (var i = 0; i < id.length; i++) sh += id.charCodeAt(i); sh = sh % 8;
    state.shards = state.shards || {};
    state.shards[sh] = state.shards[sh] || fetch("dd" + sh + ".json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    state.docCache[id] = state.shards[sh].then(function (m) { return m[id] || null; });
    return state.docCache[id];
  }
  function docLane(q) {
    var di = state.docIndex;
    if (/\b(weather|forecast|stocks?|recipes?|bake|cake|poem|joke|lyrics|bitcoin|crypto|horoscope|laptop|iphone|prime minister|cricket|football|movie|movies)\b/i.test(q) && !/\blions?\b/i.test(q)) return Promise.resolve([]);
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
  function preferDocs(q, res, ps) {
    var t0 = res.results[0];
    if (!t0 || !ps.length || t0.qsim >= 1) return false;
    var qt = S.tokens(q), tt = S.tokens(ps[0].chunk.doc.t);
    var titleHit = tt.length > 0 && tt.every(function (t) { return qt.indexOf(t) >= 0; });
    if (titleHit) return true;
    if (t0.qsim >= 0.6) return false;
    return ps[0].coverage > t0.coverage + 0.15 || (t0.qsim < 0.4 && ps[0].coverage >= t0.coverage && ps[0].coverage >= 0.99);
  }
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
      var weak = !res.confident || !res.results.length || res.results[0].qsim < 0.5;   // a question that already matches an answer well is not a follow-up
      if ((pron && weak) || (lead && !res.confident)) {
        var r3 = S.search(idx, q + " " + state.last.title, { mode: state.mode });
        if (r3.confident || r3.tentative) res = r3;
      }
    }
    var msg = addBot([]);
    var top = (res.confident || res.tentative) ? res.results[0].entry : null;
    Promise.all([docLane(q), loadLib()]).then(function (both) {
      var ps = both[0], libHits = libSearch(both[1], q, 3);
      // The real Lions page wins when it matches the question better than a written answer does.
      if (top && preferDocs(q, res, ps)) top = null;
      // A form, guide or page whose title matches the question beats a weak written answer.
      if (top && res.results[0].qsim < 0.5 && libHits.length && libHits[0].sc >= 6) top = null;
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
      } else if (ps.length) state.last = null;
      if (ps.length) {
        if (top) {   // a written answer already exists: keep the exact passages one tap away so the phone screen stays short
          var det = h("details", { class: "card docs", open: "" }, [h("summary", { text: "What the documents say (" + ps.length + ")" })]);
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
      if (!top && ps.length) pquick(msg, ps);
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

  // No written answer, but the real Lions pages have one: say it in two sentences, name the page, keep the full passages one tap away.
  function pquick(msg, ps) {
    var p = ps[0], c = p.chunk, ss = sentences(p.excerpt || "").filter(function (x) { return x.length > 25; }), sn = ss.slice(0, 2).join(" ") || p.excerpt;
    if (!sn) return;
    var say = h("article", { class: "card gen quick" }, [
      h("p", { text: sn }),
      h("div", { class: "srcs" }, [h("a", { class: "src", href: c.doc.u, target: "_blank", rel: "noopener" }, [badge(c.doc.tier), h("span", { text: c.doc.t + " on lionsclubs.org" })])])
    ]);
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
    q = q.replace(/\bsuspend(s|ed|ing)?\b/gi, "suspension");
    var qt = S.tokens(q), browse = /\b(documents?|videos?|forms?|library|downloads?|resources?|brochures?|flyers?|presentations?|applications?|guides?|handbooks?)\b/i.test(q);
    var want = /\bvideos?\b/i.test(q) ? "video" : null;
    var rare = qt.filter(function (t) { return !/^(document|video|form|librari|download|resourc|brochur|flyer|present|applic|guid|handbook|show|find|need|want|get|lion|club)/.test(t) && t !== "member"; });
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

  var ROLESP = null;
  function loadRoles() {
    if (!ROLESP) ROLESP = fetch("roles.json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    return ROLESP;
  }
  function tile(label, sub, fn) {
    return h("button", { class: "tile", type: "button", onclick: fn }, [h("b", { text: label }), sub ? h("small", { text: sub }) : null]);
  }
  function roleHub(r) {
    addUser(r.label);
    loadLib().then(function (lib) {
      var byT = {}; lib.forEach(function (x) { byT[x.t] = x; });
      var kids = [h("span", { class: "cat", text: "Your role" }), h("h2", { text: r.label }), h("p", { text: r.blurb })];
      kids.push(h("div", { class: "grp", text: "Ask me" })); kids.push(chips(r.q.map(function (q) { return askChip(q); })));
      var pg = r.pages.map(function (t) { return byT[t]; }).filter(Boolean), dc = r.docs.map(function (t) { return byT[t]; }).filter(Boolean);
      var card = h("article", { class: "card hub" }, kids);
      if (pg.length) { card.appendChild(h("div", { class: "grp", text: "Read on lionsclubs.org" })); pg.forEach(function (x) { card.appendChild(h("a", { class: "libitem", href: x.u, target: "_blank", rel: "noopener" }, [h("b", { text: x.t }), h("p", { text: x.s })])); }); }
      if (dc.length) { card.appendChild(h("div", { class: "grp", text: "Forms, guides and documents" })); dc.forEach(function (x) { card.appendChild(h("a", { class: "libitem", href: LIBU + x.i, target: "_blank", rel: "noopener" }, [h("b", { text: x.t }), h("div", { class: "where", text: [TYPE_WORD[x.y] || x.y, x.p ? x.p + " pp" : null, x.d].filter(Boolean).join(" · ") })])); }); }
      addBot([card, chips([{ label: "Choose another role", run: welcome }])]);
    });
  }
  function publicHome() {
    var stat = function (n, l) { return h("div", { class: "stat" }, [h("b", { text: n }), h("small", { text: l })]); };
    var hero = h("article", { class: "card hero" }, [
      h("span", { class: "kicker", text: "Lions Clubs International" }),
      h("h1", { text: "Serve your community. Join a global family." }),
      h("p", { text: "Ordinary people, extraordinary service. Find out in plain words what Lions do, how to join, and what it takes. Ask me anything." }),
      h("div", { class: "cta" }, [
        h("button", { class: "btn gold", type: "button", text: "How do I join?", onclick: function () { ask("How do I join a Lions club?"); } }),
        h("button", { class: "btn ghost", type: "button", text: "What do Lions do?", onclick: function () { ask("What do Lions actually do?"); } })
      ]),
      h("div", { class: "stats" }, [stat("1.4 million", "members"), stat("200+", "countries and areas"), stat("1917", "founded in Chicago"), stat("100M+", "people served every year")])
    ]);
    var causes = [
      ["Childhood cancer", "Support for the needs of children and families affected by childhood cancer.", "Lions childhood cancer", "\ud83c\udf97\ufe0f", "#e9b400,#7a4d00", "#fcc21b", "#1a1a1a"],
      ["Diabetes", "Working to reduce how common diabetes is and to improve life for people living with it.", "Lions diabetes", "\ud83e\udd32", "#bfe3f5,#005f9e", "#4aa3ff", "#0b2545"],
      ["Disaster relief", "Meeting immediate needs and giving long-term support after natural disasters.", "Lions disaster relief", "\u26c8\ufe0f", "#a79ed6,#1f3490", "#0b3a9c", "#fff"],
      ["Environment", "Protecting the environment for healthier communities and a more sustainable world.", "Lions environment", "\ud83c\udf3f", "#7cc243,#007a5a", "#a3d065", "#10321f"],
      ["Humanitarian", "Finding the world's most crucial needs and giving aid where it is needed most.", "Lions humanitarian", "\ud83e\udd1d", "#f08a24,#7a1d1d", "#ff6b4a", "#2a0a00"],
      ["Hunger", "Improving food security and access to nutritious food for people who go without.", "Lions hunger", "\ud83c\udf72", "#f7c36a,#d84a00", "#fb8c3a", "#2a1200"],
      ["Vision", "Helping prevent avoidable blindness and improve life for people who are blind or visually impaired.", "Lions vision", "\ud83d\udc41\ufe0f", "#d6b0d9,#3d0f48", "#7b3a8a", "#fff"],
      ["Youth", "Supporting young people to make positive choices and become the next generation of leaders.", "Lions youth programs", "\ud83e\uddd1\u200d\ud83e\udd1d\u200d\ud83e\uddd1", "#8fbf8f,#00a3b5", "#00a3b5", "#fff"]
    ];
    var why = h("article", { class: "card causes" }, [
      h("h2", { text: "Our global causes" }), h("i", { class: "rule" }),
      h("div", { class: "cgrid" }, causes.map(function (c) {
        var g = c[4].split(",");
        return h("button", { class: "cause", type: "button", onclick: function () { ask(c[2]); } }, [
          h("span", { class: "chead", style: "background:linear-gradient(135deg," + g[0] + "," + g[1] + ")" }, [h("span", { class: "cico", text: c[3] }), h("span", { class: "ctab", style: "background:" + c[5] + ";color:" + c[6], text: "Learn more" })]),
          h("b", { text: c[0] }), h("small", { text: c[1] })
        ]);
      }))
    ]);
    var me = h("article", { class: "card" }, [
      h("span", { class: "cat", text: "Is Lions for me?" }),
      h("div", { class: "tiles" }, [
        ["How to join", "Find a club and take the first step", "How do I join a Lions club?"],
        ["What it costs", "Dues and fees, in plain words", "How much does it cost to join?"],
        ["For young people", "Leo clubs and the Cub program", "How do I start a Leo club?"],
        ["Who is who", "Club, district and International titles", "What are the Lions officer titles at each level?"],
        ["Our foundation", "LCIF and the grants it funds", "What is LCIF?"],
        ["Our story", "From Chicago in 1917 to today", "What is the history of Lions?"]
      ].map(function (t) { return tile(t[0], t[1], function () { ask(t[2]); }); })),
      chips([{ label: "Forms, guides and videos", run: openLibrary }, { label: "Browse all topics", run: openTopics }, { label: "2-minute tour", run: startTour }, { label: "See the chat bubble", run: function () { window.open("bubble.html", "_blank", "noopener"); } }])
    ]);
    addBot([hero, why, me]);
    chat.scrollTop = 0;
  }
  function navState() { var b = document.getElementById("backBtn"); if (b) b.disabled = !chat.querySelector(".msg.me"); }
  function goBack() {
    var me = chat.querySelectorAll(".msg.me"); if (!me.length) return;
    var node = me[me.length - 1], rm = [];
    while (node) { rm.push(node); node = node.nextElementSibling; }
    rm.forEach(function (n) { n.remove(); });
    state.last = null; navState();
    var last = chat.lastElementChild; if (last) last.scrollIntoView({ block: "start" });
  }
  function startOver() { chat.innerHTML = ""; state.last = null; welcome(); navState(); }
  (function () {
    var b = document.getElementById("backBtn"), r = document.getElementById("resetBtn");
    if (b) b.addEventListener("click", goBack); if (r) r.addEventListener("click", startOver);
    new MutationObserver(navState).observe(chat, { childList: true });
  })();
  function stampVersion() { var v = document.getElementById("ver"); if (!v) return; var c = KB.meta.checked; v.textContent = "v" + (KB.meta.version || "?") + (c ? "\nchecked " + c : ""); }
  function welcome(keep) {
    stampVersion();
    if (keep !== true) chat.textContent = "";
    state.last = null;
    var member = state.mode === "member";
    if (!member) return publicHome();
    var head = [h("span", { class: "cat", text: member ? "For members" : "Welcome" }),
      h("h2", { text: member ? "Choose your role" : "Welcome to Lions" }),
      h("p", { text: member ? "Pick your level and role, from your club up to International. You get the questions, official pages and forms for that job. New to all this? Start with the first box. Or type any question below." : "Lions Clubs International is a global network of volunteers serving their communities. Start here, or type any question below." })];
    var grid = h("div", { class: member ? "levels" : "tiles" }, []);
    if (member) {
      loadRoles().then(function (rs) {
        var cur = null, g = null;
        rs.forEach(function (r) {
          if (r.lv !== cur) { cur = r.lv; grid.appendChild(h("div", { class: "grp lvl", text: cur })); g = h("div", { class: "tiles" }, []); grid.appendChild(g); }
          g.appendChild(tile(r.label, r.blurb, function () { roleHub(r); }));
        });
      });
    } else {
      [["What is Lions?", "Who we are and how we are organised", "What is Lions Clubs International?"],
       ["What Lions do", "Vision, hunger, diabetes, children and more", "What do Lions actually do?"],
       ["Join a club", "Who can join and how", "How do I join a Lions club?"],
       ["What it costs", "Dues and fees", "How much does it cost to join?"],
       ["Young people", "Leo clubs and the Cub program", "How do I start a Leo club?"],
       ["Who is who", "Club, district and International titles", "What are the Lions officer titles at each level?"],
       ["Our foundation", "LCIF and the grants it funds", "What is LCIF?"]].forEach(function (t) { grid.appendChild(tile(t[0], t[1], function () { ask(t[2]); })); });
    }
    var foot = [h("div", { class: "grp", text: "Also" }), chips([{ label: "Forms, guides and videos", run: openLibrary }, { label: "Browse all topics", run: openTopics }, { label: "2-minute tour", run: startTour }, { label: "See the chat bubble", run: function () { window.open("bubble.html", "_blank", "noopener"); } }]),];
    addBot([h("article", { class: "card" }, head.concat([grid]).concat(foot))]);
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
  function openSize() {
    var cur = store.get("lg_size", 17);
    var wrap = h("div", { class: "size" }, [16, 17, 19, 22].map(function (px, n) {
      return h("button", { type: "button", class: px === cur ? "on" : "", text: ["Small", "Normal", "Large", "Largest"][n], onclick: function () { setSize(px); closeSheet(); } });
    }));
    openSheet("Text size", h("div", null, [h("p", { text: "Choose the size that is easiest to read. Your choice is kept on this device." }), wrap]));
  }
  function openAbout() {
    var di = state.docIndex, n = di && di.docs ? di.docs.length : 0;
    function sec(t, ps) { return [h("h4", { text: t })].concat([].concat(ps).map(function (x) { return typeof x === "string" ? h("p", { text: x }) : x; })); }
    var kids = [].concat(
      sec("What this guide is", "Lions Guide is a free, plain-language guide to Lionism. It helps new and existing members understand what Lions do, how to join, what it costs, who does what in a club, district and International, and how Lions Clubs International Foundation (LCIF) supports service. It works on a phone and keeps working offline after the first visit."),
      [h("div", { class: "note" }, [h("p", { text: "Preview version for review. This guide is an independent project of District 317F. It is not an official product of Lions Clubs International and has not been published, endorsed or approved by it. Lions, Lions Clubs International and the Lions logo belong to Lions Clubs International and appear here only for identification." })])],
      sec("Where the answers come from", "Answers are written in plain language from lionsclubs.org, including the Standard Club Constitution and By-Laws for FY 2026-27, together with guidance supplied by the creator. Where an answer comes from an official page, a green Official label links to that page so you can read the original."),
      sec("How to use it", ["Ask in your own words, tap a topic, or choose I'm new to Lions or I'm a member to see questions suited to you. If the guide cannot find something, it says so rather than guessing.", "Answers are summaries. Your own club's constitution and by-laws, and the rules of your district and multiple district, may differ. For anything important, such as finances, elections, discipline or membership decisions, confirm with your club officers, your district team or lionsclubs.org."]),
      sec("Privacy", "There is no account and no sign-up. Your questions are answered on your device and are not sent to a server. Settings such as text size and the preview access PIN are stored only on your device."),
      sec("Created by", "Ln. Mukesh Kumar Pandey, District 317F. Please share suggestions, corrections and missing topics with the creator."),
      sec("Version", [h("p", { class: "small", text: "Version " + (KB.meta.version || "?") + (KB.meta.built ? " \u00b7 content checked " + KB.meta.built : "") }), h("p", { class: "small", text: KB.entries.length + " written answers and " + n + " official documents searched." })]),
      [h("p", null, [h("a", { href: "https://www.lionsclubs.org/", target: "_blank", rel: "noopener", text: "Lions Clubs International (lionsclubs.org)" })]),
       h("p", null, [h("a", { href: "https://www.lionsclubs.org/en/member-resource-center", target: "_blank", rel: "noopener", text: "Official Member Resource Center" })])]
    );
    openSheet("About Lions Guide", h("div", { class: "about" }, kids));
  }
  function openLog() {
    var l = store.get("lg_log", []), un = l.filter(function (r) { return r.type === "unanswered"; });
    var fb = l.filter(function (r) { return r.type === "feedback" && r.v < 0; });
    var body = h("div", null, [h("p", { class: "small", text: "Stored on this device only. " + un.length + " unanswered, " + fb.length + " marked not helpful." })]);
    un.slice(-40).reverse().forEach(function (r) { body.appendChild(h("div", { class: "row", text: r.q })); });
    body.appendChild(h("button", { class: "chip", type: "button", text: "Copy log as JSON", onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(l, null, 1)); } }));
    openSheet("Review log", body);
  }

  /* ---------- welcome notice: shown each time the app opens ---------- */
  /* ---------- private preview PIN (a soft lock: keeps the audience small; it is not strong security) ---------- */
  var PIN_HASH = "e8817c36c38ca2c5003cd9f5f5ef1f1efad4b3d7ec97df894d65fa589feee09d";
  function sha256(str) {
    var K = [], H = [], p, c, q, i, j;
    function isP(n) { for (var d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; }
    for (p = 2, c = 0; c < 64; p++) if (isP(p)) { if (c < 8) H[c] = (Math.pow(p, 0.5) % 1) * 4294967296 | 0; K[c++] = (Math.pow(p, 1 / 3) % 1) * 4294967296 | 0; }
    var b = unescape(encodeURIComponent(str)), l = b.length, w = [];
    for (i = 0; i < ((l + 72) >> 6 << 4); i++) w[i] = 0;
    for (i = 0; i < l; i++) w[i >> 2] |= b.charCodeAt(i) << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[w.length - 1] = l * 8;
    function R(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (j = 0; j < w.length; j += 16) {
      var W = w.slice(j, j + 16), v = H.slice(0);
      for (i = 0; i < 64; i++) {
        if (i >= 16) W[i] = (W[i - 16] + (R(W[i - 15], 7) ^ R(W[i - 15], 18) ^ (W[i - 15] >>> 3)) + W[i - 7] + (R(W[i - 2], 17) ^ R(W[i - 2], 19) ^ (W[i - 2] >>> 10))) | 0;
        var t1 = (v[7] + (R(v[4], 6) ^ R(v[4], 11) ^ R(v[4], 25)) + ((v[4] & v[5]) ^ (~v[4] & v[6])) + K[i] + W[i]) | 0;
        var t2 = ((R(v[0], 2) ^ R(v[0], 13) ^ R(v[0], 22)) + ((v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]))) | 0;
        v = [(t1 + t2) | 0, v[0], v[1], v[2], (v[3] + t1) | 0, v[4], v[5], v[6]];
      }
      for (i = 0; i < 8; i++) H[i] = (H[i] + v[i]) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }
  function pinGate(done) {
    var forced = /[?&]pin=1\b/.test(location.search);
    if (navigator.webdriver && !forced) return done();
    try { var v = (localStorage.getItem("lg_pin") || "").split("|"); if (!forced && v[0] === PIN_HASH && Date.now() < +v[1]) return done(); } catch (e) {}
    var input = h("input", { type: "password", inputmode: "numeric", autocomplete: "off", id: "pinIn", "aria-label": "Access PIN", placeholder: "Enter PIN" });
    var go = h("button", { class: "btn gold", type: "button", text: "Open", id: "pinGo" });
    var msg = h("p", { class: "pinmsg", id: "pinMsg", role: "alert" });
    var tries = 0, lockUntil = 0;
    var box = h("div", { class: "dbox", role: "dialog", "aria-modal": "true", "aria-labelledby": "pinTitle" }, [
      h("img", { class: "dlogo", src: "logo.png", alt: "" }),
      h("h2", { id: "pinTitle", text: "Private preview" }),
      h("p", { text: "This Lions Guide preview is open to invited reviewers only. Please enter your PIN to continue." }),
      input, msg,
      h("div", { class: "dbtns" }, [go]),
      h("p", { class: "small", text: "Do not have a PIN? Please contact Ln. Mukesh Kumar Pandey (District 317F) to request access." })
    ]);
    var ov = h("div", { class: "dover pinov", id: "pinGate" }, [box]); document.body.appendChild(ov); input.focus();
    function tryPin() {
      if (Date.now() < lockUntil) { msg.textContent = "Too many tries. Please wait a few seconds and try again."; return; }
      var ok = sha256("lionguide-v1:" + input.value.replace(/\s+/g, "")) === PIN_HASH;
      if (ok) { try { localStorage.setItem("lg_pin", PIN_HASH + "|" + (Date.now() + 7 * 864e5)); } catch (e) {} try { sessionStorage.removeItem("lg_ok"); } catch (e) {} ov.remove(); setTimeout(done, 350); return; }
      tries++; input.value = ""; msg.textContent = "That PIN is not correct. Please check it and try again, or contact Ln. Mukesh Kumar Pandey for access.";
      if (tries % 5 === 0) lockUntil = Date.now() + 30000;
      input.focus();
    }
    go.addEventListener("click", tryPin);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); tryPin(); } });
  }
  function disclaimer(done) {
    var embed = /[?&]embed=1\b/.test(location.search), forced = /[?&]disclaimer=1\b/.test(location.search);
    var seen = false; try { seen = sessionStorage.getItem("lg_ok") === "1"; } catch (e) {}
    if ((seen && !forced) || (navigator.webdriver && !forced)) return done();
    var link = function (t) { return h("a", { href: "https://www.lionsclubs.org/", target: "_blank", rel: "noopener", text: t || "www.lionsclubs.org" }); };
    var ok = h("button", { class: "btn gold", type: "button", text: "OK", id: "dOk" });
    var cancel = h("button", { class: "btn ghost", type: "button", text: "Cancel", id: "dCancel" });
    var box = h("div", { class: "dbox", role: "dialog", "aria-modal": "true", "aria-labelledby": "dTitle" }, [
      h("img", { class: "dlogo", src: "logo.png", alt: "" }),
      h("h2", { id: "dTitle", text: "Before you begin" }),
      h("p", { text: "Welcome! Lions Guide was created to help people who are curious about Lions, and Lions members, learn about Lionism. It was developed by Ln. Mukesh Kumar Pandey (District 317F)." }),
      h("p", {}, ["The information, images and videos in this guide come from the official Lions Clubs International website, ", link("https://www.lionsclubs.org/"), ", together with guidance supplied by the creator. They are used only to make learning about Lionism easy for everyone. This is a preview for review and is not an official Lions Clubs International product."]),
      h("p", {}, ["If anything is unclear, or you would like to double-check a detail, please visit ", link("https://www.lionsclubs.org/"), " to confirm it. That website is always the final authority."]),
      h("p", { class: "dask", text: "Press OK to continue to the guide, or Cancel to close it." }),
      h("div", { class: "dbtns" }, [ok, cancel])
    ]);
    var ov = h("div", { class: "dover", id: "disclaimer" }, [box]); document.body.appendChild(ov);
    ok.focus();
    ok.addEventListener("click", function () { try { sessionStorage.setItem("lg_ok", "1"); } catch (e) {} ov.remove(); done(); });
    cancel.addEventListener("click", function () {
      if (embed && window.parent !== window) { try { window.parent.postMessage("lg-close", "*"); } catch (e) {} ov.remove(); showClosed(); return; }
      try { window.close(); } catch (e) {}
      showClosed();
    });
    ov.addEventListener("keydown", function (e) { if (e.key === "Tab") { var f = [ok, cancel, box.querySelectorAll("a")[0], box.querySelectorAll("a")[1]].filter(Boolean), i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } });
  }
  function showClosed() {
    var old = document.getElementById("disclaimer"); if (old) old.remove();
    document.body.textContent = "";
    var again = h("button", { class: "btn gold", type: "button", text: "Open the guide again", onclick: function () { try { sessionStorage.removeItem("lg_ok"); } catch (e) {} location.reload(); } });
    document.body.appendChild(h("div", { class: "dclosed" }, [h("h2", { text: "The Lions Guide is closed" }), h("p", { text: "Thank you for visiting. You can close this tab now." }), again]));
  }

  /* ---------- wiring ---------- */
  var form = document.getElementById("form"), input = document.getElementById("q"), send = document.getElementById("send");
  form.addEventListener("submit", function (ev) { ev.preventDefault(); var v = input.value; input.value = ""; send.disabled = true; input.blur(); ask(v); });
  input.addEventListener("input", function () { send.disabled = !input.value.trim(); });
  send.disabled = true;
  document.getElementById("topicsBtn").addEventListener("click", openTopics);
  document.getElementById("aboutBtn").addEventListener("click", openAbout);
  document.getElementById("sizeBtn").addEventListener("click", openSize);

  var segBtns = document.querySelectorAll(".seg button");
  function paintMode() { segBtns.forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.mode === state.mode ? "true" : "false"); }); }
  segBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      state.mode = b.dataset.mode; store.set("lg_mode", state.mode); paintMode();
      welcome(chat.querySelectorAll(".msg").length > 1);
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
    var hadSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (hadSW) location.reload(); });
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
  pinGate(function () { disclaimer(function () {
    welcome();
    // On a wide screen, show the chat bubble on this same page so the site and the bubble can be compared
    if (!/[?&]embed=1\b/.test(location.search) && !navigator.webdriver) {
      var b = document.createElement("script"); b.src = "bubble.js"; b.defer = true; b.setAttribute("data-url", "./"); if (window.innerWidth < 900) b.setAttribute("data-bottom", "92"); document.body.appendChild(b);
    }
  }); });
  if (!showHash() && params.get("q")) ask(params.get("q"));
  window.addEventListener("hashchange", showHash);

  window.__lg = { ask: ask, state: state, idx: idx, KB: KB, S: S, docReady: function () { return state.docIndex; } };
})();
