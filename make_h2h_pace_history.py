# -*- coding: utf-8 -*-
"""
產生 raw/h2h_pace_history.json：2023-24、2024-25、2025-26 三個球季，每一組兩隊「碰面時的節奏（PACE）比兩隊本季平均多多少」的累計。
build_data.py 拿它加上本季已打的碰面，調整每場比賽的預測總分（見 build_data.py 的 H2H_PACE_K、H2H_PACE_MULT）。
只需要跑一次（過去三季的資料不會變），不在每天自動更新裡。要換成別的三個球季，改下面的 SEASONS。

每場回合數 = 出手 + 0.44 × 罰球出手 − 進攻籃板 + 失誤（兩隊各算一次、取平均）。
「兩隊本季平均」= 逐場往前推，兩隊各自這季「到那場之前」打過的場次的平均回合數，不到 5 場時往那季聯盟平均拉回（5 場的權重）。
殘差 = 這場實際回合數 − 上面那個預估。每組兩隊把三季的殘差加總（記下總和與場數），所以資料檔很小。

三季回測（驗證 2024-25 之後共 2,550 場）：用「之前所有碰面的殘差總和 ÷（場數 + 6）× 2.3」調整預測總分，
總分誤差 15.175 → 15.066，大小分猜對率 48.2% → 49.5%。

執行：python make_h2h_pace_history.py（約 5 分鐘，會向 ESPN 抓約 3,700 場的 boxscore）
"""
import json
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

sys.dont_write_bytecode = True
from build_data import TEAMS  # noqa: E402  （用來剔除明星賽：ESPN 把明星賽也標成例行賽）

OUT = Path(__file__).parent / "raw" / "h2h_pace_history.json"
SEASONS = {  # 球季 -> (例行賽第一天, 最後一天)（美東日期）
    "2023-24": (date(2023, 10, 24), date(2024, 4, 14)),
    "2024-25": (date(2024, 10, 22), date(2025, 4, 13)),
    "2025-26": (date(2025, 10, 21), date(2026, 4, 12)),
}
NBA_CUP_FINAL = {  # 盃賽決賽不算進例行賽戰績（中立場地）
    ("2023-12-09", "Indiana Pacers", "Los Angeles Lakers"), ("2023-12-09", "Los Angeles Lakers", "Indiana Pacers"),
    ("2024-12-17", "Milwaukee Bucks", "Oklahoma City Thunder"), ("2024-12-17", "Oklahoma City Thunder", "Milwaukee Bucks"),
    ("2025-12-16", "San Antonio Spurs", "New York Knicks"), ("2025-12-16", "New York Knicks", "San Antonio Spurs"),
}
NAME_FIX = {"LA Clippers": "Los Angeles Clippers"}
URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={}"
SHRINK_GAMES = 5  # 預估節奏：本季打得少時，往聯盟平均拉回的場數權重


def fetch_json(url):
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=40) as r:
                return json.load(r)
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"抓取失敗（已重試 4 次）：{url}\n{last}")


def game_list(first, last):
    """某球季所有已完賽例行賽：[(日期, 客隊, 主隊, ESPN 事件編號)]"""
    out, d = [], first
    while d <= last:
        for e in fetch_json(URL.format(d.strftime("%Y%m%d"))).get("events", []):
            if e["status"]["type"]["name"] != "STATUS_FINAL" or e.get("season", {}).get("type") != 2:
                continue
            side = {c["homeAway"]: NAME_FIX.get(c["team"]["displayName"], c["team"]["displayName"]) for c in e["competitions"][0]["competitors"]}
            if (d.isoformat(), side["away"], side["home"]) in NBA_CUP_FINAL or side["away"] not in TEAMS or side["home"] not in TEAMS:
                continue  # 盃賽決賽、明星賽（隊名是 Team Stripes 之類）都不算
            out.append((d.isoformat(), side["away"], side["home"], e["id"]))
        d += timedelta(days=1)
        time.sleep(0.15)
    return out


def possessions(event_id):
    """單場 boxscore -> {隊名: 回合數}"""
    res = {}
    for t in fetch_json(SUMMARY_URL.format(event_id))["boxscore"]["teams"]:
        s = {x["name"]: x["displayValue"] for x in t["statistics"]}
        fga = int(s["fieldGoalsMade-fieldGoalsAttempted"].split("-")[1])
        fta = int(s["freeThrowsMade-freeThrowsAttempted"].split("-")[1])
        res[NAME_FIX.get(t["team"]["displayName"], t["team"]["displayName"])] = fga + 0.44 * fta - int(s["offensiveRebounds"]) + int(s["totalTurnovers"])
    return res


def main():
    pairs = defaultdict(lambda: [0.0, 0])  # "隊A|隊B"（字母順序）-> [殘差總和, 場數]
    for season, (first, last) in SEASONS.items():
        games = game_list(first, last)
        print(f"{season}：{len(games)} 場，抓 boxscore 中…", flush=True)
        with ThreadPoolExecutor(6) as ex:
            boxes = list(ex.map(lambda g: possessions(g[3]), games))
        team_pace, league = defaultdict(list), []
        used = 0
        for (d, away, home, _), poss in sorted(zip(games, boxes), key=lambda x: (x[0][0], x[0][3])):
            pace = (poss[away] + poss[home]) / 2
            if team_pace[away] and team_pace[home]:  # 兩隊本季都至少打過一場，才有預估
                lg = sum(league) / len(league)
                shrunk = lambda xs: (sum(xs) + SHRINK_GAMES * lg) / (len(xs) + SHRINK_GAMES)
                resid = pace - (shrunk(team_pace[away]) + shrunk(team_pace[home])) / 2
                key = "|".join(sorted((away, home)))
                pairs[key][0] += resid
                pairs[key][1] += 1
                used += 1
            team_pace[away].append(pace)
            team_pace[home].append(pace)
            league.append(pace)
        print(f"  {season}：{used} 場有殘差", flush=True)
    data = {"seasons": list(SEASONS), "pairs": {k: [round(v[0], 3), v[1]] for k, v in sorted(pairs.items())}}
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"完成：{len(pairs)} 組對戰 -> {OUT}")


if __name__ == "__main__":
    main()
