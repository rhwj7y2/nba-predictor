# -*- coding: utf-8 -*-
"""
把 2023-24、2024-25、2025-26 三個球季的逐場 box score、球員上場時間、盤口，永久存成獨立的資料庫 db/history.db（SQLite）。
用途：三季歷史回測（驗證預測公式、調參數）。這些資料不會再變，所以存成獨立檔、commit 一次就好；
不放進 db/nba.db，因為那個檔每天由機器人 commit，本機改它會和機器人衝突。機器人不會動 db/history.db。

來源是四個 jsonl 檔（原本放在 Claude 的暫存資料夾，會被系統清理，所以才要存下來）：
  boxes.jsonl       每行一場：美東日期、比分、兩隊的出手 / 罰球 / 籃板 / 失誤
  players.jsonl     每行一場：兩隊每位球員的上場分鐘、得分
  hist_odds.jsonl   每行一場：DraftKings 的最終讓分、總分（沒有就是 null）、是否中立場地
  hist_odds2.jsonl  沒有 DraftKings 的場次的備用盤口（ESPN BET、Caesars…）
四個檔只讀不改；只要有一個不見就停下來，不會自己去 ESPN 重新抓。

資料表（每次執行都整個重建：先刪表再建，可以重跑，結果一樣）：
  hist_games      (event_id)             每場比賽：球季、美東日期、隊伍、比分、是否中立場地、節數（4 = 沒打延長賽）
  hist_team_box   (event_id, team)       每場每隊的出手、罰球、籃板、失誤（算 PACE 用）
  hist_player_min (event_id, player_id)  每場每位球員的上場分鐘、得分
  hist_odds       (event_id)             每場的讓分（主隊視角，負 = 主隊被看好）和總分；source = "dk" 或備用莊家名稱
  hist_meta       (key)                  建立時間、來源說明、各表筆數

節數 periods 沒有直接的資料，用上場分鐘推：兩隊各自的球員上場分鐘加總 ÷ 5，兩隊取平均 = 這場的比賽分鐘數，
periods = 4 + max(0, round((比賽分鐘數 − 48) ÷ 5))（延長賽每節 5 分鐘）。
備用盤口只在 DraftKings 沒有可用的讓分與總分時才用：跳過名稱含 "live" 的，
依序優先 ESPN BET、Caesars、MGM、Unibet、Betfair、bet365（不分大小寫），都沒有就取第一個。

讀取用 store.connect_history()（唯讀）和 store.read_hist_games(conn, season)。

執行：python make_history_db.py [來源資料夾]
  不給資料夾就用下面 SOURCE_DIR（raw/history_src/）。約幾秒鐘。
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True
import store  # noqa: E402
from build_data import TEAMS  # noqa: E402  （用來檢查隊名：全部要是 30 隊的正式名稱）

SOURCE_DIR = Path(__file__).parent / "raw" / "history_src"  # 原始 jsonl 放這裡（只留在本機，見 .gitignore）
FILES = ("boxes.jsonl", "players.jsonl", "hist_odds.jsonl", "hist_odds2.jsonl")
NAME_FIX = {"LA Clippers": "Los Angeles Clippers"}  # ESPN 的隊名 -> build_data.py 的 TEAMS 用的隊名
ALT_PRIORITY = ("espn bet", "caesars", "mgm", "unibet", "betfair", "bet365")  # 備用莊家的優先順序（名稱含這些字，不分大小寫）

SCHEMA = """
CREATE TABLE hist_games (
    event_id TEXT PRIMARY KEY, season TEXT NOT NULL, date TEXT NOT NULL, away TEXT NOT NULL, home TEXT NOT NULL,
    away_pts INTEGER, home_pts INTEGER, neutral INTEGER DEFAULT 0, periods INTEGER
);
CREATE TABLE hist_team_box (
    event_id TEXT NOT NULL, team TEXT NOT NULL, fgm INTEGER, fga INTEGER, ftm INTEGER, fta INTEGER, orb INTEGER, drb INTEGER, tov INTEGER,
    PRIMARY KEY (event_id, team)
);
CREATE TABLE hist_player_min (
    event_id TEXT NOT NULL, team TEXT NOT NULL, player_id TEXT NOT NULL, minutes INTEGER, pts INTEGER,
    PRIMARY KEY (event_id, player_id)
);
CREATE TABLE hist_odds (event_id TEXT PRIMARY KEY, source TEXT NOT NULL, spread_home REAL, total REAL);
CREATE TABLE hist_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX hist_games_date ON hist_games(date);
"""
TABLES = ("hist_games", "hist_team_box", "hist_player_min", "hist_odds")


def fix(name):
    name = NAME_FIX.get(name, name)
    if name not in TEAMS:
        raise SystemExit(f"隊名對不上 TEAMS：{name!r}")
    return name


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def season_of(d):
    """美東日期 date -> 球季：10～12 月 = 當年-下年後兩碼，1～9 月 = 前一年-當年後兩碼"""
    return f"{d.year}-{(d.year + 1) % 100:02d}" if d.month >= 10 else f"{d.year - 1}-{d.year % 100:02d}"


def periods_of(team_rows):
    """team_rows：{隊名: [[球員編號, 上場分鐘, 得分], ...]} -> 節數"""
    mins = [sum(r[1] or 0 for r in rows) / 5 for rows in team_rows.values()]  # 每隊：上場分鐘加總 ÷ 5 = 比賽分鐘數
    game_min = sum(mins) / len(mins)
    return 4 + max(0, round((game_min - 48) / 5))


def pick_alt(alts):
    """備用盤口：跳過 live，依 ALT_PRIORITY 挑，都沒有就取第一個；回傳 (莊家名稱, 讓分, 總分) 或 None"""
    ok = [a for a in alts if a.get("spread") is not None and a.get("ou") is not None and "live" not in a["p"].lower()]
    for key in ALT_PRIORITY:
        for a in ok:
            if key in a["p"].lower():
                return a["p"], a["spread"], a["ou"]
    return (ok[0]["p"], ok[0]["spread"], ok[0]["ou"]) if ok else None


def main(source_dir):
    missing = [f for f in FILES if not (source_dir / f).is_file()]
    if missing:
        raise SystemExit(f"來源檔不見了（在 {source_dir}）：{', '.join(missing)}\n不會自己重新向 ESPN 抓，請先把檔案找回來。")
    boxes, players = read_jsonl(source_dir / "boxes.jsonl"), {r["id"]: r for r in read_jsonl(source_dir / "players.jsonl")}
    odds = {r["id"]: r for r in read_jsonl(source_dir / "hist_odds.jsonl")}
    alts = {r["id"]: r["alts"] for r in read_jsonl(source_dir / "hist_odds2.jsonl")}

    games, team_box, player_min, odds_rows = [], [], [], []
    for b in boxes:
        eid, pl = b["id"], players.get(b["id"])
        if pl is None:
            raise SystemExit(f"players.jsonl 沒有這場：{eid}")
        d = datetime.strptime(b["d"], "%Y%m%d").date()
        away, home = fix(b["away"]), fix(b["home"])
        o = odds.get(eid) or {}
        games.append((eid, season_of(d), d.isoformat(), away, home, int(b["as_"]), int(b["hs"]), 1 if o.get("neutral") else 0,
                      periods_of({fix(t): rows for t, rows in pl["teams"].items()})))
        for t, s in b["teams"].items():
            team_box.append((eid, fix(t), s["fgm"], s["fga"], s["ftm"], s["fta"], s["orb"], s["drb"], s["tov"]))
        for t, rows in pl["teams"].items():
            for pid, minutes, pts in rows:
                player_min.append((eid, fix(t), str(pid), minutes or 0, pts))  # 分鐘是 null 就當 0
        dk = o.get("dk")
        if dk and dk.get("spread") is not None and dk.get("ou") is not None:
            odds_rows.append((eid, "dk", dk["spread"], dk["ou"]))
        else:
            alt = pick_alt(alts.get(eid, []))  # 只有 DraftKings 沒有可用盤口時才用備用莊家
            if alt:
                odds_rows.append((eid, alt[0], alt[1], alt[2]))

    path = store.HISTORY_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    for t in (*TABLES, "hist_meta"):
        conn.execute(f"DROP TABLE IF EXISTS {t}")
    conn.executescript(SCHEMA)
    conn.executemany("INSERT INTO hist_games VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", sorted(games, key=lambda r: (r[2], r[0])))
    conn.executemany("INSERT INTO hist_team_box VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", sorted(team_box))
    conn.executemany("INSERT INTO hist_player_min VALUES (?, ?, ?, ?, ?)", sorted(player_min))
    conn.executemany("INSERT INTO hist_odds VALUES (?, ?, ?, ?)", sorted(odds_rows))
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}
    conn.executemany("INSERT INTO hist_meta VALUES (?, ?)", [
        ("created", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")),
        ("source", "2023-24～2025-26 三季逐場 box score、球員上場時間、盤口（ESPN；盤口優先 DraftKings，沒有才用備用莊家），由 make_history_db.py 從 jsonl 轉成"),
        *[(f"rows_{t}", str(n)) for t, n in counts.items()],
    ])
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    for t, n in counts.items():
        print(f"{t}：{n} 筆")
    print(f"完成 -> {path}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE_DIR)
