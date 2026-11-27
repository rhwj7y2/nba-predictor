# -*- coding: utf-8 -*-
"""
「防守一直變好、近況勝多敗少的受讓隊，有機會倒打」規則（固定，不調參數）。
網站在符合條件的比賽，賭盤變化卡片的「模型」勝率條下面顯示「○○有機會倒打」；build_data.py 呼叫 dog_flags() 算每場的旗標 dg。

對每一場例行賽，先找出「受讓隊」（收盤讓分裡受讓的那一隊），同時符合下面 4 點才算：
 1. 受讓分數大於 0、且不超過 8.5 分（含 8.5）；盤口讓分是 0 的比賽不算。（這點要看盤口，網頁在顯示時用目前的盤口判斷）
 2. 主客兩隊在這一季、這場之前，都至少打過 7 場（例行賽，同季才算）。
 3. 受讓隊的防守一段比一段好。只用「這場之前」的比賽，往回數（1 = 最近一場）：
      第 5、6、7 場的 DRTG > 第 3、4、5 場的 DRTG > 第 1、2、3 場的 DRTG，
    而且第 5~7 場的 DRTG 減第 1~3 場的 DRTG 要超過 2.0。
    DRTG = 100 × 對手得分加總 ÷ 回合加總（三場合併計算，不是三場單場數字的平均）。
    回合 = 該場兩隊各算一次取平均；單隊 = 出手 + 0.4×罰球 − 1.07×進攻籃板÷(進攻籃板+對手防守籃板)×(出手−命中) + 失誤
    （和 build_data.py 的 team_paces 同一個公式）。
 4. 受讓隊最近 5 場至少贏 3 場。
結果只看受讓隊有沒有直接贏球（不管讓分）。同一天的比賽互不影響：當天的比賽全部打完，才加進球隊的紀錄。
排除：NBA 盃決賽、例行賽結束日之後的比賽。

三季回測（2023-24 ~ 2025-26；2.0 與近 5 場這組參數是看過這三季之後才定的，所以這三季不能當成驗證）：
  符合 247 場、受讓隊贏 113 場（45.7%）；同樣受讓分數的受讓隊三季平均贏 38.2%。
  2023-24 83 場贏 36、2024-25 86 場贏 37、2025-26 78 場贏 40；2026-27 到 2026-11-24 符合 7 場贏 3 場。

網站用法：dog_flags(排程, 逐場數據) -> {場次編號: "a" / "h" / "ah"}：這場「客隊 / 主隊 / 兩隊」符合第 2、3、4 點（兩隊都要打滿 7 場）。
  已完賽的比賽用「賽前」的紀錄算；還沒打的比賽只標每隊「下一場」（更後面的比賽，中間隔著還沒打的賽程，紀錄會變，不標）。
  網頁再用目前的盤口看第 1 點：受讓隊在旗標裡、受讓 0 < 分數 <= 8.5，才顯示。

--------------------------------------------------------------------------------
策略二「近 5 場比近 10 場進步」（固定，不調參數）。策略一、策略二符合任一個，網站就寫「有機會倒打」。
 1. 受讓分數大於 0、且不超過 9.5 分（含 9.5）。（網頁在顯示時用目前的盤口判斷）
 2. 主客兩隊在這一季、這場之前，都至少打過 10 場。
 3. 受讓隊最近 5 場至少贏 3 場。
 4. 受讓隊進攻變好：近 5 場 ORTG > 近 10 場 ORTG（一樣大不算）。
 5. 讓分隊防守變好：近 5 場 DRTG < 近 10 場 DRTG（一樣大不算）。
    ORTG / DRTG = 100 × N 場得分（失分）加總 ÷ N 場回合加總，四捨五入到小數 1 位之後才比大小；回合公式和上面相同。

三季回測（2023-24 ~ 2025-26，受讓 <= 9.5）：符合 308 場、受讓隊贏 131 場（42.5%）。
  2023-24 109 場贏 38、2024-25 108 場贏 46、2025-26 91 場贏 47；2026-27 到 2026-11-24 符合 7 場贏 3 場。
  不設受讓上限時（使用者原始規格的對帳數字）：350 場贏 143（116/38、127/51、107/54；本季到 2026-11-24 為 9/3）。

dog_flags2(排程, 逐場數據) -> {場次編號: "a" / "h" / "ah"}：「如果客隊 / 主隊是受讓隊」第 2 ~ 5 點成立。
  網頁再用目前的盤口看第 1 點：受讓隊在旗標裡、受讓 0 < 分數 <= 9.5，才顯示。
  紀錄簿（dog_log.py）只記策略一。
--------------------------------------------------------------------------------

自己核對數字：python dog_rule.py（讀 db/history.db 三季和 db/nba.db 本季，只讀不寫）
每天的名單：python dog_rule.py --list（還沒打、而且符合任一策略的比賽，受讓分數用目前最新的盤口）
"""
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

SPREAD_MAX = 8.5  # 受讓不超過（含）
MIN_DROP = 2.0  # 最早那段 DRTG − 最近那段 DRTG 要超過
LAST_N, LAST_WINS = 5, 3  # 近 5 場至少贏 3 場
WINDOWS = ((5, 8), (3, 6), (1, 4))  # 往回數第 5~7、3~5、1~3 場（1 = 最近一場），每段 3 場
NEED_GAMES = 7  # 兩隊賽前都至少打過 7 場（同一季）
SPREAD_MAX2 = 9.5  # 策略二：受讓不超過（含）
NEED_GAMES2 = 10  # 策略二：兩隊賽前都至少打過 10 場
SHORT, LONG = 5, 10  # 策略二：近 5 場比近 10 場
# 網站準確率頁顯示的三季回測：策略一（<= SPREAD_MAX）或策略二（<= SPREAD_MAX2）符合的場次、受讓隊直接贏的場數。改規則要重算（python dog_rule.py）
BACKTEST = {"win": 210, "n": 488}
OOS_FROM = "2026-11-28"  # 兩個策略都定案之後的第一個比賽日（台灣日期）；這天起的成績才不是樣本內
CUP_NOTE = "NBA Cup Championship"  # 本季盃賽決賽（games.note）
CURRENT_END = "2027-04-11"  # 本季例行賽最後一天（美東日期）；之後的比賽不算、不標
REG_END = {"2023-24": "2024-04-14", "2024-25": "2025-04-13", "2025-26": "2026-04-12"}  # 例行賽最後一天（美東日期）
CUP_FINALS = {("2023-12-09", "Indiana Pacers", "Los Angeles Lakers"), ("2024-12-17", "Milwaukee Bucks", "Oklahoma City Thunder"),
              ("2025-12-16", "San Antonio Spurs", "New York Knicks")}
BOX = ("fgm", "fga", "fta", "orb", "drb", "tov")


def est_poss(t, o):
    """單隊估算回合（和 build_data.py 的 team_paces 同一個公式）；t = 這隊的數據、o = 對手的數據"""
    return t["fga"] + 0.4 * t["fta"] - 1.07 * t["orb"] / (t["orb"] + o["drb"]) * (t["fga"] - t["fgm"]) + t["tov"]


def game_row(a, h, apts, hpts):
    """一場的兩隊數據 -> (客隊的一筆, 主隊的一筆)，每筆 (回合, 得分, 失分)；回合 = 兩隊各估一次取平均"""
    p = 0.5 * (est_poss(a, h) + est_poss(h, a))
    return (p, apts, hpts), (p, hpts, apts)


def drtg(hist, lo, hi):
    """往回數第 lo ~ hi-1 場的 DRTG；hist 由舊到新，每筆 (回合, 得分, 失分)"""
    n = len(hist)
    seg = hist[n - (hi - 1): n - (lo - 1)]
    return 100 * sum(r[2] for r in seg) / sum(r[0] for r in seg)


def check(hist):
    """這隊賽前的紀錄 -> (符合第 3、4 點嗎, [三段 DRTG], 近 5 場勝場)；場數不到 7 場回傳 None"""
    if len(hist) < NEED_GAMES:
        return None
    d = [drtg(hist, lo, hi) for lo, hi in WINDOWS]
    wins = sum(r[1] > r[2] for r in hist[-LAST_N:])
    return d[0] > d[1] > d[2] and d[0] - d[2] > MIN_DROP and wins >= LAST_WINS, d, wins


def walk(games):
    """逐日往前走，回傳符合的比賽。games = [{date, away, home, away_pts, home_pts, box: {隊: 數據}, spread_home}]
    spread_home = 主隊讓分（正 = 主隊受讓、負 = 客隊受讓），沒有盤口或 0 的比賽不算"""
    hist, out = defaultdict(list), []
    for day in sorted({g["date"] for g in games}):
        today = [g for g in games if g["date"] == day]
        for g in today:
            s = g["spread_home"]
            if not s or abs(s) > SPREAD_MAX:
                continue
            away, home = check(hist[g["away"]]), check(hist[g["home"]])
            if away is None or home is None:
                continue
            dog_home = s > 0
            ok, d, wins = home if dog_home else away
            if ok:
                out.append({"date": day, "away": g["away"], "home": g["home"], "underdog": g["home"] if dog_home else g["away"],
                            "receives": abs(s), "drtg": [round(x, 1) for x in d], "wins": wins,
                            "won": (g["home_pts"] > g["away_pts"]) == dog_home})
        for g in today:  # 這天的比賽打完才加進紀錄
            ra, rh = game_row(g["box"][g["away"]], g["box"][g["home"]], g["away_pts"], g["home_pts"])
            hist[g["away"]].append(ra)
            hist[g["home"]].append(rh)
    return out


# ---------------------------------------------------------------- 策略二
def rtg(hist, n):
    """最近 n 場合併計算的 (ORTG, DRTG)，四捨五入到小數 1 位；hist 由舊到新，每筆 (回合, 得分, 失分)"""
    seg = hist[-n:]
    poss = sum(r[0] for r in seg)
    return round(100 * sum(r[1] for r in seg) / poss, 1), round(100 * sum(r[2] for r in seg) / poss, 1)


def check2(dog, fav):
    """受讓隊、讓分隊的賽前紀錄 -> 符合策略二第 2 ~ 5 點嗎"""
    if len(dog) < NEED_GAMES2 or len(fav) < NEED_GAMES2:
        return False
    wins = sum(r[1] > r[2] for r in dog[-LAST_N:])
    return wins >= LAST_WINS and rtg(dog, SHORT)[0] > rtg(dog, LONG)[0] and rtg(fav, SHORT)[1] < rtg(fav, LONG)[1]


def walk2(games, cap=SPREAD_MAX2):
    """策略二逐日往前走，回傳符合的比賽；games 格式同 walk()。cap = 受讓上限（None = 不設上限，原始規格的對帳用）"""
    hist, out = defaultdict(list), []
    for day in sorted({g["date"] for g in games}):
        today = [g for g in games if g["date"] == day]
        for g in today:
            s = g["spread_home"]
            if not s or (cap is not None and abs(s) > cap):
                continue
            dog_home = s > 0
            dog, fav = (g["home"], g["away"]) if dog_home else (g["away"], g["home"])
            if check2(hist[dog], hist[fav]):
                out.append({"date": day, "away": g["away"], "home": g["home"], "underdog": dog, "receives": abs(s),
                            "won": (g["home_pts"] > g["away_pts"]) == dog_home})
        for g in today:  # 這天的比賽打完才加進紀錄
            ra, rh = game_row(g["box"][g["away"]], g["box"][g["home"]], g["away_pts"], g["home_pts"])
            hist[g["away"]].append(ra)
            hist[g["home"]].append(rh)
    return out


# ---------------------------------------------------------------- 網站用：每場的旗標
def _et_day(g):
    return (datetime.strptime(g["utc"], "%Y-%m-%dT%H:%MZ") - timedelta(hours=6)).date().isoformat()  # 美東日期 = UTC - 6 小時


def _walk_finals(raw_games, boxes, flag=None):
    """逐日走過本季已完賽的比賽。回傳 (排好序的比賽, 目前每隊的紀錄 hist, 已完賽比賽的旗標 {場次編號: "a"/"h"/"ah"})；
    flag = 用哪個策略算旗標（預設策略一的 _flag，策略二傳 _flag2）"""
    flag = flag or _flag
    games = sorted((g for g in raw_games if g["utc"] and g["away"] and g["home"] and g.get("note") != CUP_NOTE and _et_day(g) <= CURRENT_END),
                   key=lambda g: (g["utc"], g["id"]))
    hist, flags = defaultdict(list), {}
    finals = [g for g in games if g["status"] == "STATUS_FINAL" and g["id"] in boxes and len(boxes[g["id"]]["stats"]) == 2
              and g["away_pts"] is not None and g["home_pts"] is not None]
    for day in sorted({_et_day(g) for g in finals}):
        today = [g for g in finals if _et_day(g) == day]
        for g in today:  # 先用賽前紀錄算旗標，這天的比賽全部算完才加進紀錄
            f = flag(hist, g)
            if f:
                flags[g["id"]] = f
        for g in today:
            st = boxes[g["id"]]["stats"]
            ra, rh = game_row(st[g["away"]], st[g["home"]], g["away_pts"], g["home_pts"])
            hist[g["away"]].append(ra)
            hist[g["home"]].append(rh)
    return games, hist, flags


def _flag(hist, g):
    """兩隊都打滿 7 場才有旗標；回傳哪幾隊符合第 3、4 點（"a" / "h" / "ah" / ""）"""
    a, h = check(hist[g["away"]]), check(hist[g["home"]])
    if a is None or h is None:
        return ""
    return ("a" if a[0] else "") + ("h" if h[0] else "")


def _flag2(hist, g):
    """策略二的旗標："a" = 如果客隊受讓就符合第 2 ~ 5 點、"h" = 如果主隊受讓就符合（誰受讓要看盤口，網頁判斷）"""
    a, h = hist[g["away"]], hist[g["home"]]
    return ("a" if check2(a, h) else "") + ("h" if check2(h, a) else "")


def _next_games(games):
    """還沒打的比賽裡，兩隊都是各自「下一場」的那些（更後面的比賽，中間隔著還沒打的賽程，紀錄會變，不算）"""
    seen, out = set(), []
    for g in games:
        if g["status"] == "STATUS_FINAL" or "POSTPONED" in g["status"] or "CANCELED" in g["status"]:  # 打完的、延期取消的不算「下一場」
            continue
        both_new = g["away"] not in seen and g["home"] not in seen
        seen.update((g["away"], g["home"]))
        if both_new:
            out.append(g)
    return out


def dog_flags(raw_games, boxes):
    """raw_games = store.read_schedule(conn)（每場 {id, utc, away, home, status, note, away_pts, home_pts}）；
    boxes = store.read_boxes(conn)（{場次編號: {stats: {隊: {fgm, fga, fta, orb, drb, tov}}}}）。
    回傳 {場次編號: "a" / "h" / "ah"}；沒有旗標的場次不在裡面。"""
    games, hist, flags = _walk_finals(raw_games, boxes)
    for g in _next_games(games):
        f = _flag(hist, g)
        if f:
            flags[g["id"]] = f
    return flags


def dog_flags2(raw_games, boxes):
    """策略二的旗標，格式和 dog_flags 相同：{場次編號: "a" / "h" / "ah"}（意思見 _flag2）"""
    games, hist, flags = _walk_finals(raw_games, boxes, _flag2)
    for g in _next_games(games):
        f = _flag2(hist, g)
        if f:
            flags[g["id"]] = f
    return flags


def upcoming2(raw_games, boxes, odds):
    """還沒打、而且符合策略二的比賽（受讓分數用目前最新的盤口；還沒開盤、或盤口是 0 的不列）。
    回傳 [{id, date（美東）, utc, away, home, underdog, receives, wins, ortg: (受讓隊近 5, 近 10), drtg: (讓分隊近 5, 近 10)}]"""
    games, hist, _ = _walk_finals(raw_games, boxes, _flag2)
    out = []
    for g in _next_games(games):
        s = ((odds.get(g["id"]) or {}).get("spread_home") or [None, None])[1]
        if not s or abs(s) > SPREAD_MAX2:
            continue
        dog, fav = (g["home"], g["away"]) if s > 0 else (g["away"], g["home"])
        if check2(hist[dog], hist[fav]):
            out.append({"id": g["id"], "date": _et_day(g), "utc": g["utc"], "away": g["away"], "home": g["home"], "underdog": dog,
                        "receives": abs(s), "wins": sum(r[1] > r[2] for r in hist[dog][-LAST_N:]),
                        "ortg": (rtg(hist[dog], SHORT)[0], rtg(hist[dog], LONG)[0]), "drtg": (rtg(hist[fav], SHORT)[1], rtg(hist[fav], LONG)[1])})
    return out


def upcoming(raw_games, boxes, odds):
    """還沒打、而且四點都符合的比賽（受讓分數用目前最新的盤口；還沒開盤、或盤口是 0 的不列）。
    odds = store.read_odds(conn)（{場次編號: {spread_home: [開盤, 目前], ...}}）。
    回傳 [{id, date（美東）, utc, away, home, underdog, receives, drtg: [三段], wins}]"""
    games, hist, _ = _walk_finals(raw_games, boxes)
    out = []
    for g in _next_games(games):
        s = ((odds.get(g["id"]) or {}).get("spread_home") or [None, None])[1]
        if not s or abs(s) > SPREAD_MAX or check(hist[g["away"]]) is None or check(hist[g["home"]]) is None:
            continue
        dog = g["home"] if s > 0 else g["away"]
        ok, d, wins = check(hist[dog])
        if ok:
            out.append({"id": g["id"], "date": _et_day(g), "utc": g["utc"], "away": g["away"], "home": g["home"], "underdog": dog,
                        "receives": abs(s), "drtg": [round(x, 1) for x in d], "wins": wins})
    return out


# ---------------------------------------------------------------- 核對數字（只讀）
def load_history(con, season):
    games = {}
    for e, d, a, h, ap, hp in con.execute("SELECT event_id, date, away, home, away_pts, home_pts FROM hist_games WHERE season = ?", (season,)):
        if d <= REG_END[season] and (d, a, h) not in CUP_FINALS and (d, h, a) not in CUP_FINALS:
            games[e] = {"date": d, "away": a, "home": h, "away_pts": ap, "home_pts": hp, "box": {}}
    for r in con.execute("SELECT event_id, team, fgm, fga, fta, orb, drb, tov FROM hist_team_box"):
        if r[0] in games:
            games[r[0]]["box"][r[1]] = dict(zip(BOX, r[2:]))
    spread = dict(con.execute("SELECT event_id, spread_home FROM hist_odds"))
    return [dict(g, spread_home=spread.get(e)) for e, g in games.items() if len(g["box"]) == 2]


def load_current(con):
    cup = {r[0] for r in con.execute("SELECT id FROM games WHERE note = ?", (CUP_NOTE,))}
    spread = dict(con.execute("SELECT game_id, spread_home_close FROM odds WHERE st = 'final'"))
    out = []
    for e, d, a, ap, h, hp in con.execute("SELECT id, date, away, away_pts, home, home_pts FROM games WHERE season = '2026-27' AND status = 'STATUS_FINAL'").fetchall():
        if e in cup:
            continue
        box = {r[0]: dict(zip(BOX, r[1:])) for r in con.execute("SELECT team, fgm, fga, fta, orb, drb, tov FROM team_box WHERE game_id = ?", (e,))}
        if len(box) == 2:
            out.append({"date": d, "away": a, "home": h, "away_pts": ap, "home_pts": hp, "box": box, "spread_home": spread.get(e)})
    return out


def print_upcoming(nba_db):
    """列出還沒打、而且符合規則的比賽（python dog_rule.py --list）"""
    import store
    nba_db.row_factory = sqlite3.Row  # store 的讀取函式用欄位名稱取值
    raw, boxes, odds = store.read_schedule(nba_db), store.read_boxes(nba_db), store.read_odds(nba_db)
    head = lambda r: (f"美東 {r['date']}（台灣 {(datetime.strptime(r['utc'], '%Y-%m-%dT%H:%MZ') + timedelta(hours=8)).strftime('%m/%d %H:%M')}）"
                      f"{r['away']} @ {r['home']}：受讓 {r['underdog']} {r['receives']} 分；")
    rows = upcoming(raw, boxes, odds)
    rows2 = upcoming2(raw, boxes, odds)
    if not rows and not rows2:
        print("目前沒有還沒打、而且符合規則的比賽")
    for r in rows:
        print("[策略一] " + head(r) + f"DRTG 第5~7場 {r['drtg'][0]} > 第3~5場 {r['drtg'][1]} > 第1~3場 {r['drtg'][2]}；近 5 場 {r['wins']} 勝")
    for r in rows2:
        print("[策略二] " + head(r) + f"受讓隊 ORTG 近5 {r['ortg'][0]} > 近10 {r['ortg'][1]}；讓分隊 DRTG 近5 {r['drtg'][0]} < 近10 {r['drtg'][1]}；近 5 場 {r['wins']} 勝")


if __name__ == "__main__":
    root = Path(__file__).parent
    sys.stdout.reconfigure(encoding="utf-8")
    if "--list" in sys.argv:
        print_upcoming(sqlite3.connect(f"file:{(root / 'db' / 'nba.db').as_posix()}?mode=ro", uri=True))
        sys.exit()
    hist_db = sqlite3.connect(f"file:{(root / 'db' / 'history.db').as_posix()}?mode=ro", uri=True)
    nba_db = sqlite3.connect(f"file:{(root / 'db' / 'nba.db').as_posix()}?mode=ro", uri=True)
    total = [0, 0]
    for s in REG_END:
        r = walk(load_history(hist_db, s))
        total[0] += len(r)
        total[1] += sum(x["won"] for x in r)
        print(f"{s}：符合 {len(r)} 場，受讓隊贏 {sum(x['won'] for x in r)} 場")
    print(f"三季合計：{total[0]} 場贏 {total[1]} 場 = {total[1] / total[0] * 100:.1f}%")
    r = walk(load_current(nba_db))
    last = nba_db.execute("SELECT MAX(date) FROM games WHERE season = '2026-27' AND status = 'STATUS_FINAL'").fetchone()[0]
    print(f"2026-27（到 {last}）：符合 {len(r)} 場，受讓隊贏 {sum(x['won'] for x in r)} 場")
    for cap in (SPREAD_MAX2, None):
        print(f"\n策略二（{'受讓 <= ' + str(cap) if cap else '不設受讓上限（原始規格對帳用）'}）")
        total = [0, 0]
        for s in REG_END:
            r = walk2(load_history(hist_db, s), cap)
            total[0] += len(r)
            total[1] += sum(x["won"] for x in r)
            print(f"{s}：符合 {len(r)} 場，受讓隊贏 {sum(x['won'] for x in r)} 場")
        print(f"三季合計：{total[0]} 場贏 {total[1]} 場 = {total[1] / total[0] * 100:.1f}%")
        r = walk2(load_current(nba_db), cap)
        print(f"2026-27（到 {last}）：符合 {len(r)} 場，受讓隊贏 {sum(x['won'] for x in r)} 場")
