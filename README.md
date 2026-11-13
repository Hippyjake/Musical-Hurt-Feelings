# Musical Hurt Feelings

A self-hosted party game for a room full of people with phones. Everyone submits a song, then the whole room scores each song from 0 to 10 in several categories. The host reveals the scores, and a leaderboard keeps track of every song from every game night.

Built with Flask and SQLite. It runs in a single Docker container and needs no accounts.

## Features

**Players**
- Join with just a name. Rejoining with the same name restores your seat.
- Submit a song with an optional Spotify track or YouTube video link. Pasting a link auto-fills the title (and the artist for YouTube).
- Score the song that is playing with a 0 to 10 slider per category. You can change your scores until the reveal, and you can't score your own song.
- See a live count of how many people have voted and the song queue.
- The reveal shows the overall average, a bar for each category, and a "Who gave what" breakdown.
- Phones refresh themselves every 2 seconds.

**Host** (unlocked with the host PIN)
- Choose which queued song plays next, or remove a queued song.
- Reveal the scores.
- Remove players (unless their scores are part of revealed results).
- Save tonight's results and start a new game night, or delete everything.
- Step down as host on that device.

**Leaderboard page** (`/leaderboard`)
- Rankings with each category's average, plus an "Every score" table showing each person's votes.
- Switch between tonight, any past night, or all nights.
- Songs that share a Spotify or YouTube link are combined into one entry.
- An **Awards** card for the selected night (see below).

**End-of-night awards**
- **The Simon Cowell:** the player whose scores averaged lowest across the night.
- **The Hype Man:** the player whose scores averaged highest.
- **The Controversial Pick:** the song whose voters disagreed the most (highest standard deviation of each voter's overall score for it).
- Awards need at least two voters, and ties are shared. They appear on the leaderboard page for any night or all nights, and on the join screen for 12 hours after the host saves a night.

**Default categories:** Composition, Musicianship, Originality, Vocals, Lyrical depth, Vibe.

## Quick start

### Docker Compose

```bash
git clone https://github.com/Hippyjake/Musical-Hurt-Feelings.git
cd Musical-Hurt-Feelings
cp .env.example .env    # then edit .env and set HOST_PIN
docker compose up -d
```

Open `http://<server-ip>:8000` on any phone on the same network. Game data is stored in `./data`.

### Docker without Compose

```bash
docker build -t musical-hurt-feeling:latest .
docker run -d --name musical-hurt-feeling -p 8000:8000 \
  -e HOST_PIN=your-pin \
  -v "$PWD/data:/data" \
  --restart unless-stopped \
  musical-hurt-feeling:latest
```

### CasaOS

CasaOS can't build images, so build the image first (see above), then import this compose text in the CasaOS app installer:

```yaml
name: musical-hurt-feeling
services:
  musical-hurt-feeling:
    image: musical-hurt-feeling:latest
    pull_policy: never
    container_name: musical-hurt-feeling
    ports:
      - "8000:8000"
    environment:
      HOST_PIN: "your-pin"
    volumes:
      - /DATA/Documents/musical-hurt-feeling/data:/data
    restart: unless-stopped
x-casaos:
  main: musical-hurt-feeling
  port_map: "8000"
  title:
    en_us: Musical Hurt Feelings
```

After any code change, rebuild the image and click Save in the app's CasaOS settings to recreate the container.

### Without Docker

```bash
pip install -r requirements.txt
HOST_PIN=your-pin python run.py
```

The app listens on port 8000 and stores its database in `data/game.db`.

## Configuration

All settings are environment variables.

| Variable     | Default                                                          | Purpose                                              |
|--------------|------------------------------------------------------------------|------------------------------------------------------|
| `HOST_PIN`   | `1234`                                                           | PIN that unlocks the host controls. **Change it.** Compose requires it in `.env`. |
| `CATEGORIES` | `Composition,Musicianship,Originality,Vocals,Lyrical depth,Vibe` | Comma-separated list of scoring categories           |
| `DB_PATH`    | `data/game.db` (`/data/game.db` in Docker)                       | Location of the SQLite database                      |

Changing `CATEGORIES` and restarting keeps existing scores for categories that remain, adds new ones, and deletes only the scores of categories you removed. A backup is saved first.

## How a game night works

1. Everyone opens the app and joins with a name.
2. Players submit songs.
3. The host unlocks the host controls with the PIN and picks the first song.
4. Everyone except the submitter scores it.
5. The host reveals the scores and picks the next song.
6. At the end, the host taps **Save tonight and start a new night**. The results move into the archive and everyone rejoins for a fresh game.

## Project structure

```
.
├── run.py                  # Entry point: creates the Flask app and registers blueprints
├── config.py               # Environment variables and constants
├── database.py             # SQLite connection, schema, WAL mode, migrations, backups,
│                           #   and shared queries (current night, current song)
├── utils/
│   └── helpers.py          # Link sanitizing, oEmbed lookups, JSON error helper
├── blueprints/
│   ├── views.py            # HTML pages: / and /leaderboard
│   ├── game.py             # Player actions: state, leaderboard data, join, submit, score, lookup
│   └── host.py             # Host actions: pick song, reveal, remove, new night, reset
├── static/
│   ├── index.html          # Game page
│   ├── leaderboard.html    # Leaderboard page
│   ├── icon.png            # App icon
│   ├── css/                # One stylesheet per page, plus shared awards.css
│   └── js/                 # One script per page, plus shared awards.js (award calculations)
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example            # Template for HOST_PIN and other settings
├── .gitignore
├── .dockerignore
└── LICENSE                 # GNU AGPL v3 (official text)
```

## API

All responses are JSON. Errors return `{"error": "..."}` with a 4xx status.

| Method | Path                   | Purpose                                                     |
|--------|------------------------|-------------------------------------------------------------|
| GET    | `/api/state`           | Players, categories, songs, current song and the last saved night (`?player_id=`) |
| GET    | `/api/leaderboard`     | Revealed songs and nights (`?night=<id>` or `?night=all`)    |
| POST   | `/api/join`            | Join tonight's game with a name                             |
| POST   | `/api/songs`           | Submit a song                                               |
| POST   | `/api/score`           | Save or update your scores for a song                       |
| GET    | `/api/lookup`          | Validate a link and fetch title and artist (`?url=`)        |
| POST   | `/api/host/<action>`   | Host actions. Body includes `pin`                           |

Host actions: `check`, `current`, `reveal`, `remove`, `remove_player`, `newnight`, `reset`.

## Data and backups

- The database is a single SQLite file in WAL mode, so you will also see `game.db-wal` and `game.db-shm` next to it.
- A timestamped copy is saved to `data/backups/` before **Delete everything**, before removing categories, and before a database upgrade.
- To keep a copy yourself, copy `game.db` while the app is stopped.

## Troubleshooting

- **A guest's phone can't reach the page** (`ERR_TOO_MANY_RETRIES`, "site can't be reached"). On newer Android versions, allow **Nearby devices** for their browser under Settings, Apps, the browser, Permissions. Also check that they are on the same Wi-Fi (not a guest network) and that Android isn't switching them to mobile data.
- **Can't unlock host controls.** The PIN is whatever `HOST_PIN` was when the container was created. Check it with `docker exec <container> printenv HOST_PIN`.
- **The voted counter never completes.** It counts everyone who joined, including stale names. Remove them from the Players list in the host controls.
- **Title auto-fill is empty.** The server needs internet access to look up links. Spotify only returns the track name, so type the artist by hand.
- **Docker says `compose` isn't a command.** Install the Compose plugin (for example `docker-compose-plugin` on Debian or Ubuntu).

## Limitations

- One game at a time. There are no rooms yet.
- The host PIN is a shared secret sent over plain HTTP, which is fine on a home network. Don't expose the app directly to the internet.
- Links are limited to Spotify tracks and YouTube videos. A Spotify link and a YouTube link for the same song are not matched to each other.

## License

Copyright (C) 2026 Hippyjake

This project is free software, licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You can use, study, modify, and share it. If you modify it and let other people use it over a network, the AGPL requires you to offer those users the source code of your modified version.

Source code: <https://github.com/Hippyjake/Musical-Hurt-Feelings>
