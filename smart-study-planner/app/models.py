from datetime import datetime, date

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def utcnow():
    return datetime.utcnow()


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    display_name = db.Column(db.String(120), nullable=False)
    username = db.Column(db.String(120), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    subjects = db.relationship("Subject", backref="user", cascade="all, delete-orphan")
    tasks = db.relationship("Task", backref="user", cascade="all, delete-orphan")
    task_sessions = db.relationship("TaskSession", backref="user", cascade="all, delete-orphan")
    weekly_plans = db.relationship("WeeklyPlan", backref="user", cascade="all, delete-orphan")
    notes = db.relationship("Note", backref="user", cascade="all, delete-orphan")
    alarms = db.relationship("Alarm", backref="user", cascade="all, delete-orphan")
    settings = db.relationship("Setting", backref="user", uselist=False, cascade="all, delete-orphan")
    analytics = db.relationship("AnalyticsSummary", backref="user", cascade="all, delete-orphan")


class Subject(db.Model):
    __tablename__ = "subjects"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    color_palette = db.Column(db.String, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    tasks = db.relationship("Task", backref="subject", cascade="all")

    __table_args__ = (db.UniqueConstraint("user_id", "name", name="uq_subject_user_name"),)


class Task(db.Model):
    __tablename__ = "tasks"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    subject_id = db.Column(db.Integer, db.ForeignKey("subjects.id"))
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)
    due_at = db.Column(db.DateTime)
    study_minutes_per_day = db.Column(db.Integer, default=45, nullable=False)
    estimated_minutes = db.Column(db.Integer, default=45, nullable=False)
    daily_logged_seconds = db.Column(db.Integer, default=0, nullable=False)
    daily_log_date = db.Column(db.Date, default=date.today)
    total_elapsed_seconds = db.Column(db.Integer, default=0, nullable=False)
    current_session_started_at = db.Column(db.DateTime)
    status = db.Column(db.String(32), default="pending", nullable=False)
    completed_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    sessions = db.relationship("TaskSession", backref="task", cascade="all, delete-orphan")


class TaskSession(db.Model):
    __tablename__ = "task_sessions"
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    started_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    ended_at = db.Column(db.DateTime)
    duration_seconds = db.Column(db.Integer, default=0, nullable=False)
    session_status = db.Column(db.String(32), default="active", nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class WeeklyPlan(db.Model):
    __tablename__ = "weekly_plans"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    day_of_week = db.Column(db.Integer, nullable=False)
    item_type = db.Column(db.String(32), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    details = db.Column(db.Text)
    scheduled_time = db.Column(db.String(16))
    color = db.Column(db.String(16))
    order_index = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class Note(db.Model):
    __tablename__ = "notes"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    subject_id = db.Column(db.Integer, db.ForeignKey("subjects.id"))
    title = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text)
    todo_items = db.Column(db.String)
    is_pinned = db.Column(db.Boolean, default=False, nullable=False)
    is_favorite = db.Column(db.Boolean, default=False, nullable=False)
    is_general = db.Column(db.Boolean, default=True, nullable=False)
    last_opened_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    tags = db.relationship("NoteTag", backref="note", cascade="all, delete-orphan")


class NoteTag(db.Model):
    __tablename__ = "note_tags"
    id = db.Column(db.Integer, primary_key=True)
    note_id = db.Column(db.Integer, db.ForeignKey("notes.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    tag = db.Column(db.String(64), nullable=False)


class Alarm(db.Model):
    __tablename__ = "alarms"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    label = db.Column(db.String(120), nullable=False)
    alarm_time = db.Column(db.String(8), nullable=False)
    repeat_days = db.Column(db.String)
    sound = db.Column(db.String(64), default="glass", nullable=False)
    is_enabled = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class Setting(db.Model):
    __tablename__ = "settings"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True, nullable=False)
    mode = db.Column(db.String(16), default="light", nullable=False)
    primary_color = db.Column(db.String(16), default="#6A8CFF", nullable=False)
    accent_color_1 = db.Column(db.String(16), default="#7FE7FF", nullable=False)
    accent_color_2 = db.Column(db.String(16), default="#FFC4A8", nullable=False)
    accent_color_3 = db.Column(db.String(16), default="#A4FFD4", nullable=False)
    background_style = db.Column(db.String(32), default="aurora", nullable=False)
    card_style = db.Column(db.String(32), default="liquid", nullable=False)
    focus_minutes = db.Column(db.Integer, default=50, nullable=False)
    break_minutes = db.Column(db.Integer, default=10, nullable=False)
    notifications_enabled = db.Column(db.Boolean, default=True, nullable=False)
    reminder_minutes = db.Column(db.Integer, default=15, nullable=False)
    alarm_sound = db.Column(db.String(32), default="glass", nullable=False)
    timer_default_minutes = db.Column(db.Integer, default=50, nullable=False)
    timer_auto_start = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class AnalyticsSummary(db.Model):
    __tablename__ = "analytics_summary"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    summary_date = db.Column(db.Date, nullable=False)
    total_study_seconds = db.Column(db.Integer, default=0, nullable=False)
    completed_tasks = db.Column(db.Integer, default=0, nullable=False)
    missed_tasks = db.Column(db.Integer, default=0, nullable=False)
    streak_days = db.Column(db.Integer, default=0, nullable=False)
    subject_breakdown = db.Column(db.String)
    daily_productivity = db.Column(db.String)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (db.UniqueConstraint("user_id", "summary_date", name="uq_analytics_user_date"),)
