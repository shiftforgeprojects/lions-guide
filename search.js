/* Lions Guide search engine. Pure JS, no dependencies, runs in browser and Node.
 * BM25 over weighted fields + sample-question matching + synonym expansion.
 * Returns a confidence signal so the app can say "I don't know" instead of guessing. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LionSearch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STOP = new Set(("a an the is are was were be been being am do does did to of in on at for from by with about as it its " +
    "this that these those i me my we our you your can could should would will shall may might please tell explain " +
    "what whats who whom whose which when where why how any some there their they them and or but if then so than too very " +
    "just also get got give want need know like more much many lot lots really out up down into over off around per via vs difference different differ between versus compare compared stand").split(" "));

  // query-side expansion, applied to stems. Values are extra stems with lower weight.
  var SYN = {
    become: ["join"], sign: ["join"], enrol: ["join"], enroll: ["join"], register: ["join"],
    kid: ["youth", "leo"], child: ["youth", "leo"], children: ["youth", "leo"], teen: ["youth", "leo"], teenager: ["youth", "leo"],
    school: ["youth", "campus"], young: ["youth"],
    eye: ["vision"], sight: ["vision"], blind: ["vision"], blindness: ["vision"], spectacle: ["eyeglass", "vision"], glass: ["eyeglass", "vision"], eyeglass: ["vision"],
    sugar: ["diabete"], diabetic: ["diabete"],
    food: ["hunger"], hungry: ["hunger"], starv: ["hunger"], nutrition: ["hunger"],
    water: ["environment", "sanitation"], climate: ["environment"], green: ["environment"], tree: ["environment"], clean: ["environment"],
    cost: ["due", "fee"], price: ["due", "fee"], pay: ["due", "fee"], expensive: ["due", "fee"], cheap: ["due"], money: ["donate", "due"],
    founder: ["history"], found: ["history"], founded: ["history"], origin: ["history"], begin: ["history"], began: ["history"],
    donate: ["lcif"], donation: ["lcif"], charity: ["lcif"], grant: ["lcif"], fund: ["lcif"], fundrais: ["lcif"],
    contact: ["contact"], call: ["contact"], email: ["contact"], phone: ["contact"], address: ["contact"], reach: ["contact"],
    ethic: ["code"], rule: ["code"], conduct: ["code"], behaviour: ["code"], behavior: ["code"],
    president: ["structure"], governor: ["structure"], hierarchy: ["structure"], organis: ["structure"], organiz: ["structure"],
    student: ["campus"], college: ["campus"], university: ["campus"],
    colour: ["color"], purple: ["color"], gold: ["color"], logo: ["emblem"],
    meaning: ["glossary"], mean: ["glossary"], jargon: ["glossary"], term: ["glossary"], acronym: ["glossary", "motto"],
    cancer: ["childhood"], disaster: ["relief"], flood: ["disaster"], earthquake: ["disaster"], emergency: ["disaster"],
    volunteer: ["service"], eyesight: ["vision"],
    video: ["virtual", "online"], zoom: ["virtual", "online"], remote: ["virtual", "online"], internet: ["virtual", "online"], web: ["virtual"], remotely: ["virtual", "online"],
    city: ["near", "locator"], town: ["near", "locator"], area: ["near", "locator"], nearby: ["near", "locator"], local: ["near"], abbreviation: ["glossary"], lead: ["structure"], leader: ["structure"], leaders: ["structure"],
    revive: ["revitalize", "rebuild"], reactivate: ["revitalize", "rebuild"], restart: ["rebuild"], struggling: ["revitalize", "rebuild"], dying: ["revitalize"], grow: ["membership", "growth"], recruit: ["membership", "growth"], attract: ["membership", "growth"]
  };
  (function () { var o = {}; Object.keys(SYN).forEach(function (k) { var ks = stem(k); o[ks] = (o[ks] || []).concat(SYN[k].map(stem)); }); SYN = o; })();

  // British -> American spellings so "programme" finds "program" (applied to documents and questions alike)
  var SPELL = { programme: "program", programmes: "programs", organisation: "organization", organisations: "organizations", organise: "organize", organised: "organized", organising: "organizing",
    colour: "color", colours: "colors", centre: "center", centres: "centers", behaviour: "behavior", honour: "honor", honours: "honors", recognise: "recognize", recognised: "recognized",
    favour: "favor", labour: "labor", neighbour: "neighbor", neighbours: "neighbors", licence: "license", defence: "defense", catalogue: "catalog", judgement: "judgment",
    fulfil: "fulfill", enrol: "enroll", sceptical: "skeptical", faecal: "fecal", whilst: "while", amongst: "among", realise: "realize", realised: "realized", specialise: "specialize" };

  function stem(w) {
    if (w.length > 4 && w.slice(-3) === "ies") w = w.slice(0, -3) + "y";
    else if (w.length > 5 && w.slice(-3) === "ing") w = w.slice(0, -3);
    else if (w.length > 4 && w.slice(-2) === "ed") w = w.slice(0, -2);
    else if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.slice(-1) === "s" && w.slice(-2) !== "ss" && w.slice(-2) !== "us") w = w.slice(0, -1);
    if (w.length > 3 && w.slice(-1) === "e") w = w.slice(0, -1);
    return w;
  }

  function tokens(s, keepStop) {
    var out = [];
    String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9.\s-]/g, " ").split(/\s+/).forEach(function (t) {
      t = t.replace(/^[.\-]+|[.\-]+$/g, "");
      if (!t) return;
      if (t.indexOf("-") > -1 && !/^\d/.test(t)) { t.split("-").forEach(push); return; }
      push(t);
    });
    function push(t) {
      if (!t) return;
      if (SPELL[t]) t = SPELL[t];
      if (!keepStop && STOP.has(t)) return;
      out.push(stem(t));
    }
    return out;
  }

  function build(kb) {
    var docs = [], df = Object.create(null), totalLen = 0;
    kb.entries.forEach(function (e) {
      var tf = Object.create(null), len = 0;
      function add(text, w) {
        tokens(text).forEach(function (t) { tf[t] = (tf[t] || 0) + w; len += w; });
      }
      add(e.title, 3);
      add((e.questions || []).join(" "), 3);
      add((e.tags || []).join(" "), 2);
      add(e.answer || "", 1);
      add((e.facts || []).join(" "), 1);
      add(e.text || "", 1);
      var qsets = (e.questions || []).map(function (q) { return new Set(tokens(q)); });
      var present = new Set(Object.keys(tf));
      Object.keys(tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      docs.push({ e: e, tf: tf, len: len, qsets: qsets, present: present });
      totalLen += len;
    });
    return { kb: kb, docs: docs, df: df, N: docs.length, avg: totalLen / Math.max(1, docs.length) };
  }

  function expand(qt) {
    var weights = Object.create(null);
    qt.forEach(function (t) { weights[t] = 1; });
    qt.forEach(function (t) {
      (SYN[t] || []).forEach(function (s) { if (!weights[s]) weights[s] = 0.55; });
    });
    return weights;
  }

  function norm(x) { return String(x).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }

  function search(idx, query, opts) {
    opts = opts || {};
    var qt = tokens(query);
    if (!qt.length) return { results: [], confident: false, qt: qt };
    var weights = expand(qt);
    var qnorm = norm(query);
    var k1 = 1.2, b = 0.75, res = [];

    idx.docs.forEach(function (d) {
      var s = 0;
      Object.keys(weights).forEach(function (t) {
        var f = d.tf[t];
        if (!f) return;
        var n = idx.df[t] || 0;
        var idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
        s += weights[t] * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / idx.avg));
      });
      // sample-question overlap (Jaccard-ish, rewards matching the whole question)
      var best = 0;
      var qset = new Set(qt);
      d.qsets.forEach(function (qs) {
        if (!qs.size) return;
        var inter = 0;
        qset.forEach(function (t) { if (qs.has(t)) inter++; });
        var uni = qset.size + qs.size - inter;
        var j = uni ? inter / uni : 0;
        if (j > best) best = j;
      });
      s += 7 * best;
      if (best === 1) s += 12;   // the user's words are exactly one of the entry's own curated questions
      if (d.e.questions && d.e.questions.some(function (x) { return norm(x) === qnorm; })) s += 25;   // the identical sentence
      // coverage of the user's own words (not synonyms)
      var hit = 0;
      qt.forEach(function (t) { if (d.present.has(t)) hit++; });
      var cov = hit / qt.length;
      // title bonus
      var tt = new Set(tokens(d.e.title)), th = 0;
      qt.forEach(function (t) { if (tt.has(t)) th++; });
      s += 1.5 * th;
      if (opts.mode && d.e.level && d.e.level !== "both") s *= (d.e.level === opts.mode ? 1.08 : 0.96);
      if (s > 0) res.push({ entry: d.e, score: s, coverage: cov, qsim: best });
    });

    res.sort(function (a, b2) { return b2.score - a.score; });
    var top = res[0];
    var minCov = qt.length <= 2 ? 1 : qt.length === 3 ? 0.66 : 0.5;
    var unknown = qt.filter(function (t) { return !idx.df[t] && !SYN[t]; }).length;   // words nothing in the KB knows
    var base = !!top && (top.coverage >= minCov || top.qsim >= 0.5) && top.score >= 2.2;
    var doubtful = unknown > 0 && unknown / qt.length >= 0.3 && !(top && top.qsim >= 0.66);
    var confident = base && !doubtful;
    var tentative = base && doubtful;   // matches most words but some are unknown: show as "closest match"
    return { results: res.slice(0, 6), confident: confident, tentative: tentative, unknown: unknown, qt: qt };
  }

  // Extractive snippet for crawled chunks (entries that only have raw text).
  function snippet(entry, qt, maxSentences) {
    var text = entry.text || "";
    var sents = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    var qs = new Set(qt);
    var scored = sents.map(function (s, i) {
      var tk = tokens(s), h = 0;
      tk.forEach(function (t) { if (qs.has(t)) h++; });
      return { s: s.trim(), i: i, h: h };
    }).filter(function (x) { return x.s.length > 25; });
    scored.sort(function (a, b2) { return b2.h - a.h || a.i - b2.i; });
    var pick = scored.slice(0, maxSentences || 3).sort(function (a, b2) { return a.i - b2.i; });
    return pick.map(function (x) { return x.s; }).join(" ");
  }

  var INTENTS = [
    { name: "greet", re: /^(hi|hello|hey|namaste|namaskar|good (morning|afternoon|evening)|hola|yo)\b[\s!.]*$/i },
    { name: "thanks", re: /^(thanks|thank you|thx|ty|great|ok|okay|cool|nice|got it)\b[\s!.]*$/i },
    { name: "tour", re: /\b(tour|walk me through|guide me|where (do|should) i start|start here|new to lions|beginner|overview|2 minute|two minute|explain lionism)\b/i },
    { name: "more", re: /^(tell me more|more( details| info| about (it|that|this))?|go on|continue|what else|explain (it|that|this)( more| again)?|elaborate)\b[\s?!.]*$/i },
    { name: "topics", re: /^(help|topics|menu|what can (i|you)( ask| do)?|what do you know|options)\b[\s?!.]*$/i }
  ];
  function intent(q) {
    var s = String(q || "").trim();
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].re.test(s)) return INTENTS[i].name;
    return null;
  }

  /* ---------- Document lane (stage 1): which documents are about this? ----------
   * di = docindex.json: { N, avg, len:[...], docs:[{id,t,u,tier,kind,n}], post:{term:[[docIdx,tf],...]} } */
  function docSearch(di, query, k) {
    var qt = tokens(query);
    if (!qt.length || !di || !di.docs || !di.docs.length) return { docs: [], qt: qt, confident: false };
    var weights = expand(qt), acc = Object.create(null), seen = Object.create(null);
    var k1 = 1.2, b = 0.75;
    Object.keys(weights).forEach(function (t) {
      var plist = di.post[t];
      if (!plist) return;
      var n = plist.length;
      var idf = Math.log(1 + (di.N - n + 0.5) / (n + 0.5));
      for (var i = 0; i < plist.length; i++) {
        var d = plist[i][0], f = plist[i][1];
        var s = weights[t] * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * di.len[d] / di.avg));
        acc[d] = (acc[d] || 0) + s;
        if (weights[t] === 1) seen[d] = (seen[d] || 0) + 1;
      }
    });
    var out = Object.keys(acc).map(function (d) {
      return { idx: +d, doc: di.docs[+d], score: acc[d], coverage: (seen[d] || 0) / qt.length };
    }).sort(function (a, b2) { return b2.score - a.score; }).slice(0, k || 4);
    return { docs: out, qt: qt, confident: out.length > 0 && out[0].coverage >= (qt.length === 1 ? 1 : 0.5) };
  }

  /* ---------- Document lane (stage 2): best passages inside the fetched docs ----------
   * chunks = [{doc:{id,t,u,tier}, h:heading, p:page|null, t:text}] */
  function passageSearch(chunks, query, n) {
    var qt = tokens(query);
    if (!qt.length || !chunks.length) return [];
    var weights = expand(qt);
    var tk = chunks.map(function (c) {
      var tf = Object.create(null), len = 0;
      tokens((c.h || "") + " " + (c.h || "") + " " + c.t).forEach(function (t) { tf[t] = (tf[t] || 0) + 1; len++; });
      return { tf: tf, len: len };
    });
    var df = Object.create(null), tot = 0;
    tk.forEach(function (x) { tot += x.len; Object.keys(x.tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; }); });
    var avg = tot / tk.length || 1, N = chunks.length, k1 = 1.2, b = 0.75;
    var scored = chunks.map(function (c, i) {
      var s = 0, hit = 0, x = tk[i];
      Object.keys(weights).forEach(function (t) {
        var f = x.tf[t];
        if (!f) return;
        var nn = df[t], idf = Math.log(1 + (N - nn + 0.5) / (nn + 0.5));
        s += weights[t] * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * x.len / avg));
        if (weights[t] === 1) hit++;
      });
      return { chunk: c, score: s, coverage: hit / qt.length };
    }).filter(function (r) { return r.score > 0; });
    scored.sort(function (a, b2) { return b2.score - a.score; });
    var minCov = qt.length === 1 ? 1 : qt.length === 2 ? 0.5 : 0.4;
    var good = scored.filter(function (r) { return r.coverage >= minCov; });
    return good.slice(0, n || 3).map(function (r) {
      r.excerpt = snippet({ text: r.chunk.t }, qt, 3);
      if (r.excerpt.length > 420) r.excerpt = r.excerpt.slice(0, 417).replace(/\s+\S*$/, "") + "…";
      return r;
    });
  }

  return { build: build, search: search, snippet: snippet, tokens: tokens, intent: intent, docSearch: docSearch, passageSearch: passageSearch };
});
