import json
import re
import urllib.parse
import urllib.request

from flask import jsonify


def err(msg, code=400):
    return jsonify(error=msg), code


def clean_link(raw):
    """Return a canonical Spotify/YouTube link, "" if empty, or None if not allowed."""
    raw = raw.strip()
    if not raw:
        return ""
    u = urllib.parse.urlparse(raw)
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https"):
        return None
    if host == "open.spotify.com":
        m = re.fullmatch(r"/(?:intl-[a-z-]+/)?track/([A-Za-z0-9]{22})/?", u.path)
        return f"https://open.spotify.com/track/{m.group(1)}" if m else None
    vid = None
    if host in ("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"):
        if u.path == "/watch":
            vid = urllib.parse.parse_qs(u.query).get("v", [""])[0]
    elif host == "youtu.be":
        vid = u.path.lstrip("/")
    if vid and re.fullmatch(r"[\w-]{11}", vid):
        return f"https://www.youtube.com/watch?v={vid}"
    return None


def fetch_oembed(link):
    """Look up (title, artist) for a canonical link. Blanks on any failure."""
    base = (
        "https://open.spotify.com/oembed?url="
        if "spotify" in link
        else "https://www.youtube.com/oembed?format=json&url="
    )
    title = artist = ""
    try:
        req = urllib.request.Request(
            base + urllib.parse.quote(link, safe=""),
            headers={"User-Agent": "musical-hurt-feelings"},
        )
        with urllib.request.urlopen(req, timeout=4) as r:
            data = json.loads(r.read(100_000))
        title = (data.get("title") or "").strip()
        if "youtube" in link:
            artist = re.sub(r"\s*-\s*Topic$", "", (data.get("author_name") or "").strip())
    except Exception:
        pass
    return title, artist
