from __future__ import annotations

import datetime as dt
from typing import Dict, Any, List, Tuple


def compute_analytics_summary(user_id: int, StudySession, Task, PlannerTask, week_ago: dt.date) -> Dict[str, Any]:
    sessions = StudySession.query.filter(
        StudySession.user_id == user_id,  # type: ignore[arg-type]
        StudySession.start_time >= dt.datetime.combine(week_ago, dt.time.min),
    ).all()

    planner_completed = PlannerTask.query.filter(
        PlannerTask.user_id == user_id,  # type: ignore[arg-type]
        PlannerTask.status == "completed",
        PlannerTask.end_time.isnot(None),
        PlannerTask.start_time >= dt.datetime.combine(week_ago, dt.time.min),
    ).all()

    daily_hours: Dict[str, float] = {}
    subject_breakdown: Dict[str, float] = {}

    for sess in sessions:
        end = sess.end_time or dt.datetime.utcnow()
        minutes = (end - sess.start_time).total_seconds() / 60.0
        day_key = sess.start_time.date().isoformat()
        daily_hours[day_key] = daily_hours.get(day_key, 0) + minutes / 60.0

        if getattr(sess, "task", None) and getattr(sess.task, "subject", None):
            name = sess.task.subject.name
            subject_breakdown[name] = subject_breakdown.get(name, 0) + minutes / 60.0
        else:
            subject_breakdown["Focus"] = subject_breakdown.get("Focus", 0) + minutes / 60.0

    # Planner tasks add time too (as "Planner")
    for pt in planner_completed:
        if not pt.start_time or not pt.end_time:
            continue
        minutes = (pt.end_time - pt.start_time).total_seconds() / 60.0
        day_key = pt.start_time.date().isoformat()
        daily_hours[day_key] = daily_hours.get(day_key, 0) + minutes / 60.0
        subject_breakdown["Planner"] = subject_breakdown.get("Planner", 0) + minutes / 60.0

    total_week_hours = sum(daily_hours.values())
    completed_tasks = Task.query.filter_by(user_id=user_id, completed=True).count()  # type: ignore[arg-type]
    total_tasks = Task.query.filter_by(user_id=user_id).count()  # type: ignore[arg-type]
    completion_rate = (completed_tasks / total_tasks) if total_tasks else 0

    planner_done = PlannerTask.query.filter_by(user_id=user_id, status="completed").count()  # type: ignore[arg-type]
    planner_total = PlannerTask.query.filter_by(user_id=user_id).count()  # type: ignore[arg-type]
    planner_rate = (planner_done / planner_total) if planner_total else 0

    productivity_score = int(min(100, (total_week_hours * 10) + (completion_rate * 25) + (planner_rate * 25)))

    # Study streak (consecutive days with > 0 minutes, ending today)
    today = dt.date.today()
    days_with_study = set()
    for sess in sessions:
        end = sess.end_time or dt.datetime.utcnow()
        if (end - sess.start_time).total_seconds() >= 60:
            days_with_study.add(sess.start_time.date())
    for pt in planner_completed:
        if pt.start_time and pt.end_time and (pt.end_time - pt.start_time).total_seconds() >= 60:
            days_with_study.add(pt.start_time.date())

    streak = 0
    cursor = today
    while cursor in days_with_study:
        streak += 1
        cursor = cursor - dt.timedelta(days=1)

    # Focus session stats (ended sessions only, within week)
    ended_sessions = [s for s in sessions if s.end_time is not None]
    focus_sessions = [s for s in ended_sessions if getattr(s, "task_id", None) in (None, 0)]
    focus_count = len(focus_sessions)
    focus_minutes: List[int] = []
    for s in focus_sessions:
        focus_minutes.append(int((s.end_time - s.start_time).total_seconds() // 60))  # type: ignore[operator]
    avg_focus = (sum(focus_minutes) / focus_count) if focus_count else 0

    # Weekly trend points (Mon..Sun for last 7 days)
    trend: List[Tuple[str, float]] = []
    for i in range(6, -1, -1):
        day = today - dt.timedelta(days=i)
        key = day.isoformat()
        trend.append((key, float(daily_hours.get(key, 0))))

    return {
        "daily_hours": daily_hours,
        "subject_breakdown": subject_breakdown,
        "total_week_hours": total_week_hours,
        "completion_rate": completion_rate,
        "planner_completion_rate": planner_rate,
        "productivity_score": productivity_score,
        "study_streak_days": streak,
        "focus_sessions_count": focus_count,
        "focus_sessions_avg_minutes": avg_focus,
        "weekly_trend": [{"day": d, "hours": h} for (d, h) in trend],
    }

