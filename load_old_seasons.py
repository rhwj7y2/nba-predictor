"""一次性：把前幾季（2023-24、2024-25）例行賽每場比分抓進資料庫的 season_games 資料表，網頁「交手紀錄」的下拉選單要用。

為什麼：2025-26 的整季比分在資料庫裡了（球季進行中拿來算 SRS 起點、顯示上季交手），更早的球季沒有。
資料來源是 ESPN 賽程（每天一次請求，約 170 天 × 2 季，約 2~3 分鐘），只存：球季、美東日期、客隊、客隊得分、主隊、主隊得分、當天順序。
NBA 盃決賽不算例行賽，build_data.py 讀的時候會用 HISTORY_SEASONS 裡的 excluded 排除。

執行（三季的比分不會再變，只需要跑一次）：
    python load_old_seasons.py                 # 抓完直接寫進 db/nba.db
    python load_old_seasons.py --db 某份.db     # 寫進另一份資料庫（測試用）
    python load_old_seasons.py --cache 檔.json  # 抓下來的資料另存 / 已經有就直接用，不用再抓一次
"""
import argparse
import json
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import store
from build_data import TEAMS

SEASONS = {  # 球季 -> (第一天, 例行賽最後一天)，都是美東日期
    "2023-24": (date(2023, 10, 24), date(2024, 4, 14)),
    "2024-25": (date(2024, 10, 22), date(2025, 4, 13)),
}
URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={}"
FIX = {"LA Clippers": "Los Angeles Clippers"}


def get(url):
    err = None
    for k in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
                return json.load(r)
        except Exception as e:  # 網路偶爾失敗，等一下重試
            err = e
            time.sleep(1.5 * (k + 1))
    sys.exit(f"抓不到 {url}：{err}")


def fetch_season(first, last):
    rows, d = [], first
    while d <= last:
        seq = 0
        for e in get(URL.format(d.strftime("%Y%m%d"))).get("events", []):
            if e["status"]["type"]["name"] != "STATUS_FINAL" or e.get("season", {}).get("type") != 2:
                continue
            c = {x["homeAway"]: x for x in e["competitions"][0]["competitors"]}
            name = {k: FIX.get(v["team"]["displayName"], v["team"]["displayName"]) for k, v in c.items()}
            if name["away"] not in TEAMS or name["home"] not in TEAMS:  # 全明星賽等不算
                continue
            rows.append([d.isoformat(), name["away"], int(c["away"]["score"]), name["home"], int(c["home"]["score"]), seq])
            seq += 1
        d += timedelta(days=1)
        time.sleep(0.15)
    return rows


def main():
    ap = argparse.ArgumentParser(description="把前幾季每場比分存進資料庫 season_games")
    ap.add_argument("--db", type=Path, default=store.DB_PATH)
    ap.add_argument("--cache", type=Path, default=None, help="抓下來的資料另存成 json；檔案已經存在就直接用")
    args = ap.parse_args()
    if args.cache and args.cache.exists():
        data = json.loads(args.cache.read_text(encoding="utf-8"))
    else:
        data = {}
        for s, (first, last) in SEASONS.items():
            data[s] = fetch_season(first, last)
            print(f"{s}：{len(data[s])} 場", flush=True)
        if args.cache:
            args.cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    conn = store.connect(args.db)
    for s, rows in data.items():
        conn.execute("DELETE FROM season_games WHERE season = ?", (s,))
        conn.executemany("INSERT INTO season_games (season, date, away, away_pts, home, home_pts, seq) VALUES (?, ?, ?, ?, ?, ?, ?)",
                         [(s, *r) for r in rows])
        print(f"{s}：寫進 {args.db}（{len(rows)} 場）")
    conn.commit()


if __name__ == "__main__":
    main()
