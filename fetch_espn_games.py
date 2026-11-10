# -*- coding: utf-8 -*-
"""
從 ESPN 抓新球季的比賽資料，寫進資料庫 db/nba.db（資料表說明見 store.py）：
  games             每場比賽（已完賽的、還沒打的都有）：比分、各節得分、開賽時間、備註。每次更新，變動過的比賽就覆寫（賽程會改期、盃賽決賽的兩隊要打完四強才知道）
  team_box          已完賽比賽每隊的出手/罰球/籃板/失誤（算本季 PACE 用）。已經抓過的場次不會再抓，所以第一次跑要幾分鐘，之後每次只抓新打完的比賽
  player_box        已完賽比賽每位上場球員的上場時間、得分、籃板、助攻、正負值、投籃與三分的命中 / 出手（算球員分級、輪替陣容用）。一樣是增量
  odds              賭盤紀錄（DraftKings 的開盤與收盤）
  injury_snapshots  ESPN 現在的傷病名單；名單有變才新增一份快照，build_data.py 用最新一份算還沒開打的比賽的傷病扣分

單場的 summary（ESPN 一次給 boxscore、球員數據、盤口）每場只抓一次，三種資料一起存。
ESPN 日期是美東日期，和 Basketball-Reference 一致。任何一天或任何一場抓取失敗就直接報錯，不會默默少資料。
賽程每天都從開幕夜一路抓到例行賽最後一天（ESPN 不支援一次抓一段日期，所以是一天一天抓）；已經全部打完、又是幾天前的日子不再重抓。

執行：python fetch_espn_games.py
      python fetch_espn_games.py --end 2026-11-10     （只抓到指定日期）
      python fetch_espn_games.py --no-schedule        （不抓還沒到的日子，只更新到 --end）
      python fetch_espn_games.py --injuries-only      （只更新傷病名單，幾秒鐘）
"""
import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.dont_write_bytecode = True
import store  # noqa: E402
from build_data import TEAMS  # noqa: E402

SEASON = "2026-27"
SEASON_START = date(2026, 10, 20)  # 2026-27 開幕夜
SEASON_END = date(2027, 4, 11)  # 例行賽最後一天（美東日期）
PRE_HOURS = 48  # 未來幾小時內要開賽的比賽，更新時就先記下目前的盤口（開賽後 ESPN 賽事列表就不給盤口了）
SKIP_RECENT_DAYS = 2  # 「全部打完」而且早於今天這麼多天的日子，不再重抓
URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={}"
INJ_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
NAME_FIX = {"LA Clippers": "Los Angeles Clippers"}  # ESPN 隊名 -> build_data.py 的 TEAMS 隊名


def fetch_json(url, what):
    last_err = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # 網路錯誤、JSON 壞掉都重試
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"{what} 抓取失敗（已重試 4 次）：{last_err}")


# ---------------------------------------------------------------- 比賽（賽程 + 比分）
def games_of_day(d):
    """某個美東日期的所有例行賽（含還沒打的、打完的）-> games 表的資料列。隊名是 'TBD' 的（盃賽決賽）記成 None。"""
    out = []
    for seq, e in enumerate(fetch_json(URL.format(d.strftime("%Y%m%d")), str(d)).get("events", [])):
        if e.get("season", {}).get("type") != 2:
            continue
        comp = e["competitions"][0]
        side = {c["homeAway"]: c for c in comp["competitors"]}
        names = {}
        for k, c in side.items():
            raw = c["team"].get("displayName", "")
            name = NAME_FIX.get(raw, raw)
            if name not in TEAMS and raw != "TBD":
                raise SystemExit(f"{d} 有 ESPN 隊名對不上 TEAMS：{raw}（請補 NAME_FIX）")
            names[k] = name if name in TEAMS else None
        notes = [n.get("headline") for n in comp.get("notes", []) if n.get("headline")]
        status = e["status"]["type"]["name"]
        final = status == "STATUS_FINAL"
        out.append({
            "id": e["id"], "season": SEASON, "date": d.isoformat(), "utc": e["date"], "away": names["away"], "home": names["home"],
            "status": status, "neutral": 1 if comp.get("neutralSite") else 0, "note": notes[0] if notes else None,
            "away_pts": int(side["away"]["score"]) if final else None, "home_pts": int(side["home"]["score"]) if final else None,
            "periods": int(e["status"]["period"]) if final else None,  # 4 = 沒打延長賽，5 = 一節延長賽…
            # 各節得分（第 1~4 節，打延長賽會多幾個）
            "away_q": [int(x["value"]) for x in side["away"].get("linescores", [])] if final else None,
            "home_q": [int(x["value"]) for x in side["home"].get("linescores", [])] if final else None,
            "seq": seq,
        })
    return out


def day_is_settled(conn, d, today):
    """這天早就全部打完了嗎（資料庫裡有這天的比賽、而且全是已完賽或延期取消）-> 不用再向 ESPN 要。"""
    if d >= today - timedelta(days=SKIP_RECENT_DAYS):
        return False
    rows = conn.execute("SELECT status, utc FROM games WHERE date = ?", (d.isoformat(),)).fetchall()
    return bool(rows) and all(r["utc"] and (r["status"] == "STATUS_FINAL" or "POSTPONED" in r["status"] or "CANCELED" in r["status"]) for r in rows)


def fetch_games(conn, first, last):
    today = date.today()
    d, n_days, n_games = first, 0, 0
    while d <= last:
        if not day_is_settled(conn, d, today):
            rows = games_of_day(d)
            store.upsert_games(conn, rows)
            n_games += len(rows)
            n_days += 1
            time.sleep(0.2)
        d += timedelta(days=1)
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM games WHERE season = ?", (SEASON,)).fetchone()[0]
    final = conn.execute("SELECT COUNT(*) FROM games WHERE season = ? AND status = 'STATUS_FINAL'", (SEASON,)).fetchone()[0]
    print(f"賽程與比分：{first} ~ {last}，這次向 ESPN 要了 {n_days} 天（{n_games} 場）；資料庫共 {total} 場，已完賽 {final} 場")


# ---------------------------------------------------------------- 單場 summary：boxscore、球員數據、盤口
def box_of(summary, game):
    """summary -> 兩隊的出手/罰球/籃板/失誤。"""
    stats = {}
    for t in summary["boxscore"]["teams"]:
        name = NAME_FIX.get(t["team"]["displayName"], t["team"]["displayName"])
        s = {x["name"]: x["displayValue"] for x in t["statistics"]}
        fgm, fga = (int(v) for v in s["fieldGoalsMade-fieldGoalsAttempted"].split("-"))
        fta = int(s["freeThrowsMade-freeThrowsAttempted"].split("-")[1])
        stats[name] = {"fgm": fgm, "fga": fga, "fta": fta, "orb": int(s["offensiveRebounds"]),
                       "drb": int(s["defensiveRebounds"]), "tov": int(s["totalTurnovers"])}
    assert set(stats) == {game["away"], game["home"]}, f"事件 {game['id']} boxscore 隊名對不上：{set(stats)}"
    return stats


def _int(s):
    """'38' -> 38、'+9' -> 9、'-5' -> -5；空字串或 '--' 回傳 None。"""
    try:
        return int(str(s).strip())
    except ValueError:
        return None


def _made_att(s):
    """'12-21' -> (12, 21)；看不懂回傳 (None, None)。"""
    try:
        m, a = str(s).strip().split("-")
        return int(m), int(a)
    except ValueError:
        return None, None


def players_of(summary, game):
    """summary -> 兩隊每位上場球員的 [ESPN球員編號, 名字, 上場分鐘, 得分, 籃板, 助攻, 正負值, 投籃命中, 投籃出手, 三分命中, 三分出手]（沒上場的不收）。"""
    out = {}
    for t in summary["boxscore"]["players"]:
        name = NAME_FIX.get(t["team"]["displayName"], t["team"]["displayName"])
        st = t["statistics"][0]
        idx = {k: st["labels"].index(k) for k in ("MIN", "PTS", "REB", "AST", "+/-")}
        rows = []
        for a in st["athletes"]:
            s = a.get("stats") or []
            if a.get("didNotPlay") or not s:
                continue
            row = [_int(s[idx[k]]) for k in ("MIN", "PTS", "REB", "AST", "+/-")]
            if not row[0]:  # 上場時間是 0 或 "--" = 沒有真的上場（ESPN 有時不會標 DNP）
                continue
            assert None not in row, f"事件 {game['id']} {a['athlete']['displayName']} 的數據看不懂：{s}"
            shots = [*_made_att(s[st["labels"].index("FG")]), *_made_att(s[st["labels"].index("3PT")])] if "FG" in st["labels"] and "3PT" in st["labels"] else [None] * 4
            rows.append([a["athlete"]["id"], a["athlete"]["displayName"]] + row + shots)
        out[name] = rows
    assert set(out) == {game["away"], game["home"]}, f"事件 {game['id']} 球員數據隊名對不上：{set(out)}"
    return out


def _num(s):
    """盤口文字轉數字：'+4.5' -> 4.5、'o229.5' -> 229.5、'-110' -> -110.0、'EVEN' / 'PK' -> 0（讓分平手）。"""
    if s is None:
        return None
    s = str(s).strip().lstrip("ou")
    if s.upper() in ("EVEN", "PK", "PICK"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


def _pair(node):
    """盤口節點 {'open': {...}, 'close': {...}} -> [開盤, 收盤]（line 優先，沒有就取 odds）。"""
    out = []
    for k in ("open", "close"):
        x = (node or {}).get(k) or {}
        out.append(_num(x.get("line") if x.get("line") is not None else x.get("odds")))
    return out


def odds_of(summary):
    """summary 的 pickcenter -> 賭盤紀錄（DraftKings）；查不到盤口回傳 None。已完賽的比賽這裡是收盤（開賽前最後）盤口。"""
    pcs = summary.get("pickcenter") or []
    pc = pcs[0] if pcs else None
    if not pc or pc.get("overUnder") is None or not pc.get("pointSpread"):
        return None
    ps, tot, ml = pc["pointSpread"], pc.get("total") or {}, pc.get("moneyline") or {}
    odds_pair = lambda n: [_num((n.get(k) or {}).get("odds")) for k in ("open", "close")]
    return {
        "provider": (pc.get("provider") or {}).get("name"),
        "spread_home": _pair(ps.get("home")),            # 主隊讓分 [開盤, 收盤]，負 = 主隊讓分（熱門）
        "spread_odds": {"home": odds_pair(ps.get("home") or {}), "away": odds_pair(ps.get("away") or {})},
        "total": _pair(tot.get("over")),                  # 總分 [開盤, 收盤]
        "total_odds": {"over": odds_pair(tot.get("over") or {}), "under": odds_pair(tot.get("under") or {})},
        "moneyline": {"home": odds_pair(ml.get("home") or {}), "away": odds_pair(ml.get("away") or {})},
    }


def fetch_summaries(conn):
    """已完賽比賽：還缺 boxscore、球員數據或收盤盤口的，向 ESPN 要一次 summary，三種資料一起存。
    還沒打完的比賽（未來 PRE_HOURS 小時內要開打的、進行中的）：只存盤口。

    odds.st：
      "pre"   還沒開賽、未來 PRE_HOURS 小時內要開打的比賽：每次更新都重抓，最後一次更新就是「開賽前最後記錄的盤口」
      "live"  進行中的比賽：只在還沒有紀錄時存一次（單場資料裡的盤口仍是開賽前的收盤盤口），不會蓋掉上面的 pre
      "final" 已完賽：單場資料裡的收盤盤口最可靠，會蓋掉 pre / live，之後不再重抓
    ESPN 賽事列表一開打就把盤口拿掉，網頁即時抓不到，所以趁還查得到時存下來；網頁開賽後就改顯示這裡的盤口。
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # 現在的 UTC 時間（和賽程裡的 utc 欄位同一種）
    have_box = {r[0] for r in conn.execute("SELECT DISTINCT game_id FROM team_box")}
    have_players = {r[0] for r in conn.execute("SELECT DISTINCT game_id FROM player_box WHERE fga IS NOT NULL")}  # 還沒有投籃數據的舊紀錄也算「缺」，會重抓一次補上
    odds_st = {r["game_id"]: r["st"] for r in conn.execute("SELECT game_id, st FROM odds")}
    new_box = new_odds = missing = 0
    for g in conn.execute("SELECT * FROM games WHERE season = ? AND away IS NOT NULL AND home IS NOT NULL ORDER BY date, seq, id", (SEASON,)).fetchall():
        g = dict(g)
        status = g["status"]
        need_box = status == "STATUS_FINAL" and (g["id"] not in have_box or g["id"] not in have_players)
        if status == "STATUS_FINAL":
            odds_st_new = "final" if odds_st.get(g["id"]) != "final" else None
        elif status == "STATUS_SCHEDULED":
            hours = (datetime.strptime(g["utc"], "%Y-%m-%dT%H:%MZ") - now).total_seconds() / 3600
            odds_st_new = "pre" if -1 <= hours <= PRE_HOURS else None  # 太遠的比賽盤口還會變，不存；剛過開賽時間但狀態還沒更新的也算
        elif "POSTPONED" in status or "CANCELED" in status:
            odds_st_new = None
        else:  # 進行中（含中場、節間休息）
            odds_st_new = "live" if g["id"] not in odds_st else None
        if not need_box and not odds_st_new:
            continue
        summary = fetch_json(SUMMARY_URL.format(g["id"]), f"事件 {g['id']} 的 summary")
        time.sleep(0.3)
        if need_box:
            store.save_team_box(conn, g["id"], box_of(summary, g))
            store.save_player_box(conn, g["id"], players_of(summary, g))
            new_box += 1
        if odds_st_new:
            rec = odds_of(summary)
            if rec is None:
                missing += 1  # 這場查不到盤口：不存，下次更新再試
            else:
                store.save_odds(conn, g["id"], {"utc": g["utc"], "away": g["away"], "home": g["home"], "st": odds_st_new, **rec})
                new_odds += 1
        conn.commit()  # 一場一存：中途出錯，前面抓好的不會白費
    have = conn.execute("SELECT COUNT(DISTINCT game_id) FROM team_box").fetchone()[0]
    print(f"boxscore 與球員數據：新抓 {new_box} 場，共 {have} 場；賭盤紀錄：新存 {new_odds} 場，查不到 {missing} 場")


# ---------------------------------------------------------------- 傷病名單
def fetch_injuries(conn):
    """ESPN 現在的傷病名單 -> injury_snapshots（名單有變才新增一份快照；「最後抓取時間」每次都更新）。

    build_data.py 拿最新一份算「還沒開打的比賽」每隊缺陣球員的傷病扣分；開賽後那場的扣分就凍結在 injury_adj，不會再跟著名單變。
    每位球員記 id（ESPN 球員編號，和逐場球員數據的編號一樣）、名字、狀態（Out = 缺陣、Day-To-Day = 每日觀察）、預計回歸日 r（美國日期）。
    """
    j = fetch_json(INJ_URL, "傷病名單")
    teams = {}
    for t in j.get("injuries", []):
        rows = []
        for i in t.get("injuries", []):
            a = i.get("athlete") or {}
            m = re.search(r"/id/(\d+)/", json.dumps(a.get("links", [])))
            pid = str(a.get("id") or (m.group(1) if m else ""))
            if pid:
                rows.append({"id": pid, "n": a.get("displayName", "?"), "s": i.get("status", ""), "r": (i.get("details") or {}).get("returnDate") or ""})
        teams[NAME_FIX.get(t["displayName"], t["displayName"])] = rows
    fetched = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    changed = store.save_injury_snapshot(conn, fetched, teams)
    conn.commit()
    n_out = sum(1 for v in teams.values() for r in v if r["s"] == "Out")
    print(f"傷病名單：{len(teams)} 隊，缺陣 {n_out} 人；{'名單有變，新增一份快照' if changed else '和上一份一樣，沒有新增快照'}")


def main(end, with_schedule=True):
    conn = store.connect()
    fetch_games(conn, SEASON_START, SEASON_END if with_schedule else end)
    fetch_summaries(conn)
    fetch_injuries(conn)
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="從 ESPN 抓新球季的賽程、比分、boxscore、盤口與傷病名單，寫進資料庫 db/nba.db")
    parser.add_argument("--end", type=date.fromisoformat, default=date.today(), help="抓到哪一天（預設今天；沒加 --no-schedule 時賽程仍會抓到例行賽最後一天）")
    parser.add_argument("--no-schedule", action="store_true", help="不抓還沒到的日子（只更新到 --end）")
    parser.add_argument("--injuries-only", action="store_true", help="只更新傷病名單（開賽前想刷新傷病扣分時用，幾秒鐘）")
    args = parser.parse_args()
    if args.injuries_only:
        conn = store.connect()
        fetch_injuries(conn)
    else:
        main(args.end, not args.no_schedule)
