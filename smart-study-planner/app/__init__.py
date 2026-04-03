import os

from flask import Flask
from flask_sqlalchemy import SQLAlchemy

from . import auth, main, db as legacy_db
from .models import db


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=False)
    db_path = os.path.join(app.root_path, "smart_study_planner.db")
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "smart-study-planner-dev-key"),
        DATABASE=db_path,
        SQLALCHEMY_DATABASE_URI=os.environ.get("DATABASE_URL", f"sqlite:///{db_path}"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )

    if test_config is not None:
        app.config.update(test_config)

    db.init_app(app)
    legacy_db.init_app(app)
    app.register_blueprint(auth.bp)
    app.register_blueprint(main.bp)

    with app.app_context():
        db.create_all()

    return app
