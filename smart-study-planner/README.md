# Smart Study Planner

Premium full-stack study planner built with Flask, SQLite, HTML, CSS, and JavaScript.

## Features

- Register, login, logout, and protected user sessions
- Subject-based task management with persistent study session timers
- Weekly planner with Monday-Sunday layout and drag/drop movement
- Notes with tags, favorites, pinning, checklist items, and autosave
- Animated analytics for study time, completed tasks, missed tasks, streaks, and subject distribution
- Settings for light/dark theme, accent colors, focus timing, reminders, and alarm sound
- Global timer, stopwatch, focus mode, alarms, toasts, reminders, export, and import

## Run

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Then open `http://127.0.0.1:5000`.

## Structure

- `run.py`: application entry point
- `app/__init__.py`: Flask app factory
- `app/auth.py`: auth routes and session handling
- `app/main.py`: dashboard pages and JSON APIs
- `app/db.py`: SQLite connection helpers
- `app/schema.sql`: database schema
- `app/templates/`: Jinja templates
- `app/static/css/style.css`: liquid-glass styling
- `app/static/js/app.js`: dashboard interactions and rendering
