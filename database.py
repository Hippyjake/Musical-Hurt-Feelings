import os
import sqlite3
import time

from flask import g

from config import CATEGORIES, DB

SCHEMA = """
CREATE TABLE IF NOT EXISTS players(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE,
  night_id INTEGER NOT NULL DEFAULT 1, UNIQUE(name, night_id));
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, pos INTEGER);
CREATE TABLE IF NOT EXISTS songs(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, artist TEXT, link TEXT,
  player_id INTEGER NOT NULL, revealed INTEGER DEFAULT 0, night_id INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS scores(
  song_id INTEGER, player_id INTEGER, category_id INTEGER, value INTEGER NOT NULL,
  PRIMARY KEY(song_id, player_id, category_id));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS nights(id INTEGER PRIMARY KEY, started REAL, ended REAL);
"""


def backup_db(con):
    """Save a timestamped copy of the database (only if there is any game data)."""
    if not con.execute("SELECT 1 FROM songs").fetchone():
        return
    folder = os.path.join(os.path.dirname(DB) or ".", "backups")
    os.makedirs(folder, exist_ok=True)
    dest = sqlite3.connect(os.path.join(folder, time.strftime("game-%Y%m%d-%H%M%S.db")))
    con.backup(dest)
    dest.close()


def init_db():
    os.makedirs(os.path.dirname(DB) or ".", exist_ok=True)
    con = sqlite3.connect(DB, timeout=10)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(SCHEMA)
    if "night_id" not in [r[1] for r in con.execute("PRAGMA table_info(players)")]:
        backup_db(con)
        con.executescript(
            """
            ALTER TABLE players RENAME TO players_old;
            CREATE TABLE players(id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE,
              night_id INTEGER NOT NULL DEFAULT 1, UNIQUE(name, night_id));
            INSERT INTO players(id, name, night_id) SELECT id, name, 1 FROM players_old;
            DROP TABLE players_old;
            """
        )
    if "night_id" not in [r[1] for r in con.execute("PRAGMA table_info(songs)")]:
        con.execute("ALTER TABLE songs ADD COLUMN night_id INTEGER NOT NULL DEFAULT 1")
    if not con.execute("SELECT 1 FROM nights").fetchone():
        con.execute("INSERT INTO nights(id, started) VALUES(1, ?)", (time.time(),))
    have = {name: cid for cid, name in con.execute("SELECT id, name FROM categories")}
    removed = [cid for name, cid in have.items() if name not in CATEGORIES]
    added = [n for n in CATEGORIES if n not in have]
    if removed:
        backup_db(con)
    for cid in removed:
        con.execute("DELETE FROM scores WHERE category_id = ?", (cid,))
        con.execute("DELETE FROM categories WHERE id = ?", (cid,))
    for n in added:
        con.execute("INSERT INTO categories(name, pos) VALUES(?, 0)", (n,))
    for i, n in enumerate(CATEGORIES):
        con.execute("UPDATE categories SET pos = ? WHERE name = ?", (i, n))
    con.commit()
    con.close()


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB, timeout=10)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(_):
    d = g.pop("db", None)
    if d:
        d.close()


def current_id(d):
    r = d.execute("SELECT v FROM meta WHERE k='current'").fetchone()
    return int(r["v"]) if r else None


def cur_night(d):
    r = d.execute("SELECT id FROM nights WHERE ended IS NULL ORDER BY id DESC LIMIT 1").fetchone()
    if r:
        return r["id"]
    return d.execute("INSERT INTO nights(started) VALUES(?)", (time.time(),)).lastrowid


def player_exists(d, pid):
    return d.execute(
        "SELECT 1 FROM players WHERE id = ? AND night_id = ?", (pid, cur_night(d))
    ).fetchone()
