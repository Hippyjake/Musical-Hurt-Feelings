from flask import Blueprint, send_from_directory

bp = Blueprint("views", __name__)


@bp.get("/")
def index():
    return send_from_directory("static", "index.html")


@bp.get("/leaderboard")
def leaderboard():
    return send_from_directory("static", "leaderboard.html")
