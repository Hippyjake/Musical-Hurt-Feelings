import os

DB = os.environ.get("DB_PATH", "data/game.db")
PIN = os.environ.get("HOST_PIN", "1234")
CATEGORIES = [
    c.strip()
    for c in os.environ.get(
        "CATEGORIES", "Composition,Musicianship,Originality,Vocals,Lyrical depth,Vibe"
    ).split(",")
    if c.strip()
]
