import time

from flask import Blueprint, jsonify, request

from config import PIN
from database import backup_db, cur_night, current_id, db
from utils.helpers import err

bp = Blueprint("host", __name__)


@bp.post("/api/host/<action>")
def host(action):
    j = request.json or {}
    if j.get("pin") != PIN:
        return err("Wrong PIN", 403)
    d = db()
    if action == "current":
        d.execute(
            "INSERT OR REPLACE INTO meta VALUES('current', ?)", (str(int(j["song_id"])),)
        )
    elif action == "remove":
        sid = int(j["song_id"])
        song = d.execute("SELECT revealed FROM songs WHERE id = ?", (sid,)).fetchone()
        if not song:
            return err("Song not found.", 404)
        if song["revealed"]:
            return err("Revealed songs can't be removed.")
        d.execute("DELETE FROM scores WHERE song_id = ?", (sid,))
        d.execute("DELETE FROM songs WHERE id = ?", (sid,))
        if current_id(d) == sid:
            d.execute("DELETE FROM meta WHERE k = 'current'")
    elif action == "remove_player":
        pid = int(j["player_id"])
        if d.execute(
            "SELECT 1 FROM songs WHERE player_id = ? AND revealed = 1 UNION "
            "SELECT 1 FROM scores sc JOIN songs s ON s.id = sc.song_id "
            "WHERE sc.player_id = ? AND s.revealed = 1",
            (pid, pid),
        ).fetchone():
            return err("That player is part of revealed results and can't be removed.")
        for r in d.execute("SELECT id FROM songs WHERE player_id = ?", (pid,)).fetchall():
            d.execute("DELETE FROM scores WHERE song_id = ?", (r["id"],))
            d.execute("DELETE FROM songs WHERE id = ?", (r["id"],))
        d.execute("DELETE FROM scores WHERE player_id = ?", (pid,))
        d.execute("DELETE FROM players WHERE id = ?", (pid,))
        c = current_id(d)
        if c and not d.execute("SELECT 1 FROM songs WHERE id = ?", (c,)).fetchone():
            d.execute("DELETE FROM meta WHERE k = 'current'")
    elif action == "reveal":
        c = current_id(d)
        if c:
            d.execute("UPDATE songs SET revealed = 1 WHERE id = ?", (c,))
    elif action == "reset":
        backup_db(d)
        for t in ("scores", "songs", "players", "meta", "nights"):
            d.execute(f"DELETE FROM {t}")
        d.execute("INSERT INTO nights(started) VALUES(?)", (time.time(),))
    elif action == "newnight":
        n = cur_night(d)
        if not d.execute("SELECT 1 FROM songs WHERE night_id = ?", (n,)).fetchone():
            return err("Nothing to save yet. Submit a song first.")
        d.execute("UPDATE nights SET ended = ? WHERE id = ?", (time.time(), n))
        d.execute("DELETE FROM meta WHERE k = 'current'")
        d.execute("INSERT INTO nights(started) VALUES(?)", (time.time(),))
    elif action != "check":
        return err("Unknown action.", 404)
    d.commit()
    return jsonify(ok=True)
