# -*- coding: utf-8 -*-
"""
檢查線上網站的資料是不是停在舊的（.github/workflows/check-fresh.yml 每天跑一次）。

判斷方式：賽程裡台灣日期在 STALE_DAYS 天以前、兩隊已確定、卻還標「尚未開打」或「進行中」的比賽 = 更新沒有進來。
延期、取消的比賽標的是 X，不會誤報；明星賽週或休賽期沒有比賽，也不會誤報。

執行：python check_fresh.py                     檢查線上網站
      python check_fresh.py data/schedule.js    檢查本機檔案
"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

SITE = "https://rhwj7y2.github.io/nba-predictor/data/schedule.js"
STALE_DAYS = 2


def load(source):
    if source.startswith("http"):
        with urllib.request.urlopen(f"{source}?t={int(datetime.now().timestamp())}", timeout=30) as r:
            text = r.read().decode("utf-8")
    else:
        with open(source, encoding="utf-8") as f:
            text = f.read()
    return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))


def stale_games(schedule, today):
    """today = 台灣今天的日期"""
    limit = (today - timedelta(days=STALE_DAYS)).isoformat()
    return [g for g in (schedule or {}).get("games", []) if g["d"] <= limit and g["s"] in ("S", "L") and g["a"] and g["h"]]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    old = stale_games(load(sys.argv[1] if len(sys.argv) > 1 else SITE), (datetime.now(timezone.utc) + timedelta(hours=8)).date())
    if old:
        sample = "、".join(f"{g['d']} {g['a']}@{g['h']}" for g in old[:5])
        print(f"::error::網站資料停在舊的：{len(old)} 場早該打完的比賽還沒有結果（{sample}）")
        sys.exit(1)
    print("網站資料是新的")
