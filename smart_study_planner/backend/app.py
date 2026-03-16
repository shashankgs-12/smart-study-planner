from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass
from typing import List, Optional, Dict, Any

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from werkzeug.security import generate_password_hash, check_password_hash

from smart_study_planner.backend.models.planner_task import define_planner_task_model
from smart_study_planner.backend.routes.planner import register_planner_routes
from smart_study_planner.backend.services.analytics import compute_analytics_summary


db = SQLAlchemy()


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder="../templates",
        static_folder="../static",
    )
    app.config["SECRET_KEY"] = "change-this-secret-key"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///smart_study_planner.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    with app.app_context():
        db.create_all()
        _ensure_sqlite_schema()

    register_routes(app)
    return app


def _ensure_sqlite_schema() -> None:
    """
    Lightweight SQLite migrations (since create_all doesn't ALTER existing tables).
    Safe to run on every startup.
    """
    try:
        cols = db.session.execute(text("PRAGMA table_info(user)")).all()
        existing = {c[1] for c in cols}  # (cid, name, type, notnull, dflt_value, pk)
        if "theme_mode" not in existing:
            db.session.execute(text("ALTER TABLE user ADD COLUMN theme_mode VARCHAR(10) DEFAULT 'light'"))
            db.session.commit()
    except Exception:
        # If this fails, Flask will show the real error in logs.
        db.session.rollback()


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    accent_color = db.Column(db.String(16), default="#7c3aed")
    compact_mode = db.Column(db.Boolean, default=False)
    focus_minutes = db.Column(db.Integer, default=25)
    short_break_minutes = db.Column(db.Integer, default=5)
    long_break_minutes = db.Column(db.Integer, default=15)
    theme_mode = db.Column(db.String(10), default="light")  # light/dark

    subjects = db.relationship("Subject", backref="user", lazy=True)
    tasks = db.relationship("Task", backref="user", lazy=True)
    sessions = db.relationship("StudySession", backref="user", lazy=True)
    notes = db.relationship("Note", backref="user", lazy=True)
    alarms = db.relationship("Alarm", backref="user", lazy=True)


class Subject(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    color = db.Column(db.String(16), default="#4f46e5")

    tasks = db.relationship("Task", backref="subject", lazy=True)


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    subject_id = db.Column(db.Integer, db.ForeignKey("subject.id"))
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)
    deadline = db.Column(db.DateTime)
    priority = db.Column(db.Integer, default=2)  # 1-high, 2-medium, 3-low
    duration_minutes = db.Column(db.Integer, default=30)
    completed = db.Column(db.Boolean, default=False)
    planned_day = db.Column(db.String(10))  # e.g. "monday"

    notes = db.relationship("Note", backref="task", lazy=True)
    sessions = db.relationship("StudySession", backref="task", lazy=True)


class StudySession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    task_id = db.Column(db.Integer, db.ForeignKey("task.id"))
    start_time = db.Column(db.DateTime, default=dt.datetime.utcnow)
    end_time = db.Column(db.DateTime)


class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    task_id = db.Column(db.Integer, db.ForeignKey("task.id"))
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=dt.datetime.utcnow)


class Alarm(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    label = db.Column(db.String(255), nullable=False)
    fire_at = db.Column(db.DateTime, nullable=False)
    fired = db.Column(db.Boolean, default=False)


PlannerTask = define_planner_task_model(db)


def current_user() -> Optional[User]:
    user_id = session.get("user_id")
    if not user_id:
        return None
    return User.query.get(user_id)


def login_required():
    def decorator(fn):
        def wrapper(*args, **kwargs):
            if not current_user():
                return jsonify({"error": "Authentication required"}), 401
            return fn(*args, **kwargs)

        wrapper.__name__ = fn.__name__
        return wrapper

    return decorator


def serialize_task(task: Task) -> Dict[str, Any]:
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "deadline": task.deadline.isoformat() if task.deadline else None,
        "priority": task.priority,
        "duration_minutes": task.duration_minutes,
        "completed": task.completed,
        "subject_id": task.subject_id,
        "planned_day": task.planned_day,
    }


def serialize_subject(subject: Subject) -> Dict[str, Any]:
    return {"id": subject.id, "name": subject.name, "color": subject.color}


def serialize_session(sess: StudySession) -> Dict[str, Any]:
    duration = None
    if sess.end_time:
        duration = int((sess.end_time - sess.start_time).total_seconds() // 60)
    return {
        "id": sess.id,
        "task_id": sess.task_id,
        "start_time": sess.start_time.isoformat(),
        "end_time": sess.end_time.isoformat() if sess.end_time else None,
        "duration_minutes": duration,
    }


def stop_any_running_session(user_id: int) -> None:
    running = StudySession.query.filter_by(user_id=user_id, end_time=None).all()
    now = dt.datetime.utcnow()
    changed = False
    for sess in running:
        sess.end_time = now
        changed = True
    if changed:
        db.session.commit()


def serialize_note(note: Note) -> Dict[str, Any]:
    return {
        "id": note.id,
        "task_id": note.task_id,
        "content": note.content,
        "created_at": note.created_at.isoformat(),
    }


def serialize_alarm(alarm: Alarm) -> Dict[str, Any]:
    return {
        "id": alarm.id,
        "label": alarm.label,
        "fire_at": alarm.fire_at.isoformat(),
        "fired": alarm.fired,
    }


@dataclass
class SuggestedSlot:
    task_id: int
    day: str
    suggested_start: str
    suggested_end: str


def ai_suggest_schedule(tasks: List[Task]) -> List[SuggestedSlot]:
    """Very lightweight heuristic scheduler based on deadline, priority and duration."""

    today = dt.date.today()
    ordered = sorted(
        [t for t in tasks if not t.completed],
        key=lambda t: (
            0 if t.priority == 1 else 1 if t.priority == 2 else 2,
            t.deadline or (today + dt.timedelta(days=30)),
        ),
    )

    day_offsets = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}

    slots: List[SuggestedSlot] = []
    current_start_hour = 17  # start suggestions at 17:00
    current_day_offset = 0

    for task in ordered:
        duration = task.duration_minutes or 30
        end_hour = current_start_hour + max(duration // 60, 1)

        if end_hour > 22:
            current_day_offset += 1
            current_start_hour = 17
            end_hour = current_start_hour + max(duration // 60, 1)

        weekday_index = (today.weekday() + current_day_offset) % 7
        day_name = list(day_offsets.keys())[weekday_index]

        slots.append(
            SuggestedSlot(
                task_id=task.id,
                day=day_name,
                suggested_start=f"{current_start_hour:02d}:00",
                suggested_end=f"{end_hour:02d}:00",
            )
        )

        current_start_hour = end_hour

    return slots


def register_routes(app: Flask) -> None:
    @app.route("/")
    def index():
        if not current_user():
            return redirect(url_for("login_page"))
        return render_template("dashboard.html")

    @app.route("/login")
    def login_page():
        if current_user():
            return redirect(url_for("index"))
        return render_template("login.html")

    register_planner_routes(app, db, PlannerTask, current_user, login_required)

    # --- Auth APIs ---
    @app.post("/api/auth/register")
    def api_register():
        data = request.json or {}
        email = data.get("email", "").strip().lower()
        name = data.get("name", "").strip()
        password = data.get("password", "")

        if not email or not password or not name:
            return jsonify({"error": "Name, email and password are required"}), 400

        if User.query.filter_by(email=email).first():
            return jsonify({"error": "Email already registered"}), 400

        user = User(
            email=email,
            name=name,
            password_hash=generate_password_hash(password),
        )
        db.session.add(user)
        db.session.commit()
        session["user_id"] = user.id
        return jsonify({"message": "Registered", "user_id": user.id})

    @app.post("/api/auth/login")
    def api_login():
        data = request.json or {}
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        user = User.query.filter_by(email=email).first()
        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "Invalid credentials"}), 401

        session["user_id"] = user.id
        return jsonify({"message": "Logged in", "user_id": user.id})

    @app.post("/api/auth/logout")
    def api_logout():
        session.clear()
        return jsonify({"message": "Logged out"})

    @app.get("/api/auth/me")
    def api_me():
        user = current_user()
        if not user:
            return jsonify({"user": None})
        return jsonify(
            {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "accent_color": user.accent_color,
                "compact_mode": user.compact_mode,
                "focus_minutes": user.focus_minutes,
                "short_break_minutes": user.short_break_minutes,
                "long_break_minutes": user.long_break_minutes,
                "theme_mode": user.theme_mode,
            }
        )

    # --- Personalization ---
    @app.put("/api/settings")
    @login_required()
    def api_update_settings():
        user = current_user()
        assert user
        data = request.json or {}
        user.accent_color = data.get("accent_color", user.accent_color)
        user.compact_mode = bool(data.get("compact_mode", user.compact_mode))
        user.focus_minutes = int(data.get("focus_minutes", user.focus_minutes))
        user.short_break_minutes = int(data.get("short_break_minutes", user.short_break_minutes))
        user.long_break_minutes = int(data.get("long_break_minutes", user.long_break_minutes))
        if "theme_mode" in data:
            mode = str(data.get("theme_mode") or "").lower()
            user.theme_mode = mode if mode in {"light", "dark"} else user.theme_mode
        db.session.commit()
        return jsonify({"message": "Settings updated"})

    # --- Subject Management ---
    @app.get("/api/subjects")
    @login_required()
    def api_get_subjects():
        user = current_user()
        subjects = Subject.query.filter_by(user_id=user.id).all()  # type: ignore[arg-type]
        return jsonify([serialize_subject(s) for s in subjects])

    @app.post("/api/subjects")
    @login_required()
    def api_create_subject():
        user = current_user()
        data = request.json or {}
        name = data.get("name")
        color = data.get("color", "#4f46e5")
        if not name:
            return jsonify({"error": "Name is required"}), 400
        subj = Subject(user_id=user.id, name=name, color=color)  # type: ignore[arg-type]
        db.session.add(subj)
        db.session.commit()
        return jsonify(serialize_subject(subj)), 201

    @app.put("/api/subjects/<int:subject_id>")
    @login_required()
    def api_update_subject(subject_id: int):
        user = current_user()
        subj = Subject.query.filter_by(id=subject_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not subj:
            return jsonify({"error": "Not found"}), 404
        data = request.json or {}
        subj.name = data.get("name", subj.name)
        subj.color = data.get("color", subj.color)
        db.session.commit()
        return jsonify(serialize_subject(subj))

    @app.delete("/api/subjects/<int:subject_id>")
    @login_required()
    def api_delete_subject(subject_id: int):
        user = current_user()
        subj = Subject.query.filter_by(id=subject_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not subj:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(subj)
        db.session.commit()
        return jsonify({"message": "Deleted"})

    # --- Task Management ---
    @app.get("/api/tasks")
    @login_required()
    def api_get_tasks():
        user = current_user()
        tasks = Task.query.filter_by(user_id=user.id).all()  # type: ignore[arg-type]
        return jsonify([serialize_task(t) for t in tasks])

    @app.post("/api/tasks")
    @login_required()
    def api_create_task():
        user = current_user()
        data = request.json or {}
        title = data.get("title")
        if not title:
            return jsonify({"error": "Title is required"}), 400

        deadline = None
        if data.get("deadline"):
            try:
                deadline = dt.datetime.fromisoformat(data["deadline"])
            except Exception:
                pass

        task = Task(
            user_id=user.id,  # type: ignore[arg-type]
            subject_id=data.get("subject_id"),
            title=title,
            description=data.get("description"),
            deadline=deadline,
            priority=int(data.get("priority", 2)),
            duration_minutes=int(data.get("duration_minutes", 30)),
            planned_day=data.get("planned_day"),
        )
        db.session.add(task)
        db.session.commit()
        return jsonify(serialize_task(task)), 201

    @app.put("/api/tasks/<int:task_id>")
    @login_required()
    def api_update_task(task_id: int):
        user = current_user()
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not task:
            return jsonify({"error": "Not found"}), 404

        data = request.json or {}

        if "title" in data:
            task.title = data["title"]
        if "description" in data:
            task.description = data["description"]
        if "priority" in data:
            task.priority = int(data["priority"])
        if "duration_minutes" in data:
            task.duration_minutes = int(data["duration_minutes"])
        if "completed" in data:
            task.completed = bool(data["completed"])
        if "subject_id" in data:
            task.subject_id = data["subject_id"]
        if "planned_day" in data:
            task.planned_day = data["planned_day"]
        if "deadline" in data:
            task.deadline = None
            if data["deadline"]:
                try:
                    task.deadline = dt.datetime.fromisoformat(data["deadline"])
                except Exception:
                    pass

        db.session.commit()
        return jsonify(serialize_task(task))

    @app.delete("/api/tasks/<int:task_id>")
    @login_required()
    def api_delete_task(task_id: int):
        user = current_user()
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not task:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(task)
        db.session.commit()
        return jsonify({"message": "Deleted"})

    # --- Task Study Session Start/Stop ---
    @app.post("/api/tasks/start/<int:task_id>")
    @login_required()
    def api_task_start(task_id: int):
        user = current_user()
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not task:
            return jsonify({"error": "Not found"}), 404

        # Only one running session per user.
        stop_any_running_session(user.id)

        sess = StudySession(user_id=user.id, task_id=task.id)  # type: ignore[arg-type]
        db.session.add(sess)
        db.session.commit()
        return jsonify({"session": serialize_session(sess)})

    @app.post("/api/tasks/stop/<int:task_id>")
    @login_required()
    def api_task_stop(task_id: int):
        user = current_user()
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not task:
            return jsonify({"error": "Not found"}), 404

        sess = (
            StudySession.query.filter_by(user_id=user.id, task_id=task.id, end_time=None)  # type: ignore[arg-type]
            .order_by(StudySession.start_time.desc())
            .first()
        )
        if not sess:
            return jsonify({"error": "No running session for this task"}), 400

        sess.end_time = dt.datetime.utcnow()
        db.session.commit()
        return jsonify({"session": serialize_session(sess)})

    # --- Weekly Planner drag & drop ---
    @app.post("/api/tasks/<int:task_id>/plan")
    @login_required()
    def api_plan_task(task_id: int):
        user = current_user()
        task = Task.query.filter_by(id=task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not task:
            return jsonify({"error": "Not found"}), 404
        data = request.json or {}
        task.planned_day = data.get("planned_day")
        db.session.commit()
        return jsonify(serialize_task(task))

    # --- Study Sessions ---
    @app.post("/api/sessions/start")
    @login_required()
    def api_start_session():
        user = current_user()
        data = request.json or {}
        task_id = data.get("task_id")
        sess = StudySession(user_id=user.id, task_id=task_id)  # type: ignore[arg-type]
        db.session.add(sess)
        db.session.commit()
        return jsonify(serialize_session(sess)), 201

    @app.post("/api/sessions/<int:session_id>/end")
    @login_required()
    def api_end_session(session_id: int):
        user = current_user()
        sess = StudySession.query.filter_by(id=session_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not sess:
            return jsonify({"error": "Not found"}), 404
        if not sess.end_time:
            sess.end_time = dt.datetime.utcnow()
            db.session.commit()
        return jsonify(serialize_session(sess))

    @app.get("/api/sessions")
    @login_required()
    def api_get_sessions():
        user = current_user()
        sessions = StudySession.query.filter_by(user_id=user.id).all()  # type: ignore[arg-type]
        return jsonify([serialize_session(s) for s in sessions])

    # --- Notes ---
    @app.get("/api/notes")
    @login_required()
    def api_get_notes():
        user = current_user()
        notes = Note.query.filter_by(user_id=user.id).all()  # type: ignore[arg-type]
        return jsonify([serialize_note(n) for n in notes])

    @app.post("/api/notes")
    @login_required()
    def api_create_note():
        user = current_user()
        data = request.json or {}
        content = data.get("content")
        if not content:
            return jsonify({"error": "Content is required"}), 400
        note = Note(
            user_id=user.id,  # type: ignore[arg-type]
            task_id=data.get("task_id"),
            content=content,
        )
        db.session.add(note)
        db.session.commit()
        return jsonify(serialize_note(note)), 201

    @app.delete("/api/notes/<int:note_id>")
    @login_required()
    def api_delete_note(note_id: int):
        user = current_user()
        note = Note.query.filter_by(id=note_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not note:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(note)
        db.session.commit()
        return jsonify({"message": "Deleted"})

    # --- Alarms / Notifications ---
    @app.get("/api/alarms")
    @login_required()
    def api_get_alarms():
        user = current_user()
        alarms = Alarm.query.filter_by(user_id=user.id).all()  # type: ignore[arg-type]
        return jsonify([serialize_alarm(a) for a in alarms])

    @app.post("/api/alarms")
    @login_required()
    def api_create_alarm():
        user = current_user()
        data = request.json or {}
        label = data.get("label")
        time_str = data.get("time")
        if not label or not time_str:
            return jsonify({"error": "Label and time are required"}), 400
        try:
            parts = time_str.split(":")
            hour = int(parts[0])
            minute = int(parts[1]) if len(parts) > 1 else 0
            now = dt.datetime.now()
            fire_at = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if fire_at <= now:
                fire_at = fire_at + dt.timedelta(days=1)
        except Exception:
            return jsonify({"error": "Invalid time format"}), 400
        alarm = Alarm(user_id=user.id, label=label, fire_at=fire_at)  # type: ignore[arg-type]
        db.session.add(alarm)
        db.session.commit()
        return jsonify(serialize_alarm(alarm)), 201

    @app.delete("/api/alarms/<int:alarm_id>")
    @login_required()
    def api_delete_alarm(alarm_id: int):
        user = current_user()
        alarm = Alarm.query.filter_by(id=alarm_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not alarm:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(alarm)
        db.session.commit()
        return jsonify({"message": "Deleted"})

    # --- Analytics ---
    @app.get("/api/analytics/summary")
    @login_required()
    def api_analytics_summary():
        user = current_user()
        today = dt.date.today()
        week_ago = today - dt.timedelta(days=6)
        summary = compute_analytics_summary(user.id, StudySession, Task, PlannerTask, week_ago)
        return jsonify(summary)

    # --- AI Scheduler ---
    @app.post("/api/scheduler/suggest")
    @login_required()
    def api_scheduler_suggest():
        user = current_user()
        tasks = Task.query.filter_by(user_id=user.id).all()  # type: ignore[arg-type]
        slots = ai_suggest_schedule(tasks)
        return jsonify([asdict(s) for s in slots])


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)

