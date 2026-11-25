# -*- coding: utf-8 -*-
"""
「防守進步的受讓隊」紀錄簿：從 2026-11-25（美東日期）起，每一場符合 dog_rule.py 規則的比賽都記下來，比賽打完補上結果。
存在獨立的 db/dog_log.db（不動 db/nba.db）；機器人每次更新資料時會跑這支（見 .github/workflows/update-data.yml），一起 commit。

規矩（資料庫裡用觸發器擋住，不是只靠這支程式守規矩）：
 - 只能新增：不能刪。已經記下的欄位不能改；只有「比分、受讓隊有沒有贏」三格可以從空的補上一次，補上就不能再改。
 - 記錄的是「第一次符合時」的內容（受讓幾分、三段 DRTG、近 5 場勝場）。開賽前盤口變了、變成不符合，也不會刪。
 - 不回補：2026-11-25 之前的場次不記；已經開打（或打完）才第一次發現的場次也不記，只記開賽前看到的。

欄位：game_id, date（美東日期）, away, home, underdog（受讓隊）, receives（受讓幾分）, drtg_5to7, drtg_3to5, drtg_1to3,
      last5_wins（近 5 場勝場）, recorded（記下的時間 UTC）, away_pts, home_pts, underdog_won（1 = 受讓隊直接贏球）

執行：
  python dog_log.py            記錄新符合的比賽、補打完的結果，再印累計報告
  python dog_log.py --report   只印累計報告（不寫入）
報告 = 符合幾場、受讓隊贏幾場、勝率，另附「同樣受讓分數的受讓隊」三季平均勝率（用 db/history.db 的三季例行賽算）。
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
import dog_rule  # noqa: E402
import store  # noqa: E402

START = "2026-11-25"  # 從這天（美東日期）起才記
LOG_PATH = Path(__file__).parent / "db" / "dog_log.db"
RESULT_COLS = ("away_pts", "home_pts", "underdog_won")
FIXED_COLS = ("game_id", "date", "away", "home", "underdog", "receives", "drtg_5to7", "drtg_3to5", "drtg_1to3", "last5_wins", "recorded")

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS dog_log (
    game_id TEXT PRIMARY KEY, date TEXT NOT NULL, away TEXT NOT NULL, home TEXT NOT NULL, underdog TEXT NOT NULL, receives REAL NOT NULL,
    drtg_5to7 REAL NOT NULL, drtg_3to5 REAL NOT NULL, drtg_1to3 REAL NOT NULL, last5_wins INTEGER NOT NULL, recorded TEXT NOT NULL,
    away_pts INTEGER, home_pts INTEGER, underdog_won INTEGER
);
CREATE TRIGGER IF NOT EXISTS dog_log_no_delete BEFORE DELETE ON dog_log
BEGIN SELECT RAISE(ABORT, 'dog_log 只能新增，不能刪'); END;
CREATE TRIGGER IF NOT EXISTS dog_log_no_edit BEFORE UPDATE ON dog_log
WHEN {" OR ".join(f"OLD.{c} IS NOT NEW.{c}" for c in FIXED_COLS)}
  OR (OLD.away_pts IS NOT NULL AND OLD.away_pts IS NOT NEW.away_pts)
  OR (OLD.home_pts IS NOT NULL AND OLD.home_pts IS NOT NEW.home_pts)
  OR (OLD.underdog_won IS NOT NULL AND OLD.underdog_won IS NOT NEW.underdog_won)
BEGIN SELECT RAISE(ABORT, 'dog_log 已記下的內容不能改（只有空的結果欄可以補一次）'); END;
"""


def open_log():
    conn = sqlite3.connect(LOG_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def open_nba():
    conn = sqlite3.connect(f"file:{(Path(__file__).parent / 'db' / 'nba.db').as_posix()}?mode=ro", uri=True)  # 只讀
    conn.row_factory = sqlite3.Row
    return conn


def record(log, nba):
    """記下新符合的比賽，補上打完的結果；回傳 (新增幾場, 補結果幾場)"""
    raw = store.read_schedule(nba)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    new = 0
    for r in dog_rule.upcoming(raw, store.read_boxes(nba), store.read_odds(nba)):
        if r["date"] < START or r["utc"] <= now:  # 11/25 之前不記；已經開打的不記（只記開賽前看到的）
            continue
        cur = log.execute("INSERT OR IGNORE INTO dog_log (game_id, date, away, home, underdog, receives, drtg_5to7, drtg_3to5, drtg_1to3, last5_wins, recorded) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                          (r["id"], r["date"], r["away"], r["home"], r["underdog"], r["receives"], *r["drtg"], r["wins"], now))
        new += cur.rowcount
    done = 0
    final = {g["id"]: g for g in raw if g["status"] == "STATUS_FINAL" and g["away_pts"] is not None and g["home_pts"] is not None}
    for row in log.execute("SELECT game_id, underdog, home FROM dog_log WHERE underdog_won IS NULL").fetchall():
        g = final.get(row["game_id"])
        if g:
            won = (g["home_pts"] > g["away_pts"]) == (row["underdog"] == row["home"])
            log.execute("UPDATE dog_log SET away_pts = ?, home_pts = ?, underdog_won = ? WHERE game_id = ?", (g["away_pts"], g["home_pts"], int(won), row["game_id"]))
            done += 1
    log.commit()
    return new, done


def baseline(receives):
    """同樣受讓分數的受讓隊平均勝率：receives = 要對照的受讓分數清單。每一個拿三季例行賽（db/history.db）裡「受讓分數差不超過 0.5 分」的受讓隊
    （受讓 0 ~ 8.5 分）的勝率，再平均。用三季那 247 場符合的比賽算出來是 38.3%（使用者手算是 38.2%，定義有一點點不同）"""
    h = sqlite3.connect(f"file:{(Path(__file__).parent / 'db' / 'history.db').as_posix()}?mode=ro", uri=True)
    pool = []  # (受讓分數, 受讓隊有沒有贏)
    for season, end in dog_rule.REG_END.items():
        for d, a, hm, ap, hp, s in h.execute("SELECT g.date, g.away, g.home, g.away_pts, g.home_pts, o.spread_home FROM hist_games g JOIN hist_odds o ON o.event_id = g.event_id "
                                             "WHERE g.season = ?", (season,)):
            if d > end or (d, a, hm) in dog_rule.CUP_FINALS or (d, hm, a) in dog_rule.CUP_FINALS or not s or abs(s) > dog_rule.SPREAD_MAX:
                continue
            pool.append((abs(s), (hp > ap) == (s > 0)))
    rates = []
    for x in receives:
        near = [w for sp, w in pool if abs(sp - x) <= 0.5]
        if near:
            rates.append(sum(near) / len(near))
    return sum(rates) / len(rates) if rates else None


def report(log):
    rows = log.execute("SELECT * FROM dog_log ORDER BY date, game_id").fetchall()
    done = [r for r in rows if r["underdog_won"] is not None]
    print(f"符合並記錄：{len(rows)} 場（從 {START} 起），已打完 {len(done)} 場，還沒打 {len(rows) - len(done)} 場")
    if done:
        w = sum(r["underdog_won"] for r in done)
        b = baseline([r["receives"] for r in done])
        print(f"受讓隊贏 {w} 場，勝率 {w / len(done) * 100:.1f}%；同樣受讓分數的受讓隊三季平均 {b * 100:.1f}%" if b is not None else f"受讓隊贏 {w} 場，勝率 {w / len(done) * 100:.1f}%")
    for r in rows:
        res = "—" if r["underdog_won"] is None else ("贏" if r["underdog_won"] else "輸") + f"（{r['away_pts']}:{r['home_pts']}）"
        print(f"  {r['date']} {r['away']} @ {r['home']} 受讓 {r['underdog']} {r['receives']} 分 DRTG {r['drtg_5to7']}>{r['drtg_3to5']}>{r['drtg_1to3']} 近5場{r['last5_wins']}勝 → {res}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    log = open_log()
    if "--report" not in sys.argv:
        new, done = record(log, open_nba())
        print(f"新增 {new} 場、補上 {done} 場的結果")
    report(log)
