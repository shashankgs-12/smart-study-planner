from __future__ import annotations

import datetime as dt


def define_planner_task_model(db):
    class PlannerTask(db.Model):  # type: ignore[name-defined]
        __tablename__ = "planner_task"

        id = db.Column(db.Integer, primary_key=True)
        user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

        task_text = db.Column(db.String(255), nullable=False)
        day_of_week = db.Column(db.String(12), nullable=False)  # monday..sunday

        status = db.Column(db.String(16), default="planned")  # planned/running/completed
        start_time = db.Column(db.DateTime)
        end_time = db.Column(db.DateTime)
        duration_minutes = db.Column(db.Integer, default=30)
        created_at = db.Column(db.DateTime, default=dt.datetime.utcnow)

    return PlannerTask

