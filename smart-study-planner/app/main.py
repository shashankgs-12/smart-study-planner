import json
import math
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from flask import Blueprint, Response, g, jsonify, redirect, render_template, request, url_for

from .auth import login_required
from .db import execute, execute_many, query_all, query_one

bp = Blueprint("main", __name__)

DEFAULT_SUBJECTS = [
    ("Mathematics", ["#4C8DFF", "#6FE7FF", "#B1C7FF"]),
    ("Physics", ["#FF8D6C", "#FFB36B", "#FFD7A1"]),
    ("Chemistry", ["#61D6A3", "#A6FFD7", "#C6FFF0"]),
    ("Literature", ["#9E7BFF", "#E7D6FF", "#FFB6D9"]),
]

QUOTES = [
    {"text": "Small focused sessions compound into extraordinary mastery.", "author": "Study Planner"},
    {"text": "The best productivity system is the one you trust enough to use daily.", "author": "Momentum"},
    {"text": "Clarity beats intensity. Plan the next right hour.", "author": "Deep Work Notes"},
    {"text": "Consistency turns ambition into visible progress.", "author": "Learning Loop"},
]


def _now():
    return datetime.now()


def _now_iso():
    return _now().replace(microsecond=0).isoformat()


def _today():
    return date.today().isoformat()


def _today_start():
    return datetime.combine(date.today(), time.min)


def _parse_dt(value):
    if not value:
        return None
    return datetime.fromisoformat(value)


def _json_loads(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _settings_defaults():
    return {
        "mode": "light",
        "primary_color": "#6A8CFF",
        "accent_color_1": "#7FE7FF",
        "accent_color_2": "#FFC4A8",
        "accent_color_3": "#A4FFD4",
        "background_style": "aurora",
        "card_style": "liquid",
        "focus_minutes": 50,
        "break_minutes": 10,
        "notifications_enabled": 1,
        "reminder_minutes": 15,
        "alarm_sound": "glass",
    }


def _ensure_settings(user_id):
    settings = query_one("SELECT * FROM settings WHERE user_id = ?", (user_id,))
    if settings:
        return settings

    defaults = _settings_defaults()
    execute(
        """
        INSERT INTO settings (
            user_id, mode, primary_color, accent_color_1, accent_color_2, accent_color_3,
            background_style, card_style, focus_minutes, break_minutes,
            notifications_enabled, reminder_minutes, alarm_sound, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            defaults["mode"],
            defaults["primary_color"],
            defaults["accent_color_1"],
            defaults["accent_color_2"],
            defaults["accent_color_3"],
            defaults["background_style"],
            defaults["card_style"],
            defaults["focus_minutes"],
            defaults["break_minutes"],
            defaults["notifications_enabled"],
            defaults["reminder_minutes"],
            defaults["alarm_sound"],
            _now_iso(),
            _now_iso(),
        ),
    )
    return query_one("SELECT * FROM settings WHERE user_id = ?", (user_id,))


def _ensure_default_subjects(user_id):
    existing = query_one("SELECT id FROM subjects WHERE user_id = ? LIMIT 1", (user_id,))
    if existing:
        return
    execute_many(
        """
        INSERT INTO subjects (user_id, name, color_palette, created_at)
        VALUES (?, ?, ?, ?)
        """,
        [(user_id, name, json.dumps(colors), _now_iso()) for name, colors in DEFAULT_SUBJECTS],
    )


def _serialize_subject(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "colors": _json_loads(row["color_palette"], []),
        "created_at": row["created_at"],
    }


def _task_elapsed(task):
    total = int(task["total_elapsed_seconds"] or 0)
    started_at = _parse_dt(task["current_session_started_at"])
    if started_at:
        total += max(0, int((_now() - started_at).total_seconds()))
    return total


def _task_daily_elapsed(task):
    today_seconds = int(task["daily_logged_seconds"] or 0)
    started_at = _parse_dt(task["current_session_started_at"])
    if started_at:
        today_seconds += max(0, int((_now() - max(started_at, _today_start())).total_seconds()))
    return today_seconds


def _reset_task_day_if_needed(task):
    if task["daily_log_date"] == _today() or task["current_session_started_at"]:
        return task
    execute(
        """
        UPDATE tasks
        SET daily_logged_seconds = 0, daily_log_date = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (_today(), _now_iso(), task["id"], g.user["id"]),
    )
    updated = dict(task)
    updated["daily_logged_seconds"] = 0
    updated["daily_log_date"] = _today()
    return updated


def _serialize_task(row):
    row = _reset_task_day_if_needed(row)
    due_at = _parse_dt(row["due_at"])
    live_total = int(row["total_elapsed_seconds"] or 0)
    live_daily = int(row["daily_logged_seconds"] or 0)
    target_seconds = max(1, int(row["study_minutes_per_day"] or 0) * 60)
    estimated_seconds = max(target_seconds, int(row["estimated_minutes"] or row["study_minutes_per_day"] or 0) * 60)
    remaining_seconds = max(0, estimated_seconds - live_total)
    due_seconds = int((due_at - _now()).total_seconds()) if due_at else None
    status = row["status"]
    if status != "completed" and due_seconds is not None and due_seconds < 0:
        status = "overdue"
    subject = {
        "id": row["subject_id"],
        "name": row["subject_name"],
        "colors": _json_loads(row["subject_colors"], []),
    } if row["subject_id"] else None
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"] or "",
        "due_at": row["due_at"],
        "study_minutes_per_day": row["study_minutes_per_day"],
        "estimated_minutes": row["estimated_minutes"],
        "daily_seconds": live_daily,
        "total_elapsed_seconds": live_total,
        "remaining_seconds": remaining_seconds,
        "time_until_due_seconds": due_seconds,
        "progress_percent": min(100, round((live_daily / target_seconds) * 100, 1)),
        "overall_progress_percent": min(100, round((live_total / max(estimated_seconds, 1)) * 100, 1)),
        "status": status,
        "is_active": bool(row["current_session_started_at"]),
        "current_session_started_at": row["current_session_started_at"],
        "completed_at": row["completed_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "subject": subject,
    }


def _serialize_plan(row):
    return {
        "id": row["id"],
        "day_of_week": row["day_of_week"],
        "item_type": row["item_type"],
        "title": row["title"],
        "details": row["details"] or "",
        "scheduled_time": row["scheduled_time"] or "",
        "color": row["color"] or "#7FE7FF",
        "order_index": row["order_index"],
    }


def _serialize_note(row):
    return {
        "id": row["id"],
        "subject_id": row["subject_id"],
        "title": row["title"],
        "content": row["content"] or "",
        "todo_items": _json_loads(row["todo_items"], []),
        "tags": _json_loads(row["tags"], []),
        "is_pinned": bool(row["is_pinned"]),
        "is_favorite": bool(row["is_favorite"]),
        "is_general": bool(row["is_general"]),
        "last_opened_at": row["last_opened_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _serialize_alarm(row):
    return {
        "id": row["id"],
        "label": row["label"],
        "alarm_time": row["alarm_time"],
        "repeat_days": _json_loads(row["repeat_days"], []),
        "sound": row["sound"],
        "is_enabled": bool(row["is_enabled"]),
    }


def _serialize_settings(row):
    return {
        "mode": row["mode"],
        "primary_color": row["primary_color"],
        "accent_color_1": row["accent_color_1"],
        "accent_color_2": row["accent_color_2"],
        "accent_color_3": row["accent_color_3"],
        "background_style": row["background_style"],
        "card_style": row["card_style"],
        "focus_minutes": row["focus_minutes"],
        "break_minutes": row["break_minutes"],
        "notifications_enabled": bool(row["notifications_enabled"]),
        "reminder_minutes": row["reminder_minutes"],
        "alarm_sound": row["alarm_sound"],
    }


def _recent_history(user_id):
    history = []
    sessions = query_all(
        """
        SELECT task_sessions.duration_seconds, task_sessions.ended_at, tasks.title
        FROM task_sessions
        JOIN tasks ON tasks.id = task_sessions.task_id
        WHERE task_sessions.user_id = ? AND task_sessions.ended_at IS NOT NULL
        ORDER BY task_sessions.ended_at DESC
        LIMIT 6
        """,
        (user_id,),
    )
    history.extend(
        {
            "type": "session",
            "title": row["title"],
            "detail": f"{math.ceil((row['duration_seconds'] or 0) / 60)} min study block finished",
            "timestamp": row["ended_at"],
        }
        for row in sessions
    )
    note_updates = query_all(
        """
        SELECT title, updated_at
        FROM notes
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT 4
        """,
        (user_id,),
    )
    history.extend(
        {
            "type": "note",
            "title": row["title"] or "Untitled note",
            "detail": "Note updated",
            "timestamp": row["updated_at"],
        }
        for row in note_updates
    )
    history.sort(key=lambda item: item["timestamp"] or "", reverse=True)
    return history[:8]


def _calculate_streak(user_id):
    rows = query_all(
        """
        SELECT summary_date, total_study_seconds
        FROM analytics_summary
        WHERE user_id = ? AND total_study_seconds > 0
        ORDER BY summary_date DESC
        """,
        (user_id,),
    )
    streak = 0
    cursor = date.today()
    dates = {row["summary_date"] for row in rows}
    while cursor.isoformat() in dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _sync_analytics_summary(user_id):
    today = _today()
    totals = query_one(
        """
        SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds
        FROM task_sessions
        WHERE user_id = ? AND date(COALESCE(ended_at, started_at)) = ?
        """,
        (user_id, today),
    )
    completed_tasks = query_one(
        "SELECT COUNT(*) AS value FROM tasks WHERE user_id = ? AND status = 'completed' AND date(completed_at) = ?",
        (user_id, today),
    )["value"]
    missed_tasks = query_one(
        """
        SELECT COUNT(*) AS value
        FROM tasks
        WHERE user_id = ? AND status != 'completed' AND due_at IS NOT NULL AND datetime(due_at) < datetime('now')
        """,
        (user_id,),
    )["value"]
    subject_rows = query_all(
        """
        SELECT subjects.name, COALESCE(SUM(task_sessions.duration_seconds), 0) AS total_seconds
        FROM subjects
        LEFT JOIN tasks ON tasks.subject_id = subjects.id
        LEFT JOIN task_sessions ON task_sessions.task_id = tasks.id
            AND date(COALESCE(task_sessions.ended_at, task_sessions.started_at)) = ?
        WHERE subjects.user_id = ?
        GROUP BY subjects.id
        ORDER BY total_seconds DESC
        """,
        (today, user_id),
    )
    subject_breakdown = [{"label": row["name"], "value": row["total_seconds"]} for row in subject_rows]
    trend_rows = query_all(
        """
        SELECT date(COALESCE(ended_at, started_at)) AS log_date, COALESCE(SUM(duration_seconds), 0) AS total_seconds
        FROM task_sessions
        WHERE user_id = ? AND date(COALESCE(ended_at, started_at)) >= date('now', '-6 day')
        GROUP BY log_date
        ORDER BY log_date
        """,
        (user_id,),
    )
    trend_map = {row["log_date"]: row["total_seconds"] for row in trend_rows}
    daily_productivity = []
    for offset in range(6, -1, -1):
        day = (date.today() - timedelta(days=offset)).isoformat()
        daily_productivity.append({"label": day[-5:], "value": trend_map.get(day, 0)})

    execute(
        """
        INSERT INTO analytics_summary (
            user_id, summary_date, total_study_seconds, completed_tasks, missed_tasks,
            streak_days, subject_breakdown, daily_productivity, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, summary_date)
        DO UPDATE SET
            total_study_seconds = excluded.total_study_seconds,
            completed_tasks = excluded.completed_tasks,
            missed_tasks = excluded.missed_tasks,
            streak_days = excluded.streak_days,
            subject_breakdown = excluded.subject_breakdown,
            daily_productivity = excluded.daily_productivity,
            updated_at = excluded.updated_at
        """,
        (
            user_id,
            today,
            totals["total_seconds"],
            completed_tasks,
            missed_tasks,
            _calculate_streak(user_id),
            json.dumps(subject_breakdown),
            json.dumps(daily_productivity),
            _now_iso(),
            _now_iso(),
        ),
    )


def _analytics_payload(user_id, range_key):
    _sync_analytics_summary(user_id)
    period_days = {"today": 1, "week": 7, "month": 30, "year": 365}.get(range_key, 7)
    start_date = (date.today() - timedelta(days=period_days - 1)).isoformat()
    total_study_time = query_one(
        """
        SELECT COALESCE(SUM(duration_seconds), 0) AS value
        FROM task_sessions
        WHERE user_id = ? AND date(COALESCE(ended_at, started_at)) >= ?
        """,
        (user_id, start_date),
    )["value"]
    completed_tasks = query_one(
        """
        SELECT COUNT(*) AS value
        FROM tasks
        WHERE user_id = ? AND status = 'completed' AND date(COALESCE(completed_at, updated_at)) >= ?
        """,
        (user_id, start_date),
    )["value"]
    missed_tasks = query_one(
        """
        SELECT COUNT(*) AS value
        FROM tasks
        WHERE user_id = ? AND status != 'completed' AND due_at IS NOT NULL
            AND date(due_at) >= ? AND datetime(due_at) < datetime('now')
        """,
        (user_id, start_date),
    )["value"]
    subject_distribution = query_all(
        """
        SELECT
            COALESCE(subjects.name, 'General') AS label,
            COALESCE(SUM(task_sessions.duration_seconds), 0) AS value
        FROM tasks
        LEFT JOIN subjects ON subjects.id = tasks.subject_id
        LEFT JOIN task_sessions ON task_sessions.task_id = tasks.id
        WHERE tasks.user_id = ? AND date(COALESCE(task_sessions.ended_at, task_sessions.started_at)) >= ?
        GROUP BY COALESCE(subjects.name, 'General')
        ORDER BY value DESC
        """,
        (user_id, start_date),
    )
    trend_map = defaultdict(int)
    trend_rows = query_all(
        """
        SELECT date(COALESCE(ended_at, started_at)) AS log_date, COALESCE(SUM(duration_seconds), 0) AS total_seconds
        FROM task_sessions
        WHERE user_id = ? AND date(COALESCE(ended_at, started_at)) >= ?
        GROUP BY log_date
        ORDER BY log_date
        """,
        (user_id, start_date),
    )
    for row in trend_rows:
        trend_map[row["log_date"]] = row["total_seconds"]
    trend = []
    for offset in range(period_days - 1, -1, -1):
        day = (date.today() - timedelta(days=offset)).isoformat()
        trend.append({"label": day[-5:] if period_days <= 31 else day[:7], "value": trend_map.get(day, 0)})

    return {
        "range": range_key,
        "total_study_time": total_study_time,
        "completed_tasks": completed_tasks,
        "missed_tasks": missed_tasks,
        "streak_days": _calculate_streak(user_id),
        "subject_distribution": [dict(row) for row in subject_distribution],
        "daily_productivity": trend,
    }


def _bootstrap_payload(user_id):
    _ensure_default_subjects(user_id)
    settings = _ensure_settings(user_id)
    tasks = query_all(
        """
        SELECT tasks.*, subjects.name AS subject_name, subjects.color_palette AS subject_colors
        FROM tasks
        LEFT JOIN subjects ON subjects.id = tasks.subject_id
        WHERE tasks.user_id = ?
        ORDER BY
            CASE tasks.status
                WHEN 'in_progress' THEN 0
                WHEN 'pending' THEN 1
                WHEN 'paused' THEN 2
                WHEN 'stopped' THEN 3
                WHEN 'completed' THEN 4
                ELSE 5
            END,
            tasks.due_at ASC,
            tasks.created_at DESC
        """,
        (user_id,),
    )
    notes = query_all(
        """
        SELECT notes.*, COALESCE(
            json_group_array(note_tags.tag) FILTER (WHERE note_tags.tag IS NOT NULL),
            '[]'
        ) AS tags
        FROM notes
        LEFT JOIN note_tags ON note_tags.note_id = notes.id
        WHERE notes.user_id = ?
        GROUP BY notes.id
        ORDER BY notes.is_pinned DESC, notes.updated_at DESC
        """,
        (user_id,),
    )
    plans = query_all(
        "SELECT * FROM weekly_plans WHERE user_id = ? ORDER BY day_of_week, order_index, created_at",
        (user_id,),
    )
    alarms = query_all(
        "SELECT * FROM alarms WHERE user_id = ? ORDER BY alarm_time, created_at",
        (user_id,),
    )
    subjects = query_all("SELECT * FROM subjects WHERE user_id = ? ORDER BY name", (user_id,))
    serialized_tasks = list(map(_serialize_task, tasks))
    today_tasks = [task for task in serialized_tasks if task["status"] in {"pending", "in_progress", "paused", "overdue"}]
    focus_task = next((task for task in today_tasks if task["status"] == "in_progress"), today_tasks[0] if today_tasks else None)
    daily_goal_minutes = sum(task["study_minutes_per_day"] or 0 for task in tasks)
    completed_today = sum(1 for task in today_tasks if task["progress_percent"] >= 100)

    return {
        "user": {
            "display_name": g.user["display_name"],
            "email": g.user["email"],
            "username": g.user["username"],
        },
        "subjects": [_serialize_subject(subject) for subject in subjects],
        "tasks": serialized_tasks,
        "weekly_plans": list(map(_serialize_plan, plans)),
        "notes": list(map(_serialize_note, notes)),
        "alarms": list(map(_serialize_alarm, alarms)),
        "settings": _serialize_settings(settings),
        "analytics": _analytics_payload(user_id, "week"),
        "quotes": QUOTES,
        "daily_goal": {
            "minutes": daily_goal_minutes,
            "completed": completed_today,
            "target": len(today_tasks) or 1,
        },
        "focus_task": focus_task,
        "history": _recent_history(user_id),
    }


def _task_row(task_id):
    return query_one(
        """
        SELECT tasks.*, subjects.name AS subject_name, subjects.color_palette AS subject_colors
        FROM tasks
        LEFT JOIN subjects ON subjects.id = tasks.subject_id
        WHERE tasks.id = ? AND tasks.user_id = ?
        """,
        (task_id, g.user["id"]),
    )


def _close_task_session(task, session_status):
    started_at = _parse_dt(task["current_session_started_at"])
    if not started_at:
        return 0
    now = _now()
    session_seconds = max(0, int((now - started_at).total_seconds()))
    today_seconds = max(0, int((now - max(started_at, _today_start())).total_seconds()))
    current_daily = int(task["daily_logged_seconds"] or 0) if task["daily_log_date"] == _today() else 0
    execute(
        """
        UPDATE task_sessions
        SET ended_at = ?, duration_seconds = ?, session_status = ?
        WHERE task_id = ? AND user_id = ? AND ended_at IS NULL
        """,
        (_now_iso(), session_seconds, session_status, task["id"], g.user["id"]),
    )
    execute(
        """
        UPDATE tasks
        SET total_elapsed_seconds = ?, daily_logged_seconds = ?, daily_log_date = ?,
            current_session_started_at = NULL, status = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            int(task["total_elapsed_seconds"] or 0) + session_seconds,
            current_daily + today_seconds,
            _today(),
            session_status,
            _now_iso(),
            task["id"],
            g.user["id"],
        ),
    )
    return session_seconds


def _upsert_note_tags(note_id, tags):
    execute("DELETE FROM note_tags WHERE note_id = ? AND user_id = ?", (note_id, g.user["id"]))
    cleaned = [(note_id, g.user["id"], tag.strip()) for tag in tags if tag and tag.strip()]
    if cleaned:
        execute_many("INSERT INTO note_tags (note_id, user_id, tag) VALUES (?, ?, ?)", cleaned)


@bp.get("/")
def index():
    if g.user:
        return redirect(url_for("main.dashboard"))
    return redirect(url_for("auth.login"))


@bp.get("/dashboard")
@login_required
def dashboard():
    _ensure_default_subjects(g.user["id"])
    settings = _serialize_settings(_ensure_settings(g.user["id"]))
    return render_template("dashboard.html", user=g.user, settings=settings)


@bp.get("/api/bootstrap")
@login_required
def bootstrap():
    return jsonify(_bootstrap_payload(g.user["id"]))


@bp.get("/api/analytics")
@login_required
def analytics():
    return jsonify(_analytics_payload(g.user["id"], request.args.get("range", "week")))


@bp.route("/api/subjects", methods=("GET", "POST"))
@login_required
def subjects():
    if request.method == "GET":
        rows = query_all("SELECT * FROM subjects WHERE user_id = ? ORDER BY name", (g.user["id"],))
        return jsonify([_serialize_subject(row) for row in rows])

    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "").strip()
    colors = payload.get("colors") or []
    if not name or not colors:
        return jsonify({"error": "Subject name and at least one color are required."}), 400
    if query_one("SELECT id FROM subjects WHERE user_id = ? AND name = ?", (g.user["id"], name)):
        return jsonify({"error": "A subject with that name already exists."}), 400

    cursor = execute(
        """
        INSERT INTO subjects (user_id, name, color_palette, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (g.user["id"], name, json.dumps(colors[:4]), _now_iso()),
    )
    subject = query_one("SELECT * FROM subjects WHERE id = ?", (cursor.lastrowid,))
    return jsonify(_serialize_subject(subject)), 201


@bp.route("/api/subjects/<int:subject_id>", methods=("PATCH", "DELETE"))
@login_required
def subject_detail(subject_id):
    subject = query_one("SELECT * FROM subjects WHERE id = ? AND user_id = ?", (subject_id, g.user["id"]))
    if subject is None:
        return jsonify({"error": "Subject not found."}), 404

    if request.method == "DELETE":
        # Safely detach tasks, then delete subject
        execute("UPDATE tasks SET subject_id = NULL WHERE subject_id = ? AND user_id = ?", (subject_id, g.user["id"]))
        execute("DELETE FROM subjects WHERE id = ? AND user_id = ?", (subject_id, g.user["id"]))
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    name = payload.get("name", subject["name"]).strip()
    colors = payload.get("colors", _json_loads(subject["color_palette"], []))
    existing = query_one(
        "SELECT id FROM subjects WHERE user_id = ? AND name = ? AND id != ?",
        (g.user["id"], name, subject_id),
    )
    if existing:
        return jsonify({"error": "A subject with that name already exists."}), 400
    execute(
        "UPDATE subjects SET name = ?, color_palette = ?, created_at = created_at WHERE id = ? AND user_id = ?",
        (name, json.dumps(colors[:4]), subject_id, g.user["id"]),
    )
    updated = query_one("SELECT * FROM subjects WHERE id = ?", (subject_id,))
    return jsonify(_serialize_subject(updated))


@bp.route("/api/tasks", methods=("GET", "POST"))
@login_required
def tasks():
    if request.method == "GET":
        filter_key = request.args.get("filter", "all")
        rows = query_all(
            """
            SELECT tasks.*, subjects.name AS subject_name, subjects.color_palette AS subject_colors
            FROM tasks
            LEFT JOIN subjects ON subjects.id = tasks.subject_id
            WHERE tasks.user_id = ?
            ORDER BY tasks.due_at ASC, tasks.created_at DESC
            """,
            (g.user["id"],),
        )
        items = list(map(_serialize_task, rows))
        if filter_key == "today":
            today = _today()
            items = [item for item in items if item["due_at"] and item["due_at"].startswith(today)]
        elif filter_key == "upcoming":
            items = [item for item in items if item["time_until_due_seconds"] is not None and item["time_until_due_seconds"] > 0]
        elif filter_key == "completed":
            items = [item for item in items if item["status"] == "completed"]
        elif filter_key == "overdue":
            items = [item for item in items if item["status"] == "overdue"]
        return jsonify(items)

    payload = request.get_json(silent=True) or {}
    cursor = execute(
        """
        INSERT INTO tasks (
            user_id, subject_id, title, description, due_at, study_minutes_per_day, estimated_minutes,
            daily_logged_seconds, daily_log_date, total_elapsed_seconds, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'pending', ?, ?)
        """,
        (
            g.user["id"],
            payload.get("subject_id"),
            payload.get("title", "").strip(),
            payload.get("description", "").strip(),
            payload.get("due_at"),
            int(payload.get("study_minutes_per_day", 45) or 45),
            int(payload.get("estimated_minutes", payload.get("study_minutes_per_day", 45)) or 45),
            _today(),
            _now_iso(),
            _now_iso(),
        ),
    )
    return jsonify(_serialize_task(_task_row(cursor.lastrowid))), 201


@bp.route("/api/tasks/<int:task_id>", methods=("PATCH", "DELETE"))
@login_required
def task_detail(task_id):
    task = _task_row(task_id)
    if task is None:
        return jsonify({"error": "Task not found."}), 404

    if request.method == "DELETE":
        if task["current_session_started_at"]:
            _close_task_session(task, "stopped")
        execute("DELETE FROM task_sessions WHERE task_id = ? AND user_id = ?", (task_id, g.user["id"]))
        execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, g.user["id"]))
        _sync_analytics_summary(g.user["id"])
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    execute(
        """
        UPDATE tasks
        SET title = ?, description = ?, due_at = ?, study_minutes_per_day = ?, estimated_minutes = ?,
            subject_id = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            payload.get("title", task["title"]).strip(),
            payload.get("description", task["description"] or "").strip(),
            payload.get("due_at", task["due_at"]),
            int(payload.get("study_minutes_per_day", task["study_minutes_per_day"]) or 45),
            int(payload.get("estimated_minutes", task["estimated_minutes"]) or task["study_minutes_per_day"]),
            payload.get("subject_id", task["subject_id"]),
            _now_iso(),
            task_id,
            g.user["id"],
        ),
    )
    return jsonify(_serialize_task(_task_row(task_id)))


@bp.post("/api/tasks/<int:task_id>/action")
@login_required
def task_action(task_id):
    task = _task_row(task_id)
    if task is None:
        return jsonify({"error": "Task not found."}), 404

    payload = request.get_json(silent=True) or {}
    action = payload.get("action")

    if action in {"start", "resume"}:
        if task["current_session_started_at"]:
            return jsonify({"error": "Task already running."}), 400
        current_daily = int(task["daily_logged_seconds"] or 0) if task["daily_log_date"] == _today() else 0
        execute(
            """
            UPDATE tasks
            SET current_session_started_at = ?, status = 'in_progress', daily_log_date = ?,
                daily_logged_seconds = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (_now_iso(), _today(), current_daily, _now_iso(), task_id, g.user["id"]),
        )
        execute(
            """
            INSERT INTO task_sessions (task_id, user_id, started_at, duration_seconds, session_status, created_at)
            VALUES (?, ?, ?, 0, 'active', ?)
            """,
            (task_id, g.user["id"], _now_iso(), _now_iso()),
        )
    elif action == "pause":
        _close_task_session(task, "paused")
    elif action == "stop":
        _close_task_session(task, "stopped")
    elif action == "complete":
        if task["current_session_started_at"]:
            _close_task_session(task, "completed")
        execute(
            """
            UPDATE tasks
            SET status = 'completed', completed_at = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (_now_iso(), _now_iso(), task_id, g.user["id"]),
        )
    elif action == "reset":
        if task["current_session_started_at"]:
            execute(
                """
                UPDATE task_sessions
                SET ended_at = ?, duration_seconds = 0, session_status = 'reset'
                WHERE task_id = ? AND user_id = ? AND ended_at IS NULL
                """,
                (_now_iso(), task_id, g.user["id"]),
            )
        execute(
            """
            UPDATE tasks
            SET total_elapsed_seconds = 0, daily_logged_seconds = 0, daily_log_date = ?, current_session_started_at = NULL,
                status = 'pending', completed_at = NULL, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (_today(), _now_iso(), task_id, g.user["id"]),
        )
    else:
        return jsonify({"error": "Unsupported task action."}), 400

    _sync_analytics_summary(g.user["id"])
    return jsonify(_serialize_task(_task_row(task_id)))


@bp.route("/api/weekly-plans", methods=("GET", "POST"))
@login_required
def weekly_plans():
    if request.method == "GET":
        rows = query_all(
            "SELECT * FROM weekly_plans WHERE user_id = ? ORDER BY day_of_week, order_index, created_at",
            (g.user["id"],),
        )
        return jsonify([_serialize_plan(row) for row in rows])

    payload = request.get_json(silent=True) or {}
    day = int(payload.get("day_of_week", 0))
    next_order = query_one(
        "SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order FROM weekly_plans WHERE user_id = ? AND day_of_week = ?",
        (g.user["id"], day),
    )["next_order"]
    cursor = execute(
        """
        INSERT INTO weekly_plans (user_id, day_of_week, item_type, title, details, scheduled_time, color, order_index, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            g.user["id"],
            day,
            payload.get("item_type", "study"),
            payload.get("title", "").strip(),
            payload.get("details", "").strip(),
            payload.get("scheduled_time"),
            payload.get("color", "#7FE7FF"),
            next_order,
            _now_iso(),
            _now_iso(),
        ),
    )
    row = query_one("SELECT * FROM weekly_plans WHERE id = ?", (cursor.lastrowid,))
    return jsonify(_serialize_plan(row)), 201


@bp.patch("/api/weekly-plans/reorder")
@login_required
def reorder_weekly_plans():
    payload = request.get_json(silent=True) or {}
    items = payload.get("items") or []
    for item in items:
        execute(
            """
            UPDATE weekly_plans
            SET day_of_week = ?, order_index = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (item["day_of_week"], item["order_index"], _now_iso(), item["id"], g.user["id"]),
        )
    return jsonify({"ok": True})


@bp.route("/api/weekly-plans/<int:plan_id>", methods=("PATCH", "DELETE"))
@login_required
def weekly_plan_detail(plan_id):
    row = query_one("SELECT * FROM weekly_plans WHERE id = ? AND user_id = ?", (plan_id, g.user["id"]))
    if row is None:
        return jsonify({"error": "Plan not found."}), 404

    if request.method == "DELETE":
        execute("DELETE FROM weekly_plans WHERE id = ? AND user_id = ?", (plan_id, g.user["id"]))
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    execute(
        """
        UPDATE weekly_plans
        SET item_type = ?, title = ?, details = ?, scheduled_time = ?, color = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            payload.get("item_type", row["item_type"]),
            payload.get("title", row["title"]).strip(),
            payload.get("details", row["details"] or "").strip(),
            payload.get("scheduled_time", row["scheduled_time"]),
            payload.get("color", row["color"]),
            _now_iso(),
            plan_id,
            g.user["id"],
        ),
    )
    updated = query_one("SELECT * FROM weekly_plans WHERE id = ?", (plan_id,))
    return jsonify(_serialize_plan(updated))


@bp.route("/api/notes", methods=("GET", "POST"))
@login_required
def notes():
    if request.method == "GET":
        search = request.args.get("q", "").strip().lower()
        rows = query_all(
            """
            SELECT notes.*, COALESCE(
                json_group_array(note_tags.tag) FILTER (WHERE note_tags.tag IS NOT NULL),
                '[]'
            ) AS tags
            FROM notes
            LEFT JOIN note_tags ON note_tags.note_id = notes.id
            WHERE notes.user_id = ?
            GROUP BY notes.id
            ORDER BY notes.is_pinned DESC, notes.updated_at DESC
            """,
            (g.user["id"],),
        )
        items = [_serialize_note(row) for row in rows]
        if search:
            items = [
                item
                for item in items
                if search in item["title"].lower()
                or search in item["content"].lower()
                or any(search in tag.lower() for tag in item["tags"])
            ]
        return jsonify(items)

    payload = request.get_json(silent=True) or {}
    cursor = execute(
        """
        INSERT INTO notes (
            user_id, subject_id, title, content, todo_items, is_pinned, is_favorite, is_general, last_opened_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            g.user["id"],
            payload.get("subject_id"),
            payload.get("title", "Untitled note").strip() or "Untitled note",
            payload.get("content", ""),
            json.dumps(payload.get("todo_items") or []),
            1 if payload.get("is_pinned") else 0,
            1 if payload.get("is_favorite") else 0,
            1 if payload.get("is_general", True) else 0,
            _now_iso(),
            _now_iso(),
            _now_iso(),
        ),
    )
    _upsert_note_tags(cursor.lastrowid, payload.get("tags") or [])
    row = query_one(
        """
        SELECT notes.*, COALESCE(
            json_group_array(note_tags.tag) FILTER (WHERE note_tags.tag IS NOT NULL),
            '[]'
        ) AS tags
        FROM notes
        LEFT JOIN note_tags ON note_tags.note_id = notes.id
        WHERE notes.id = ?
        GROUP BY notes.id
        """,
        (cursor.lastrowid,),
    )
    return jsonify(_serialize_note(row)), 201


@bp.route("/api/notes/<int:note_id>", methods=("PATCH", "DELETE"))
@login_required
def note_detail(note_id):
    row = query_one("SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, g.user["id"]))
    if row is None:
        return jsonify({"error": "Note not found."}), 404

    if request.method == "DELETE":
        execute("DELETE FROM note_tags WHERE note_id = ? AND user_id = ?", (note_id, g.user["id"]))
        execute("DELETE FROM notes WHERE id = ? AND user_id = ?", (note_id, g.user["id"]))
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    execute(
        """
        UPDATE notes
        SET subject_id = ?, title = ?, content = ?, todo_items = ?, is_pinned = ?, is_favorite = ?, is_general = ?,
            last_opened_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            payload.get("subject_id"),
            payload.get("title", row["title"]).strip() or "Untitled note",
            payload.get("content", row["content"] or ""),
            json.dumps(payload.get("todo_items", _json_loads(row["todo_items"], []))),
            1 if payload.get("is_pinned") else 0,
            1 if payload.get("is_favorite") else 0,
            1 if payload.get("is_general", True) else 0,
            _now_iso(),
            _now_iso(),
            note_id,
            g.user["id"],
        ),
    )
    _upsert_note_tags(note_id, payload.get("tags") or [])
    updated = query_one(
        """
        SELECT notes.*, COALESCE(
            json_group_array(note_tags.tag) FILTER (WHERE note_tags.tag IS NOT NULL),
            '[]'
        ) AS tags
        FROM notes
        LEFT JOIN note_tags ON note_tags.note_id = notes.id
        WHERE notes.id = ?
        GROUP BY notes.id
        """,
        (note_id,),
    )
    return jsonify(_serialize_note(updated))


@bp.route("/api/alarms", methods=("GET", "POST"))
@login_required
def alarms():
    if request.method == "GET":
        rows = query_all("SELECT * FROM alarms WHERE user_id = ? ORDER BY alarm_time", (g.user["id"],))
        return jsonify([_serialize_alarm(row) for row in rows])

    payload = request.get_json(silent=True) or {}
    cursor = execute(
        """
        INSERT INTO alarms (user_id, label, alarm_time, repeat_days, sound, is_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            g.user["id"],
            payload.get("label", "Study alarm").strip() or "Study alarm",
            payload.get("alarm_time"),
            json.dumps(payload.get("repeat_days") or []),
            payload.get("sound", "glass"),
            1 if payload.get("is_enabled", True) else 0,
            _now_iso(),
            _now_iso(),
        ),
    )
    row = query_one("SELECT * FROM alarms WHERE id = ?", (cursor.lastrowid,))
    return jsonify(_serialize_alarm(row)), 201


@bp.route("/api/alarms/<int:alarm_id>", methods=("PATCH", "DELETE"))
@login_required
def alarm_detail(alarm_id):
    row = query_one("SELECT * FROM alarms WHERE id = ? AND user_id = ?", (alarm_id, g.user["id"]))
    if row is None:
        return jsonify({"error": "Alarm not found."}), 404

    if request.method == "DELETE":
        execute("DELETE FROM alarms WHERE id = ? AND user_id = ?", (alarm_id, g.user["id"]))
        return jsonify({"ok": True})

    payload = request.get_json(silent=True) or {}
    execute(
        """
        UPDATE alarms
        SET label = ?, alarm_time = ?, repeat_days = ?, sound = ?, is_enabled = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            payload.get("label", row["label"]).strip(),
            payload.get("alarm_time", row["alarm_time"]),
            json.dumps(payload.get("repeat_days", _json_loads(row["repeat_days"], []))),
            payload.get("sound", row["sound"]),
            1 if payload.get("is_enabled", bool(row["is_enabled"])) else 0,
            _now_iso(),
            alarm_id,
            g.user["id"],
        ),
    )
    updated = query_one("SELECT * FROM alarms WHERE id = ?", (alarm_id,))
    return jsonify(_serialize_alarm(updated))


@bp.route("/api/settings", methods=("GET", "PATCH"))
@login_required
def settings():
    if request.method == "GET":
        return jsonify(_serialize_settings(_ensure_settings(g.user["id"])))

    payload = request.get_json(silent=True) or {}
    current = _ensure_settings(g.user["id"])
    execute(
        """
        UPDATE settings
        SET mode = ?, primary_color = ?, accent_color_1 = ?, accent_color_2 = ?, accent_color_3 = ?,
            background_style = ?, card_style = ?, focus_minutes = ?, break_minutes = ?,
            notifications_enabled = ?, reminder_minutes = ?, alarm_sound = ?, updated_at = ?
        WHERE user_id = ?
        """,
        (
            payload.get("mode", current["mode"]),
            payload.get("primary_color", current["primary_color"]),
            payload.get("accent_color_1", current["accent_color_1"]),
            payload.get("accent_color_2", current["accent_color_2"]),
            payload.get("accent_color_3", current["accent_color_3"]),
            payload.get("background_style", current["background_style"]),
            payload.get("card_style", current["card_style"]),
            int(payload.get("focus_minutes", current["focus_minutes"])),
            int(payload.get("break_minutes", current["break_minutes"])),
            1 if payload.get("notifications_enabled", bool(current["notifications_enabled"])) else 0,
            int(payload.get("reminder_minutes", current["reminder_minutes"])),
            payload.get("alarm_sound", current["alarm_sound"]),
            _now_iso(),
            g.user["id"],
        ),
    )
    return jsonify(_serialize_settings(query_one("SELECT * FROM settings WHERE user_id = ?", (g.user["id"],))))


@bp.get("/api/export")
@login_required
def export_data():
    payload = _bootstrap_payload(g.user["id"])
    response = Response(json.dumps(payload, indent=2), mimetype="application/json")
    response.headers["Content-Disposition"] = f"attachment; filename=study-planner-{g.user['username']}.json"
    return response


@bp.post("/api/import")
@login_required
def import_data():
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"error": "Choose a JSON file to import."}), 400
    data = json.loads(upload.read().decode("utf-8"))

    if data.get("subjects"):
        for subject in data["subjects"]:
            execute(
                """
                INSERT OR IGNORE INTO subjects (user_id, name, color_palette, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    g.user["id"],
                    subject.get("name", "Imported Subject"),
                    json.dumps(subject.get("colors") or ["#7FE7FF"]),
                    _now_iso(),
                ),
            )

    if data.get("tasks"):
        subject_map = {
            row["name"]: row["id"]
            for row in query_all("SELECT id, name FROM subjects WHERE user_id = ?", (g.user["id"],))
        }
        for task in data["tasks"]:
            subject_name = (task.get("subject") or {}).get("name")
            execute(
                """
                INSERT INTO tasks (
                    user_id, subject_id, title, description, due_at, study_minutes_per_day,
                    estimated_minutes, daily_logged_seconds, daily_log_date, total_elapsed_seconds,
                    status, completed_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    g.user["id"],
                    subject_map.get(subject_name),
                    task.get("title", "Imported Task"),
                    task.get("description", ""),
                    task.get("due_at"),
                    int(task.get("study_minutes_per_day", 45)),
                    int(task.get("estimated_minutes", 45)),
                    int(task.get("daily_seconds", 0)),
                    _today(),
                    int(task.get("total_elapsed_seconds", 0)),
                    task.get("status", "pending"),
                    task.get("completed_at"),
                    _now_iso(),
                    _now_iso(),
                ),
            )

    if data.get("notes"):
        for note in data["notes"]:
            cursor = execute(
                """
                INSERT INTO notes (
                    user_id, subject_id, title, content, todo_items, is_pinned, is_favorite,
                    is_general, last_opened_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    g.user["id"],
                    None,
                    note.get("title", "Imported Note"),
                    note.get("content", ""),
                    json.dumps(note.get("todo_items") or []),
                    1 if note.get("is_pinned") else 0,
                    1 if note.get("is_favorite") else 0,
                    1 if note.get("is_general", True) else 0,
                    _now_iso(),
                    _now_iso(),
                    _now_iso(),
                ),
            )
            _upsert_note_tags(cursor.lastrowid, note.get("tags") or [])

    return jsonify(_bootstrap_payload(g.user["id"]))
