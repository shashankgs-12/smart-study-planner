from __future__ import annotations

import datetime as dt

from flask import jsonify, request


def serialize_planner_task(pt):
    return {
        "id": pt.id,
        "task_text": pt.task_text,
        "day_of_week": pt.day_of_week,
        "status": pt.status,
        "start_time": pt.start_time.isoformat() if pt.start_time else None,
        "end_time": pt.end_time.isoformat() if pt.end_time else None,
        "duration_minutes": pt.duration_minutes,
        "created_at": pt.created_at.isoformat() if pt.created_at else None,
    }


def register_planner_routes(app, db, PlannerTask, current_user, login_required):
    @app.get("/api/planner/tasks")
    @login_required()
    def api_planner_get_tasks():
        user = current_user()
        tasks = PlannerTask.query.filter_by(user_id=user.id).order_by(PlannerTask.created_at.desc()).all()  # type: ignore[arg-type]
        return jsonify([serialize_planner_task(t) for t in tasks])

    @app.post("/api/planner/task")
    @login_required()
    def api_planner_create_task():
        user = current_user()
        data = request.json or {}
        task_text = (data.get("task_text") or "").strip()
        day = (data.get("day") or "").strip().lower()
        duration = int(data.get("duration_minutes") or 30)

        if not task_text:
            return jsonify({"error": "task_text is required"}), 400
        if day not in {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}:
            return jsonify({"error": "Invalid day"}), 400

        pt = PlannerTask(
            user_id=user.id,  # type: ignore[arg-type]
            task_text=task_text,
            day_of_week=day,
            duration_minutes=max(5, duration),
            status="planned",
        )
        db.session.add(pt)
        db.session.commit()
        return jsonify(serialize_planner_task(pt)), 201

    @app.post("/api/planner/start/<int:planner_task_id>")
    @login_required()
    def api_planner_start(planner_task_id: int):
        user = current_user()
        pt = PlannerTask.query.filter_by(id=planner_task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not pt:
            return jsonify({"error": "Not found"}), 404
        if pt.status == "completed":
            return jsonify({"error": "Already completed"}), 400

        pt.status = "running"
        if not pt.start_time:
            pt.start_time = dt.datetime.utcnow()
        pt.end_time = None
        db.session.commit()
        return jsonify(serialize_planner_task(pt))

    @app.post("/api/planner/stop/<int:planner_task_id>")
    @login_required()
    def api_planner_stop(planner_task_id: int):
        user = current_user()
        pt = PlannerTask.query.filter_by(id=planner_task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not pt:
            return jsonify({"error": "Not found"}), 404
        if pt.status != "running" and pt.status != "planned":
            return jsonify({"error": "Invalid state"}), 400

        now = dt.datetime.utcnow()
        if not pt.start_time:
            pt.start_time = now
        pt.end_time = now
        minutes = int((pt.end_time - pt.start_time).total_seconds() // 60)
        pt.duration_minutes = max(pt.duration_minutes, minutes or 1)
        pt.status = "completed"
        db.session.commit()
        return jsonify(serialize_planner_task(pt))

    @app.delete("/api/planner/task/<int:planner_task_id>")
    @login_required()
    def api_planner_delete(planner_task_id: int):
        user = current_user()
        pt = PlannerTask.query.filter_by(id=planner_task_id, user_id=user.id).first()  # type: ignore[arg-type]
        if not pt:
            return jsonify({"error": "Not found"}), 404
        db.session.delete(pt)
        db.session.commit()
        return jsonify({"message": "Deleted"})

