from functools import wraps

from flask import Blueprint, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from .models import User, db

bp = Blueprint("auth", __name__)


@bp.before_app_request
def load_logged_in_user():
    user_id = session.get("user_id")
    user = User.query.get(user_id) if user_id else None
    if user:
        g.user = {
            "id": user.id,
            "display_name": user.display_name,
            "username": user.username,
            "email": user.email,
        }
    else:
        g.user = None


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("auth.login"))
        return view(**kwargs)

    return wrapped_view


@bp.route("/register", methods=("GET", "POST"))
def register():
    if g.user:
        return redirect(url_for("main.dashboard"))

    if request.method == "POST":
        display_name = request.form.get("display_name", "").strip()
        username = request.form.get("username", "").strip().lower()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        error = None
        if not display_name:
            error = "Add a display name to personalize your planner."
        elif not username:
            error = "Choose a username."
        elif not email:
            error = "Add your email address."
        elif not password or len(password) < 8:
            error = "Use at least 8 characters for your password."
        elif User.query.filter_by(email=email).first():
            error = "That email is already registered."
        elif User.query.filter_by(username=username).first():
            error = "That username is already taken."

        if error is None:
            user = User(display_name=display_name, username=username, email=email, password_hash=generate_password_hash(password))
            db.session.add(user)
            db.session.commit()
            flash("Account created. You can log in now.", "success")
            return redirect(url_for("auth.login"))

        flash(error, "error")

    return render_template("auth.html", mode="register")


@bp.route("/login", methods=("GET", "POST"))
def login():
    if g.user:
        return redirect(url_for("main.dashboard"))

    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = User.query.filter_by(email=email).first()

        if user is None or not check_password_hash(user.password_hash, password):
            flash("Invalid email or password.", "error")
        else:
            session.clear()
            session["user_id"] = user.id
            flash("Welcome back. Your study space is ready.", "success")
            return redirect(url_for("main.dashboard"))

    return render_template("auth.html", mode="login")


@bp.get("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("auth.login"))
