(function () {
  "use strict";

  var D = window.NBA_DATA;
  var T = D.teams;
  var HOME_ADV = D.homeAdvantage;

  var $ = function (id) { return document.getElementById(id); };
  var awaySel = $("away");
  var homeSel = $("home");

  // 球季進行中：資料帶有模型參數時，預測只用本季已打的比賽（不用上季表現；參數見 build_data.py 的 MODEL）
  var MODEL = D.mode === "in_season" && D.model ? D.model : null;

  // 開盤冷門觀察名單（實驗功能，build_data.py 規則 v1 往後記錄；檔案不存在就是空的，網頁照常）：每筆 { d 台灣日期, t, a, h, side "a"/"h" 被選那隊, od 賠率, mp 模型勝率, qp 市場勝率, w 勝負, qc 收盤市場勝率, clv }
  var UPSETS = window.NBA_UPSETS && window.NBA_UPSETS.picks ? window.NBA_UPSETS.picks : [];
  var UPSET_BY = {};
  UPSETS.forEach(function (u) { UPSET_BY[u.d + "|" + u.a + "|" + u.h] = u; });
  var SCHEDULE = window.NBA_SCHEDULE || null;  // 賽程（球季進行中才有，build_data.py 產生；日期與時間都是台灣時間）
  var ABBR = {};  // 縮寫 -> 球隊 key；網址和賽程都用縮寫
  Object.keys(T).forEach(function (k) { ABBR[T[k].abbr] = k; });
  var neutral = false;   // 目前這場是不是中立場地（從賽程點進來才可能是）；中立場地不加主場優勢
  var fromDate = null;   // 從哪一天的賽程點進來的（用來顯示「回到賽程」）
  var PRE = D.pre || null;  // 最近一個比賽日「開打之前」的球隊數據（build_data.py 產生），給已完賽的比賽看賽前預測
  var PRE_DAYS = D.preDays || {};  // 更早的比賽日各自「開打之前」的球隊數據（只有預測公式要用的欄位），給賽程卡片顯示賽前預測，不能點進去
  var pregame = false;      // 目前是不是在看一場已完賽比賽（固定頁面：賽前預測、賽前數據、當時盤口，不能換隊）
  var finalGame = null;     // 上面那場已完賽比賽在賽程裡的資料（pregame 為 true 時才有）

  // ---------- 依資料模式切換的文字 ----------
  // D.mode："preseason" = 拿上一季整季數據當賽季前預測；"in_season" = 球季進行中，用本季已打的比賽
  var MODE = D.mode === "in_season" ? "in_season" : "preseason";
  var N_GAMES = D.games.toLocaleString("en-US");
  var COPY = {
    preseason: {
      title: "NBA 賽季前對戰預測",
      notice: "目前使用 " + D.season + " 例行賽的數據（凍結在 " + D.asOf + "），當作 " + D.nextSeason +
        " 開季前的預測，所以準確度有限：賽季前預估的勝負命中率約 60%。" +
        "（66.5% 是賽季中、用本季累積數據的回測數字，不適用於賽季前預測。）新球季開打後，數據會更新。",
      statsTitle: "上季數據對照",
      l10note: "上季季末",
      h2hTitle: D.season + " 例行賽兩隊對戰 ",
      sources: ["Basketball-Reference.com"],
      foot: "整理自 " + D.season + " 例行賽 " + N_GAMES + " 場"
    },
    in_season: {
      title: "NBA 勝負預測",
      notice: "",  // 球季進行中不顯示說明框（資料更新到哪天，頁尾會寫）
      statsTitle: D.season + " 本季數據對照",
      recLabel: "本季戰績",
      l10note: "",
      h2hTitle: D.season + " 例行賽兩隊對戰 ",
      sources: ["ESPN"].concat(D.h2hPrev ? ["Basketball-Reference.com"] : []),
      foot: "整理自 " + D.season + " 例行賽已完成的 " + N_GAMES + " 場"
    }
  }[MODE];
  COPY.recLabel = COPY.recLabel || "整季戰績";

  // ---------- 預測公式（與舊專案 api.py 完全一致） ----------
  // ha = 主場優勢（分）；不給就用預設，中立場地傳 0
  function predictPace(a, h, ha) {
    var avg = (a.pace + h.pace) / 2;
    return {
      away: (a.off / a.pace * avg + h.def / h.pace * avg) / 2,
      home: (h.off / h.pace * avg + a.def / a.pace * avg) / 2 + (ha == null ? HOME_ADV : ha)
    };
  }

  // ---------- 近況預測（球季進行中）：用近 10 場的 PACE 法 ----------
  // 和賽季前的 PACE 法同一個公式，只是改用「近 10 場」（不滿 10 場就用已打場數）的得失分，PACE 用本季累積值：
  // 兩隊得失分交叉配對 -> 各除以自己的 PACE（變成每回合得分）-> 乘上預估 PACE（兩隊 PACE 的平均）-> 主隊 +1
  function predictLast10(a, h, ha) {
    var avg = (a.pace + h.pace) / 2;
    return {
      away: (a.l10off / a.pace * avg + h.l10def / h.pace * avg) / 2,
      home: (h.l10off / h.pace * avg + a.l10def / a.pace * avg) / 2 + (ha == null ? HOME_ADV : ha)
    };
  }

  // ---------- 球季進行中的預測（只用本季已打的比賽） ----------
  // 球隊評分 = SRS（考慮對手強弱的評分，每場比賽越近權重越高）＋ 上季評分當開季起點，由 build_data.py 算好放在 t.rating
  // （舊資料檔沒有 rating 時退回舊公式：整季、近 10 場的淨勝分各往平均拉回，按 recentWeight 混合）
  // 預測分差 = 主隊評分 - 客隊評分 + 主場優勢（完整分差，不像 PACE 法把分差砍半，所以主場是 2 分不是 1 分）
  // 預測總分 = 兩隊場均得失分直接平均（整季至今與近 10 場按同樣比例混合，不用 PACE）；
  // 再用 主隊 = 總分/2 + 分差/2 拆成兩隊比分
  function shrunk(n, net) { return n * net / (n + MODEL.shrinkK); }

  function rating(t) {
    if (typeof t.rating === "number") return t.rating;  // build_data.py 算好的 SRS 球隊評分（考慮對手強弱＋上季當開季起點）
    var w = MODEL.recentWeight;  // 舊資料檔沒有 rating 欄位時，退回舊公式
    return (1 - w) * shrunk(t.gp, t.net) + w * shrunk(Math.min(10, t.gp), t.net10);
  }

  // adj = { a: 客隊扣分, h: 主隊扣分, t: 總分調整 }（點數）；扣分（傷病、連兩天）扣在預測分差上：新分差 = 原分差 - 主隊扣分 + 客隊扣分，總分不變；
  // t 是兩隊歷史對戰節奏調整，只加在預測總分上、不動分差
  function predictSeason(a, h, ha, adj) {
    var w = MODEL.recentWeight;
    var totalSeason = (a.off + h.def) / 2 + (h.off + a.def) / 2;
    var totalRecent = (a.l10off + h.l10def) / 2 + (h.l10off + a.l10def) / 2;
    var total = (1 - w) * totalSeason + w * totalRecent + (adj && adj.t ? adj.t : 0);  // adj.t = 兩隊歷史對戰節奏調整（只動總分）
    var margin = rating(h) - rating(a) + (ha == null ? MODEL.homeAdv : ha) - (adj ? adj.h - adj.a : 0);
    return { away: total / 2 - margin / 2, home: total / 2 + margin / 2 };
  }

  // ---------- 下拉選單 ----------
  function fillSelect(sel) {
    var groups = { E: "東區", W: "西區" };
    Object.keys(groups).forEach(function (conf) {
      var og = document.createElement("optgroup");
      og.label = groups[conf];
      Object.keys(T)
        .filter(function (k) { return T[k].conf === conf; })
        .sort(function (x, y) { return T[x].zh.localeCompare(T[y].zh, "zh-Hant"); })
        .forEach(function (k) {
          var o = document.createElement("option");
          o.value = k;
          o.textContent = T[k].zh + "（" + T[k].abbr + "）";
          og.appendChild(o);
        });
      sel.appendChild(og);
    });
  }

  // ---------- 畫面 ----------
  // 本季 0 場的球隊沒有場均數據（資料裡是 null），顯示「—」
  function f1(n) { return n == null ? "—" : n.toFixed(1); }

  // 隊徽文字色：白字對比（WCAG 相對亮度公式）不到 4.5 就改黑字
  function badgeTextColor(hex) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return 1.05 / (lum + 0.05) >= 4.5 ? "#fff" : "#000";
  }

  // 連勝 / 連敗：3 場起才在隊徽上方標出來；連勝橘色 🔥、連敗藍色 🧊
  var STREAK_MIN = 3;
  function streakText(t) {
    if (t.streak >= STREAK_MIN) return "🔥 " + t.streak + " 連勝";
    if (t.lstreak >= STREAK_MIN) return '<span class="cold">🧊 ' + t.lstreak + " 連敗</span>";
    return "";
  }

  // streak：undefined = 不留位置；字串 = 隊徽上方那一行（空字串留空白，讓兩隊的隊徽仍然對齊）
  function teamBlock(t, role, score, isWinner, streak) {
    var el = document.createElement("div");
    el.className = "team" + (isWinner ? " winner" : "");
    el.innerHTML =
      (streak === undefined ? "" : '<div class="streak">' + (streak || "&nbsp;") + "</div>") +
      '<span class="badge" style="background:' + t.color + ";color:" + badgeTextColor(t.color) + '">' + t.abbr + "</span>" +
      '<div class="name">' + t.zh + "</div>" +
      '<div class="role">' + role + "</div>" +
      '<div class="score">' + (typeof score === "string" ? score : f1(score)) + "</div>";  // 傳字串就原樣顯示（實際比分是整數）
    return el;
  }

  function setBlock(id, node) {
    var host = $(id);
    host.replaceWith(node);
    node.id = id;
  }

  // ---------- 數據對照：球隊名稱與數字用隊色，較優的一方加皇冠 ----------
  function hexToRgb(hex) {
    return [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
  }

  function luminance(rgb) {  // WCAG 相對亮度
    var c = rgb.map(function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // 隊色直接當文字色，有些顏色在卡片底色上會看不清楚（深色底上的深藍、淺色底上的亮黃）：
  // 對比不到 4.5 就往白色（深色底）或黑色（淺色底）一步步調整，直到看得清楚，色相不變
  // minRatio 預設 4.5（文字用）；比例條這種色塊只要和底色分得開就好，傳比較小的值（金黃色才不會被壓成咖啡色）
  function readableOn(hex, bg, minRatio) {
    var need = minRatio || 4.5;
    var c = hexToRgb(hex);
    var bgL = luminance(bg);
    var target = bgL < 0.5 ? [255, 255, 255] : [0, 0, 0];
    for (var p = 0; p <= 1.0001; p += 0.05) {
      var m = c.map(function (v, i) { return Math.round(v + (target[i] - v) * p); });
      var l = luminance(m);
      if ((Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05) >= need) return "rgb(" + m.join(",") + ")";
    }
    return "rgb(" + target.join(",") + ")";
  }

  function cardBackground() {
    var m = getComputedStyle($("stats-title").parentNode).backgroundColor.match(/\d+/g);
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  }

  // 比較兩邊的數字，回傳較優的一方："a"（客隊）、"h"（主隊），一樣或無法比較回傳 null
  function betterHigh(x, y) { return x > y ? "a" : (y > x ? "h" : null); }
  function betterLow(x, y) { return x < y ? "a" : (y < x ? "h" : null); }
  function betterRecord(ra, rh) {  // "7-1" 對 "3-4"：比勝率；其中一隊 0 場、或勝率一樣都不給皇冠
    var pa = ra.split("-").map(Number), ph = rh.split("-").map(Number);
    var ta = pa[0] + pa[1], th = ph[0] + ph[1];
    if (!ta || !th) return null;
    return betterHigh(pa[0] * th, ph[0] * ta);
  }

  // "53-29" 的小字：勝率 "64.6%"
  function rateSub(rec) {
    var p = rec.split("-");
    var w = Number(p[0]);
    var total = w + Number(p[1]);
    return '<span class="rate">' + (total ? (w / total * 100).toFixed(1) + "%" : "—") + "</span>";
  }

  // 一格數據：數字（隊色）+ 較優的加皇冠 + 小字
  function statCell(main, sub, crown, color) {
    return '<td style="color:' + color + '">' + main +
      (crown ? ' <span class="crown" role="img" aria-label="較優" title="較優">👑</span>' : "") + (sub || "") + "</td>";
  }

  // 實力評分格："+8.4" 加一行小字「已打 8 場」
  function ratingText(t) {
    var r = rating(t);
    return (r >= 0 ? "+" : "") + f1(r);
  }

  // 某一份交手資料（本季或上季）裡，客隊 a 和主隊 h 的對戰；沒有交手就回傳空字串
  function h2hBlock(data, title, a, h) {
    var pair = [a.abbr, h.abbr].sort();
    var meetings = data[pair[0] + "-" + pair[1]] || [];
    if (!meetings.length) return "";
    var awayFirst = a.abbr === pair[0];
    var awayWins = 0;
    var lines = meetings.map(function (m) {
      var ap = awayFirst ? m[0] : m[1];
      var hp = awayFirst ? m[1] : m[0];
      if (ap > hp) awayWins++;
      // 贏的那一側（隊名 + 分數）調亮，輸的那側維持暗灰色
      return '<div class="h2h-game"><span' + (ap > hp ? ' class="h2h-win"' : "") + ">" + a.zh + " " + ap + "</span> : <span" +
        (hp > ap ? ' class="h2h-win"' : "") + ">" + hp + " " + h.zh + "</span></div>";
    });
    return '<div class="h2h-block"><div class="h2h-title">' + title + meetings.length + " 場：" + a.zh + " " +
      awayWins + " 勝 " + (meetings.length - awayWins) + " 敗</div>" + lines.join("") + "</div>";
  }

  function winnerOf(p) { return p.home >= p.away ? "home" : "away"; }

  // 預測信心：看大比分（①實力評分法）兩隊比分各四捨五入到 0.1 之後的分差（取絕對值），門檻讓三個等級的場數大約各占三分之一
  // （三季回測、含傷病扣分的預測分差）：0 ~ 3.5 分 低信心 ／ 3.6 ~ 8.0 分 中信心 ／ 8.1 分以上 高信心（猜對率見 README）
  function confidenceOf(p) {
    var gap = Math.round(Math.abs(Number(f1(p.home)) - Number(f1(p.away))) * 10) / 10;
    if (gap <= 3.5) return { key: "low", label: "低信心" };
    if (gap <= 8.0) return { key: "mid", label: "中信心" };
    return { key: "high", label: "高信心" };
  }

  function confHtml(p) {  // 帶顏色的信心字樣：高 = 綠、中 = 橘、低 = 紅
    var c = confidenceOf(p);
    return '<span class="conf conf-' + c.key + '">' + c.label + "</span>";
  }

  // 球季進行中：兩個分數與「兩種模式方向是否一致」（賽程列表和對戰畫面共用）；neutral 時不加主場優勢
  // 傷病扣分（資料由 build_data.py 寫進賽程，11/8 起的比賽才有；已開賽的比賽凍結在開賽前最後一次更新）
  // 連兩天（back-to-back）：build_data.py 在賽程裡標 b = "a" / "h" / "ah"（客隊 / 主隊 / 兩隊都是前一天也有比賽），每隊扣 SCHEDULE.b2bDeduct 分，一樣只動分差、不動總分
  function gameAdj(g) {  // 這場比賽的扣分 { a, h }（傷病 + 連兩天）；沒人被扣回傳 null
    if (!g) return null;
    var d = (SCHEDULE && SCHEDULE.b2bDeduct) || 0, b = g.b || "";
    var a = (g.ja || 0) + (b.indexOf("a") >= 0 ? d : 0), h = (g.jh || 0) + (b.indexOf("h") >= 0 ? d : 0), t = g.pt || 0;
    return a || h || t ? { a: a, h: h, t: t } : null;
  }
  function b2bNote(a, h, g) {  // 預測頁「連兩天」那行字：哪隊昨天也有比賽；沒有回傳空字串
    var b = (g && g.b) || "", list = [];
    if (b.indexOf("a") >= 0) list.push(a.zh);
    if (b.indexOf("h") >= 0) list.push(h.zh);
    return list.join("、");
  }
  function matchAdj(a, h) {  // 自選對戰：有這組的下一場賽程就用那場（和賽程上的預測一致），沒有就用兩隊「現在」的缺陣扣分
    var ug = upcomingGameOf(a.abbr, h.abbr);
    if (ug) return gameAdj(ug);
    var inj = SCHEDULE && SCHEDULE.inj;
    return inj && (inj[a.abbr] || inj[h.abbr]) ? { a: inj[a.abbr] || 0, h: inj[h.abbr] || 0 } : null;
  }
  function adjNote(a, h, g) {  // 預測頁「已納入傷病」那行字；沒人被扣回傳空字串
    var list = [];
    if (g) {
      (g.jp || []).forEach(function (x) { list.push([x[0] === "a" ? a : h, x[1], x[2]]); });
    } else if (SCHEDULE && SCHEDULE.injn) {
      [a, h].forEach(function (t) { (SCHEDULE.injn[t.abbr] || []).forEach(function (x) { list.push([t, x[0], x[1]]); }); });
    }
    return list.map(function (x) { return x[0].zh + " " + x[1]; }).join("、");
  }

  function compareModels(a, h, isNeutral, adj) {
    var ha = isNeutral ? 0 : null;
    var p1 = predictSeason(a, h, ha, adj);
    var p2 = predictLast10(a, h, ha);
    return { p1: p1, p2: p2, w1: winnerOf(p1), w2: winnerOf(p2), same: winnerOf(p1) === winnerOf(p2) };
  }

  // 賽程裡已完賽的那一場（台灣日期 date；網址沒帶日期就當作最近一個比賽日）；找不到就回傳 null
  function findFinal(aAbbr, hAbbr, date) {
    if (!SCHEDULE || !PRE) return null;
    var d = isDate(date) ? date : PRE.date;
    for (var i = 0; i < SCHEDULE.games.length; i++) {
      var g = withLive(SCHEDULE.games[i]);
      if (g.s === "F" && g.d === d && g.a === aAbbr && g.h === hAbbr && preGameInfo(g)) return g;
    }
    return null;
  }

  // 某場已完賽比賽「開打之前」的球隊數據：最近一個比賽日在 PRE，更早的在 PRE_DAYS
  function snapshotOf(g) { return g.live ? T : g.d === PRE.date ? PRE.teams : PRE_DAYS[g.d]; }

  // ESPN 說「打完了」、但我們的資料檔還沒更新的比賽：先記下最終比分，畫面上當成已完賽處理（賽前預測用目前的球隊數據算，因為這場還沒算進去）
  // 更新資料之後這些比賽在賽程裡就是正式的已完賽，這份暫存就用不到了
  var liveFinals = {};  // "日期|客隊|主隊" -> { as, hs }
  function withLive(g) {
    var f = liveFinals[g.d + "|" + g.a + "|" + g.h];
    if (!f || (g.s !== "S" && g.s !== "L")) return g;
    return Object.assign({}, g, { s: "F", as: f.as, hs: f.hs, ot: f.ot, live: true });
  }

  function render() {
    var aKey = awaySel.value;
    var hKey = homeSel.value;
    var hint = $("hint");
    var result = $("result");
    $("neutral-note").hidden = !neutral;
    $("odds-card").hidden = true;  // 盤口等這次預測算完、確定有這場比賽才會再打開
    $("vote-card").hidden = true;  // 投票卡片也一樣，算完才打開
    $("inj-card").hidden = true;   // 傷病名單也一樣
    $("players-card").hidden = true;  // 得分前三球員也一樣
    $("picker").hidden = pregame;  // 已完賽的比賽是固定頁面，不能換隊
    $("board-card").hidden = pregame;
    $("pre-board").hidden = !pregame;
    $("final-board").hidden = !pregame;
    // 看已完賽比賽時，整頁都用「那天開打之前」的數據（隊名、隊色照常從球隊總表拿）
    var snap = pregame ? snapshotOf(finalGame) : null;
    var src = pregame ? { } : T;
    if (snap) { src[aKey] = Object.assign({}, T[aKey], snap[aKey]); src[hKey] = Object.assign({}, T[hKey], snap[hKey]); }

    if (aKey === hKey) {
      hint.textContent = "客隊和主隊不能是同一支球隊，請重新選擇。";
      hint.hidden = false;
      result.hidden = true;
      return;
    }
    var a = src[aKey];
    var h = src[hKey];
    // 本季 0 場的球隊沒有任何數據可算（球季進行中才會發生）
    var noGames = [a, h].filter(function (t) { return !t.gp; }).map(function (t) { return t.zh; });
    if (noGames.length) {
      hint.textContent = noGames.join("、") + " 本季尚未出賽，暫時無法預測。";
      hint.hidden = false;
      result.hidden = true;
      return;
    }
    hint.hidden = true;

    var adjGame = !MODEL ? null : pregame ? finalGame : upcomingGameOf(a.abbr, h.abbr);  // 傷病扣分來自這場比賽的賽程資料；沒有對應賽程（自選）就用兩隊現在的缺陣
    var cmp = MODEL ? compareModels(a, h, neutral, adjGame ? gameAdj(adjGame) : matchAdj(a, h)) : null;
    var injText = MODEL ? adjNote(a, h, adjGame) : "";
    var noteEl = $("inj-adj-note"), b2bText = MODEL ? b2bNote(a, h, adjGame) : "";
    noteEl.textContent = injText ? (adjGame && adjGame.jb ? "事後回補傷病：" : "已納入傷病：") + injText : "";
    if (b2bText) {  // 連兩天另起一行（隊名是固定的中文名，用文字節點塞進去）
      if (injText) noteEl.appendChild(document.createElement("br"));
      noteEl.appendChild(document.createTextNode("back-to-back：" + b2bText));
    }
    noteEl.hidden = !injText && !b2bText;
    var pace = MODEL ? cmp.p1 : predictPace(a, h, neutral ? 0 : null);
    var wPace = winnerOf(pace);

    // 主記分板
    // 任一隊連勝（或連敗）3 場以上，兩隊都留出隊徽上方那一行（沒連勝的留白），隊徽才不會一高一低
    var showStreak = !pregame && (!!streakText(a) || !!streakText(h));
    setBlock("board-away", teamBlock(a, "客隊", pace.away, wPace === "away", showStreak ? streakText(a) : undefined));
    setBlock("board-home", teamBlock(h, "主隊", pace.home, wPace === "home", showStreak ? streakText(h) : undefined));
    var winTeam = wPace === "home" ? h : a;
    var diff = Math.abs(pace.home - pace.away);
    $("verdict-tag").textContent = winTeam.zh + " 勝";
    // 球季進行中不顯示「預測分差、總分」那一行（賽季前模式照舊）
    $("board-margin").hidden = !!MODEL;
    $("board-margin").textContent = "預測分差 " + f1(diff) + " 分，總分 " + f1(pace.home + pace.away) + " 分";

    // 預測信心（只有球季進行中才有）；②近況預測仍會算（compareModels），只是不顯示
    var alt = $("alt");
    alt.hidden = !MODEL;
    if (MODEL) {
      alt.innerHTML = '<div class="alt-title">預測信心</div><div class="alt-line">' + confHtml(cmp.p1) + "</div>";
    }
    // 已完賽的固定頁面：上面那塊換成「賽前預測 比分 信心」
    if (pregame) {
      // 第一張卡：實際比分（隊徽、隊名、大比分，贏的一方綠色）
      setBlock("final-away", teamBlock(a, "客隊", String(finalGame.as), finalGame.as > finalGame.hs));
      setBlock("final-home", teamBlock(h, "主隊", String(finalGame.hs), finalGame.hs > finalGame.as));
      $("final-board").querySelector(".tag").textContent = finalLabel(finalGame);
      $("final-q").innerHTML = quarterTable(a, h, finalGame);
      $("final-q").hidden = !finalGame.q;
      // 第二張卡：賽前預測、信心、各選項對錯
      $("pre-board").innerHTML = '<div class="pre-title">賽前預測</div>' +
        '<div class="pre-score">' + a.zh + " " + f1(cmp.p1.away) + " : " + f1(cmp.p1.home) + " " + h.zh + "</div>" +
        '<div class="pre-conf">' + confHtml(cmp.p1) + "</div>";
    }

    // 交手紀錄（以客隊為主視角）；球季進行中除了本季，還附上上季的交手（只供參考，不進預測）
    var blocks = [h2hBlock(D.h2h, COPY.h2hTitle, a, h)];
    if (MODEL && D.h2hPrev) blocks.push(h2hBlock(D.h2hPrev, D.prevSeason + " 例行賽兩隊對戰 ", a, h));
    blocks = blocks.filter(Boolean);
    $("h2h").innerHTML = blocks.join("");
    $("h2h").hidden = !blocks.length;

    // 數據對照
    var bg = cardBackground();
    var aColor = readableOn(a.color, bg);
    var hColor = readableOn(h.color, bg);
    $("s-away").textContent = a.zh;
    $("s-home").textContent = h.zh;
    $("s-away").style.color = aColor;
    $("s-home").style.color = hColor;
    var l10note = COPY.l10note ? '<span class="row-note">' + COPY.l10note + "</span>" : "";
    // 每列：[列名, 客隊數字, 客隊小字, 主隊數字, 主隊小字, 較優的一方（null = 不放皇冠）]
    var rows = [];
    if (MODEL) {
      rows.push(["實力評分", ratingText(a), '<span class="rate">已打 ' + a.gp + " 場</span>",
        ratingText(h), '<span class="rate">已打 ' + h.gp + " 場</span>", betterHigh(Number(f1(rating(a))), Number(f1(rating(h))))]);
    }
    var rec = function (label, ra, rh) { return [label, ra, rateSub(ra), rh, rateSub(rh), betterRecord(ra, rh)]; };
    rows.push(rec(COPY.recLabel, a.w + "-" + a.l, h.w + "-" + h.l));
    rows.push(rec("主場戰績", a.home, h.home));
    rows.push(rec("客場戰績", a.road, h.road));
    rows.push(["場均得分", f1(a.off), "", f1(h.off), "", betterHigh(a.off, h.off)]);
    rows.push(["場均失分", f1(a.def), "", f1(h.def), "", betterLow(a.def, h.def)]);  // 失分越少越好
    rows.push([MODEL ? "PACE（本季）" : "PACE", f1(a.pace), "", f1(h.pace), "", null]);  // 節奏快慢沒有好壞
    rows.push(rec("近 10 場戰績" + l10note, a.l10rec, h.l10rec));
    rows.push(["近 10 場得分" + l10note, f1(a.l10off), "", f1(h.l10off), "", betterHigh(a.l10off, h.l10off)]);
    rows.push(["近 10 場失分" + l10note, f1(a.l10def), "", f1(h.l10def), "", betterLow(a.l10def, h.l10def)]);
    $("stats-body").innerHTML = rows.map(function (r) {
      return "<tr>" + statCell(r[1], r[2], r[5] === "a", aColor) + "<td>" + r[0] + "</td>" +
        statCell(r[3], r[4], r[5] === "h", hColor) + "</tr>";
    }).join("");

    result.hidden = false;
    showMatchVote(dayIdx >= 0 ? dayList[dayIdx] : null, fromDate);  // 從賽程點進來的比賽才有投票
    if (!pregame) renderPlayers(aKey, hKey, a, h, aColor, hColor);   // 得分前三球員：已完賽的固定頁面不顯示
    if (!pregame) renderInjuries(aKey, hKey, a, h, aColor, hColor);  // 傷病名單：已完賽的固定頁面不顯示
    if (MODEL) {
      if (pregame) showRecordedOdds(a, h, aColor, hColor, cmp.p1);
      else renderOdds(aKey, hKey, a, h, aColor, hColor);
    }
  }

  // ---------- 現在的盤口（DraftKings，經 ESPN 轉載；打開頁面時即時抓，不寫進資料檔） ----------
  // 單隊總分查不到莊家實際開的盤口，這裡用「讓分 + 總分」推算：主隊 = 總分/2 - 主隊讓分/2，客隊 = 總分/2 + 主隊讓分/2
  var ESPN_SB = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=";
  var ESPN_NAME_FIX = { "LA Clippers": "Los Angeles Clippers" };
  var oddsCache = {};   // 日期 ->{ t: 抓取時間, p: Promise(events) }；60 秒內重用，不重複打 ESPN
  var oddsToken = 0;    // 切換球隊很快時，只畫最後一次的結果

  function upcomingGameOf(aAbbr, hAbbr) {  // 賽程裡這組客隊/主隊「還沒打完」的下一場
    if (!SCHEDULE) return null;
    for (var i = 0; i < SCHEDULE.games.length; i++) {
      var g = SCHEDULE.games[i];
      if ((g.s === "S" || g.s === "L") && g.a === aAbbr && g.h === hAbbr) return g;
    }
    return null;
  }

  function fetchScoreboard(day, ttl) {  // day = 美東日期 "2026-11-05"；ESPN 不接受日期範圍，一天抓一次；ttl = 幾毫秒內重用上次的結果（預設 60 秒，即時比分用 20 秒）
    var key = day.replace(/-/g, "");
    var hit = oddsCache[key];
    if (hit && Date.now() - hit.t < (ttl == null ? 60000 : ttl)) return hit.p;
    var p = fetch(ESPN_SB + key).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) { return j.events || []; });
    oddsCache[key] = { t: Date.now(), p: p };
    p["catch"](function () { delete oddsCache[key]; });
    return p;
  }

  function lineNum(s) {  // "+1.5" -> 1.5、"o222.5" -> 222.5、"EVEN" / "PK" -> 0；看不懂回傳 null
    if (s == null) return null;
    if (/^(even|pk)/i.test(String(s))) return 0;
    var n = parseFloat(String(s).replace(/^[ou]/i, ""));
    return isNaN(n) ? null : n;
  }

  // 畫盤口卡片：homeLine = 主隊讓分（負 = 主隊讓分），totalLine = 總分；note = 卡片外的兩行小字
  // 單隊總分：由讓分與總分推算，再調成 .5 結尾（x.0 進位到 x.5，例如 112.0 -> 112.5）；順序是 讓分、單隊總分、總分
  // res = 已完賽比賽的實際比分 { as, hs }：有的話，讓分打 ✅ 在讓分過關的那一邊，單隊總分與總分打 ⬆️（大）/ ⬇️（小）；剛好打平盤的不標
  function sgn(v) { return (v > 0 ? "+" : "") + f1(v); }          // 讓分顯示：+1.5 / -1.5
  function half(v) { return f1(Math.floor(v) + 0.5); }             // 單隊總分調成 .5 結尾（x.0 進位到 x.5）

  function drawOdds(a, h, aColor, hColor, homeLine, totalLine, note, res) {
    var UP = " ⬆️", DOWN = " ⬇️", OK = " ✅";
    var overUnder = function (actual, line) { return actual > line ? UP : actual < line ? DOWN : ""; };
    var rows = "";
    if (homeLine != null) {
      var cover = res ? (res.hs - res.as + homeLine) : 0;  // > 0 主隊讓分過關（受讓方贏盤），< 0 客隊過關
      rows += "<tr><td>" + sgn(-homeLine) + (res && cover < 0 ? OK : "") + "</td><td>讓分</td><td>" +
        sgn(homeLine) + (res && cover > 0 ? OK : "") + "</td></tr>";
    }
    if (homeLine != null && totalLine != null) {
      var aTT = half(totalLine / 2 + homeLine / 2), hTT = half(totalLine / 2 - homeLine / 2);
      rows += "<tr><td>" + aTT + (res ? overUnder(res.as, Number(aTT)) : "") + "</td><td>單隊總分</td><td>" +
        hTT + (res ? overUnder(res.hs, Number(hTT)) : "") + "</td></tr>";
    }
    if (totalLine != null) {
      rows += '<tr><td colspan="3"><b>總分 ' + totalLine + (res ? overUnder(res.as + res.hs, totalLine) : "") + "</b></td></tr>";
    }
    if (!rows) return false;
    $("odds-body").innerHTML = '<div class="odds-title">' + (res ? "賭盤結果" : "賭盤") + '</div><table class="stats"><thead><tr><th style="color:' + aColor + '">' + a.zh +
      '</th><th></th><th style="color:' + hColor + '">' + h.zh + "</th></tr></thead><tbody>" + rows + "</tbody></table>";
    $("odds-note").innerHTML = note + "<br>非投注建議，娛樂參考 !";
    return true;
  }

  // 已完賽：把賽前預測拿去對盤口，每個選項對不對（讓分選哪一邊、單隊總分與總分選大或小）。
  // 預測比分用畫面上顯示的 0.1 位數；剛好等於盤口的不選、實際剛好打平盤的不標對錯
  // 各節得分表：第 1~4 節 + 延長賽（OT1、OT2…）+ 總分；每節得分比對手高的那格加粗，一眼看出哪一節誰佔上風
  // 已完賽卡片中間的字：打完四節 = 「已完賽」，有延長賽 = 「OT」（兩次延長 = 2OT、三次 = 3OT…）
  // 節數看各節得分表（q）；剛打完、資料還沒更新的比賽看 ESPN 回報的節數（ot）
  function finalLabel(g) {
    var n = g.q ? Math.max(g.q[0].length, g.q[1].length) - 4 : g.ot || 0;
    return n > 0 ? (n > 1 ? n : "") + "OT" : "已完賽";
  }

  function quarterTable(a, h, g) {
    if (!g.q) return "";
    var qa = g.q[0], qh = g.q[1], n = Math.max(qa.length, qh.length);
    var head = "<th></th>";
    for (var i = 0; i < n; i++) head += "<th>" + (i < 4 ? i + 1 : n > 5 ? "OT" + (i - 3) : "OT") + "</th>";
    head += "<th>總分</th>";
    function row(t, mine, other, total) {
      var cells = '<th class="q-team">' + t.zh + "</th>";
      for (var i = 0; i < n; i++) cells += "<td" + (mine[i] > other[i] ? ' class="q-win"' : "") + ">" + (mine[i] == null ? "-" : mine[i]) + "</td>";
      return "<tr>" + cells + '<td class="q-total">' + total + "</td></tr>";
    }
    return '<table class="q-table"><thead><tr>' + head + "</tr></thead><tbody>" +
      row(a, qa, qh, g.as) + row(h, qh, qa, g.hs) + "</tbody></table>";
  }

  function betPicksHtml(a, h, p, g) {
    if (g.sp == null || g.ou == null) return "";
    var mark = function (ok) { return ok === null ? "" : ok ? " ✅" : " ❌"; };
    var pa = Number(f1(p.away)), ph = Number(f1(p.home));
    var lines = [];
    var homePick = p.home >= p.away;  // 不讓分：預測勝方（和畫面上的預測勝負一致，平手算主隊）
    lines.push((homePick ? h.zh : a.zh) + " 勝" + mark((g.hs > g.as) === homePick));
    var cover = g.hs - g.as + g.sp;   // 實際：> 0 主隊過關，< 0 客隊過關
    var pick = ph - pa + g.sp;        // 預測：> 0 選主隊那邊，< 0 選客隊那邊
    if (pick !== 0) {
      lines.push((pick > 0 ? h.zh + " " + sgn(g.sp) : a.zh + " " + sgn(-g.sp)) + mark(cover === 0 ? null : (cover > 0) === (pick > 0)));
    }
    var overUnder = function (name, pred, line, actual) {
      if (pred === line) return;
      lines.push(name + " " + line + " " + (pred > line ? "大" : "小") + mark(actual === line ? null : (actual > line) === (pred > line)));
    };
    overUnder(a.zh, pa, Number(half(g.ou / 2 + g.sp / 2)), g.as);
    overUnder(h.zh, ph, Number(half(g.ou / 2 - g.sp / 2)), g.hs);
    overUnder("總分", pa + ph, g.ou, g.as + g.hs);
    return lines.map(function (t) { return "<div>" + t + "</div>"; }).join("");
  }

  function showOdds(a, h, aColor, hColor, o) {  // 即時盤口（ESPN 賽事列表的 odds）
    var ps = o.pointSpread, tot = o.total;
    var hl = ps && ps.home && ps.home.close;
    var ov = tot && tot.over && tot.over.close;
    var homeLine = hl ? lineNum(hl.line) : null;
    var totalLine = ov ? lineNum(ov.line) : (typeof o.overUnder === "number" ? o.overUnder : null);
    var hh = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16);
    return drawOdds(a, h, aColor, hColor, homeLine, totalLine, "經 ESPN 取得 DraftKings 的賭盤概況，台灣時間 " + hh + " 更新");
  }

  // 已完賽的比賽（最下面那張卡）：賽前預測拿去對收盤盤口，每個選項選哪邊、對不對（sp = 主隊讓分、ou = 總分；原始紀錄在 raw/odds_2026-27.json）
  function showRecordedOdds(a, h, aColor, hColor, p1) {
    ++oddsToken;  // 作廢還在路上的即時盤口
    var g = finalGame;
    var card = $("odds-card");
    if (!g || g.sp == null || g.ou == null) {
      card.hidden = true;
      return;
    }
    $("odds-body").innerHTML = '<div class="odds-title">賭盤結果</div><div class="odds-picks">' + betPicksHtml(a, h, p1, g) + "</div>";
    $("odds-note").innerHTML = "經 ESPN 取得 DraftKings 的賭盤概況，開賽前最後的盤口<br>非投注建議，娛樂參考 !";
    card.hidden = false;
  }

  // 這場開賽了嗎：進行中，或開賽時間（台灣時間）已經過了
  function gameStarted(g) {
    return g.s === "L" || Date.now() >= new Date(g.d + "T" + g.t + ":00+08:00").getTime();
  }

  function renderOdds(aKey, hKey, a, h, aColor, hColor) {
    var card = $("odds-card");
    var g = upcomingGameOf(a.abbr, h.abbr);
    var token = ++oddsToken;
    if (!g) { card.hidden = true; return; }
    // 更新資料時記下來的盤口（sp = 主隊讓分、ou = 總分）：ESPN 賽事列表一開賽就不給盤口了，開賽後就顯示這份，定案不再變動
    var hasRec = g.sp != null && g.ou != null;
    if (hasRec && gameStarted(g) &&
      drawOdds(a, h, aColor, hColor, g.sp, g.ou, "經 ESPN 取得 DraftKings 的賭盤概況，這場已開賽，盤口定案在開賽前最後記錄的數字")) {
      card.hidden = false;
      return;
    }
    $("odds-body").innerHTML = '<p class="odds-msg">載入中…</p>';
    $("odds-note").textContent = "";
    card.hidden = false;
    var fail = function (msg) {
      if (token !== oddsToken) return;
      // 即時盤口抓不到（還沒開出盤口、ESPN 暫時抓不到），有記下來的就先顯示那份
      if (hasRec && drawOdds(a, h, aColor, hColor, g.sp, g.ou, "經 ESPN 取得 DraftKings 的賭盤概況，目前抓不到即時盤口，這是最近一次記錄的盤口")) return;
      $("odds-body").innerHTML = '<p class="odds-msg">' + msg + "</p>";
      $("odds-note").textContent = "";
    };
    // 賽程日期是台灣日期，ESPN 用美東日期：台灣日期的前一天到當天一起抓，再用隊名對出這場
    Promise.all([fetchScoreboard(addDays(g.d, -1)), fetchScoreboard(g.d)]).then(function (days) {
      if (token !== oddsToken) return;
      var events = days[0].concat(days[1]);
      var ev = null;
      events.forEach(function (e) {
        var comp = e.competitions && e.competitions[0];
        if (!comp || e.status.type.name === "STATUS_FINAL") return;
        var names = {};
        comp.competitors.forEach(function (c) {
          var raw = c.team.displayName;
          names[c.homeAway] = ESPN_NAME_FIX[raw] || raw;
        });
        if (names.away === aKey && names.home === hKey) ev = comp;
      });
      var o = ev && ev.odds && ev.odds[0];
      if (!o) return fail("賭鬼 這場目前沒抓到賭盤 請晚點再來!!");
      if (!showOdds(a, h, aColor, hColor, o)) fail("賭鬼 這場目前沒抓到賭盤 請晚點再來!!");
    }, function () { fail("盤口暫時抓不到，稍後重新整理再試。"); });
  }

  // ---------- 每隊得分前三高的球員（build_data.py 用每場比賽的球員數據算出來，只收出賽過半的球員） ----------
  // 放在投票下面、本季數據對照上面；已完賽的固定頁面不顯示（那是現在的數字，不是當時的）
  var PLAYERS = window.NBA_PLAYERS && window.NBA_PLAYERS.teams ? window.NBA_PLAYERS.teams : null;

  function plStat(label, val, cls) {
    return '<div class="pl-st"><b' + (cls ? ' class="' + cls + '"' : "") + ">" + val + "</b><span>" + label + "</span></div>";
  }

  function playerCell(p, color) {
    if (!p) return '<div class="pl-cell pl-empty">—</div>';
    var pm = p.pm > 0 ? "+" + f1(p.pm) : f1(p.pm);
    return '<div class="pl-cell"><div class="pl-name" style="color:' + color + '">' + p.n + "</div>" +
      '<div class="pl-stats">' + plStat("得分", f1(p.pts)) + plStat("籃板", f1(p.reb)) + plStat("助攻", f1(p.ast)) +
      plStat("+/-", pm, p.pm > 0 ? "pos" : p.pm < 0 ? "neg" : "") + "</div></div>";
  }

  function renderPlayers(aKey, hKey, a, h, aColor, hColor) {
    var card = $("players-card");
    var pa = PLAYERS && PLAYERS[aKey] || [], ph = PLAYERS && PLAYERS[hKey] || [];
    if (!pa.length && !ph.length) { card.hidden = true; return; }
    var rows = "";
    for (var i = 0; i < 3; i++) {
      if (!pa[i] && !ph[i]) break;
      rows += '<div class="pl-row">' + playerCell(pa[i], aColor) + playerCell(ph[i], hColor) + "</div>";
    }
    card.innerHTML = '<div class="odds-title">得分前三球員</div>' +
      '<div class="pl-head"><span style="color:' + aColor + '">' + a.zh + '</span><span style="color:' + hColor + '">' + h.zh + "</span></div>" +
      rows;
    card.hidden = false;
  }

  // ---------- 傷病名單（ESPN；打開頁面時即時抓，不寫進資料檔） ----------
  // 11/8 起的預測有納入傷病（缺陣球員依場均得分分級扣分，見 build_data.py 的 apply_injury_adj）；這張卡片是現在的完整名單，
  // 放在賭盤上面給大家對照；已完賽的固定頁面不顯示（那是現在的名單，不是當時的）
  var ESPN_INJ = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";
  var injCache = null;  // { t: 抓取時間, p: Promise({ by: 球隊名 -> 傷病名單 }) }；5 分鐘內重用，不重複打 ESPN
  var injToken = 0;     // 切換球隊很快時，只畫最後一次的結果
  var INJ_PART = { Knee: "膝蓋", Toe: "腳趾", Hip: "髖部", Ankle: "腳踝", Foot: "腳掌", Eye: "眼睛", Illness: "生病", Undisclosed: "傷勢未公開",
    Leg: "腿", Shoulder: "肩膀", Thigh: "大腿", Quadriceps: "大腿前側", Hamstring: "大腿後側", Hand: "手", Heel: "腳跟", Back: "背部",
    Calf: "小腿", Achilles: "阿基里斯腱", Groin: "鼠蹊", Elbow: "手肘", Wrist: "手腕", Neck: "頸部", Rib: "肋骨", Finger: "手指",
    Head: "頭部", Chest: "胸部", Abdomen: "腹部", Forearm: "前臂", Ribs: "肋骨", Concussion: "腦震盪" };
  var INJ_KIND = { Inflammation: "發炎", Fracture: "骨折", Abrasion: "擦傷", Soreness: "痠痛", Bruise: "瘀傷", Sprain: "扭傷", Strain: "拉傷",
    Surgery: "手術", Spasms: "痙攣", Dislocated: "脫臼", "Pinched Nerve": "神經夾擠", Tightness: "緊繃", Tendinitis: "肌腱炎",
    Contusion: "挫傷", Tear: "撕裂", Laceration: "撕裂傷" };

  function fetchInjuries() {
    if (injCache && Date.now() - injCache.t < 300000) return injCache.p;
    var p = fetch(ESPN_INJ).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var by = {};
      (j.injuries || []).forEach(function (t) { by[ESPN_NAME_FIX[t.displayName] || t.displayName] = t.injuries || []; });
      return { by: by };
    });
    injCache = { t: Date.now(), p: p };
    p["catch"](function () { injCache = null; });
    return p;
  }

  // 這隊的下一個對手（中文隊名）：賽程裡今天（台灣）起第一場還沒打完的比賽；找不到回傳空字串
  function nextOpponent(abbr) {
    if (!SCHEDULE || !abbr) return "";
    var today = todayTW();
    for (var i = 0; i < SCHEDULE.games.length; i++) {
      var g = withLive(SCHEDULE.games[i]);
      if ((g.a !== abbr && g.h !== abbr) || (g.s !== "S" && g.s !== "L") || g.d < today || !g.a || !g.h) continue;
      var opp = T[ABBR[g.h === abbr ? g.a : g.h]];
      return opp ? opp.zh : "";
    }
    return "";
  }

  // 出賽狀態（賽前決定這一類），寫在「預計回歸」後面，例如「對公牛 出賽成疑」「對公牛 預計會出賽」：
  // ESPN 的傷病資料只分「缺陣 / 每日觀察」，更細的（出賽成疑、臨場決定…）只寫在傷病快訊文字裡，
  // 所以從快訊文字找關鍵字；只採用 2 天內的快訊，太舊的快訊講的不是下一場，不採用
  function injGameStatus(x, abbr) {
    var t = x.date ? Date.parse(x.date) : NaN;
    var opp = nextOpponent(abbr);
    if (isNaN(t) || Date.now() - t > 48 * 3600 * 1000 || !opp) return "";
    var rules = [[/game[- ]time decision/i, "臨場決定"], [/\bquestionable\b/i, "出賽成疑"],
      [/\bdoubtful\b/i, "不太可能出賽"], [/\bprobable\b/i, "預計會出賽"]];
    var texts = [x.shortComment || "", x.longComment || ""];
    for (var k = 0; k < texts.length; k++) {
      for (var r = 0; r < rules.length; r++) {
        if (rules[r][0].test(texts[k])) return "對" + opp + " " + rules[r][1];
      }
    }
    return "";
  }

  // ---------- 超級球星出賽狀態（賽程卡片、首頁賽程：下半部「模型勝率」條旁邊寫「誰 出賽成疑」或「誰 確定不出賽」） ----------
  // 條件：本季場均得分 >= 25（超級球星，和傷病扣分的等級同一個定義）、至少出賽 3 場，而且是 ESPN 傷病名單上的人：
  //   - 狀態「缺陣（Out）」→ 寫「確定不出賽」，但只寫「短期缺陣」：預計回歸日晚於這場比賽、而且不超過這場比賽之後 3 天；
  //     中長期缺陣（3 天內都不會打）的不寫（那是舊消息，傷病名單看得到）。傷病快訊（2 天內）寫 questionable 的除外，那時候寫「出賽成疑」，因為名單狀態可能還沒更新
  //   - 其他狀態，傷病快訊（2 天內）寫 questionable → 寫「出賽成疑」（判斷方式和傷病名單那張卡片一樣，見 injGameStatus）
  // 一隊最多寫 2 位（超過就取場均得分最高的 2 位）。只標在「這隊的下一場比賽」那張卡片上（快訊講的是下一場）；只標示、不扣分（缺陣的扣分另外算在預測分差裡）。
  // 名字是 ESPN 給的英文原文，一律用文字節點放進畫面
  var QSTAT = null;      // { 球隊縮寫: [{ n: 名字, k: "q" 出賽成疑 | "o" 缺陣, pts: 場均得分, ret: 預計回歸日（美國日期，缺陣才有） }] }；抓到傷病名單之後才有
  var qLoading = false;
  function nextGameOf(abbr) {  // 這隊今天（台灣）起第一場還沒打完的比賽
    if (!SCHEDULE || !abbr) return null;
    var today = todayTW();
    for (var i = 0; i < SCHEDULE.games.length; i++) {
      var g = withLive(SCHEDULE.games[i]);
      if ((g.a !== abbr && g.h !== abbr) || (g.s !== "S" && g.s !== "L") || g.d < today || !g.a || !g.h) continue;
      return g;
    }
    return null;
  }
  function loadQuestionable() {
    if (!MODEL || !SCHEDULE || QSTAT || qLoading) return;
    qLoading = true;
    fetchInjuries().then(function (res) {
      var q = {};
      Object.keys(res.by).forEach(function (teamName) {
        var team = T[teamName];
        if (!team || !team.gp) return;
        (res.by[teamName] || []).forEach(function (x) {
          var m = /\/id\/(\d+)\//.exec(JSON.stringify((x.athlete && x.athlete.links) || []));
          var ps = m ? playerStat(m[1]) : null;
          if (!ps || ps.pts < 25 || ps.gp < 3) return;
          var fresh = injGameStatus(x, team.abbr), kind = "";
          if (/出賽成疑$/.test(fresh)) kind = "q";
          else if (x.status === "Out") kind = "o";
          if (!kind) return;
          (q[team.abbr] = q[team.abbr] || []).push({ n: (x.athlete && x.athlete.displayName) || "?", k: kind, pts: ps.pts, ret: (x.details && x.details.returnDate) || "" });
        });
      });
      QSTAT = q;
      Array.prototype.forEach.call(document.querySelectorAll(".game[data-gk]"), decorateQuestionable);
    })["catch"](function () { qLoading = false; });
  }
  function shortName(n) {  // "Giannis Antetokounmpo" -> "G. Antetokounmpo"；12 個字元以內不縮
    var p = String(n).trim().split(/\s+/);
    return n.length <= 12 || p.length < 2 ? n : p[0].charAt(0) + ". " + p.slice(1).join(" ");
  }
  function decorateQuestionable(el) {  // 放在下半部「模型勝率」條的左邊（客隊）或右邊（主隊），寬度和球隊欄位一樣，不撐高兩側的球隊欄位
    var key = el.getAttribute("data-gk"), pred = el.querySelector(".game-pred");
    if (!key || !QSTAT || !pred || pred.querySelector(".gm-qn")) return;
    var p = key.split("|");
    [[p[1], "a"], [p[2], "h"]].forEach(function (s) {
      var list = QSTAT[s[0]], ng = list && nextGameOf(s[0]);
      if (!ng || ng.d !== p[0] || ng.a !== p[1] || ng.h !== p[2]) return;
      var gameET = addDays(p[0], -1);  // 這場比賽的美國日期（台灣日期 - 1 天）
      list = list.filter(function (x) {  // 缺陣的只留短期缺陣：預計回歸日晚於這場、而且不超過這場之後 3 天；沒有回歸日的不確定，不寫
        if (x.k !== "o") return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x.ret)) return false;
        var days = Math.round((Date.parse(x.ret) - Date.parse(gameET)) / 86400000);
        return days >= 1 && days <= 3;
      }).sort(function (x, y) { return y.pts - x.pts; }).slice(0, 2);  // 最多 2 位：場均得分最高的
      if (!list.length) return;
      var d = document.createElement("div");
      d.className = "gm-qn gm-qn-" + s[1];
      d.title = list.map(function (x) { return x.n + (x.k === "o" ? " 確定不出賽" : " 出賽成疑"); }).join("、");
      list.forEach(function (x, i) {
        if (i) d.appendChild(document.createElement("br"));
        d.appendChild(document.createTextNode(shortName(x.n)));  // 名字太長（超過 12 個字元）時，名字縮成第一個字母加句點
        d.appendChild(document.createElement("br"));
        var st = document.createElement("span");
        st.textContent = x.k === "o" ? "確定不出賽" : "出賽成疑";
        st.className = x.k === "o" ? "gm-qn-out" : "";
        st.style.whiteSpace = "nowrap";  // 這幾個字不拆開
        d.appendChild(st);
      });
      pred.appendChild(d);
      if (list.length > 1) pred.classList.add("gm-pred-q2");  // 兩位球員 = 四行字，下半部多留一點空間，字才不會蓋到上面的預測文字
    });
  }

  var SEASON_END_US = "2027-04-12";  // 2026-27 例行賽結束後的第一天（美國日期）；預計回歸日不早於這天就算整季報銷

  // 球員本季場均數據（data/player_tiers.js，ESPN 球員編號 -> {gp, mn, pts, reb, ast, pm}）；傷病名單每位球員名字下面顯示
  var PSTAT = null;
  function playerStat(pid) {
    var tr = window.NBA_PLAYER_TIERS;
    if (!tr) return null;
    if (!PSTAT) {
      PSTAT = {};
      Object.keys(tr.teams).forEach(function (t) { tr.teams[t].forEach(function (p) { PSTAT[p.id] = p; }); });
    }
    return PSTAT[pid] || null;
  }

  function injRow(x, abbr) {
    var d = x.details || {};
    var idm = /\/id\/(\d+)\//.exec(JSON.stringify((x.athlete && x.athlete.links) || []));  // ESPN 傷病資料的球員編號藏在連結裡
    var ps = idm ? playerStat(idm[1]) : null;
    var stat = ps && ps.mn >= 8 ? '<div class="inj-stat">得分 ' + f1(ps.pts) + " / 籃板 " + f1(ps.reb) + " / 助攻 " + f1(ps.ast) + " / " + sgn(ps.pm) +
      ' <span class="inj-gp">（' + ps.gp + " 場）</span></div>" : "";  // 場均上場時間不到 8 分鐘、或本季沒出賽過的人不提供數據
    var place = (d.side === "Left" ? "左" : d.side === "Right" ? "右" : "") + (INJ_PART[d.type] || d.type || "");
    var kind = d.detail && d.detail !== "Not Specified" ? (INJ_KIND[d.detail] || d.detail) : "";
    // ESPN 給的預計回歸是美國日期（指那天晚上的比賽）；美國晚上的比賽是台灣隔天，所以加 1 天換成台灣日期
    var tw = /^\d{4}-\d{2}-\d{2}$/.test(d.returnDate || "") ? addDays(d.returnDate, 1) : "";
    var ret = tw ? "預計 " + Number(tw.slice(5, 7)) + "/" + Number(tw.slice(8)) + " 回歸" : "";
    var st = x.status === "Out" ? '<span class="inj-st out">缺陣</span>' : x.status === "Day-To-Day" ? '<span class="inj-st dtd">每日觀察</span>' :
      '<span class="inj-st">' + (x.status || "") + "</span>";
    var pos = x.athlete && x.athlete.position && x.athlete.position.abbreviation;
    // 整季報銷：預計回歸日在例行賽結束之後（ESPN 對長期傷勢會填一個很遠的日期），或傷病快訊明說 season-ending / 剩下整季都缺席
    var seasonOut = (d.returnDate || "") >= SEASON_END_US ||
      /season-ending|rest of the (2026-27 )?season|miss the (entire |rest of the )?(2026-27 )?season|remainder of the season|out for the (season|year)/i.test((x.shortComment || "") + " " + (x.longComment || ""));
    st += seasonOut ? '<span class="inj-season">整季報銷</span>' : "";
    return '<li><div class="inj-who"><span class="inj-nm"><b>' + ((x.athlete && x.athlete.displayName) || "?") + "</b>" + (pos ? " <span class=\"inj-pos\">" + pos + "</span>" : "") +
      "</span> " + st + "</div>" + stat + '<div class="inj-what">' + [place + kind, ret, injGameStatus(x, abbr)].filter(Boolean).join("・") + "</div></li>";
  }

  // 傷病名單：全部列出，排序依本季場均得分由高到低（本季沒出賽過、沒有場均得分的排最後）；得分一樣就缺陣在前、每日觀察其次，再依名字
  function injSorted(list) {
    var order = { "Out": 0, "Day-To-Day": 1 };
    var rank = function (x) { return order[x.status] != null ? order[x.status] : 2; };
    var ppg = function (x) {
      var m = /\/id\/(\d+)\//.exec(JSON.stringify((x.athlete && x.athlete.links) || []));
      var ps = m ? playerStat(m[1]) : null;
      return ps ? ps.pts : -1;
    };
    var name = function (x) { return (x.athlete && x.athlete.displayName) || ""; };
    return (list || []).slice().sort(function (x, y) {
      return ppg(y) - ppg(x) || rank(x) - rank(y) || name(x).localeCompare(name(y));
    });
  }

  function renderInjuries(aKey, hKey, a, h, aColor, hColor) {
    var card = $("inj-card");
    var token = ++injToken;
    var head = '<div class="odds-title">🚑 傷病名單</div><p class="inj-warn">11/8 開始有納入傷病</p>';
    card.innerHTML = head + '<p class="odds-msg">載入中…</p>';
    card.hidden = false;
    fetchInjuries().then(function (res) {
      if (token !== injToken) return;
      var team = function (key, t, color) {
        var list = injSorted(res.by[key]);
        return '<div class="inj-team"><span class="badge" style="background:' + t.color + ";color:" + badgeTextColor(t.color) + '">' + t.abbr +
          '</span><span class="inj-tn">' + t.zh + "</span></div>" +
          (list.length ? '<ul class="inj-list">' + list.map(function (x) { return injRow(x, t.abbr); }).join("") + "</ul>" : '<p class="inj-none">目前沒有傷病名單</p>');
      };
      var hh = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16);
      card.innerHTML = head + team(aKey, a, aColor) + team(hKey, h, hColor) +
        '<p class="inj-note">經 ESPN 取得，台灣時間 ' + hh + " 更新；場均上場時間不到8分鐘不提供數據；預計回歸日期為台灣日期；出賽狀態取自 2 天內的傷病快訊，沒標示代表 ESPN 沒有更新</p>";
    }, function () {
      if (token !== injToken) return;
      card.innerHTML = head + '<p class="odds-msg">傷病名單暫時抓不到，稍後重新整理再試。</p>';
    });
  }

  // ---------- 初始化 ----------
  document.title = COPY.title;
  $("page-title").textContent = COPY.title.replace(/^NBA\s*/, "");  // 「NBA」在標題上方的小字，這裡只放後面的字
  $("page-kicker").textContent = "NBA · " + (MODE === "in_season" ? D.season : D.nextSeason);
  if (COPY.notice) {
    var noticeStrong = document.createElement("strong");
    noticeStrong.textContent = "資料說明：";
    $("notice").appendChild(noticeStrong);
    $("notice").appendChild(document.createTextNode(COPY.notice));
  } else {
    $("notice").hidden = true;
  }
  $("stats-title").textContent = COPY.statsTitle;
  // 頁尾每項一行：資料來源、整理範圍、免責聲明
  // 11/1~11/8 的比賽：賽後（11/8）才把傷病、連兩天、新的對戰節奏、球隊評分算法補進預測，所以比分和當時不一樣：頁尾註明（日期範圍來自賽程資料的 retro）
  var md = function (d) { return Number(d.slice(5, 7)) + "/" + Number(d.slice(8)); };
  var retroLine = SCHEDULE && SCHEDULE.retro ? md(SCHEDULE.retro[0]) + "~" + md(SCHEDULE.retro[1]) + " 比賽在" + md(SCHEDULE.retro[1]) + "賽後更新納入傷病<br>新的PACE、球隊評分算法<br>因此比分與之前有所差異" : null;  // 斷句固定成三行
  $("foot-text").innerHTML = COPY.sources.concat([COPY.foot], retroLine ? [retroLine] : [], ["僅供興趣參考，非投注建議!!"]).join("<br>");

  fillSelect(awaySel);
  fillSelect(homeSel);
  awaySel.value = "Philadelphia 76ers";
  homeSel.value = "New York Knicks";

  // ---------- 網址記住狀態，所以每一場的預測都有自己的連結，也能用瀏覽器的上一頁 ----------
  //   #tab=matchup&away=PHI&home=NYK[&date=2026-11-05][&neutral=1]    第一層：自選對戰
  //   #tab=schedule&date=2026-11-05                                   第二層：某天的賽程
  function readHash() { return new URLSearchParams(location.hash.replace(/^#/, "")); }

  function hashOf(obj) {
    var p = new URLSearchParams();
    Object.keys(obj).forEach(function (k) { if (obj[k]) p.set(k, obj[k]); });
    return "#" + p.toString();
  }

  function replaceHash(obj) { history.replaceState(null, "", hashOf(obj)); }

  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ""); }

  // ---------- 第二層：賽程（日期都是台灣日期，過去的日期不能選） ----------
  var gamesByDate = {};
  var dates = [];  // 有比賽的台灣日期（由小到大）
  if (SCHEDULE) {
    SCHEDULE.games.forEach(function (g) { (gamesByDate[g.d] = gamesByDate[g.d] || []).push(g); });
    dates = Object.keys(gamesByDate).sort();
  }
  var lastDate = dates.length ? dates[dates.length - 1] : null;
  var curDate = null;

  function todayTW() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }  // 台灣的今天

  function addDays(d, n) {
    var p = d.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }

  function fmtDate(d) {  // "2026-11-05" -> "11/5（四）"
    var p = d.split("-").map(Number);
    return p[1] + "/" + p[2] + "（" + "日一二三四五六".charAt(new Date(p[0], p[1] - 1, p[2]).getDay()) + "）";
  }

  function nextGameDate(from) {  // from 當天或之後，第一個有比賽的日期
    for (var i = 0; i < dates.length; i++) if (dates[i] >= from) return dates[i];
    return null;
  }

  function nextUpcomingDate() {  // 今天或之後，第一個還有比賽沒打完（尚未開打或進行中）的日期
    var t = todayTW();
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] >= t && gamesByDate[dates[i]].some(function (g) { return g.s === "S" || g.s === "L"; })) return dates[i];
    }
    return null;
  }

  // 這場比賽現在能顯示預測嗎：「下一個比賽日」的每一場都可以；隔天的比賽，只要兩隊在那之前都沒有「還沒打完」的比賽
  // （隊伍沒再打球，賽季數據和近 10 場就不會變，預測現在算和之後算一樣），也可以先顯示。更後面的日子先不顯示
  function canPredict(g, date) {
    if (date === nextUpcomingDate()) return true;
    var t = todayTW();
    if (date !== addDays(t, 1) || !g.a || !g.h) return false;
    return !dates.some(function (d) {
      return d >= t && d < date && gamesByDate[d].some(function (x) { return (x.s === "S" || x.s === "L") && (x.a === g.a || x.h === g.a || x.a === g.h || x.h === g.h); });
    });
  }

  function hasUpcoming() { return !!lastDate && lastDate >= todayTW(); }

  // 最早能選的日期：賽程資料的第一天（build_data.py 的 SCHEDULE_SHOW_FROM，過去這幾天看賽前預測和結果）；
  // 賽程第一天還在未來（球季還沒開打）就是今天。更早的日期沒有資料，不能選
  function minDate() {
    var t = todayTW();
    return dates.length && dates[0] < t ? dates[0] : t;
  }

  function clampDate(d) {
    var lo = minDate();
    if (!isDate(d)) d = todayTW();
    return d < lo ? lo : (d > lastDate ? lastDate : d);
  }

  function prevMatchDay(d) {  // d 之前的一個比賽日（不能早於最早能選的日期）
    for (var i = dates.length - 1; i >= 0; i--) if (dates[i] < d) return dates[i] >= minDate() ? dates[i] : null;
    return null;
  }

  function nextMatchDay(d) {  // d 之後的一個比賽日
    for (var i = 0; i < dates.length; i++) if (dates[i] > d) return dates[i];
    return null;
  }

  function miniBadge(t) {
    return '<span class="mini-badge" style="background:' + t.color + ";color:" + badgeTextColor(t.color) + '">' + t.abbr + "</span>";
  }

  // 已完賽的比賽：用「那天開打之前」的數據算賽前預測，對照實際結果；算不出來（球隊還沒有數據）就回傳 null
  // 最近一個比賽日的數據在 PRE，更早的比賽日在 PRE_DAYS
  function preGameInfo(g) {
    if (!PRE || g.s !== "F" || !g.a || !g.h) return null;
    var teams = g.live ? T : g.d === PRE.date ? PRE.teams : PRE_DAYS[g.d];  // g.live：ESPN 剛說打完、資料還沒更新的比賽，球隊總表就還是開打前的數據
    if (!teams) return null;
    var a = teams[ABBR[g.a]];
    var h = teams[ABBR[g.h]];
    if (!a.gp || !h.gp) return null;
    var c = compareModels(a, h, g.n, gameAdj(g));
    var homeWon = g.hs > g.as;
    // an / hn：兩隊的名稱資料（隊名、隊徽）一律從球隊總表拿，PRE_DAYS 裡只有算預測要用的數字
    return { a: a, h: h, an: T[ABBR[g.a]], hn: T[ABBR[g.h]], c: c,
      ok1: (c.w1 === "home") === homeWon, ok2: (c.w2 === "home") === homeWon };
  }

  // 這場能不能點進去：兩隊都確定，而且（還沒打完、不是已經過去的日子）或（已完賽、有賽前數據，點進去是固定頁面）
  // 已經過去的日子，資料沒更新時狀態還是「尚未開打」，這種不能點
  function isClickable(g, date) {
    var a = g.a ? T[ABBR[g.a]] : null;
    var h = g.h ? T[ABBR[g.h]] : null;
    var past = date < todayTW();
    return !!(a && h) && (((g.s === "S" || g.s === "L") && !past) || !!(MODEL && preGameInfo(g)));
  }

  function gameHash(g, date) {
    return hashOf({ tab: "matchup", away: g.a, home: g.h, date: date, neutral: g.n ? "1" : "", pre: g.s === "F" ? "1" : "" });
  }

  // 一邊的球隊：隊徽、隊名、戰績（沒決定的隊伍顯示「待定」）
  // 預測勝率條（信心下面）：模型預測分差 M（主隊 - 客隊，已含傷病、連兩天）換成主隊勝率 = Φ(M / 13.5)，Φ 是標準常態累積分布
  // 13.5 和冷門觀察規則 v1 用的 sigma 一樣；三季回測（3,643 場）各勝率區間的預測和實際大致吻合
  function normCdf(z) {  // Φ(z)，用 erf 的近似公式（誤差 < 1.5e-7）
    var x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    var e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + (z < 0 ? -e : e));
  }
  // 勝率條：客隊 % | 條 | 主隊 %（客隊用客隊隊色、主隊用主隊隊色），整條置中
  function probBar(pa, ph, a, h, title, caption) {  // caption：條下面的小字（「賭盤勝率」/「模型勝率」）
    return '<div class="gm-wb"><div class="gm-wp" title="' + title + pa + "%｜主隊 " + ph + '%"><span class="gm-wn gm-wna">' + pa + "%</span>" +
      '<span class="gm-wbar"><span style="width:' + pa + "%;background:" + a.color + '"></span><span style="background:' + h.color + '"></span></span>' +
      '<span class="gm-wn">' + ph + "%</span></div>" + '<div class="gm-wc">' + caption + "</div></div>";
  }
  function confCorner(p) {  // 卡片右下角的信心程度（絕對定位在下半部那塊的右下角）
    return '<div class="gm-conf-c">' + confHtml(p) + "</div>";
  }
  function winBar(p, a, h) {  // 我們預測的勝率；p = 預測比分 { away, home }
    if (!p || !a || !h) return "";
    var ph = Math.round(normCdf((p.home - p.away) / 13.5) * 100);
    return probBar(100 - ph, ph, a, h, "我們預測的勝率：客隊 ", "模型勝率");
  }
  function marketBar(g, a, h) {  // 賭盤預估勝率（去抽水）；還沒有賭盤的比賽不放。g.mq = 主隊勝率（%），build_data.py 用「目前」勝負盤賠率算
    if (typeof g.mq !== "number" || !a || !h) return "";
    return probBar(100 - g.mq, g.mq, a, h, "賭盤預估勝率（去抽水）：客隊 ", "賭盤勝率");
  }
  // 隊徽上面的小行（固定 19px 高；兩隊都留這一行，隊徽、隊名才會對齊）：
  //   streak：undefined = 沒有這一行；字串 = 這一行的內容（連勝 / 連敗的字，或「冷門觀察」小標籤；什麼都沒有就是空字串，留空白）
  //   tag：舊的用法（「show」/「space」，隊徽上面另外一行小標籤），賽程卡片已經改成放在 streak 那一行，這裡保留給其他地方
  function teamCell(t, tag, streak) {
    var top = (streak !== undefined ? '<div class="gm-topl">' + streak + "</div>" : "") +
      (tag ? '<div class="gm-topl"><div class="gm-up' + (tag === "space" ? " gm-up-gap" : "") + '">冷門觀察</div></div>' : "");
    if (!t) return '<div class="gm-team">' + top + '<span class="mini-badge tbd">?</span><div class="gm-name">待定</div></div>';
    return '<div class="gm-team">' + top + miniBadge(t) + '<div class="gm-name">' + t.zh + '</div><div class="gm-rec">' +
      t.w + "-" + t.l + "</div></div>";
  }

  // 賽程列表的一場比賽，版型仿 NBA 官網：客隊在左、主隊在右，中間是開賽時間（已完賽改顯示比分）。
  // 能點的是連結，點了帶到那場的預測
  // mode = "home"：首頁下拉清單用的簡版，中間不顯示開賽時間，改顯示我們預測的比分，底下只留信心
  function gameItem(g, date, mode) {
    var a = g.a ? T[ABBR[g.a]] : null;
    var h = g.h ? T[ABBR[g.h]] : null;
    var pi = MODEL ? preGameInfo(g) : null;
    var up = a && h ? UPSET_BY[date + "|" + g.a + "|" + g.h] : null;  // 這場有沒有冷門觀察
    // 還沒開打的比賽：隊徽上面標連勝 / 連敗（3 場起；是「現在」的連勝連敗，已完賽的卡片不標）；任一隊有就兩隊都留一行
    var upcoming = (g.s === "S" || g.s === "L") && a && h && MODEL;
    var stA = upcoming ? streakText(a) : "", stH = upcoming ? streakText(h) : "";
    // 隊徽上面只有一行：被「冷門觀察」選到的那隊放小標籤（優先，蓋過它的連勝連敗），另一隊放自己的連勝連敗
    var tagHtml = '<div class="gm-up">冷門觀察</div>';
    var lineA = up && up.side === "a" ? tagHtml : stA, lineH = up && up.side === "h" ? tagHtml : stH;
    var hasTop = !!(up || stA || stH), nTop = hasTop ? 1 : 0;
    // 首頁簡版：還沒開打的顯示預測比分；開打後已經抓到即時比分的，就跟賽程一樣顯示即時比分
    var homePred = mode === "home" && MODEL && a && h && (g.s === "S" || g.s === "L") && !liveMidCache[date + "|" + g.a + "|" + g.h] ? compareModels(a, h, g.n, gameAdj(g)) : null;
    var past = date < todayTW();
    var clickable = isClickable(g, date);
    var el = document.createElement(clickable ? "a" : "div");
    el.className = "game" + (clickable ? "" : " is-static");
    if (clickable) el.href = gameHash(g, date);
    if ((g.s === "S" || g.s === "L") && a && h) el.setAttribute("data-live", g.a + "_" + g.h);  // 賽程區的即時比分：開打後就用這個找到要更新的卡片

    // 標籤：墨西哥城例行賽本來就是中立場地，合成一個「中立場地-墨西哥」；其他照舊（備註標籤、中立場地各一個）
    var mexico = g.n && a && h && g.tag && g.tag.indexOf("墨西哥") >= 0;
    var tags = mexico ? '<span class="game-tag">中立場地-墨西哥</span>' :
      (g.tag ? '<span class="game-tag">' + g.tag + "</span>" : "") + (g.n && a && h ? '<span class="game-tag">中立場地</span>' : "");

    // 中間：已完賽顯示比分（贏的那隊加粗，箭頭指向勝方），其他顯示開賽時間
    var mid, timeMid = false;  // timeMid：中間顯示的是開賽時間（不是比分），信心程度就放在時間下面
    if (homePred) {  // 預測比分（預測會贏的那隊加粗，箭頭指向預測勝方）
      var hw = homePred.w1 === "home";
      mid = '<div class="gm-score"><span class="gm-pts pred ' + (hw ? "lose" : "win") + '">' + f1(homePred.p1.away) + "</span>" +
        '<span class="gm-final"><b>' + (hw ? "▶" : "◀") + "</b>預測</span>" +
        '<span class="gm-pts pred ' + (hw ? "win" : "lose") + '">' + f1(homePred.p1.home) + "</span></div>";
    } else if (g.s === "F" && a && h) {
      var homeWon = g.hs > g.as;
      mid = '<div class="gm-score"><span class="gm-pts ' + (homeWon ? "lose" : "win") + '">' + g.as + "</span>" +
        '<span class="gm-final"><b>' + (homeWon ? "▶" : "◀") + "</b>" + finalLabel(g) + "</span>" +
        '<span class="gm-pts ' + (homeWon ? "win" : "lose") + '">' + g.hs + "</span></div>";
    } else if ((g.s === "S" || g.s === "L") && liveMidCache[date + "|" + g.a + "|" + g.h]) {
      mid = liveMidCache[date + "|" + g.a + "|" + g.h];  // 已經抓到的即時比分，重畫時先用這份
    } else {
      timeMid = true;
      mid = '<div class="game-time">' + g.t + "</div>" +
        (g.s === "L" ? '<div class="gm-sub live">進行中</div>' : g.s === "X" ? '<div class="gm-sub">延期或取消</div>' : "");
    }

    // 卡片下方的小字
    var line = "";
    if (g.s === "F") {
      if (pi) {  // 賽前預測（大比分那個算法）vs 實際結果
        line = "賽前預測比分：" + pi.an.zh + " " + f1(pi.c.p1.away) + " : " + f1(pi.c.p1.home) + " " + pi.hn.zh +
          winBar(pi.c.p1, a, h) + confCorner(pi.c.p1);
      }
    } else if (g.s === "X") {
      line = "";
    } else if (past) {
      line = "這天已經過去，更新資料後會顯示結果";
    } else if (!(a && h)) {
      line = "兩隊要等前一輪打完才決定";
    } else if (homePred) {
      line = confHtml(homePred.p1) + winBar(homePred.p1, a, h);
    } else if (MODEL && canPredict(g, date)) {  // 下一個比賽日、或兩隊都已沒有未打完比賽的隔天，才顯示預測和信心；更後面的日子先不顯示
      var c = compareModels(a, h, g.n, gameAdj(g));
      var wn = c.w1 === "home" ? h.zh : a.zh;  // 預測會贏的那隊
      line = "賽前預測比分：" + a.zh + " " + f1(c.p1.away) + " : " + f1(c.p1.home) + " " + h.zh + "<br>預測 <b>" + wn + "</b> 勝";
      if (timeMid) {  // 信心程度移到開賽時間下面（置中）；已經開打、中間換成即時比分的，就還是接在下面那行
        mid += marketBar(g, a, h);  // 開賽時間下面放賭盤預估勝率
        line += winBar(c.p1, a, h) + confCorner(c.p1);  // 「預測 X 勝」下面放我們預測的勝率，信心放在卡片右下角
        el.setAttribute("data-cm", "1");  // 記號：中間這塊含信心，即時比分來時整張卡重畫（不然信心會跟著時間一起被蓋掉）
      } else {
        line += winBar(c.p1, a, h) + confCorner(c.p1);
      }
    }

    // 已完賽、有賽前預測：最上面一列 = 有標籤（NBA 盃小組賽等）= 左邊標籤、右邊預測正確/失敗；沒標籤 = 預測正確/失敗置中；其他卡片標籤照舊置中
    var head = g.s === "F" && a && h && pi
      ? '<div class="gm-head' + (tags ? "" : " solo") + '"><div class="gm-head-l">' + tags + '</div><span class="gm-res ' + (pi.ok1 ? "ok" : "bad") + '">' + (pi.ok1 ? "預測正確" : "預測失敗") + '</span></div>'
      : tags ? '<div class="gm-tags">' + tags + "</div>" : "";
    el.innerHTML = head +
      '<div class="gm-row"' + (nTop ? ' style="--gm-top:' + nTop * 19 + 'px"' : "") + ">" + teamCell(a, null, hasTop ? lineA : undefined) +
      '<div class="gm-mid">' + mid + "</div>" + teamCell(h, null, hasTop ? lineH : undefined) + "</div>" +
      (line ? '<div class="game-pred">' + line + "</div>" : "");
    if ((g.s === "S" || g.s === "L") && a && h) {  // 超級球星出賽成疑：球隊戰績下面補一行（資料來自 ESPN 傷病名單，抓回來之後補；已經抓到就直接補）
      el.setAttribute("data-gk", date + "|" + g.a + "|" + g.h);
      loadQuestionable();
      decorateQuestionable(el);
    }
    var li = document.createElement("li");
    li.appendChild(el);
    return li;
  }

  // 當天已完賽、有賽前預測的比賽：預測正確幾場、預測失敗幾場（用大比分那個算法，和卡片上標的一樣）
  function drawDaySummary(games) {
    var right = 0, wrong = 0;
    if (MODEL) games.forEach(function (g) {
      var pi = preGameInfo(g);
      if (pi) { if (pi.ok1) right++; else wrong++; }
    });
    var sum = $("day-summary");
    sum.hidden = right + wrong === 0;
    sum.innerHTML = '當天預測正確 <span class="ok">' + right + '</span> 場、預測失敗 <span class="bad">' + wrong + "</span> 場";
  }

  function renderSchedule(date) {
    curDate = date;
    $("date-input").value = date;
    $("date-prev").disabled = !prevMatchDay(date);
    $("date-next").disabled = !nextMatchDay(date);
    var games = (gamesByDate[date] || []).map(withLive);
    var list = $("game-list");
    list.innerHTML = "";
    games.forEach(function (g) { list.appendChild(gameItem(g, date)); });
    drawDaySummary(games);
    $("game-empty").hidden = games.length > 0;
    if (!games.length) {
      $("game-empty-text").textContent = fmtDate(date) + "沒有比賽。";
      var next = nextGameDate(addDays(date, 1));
      var jump = $("jump-next");
      jump.hidden = !next;
      if (next) {
        jump.textContent = "跳到下一個比賽日：" + fmtDate(next);
        jump.onclick = function () { goDate(next); };
      }
    }
    startLive(date, "schedule");
  }

  // ---------- 賽程區的即時比分 ----------
  // 比賽開打後，賽程卡片中間改顯示即時比分和第幾節、剩幾分鐘（資料來自 ESPN 賽事列表，每 30 秒更新一次，只在開著賽程分頁時更新）。
  // 只改畫面，不寫進資料檔；ESPN 說打完了但我們的資料還沒更新時，先顯示最終比分，更新資料後才會有預測對錯
  var liveTimer = null;

  function stopLive() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }

  // 即時比分在兩個畫面都有：賽程（卡片列表 #game-list）和投票（#vote-list）
  var LIVE_VIEWS = { schedule: { list: "#game-list", box: "view-schedule" }, vote: { list: "#vote-list", box: "view-vote" }, home: { list: "#home-games", box: "view-home" } };
  var homeDate = null;  // 首頁下拉清單現在顯示的比賽日
  var liveMidCache = {};  // "日期|客隊|主隊" -> 最近一次的中間欄 HTML；畫面重畫（例如投票後）時先用這份，不會閃回「進行中」

  function startLive(date, view) {
    stopLive();
    var t = todayTW();
    if (date < addDays(t, -1) || date > addDays(t, 1)) return;  // 離今天太遠的日子不會有進行中的比賽
    if (!document.querySelector(LIVE_VIEWS[view].list + " [data-live]")) return;
    liveTick(date, view);
    liveTimer = setInterval(function () { if (!document.hidden) liveTick(date, view); }, 30000);
  }

  function livePeriod(st) {  // 第幾節 / 剩餘時間；回傳 [上一行, 下一行]
    var p = st.period || 1;
    var lab = p > 4 ? "延長 " + (p - 4) : "第 " + p + " 節";
    var name = st.type.name;
    if (name === "STATUS_HALFTIME") return ["中場", ""];
    if (name === "STATUS_END_PERIOD") return [lab, "結束"];
    return [lab, st.displayClock || ""];
  }

  function liveMid(e) {  // 一場比賽的中間欄：比分（領先的那隊加粗，箭頭指向領先方）+ 第幾節 / 已完賽
    var sc = { away: 0, home: 0 };
    e.competitions[0].competitors.forEach(function (c) { sc[c.homeAway] = Number(c.score) || 0; });
    var final = e.status.type.name === "STATUS_FINAL";
    var lead = sc.home > sc.away ? "home" : sc.away > sc.home ? "away" : null;
    var per = livePeriod(e.status);
    return '<div class="gm-score"><span class="gm-pts ' + (lead === "home" ? "lose" : "win") + '">' + sc.away + "</span>" +
      '<span class="gm-final' + (final ? "" : " live") + '"><b>' + (lead === "home" ? "▶" : lead === "away" ? "◀" : "＝") + "</b>" +
      (final ? (e.status.period > 4 ? (e.status.period > 5 ? e.status.period - 4 : "") + "OT" : "已完賽") : per[0] + (per[1] ? "<br>" + per[1] : "")) + "</span>" +
      '<span class="gm-pts ' + (lead === "away" ? "lose" : "win") + '">' + sc.home + "</span></div>";
  }

  function pairIndex(events) {  // ESPN 賽事列表 -> { "客隊名|主隊名": 那場 }
    var by = {};
    events.forEach(function (e) {
      var comp = e.competitions && e.competitions[0];
      if (!comp) return;
      var n = {};
      comp.competitors.forEach(function (c) { n[c.homeAway] = ESPN_NAME_FIX[c.team.displayName] || c.team.displayName; });
      by[n.away + "|" + n.home] = e;
    });
    return by;
  }

  function finalScore(e) {  // { as: 客隊得分, hs: 主隊得分 }
    var sc = {};
    e.competitions[0].competitors.forEach(function (c) { sc[c.homeAway] = Number(c.score) || 0; });
    return { as: sc.away, hs: sc.home, ot: Math.max(0, (e.status.period || 0) - 4) };
  }

  // 準確率、首頁的「猜對 X / Y」不顯示比賽卡片，只要知道「哪幾場剛打完」：
  // 去問 ESPN 昨天、今天已經開打但資料還沒更新的比賽，打完的記進 liveFinals。回傳 Promise：有新打完的就是 true
  function syncFinals() {
    var t = todayTW(), jobs = [];
    [addDays(t, -1), t].forEach(function (d) {
      var games = (gamesByDate[d] || []).filter(function (g) {
        return (g.s === "S" || g.s === "L") && Date.now() >= new Date(g.d + "T" + g.t + ":00+08:00").getTime();
      });
      if (!games.length) return;
      jobs.push(Promise.all([fetchScoreboard(addDays(d, -1), 20000), fetchScoreboard(d, 20000)]).then(function (days) {
        var by = pairIndex(days[0].concat(days[1])), changed = false;
        games.forEach(function (g) {
          var e = by[ABBR[g.a] + "|" + ABBR[g.h]], k = g.d + "|" + g.a + "|" + g.h;
          if (e && e.status.type.name === "STATUS_FINAL" && !liveFinals[k]) { liveFinals[k] = finalScore(e); changed = true; }
        });
        return changed;
      }, function () { return false; }));
    });
    return Promise.all(jobs).then(function (r) { return r.some(Boolean); });
  }

  var finalsTimer = null;
  function stopFinalsPoll() { if (finalsTimer) { clearInterval(finalsTimer); finalsTimer = null; } }
  function startFinalsPoll(redraw) {  // 開著準確率 / 首頁時，每 30 秒看有沒有新打完的比賽，有就重畫
    stopFinalsPoll();
    var tick = function () { if (!document.hidden) syncFinals().then(function (ch) { if (ch) redraw(); }); };
    tick();
    finalsTimer = setInterval(tick, 30000);
  }

  function liveTick(date, view) {
    var V = LIVE_VIEWS[view];
    var games = (gamesByDate[date] || []).filter(function (g) { return g.s === "S" || g.s === "L"; });
    // 還沒有任何一場開打（或 10 分鐘內要開打）就不用去問 ESPN
    var soon = games.some(function (g) { return Date.now() >= new Date(g.d + "T" + g.t + ":00+08:00").getTime() - 600000; });
    if (!soon) return;
    Promise.all([fetchScoreboard(addDays(date, -1), 20000), fetchScoreboard(date, 20000)]).then(function (days) {
      if ((view === "vote" ? voteDate : view === "home" ? homeDate : curDate) !== date || $(V.box).hidden) return;  // 使用者已經換日期或離開這個畫面了
      var byPair = pairIndex(days[0].concat(days[1]));
      document.querySelectorAll(V.list + " [data-live]").forEach(function (el) {
        var k = el.getAttribute("data-live").split("_");
        var e = byPair[ABBR[k[0]] + "|" + ABBR[k[1]]];
        var name = e && e.status.type.name;
        if (!e || name === "STATUS_SCHEDULED" || name === "STATUS_POSTPONED" || name === "STATUS_CANCELED") return;  // 還沒開打 / 延期：維持原樣
        if (name === "STATUS_FINAL") {  // 打完了：整張卡換成已完賽的樣子（預測正確/失敗、賽前預測比分，點進去是完賽頁）
          liveFinals[date + "|" + k[0] + "|" + k[1]] = finalScore(e);
          var gm = (gamesByDate[date] || []).filter(function (x) { return x.a === k[0] && x.h === k[1]; })[0];
          if (view === "vote") { drawVote(); return; }  // 投票頁整頁重畫：多了猜對/猜錯和統計
          if (gm && el.parentNode) {
            el.parentNode.replaceWith(gameItem(withLive(gm), date, view === "home" ? "home" : undefined));
            if (view === "home") drawHomeStats();  // 首頁準確率卡片的「猜對 X / Y」
            else drawDaySummary((gamesByDate[date] || []).map(withLive));
            return;
          }
        }
        var html = liveMid(e);
        liveMidCache[date + "|" + k[0] + "|" + k[1]] = html;
        if (view === "home" && el.parentNode) {  // 首頁簡版原本中間是預測比分、下面只有信心：改成跟賽程一樣（中間即時比分、下面賽前預測比分），所以整張重畫
          var gh = (gamesByDate[date] || []).filter(function (x) { return x.a === k[0] && x.h === k[1]; })[0];
          if (gh) { el.parentNode.replaceWith(gameItem(gh, date, "home")); return; }
        }
        if (el.hasAttribute("data-cm") && el.parentNode) {  // 信心原本放在開賽時間下面：整張重畫，信心改回接在下面那行
          var gc = (gamesByDate[date] || []).filter(function (x) { return x.a === k[0] && x.h === k[1]; })[0];
          if (gc) { el.parentNode.replaceWith(gameItem(gc, date, view === "home" ? "home" : undefined)); return; }
        }
        var mid = el.querySelector(".gm-mid");
        if (mid) mid.innerHTML = html;
      });
    }, function () { /* 這次抓不到就維持畫面原樣，30 秒後再試 */ });
  }

  function goDate(d) {  // 使用者在賽程裡換日期：不新增瀏覽紀錄，這樣「上一頁」從對戰畫面會回到對的那一天
    d = clampDate(d);
    renderSchedule(d);
    replaceHash({ tab: "schedule", date: d });
  }

  // ---------- 投票專區：每場猜勝負，不擋重複投票 ----------
  // 票數存在 Firebase Realtime Database，網頁直接用網址讀寫（REST），不用裝任何套件。
  // VOTE_DB 填資料庫網址（例如 https://xxxx-default-rtdb.firebaseio.com）；留空 = 不開放投票，分頁和首頁入口都不顯示
  var VOTE_DB = "https://nba-predictor-c0fb5-default-rtdb.asia-southeast1.firebasedatabase.app";
  var VOTE_ON = !!VOTE_DB && hasUpcoming();
  var voteDate = null;
  var votes = {};        // 這一天的票數：{ "BOS_NYK": { a: 客隊票數, h: 主隊票數 } }
  var voteState = "loading";  // loading 讀取中、ok 讀到了、err 讀不到
  var votePending = 0;   // 已送出、還沒收到回覆的票數

  function voteUrl(path) { return VOTE_DB.replace(/\/+$/, "") + "/votes/" + path + ".json"; }
  function voteKey(g) { return g.a + "_" + g.h; }

  // 還能不能投：還沒開賽（開賽時間比現在晚）才能投；資料沒更新、狀態還是「尚未開打」的過期比賽也算已開賽
  function voteOpen(g, date) {
    return g.s === "S" && Date.now() < new Date(date + "T" + g.t + ":00+08:00").getTime();
  }

  function setVoteMsg(text) {
    $("vote-msg").hidden = !text;
    $("vote-msg").textContent = text || "";
  }

  function loadVotes(date) {
    return fetch(voteUrl(date), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { if (voteDate === date) { votes = d || {}; voteState = "ok"; } })
      .catch(function () { if (voteDate === date) voteState = "err"; })
      .then(function () { if (voteDate === date) redrawVote(); });
  }

  function renderVote(date) {
    voteDate = date;
    votes = {};
    voteState = "loading";
    setVoteMsg("");
    $("vote-date").textContent = fmtDate(date);
    $("vote-prev").disabled = !prevMatchDay(date);
    $("vote-next").disabled = !nextMatchDay(date);
    drawVote();
    loadVotes(date);
    startLive(date, "vote");
  }

  function goVoteDate(d) {
    if (!d) return;
    renderVote(d);
    replaceHash({ tab: "vote", date: d });
  }

  // 一場比賽的投票內容（投票頁每張卡、單場頁的投票卡片共用）：
  // btns 兩個投票按鈕（還能投才有）、bar 票數比例條、info 開賽後的對照（網友多數猜誰、我們預測誰，已完賽再標對錯）
  // crowd / model：已完賽時網友、我們猜對 (true) 或猜錯 (false)；沒得比就是 null
  // 第二隊色：兩隊主色太像時，主隊改用這個（只有投票比例條會用到）
  var ALT_COLOR = {
    ATL: "#C1D32F", BOS: "#BA9653", BKN: "#000000", CHA: "#1D1160", CHI: "#000000", CLE: "#041E42", DAL: "#002B5E", DEN: "#0E2240",
    DET: "#1D42BA", GSW: "#FFC72C", HOU: "#C4CED4", IND: "#002D62", LAC: "#1D428A", LAL: "#FDB927", MEM: "#12173F", MIA: "#F9A01B",
    MIL: "#EEE1C6", MIN: "#78BE20", NOP: "#0C2340", NYK: "#006BB6", OKC: "#EF3B24", ORL: "#C4CED4", PHI: "#ED174C", PHX: "#1D1160",
    POR: "#000000", SAC: "#63727A", SAS: "#000000", TOR: "#753BBD", UTA: "#002B5C", WAS: "#E31837"
  };

  function voteParts(g, date) {
    var a = T[ABBR[g.a]], h = T[ABBR[g.h]];
    var v = votes[voteKey(g)] || {};
    var na = v.a || 0, nh = v.h || 0, tot = na + nh;
    var open = voteOpen(g, date);
    var pa = Math.round(na / (tot || 1) * 100);
    var ready = voteState === "ok";

    var btns = open
      ? '<div class="vote-btns"><button type="button" class="vote-btn" data-k="' + voteKey(g) + '" data-s="a">' + a.zh +
        ' 贏</button><button type="button" class="vote-btn" data-k="' + voteKey(g) + '" data-s="h">' + h.zh + " 贏</button></div>"
      : "";

    // 比例條和票數都用兩隊的隊色（跟數據對照同一套，深色底上太暗的顏色會自動調亮）；兩隊顏色太像時，主隊改用灰色，才分得出來
    var bg = cardBackground();
    var ca = readableOn(a.color, bg), ch = readableOn(h.color, bg);        // 文字色：要看得清楚
    var ba = readableOn(a.color, bg, 1.5), bh = readableOn(h.color, bg, 1.5);  // 比例條色塊：只要和底色分得開，盡量保持原本的隊色（金塊才是金色）
    var rgbA = hexToRgb(a.color), rgbH = hexToRgb(h.color);
    var colorGap = function (x, y) { return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]); };
    if (colorGap(rgbA, rgbH) < 90) {  // 兩隊顏色太像（例如金塊和溜馬都是黃色）：主隊改用牠的第二隊色，還是太像才用灰色
      var alt = ALT_COLOR[h.abbr];
      var useAlt = alt && colorGap(rgbA, hexToRgb(alt)) >= 90;
      ch = useAlt ? readableOn(alt, bg) : "var(--muted)";
      bh = useAlt ? readableOn(alt, bg, 1.5) : "var(--muted)";
    }
    var bar = '<div class="vote-bar' + (tot ? "" : " empty") + '"' + (tot ? ' style="background:' + bh + '"' : "") +
      '><span class="vb-a" style="width:' + pa + '%;background:' + ba + '"></span></div>' +
      '<div class="vote-nums"><span style="color:' + ca + '">' + a.zh + " " + (ready ? na + " 票" + (tot ? "（" + pa + "%）" : "") : "—") + '</span><span style="color:' + ch + '">' +
      h.zh + " " + (ready ? nh + " 票" + (tot ? "（" + (100 - pa) + "%）" : "") : "—") + "</span></div>";

    var info = "", crowdRes = null, modelRes = null;
    if (!open && ready) {
      var lines = [];
      var crowd = na === nh ? null : (na > nh ? "away" : "home");
      var pi = g.s === "F" && MODEL ? preGameInfo(g) : null;
      if (tot) {
        var cm = "";
        if (g.s === "F" && crowd) {
          crowdRes = (crowd === "home") === (g.hs > g.as);
          cm = crowdRes ? " ✅" : " ❌";
        }
        lines.push("網友多數猜 " + (crowd ? (crowd === "home" ? h : a).zh + " 勝" : "五五開") + cm);
      }
      var c = pi ? pi.c : (MODEL && g.s !== "F" ? compareModels(a, h, g.n, gameAdj(g)) : null);
      if (c) {
        if (pi) modelRes = pi.ok1;
        lines.push("我們預測 " + (c.w1 === "home" ? h : a).zh + " 勝（" + confHtml(c.p1) + "）" + (pi ? (pi.ok1 ? " ✅" : " ❌") : ""));
      }
      info = lines.length ? '<div class="game-pred">' + lines.join("<br>") + "</div>" : "";
    }
    return { btns: btns, bar: bar, info: info, crowd: crowdRes, model: modelRes, open: open };
  }

  // 投票頁：畫出這一天每一場，開賽前顯示兩個投票按鈕，開賽後鎖票，賽後對照「網友猜的」「我們預測的」「實際結果」
  function drawVote() {
    var date = voteDate;
    var games = (gamesByDate[date] || []).filter(function (g) { return g.a && g.h && T[ABBR[g.a]] && T[ABBR[g.h]]; }).map(withLive);
    var list = $("vote-list");
    list.innerHTML = "";
    if (voteState === "err") setVoteMsg("票數暫時讀不到，請晚點再來!!");
    var crowdOk = 0, crowdN = 0, modelOk = 0, modelN = 0;
    games.forEach(function (g) {
      var a = T[ABBR[g.a]], h = T[ABBR[g.h]];
      var p = voteParts(g, date);
      if (p.crowd !== null) { crowdN++; if (p.crowd) crowdOk++; }
      if (p.model !== null) { modelN++; if (p.model) modelOk++; }

      var mid;
      if (g.s === "F") {
        var homeWon = g.hs > g.as;
        mid = '<div class="gm-score"><span class="gm-pts ' + (homeWon ? "lose" : "win") + '">' + g.as + "</span>" +
          '<span class="gm-final"><b>' + (homeWon ? "▶" : "◀") + "</b>" + finalLabel(g) + "</span>" +
          '<span class="gm-pts ' + (homeWon ? "win" : "lose") + '">' + g.hs + "</span></div>";
      } else if ((g.s === "S" || g.s === "L") && liveMidCache[date + "|" + g.a + "|" + g.h]) {
        mid = liveMidCache[date + "|" + g.a + "|" + g.h];  // 即時比分（開賽後每 30 秒更新）
      } else {
        mid = '<div class="game-time">' + g.t + "</div>" +
          (g.s === "L" ? '<div class="gm-sub live">進行中</div>' : p.open ? "" : '<div class="gm-sub">已開賽</div>');
      }

      var li = document.createElement("li");
      li.innerHTML = '<div class="game vote-card"' + ((g.s === "S" || g.s === "L") ? ' data-live="' + g.a + "_" + g.h + '"' : "") + '><div class="gm-row">' + teamCell(a) + '<div class="gm-mid">' + mid + "</div>" +
        teamCell(h) + "</div>" + p.btns + p.bar + p.info + "</div>";
      list.appendChild(li);
    });
    if (!games.length) list.innerHTML = '<li class="game-empty"><p>' + fmtDate(date) + "沒有比賽。</p></li>";
    var sum = $("vote-summary");
    sum.hidden = !(crowdN || modelN);
    sum.innerHTML = '網友猜對 <span class="ok">' + crowdOk + "</span> / " + crowdN + " 場　我們猜對 <span class=\"ok\">" + modelOk + "</span> / " + modelN + " 場";
  }

  // 單場頁（賽程點進來的那場）的投票卡片：放在兩隊對戰紀錄下面、本季數據對照上面
  var matchVote = null;  // { g: 這場比賽, date: 賽程日期 }；不是從賽程點進來的（自選對戰）就是 null

  function showMatchVote(g, date) {
    matchVote = VOTE_ON && g && date && g.s !== "F" ? { g: g, date: date } : null;  // 已完賽的比賽頁不放投票卡（投票頁的列表還看得到）
    if (!matchVote) { $("vote-card").hidden = true; return; }
    if (voteDate !== date) {  // 這一天的票數還沒讀過：讀一次（同一天的其他場、投票頁共用同一份）
      voteDate = date;
      votes = {};
      voteState = "loading";
      setVoteMsg("");
      loadVotes(date);
    }
    drawMatchVote();
  }

  function drawMatchVote() {
    var card = $("vote-card");
    if (!matchVote || matchVote.date !== voteDate) { card.hidden = true; return; }
    var p = voteParts(matchVote.g, matchVote.date);
    card.innerHTML = "<h2>🗳️ 投票" + (p.open ? "：誰會贏？" : "") + "</h2>" +
      (voteState === "err" ? '<p class="vote-msg">票數暫時讀不到，請晚點再來!!</p>' : "") +
      p.btns + p.bar + p.info;
    card.hidden = false;
  }

  // 票數有變動：投票頁、單場頁哪個看得到就重畫哪個
  function redrawVote() {
    if (!$("view-vote").hidden) drawVote();
    drawMatchVote();
  }

  function castVote(date, key, side) {
    var v = votes[key] || (votes[key] = {});
    v[side] = (v[side] || 0) + 1;  // 先在畫面上加 1，不用等伺服器
    redrawVote();
    var body = {};
    body[side] = { ".sv": { increment: 1 } };  // 叫伺服器自己加 1，兩個人同時投也不會互相蓋掉
    votePending++;
    fetch(voteUrl(date + "/" + key), { method: "PATCH", body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); })
      .catch(function () {
        v[side]--;
        if (voteDate === date) { setVoteMsg("這票沒送出去，請晚點再試!!"); redrawVote(); }
      })
      .then(function () {
        votePending--;
        if (!votePending && voteDate === date) loadVotes(date);  // 都送完了，重新讀一次，連別人剛投的一起更新
      });
  }

  // 四個畫面：home 首頁、schedule 賽程、vote 投票、matchup 自選對戰（含賽程點進去的單場頁）、stats 準確率
  function showTab(name) {
    ["home", "schedule", "vote", "matchup", "stats"].forEach(function (v) {
      $("view-" + v).hidden = v !== name;
      $("tab-" + v).setAttribute("aria-current", v === name ? "page" : "false");
    });
    if (name !== "schedule" && name !== "vote" && name !== "home") stopLive();  // 離開賽程、投票、首頁就不用再更新即時比分
    if (name !== "home" && name !== "stats") stopFinalsPoll();  // 離開首頁和準確率就不用再看有沒有新打完的比賽
    $("tabs").hidden = !hasUpcoming() || name === "home";  // 首頁自己就是選單，不再顯示分頁列
  }

  // ---------- 首頁：賽程卡片顯示下一個比賽日，準確率卡片顯示目前戰績 ----------
  var stConf = "E";  // 排名現在看哪一區：E 東區、W 西區

  function renderHome() {
    var nd = nextUpcomingDate(), t = todayTW();
    // 賽程卡片的小字：下一個比賽日是今天 / 明天就直接這樣說，不然寫日期
    $("home-schedule-desc").textContent = nd
      ? (nd === t ? "今天" : nd === addDays(t, 1) ? "明天" : fmtDate(nd)) + "的比賽預測"
      : "賽程與預測";
    // 右上角按鈕：最近一個有打完比賽的日子的賽果（就是今天的話寫「今日賽果」，不然寫「最新賽果」）
    var lastFinal = null;
    SCHEDULE.games.forEach(function (g) { if (g.s === "F" && g.d <= t && (!lastFinal || g.d > lastFinal)) lastFinal = g.d; });
    var res = $("home-result");
    res.hidden = !lastFinal;
    if (lastFinal) {
      res.textContent = lastFinal === t ? "今日賽果" : "最新賽果";
      res.href = hashOf({ tab: "schedule", date: lastFinal });
    }
    // 右上角第二顆按鈕：永遠是「隔天」的賽程（明天有比賽就寫「明日賽程」；明天沒比賽就找今天之後的下一個比賽日，寫「下個賽程」）
    var nx = $("home-next"), tomorrowDate = null;
    for (var di = 0; di < dates.length; di++) { if (dates[di] > t) { tomorrowDate = dates[di]; break; } }
    nx.hidden = !tomorrowDate;
    if (tomorrowDate) {
      nx.textContent = tomorrowDate === addDays(t, 1) ? "明日賽程" : "下個賽程";
      nx.href = hashOf({ tab: "schedule", date: tomorrowDate });
    }
    // 下拉：點開就看到下一個比賽日的每一場（隊伍、我們預測的比分、信心），點哪一場就直接進那場
    var box = $("home-games-box");
    if (nd && MODEL) {
      var list = $("home-games");
      list.innerHTML = "";
      gamesByDate[nd].map(withLive).forEach(function (g) { list.appendChild(gameItem(g, nd, "home")); });
      $("home-games-sum").textContent = "展開看 " + gamesByDate[nd].length + " 場預測";
      box.hidden = false;
      homeDate = nd;
      startLive(nd, "home");  // 開打後下拉清單裡也顯示即時比分，打完換成完賽樣子
    } else {
      box.hidden = true;
      homeDate = null;
    }
    $("home-vote").hidden = !VOTE_ON;
    drawHomeStats();
    renderStandings();
  }

  function drawHomeStats() {
    var s = accuracyRows();
    $("home-stats-sub").textContent = s.length ? "猜對 " + s.filter(function (r) { return r.ok; }).length + " / " + s.length : "";
  }

  // ---------- 排名：東區 / 西區，勝率高到低；勝差 = 和第一名相差幾場；近況 = 目前連勝（W）或連敗（L） ----------
  // 某一區（E / W）的球隊 key，照排名順序（勝率高到低）；排名表和傷病名單共用
  function confKeys(conf) {
    var pct = function (t) { return t.w + t.l ? t.w / (t.w + t.l) : 0; };
    return Object.keys(T).filter(function (k) { return T[k].conf === conf; }).sort(function (x, y) {
      var a = T[x], b = T[y];
      return pct(b) - pct(a) || b.w - a.w || a.zh.localeCompare(b.zh, "zh-Hant");
    });
  }

  function renderStandings() {
    $("st-east").setAttribute("aria-pressed", stConf === "E" ? "true" : "false");
    $("st-west").setAttribute("aria-pressed", stConf === "W" ? "true" : "false");
    var list = confKeys(stConf).map(function (k) { return T[k]; });
    var lead = list[0];
    $("st-body").innerHTML = list.map(function (t, i) {
      var gb = ((lead.w - t.w) + (t.l - lead.l)) / 2;
      var run = t.streak > 0 ? '<span class="st-w">W' + t.streak + "</span>" : t.lstreak > 0 ? '<span class="st-l">L' + t.lstreak + "</span>" : "—";
      return "<tr" + (i === 5 || i === 9 ? ' class="st-cut"' : i >= 10 ? ' class="st-out"' : "") + "><td>" + (i + 1) + "</td>" +
        '<td><div class="st-team">' + miniBadge(t) + "<span>" + t.zh + "</span></div></td>" +
        "<td>" + t.w + "</td><td>" + t.l + "</td><td>" + (i === 0 ? "—" : String(gb)) + "</td><td>" + run + "</td></tr>";
    }).join("");
  }

  // ---------- 首頁傷病名單：東區 / 西區，每隊一列（排名順序），點隊伍展開那隊的傷病 ----------
  var injConf = "E";
  var injHomeToken = 0;  // 很快連點東西區時，只畫最後一次的結果

  function renderInjHome() {
    $("inj-east").setAttribute("aria-pressed", injConf === "E" ? "true" : "false");
    $("inj-west").setAttribute("aria-pressed", injConf === "W" ? "true" : "false");
    var box = $("inj-teams");
    var token = ++injHomeToken;
    box.innerHTML = '<p class="odds-msg">載入中…</p>';
    fetchInjuries().then(function (res) {
      if (token !== injHomeToken) return;
      box.innerHTML = confKeys(injConf).map(function (k) {
        var list = injSorted(res.by[k]);
        var out = list.filter(function (x) { return x.status === "Out"; }).length;
        var dtd = list.filter(function (x) { return x.status === "Day-To-Day"; }).length;
        var cnt = list.length
          ? (out ? '<span class="inj-st out">缺陣 ' + out + "</span>" : "") + (dtd ? '<span class="inj-st dtd">觀察 ' + dtd + "</span>" : "") +
            (list.length - out - dtd ? '<span class="inj-st">其他 ' + (list.length - out - dtd) + "</span>" : "")
          : '<span class="inj-none">無</span>';
        return '<details class="inj-t"><summary><span class="st-team">' + miniBadge(T[k]) + "<span>" + T[k].zh + '</span></span><span class="inj-cnt">' + cnt + "</span></summary>" +
          (list.length ? '<ul class="inj-list">' + list.map(function (x) { return injRow(x); }).join("") + "</ul>" : '<p class="inj-none">目前沒有傷病名單</p>') + "</details>";
      }).join("");
      var hh = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16);
      $("inj-home-note").innerHTML = "經 ESPN 取得，台灣時間 " + hh + " 更新<br>場均上場時間不到8分鐘不提供數據";
    }, function () {
      if (token !== injHomeToken) return;
      box.innerHTML = '<p class="odds-msg">傷病名單暫時抓不到，稍後重新整理再試。</p>';
      $("inj-home-note").textContent = "";
    });
  }

  // ---------- 準確率：已完賽、有賽前數據的比賽，賽前預測（大比分）猜得準不準 ----------
  // 三季回測（2023-24 ~ 2025-26，3643 場）的對照數字：現行方法（含傷病扣分，傷病用「事後誰沒上場」代替，偏樂觀）、
  // 新球隊評分（SRS＋上季當開季起點）、信心用上面的門檻（3.5 / 8.0）：低 657/1171、中 763/1159、高 1083/1313、全部 2503/3643
  // （2023-24 的上季起點用 2022-23 整季）
  var BACKTEST = { all: "68.7%", low: "56.1%", mid: "65.8%", high: "82.5%" };
  // 各個玩法三季回測勝率（2023-24～2025-26，用現在的模型逐場往前推：含傷病、連兩天、對戰節奏調整；盤口只用有開盤的場次，打平盤與預測剛好等於盤口的不算）：
  // 新球隊評分：不讓分 2503 / 3643、讓分 1838 / 3579、客隊單隊大小 1835 / 3607、主隊單隊大小 1766 / 3586、總分大小 1817 / 3595
  var BET_BACKTEST = { ml: "68.7%", sp: "51.4%", tta: "50.9%", tth: "49.2%", tot: "50.5%" };
  function accuracyRows() {
    var rows = [];
    if (!MODEL || !SCHEDULE) return rows;
    SCHEDULE.games.forEach(function (g0) {
      var g = withLive(g0);  // ESPN 剛說打完、資料還沒更新的比賽也算
      var pi = g.s === "F" ? preGameInfo(g) : null;
      if (!pi) return;
      rows.push({ d: g.d, ok: pi.ok1, lvl: confidenceOf(pi.c.p1).key, bf: !!g.jb });  // bf = 傷病扣分是事後回補的
    });
    return rows;
  }

  function pct(a, b) { return b ? (a * 100 / b).toFixed(1) + "%" : "—"; }

  // 盤口勝率：已完賽、有記下開賽前盤口的比賽，賽前預測比分對著盤口選的邊，猜中幾次。
  // 規則和賽後頁面的 ✅ ❌ 一樣：預測剛好等於盤口的不選、實際剛好打平盤的不算輸贏。
  // 回傳 { ml, sp, tta, tth, tot }，每項 [猜中, 總次數]；單隊大小分成客隊（tta）、主隊（tth）各算一次
  function betStats() {
    var s = { ml: [0, 0], sp: [0, 0], tta: [0, 0], tth: [0, 0], tot: [0, 0] };
    if (!MODEL || !SCHEDULE) return s;
    SCHEDULE.games.forEach(function (g0) {
      var g = withLive(g0);
      var pi = g.s === "F" && g.sp != null && g.ou != null ? preGameInfo(g) : null;
      if (!pi) return;
      var pa = Number(f1(pi.c.p1.away)), ph = Number(f1(pi.c.p1.home));
      s.ml[1]++; if (pi.ok1) s.ml[0]++;
      var cover = g.hs - g.as + g.sp, pick = ph - pa + g.sp;
      if (pick !== 0 && cover !== 0) { s.sp[1]++; if ((cover > 0) === (pick > 0)) s.sp[0]++; }      var ou = function (box, pred, line, actual) {
        if (pred === line || actual === line) return;
        box[1]++; if ((actual > line) === (pred > line)) box[0]++;
      };
      ou(s.tta, pa, Number(half(g.ou / 2 + g.sp / 2)), g.as);
      ou(s.tth, ph, Number(half(g.ou / 2 - g.sp / 2)), g.hs);
      ou(s.tot, pa + ph, g.ou, g.as + g.hs);
    });
    return s;
  }

  function renderStats() {
    var rows = accuracyRows();
    var box = $("stats-page");
    if (!rows.length) { box.innerHTML = '<div class="card"><p class="odds-msg">還沒有已完賽的預測可以統計。</p></div>'; return; }
    var right = rows.filter(function (r) { return r.ok; }).length;
    var days = {}, order = [];
    rows.forEach(function (r) { if (!days[r.d]) { days[r.d] = [0, 0]; order.push(r.d); } days[r.d][1]++; if (r.ok) days[r.d][0]++; });
    order.sort();

    var html = '<div class="card acc-big"><div class="acc-label">賽前預測猜對勝負</div>' +
      '<div class="acc-num">' + right + " / " + rows.length + "<small>" + pct(right, rows.length) + "</small></div>" +
      '<p class="acc-note">三季回測 ' + BACKTEST.all + "（2503 / 3643）<br>台灣 " + Number(order[0].slice(5, 7)) + "/" + Number(order[0].slice(8)) + "起，統計 " + rows.length + " 場</p></div>";

    // 每天的明細會越來越長（每個比賽日一列），預設收起來，點開才看
    html += '<details class="card acc-details"><summary>每天（' + order.length + ' 個比賽日）</summary><table class="acc-table"><thead><tr><th>日期（台灣）</th><th>猜對</th><th>準確率</th></tr></thead><tbody>' +
      order.map(function (d) { return "<tr><td>" + fmtDate(d) + "</td><td>" + days[d][0] + " / " + days[d][1] + "</td><td>" + pct(days[d][0], days[d][1]) + "</td></tr>"; }).join("") +
      "</tbody><tfoot><tr><td>合計</td><td>" + right + " / " + rows.length + "</td><td>" + pct(right, rows.length) + "</td></tr></tfoot></table></details>";

    html += '<div class="card"><h2>依信心</h2><table class="acc-table"><thead><tr><th>信心</th><th>猜對</th><th>準確率</th><th>三季回測</th></tr></thead><tbody>' +
      [["low", "低信心"], ["mid", "中信心"], ["high", "高信心"]].map(function (x) {
        var sub = rows.filter(function (r) { return r.lvl === x[0]; });
        var ok = sub.filter(function (r) { return r.ok; }).length;
        return '<tr><td><span class="conf conf-' + x[0] + '">' + x[1] + "</span></td><td>" + ok + " / " + sub.length + "</td><td>" + pct(ok, sub.length) +
          '</td><td class="muted">' + BACKTEST[x[0]] + "</td></tr>";
      }).join("") + "</tbody></table></div>";

    // 對盤口的勝率：只算有記下開賽前盤口的比賽
    var bs = betStats();
    if (bs.ml[1]) {
      html += '<div class="card"><h2>各個玩法準確率</h2><table class="acc-table"><thead><tr><th>項目</th><th>猜中</th><th>勝率</th><th>三季回測</th></tr></thead><tbody>' +
        [["ml", "不讓分"], ["sp", "讓分"], ["tta", "客隊單隊大小"], ["tth", "主隊單隊大小"], ["tot", "總分大小"]].map(function (x) {
          return "<tr><td>" + x[1] + "</td><td>" + bs[x[0]][0] + " / " + bs[x[0]][1] + "</td><td>" + pct(bs[x[0]][0], bs[x[0]][1]) + '</td><td class="muted">' + BET_BACKTEST[x[0]] + "</td></tr>";
        }).join("") + '</tbody></table><p class="acc-note">以準確率來看，不讓分值得參考，其他太看運氣啦</p></div>';
    }

    box.innerHTML = html;
  }

  function updateBack() {
    $("back").hidden = !fromDate;
    if (fromDate) {
      $("back-link").textContent = "← 回到 " + fmtDate(fromDate) + "賽程";
      $("back-link").href = hashOf({ tab: "schedule", date: fromDate });
    }
    updateGameNav();
  }

  // ---------- 同一天的比賽之間切換（從賽程點進來才有）：上一場 / 下一場，順序和賽程列表一樣 ----------
  var dayList = [];   // 那天能點的比賽
  var dayIdx = -1;    // 目前這場在 dayList 的位置

  function updateGameNav() {
    dayList = [];
    dayIdx = -1;
    if (fromDate && gamesByDate[fromDate]) {
      dayList = gamesByDate[fromDate].map(withLive).filter(function (g) { return isClickable(g, fromDate); });
      var a = T[awaySel.value].abbr;
      var h = T[homeSel.value].abbr;
      for (var i = 0; i < dayList.length; i++) if (dayList[i].a === a && dayList[i].h === h) dayIdx = i;
    }
    var nav = $("gamenav");
    nav.hidden = dayIdx < 0 || dayList.length < 2;
    if (!nav.hidden) {
      $("game-pos").textContent = "第 " + (dayIdx + 1) + " / " + dayList.length + " 場";
      $("game-prev").disabled = dayIdx === 0;
      $("game-next").disabled = dayIdx === dayList.length - 1;
    }
  }

  function goGame(delta) {
    var g = dayList[dayIdx + delta];
    if (!g) return;
    // 用取代而不是新增瀏覽紀錄：瀏覽器的「上一頁」還是回到賽程，不會一場一場倒退
    history.replaceState(null, "", gameHash(g, fromDate));
    applyHash();
  }

  // 依網址決定要顯示哪一層、哪一場
  function applyHash() {
    var p = readHash();
    if (hasUpcoming() && (p.get("tab") === "home" || (!p.get("tab") && !p.get("away") && !p.get("home")))) {
      showTab("home");
      renderHome();
      startFinalsPoll(function () { if (!$("view-home").hidden) drawHomeStats(); });
      return;
    }
    if (hasUpcoming() && p.get("tab") === "stats") {
      showTab("stats");
      renderStats();
      startFinalsPoll(function () { if (!$("view-stats").hidden) renderStats(); });
      return;
    }
    if (VOTE_ON && p.get("tab") === "vote") {
      showTab("vote");
      var vd = p.get("date");
      renderVote(isDate(vd) && gamesByDate[vd] ? vd : (nextUpcomingDate() || lastDate));
      return;
    }
    if (hasUpcoming() && p.get("tab") === "schedule") {
      showTab("schedule");
      renderSchedule(clampDate(p.get("date") || nextGameDate(todayTW()) || lastDate));
      return;
    }
    var ak = ABBR[p.get("away")];
    var hk = ABBR[p.get("home")];
    if (ak && hk && ak !== hk) {
      awaySel.value = ak;
      homeSel.value = hk;
    }
    neutral = p.get("neutral") === "1";
    finalGame = p.get("pre") === "1" && ak && hk ? findFinal(p.get("away"), p.get("home"), p.get("date")) : null;  // 只有真的是那天已完賽的比賽才算
    pregame = !!finalGame;
    fromDate = hasUpcoming() && isDate(p.get("date")) ? p.get("date") : null;
    updateBack();
    showTab("matchup");
    render();
  }

  // 使用者自己換球隊：這就不是賽程裡的那一場了
  function onPick() {
    neutral = false;
    pregame = false;
    finalGame = null;
    fromDate = null;
    updateBack();
    replaceHash({ tab: "matchup", away: T[awaySel.value].abbr, home: T[homeSel.value].abbr });
    render();
  }

  awaySel.addEventListener("change", onPick);
  homeSel.addEventListener("change", onPick);
  $("swap").addEventListener("click", function () {
    var tmp = awaySel.value;
    awaySel.value = homeSel.value;
    homeSel.value = tmp;
    onPick();
  });

  // 使用者切換淺色/深色模式時，隊色要跟著重新調整
  // 主題選擇（白色 / 卡其 / 深色 / 黑色）的按鈕、記憶、亮起都在 index.html 的 script 裡處理；這裡只負責換色之後重畫
  var onTheme = function () { render(); if (VOTE_ON && voteDate) redrawVote(); };  // 隊色、投票條的顏色要跟著新的底色重算
  window.addEventListener("nba-theme", onTheme);
  var darkMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (darkMq) {  // 沒選過主題、系統深淺色切換時，隊色也要跟著重新調整
    var onSys = function () { if (window.nbaMarkTheme) window.nbaMarkTheme(); onTheme(); };
    if (darkMq.addEventListener) darkMq.addEventListener("change", onSys);
    else if (darkMq.addListener) darkMq.addListener(onSys);
  }

  // 分頁與賽程控制（沒有賽程、或賽程都已過去就不顯示分頁）
  if (hasUpcoming()) {
    $("tabs").hidden = false;
    $("date-input").min = minDate();
    $("date-input").max = lastDate;
    $("tab-matchup").addEventListener("click", function () {
      location.hash = hashOf({ tab: "matchup", away: T[awaySel.value].abbr, home: T[homeSel.value].abbr });
    });
    $("tab-schedule").addEventListener("click", function () {
      location.hash = hashOf({ tab: "schedule", date: curDate || nextGameDate(todayTW()) || lastDate });
    });
    $("tab-home").addEventListener("click", function () { location.hash = hashOf({ tab: "home" }); });
    if (VOTE_ON) {
      // 分頁列不放「投票」按鈕：只有首頁的「投票專區」卡片進得去
      $("vote-prev").addEventListener("click", function () { goVoteDate(prevMatchDay(voteDate)); });
      $("vote-next").addEventListener("click", function () { goVoteDate(nextMatchDay(voteDate)); });
      var onVoteClick = function (e) {
        var b = e.target.closest ? e.target.closest(".vote-btn") : null;
        if (b) castVote(voteDate, b.getAttribute("data-k"), b.getAttribute("data-s"));
      };
      $("vote-list").addEventListener("click", onVoteClick);
      $("vote-card").addEventListener("click", onVoteClick);
    }
    $("st-east").addEventListener("click", function () { stConf = "E"; renderStandings(); });
    $("st-west").addEventListener("click", function () { stConf = "W"; renderStandings(); });
    $("inj-home").addEventListener("toggle", function () { if (this.open) renderInjHome(); });  // 點開才去 ESPN 抓傷病
    $("inj-east").addEventListener("click", function () { injConf = "E"; renderInjHome(); });
    $("inj-west").addEventListener("click", function () { injConf = "W"; renderInjHome(); });
    $("tab-stats").addEventListener("click", function () { location.hash = hashOf({ tab: "stats" }); });
    // 點頁面最上面的標題也能回首頁
    var title = $("page-title");
    title.style.cursor = "pointer";
    title.addEventListener("click", function () { location.hash = hashOf({ tab: "home" }); });
    $("date-input").addEventListener("change", function () { goDate($("date-input").value); });
    $("date-prev").addEventListener("click", function () { var d = prevMatchDay(curDate); if (d) goDate(d); });
    $("date-next").addEventListener("click", function () { var d = nextMatchDay(curDate); if (d) goDate(d); });
    $("date-today").addEventListener("click", function () { goDate(todayTW()); });
  }
  // 切換場次：按鈕、鍵盤左右鍵、手機左右滑動（沒有「上一場／下一場」時都不作用）
  $("game-prev").addEventListener("click", function () { goGame(-1); });
  $("game-next").addEventListener("click", function () { goGame(1); });
  var typing = function (el) { return !!el && /^(SELECT|INPUT|TEXTAREA)$/.test(el.tagName); };  // 這些元素自己會用方向鍵
  var interactive = function (el) { return !!el && /^(SELECT|INPUT|TEXTAREA|BUTTON|A)$/.test(el.tagName); };
  document.addEventListener("keydown", function (e) {
    if ($("gamenav").hidden || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing(e.target)) return;
    if (e.key === "ArrowLeft") goGame(-1);
    else if (e.key === "ArrowRight") goGame(1);
  });
  var touch = null;
  $("view-matchup").addEventListener("touchstart", function (e) {
    touch = e.touches.length === 1 && !interactive(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  $("view-matchup").addEventListener("touchend", function (e) {
    if (!touch || $("gamenav").hidden) return;
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) goGame(dx < 0 ? 1 : -1);  // 往左滑 = 下一場
  }, { passive: true });

  window.addEventListener("hashchange", applyHash);

  if (location.hash || hasUpcoming()) {  // 沒有網址參數時，有賽程就從首頁開始
    applyHash();
  } else {
    showTab("matchup");
    render();
  }
})();
