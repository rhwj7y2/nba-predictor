// 中英切換：網站的字都是中文寫在 app.js / index.html 裡。選了英文時，這支程式在畫面上「把中文換成英文」：
//  1. 載入時決定語言（網址按鈕選過的 > 瀏覽器語言：中文就中文，其他都英文）；切換 = 存起來後重新載入頁面
//  2. 英文模式下，用 MutationObserver（畫面一有變動就通知）掃過新出現的文字節點和 placeholder / title / aria-label，
//     先套「整句規則」（RULES，數字、隊名穿插在句子中間的），再套「詞組表」（PHRASES，由長到短），
//     整個節點剛好等於某個字的用 EXACT（單字像「勝」「大」不能放進詞組表，不然會亂換）
//  3. 球隊中文名自動從 data/teams.js 的英文全名換成隊名（Hawks、Celtics …）
//  4. 留言內容（.cm-m）和輸入框不翻，那是使用者寫的
// 沒翻到的中文會留在 window.__i18nLeft（開發時用來檢查有沒有漏）
(function () {
  "use strict";
  var LANG = "";
  try { LANG = localStorage.getItem("nba-lang") || ""; } catch (e) { /* 讀不到就用瀏覽器語言 */ }
  if (LANG !== "zh" && LANG !== "en") LANG = /^zh/i.test(navigator.language || "") ? "zh" : "en";
  window.NBA_LANG = LANG;
  document.documentElement.lang = LANG === "en" ? "en" : "zh-Hant";

  window.nbaSetLang = function (l) {
    try { localStorage.setItem("nba-lang", l); } catch (e) { /* 存不了就只有這次有效 */ }
    location.reload();
  };
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("#lang-btn") : null;
    if (b) window.nbaSetLang(LANG === "en" ? "zh" : "en");
  });
  function markBtn() {
    var b = document.getElementById("lang-btn");
    if (b) { b.textContent = LANG === "en" ? "中文" : "EN"; b.setAttribute("aria-label", LANG === "en" ? "切換成中文" : "Switch to English"); b.setAttribute("lang", LANG === "en" ? "zh-Hant" : "en"); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markBtn); else markBtn();

  if (LANG !== "en") return;

  // ---------------- 詞組表（出現在句子裡的片段；由長到短套用） ----------------
  var P = {
    // 標題、說明、頁尾
    "NBA 賽季前對戰預測": "NBA Preseason Matchup Predictor",
    "NBA 勝負預測": "NBA Game Predictor",
    "勝負預測": "Game Predictor",
    "用 NBA 例行賽數據，預測任意兩支 NBA 球隊對戰的比分與勝負。": "Predict the score and winner of any NBA matchup from regular-season data.",
    "資料說明：": "Note: ",
    "整理自": "Compiled from",
    "例行賽": "regular season",
    "僅供興趣參考，非投注建議!!": "For fun and reference only. Not betting advice!!",
    "非投注建議，娛樂參考 !": "Not betting advice. For entertainment only!",
    "比賽在": "Games on ",
    "賽後更新納入傷病": " were re-run after injuries were added",
    "新的PACE、球隊評分算法": "with the new PACE and team-rating formulas,",
    "因此比分與之前有所差異": "so the scores differ from the earlier ones",
    // 主題與導覽
    "選擇主題": "Choose theme",
    "主題": "Theme",
    "白色": "White", "卡其": "Khaki", "粉色": "Pink", "藍綠": "Teal", "淺藍": "Light blue", "深色": "Dark", "黑色": "Black",
    "頁面切換": "Page navigation",
    "首頁": "Home",
    "自選對戰": "Custom matchup",
    "準確率": "Accuracy",
    "賽程與預測": "Schedule & predictions",
    "賽程": "Schedule",
    "📊 統計數據": "📊 Stats",
    "選擇分區": "Choose conference",
    "排名": "Standings",
    "全聯盟": "League",
    "東區": "East",
    "西區": "West",
    "左右滑動看更多欄位；點欄位標題可以排序": "Swipe sideways for more columns; tap a column title to sort",
    "前一個比賽日": "Previous game day",
    "後一個比賽日": "Next game day",
    "選擇日期（台灣日期）": "Choose date (Taiwan date)",
    "← 回到賽程": "← Back to schedule",
    "← 回到": "← Back to",
    "◀ 上一場": "◀ Previous game",
    "下一場 ▶": "Next game ▶",
    "客隊（客場）": "Away team",
    "交換主客場": "Swap home / away",
    "主隊（主場）": "Home team",
    "中立場地：這場沒有主場，預測不加主場優勢。": "Neutral site: no home court, so no home-court advantage is added to the prediction.",
    "選擇球隊": "Choose team",
    "指標": "Metric",
    "數據來源與說明": "Data sources & notes",
    // 首頁
    "今日賽果": "Today's results",
    "最新賽果": "Latest results",
    "明日賽程": "Tomorrow's schedule",
    "下個賽程": "Next schedule",
    "明天的比賽預測": "Tomorrow's predictions",
    "的比賽預測": " game predictions",
    "展開看預測": "Show predictions",
    "展開看": "Show",
    "場預測": " predictions",
    "🎯 準確率": "🎯 Accuracy",
    "📅 賽程": "📅 Schedule",
    "今天": "Today",
    "明天": "Tomorrow",
    "🚑 傷病名單": "🚑 Injury report",
    "11/8 開始有納入傷病": "Injuries have been factored in since 11/8",
    "目前沒有傷病名單": "No injury report right now",
    "傷病名單暫時抓不到，稍後重新整理再試。": "Can't load the injury report right now. Refresh in a bit to retry.",
    "只列場均上場時間超過 5 分鐘的球員": "Only players averaging more than 5 minutes are listed",
    // 狀態
    "已完賽": "Final",
    "進行中": "In progress",
    "延期或取消": "Postponed or cancelled",
    "待定": "TBD",
    "墨西哥城例行賽": "Mexico City game",
    "巴黎例行賽": "Paris game",
    "曼徹斯特例行賽": "Manchester game",
    "NBA 盃小組賽": "NBA Cup group stage",
    "NBA 盃八強": "NBA Cup quarterfinal",
    "NBA 盃四強": "NBA Cup semifinal",
    "NBA 盃決賽（不計入例行賽戰績）": "NBA Cup final (not counted in the regular-season record)",
    "中立場地-墨西哥": "Neutral site - Mexico",
    "中立場地": "Neutral site",
    "墨西哥": "Mexico",
    "兩隊要等前一輪打完才決定": "The teams are decided after the previous round",
    "這天已經過去，更新資料後會顯示結果": "This day has passed. Results will show after the next data update.",
    "沒有比賽。": "No games.",
    "跳到下一個比賽日：": "Jump to the next game day: ",
    "當天預測正確": "Correct picks that day: ",
    "場、預測失敗": " · wrong: ",
    "預測正確": "Prediction correct",
    "預測失敗": "Prediction wrong",
    "賽前預測比分：": "Pre-game predicted score: ",
    "賽前預測比分": "Pre-game predicted score",
    "賽前預測猜對勝負": "Pre-game winner picks correct",
    "賽前預測": "Pre-game prediction",
    "預測信心": "Confidence",
    "預測分差": "Predicted margin",
    "實力評分": "Team rating",
    "我們預測的勝率：客隊": "Our predicted win probability: away ",
    "賭盤預估勝率（去抽水）：客隊": "Market-implied win probability (vig removed): away ",
    "賭盤勝率（賽前）": "Market win prob. (pre-game)",
    "賭盤勝率": "Market win prob.",
    "模型勝率": "Model win prob.",
    "%｜主隊": "% | home ",
    "延長": "OT",
    "中場": "Halftime",
    "結束": "End of",
    // 信心
    "低信心": "Low confidence",
    "中信心": "Medium confidence",
    "高信心": "High confidence",
    "信心": "Confidence",
    // 球隊對照
    "上季數據對照": "Last season stats",
    "本季數據對照": "Season stats comparison",
    "上季季末": "end of last season",
    "本季戰績": "Season record",
    "整季戰績": "Full-season record",
    "主場戰績": "Home record",
    "客場戰績": "Road record",
    "每百回合得分": "Points per 100 possessions",
    "每百回合失分": "Points allowed per 100 possessions",
    "場均得分": "Points per game",
    "場均失分": "Points allowed per game",
    "近 10 場戰績": "Last 10 record",
    "近 10 場得分": "Last 10 points",
    "近 10 場失分": "Last 10 points allowed",
    "近 10 場 PACE": "Last 10 PACE",
    "近 5 場 PACE": "Last 5 PACE",
    "PACE（本季）": "PACE (season)",
    "進攻籃板": "Off. rebounds",
    "防守籃板": "Def. rebounds",
    "三分出手": "3PA",
    "三分%": "3P%",
    "投籃%": "FG%",
    "助攻": "Assists",
    "阻攻": "Blocks",
    "失誤": "Turnovers",
    "失分": "OPP",
    "得分": "PTS",
    "勝差": "GB",
    "近況": "Streak",
    "球隊": "Team",
    "聯盟第": "Rank ",
    "較優": "better",
    "上上上季": "3 seasons ago",
    "上上季": "2 seasons ago",
    "本季": "This season",
    "上季": "Last season",
    "統計三季（": "Last three seasons (",
    "沒有交手": "No games played",
    "例行賽沒有交手": "regular season: no games played",
    "例行賽對戰": "regular season matchups",
    "交手紀錄的球季": "Season for head-to-head record",
    "平均比分": "Average score",
    "最近五場戰績": "Last five games",
    "目前使用": "Using",
    // 預測頁
    "客隊和主隊不能是同一支球隊，請重新選擇。": "The away and home teams can't be the same. Please choose again.",
    "本季尚未出賽，暫時無法預測。": "No games played this season yet, so no prediction is available.",
    "事後回補傷病：": "Injuries added after the game: ",
    "已納入傷病：": "Injuries included: ",
    "未納入傷病：": "Injuries not included: ",
    "預測": "Predicted",
    "手": "Hand", "腿": "Leg",
    "客隊": "Away",
    "主隊": "Home",
    "已打": "Played",
    "分，總分": ", total ",
    // 賭盤
    "賭盤變化": "Betting line movement",
    "賭盤結果": "Betting line result",
    "不讓分（賠率）": "Moneyline (odds)",
    "不讓分": "Moneyline",
    "讓分": "Spread",
    "單隊總分": "Team total",
    "單隊大小": "Team over/under",
    "總分大小": "Total over/under",
    "總分": "Total",
    "合計": "Total",
    "初始：ESPN 沒有提供初始時間": "Open: ESPN did not provide the opening time",
    "最終：": "Close: ",
    "最新資訊更新時間": "Last updated",
    "初始": "Open",
    "最終": "Close",
    "勝率": "Win prob.",
    "模型": "Model",
    "載入中…": "Loading…",
    "經 ESPN 取得 DraftKings 的賭盤概況，開賽前最後的盤口": "Betting overview from DraftKings via ESPN: the final line before tip-off",
    "經 ESPN 取得 DraftKings 的賭盤概況，這場已開賽，盤口定案在開賽前最後記錄的數字": "Betting overview from DraftKings via ESPN: the game has started, and the line is locked at the last number recorded before tip-off",
    "經 ESPN 取得 DraftKings 的賭盤概況，目前抓不到即時盤口，這是最近一次記錄的盤口": "Betting overview from DraftKings via ESPN: live lines can't be fetched right now, so this is the most recently recorded line",
    "經 ESPN 取得 DraftKings 的賭盤概況": "Betting overview from DraftKings via ESPN",
    "賭鬼 這場目前沒抓到賭盤 請晚點再來!!": "No betting line found for this game yet. Please check back later!!",
    "盤口暫時抓不到，稍後重新整理再試。": "Can't load the betting line right now. Refresh in a bit to retry.",
    "即時抓取": "Live",
    // 球員
    "大三元（得分、籃板、助攻都 10 以上）": "Triple-double (10+ points, rebounds and assists)",
    "本場得分前三球員": "Top three scorers in this game",
    "本季輪替陣容球員": "This season's rotation players",
    "輪替陣容": "rotation",
    "只記錄場均上場時間 &gt;": "Only players averaging more than",
    "只記錄場均上場時間 >": "Only players averaging more than",
    "分鐘的球員": "minutes are listed",
    "目前沒有符合條件的球員": "No players meet the criteria right now",
    "還沒有已完賽的比賽": "No finished games yet",
    "籃板": "Rebounds",
    "上場": "Min",
    // 傷病
    "預計回歸": "Expected back",
    "出賽成疑": "Questionable",
    "預計缺陣": "Out",
    "整季報銷": "Out for season",
    "每日觀察": "Day-to-day",
    "確定不出賽": "Out",
    "臨場決定": "Game-time decision",
    "不太可能出賽": "Unlikely to play",
    "預計會出賽": "Expected to play",
    "傷勢未公開": "Undisclosed",
    "阿基里斯腱": "Achilles", "膝蓋": "Knee", "腳趾": "Toe", "髖部": "Hip", "腳踝": "Ankle", "腳掌": "Foot", "眼睛": "Eye",
    "生病": "Illness", "大腿前側": "Quad", "大腿後側": "Hamstring", "大腿": "Thigh", "腳跟": "Heel", "背部": "Back", "小腿": "Calf",
    "鼠蹊": "Groin", "手肘": "Elbow", "手腕": "Wrist", "頸部": "Neck", "肋骨": "Rib", "手指": "Finger", "頭部": "Head", "胸部": "Chest",
    "腹部": "Abdomen", "前臂": "Forearm", "肩膀": "Shoulder",
    "腦震盪": "concussion", "發炎": "inflammation", "骨折": "fracture", "擦傷": "abrasion", "痠痛": "soreness", "瘀傷": "bruise",
    "扭傷": "sprain", "拉傷": "strain", "手術": "surgery", "痙攣": "spasms", "脫臼": "dislocation", "神經夾擠": "pinched nerve",
    "緊繃": "tightness", "肌腱炎": "tendinitis", "挫傷": "contusion", "撕裂傷": "laceration", "撕裂": "tear",
    // 留言
    "💬 意見交流區": "💬 Feedback board",
    "💬 留言": "💬 Comments",
    "說點什麼吧（匿名，最多": "Say something (anonymous, max ",
    "還沒有人留言，來當第一個吧": "No comments yet. Be the first!",
    "更早的留言（": "Older comments (",
    "慢一點，請等": "Slow down, please wait",
    "秒再留言": "s before commenting again",
    "留言沒送出去，請晚點再試!!": "Comment not sent. Please try again later!!",
    "送出": "Send",
    // 準確率
    "還沒有已完賽的預測可以統計。": "No finished predictions to count yet.",
    "三季回測": "3-season backtest",
    "個比賽日）": " game days)",
    "日期（台灣）": "Date (Taiwan)",
    "各個玩法準確率": "Accuracy by bet type",
    "依信心": "By confidence",
    "以準確率來看，不讓分值得參考，其他太看運氣啦": "By accuracy, only the moneyline pick is worth a look; the rest is mostly luck",
    "以準確率來看，不讓分值得參考，": "By accuracy, only the moneyline pick is worth a look; ",
    "其他的你自己看吧🙂": "the rest is up to you🙂",
    "項目": "Item",
    "猜中": "Hits",
    "猜對": "Correct",
    "起，統計": ", counting",
    "台灣": "Taiwan ",
    // 其他
    "送出了": "Sent"
  };
  // 整個節點剛好等於這些字才換（單字、極短的字不能用在詞組表）
  var X = {
    "勝": "W", "敗": "L", "場": "games", "人": "players", "分": "pts", "大": "Over", "小": "Under", "總": "Total", "近": "Last",
    "對": "vs", "第": "", "節": "", "左": "Left", "右": "Right", "手": "Hand", "腿": "Leg", "其他": "Other", "觀察": "Watch",
    "預計": "Expected", "回歸": "return", "缺陣": "Out", "球隊": "Team", "賽程": "Schedule", "無": "None", "場）": " games)",
    "連勝": "W streak", "連敗": "L streak", "更新": "Updated", "客隊": "Away", "主隊": "Home", "總分": "Total",
    "上季": "Last season", "本季": "This season", "不讓分": "Moneyline", "讓分": "Spread", "準確率": "Accuracy"
  };
  var WEEK = { "日": "Sun", "一": "Mon", "二": "Tue", "三": "Wed", "四": "Thu", "五": "Fri", "六": "Sat" };

  // ---------------- 整句規則（數字、隊名夾在句子中間；先套這些） ----------------
  var R = [
    [/經 ESPN 取得，台灣時間 (\S+) 更新；只列場均上場時間超過 5 分鐘的球員；預計回歸日期為台灣日期；出賽狀態取自 2 天內的傷病快訊，沒標示代表 ESPN 沒有更新/,
      "From ESPN, updated at $1 Taiwan time. Only players averaging more than 5 minutes are listed; expected return dates are Taiwan dates; game status comes from injury news in the last 2 days, and no label means ESPN has no update"],
    [/經 ESPN 取得，台灣時間 (\S+) 更新$/, "From ESPN, updated at $1 Taiwan time"],
    [/^(\S+) 勝$/, "$1 win"],
    [/^([勝敗]) ([▲▼])$/, function (m, c, ar) { return (c === "勝" ? "W " : "L ") + ar; }],
    [/台灣 (\d+\/\d+)起，統計 (\d+) 場/, "Since $1 (Taiwan time), $2 games counted"],
    [/預計\s*(\d+\/\d+)\s*回歸/g, "Expected back $1"],
    [/對([一-鿿]{2,4}) ([一-鿿]+)/g, "$2 vs $1"],
    [/缺陣 (\d+)/g, "Out $1"],
    [/觀察 (\d+)/g, "Day-to-day $1"],
    [/^第 (\d+) \/ (\d+) 場$/, "Game $1 of $2"],
    [/^([\d.]+) 大$/, "Over $1"],
    [/^([\d.]+) 小$/, "Under $1"],
    [/（([日一二三四五六])）/g, function (m, d) { return " (" + WEEK[d] + ")"; }],
    [/預測分差\s*([+\-−]?[\d.]+)\s*分，總分\s*([\d.]+)\s*分/g, "Predicted margin $1, total $2"],
    [/目前使用\s*(\S+)\s*例行賽的數據（凍結在\s*([^）]+)），當作\s*(\S+)\s*開季前的預測，所以準確度有限：賽季前預估的勝負命中率約\s*60%。（66.5% 是賽季中、用本季累積數據的回測數字，不適用於賽季前預測。）新球季開打後，數據會更新。/,
      "Using $1 regular-season data (frozen as of $2) as the preseason forecast for $3, so accuracy is limited: preseason winner picks hit about 60%. (66.5% is the in-season backtest figure using this season's accumulating data and does not apply to preseason predictions.) Data will update once the new season starts."],
    [/整理自\s*(\S+)\s*例行賽已完成的\s*([\d,]+)\s*場/, "Compiled from $2 completed $1 regular-season games"],
    [/整理自\s*(\S+)\s*例行賽\s*([\d,]+)\s*場/, "Compiled from $2 $1 regular-season games"],
    [/(\d+)\s*勝\s*(\d+)\s*敗/g, "$1W-$2L"],
    [/(\d+)\s*連勝/g, "W$1"],
    [/(\d+)\s*連敗/g, "L$1"],
    [/聯盟第\s*(\d+)/g, "#$1 in league"],
    [/統計三季（([^）]+)）/, "Last three seasons ($1)"],
    [/第\s*(\d+)\s*節/g, "Q$1"],
    [/每天（(\d+) 個比賽日）/, "By day ($1 game days)"],
    [/([\d\/]+~[\d\/]+) 比賽在([\d\/]+)賽後更新納入傷病/, "Games $1 were re-predicted after $2 with injuries factored in"]
  ];
  // 詞組表套完之後，剩下的「數字＋單位」
  var R2 = [
    [/左(?=[\u0001A-Z])/g, "Left "],
    [/右(?=[\u0001A-Z])/g, "Right "],
    [/近\s*(\d+)\s*場/g, "last $1"],
    [/(\d+)\s*場/g, function (m, n) { return n + (n === "1" ? " game" : " games"); }],
    [/(\d+)\s*人/g, function (m, n) { return n + (n === "1" ? " player" : " players"); }],
    [/(\d+)\s*分鐘/g, "$1 min"],
    [/(\d+)\s*秒/g, "$1 s"],
    [/([\d.+\-−]+)\s*分(?![鐘差])/g, "$1"]
  ];

  var TEAMS = {};   // 中文隊名 -> 英文隊名
  (function () {
    var D = window.NBA_DATA;
    if (!D || !D.teams) return;
    Object.keys(D.teams).forEach(function (k) {
      var t = D.teams[k], nick = /Trail Blazers$/.test(k) ? "Trail Blazers" : k.split(" ").pop();
      if (t.zh) TEAMS[t.zh] = nick;
    });
  })();

  var HAN = /[　-〿一-鿿＀-￯]/;
  var PUNCT = { "・": " · ", "（": " (", "）": ") ", "，": ", ", "：": ": ", "、": ", ", "。": ". ", "；": "; ", "｜": " | ", "～": "~", "！": "!", "？": "?" };
  var keys = Object.keys(P).concat(Object.keys(TEAMS)).sort(function (a, b) { return b.length - a.length; });
  var ALL = {};
  Object.keys(P).forEach(function (k) { ALL[k] = P[k]; });
  Object.keys(TEAMS).forEach(function (k) { ALL[k] = TEAMS[k]; });
  var PHRASE_RE = new RegExp(keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|"), "g");
  var MARK_A = "\u0001", MARK_B = "\u0002";

  function translate(s, tag) {
    if (!HAN.test(s)) return s;
    var lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0], core = s.trim();
    if (core === "勝" && lead) return lead + "win" + trail;  // 「預測 <b>隊名</b> 勝」後面那個字
    if ((core === "勝" || core === "敗") && tag !== "TH") return lead + (core === "勝" ? "Win" : "Loss") + trail;  // 表頭才縮寫成 W / L
    if (core === "勝率" && tag === "TH") return lead + "Win rate" + trail;
    if (X.hasOwnProperty(core)) return lead + X[core] + trail;
    if (TEAMS.hasOwnProperty(core)) return lead + TEAMS[core] + trail;
    var out = core;
    R.forEach(function (r) { out = out.replace(r[0], r[1]); });
    out = out.replace(PHRASE_RE, function (m) { return MARK_A + ALL[m] + MARK_B; });
    R2.forEach(function (r) { out = out.replace(r[0], r[1]); });
    out = out.replace(/[・（）｜，：、。；～！？]/g, function (c) { return PUNCT[c]; });
    // 詞組之間、詞組和英數字之間補空格；再把標點前多餘的空格收掉
    out = out.replace(new RegExp(MARK_B + "(?=[" + MARK_A + "A-Za-z0-9(])", "g"), " ")
      .replace(new RegExp("([A-Za-z0-9%)])(?=" + MARK_A + ")", "g"), "$1 ")
      .replace(new RegExp("[" + MARK_A + MARK_B + "]", "g"), "")
      .replace(/ {2,}/g, " ").replace(/ ([,.;:!?)])/g, "$1").replace(/\( /g, "(").trim();
    return lead + out + trail;
  }
  window.nbaTranslate = translate;

  var left = window.__i18nLeft = {};
  var ATTRS = ["placeholder", "title", "aria-label", "content", "alt"];
  var skipSel = ".cm-m, textarea, script, style, [translate=no]";

  function skip(n) {
    var el = n.nodeType === 3 ? n.parentNode : n;
    return !el || !el.closest || !!el.closest(skipSel);
  }
  var SHORT_CONF = { "低信心": "Low conf.", "中信心": "Med. conf.", "高信心": "High conf." };  // 卡片右下角空間小，用縮寫（不然會和勝率條下面的小字重疊）
  function doText(n) {
    var v = n.nodeValue;
    if (!HAN.test(v) || skip(n)) return;
    var sc = SHORT_CONF[v.trim()];
    if (sc && n.parentNode.closest && n.parentNode.closest(".gm-conf-c")) { n.nodeValue = sc; return; }
    var t = translate(v, n.parentNode && n.parentNode.nodeName);
    // 手機上隊名欄很窄：最長的 Timberwolves 在 Timber / wolves 中間給一個可以換行的位置（零寬空格，看不到）
    if (t.trim() === "Timberwolves" && n.parentNode.closest && n.parentNode.closest(".gm-name")) t = "Timber\u200bwolves";
    if (t !== v) n.nodeValue = t;
    if (HAN.test(t)) left[t] = 1;
  }
  function doAttrs(el) {
    if (!el.getAttribute || skip(el)) return;
    ATTRS.forEach(function (a) {
      var v = el.getAttribute(a);
      if (v && HAN.test(v)) {
        var t = translate(v);
        if (t !== v) el.setAttribute(a, t);
        if (HAN.test(t)) left[t] = 1;
      }
    });
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }

  var obs = new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === "characterData") doText(m.target);
      else if (m.type === "attributes") doAttrs(m.target);
      else m.addedNodes.forEach(walk);
    });
  });
  function start() {
    document.title = translate(document.title);
    walk(document.documentElement);
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  start();
})();
