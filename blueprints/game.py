from flask import Blueprint, jsonify, request

from database import cur_night, current_id, db, player_exists
from utils.helpers import clean_link, err, fetch_oembed

bp = Blueprint("game", __name__)


def load_songs(d, night=None, pid=None):
    cats = [dict(r) for r in d.execute("SELECT id, name FROM categories ORDER BY pos")]
    where, args = ("WHERE s.night_id = ?", (night,)) if night else ("", ())
    sizes = dict(d.execute("SELECT night_id, COUNT(*) FROM players GROUP BY night_id").fetchall())
    songs = [
        dict(r)
        for r in d.execute(
            "SELECT s.*, p.name AS submitter, n.started AS night_started FROM songs s "
            "JOIN players p ON p.id = s.player_id JOIN nights n ON n.id = s.night_id "
            f"{where} ORDER BY s.id",
            args,
        )
    ]
    by_song = {}
    for r in d.execute(
        "SELECT sc.*, p.name FROM scores sc JOIN players p ON p.id = sc.player_id "
        f"JOIN songs s ON s.id = sc.song_id {where}",
        args,
    ):
        entry = by_song.setdefault(r["song_id"], {}).setdefault(
            r["player_id"], {"name": r["name"], "scores": {}}
        )
        entry["scores"][r["category_id"]] = r["value"]

    for s in songs:
        votes = by_song.get(s["id"], {})
        s["voted"] = len(votes)
        s["eligible"] = max(sizes.get(s["night_id"], 0) - 1, 0)
        s["mine"] = votes.get(pid, {}).get("scores")
        if s["revealed"]:
            vals = [v for x in votes.values() for v in x["scores"].values()]
            s["results"] = {
                "avg": sum(vals) / len(vals) if vals else 0,
                "cat": {
                    c["id"]: (
                        sum(x["scores"].get(c["id"], 0) for x in votes.values())
                        / len(votes)
                        if votes
                        else 0
                    )
                    for c in cats
                },
                "votes": [
                    {"name": x["name"], "scores": x["scores"]} for x in votes.values()
                ],
            }
    return cats, songs


@bp.get("/api/state")
def state():
    d = db()
    n = cur_night(d)
    pid = request.args.get("player_id", type=int)
    players = [
        dict(r)
        for r in d.execute("SELECT id, name FROM players WHERE night_id = ? ORDER BY id", (n,))
    ]
    cats, songs = load_songs(d, n, pid)
    last = d.execute(
        "SELECT id, ended FROM nights WHERE ended IS NOT NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return jsonify(
        players=players,
        categories=cats,
        songs=songs,
        current=current_id(d),
        last_night=dict(last) if last else None,
    )


@bp.get("/api/leaderboard")
def leaderboard_data():
    d = db()
    pick = request.args.get("night", "")
    night = None if pick == "all" else int(pick) if pick.isdigit() else cur_night(d)
    cats, songs = load_songs(d, night)
    nights = [
        dict(r, current=r["ended"] is None)
        for r in d.execute("SELECT id, started, ended FROM nights ORDER BY id DESC")
    ]
    return jsonify(
        categories=cats,
        songs=[s for s in songs if s["revealed"]],
        nights=nights,
        night=night or "all",
    )


@bp.post("/api/join")
def join():
    name = ((request.json or {}).get("name") or "").strip()[:30]
    if not name:
        return err("Enter your name.")
    d = db()
    night = cur_night(d)
    r = d.execute(
        "SELECT id, name FROM players WHERE name = ? AND night_id = ?", (name, night)
    ).fetchone()
    if r:
        return jsonify(id=r["id"], name=r["name"])
    cur = d.execute("INSERT INTO players(name, night_id) VALUES(?, ?)", (name, night))
    d.commit()
    return jsonify(id=cur.lastrowid, name=name)


@bp.post("/api/songs")
def add_song():
    j = request.json or {}
    d = db()
    title = (j.get("title") or "").strip()[:120]
    if not title:
        return err("Enter a song title.")
    link = clean_link(j.get("link") or "")
    if link is None:
        return err("Links must be a Spotify track or YouTube video.")
    if not player_exists(d, j.get("player_id")):
        return err("Join the game first.", 404)
    d.execute(
        "INSERT INTO songs(title, artist, link, player_id, night_id) VALUES(?, ?, ?, ?, ?)",
        (
            title,
            (j.get("artist") or "").strip()[:120],
            link,
            j["player_id"],
            cur_night(d),
        ),
    )
    d.commit()
    return jsonify(ok=True)


@bp.post("/api/score")
def score():
    j = request.json or {}
    d = db()
    pid, sid = j.get("player_id"), j.get("song_id")
    song = d.execute("SELECT * FROM songs WHERE id = ?", (sid,)).fetchone()
    if not song or song["night_id"] != cur_night(d) or not player_exists(d, pid):
        return err("Song or player not found.", 404)
    if song["revealed"]:
        return err("Scores for this song are already revealed.")
    if song["player_id"] == pid:
        return err("You can't score your own song.")
    raw = j.get("scores") or {}
    try:
        vals = {
            r["id"]: int(raw[str(r["id"])])
            for r in d.execute("SELECT id FROM categories")
        }
    except (KeyError, ValueError, TypeError):
        return err("Score every category.")
    if any(not 0 <= v <= 10 for v in vals.values()):
        return err("Scores must be between 0 and 10.")
    d.executemany(
        "INSERT OR REPLACE INTO scores VALUES(?, ?, ?, ?)",
        [(sid, pid, c, v) for c, v in vals.items()],
    )
    d.commit()
    return jsonify(ok=True)


@bp.get("/api/lookup")
def lookup():
    link = clean_link(request.args.get("url", ""))
    if not link:
        return err("Use a Spotify track or YouTube video link.")
    title, artist = fetch_oembed(link)
    return jsonify(link=link, title=title[:120], artist=artist[:120])
