# -*- coding: utf-8 -*-
"""
把 raw/ 裡的例行賽原始資料，整理成網頁用的 data/teams.js。

只收例行賽（日期 <= REGULAR_SEASON_END，再排除 EXCLUDED_GAMES 的盃賽決賽），不含附加賽/季後賽。
注意不能用「前 1230 場」切例行賽：盃賽決賽會被算進去。
新球季的比分由 fetch_espn_games.py 寫進 raw/，每次更新：先跑它，再跑這支。

兩種模式（改下面的 SEASON_COMPLETE，或執行時加 --complete / --in-progress 臨時覆蓋）：
- 整季完成：嚴格檢查 1230 場、每隊 82 場、435 組對戰，網頁 mode = "preseason"（拿整季數據當下一季的賽季前預測）
- 進行中：改檢查每隊場數 <= 82、主客場各 <= 41、沒有重複比賽、沒有未來日期，網頁 mode = "in_season"

執行：python build_data.py
"""
import argparse
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from collections import defaultdict

import store

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
SEASON_LABEL = "2026-27"
SEASON_COMPLETE = False  # True = 整季已打完；False = 球季進行中
PACE_FILE = "pace_2025-26.txt"  # 只有「整季完成」模式（賽季前預測）用這個檔
TOP_SCORERS = 3  # 每隊列出場均得分最高的幾位
# 球員等級（依場均得分，由高到低；(最低場均得分, 名稱)）。25+ 超級球星／20~25 球星／15~20 主力／10~15 角色球員／10 以下 板凳
PLAYER_TIERS = [(25.0, "超級球星"), (20.0, "球星"), (15.0, "主力"), (10.0, "角色球員"), (0.0, "板凳")]
# 傷病扣分（球員缺陣時，加在兩隊預測分差上的分數）：等級 -> 扣幾分；板凳（等級 5）不扣。
# 數字由去年（2025-26）1,214 場逐場回測決定：超級球星 3.1、球星 1.8、主力 0.9、角色球員 1.9（分差誤差 11.47 -> 11.10）
INJURY_DEDUCT = {1: 3.0, 2: 2.0, 3: 1.5, 4: 1.5}
INJURY_MIN_GP = 3  # 本季至少出賽幾場才有等級可扣（場數太少的場均得分不可靠）
INJURY_STALE_HOURS = 48  # 傷病名單抓取超過這麼久就不拿來重算（避免用很舊的名單蓋掉比賽的扣分）
INJURY_HORIZON_HOURS = 48  # 只對「未來這麼多小時內要開打」的比賽扣分：更遠的比賽，現在的缺陣名單到時候多半已經變了，不扣
B2B_DEDUCT = 2.0     # 連兩天：這隊的預測分差扣幾分（三季回測：連兩天的球隊平均比預測少約 1.25 分；只動分差、不動總分，因為對手平均反而多拿約 1 分，總分沒偏）
B2B_FROM = "2026-11-01"  # 台灣日期，這天起的比賽套用連兩天扣分。11/1~11/8 是 11/9 上線時才補套用的（連兩天賽前就查得到，沒有用到結果）
# 兩隊歷史對戰節奏（PACE）調整預測總分：這兩隊碰面時，回合數常比「兩隊本季平均」多或少，用過去的碰面來修正（只動總分、不動分差）。
# 資料表 h2h_pace（過去三季每組兩隊的節奏殘差總和，由 make_h2h_pace_history.py 產生）加上本季已打的碰面。
# 調整量 = 乘數 × 殘差總和 ÷（碰面場數 + K）：K = 收縮（碰面少時不全信）、乘數 = 每多 1 個回合約多幾分（兩隊各約 1.15 分／回合）。
# 三季回測（驗證 2,550 場）：總分誤差 15.175 -> 15.066，大小分猜對率 48.2% -> 49.5%
H2H_PACE_K = 6
H2H_PACE_MULT = 2.3
H2H_PACE_FROM = "2026-11-01"  # 台灣日期，這天起的比賽套用。11/1~11/8 是 11/9 上線時才補套用的（每場只用它之前的碰面，沒有用到結果）
RETRO_UNTIL = "2026-11-08"  # 到這天為止的連兩天、對戰節奏調整是事後補套用的（網頁頁尾會註明）
H2H_SHRINK_GAMES = 5  # 預估節奏往聯盟平均拉回的場數（和 make_h2h_pace_history.py 同一套算法）
INJURY_BACKFILL_UNTIL = "2026-11-08"  # 台灣日期，這天以前（不含）已完賽的比賽可以「事後回補」傷病扣分（當時還沒有傷病扣分）
# 賽程分頁最早能看到的台灣日期：這天起的已完賽比賽會顯示「賽前預測比分 + 結果」，
# 但只有「最近一個比賽日」的比賽能點進去看完整預測，更早的只能看卡片。
# 想讓大家往前多看幾天，改這個日期（fetch_espn_games.py 的 SCHEDULE_START 也要跟著提早一天，再重抓）。
SCHEDULE_SHOW_FROM = "2026-11-01"
# ESPN 的比賽備註 -> 網頁上顯示的標籤
SCHEDULE_TAGS = {
    "NBA Cup - Group Play": "NBA 盃小組賽", "NBA Cup - Quarterfinals": "NBA 盃八強", "NBA Cup - Semifinals": "NBA 盃四強",
    "NBA Cup Championship": "NBA 盃決賽（不計入例行賽戰績）", "NBA Mexico City Game": "墨西哥城例行賽",
    "NBA Paris Game": "巴黎例行賽", "NBA Manchester Game": "曼徹斯特例行賽",
}
REGULAR_SEASON_GAMES = 1230  # 30隊 x 82場 / 2
REGULAR_SEASON_END = datetime(2027, 4, 11)  # 例行賽最後一天，之後是附加賽/季後賽
# 原始資料混有一場「NBA盃決賽」(不計入例行賽戰績)，要排除：(日期, 客隊, 主隊)
# 只比對日期和隊伍，不比對比分（決賽打完前不知道比分，資料有一分誤差也不會漏排）。
# 2026-27 的盃賽決賽（2026-12-11）打完後會自動排除：cup_final_games() 從賽程備註「NBA Cup Championship」找出來，
# 所以不用手動加；這裡只留給其他想手動排除的比賽。盃賽小組賽、八強、四強都算例行賽，不用排除。
EXCLUDED_GAMES = set()

# 上一季整季資料：球季進行中時，(1) 網頁顯示「上季兩隊交手紀錄」，(2) 當作本季球隊評分的開季起點（見下面 SRS，
# 起點只打五折，本季打得越多越以本季為準）。不想用就設成 None（交手紀錄不顯示、起點變成「每隊都是 0」）。
PREV_SEASON = {
    "label": "2025-26",
    "end": datetime(2026, 4, 12),
    "excluded": {(datetime(2025, 12, 16), "San Antonio Spurs", "New York Knicks")},
}
# 球季進行中的預測模型 ①「實力評分法」：
#   球隊評分 = SRS（考慮對手強弱的評分，單位是分）＋ 上季評分當開季起點，算法見下面 srs_ratings()
#   預測分差 = 主隊評分 - 客隊評分 + homeAdv（中立場地 0），再減傷病、連兩天扣分差
#   預測總分 = 整季場均得失分平均與近10場場均得失分平均，兩者按 recentWeight 混合（不用 PACE；這部分沒變）
#   主隊 = 總分/2 + 分差/2，客隊 = 總分/2 - 分差/2
# recentWeight：只用在預測總分。回測三季：純整季猜對 2408 / 3643，純近10場 2368，各占一半（0.5）2416。
# homeAdv：主場優勢（分），三季實測主場平均多贏 +1.6 ~ +2.2。
# shrinkK：舊版球隊評分（整季、近10場淨勝分往平均拉回）的參數。球隊評分改用 SRS 之後，網頁只在資料檔沒有 rating 欄位時
#   才退回舊公式，所以還留著。
# SRS 球隊評分（三季逐場回測，每場只用賽前資料，共 3,643 場，含傷病、連兩天扣分）：不讓分 68.02% -> 68.7%，分差平均誤差 11.02 -> 10.90，
#   三季每一季都進步；本季（2026-27）已打 123 場（不含傷病扣分）65.0% -> 68.3%；上季權重 0.3~0.7 之間都有效，取 0.5。
#   lam：把每隊評分往起點拉的力道，等於假裝每隊多打 lam 場「表現剛好等於起點」的比賽
#   halfLife：比賽的權重每過這麼多天減半（越近的比賽越重要）
#   prevWeight：上季評分當起點時打幾折
MODEL = {"shrinkK": 5, "homeAdv": 2, "recentWeight": 0.5}
SRS = {"lam": 5, "halfLife": 60, "prevWeight": 0.5}

# 開盤冷門觀察名單（實驗功能）規則 v1：凍結，上線後不准改；要改就開 v2、重新計算，不要動這個。
#   minOdds：被選那隊「目前」的小數賠率至少多少；minEdge：模型勝率 - 市場去抽水勝率至少多少；
#   sigma：模型分差換成勝率用的標準差（勝率 = Φ(分差 / sigma)）；horizonHours：只看未來幾小時內要開打的比賽
UPSET_RULE = {"version": "v1", "minOdds": 2.0, "minEdge": 0.06, "sigma": 13.5, "horizonHours": 48}

# 英文隊名 -> (縮寫, 中文名, 分區, 代表色)
TEAMS = {
    "Atlanta Hawks": ("ATL", "老鷹", "E", "#E03A3E"),
    "Boston Celtics": ("BOS", "塞爾提克", "E", "#007A33"),
    "Brooklyn Nets": ("BKN", "籃網", "E", "#5B5B5B"),
    "Charlotte Hornets": ("CHA", "黃蜂", "E", "#1D8CAB"),
    "Chicago Bulls": ("CHI", "公牛", "E", "#CE1141"),
    "Cleveland Cavaliers": ("CLE", "騎士", "E", "#860038"),
    "Dallas Mavericks": ("DAL", "獨行俠", "W", "#00538C"),
    "Denver Nuggets": ("DEN", "金塊", "W", "#FEC524"),
    "Detroit Pistons": ("DET", "活塞", "E", "#C8102E"),
    "Golden State Warriors": ("GSW", "勇士", "W", "#1D428A"),
    "Houston Rockets": ("HOU", "火箭", "W", "#CE1141"),
    "Indiana Pacers": ("IND", "溜馬", "E", "#FDBB30"),
    "Los Angeles Clippers": ("LAC", "快艇", "W", "#C8102E"),
    "Los Angeles Lakers": ("LAL", "湖人", "W", "#552583"),
    "Memphis Grizzlies": ("MEM", "灰熊", "W", "#5D76A9"),
    "Miami Heat": ("MIA", "熱火", "E", "#98002E"),
    "Milwaukee Bucks": ("MIL", "公鹿", "E", "#00471B"),
    "Minnesota Timberwolves": ("MIN", "灰狼", "W", "#236192"),
    "New Orleans Pelicans": ("NOP", "鵜鶘", "W", "#85714D"),
    "New York Knicks": ("NYK", "尼克", "E", "#F58426"),
    "Oklahoma City Thunder": ("OKC", "雷霆", "W", "#007AC1"),
    "Orlando Magic": ("ORL", "魔術", "E", "#0077C0"),
    "Philadelphia 76ers": ("PHI", "七六人", "E", "#006BB6"),
    "Phoenix Suns": ("PHX", "太陽", "W", "#E56020"),
    "Portland Trail Blazers": ("POR", "拓荒者", "W", "#E03A3E"),
    "Sacramento Kings": ("SAC", "國王", "W", "#5A2D81"),
    "San Antonio Spurs": ("SAS", "馬刺", "W", "#8A8D8F"),
    "Toronto Raptors": ("TOR", "暴龍", "E", "#CE1141"),
    "Utah Jazz": ("UTA", "爵士", "W", "#F9A01B"),
    "Washington Wizards": ("WAS", "巫師", "E", "#002B5C"),
}


def _solve(A, b):
    """高斯消去法（部分選主元），解 A x = b。A 是 n×n list，b 是長度 n 的 list。
    （GitHub Actions 沒有裝 numpy，所以用純 Python 解 30×30 聯立方程式。）"""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        for r in range(c + 1, n):
            f = M[r][c] / M[c][c]
            if f:
                for k in range(c, n + 1):
                    M[r][k] -= f * M[c][k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (M[r][n] - sum(M[r][k] * x[k] for k in range(r + 1, n))) / M[r][r]
    return x


def srs_ratings(games, prior, neutral=frozenset(), lam=None, half_life=None):
    """考慮對手強弱的球隊評分（SRS，加權脊迴歸）。

    games：[(美東日期 datetime, 客隊, 客隊得分, 主隊, 主隊得分)]（只能放預測日以前的比賽）；
    prior：{隊名: 起點評分}；neutral：{(美東日期 date, 客隊, 主隊)} 中立場地（主場優勢用 0）。
    half_life：None = 用 SRS 的 halfLife（60 天）；0 = 不衰減（每場權重都是 1）。
    回傳 {隊名: 評分}（越高越強，單位是分）。

    每場比賽列一個式子：主隊分差 - 主場優勢 ≈ 主隊評分 - 客隊評分。
    每場權重 w = 0.5 ** (距預測日的天數 / halfLife)，預測日 = 這批比賽最後一天 + 1 天。
    再加一項把每隊評分往 prior 拉的懲罰（力道 lam），用最小平方法解出 30 隊評分。
    打過強隊的贏球比打過弱隊的贏球更值錢，這是它比「只看場均得失分」準的地方。
    """
    lam = SRS["lam"] if lam is None else lam
    hl = SRS["halfLife"] if half_life is None else half_life
    teams = list(TEAMS)
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    A = [[lam if i == j else 0.0 for j in range(n)] for i in range(n)]
    b = [lam * prior.get(t, 0.0) for t in teams]
    if games:
        ref = max(g[0] for g in games) + timedelta(days=1)
        for d, vis, vpts, home, hpts in games:
            w = 0.5 ** ((ref - d).days / hl) if hl else 1.0
            hca = 0 if (d.date(), vis, home) in neutral else MODEL["homeAdv"]
            r = hpts - vpts - hca
            h, a = idx[home], idx[vis]
            A[h][h] += w
            A[a][a] += w
            A[h][a] -= w
            A[a][h] -= w
            b[h] += w * r
            b[a] -= w * r
    x = _solve(A, b)
    return {t: x[idx[t]] for t in teams}


def srs_prior(conn):
    """開季起點：上季整季解一次 SRS（lam 幾乎不拉回、不衰減、主場 2），減掉平均讓平均 = 0，再乘 prevWeight。
    上季資料沒設定（PREV_SEASON = None）就回傳空 dict，每隊起點都是 0。"""
    if not PREV_SEASON:
        return {}
    prev_games, _, _ = load_prev_season(conn)
    raw = srs_ratings(prev_games, {}, lam=0.001, half_life=0)  # 0 = 不衰減（None 會變成預設的 60 天）
    mean = sum(raw.values()) / len(raw)
    return {t: SRS["prevWeight"] * (v - mean) for t, v in raw.items()}


def neutral_games(conn):
    """本季中立場地的比賽 {(美東日期 date, 客隊, 主隊)}（墨西哥城、NBA 盃決賽等；這些比賽沒有主場優勢）。"""
    rows = conn.execute("SELECT date, away, home FROM games WHERE neutral = 1 AND season = ? AND away IS NOT NULL AND home IS NOT NULL", (SEASON_LABEL,))
    return {(date.fromisoformat(r[0]), r[1], r[2]) for r in rows}


def next_season_label(label):
    """'2025-26' -> '2026-27'"""
    start = int(label[:4]) + 1
    return f"{start}-{(start + 1) % 100:02d}"


def cup_final_games(conn):
    """NBA 盃決賽（不計入例行賽）要排除的比賽：{(日期, 客隊, 主隊)}。

    賽程裡備註是「NBA Cup Championship」的那場，決賽打完（進了每場數據的紀錄）就自動排除，
    不用再手動加進 EXCLUDED_GAMES（每天自動更新時沒人會記得改）。打完之前它不在每場數據裡，所以什麼都不會發生。
    """
    boxes = store.read_boxes(conn)
    out = set()
    for g in store.read_schedule(conn):
        b = boxes.get(g["id"]) if g.get("note") == "NBA Cup Championship" else None
        if b:
            out.add((datetime.fromisoformat(b["date"]), b["away"], b["home"]))
    return out


class RawDataError(ValueError):
    """資料庫裡某一筆比分有問題；訊息格式「來源:第幾筆: 內容 (原因)」。"""


def load_games(rows, source, season_end, excluded_games):
    """rows：[(日期字串, 客隊, 客隊得分, 主隊, 主隊得分)]（來自資料庫，同一天已依 ESPN 順序排好）-> (保留的比賽, 被排除的比賽)"""
    games = []
    for i, (date_s, vis, vpts, home, hpts) in enumerate(rows, start=1):
        try:
            d = datetime.strptime(date_s, "%Y-%m-%d")
            game = (d, vis, int(vpts), home, int(hpts))
            unknown = {vis, home} - set(TEAMS)
            if unknown:
                raise ValueError(f"隊名不在 TEAMS 裡：{sorted(unknown)}")
        except (ValueError, TypeError) as e:
            raise RawDataError(f"{source}:第 {i} 筆: {(date_s, vis, vpts, home, hpts)!r} ({e})") from None
        games.append(game)
    games.sort(key=lambda g: g[0])

    excluded = [g for g in games if (g[0], g[1], g[3]) in excluded_games]
    # 資料已經涵蓋到排除日期、那場卻沒排到 -> 多半是日期或隊名設錯，直接報錯，不要默默算進例行賽
    # （「涵蓋到」只算今天以前的比賽；未來日期的資料另外由 check_no_duplicates_or_future 報錯）
    last_date = max((g[0] for g in games if g[0].date() <= date.today()), default=None)
    hit = {(g[0], g[1], g[3]) for g in excluded}
    missed = sorted(k for k in excluded_games if last_date and k[0] <= last_date and k not in hit)
    assert not missed, "EXCLUDED_GAMES 設定了卻在資料裡找不到（日期, 客隊, 主隊）：" + str(
        [(f"{d:%Y-%m-%d}", v, h) for d, v, h in missed])

    kept = [g for g in games if g[0] <= season_end and (g[0], g[1], g[3]) not in excluded_games]
    return kept, excluded


def load_pace(raw_dir):
    pace = {}
    for lineno, raw_line in enumerate((raw_dir / PACE_FILE).read_text(encoding="utf-8").splitlines(), start=1):
        if raw_line.strip():
            try:
                team, p = raw_line.strip().split("|")
                pace[team] = float(p)
            except ValueError as e:
                raise RawDataError(f"{PACE_FILE}:{lineno}: {raw_line!r} ({e})") from None
    return pace


def season_pace(conn, games):
    """球季進行中：每隊的「本季累積 PACE」（每 48 分鐘的回合數），由 boxscore 算出。

    回合數公式同 Basketball-Reference：
      估算回合 = 出手 + 0.4 x 罰球出手 - 1.07 x 進攻籃板率 x 投失次數 + 失誤，雙方各估一次取平均；
      PACE = 48 x 總回合 / 總出賽時間（以 5 人同時在場換算，延長賽每節多 5 分鐘）。
    本季 0 場的球隊沒有 PACE，輸出 None。
    """
    cache = store.read_boxes(conn)
    assert cache, "資料庫裡沒有任何 boxscore，請先執行 python fetch_espn_games.py"
    by_game = {(datetime.fromisoformat(v["date"]), v["away"], v["home"]): v for v in cache.values()}

    def est(t, o):
        return t["fga"] + 0.4 * t["fta"] - 1.07 * t["orb"] / (t["orb"] + o["drb"]) * (t["fga"] - t["fgm"]) + t["tov"]

    poss, mins = defaultdict(float), defaultdict(float)
    missing = []
    for d, vis, _, home, _ in games:
        box = by_game.get((d, vis, home))
        if box is None:
            missing.append(f"{d:%Y-%m-%d} {vis} @ {home}")
            continue
        a, h = box["stats"][vis], box["stats"][home]
        game_poss = 0.5 * (est(a, h) + est(h, a))
        minutes5 = 48 + 5 * (box["periods"] - 4)
        for t in (vis, home):
            poss[t] += game_poss
            mins[t] += minutes5
    assert not missing, f"有 {len(missing)} 場比賽沒有 boxscore，請先執行 python fetch_espn_games.py：{missing[:3]}..."
    return {t: round(48 * poss[t] / mins[t], 1) if mins[t] else None for t in TEAMS}


def _player_totals(conn, games):
    """逐場球員數據 -> (各隊已打場數, 各隊每位球員的累計)；沒有球員數據檔回傳 None。

    累計只算有上場的場次（沒上場的不算進去）。build_players、build_player_tiers 共用。
    """
    cache = store.read_players(conn)
    if not cache:
        return None
    by_game = {(datetime.fromisoformat(v["date"]), v["away"], v["home"]): v for v in cache.values()}
    team_gp = defaultdict(int)
    tot = defaultdict(dict)
    missing = []
    for d, vis, _, home, _ in games:
        rec = by_game.get((d, vis, home))
        if rec is None:
            missing.append(f"{d:%Y-%m-%d} {vis} @ {home}")
            continue
        for team in (vis, home):
            team_gp[team] += 1
            for pid, name, mins, pts, reb, ast, pm in rec["p"][team]:
                p = tot[team].setdefault(pid, {"id": pid, "n": name, "gp": 0, "min": 0, "pts": 0, "reb": 0, "ast": 0, "pm": 0})
                p["gp"] += 1
                p["min"] += mins
                p["pts"] += pts
                p["reb"] += reb
                p["ast"] += ast
                p["pm"] += pm
    assert not missing, f"有 {len(missing)} 場比賽沒有球員數據，請先執行 python fetch_espn_games.py：{missing[:3]}..."
    return team_gp, tot


def build_players(conn, games):
    """每隊場均得分前三高的球員（只算例行賽，盃賽決賽等被排除的比賽不算）。回傳 None = 沒有球員數據檔。

    只收「出賽場數 >= 球隊已打場數的一半」的球員，避免只打一兩場的人因為一場爆發衝上榜。
    場均得分、籃板、助攻、正負值都只除以「有上場」的場次（沒上場的不算進去）。
    """
    totals = _player_totals(conn, games)
    if totals is None:
        return None
    team_gp, tot = totals
    out = {}
    for team in TEAMS:
        need = max(1, -(-team_gp[team] // 2))  # 球隊已打場數的一半（進位）
        ps = sorted((p for p in tot[team].values() if p["gp"] >= need), key=lambda p: (-p["pts"] / p["gp"], p["n"]))
        out[team] = [{"n": p["n"], "gp": p["gp"], "pts": round(p["pts"] / p["gp"], 1), "reb": round(p["reb"] / p["gp"], 1),
                      "ast": round(p["ast"] / p["gp"], 1), "pm": round(p["pm"] / p["gp"], 1)} for p in ps[:TOP_SCORERS]]
    return {"asOf": games[-1][0].strftime("%Y-%m-%d"), "teams": out}


def tier_of(pts):
    """場均得分（已四捨五入到小數 1 位，和畫面上看到的一樣）-> 球員等級 1~5（1 最高）。"""
    for i, (low, _) in enumerate(PLAYER_TIERS, start=1):
        if pts >= low:
            return i
    return len(PLAYER_TIERS)


def build_player_tiers(conn, games):
    """所有出賽過的球員，依「場均得分」分級（給之後的傷病扣分用）。回傳 None = 沒有球員數據檔。

    每位球員：id = ESPN 球員編號（和 ESPN 傷病名單的球員編號對得上）、n = 名字、gp = 出賽場數、mn = 場均上場分鐘（網頁傷病名單用它決定要不要顯示數據）、pts / reb / ast / pm = 場均得分 / 籃板 / 助攻 / 正負值、
    t = 等級（1~5，1 最高，對照 tiers）、small = 1 表示出賽場數不到球隊已打場數的一半（樣本小，場均得分可能不準，
    常見於剛傷癒或剛傷倒的人；用等級做事前要自己決定要不要信它）。球隊內依場均得分高到低排。
    """
    totals = _player_totals(conn, games)
    if totals is None:
        return None
    team_gp, tot = totals
    teams = {}
    for team in TEAMS:
        need = max(1, -(-team_gp[team] // 2))  # 球隊已打場數的一半（進位）
        rows = []
        for p in sorted(tot[team].values(), key=lambda p: (-p["pts"] / p["gp"], p["n"])):
            pts = round(p["pts"] / p["gp"], 1)
            rows.append({"id": p["id"], "n": p["n"], "gp": p["gp"], "mn": round(p["min"] / p["gp"], 1), "pts": pts, "reb": round(p["reb"] / p["gp"], 1),
                         "ast": round(p["ast"] / p["gp"], 1), "pm": round(p["pm"] / p["gp"], 1), "t": tier_of(pts),
                         **({"small": 1} if p["gp"] < need else {})})
        teams[team] = rows
    return {"asOf": games[-1][0].strftime("%Y-%m-%d"),
            "tiers": [{"t": i, "name": name, "min": low} for i, (low, name) in enumerate(PLAYER_TIERS, start=1)],
            "teams": teams}


def build_schedule(conn):
    """賽程分頁的資料：每場轉成台灣日期與開賽時間（台灣沒有夏令時間，固定 UTC+8）。沒有賽程檔就回傳 None。

    每場：d = 台灣日期、t = 台灣開賽時間、a/h = 客/主隊縮寫（盃賽決賽等還沒決定的是 null）、
    s = F 已完賽 / S 尚未開打 / L 進行中 / X 延期或取消、n = 中立場地（不加主場優勢）、tag = 備註標籤、as/hs = 已完賽的比分、q = 已完賽的各節得分 [客隊各節, 主隊各節]。
    """
    raw_games = [g for g in store.read_schedule(conn) if g["utc"]]  # 沒有開賽時間的（只有比分的舊紀錄）不放進賽程
    if not raw_games:
        return None
    odds = store.read_odds(conn)
    games = []
    # 連兩天（back-to-back）：這隊「前一個美東日期」也有比賽。美東日期 = UTC - 6 小時（NBA 開賽時間 12:00~22:30 ET 不管冬令夏令都落在同一天）
    et_day = lambda g: (datetime.strptime(g["utc"], "%Y-%m-%dT%H:%MZ") - timedelta(hours=6)).date()
    played_days = defaultdict(set)  # 隊名 -> 有比賽的美東日期（延期、取消的不算）
    for g in raw_games:
        if g["away"] and g["home"] and not ("POSTPONED" in g["status"] or "CANCELED" in g["status"]):
            played_days[g["away"]].add(et_day(g)); played_days[g["home"]].add(et_day(g))
    for g in raw_games:
        tw = datetime.strptime(g["utc"], "%Y-%m-%dT%H:%MZ") + timedelta(hours=8)
        if tw.strftime("%Y-%m-%d") < SCHEDULE_SHOW_FROM:
            continue
        status = g["status"]
        s = "F" if status == "STATUS_FINAL" else "S" if status == "STATUS_SCHEDULED" else \
            "X" if ("POSTPONED" in status or "CANCELED" in status) else "L"
        item = {
            "d": tw.strftime("%Y-%m-%d"), "t": tw.strftime("%H:%M"),
            "a": TEAMS[g["away"]][0] if g["away"] else None, "h": TEAMS[g["home"]][0] if g["home"] else None,
            "s": s, "n": g["neutral"], "tag": SCHEDULE_TAGS.get(g["note"], g["note"]),
            "as": g["away_pts"], "hs": g["home_pts"],
        }
        if g.get("away_q") and g.get("home_q"):  # 各節得分 [客隊各節, 主隊各節]（第 5 個以後是延長賽）
            item["q"] = [g["away_q"], g["home_q"]]
        if g["away"] and g["home"] and tw.strftime("%Y-%m-%d") >= B2B_FROM:  # 連兩天：b = "a"（客隊）/ "h"（主隊）/ "ah"（兩隊都是）
            yday = et_day(g) - timedelta(days=1)
            b = ("a" if yday in played_days[g["away"]] else "") + ("h" if yday in played_days[g["home"]] else "")
            if b:
                item["b"] = b
        rec = odds.get(g["id"]) if s in ("F", "S", "L") else None
        if rec:  # 記下來的盤口：sp = 主隊讓分、ou = 總分（已完賽預測頁、已開賽的比賽顯示用，ESPN 開賽後就不給盤口了；開盤和賠率留在 raw/ 的紀錄檔）
            item["sp"], item["ou"] = rec["spread_home"][1], rec["total"][1]
            ml = rec.get("moneyline") or {}
            mh, ma = ml.get("home") or [], ml.get("away") or []
            if s == "S" and len(mh) >= 2 and len(ma) >= 2 and mh[1] is not None and ma[1] is not None:
                # 還沒開打：賭盤預估勝率 mq = 主隊的去抽水勝率（用「目前」勝負盤賠率，四捨五入成整數百分比），賽程卡片的勝率條用
                item["mq"] = round(fair_probs(american_to_decimal(mh[1]), american_to_decimal(ma[1]))[0] * 100)
        games.append(item)
    games.sort(key=lambda x: (x["d"], x["t"], x["a"] or "", x["h"] or ""))
    return {"season": SEASON_LABEL, "timezone": "Asia/Taipei", "b2bDeduct": B2B_DEDUCT, "retro": [B2B_FROM, RETRO_UNTIL], "games": games}


def american_to_decimal(x):
    """美式賠率 -> 小數賠率：正數 x -> 1 + x/100；負數 x -> 1 + 100/|x|"""
    return 1 + x / 100 if x > 0 else 1 + 100 / abs(x)


def fair_probs(d_home, d_away):
    """小數賠率 -> 去抽水的 (主隊勝率, 客隊勝率)：每邊取 1/賠率，再除以兩邊總和（把莊家抽的水拿掉）"""
    ih, ia = 1 / d_home, 1 / d_away
    return ih / (ih + ia), ia / (ih + ia)


def norm_cdf(z):
    """標準常態累積分布 Φ(z)（不用 numpy）"""
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def model_margin(item, ratings):
    """這場的模型預測分差（主隊領先幾分），和網頁 app.js predictSeason 一致：
    評分差 + 主場優勢（中立場地 0）- (主隊傷病扣分 + 主隊連兩天扣分) + (客隊傷病扣分 + 客隊連兩天扣分)"""
    b = item.get("b", "")
    ha = 0 if item["n"] else MODEL["homeAdv"]
    ja = (item.get("ja") or 0) + (B2B_DEDUCT if "a" in b else 0)
    jh = (item.get("jh") or 0) + (B2B_DEDUCT if "h" in b else 0)
    return ratings[item["h"]] - ratings[item["a"]] + ha - (jh - ja)


def find_upset(item, rec, ratings, gp):
    """規則 v1：這場有沒有符合的「冷門」。item = 賽程裡的這場（已有傷病扣分）、rec = odds 資料表這場的紀錄、
    ratings = {縮寫: SRS 評分}、gp = {縮寫: 本季已打場數}。符合回傳 dict，否則 None。
    條件：兩隊都已決定且本季打過、兩隊都不是連兩天、盤口紀錄是賽前（st = pre）且主客隊的 moneyline 都有；
    被選那隊「目前」小數賠率 >= minOdds，而且 模型勝率 - 市場去抽水勝率 >= minEdge。一場最多選一隊。"""
    if not item["a"] or not item["h"] or item.get("b"):
        return None
    if not gp.get(item["a"]) or not gp.get(item["h"]) or ratings.get(item["a"]) is None or ratings.get(item["h"]) is None:
        return None
    ml = (rec or {}).get("moneyline") or {}
    if rec.get("st") != "pre" or len(ml.get("home") or []) < 2 or len(ml.get("away") or []) < 2:
        return None
    dh_now, da_now = american_to_decimal(ml["home"][1]), american_to_decimal(ml["away"][1])
    dh_open, da_open = american_to_decimal(ml["home"][0]), american_to_decimal(ml["away"][0])
    qh_now, qa_now = fair_probs(dh_now, da_now)
    qh_open, qa_open = fair_probs(dh_open, da_open)
    m = model_margin(item, ratings)
    ph = norm_cdf(m / UPSET_RULE["sigma"])
    for side, p, d, q, d0, q0 in (("h", ph, dh_now, qh_now, dh_open, qh_open), ("a", 1 - ph, da_now, qa_now, da_open, qa_open)):
        if d >= UPSET_RULE["minOdds"] and p - q >= UPSET_RULE["minEdge"]:
            return {"side": side, "margin": m, "model_prob": p, "odds_pick": d, "fair_pick": q, "odds_open": d0, "fair_open": q0,
                    "provider": rec.get("provider")}
    return None


def update_upset_log(conn, schedule, team_rows_now):
    """每次 build：對「未來 horizonHours 小時內要開打」的比賽套規則 v1，第一次符合就寫進資料表 upset_log（只新增、不修改）。
    不回補上線之前的比賽：過去比賽「選的當下」的賠率已經不存在了。回傳這次新增幾筆。"""
    if not schedule:
        return 0
    ratings = {r["abbr"]: r["rating"] for r in team_rows_now.values() if r.get("rating") is not None}
    gp = {r["abbr"]: r["gp"] for r in team_rows_now.values()}
    odds = store.read_odds(conn)
    odds_st = store.read_odds_status(conn)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    horizon = now + timedelta(hours=UPSET_RULE["horizonHours"])
    by_key = {(g["d"], g["a"], g["h"]): g for g in schedule["games"] if g["a"] and g["h"]}
    n_new = 0
    for g in store.read_schedule(conn):
        if g["status"] != "STATUS_SCHEDULED" or not g["utc"] or not g["away"] or not g["home"] or g["id"] not in odds:
            continue
        start = datetime.strptime(g["utc"], "%Y-%m-%dT%H:%MZ")
        if not (now < start <= horizon):
            continue
        tw = (start + timedelta(hours=8)).strftime("%Y-%m-%d")
        item = by_key.get((tw, TEAMS[g["away"]][0], TEAMS[g["home"]][0]))
        if item is None or item["s"] != "S":
            continue
        hit = find_upset(item, dict(odds[g["id"]], st=odds_st[g["id"]]), ratings, gp)
        if hit:
            team = g["home"] if hit["side"] == "h" else g["away"]
            row = {"game_id": g["id"], "version": UPSET_RULE["version"], "picked_at": now.strftime("%Y-%m-%dT%H:%MZ"), "team": team, **hit}
            if store.insert_upset(conn, row):
                n_new += 1
                print(f"冷門觀察：{tw} {TEAMS[g['away']][1]} @ {TEAMS[g['home']][1]} 選 {TEAMS[team][1]}（賠率 {hit['odds_pick']:.2f}，模型 {hit['model_prob']:.1%} 對市場 {hit['fair_pick']:.1%}）")
    conn.commit()
    return n_new


def build_upsets(conn):
    """輸出給網頁的冷門觀察名單：資料表 upset_log 每一筆，打完的再現算收盤去抽水勝率、CLV、勝負。
    CLV（收盤價值）= 被選那隊「收盤去抽水勝率」- 選的當下的去抽水勝率；正數 = 選的時候買到比收盤便宜。
    收盤用 odds 資料表 st = final 那筆的 moneyline 收盤；查不到收盤的不給 qc / clv（網頁顯示「無收盤」）。"""
    odds = store.read_odds(conn)
    odds_st = store.read_odds_status(conn)
    games = {g["id"]: g for g in store.read_schedule(conn)}
    picks = []
    for u in store.read_upsets(conn):
        g = games.get(u["game_id"])
        if not g or not g["utc"]:
            continue
        tw = datetime.strptime(g["utc"], "%Y-%m-%dT%H:%MZ") + timedelta(hours=8)
        item = {"d": tw.strftime("%Y-%m-%d"), "t": tw.strftime("%H:%M"), "a": TEAMS[g["away"]][0], "h": TEAMS[g["home"]][0],
                "side": u["side"], "od": round(u["odds_pick"], 2), "mp": round(u["model_prob"], 3), "qp": round(u["fair_pick"], 3)}
        if g["status"] == "STATUS_FINAL" and g["home_pts"] is not None and g["away_pts"] is not None:
            won = (g["home_pts"] > g["away_pts"]) == (u["side"] == "h")
            item["w"] = 1 if won else 0
            rec = odds.get(u["game_id"])
            ml = (rec or {}).get("moneyline") or {}
            if rec and odds_st.get(u["game_id"]) == "final" and len(ml.get("home") or []) >= 2 and len(ml.get("away") or []) >= 2:
                qh, qa = fair_probs(american_to_decimal(ml["home"][1]), american_to_decimal(ml["away"][1]))
                qc = qh if u["side"] == "h" else qa
                item["qc"] = round(qc, 3)
                item["clv"] = round((qc - u["fair_pick"]) * 100, 2)  # 百分點
        picks.append(item)
    picks.sort(key=lambda x: (x["d"], x["t"], x["a"]))
    return {"rule": UPSET_RULE, "picks": picks}


def backfill_injury_adj(conn, games, schedule):
    """事後回補：2026-11-08 以前已完賽的比賽（當時還沒有傷病扣分），照現行規則補算一份，標記 bf = 1。

    當時沒有留下賽前的傷病名單，所以用「這場誰事後沒上場」代替：逐場往前推，每場用「那天之前」的累計算每位球員的場均得分與等級，
    那隊場均得分有等級的人（本季至少出賽 INJURY_MIN_GP 場）這場沒出現在出賽名單裡，就當缺陣、照 INJURY_DEDUCT 扣分。
    這是事後才知道的資訊，不是真的賽前預測，所以網頁上會標明「事後回補」（回測腳本用的也是這個代替法，結果偏樂觀）。
    回傳 { "台灣日期|客隊|主隊": {ja, jh, jp, at, bf} }；沒人被扣的比賽不寫。只補一次，之後讀資料表 injury_adj。
    執行：python build_data.py --backfill-injuries
    """
    cache = store.read_players(conn)
    if not cache:
        return {}
    by_game = {(datetime.fromisoformat(v["date"]), v["away"], v["home"]): v["p"] for v in cache.values()}
    sched = {(g["a"], g["h"], g["as"], g["hs"]): g for g in schedule["games"]
             if g["s"] == "F" and g["a"] and g["h"] and g["d"] < INJURY_BACKFILL_UNTIL}
    pstat = {}  # 球員編號 -> {gp, pts, team, n}（只算「那天之前」打過的比賽）
    out = {}
    for day in sorted({g[0] for g in games}):
        today = [g for g in games if g[0] == day]
        for d, vis, vpts, home, hpts in today:
            rec = by_game.get((d, vis, home))
            sg = sched.get((TEAMS[vis][0], TEAMS[home][0], vpts, hpts))
            if rec is None or sg is None:
                continue
            jp = []
            for side, team in (("a", vis), ("h", home)):
                played = {r[0] for r in rec[team] if r[2] and r[2] > 0}
                for pid, st in pstat.items():
                    if st["team"] != team or st["gp"] < INJURY_MIN_GP or pid in played:
                        continue
                    ded = INJURY_DEDUCT.get(tier_of(round(st["pts"] / st["gp"], 1)), 0.0)
                    if ded > 0:
                        jp.append([side, st["n"], ded])
            if jp:
                out[f'{sg["d"]}|{sg["a"]}|{sg["h"]}'] = {
                    "ja": sum(d_ for s, _, d_ in jp if s == "a"), "jh": sum(d_ for s, _, d_ in jp if s == "h"),
                    "jp": jp, "at": "backfill", "bf": 1}
        for d, vis, _, home, _ in today:  # 這天的比賽打完，才算進累計（同一天的比賽互不影響）
            rec = by_game.get((d, vis, home))
            if rec is None:
                continue
            for team in (vis, home):
                for pid, name, mins, pts, *_ in rec[team]:
                    if mins and mins > 0:
                        st = pstat.setdefault(pid, {"gp": 0, "pts": 0, "team": team, "n": name})
                        st["gp"] += 1
                        st["pts"] += pts
                        st["team"] = team
    return out


def apply_h2h_pace_adj(conn, schedule):
    """兩隊歷史對戰節奏調整：每場「H2H_PACE_FROM 起」的比賽寫 pt = 預測總分要加減幾分（沒調整就不寫）。

    每場實際回合數 = 出手 + 0.44 × 罰球出手 − 進攻籃板 + 失誤（兩隊平均）；殘差 = 實際 − 預估（兩隊「到那場之前」本季平均回合數，
    往聯盟平均拉回 H2H_SHRINK_GAMES 場）。每組兩隊的殘差先吃過去三季的總和（資料表 h2h_pace），再逐場加上本季更早的碰面，
    所以每場只看得到「它之前」的碰面，已完賽的比賽也不會被事後的結果改掉。
    """
    hist = store.read_h2h_pace(conn)
    box = store.read_boxes(conn)
    if not hist or not box:
        print("注意：資料庫裡沒有 h2h_pace 或 boxscore，這次沒有對戰節奏調整（請先執行 python make_h2h_pace_history.py）")
        return
    abbr_name = {v[0]: k for k, v in TEAMS.items()}
    # 本季已完賽的比賽依日期順序，逐場算殘差；cur[組合] = [(日期, 殘差), ...]
    team_pace, league = defaultdict(list), []
    cur = defaultdict(list)
    for gid, g in sorted(box.items(), key=lambda kv: (kv[1]["date"], kv[0])):
        poss = {t: x["fga"] + 0.44 * x["fta"] - x["orb"] + x["tov"] for t, x in g["stats"].items()}
        pace = sum(poss.values()) / 2
        a, h = g["away"], g["home"]
        if team_pace[a] and team_pace[h]:
            lg = sum(league) / len(league)
            shrunk = lambda xs: (sum(xs) + H2H_SHRINK_GAMES * lg) / (len(xs) + H2H_SHRINK_GAMES)
            cur["|".join(sorted((a, h)))].append((g["date"], pace - (shrunk(team_pace[a]) + shrunk(team_pace[h])) / 2))
        team_pace[a].append(pace)
        team_pace[h].append(pace)
        league.append(pace)
    n_set = 0
    for g in schedule["games"]:
        if not g["a"] or not g["h"] or g["d"] < H2H_PACE_FROM:
            continue
        key = "|".join(sorted((abbr_name[g["a"]], abbr_name[g["h"]])))
        h_sum, h_n = hist.get(key, [0.0, 0])
        # 這場的美東日期 = 台灣開賽時間 - 14 小時（台灣 = UTC+8、美東 = UTC-6）；只算美東日期比這場早的碰面
        et_day = (datetime.strptime(g["d"] + " " + g["t"], "%Y-%m-%d %H:%M") - timedelta(hours=14)).strftime("%Y-%m-%d")
        before = [r for d, r in cur.get(key, []) if d < et_day]
        x = (h_sum + sum(before)) / (h_n + len(before) + H2H_PACE_K)
        adj = round(H2H_PACE_MULT * x, 1)
        if adj:
            g["pt"] = adj
            n_set += 1
    print(f"對戰節奏調整：{n_set} 場有總分調整（{H2H_PACE_FROM} 起），過去三季 {len(hist)} 組對戰 + 本季 {sum(len(v) for v in cur.values())} 場碰面")


def apply_injury_adj(conn, schedule, tiers, backfill_games=None):
    """傷病扣分：把每場「還沒開打」的比賽，兩隊缺陣球員的扣分寫進 schedule（直接改 schedule）。

    backfill_games 有給（--backfill-injuries）：先把 2026-11-08 以前已完賽的比賽照現行規則回補（見 backfill_injury_adj），標記 bf。

    規則（依場均得分分級，見 PLAYER_TIERS / INJURY_DEDUCT）：ESPN 傷病名單標「缺陣（Out）」、本季至少出賽 INJURY_MIN_GP 場的球員，
    超級球星 -3、球星 -2、主力 -1.5、角色球員 -1.5、板凳 0（每日觀察不算）。扣分加在「兩隊的預測分差」上，不是各扣各隊比分：
    新分差 = 原分差 - 主隊缺陣扣分 + 客隊缺陣扣分，總分不變。
    每場寫 ja / jh（客隊 / 主隊的扣分合計）和 jp（[[a 或 h, 球員, 扣分], ...] 給網頁顯示用）；沒人被扣就不寫。
    schedule["inj"] / ["injn"]：每隊「現在」的扣分合計與名單（自選對戰用，沒有對應賽程的組合）；schedule["injAsOf"] = 名單抓取時間。

    只扣「未來 INJURY_HORIZON_HOURS 小時內要開打」的比賽（更遠的比賽等逼近了、下次更新才會有）。
    凍結：這些比賽每次更新都用最新名單重算；開賽後那場的扣分就存在資料表 injury_adj 不再更新，
    所以已完賽比賽的賽前預測永遠是當時（最後一次更新時）的樣子，準確率統計才不會被事後的名單改掉。
    沒抓過傷病名單（資料庫裡沒有 injury_snapshots）的比賽就是沒有扣分，也就是「沒有納入傷病」。
    """
    mem = store.read_injury_adj(conn)
    snap = store.read_injuries_latest(conn)
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # 現在的 UTC 時間（和名單抓取時間同一種）
    if backfill_games is not None:
        filled = backfill_injury_adj(conn, backfill_games, schedule)
        for k in [k for k, v in mem.items() if v.get("bf")]:  # 舊的回補整批重算
            del mem[k]
        mem.update(filled)
        print(f"傷病扣分（事後回補）：2026-11-08 以前 {len(filled)} 場有人缺陣被扣分")

    def deductions(team_name):
        """這隊現在被扣的 [(球員, 扣分)]：名單裡標 Out、本季出賽 >= INJURY_MIN_GP 場、等級有扣分的人。"""
        mine = {p["id"]: p for p in tiers["teams"].get(team_name, [])}
        out = []
        for r in snap["teams"].get(team_name, []):
            p = mine.get(r["id"])
            if r["s"] != "Out" or not p or p["gp"] < INJURY_MIN_GP:
                continue
            d = INJURY_DEDUCT.get(p["t"], 0.0)
            if d > 0:
                out.append((p["n"], d))
        return out

    abbr_name = {v[0]: k for k, v in TEAMS.items()}
    if snap:
        fresh = datetime.strptime(snap["fetched"], "%Y-%m-%dT%H:%MZ")
        schedule["injAsOf"] = snap["fetched"]
        cur = {abbr: deductions(name) for abbr, name in abbr_name.items()}
        schedule["inj"] = {a: sum(d for _, d in v) for a, v in cur.items() if v}
        schedule["injn"] = {a: [[n, d] for n, d in v] for a, v in cur.items() if v}
    n_new = n_frozen = 0
    for g in schedule["games"]:
        if not g["a"] or not g["h"]:
            continue
        key = f'{g["d"]}|{g["a"]}|{g["h"]}'
        start_utc = datetime.strptime(g["d"] + " " + g["t"], "%Y-%m-%d %H:%M") - timedelta(hours=8)
        if g["s"] == "S" and now < start_utc <= now + timedelta(hours=INJURY_HORIZON_HOURS) and snap \
                and now - fresh < timedelta(hours=INJURY_STALE_HOURS):
            jp = [["a", n, d] for n, d in deductions(abbr_name[g["a"]])] + [["h", n, d] for n, d in deductions(abbr_name[g["h"]])]
            if jp:
                mem[key] = {"ja": sum(d for s, _, d in jp if s == "a"), "jh": sum(d for s, _, d in jp if s == "h"), "jp": jp, "at": snap["fetched"]}
            else:
                mem.pop(key, None)
            n_new += 1
        elif key in mem:
            n_frozen += 1
        rec = mem.get(key)
        if rec:
            g["ja"], g["jh"], g["jp"] = rec["ja"], rec["jh"], rec["jp"]
            if rec.get("bf"):
                g["jb"] = 1  # 事後回補（不是賽前實際的名單），網頁會標明
    store.write_injury_adj(conn, mem)
    conn.commit()
    print(f"傷病扣分：還沒開打的 {n_new} 場用最新名單重算（名單抓取時間 {snap['fetched'] if snap else '無'}），"
          f"已開打/已完賽且凍結的 {n_frozen} 場 -> 資料表 injury_adj")


def check_no_duplicates_or_future(games, today):
    """兩種模式都檢查：沒有重複比賽、沒有未來日期。"""
    seen = set()
    for d, vis, _, home, _ in games:
        key = (d, vis, home)
        assert key not in seen, f"重複的比賽：{d:%Y-%m-%d} {vis} @ {home}"
        seen.add(key)
        assert d.date() <= today, f"未來日期的比賽：{d:%Y-%m-%d} {vis} @ {home}（今天是 {today}）"


def check_in_progress_limits(games):
    """只在進行中模式檢查：每隊場數 <= 82、主客場各 <= 41。

    整季完成模式不能檢查「主客場各 <= 41」：NBA 盃淘汰賽（中立場地）會讓真實的整季資料出現
    42/40 的主客場失衡（2025-26 的尼克、馬刺、雷霆、魔術都是），整季完成模式改靠「每隊剛好 82 場」把關。
    """
    home_n, road_n = defaultdict(int), defaultdict(int)
    for _, vis, _, home, _ in games:
        road_n[vis] += 1
        home_n[home] += 1
    too_many = {t: (home_n[t], road_n[t]) for t in TEAMS
                if home_n[t] + road_n[t] > 82 or home_n[t] > 41 or road_n[t] > 41}
    assert not too_many, (f"有球隊場次超過上限（主場, 客場；總場數<=82、主客場各<=41）：{too_many}。"
                          "若球季已接近尾聲（NBA 盃中立場地賽可能讓主客場變成 42/40），請改用 --complete")


def build_log(games):
    """隊 -> [(得分, 失分, 是否主場)]，依日期排序"""
    log = defaultdict(list)
    for _, vis, vpts, home, hpts in games:
        log[vis].append((vpts, hpts, False))
        log[home].append((hpts, vpts, True))
    return log


def build_h2h(games):
    """每對球隊的交手比分：key 是兩隊縮寫「依字母排序後用 - 連接」，值依日期排列，
    每場是 [字母序在前那隊得分, 字母序在後那隊得分]"""
    h2h = defaultdict(list)
    for _, vis, vpts, home, hpts in games:
        a, b = sorted([TEAMS[vis][0], TEAMS[home][0]])
        first_pts, second_pts = (vpts, hpts) if TEAMS[vis][0] == a else (hpts, vpts)
        h2h[f"{a}-{b}"].append([first_pts, second_pts])
    return h2h


def load_prev_season(conn):
    """讀上一季整季資料（用和「整季完成」模式一樣的嚴格檢查），回傳 (比賽, 逐隊紀錄, 交手比分)。"""
    games, _ = load_games(store.read_season_games(conn, PREV_SEASON["label"]), f"season_games({PREV_SEASON['label']})", PREV_SEASON["end"], PREV_SEASON["excluded"])
    check_no_duplicates_or_future(games, date.today())
    assert len(games) == REGULAR_SEASON_GAMES, f"上季（{PREV_SEASON['label']}）賽程筆數不對：{len(games)}"
    log = build_log(games)
    bad = {k: len(v) for k, v in log.items() if len(v) != 82}
    assert not bad, f"上季（{PREV_SEASON['label']}）有球隊場次不是82場：{bad}"
    h2h = build_h2h(games)
    assert len(h2h) == 435, f"上季對戰組合數不對：{len(h2h)}"
    return games, log, h2h


def team_rows(games, pace, with_model, prior=None, neutral=frozenset()):
    """每隊的場數、戰績、場均得失分、近10場、PACE（球季進行中另外加預測模型用的淨勝分 net / net10，
    有給 prior 時再加 SRS 球隊評分 rating）。"""
    log = build_log(games)
    ratings = srs_ratings(games, prior, neutral) if with_model and prior is not None else None
    out = {}
    for en, (abbr, zh, conf, color) in TEAMS.items():
        g = log[en]
        n = len(g)
        last10 = g[-10:]
        n10 = len(last10)  # 球隊還沒打滿 10 場時，分母是實際場數
        wins = sum(1 for p, o, _ in g if p > o)
        hw = sum(1 for p, o, h in g if h and p > o)
        hn = sum(1 for _, _, h in g if h)
        rw = sum(1 for p, o, h in g if not h and p > o)
        rn = n - hn
        streak = 0  # 目前連勝場數（從最近一場往前數，遇到輸就停；最近一場輸了就是 0）
        for p, o, _ in reversed(g):
            if p <= o:
                break
            streak += 1
        lstreak = 0  # 目前連敗場數（最近一場贏了就是 0）；排名表的「W3 / L3」用
        for p, o, _ in reversed(g):
            if p >= o:
                break
            lstreak += 1
        out[en] = {
            "abbr": abbr, "zh": zh, "conf": conf, "color": color,
            "gp": n, "w": wins, "l": n - wins, "streak": streak, "lstreak": lstreak,
            "home": f"{hw}-{hn - hw}", "road": f"{rw}-{rn - rw}",
            "pace": pace[en],
            # 本季 0 場的球隊（進行中模式才會有）沒有平均可算，輸出 null，網頁會顯示「尚未出賽」
            "off": round(sum(p for p, _, _ in g) / n, 1) if n else None,
            "def": round(sum(o for _, o, _ in g) / n, 1) if n else None,
            "l10off": round(sum(p for p, _, _ in last10) / n10, 1) if n10 else None,
            "l10def": round(sum(o for _, o, _ in last10) / n10, 1) if n10 else None,
            "l10rec": f"{sum(1 for p, o, _ in last10 if p > o)}-{sum(1 for p, o, _ in last10 if p < o)}",
        }
        if with_model:  # 預測模型要用的淨勝分（整季至今、近10場），多留一位小數（0 場的球隊是 null）
            out[en]["net"] = round(sum(p - o for p, o, _ in g) / n, 2) if n else None
            out[en]["net10"] = round(sum(p - o for p, o, _ in last10) / n10, 2) if n10 else None
            if ratings is not None:  # SRS 球隊評分（預測分差用）；0 場的球隊是 null
                out[en]["rating"] = round(ratings[en], 2) if n else None
    return out


def build_pregame(conn, games, schedule, prior, neutral):
    """「最近一個打過比賽的台灣日期」開打之前的球隊數據，給網頁看那天已完賽比賽的賽前預測用。

    為什麼要另外存一份：網頁上的球隊數據已經包含那天打完的比賽，直接拿來預測等於看過結果才預測。
    一支球隊一天最多打一場，所以「那天所有比賽之前」的數據，對那天的每一場都是精確的賽前狀態。
    做法：從賽程找出那天已完賽的比賽，把它們從比賽清單裡拿掉，重新算一次球隊數據（含 PACE、交手紀錄）。
    """
    if not schedule:
        return None
    finals = [g for g in schedule["games"] if g["s"] == "F" and g["a"] and g["h"]]
    if not finals:
        return None
    pre_date = max(g["d"] for g in finals)  # 台灣日期
    name_of = {v[0]: k for k, v in TEAMS.items()}
    today_finals = {(name_of[g["a"]], name_of[g["h"]]) for g in finals if g["d"] == pre_date}
    pre_day = date.fromisoformat(pre_date)
    # 原始比分是美東日期，台灣日期通常是它的隔天（偶爾同一天），所以兩天都要看；同一天同一對球隊不會打兩場
    pre_games = [g for g in games
                 if not ((g[1], g[3]) in today_finals and g[0].date() in (pre_day, pre_day - timedelta(days=1)))]
    if not pre_games:
        return None
    return {
        "date": pre_date,
        "asOf": pre_games[-1][0].strftime("%Y-%m-%d"),
        "h2h": build_h2h(pre_games),
        "teams": team_rows(pre_games, season_pace(conn, pre_games), with_model=True, prior=prior, neutral=neutral),
    }


def games_before_tw_day(games, schedule, day):
    """台灣日期 day 開打「之前」的所有比賽（day 當天與之後的都不算）。

    原始比分只有美東日期（台灣日期通常是它的隔天，偶爾同一天），所以用賽程的台灣日期來對：
    同一對球隊（客隊, 主隊）在賽程裡的已完賽日期，和比分的美東日期差 0 或 1 天，就是同一場。
    賽程對不到的（賽程範圍以前的比賽）一定比賽程最早的日期早，直接算「之前」。
    """
    name_of = {v[0]: k for k, v in TEAMS.items()}
    tw_days = defaultdict(list)
    for g in schedule["games"]:
        if g["s"] == "F" and g["a"] and g["h"]:
            tw_days[(name_of[g["a"]], name_of[g["h"]])].append(date.fromisoformat(g["d"]))
    out = []
    for g in games:
        et = g[0].date()
        tw = [d for d in tw_days.get((g[1], g[3]), []) if (d - et).days in (0, 1)]
        if (tw[0] if tw else et) < day:
            out.append(g)
    return out


def build_pre_days(conn, games, schedule, latest, prior, neutral):
    """賽程分頁裡「比最近一個比賽日更早」的每個比賽日，各存一份開打前的球隊數據，
    讓那些日子的卡片也能顯示賽前預測比分。只留預測公式要用的欄位，檔案才不會太大。
    （最近一個比賽日另外存在 pre，裡面還有交手紀錄，因為那天的比賽可以點進去看完整預測。）
    """
    days = sorted({g["d"] for g in schedule["games"]
                   if g["s"] == "F" and g["a"] and g["h"] and SCHEDULE_SHOW_FROM <= g["d"] < latest})
    # 預測公式要用的欄位，加上對戰頁「本季數據對照」表要用的戰績欄位（已完賽的固定頁面顯示那天賽前的數據）
    keep = ("gp", "w", "l", "home", "road", "off", "def", "pace", "l10rec", "l10off", "l10def", "net", "net10", "rating")
    out = {}
    for d in days:
        pre_games = games_before_tw_day(games, schedule, date.fromisoformat(d))
        if not pre_games:
            continue
        rows = team_rows(pre_games, season_pace(conn, pre_games), with_model=True, prior=prior, neutral=neutral)
        out[d] = {k: {f: r[f] for f in keep} for k, r in rows.items()}
    return out


def main(db_path, target, complete, backfill_injuries=False):
    conn = store.connect(db_path)
    games, excluded = load_games(store.read_final_games(conn, SEASON_LABEL), f"games({SEASON_LABEL})", REGULAR_SEASON_END, EXCLUDED_GAMES | cup_final_games(conn))
    assert games, "沒有任何比賽資料"
    check_no_duplicates_or_future(games, date.today())
    if complete:
        pace = load_pace(RAW)
        assert set(pace) == set(TEAMS), f"PACE隊名對不上：{set(pace) ^ set(TEAMS)}"
        assert len(games) == REGULAR_SEASON_GAMES, f"賽程筆數不對：{len(games)}"
    else:
        pace = season_pace(conn, games)
        check_in_progress_limits(games)

    log = build_log(games)

    if complete:
        bad = {k: len(v) for k, v in log.items() if len(v) != 82}
        assert not bad, f"有球隊場次不是82場：{bad}"

    # SRS 球隊評分要用的開季起點（上季評分）和中立場地清單（只有球季進行中才用）
    prior = None if complete else srs_prior(conn)
    neutral = frozenset() if complete else neutral_games(conn)
    out = team_rows(games, pace, with_model=not complete, prior=prior, neutral=neutral)

    h2h = build_h2h(games)
    if complete:
        assert len(h2h) == 435, f"對戰組合數不對：{len(h2h)}"  # C(30,2)

    payload = {
        "season": SEASON_LABEL,
        "nextSeason": next_season_label(SEASON_LABEL),
        "mode": "preseason" if complete else "in_season",
        "h2h": h2h,
        "asOf": games[-1][0].strftime("%Y-%m-%d"),
        "games": len(games),
        "homeAdvantage": 1,
    }

    # 賽程分頁（只有球季進行中才有；沒有賽程時寫 null，網頁就不會顯示賽程分頁）
    schedule = None if complete else build_schedule(conn)

    # 球員分級（依場均得分分五級）；傷病扣分要用，所以在寫賽程之前先算
    tiers = None if complete else build_player_tiers(conn, games)
    if schedule and tiers:
        apply_injury_adj(conn, schedule, tiers, games if backfill_injuries else None)
    if schedule:
        apply_h2h_pace_adj(conn, schedule)
    if schedule and not complete:  # 開盤冷門觀察名單：要在傷病扣分之後才算分差；只新增不修改
        update_upset_log(conn, schedule, out)

    # 球季進行中：附上預測模型參數，以及上季交手紀錄（只供顯示，不進預測）
    if not complete:
        payload["model"] = {**MODEL, "srs": SRS}
        if PREV_SEASON:
            _, _, prev_h2h = load_prev_season(conn)
            payload["prevSeason"] = PREV_SEASON["label"]
            payload["h2hPrev"] = prev_h2h
        pre = build_pregame(conn, games, schedule, prior, neutral)
        if pre:
            payload["pre"] = pre
            payload["preDays"] = build_pre_days(conn, games, schedule, pre["date"], prior, neutral)

    payload["teams"] = out
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "// 由 build_data.py 自動產生，請勿手改\nwindow.NBA_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"完成（{'整季完成' if complete else '進行中'}模式）：{len(out)} 隊，例行賽 {len(games)} 場，"
          f"最後一場 {payload['asOf']}，排除 {len(excluded)} 場 -> {target}")

    if not complete and schedule is None:
        print("注意：資料庫裡沒有賽程，網頁不會有賽程分頁（請執行 python fetch_espn_games.py）")
    schedule_target = target.parent / "schedule.js"
    schedule_target.write_text(
        "// 由 build_data.py 自動產生，請勿手改\nwindow.NBA_SCHEDULE = "
        + json.dumps(schedule, ensure_ascii=False, separators=(",", ":")).replace('},{"d"', '},\n{"d"') + ";\n",
        encoding="utf-8",
    )
    if schedule:
        print(f"賽程：{len(schedule['games'])} 場（台灣時間）-> {schedule_target}")

    # 開盤冷門觀察名單（只有球季進行中才有；網頁沒有這個檔也不會壞）
    if not complete:
        upsets = build_upsets(conn)
        upsets_target = target.parent / "upsets.js"
        upsets_target.write_text(
            "// 由 build_data.py 自動產生，請勿手改\nwindow.NBA_UPSETS = "
            + json.dumps(upsets, ensure_ascii=False, separators=(",", ":")).replace('},{"d"', '},\n{"d"') + ";\n",
            encoding="utf-8",
        )
        print(f"冷門觀察：累計 {len(upsets['picks'])} 筆 -> {upsets_target}")

    # 每隊得分前三高的球員（只有球季進行中才有；沒有球員數據檔就寫 null，網頁就不會顯示這張卡片）
    players = None if complete else build_players(conn, games)
    players_target = target.parent / "players.js"
    players_target.write_text(
        "// 由 build_data.py 自動產生，請勿手改\nwindow.NBA_PLAYERS = "
        + json.dumps(players, ensure_ascii=False, separators=(",", ":")).replace('],"', '],\n"') + ";\n",
        encoding="utf-8",
    )
    if players:
        print(f"得分前三球員：{len(players['teams'])} 隊 -> {players_target}")
    elif not complete:
        print("注意：資料庫裡沒有球員數據，網頁不會有得分前三球員卡片（請執行 python fetch_espn_games.py）")

    # 所有球員的等級與場均數據（上面已算好；傷病扣分用等級，網頁的傷病名單用場均得分/籃板/助攻/正負值；沒有球員數據檔就寫 null）
    tiers_target = target.parent / "player_tiers.js"
    tiers_target.write_text(
        "// 由 build_data.py 自動產生，請勿手改\nwindow.NBA_PLAYER_TIERS = "
        + json.dumps(tiers, ensure_ascii=False, separators=(",", ":")).replace('],"', '],\n"') + ";\n",
        encoding="utf-8",
    )
    if tiers:
        n = sum(len(v) for v in tiers["teams"].values())
        print(f"球員分級：{n} 位球員 -> {tiers_target}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="把資料庫（db/nba.db）的資料整理成網頁用的 data/*.js")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--complete", dest="complete", action="store_true", default=None,
                      help="當作整季已打完（嚴格檢查 1230 / 82 / 435）")
    mode.add_argument("--in-progress", dest="complete", action="store_false",
                      help="當作球季進行中（只檢查上限、重複、未來日期）")
    parser.add_argument("--backfill-injuries", action="store_true",
                        help="事後回補：2026-11-08 以前已完賽的比賽，照現行傷病扣分規則補算（用「事後誰沒上場」代替，網頁會標明）")
    parser.add_argument("--db", type=Path, default=store.DB_PATH, help="資料庫檔（預設 db/nba.db）")
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "teams.js", help="輸出檔（預設 data/teams.js）")
    args = parser.parse_args()
    try:
        main(args.db, args.out, SEASON_COMPLETE if args.complete is None else args.complete, args.backfill_injuries)
    except RawDataError as e:
        sys.exit(f"原始資料格式錯誤 {e}")
