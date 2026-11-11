# -*- coding: utf-8 -*-
"""
後端資料存放：一個 SQLite 檔案（db/nba.db）。fetch_espn_games.py 往裡面寫，build_data.py 從裡面讀，
網頁讀的 data/*.js 還是由 build_data.py 產生，前端完全不變。

為什麼用 SQLite：Python 內建、一個檔案、不用架伺服器，GitHub Actions 直接能跑；而且可以用 SQL 查（例如「某隊近 10 場」「兩隊歷史碰面」），
也能把「每次抓到的傷病名單」一筆一筆累積成歷史（以前的 JSON 檔每次整個覆蓋，賽前的名單存不下來）。

資料表（括號是主鍵）：
  games           (id)              每場比賽：美東日期、開賽時間(UTC)、隊伍、狀態、比分、各節得分、備註（盃賽、墨西哥城…）、當天順序
  team_box        (game_id, team)   每場每隊的出手、罰球、籃板、失誤（算 PACE 用）
  player_box      (game_id, player_id)  每場每位上場球員的上場時間、得分、籃板、助攻、正負值、投籃與三分的命中 / 出手
  odds            (game_id)         每場的盤口紀錄（DraftKings 開盤與收盤讓分、總分、賠率；st = pre / live / final）
  injury_snapshots(fetched, team, player_id)  ESPN 傷病名單的歷史快照（名單有變才新增一份）
  injury_adj      (key)             每場比賽凍結的傷病扣分（開賽後不再變動）
  h2h_pace        (pair)            過去三季每組兩隊的對戰節奏殘差總和與場數
  season_games    (season, date, away, home)  前幾季的比分（網頁顯示「上季交手紀錄」用）
  meta            (key)             雜項：傷病名單最後一次抓取時間等

read_* 函式回傳的資料形狀，和以前 raw/*.json 的內容一模一樣，所以 build_data.py 的計算邏輯不用改。
"""
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "db" / "nba.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY, season TEXT NOT NULL, date TEXT NOT NULL, utc TEXT, away TEXT, home TEXT,
    status TEXT NOT NULL, neutral INTEGER DEFAULT 0, note TEXT, away_pts INTEGER, home_pts INTEGER,
    periods INTEGER, away_q TEXT, home_q TEXT, seq INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS games_date ON games(date);
CREATE TABLE IF NOT EXISTS team_box (
    game_id TEXT NOT NULL, team TEXT NOT NULL, fgm INTEGER, fga INTEGER, fta INTEGER, orb INTEGER, drb INTEGER, tov INTEGER,
    PRIMARY KEY (game_id, team)
);
CREATE TABLE IF NOT EXISTS player_box (
    game_id TEXT NOT NULL, team TEXT NOT NULL, player_id TEXT NOT NULL, name TEXT, minutes INTEGER, pts INTEGER, reb INTEGER, ast INTEGER, pm INTEGER,
    ord INTEGER, fgm INTEGER, fga INTEGER, tpm INTEGER, tpa INTEGER, blk INTEGER,  -- 投籃命中 / 出手、三分命中 / 出手、阻攻（舊資料是 NULL，fetch_espn_games.py 下次更新會補）
    PRIMARY KEY (game_id, player_id)
);
CREATE TABLE IF NOT EXISTS odds (
    game_id TEXT PRIMARY KEY, utc TEXT, away TEXT, home TEXT, st TEXT, provider TEXT,
    spread_home_open REAL, spread_home_close REAL, total_open REAL, total_close REAL, detail TEXT
);
CREATE TABLE IF NOT EXISTS injury_snapshots (
    fetched TEXT NOT NULL, team TEXT NOT NULL, player_id TEXT NOT NULL, name TEXT, status TEXT, ret TEXT DEFAULT '',  -- ret = ESPN 的預計回歸日（美國日期，沒填就是空字串）
    PRIMARY KEY (fetched, team, player_id)
);
CREATE TABLE IF NOT EXISTS injury_adj (
    key TEXT PRIMARY KEY, ja, jh, jp TEXT, at TEXT, bf INTEGER DEFAULT 0  -- ja / jh 不宣告型別：整數維持整數（0）、小數維持小數（2.0），輸出的 JSON 才和以前一樣
);
CREATE TABLE IF NOT EXISTS h2h_pace (pair TEXT PRIMARY KEY, resid_sum REAL NOT NULL, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS season_games (
    season TEXT NOT NULL, date TEXT NOT NULL, away TEXT NOT NULL, away_pts INTEGER, home TEXT NOT NULL, home_pts INTEGER, seq INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def connect(path=None):
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    if "ret" not in [r[1] for r in conn.execute("PRAGMA table_info(injury_snapshots)")]:  # 舊資料庫：補上「預計回歸日」欄位
        conn.execute("ALTER TABLE injury_snapshots ADD COLUMN ret TEXT DEFAULT ''")
    have = [r[1] for r in conn.execute("PRAGMA table_info(player_box)")]
    for col in ("fgm", "fga", "tpm", "tpa", "blk"):  # 舊資料庫：補上球員投籃、三分的命中與出手、阻攻欄位
        if col not in have:
            conn.execute(f"ALTER TABLE player_box ADD COLUMN {col} INTEGER")
    return conn


# ---------------------------------------------------------------- 寫入（fetch / migrate 用）
def upsert_games(conn, rows):
    """rows: dict 清單，欄位同 games 表（away_q / home_q 給 list，這裡轉成 JSON 文字）。同一場（id）再寫一次就是更新。"""
    conn.executemany(
        """INSERT INTO games (id, season, date, utc, away, home, status, neutral, note, away_pts, home_pts, periods, away_q, home_q, seq)
           VALUES (:id, :season, :date, :utc, :away, :home, :status, :neutral, :note, :away_pts, :home_pts, :periods, :away_q, :home_q, :seq)
           ON CONFLICT(id) DO UPDATE SET season=excluded.season, date=excluded.date, utc=excluded.utc, away=excluded.away, home=excluded.home,
               status=excluded.status, neutral=excluded.neutral, note=excluded.note, away_pts=excluded.away_pts, home_pts=excluded.home_pts,
               periods=excluded.periods, away_q=excluded.away_q, home_q=excluded.home_q, seq=excluded.seq""",
        [{**r, "away_q": json.dumps(r["away_q"]) if r.get("away_q") is not None else None,
          "home_q": json.dumps(r["home_q"]) if r.get("home_q") is not None else None} for r in rows])


def save_team_box(conn, game_id, stats):
    """stats: {隊名: {fgm, fga, fta, orb, drb, tov}}"""
    conn.executemany("INSERT OR REPLACE INTO team_box VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     [(game_id, t, s["fgm"], s["fga"], s["fta"], s["orb"], s["drb"], s["tov"]) for t, s in stats.items()])


def save_player_box(conn, game_id, players):
    """players: {隊名: [[球員編號, 名字, 上場分鐘, 得分, 籃板, 助攻, 正負值, 投籃命中, 投籃出手, 三分命中, 三分出手, 阻攻], ...]}（後五個可以省略）"""
    conn.executemany("INSERT OR REPLACE INTO player_box (game_id, team, player_id, name, minutes, pts, reb, ast, pm, ord, fgm, fga, tpm, tpa, blk) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     [(game_id, team, r[0], r[1], r[2], r[3], r[4], r[5], r[6], i, *(list(r[7:12]) + [None] * 5)[:5])
                      for team, rows in players.items() for i, r in enumerate(rows)])


def save_odds(conn, game_id, rec):
    """rec：{utc, away, home, st, provider, spread_home: [開, 收], total: [開, 收], ...}（整份存進 detail）"""
    conn.execute("INSERT OR REPLACE INTO odds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                 (game_id, rec["utc"], rec["away"], rec["home"], rec.get("st", "final"), rec.get("provider"),
                  rec["spread_home"][0], rec["spread_home"][1], rec["total"][0], rec["total"][1],
                  json.dumps(rec, ensure_ascii=False)))


def save_injury_snapshot(conn, fetched, teams):
    """teams: {隊名: [{"id", "n", "s", "r"（預計回歸日，可省略）}]}。和最新一份完全一樣就不新增（歷史只記「有變」的時刻），但「最後抓取時間」每次都更新。"""
    new = {(t, r["id"], r["n"], r["s"], r.get("r") or "") for t, rows in teams.items() for r in rows}
    last = conn.execute("SELECT MAX(fetched) FROM injury_snapshots").fetchone()[0]
    old = {(r["team"], r["player_id"], r["name"], r["status"], r["ret"] or "") for r in conn.execute(
        "SELECT team, player_id, name, status, ret FROM injury_snapshots WHERE fetched = ?", (last,))} if last else None
    changed = old != new
    if changed:
        conn.executemany("INSERT OR REPLACE INTO injury_snapshots (fetched, team, player_id, name, status, ret) VALUES (?, ?, ?, ?, ?, ?)",
                         [(fetched, *row) for row in sorted(new)])
    set_meta(conn, "injuries_fetched", fetched)
    return changed


def write_injury_adj(conn, mem):
    """mem: {key: {ja, jh, jp, at[, bf]}}，整份取代。"""
    conn.execute("DELETE FROM injury_adj")
    conn.executemany("INSERT INTO injury_adj VALUES (?, ?, ?, ?, ?, ?)",
                     [(k, v["ja"], v["jh"], json.dumps(v["jp"], ensure_ascii=False), v.get("at"), 1 if v.get("bf") else 0) for k, v in mem.items()])


def set_meta(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, value))


# ---------------------------------------------------------------- 讀取（回傳和以前 raw/*.json 同樣形狀）
def read_boxes(conn):
    """{事件編號: {date, away, home, periods, stats: {隊名: {fgm, fga, fta, orb, drb, tov}}}}（只有已經有 boxscore 的比賽）"""
    out = {}
    for g in conn.execute("SELECT g.id, g.date, g.away, g.home, g.periods FROM games g WHERE g.id IN (SELECT game_id FROM team_box) ORDER BY g.date, g.id"):
        out[g["id"]] = {"date": g["date"], "away": g["away"], "home": g["home"], "periods": g["periods"], "stats": {}}
    for r in conn.execute("SELECT * FROM team_box"):
        if r["game_id"] in out:
            out[r["game_id"]]["stats"][r["team"]] = {k: r[k] for k in ("fgm", "fga", "fta", "orb", "drb", "tov")}
    return out


def read_players(conn):
    """{事件編號: {date, away, home, p: {隊名: [[球員編號, 名字, 上場分鐘, 得分, 籃板, 助攻, 正負值, 投籃命中, 投籃出手, 三分命中, 三分出手, 阻攻], ...]}}}（後五個還沒補的舊資料是 None）"""
    out = {}
    for g in conn.execute("SELECT g.id, g.date, g.away, g.home FROM games g WHERE g.id IN (SELECT game_id FROM player_box) ORDER BY g.date, g.id"):
        out[g["id"]] = {"date": g["date"], "away": g["away"], "home": g["home"], "p": {g["away"]: [], g["home"]: []}}
    for r in conn.execute("SELECT * FROM player_box ORDER BY game_id, team, ord"):
        if r["game_id"] in out:
            out[r["game_id"]]["p"][r["team"]].append([r["player_id"], r["name"], r["minutes"], r["pts"], r["reb"], r["ast"], r["pm"],
                                                      r["fgm"], r["fga"], r["tpm"], r["tpa"], r["blk"]])
    return out


def read_schedule(conn):
    """賽程清單（依開賽時間、事件編號排序）：每場 {id, utc, away, home, status, neutral, note, away_pts, home_pts, away_q, home_q}"""
    out = []
    for r in conn.execute("SELECT * FROM games ORDER BY utc, id"):
        out.append({"id": r["id"], "utc": r["utc"], "away": r["away"], "home": r["home"], "status": r["status"], "neutral": bool(r["neutral"]),
                    "note": r["note"], "away_pts": r["away_pts"], "home_pts": r["home_pts"],
                    "away_q": json.loads(r["away_q"]) if r["away_q"] else None, "home_q": json.loads(r["home_q"]) if r["home_q"] else None})
    return out


def read_final_games(conn, season):
    """某球季已完賽比賽（賽季中模式的比分來源）：[(美東日期字串, 客隊, 客隊得分, 主隊, 主隊得分)]，同一天依 ESPN 順序"""
    return [(r["date"], r["away"], r["away_pts"], r["home"], r["home_pts"]) for r in conn.execute(
        "SELECT date, away, away_pts, home, home_pts FROM games WHERE season = ? AND status = 'STATUS_FINAL' ORDER BY date, seq, id", (season,))]


def read_season_games(conn, season):
    """前幾季的比分：[(日期字串, 客隊, 客隊得分, 主隊, 主隊得分)]"""
    return [(r["date"], r["away"], r["away_pts"], r["home"], r["home_pts"]) for r in conn.execute(
        "SELECT date, away, away_pts, home, home_pts FROM season_games WHERE season = ? ORDER BY date, seq", (season,))]


def read_odds(conn):
    return {r["game_id"]: json.loads(r["detail"]) for r in conn.execute("SELECT game_id, detail FROM odds")}


def read_injuries_latest(conn):
    """{fetched, teams: {隊名: [{id, n, s, r}]}}（r = 預計回歸日，美國日期，沒有就是空字串）；從沒抓過回傳 None"""
    fetched = conn.execute("SELECT value FROM meta WHERE key = 'injuries_fetched'").fetchone()
    last = conn.execute("SELECT MAX(fetched) FROM injury_snapshots").fetchone()[0]
    if not fetched or not last:
        return None
    teams = {}
    for r in conn.execute("SELECT team, player_id, name, status, ret FROM injury_snapshots WHERE fetched = ? ORDER BY team, rowid", (last,)):
        teams.setdefault(r["team"], []).append({"id": r["player_id"], "n": r["name"], "s": r["status"], "r": r["ret"] or ""})
    return {"fetched": fetched["value"], "teams": teams}


def read_injury_adj(conn):
    out = {}
    for r in conn.execute("SELECT * FROM injury_adj ORDER BY key"):
        v = {"ja": r["ja"], "jh": r["jh"], "jp": json.loads(r["jp"]), "at": r["at"]}
        if r["bf"]:
            v["bf"] = 1
        out[r["key"]] = v
    return out


def read_h2h_pace(conn):
    return {r["pair"]: [r["resid_sum"], r["n"]] for r in conn.execute("SELECT * FROM h2h_pace")}
