from flask import Flask

from blueprints.game import bp as game_bp
from blueprints.host import bp as host_bp
from blueprints.views import bp as views_bp
from config import PIN
from database import close_db, init_db

app = Flask(__name__, static_folder="static")
app.register_blueprint(views_bp)
app.register_blueprint(game_bp)
app.register_blueprint(host_bp)
app.teardown_appcontext(close_db)

init_db()

if PIN == "1234":
    print("WARNING: HOST_PIN is the default (1234). Set your own before sharing the game.", flush=True)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
