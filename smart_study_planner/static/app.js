const API = {
  async request(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },
  get(path) {
    return this.request(path, { method: "GET" });
  },
  post(path, body) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  },
  put(path, body) {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) });
  },
  del(path) {
    return this.request(path, { method: "DELETE" });
  },
};

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

const MOTIVATIONAL_QUOTES = [
  "Small, consistent efforts compound into mastery.",
  "Focus is your unfair advantage.",
  "Study today, lead tomorrow.",
  "Your future self is watching. Don’t let them down.",
  "Deep work beats long hours.",
];

// Auth page logic
function initAuthPage() {
  const loginForm = qs("#login-form");
  const registerForm = qs("#register-form");
  const errorEl = qs("#auth-error");
  if (!loginForm || !registerForm) return;

  qsa(".tab-button").forEach((btn) =>
    btn.addEventListener("click", () => {
      qsa(".tab-button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.dataset.tab;
      qsa(".tab-content").forEach((c) => c.classList.remove("active"));
      qs(`#${target}-form`).classList.add("active");
    })
  );

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const form = new FormData(loginForm);
    try {
      await API.post("/api/auth/login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      window.location.href = "/";
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const form = new FormData(registerForm);
    try {
      await API.post("/api/auth/register", {
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
      });
      window.location.href = "/";
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// Dashboard logic
const state = {
  user: null,
  subjects: [],
  tasks: [],
  plannerTasks: [],
  notes: [],
  alarms: [],
  runningTask: {
    taskId: null,
    sessionId: null,
    startedAt: null,
  },
  timer: {
    mode: "focus",
    remaining: 25 * 60,
    intervalId: null,
    currentSessionId: null,
    currentPlannerTaskId: null,
    managedSession: false,
  },
};

async function loadInitialData() {
  const me = await API.get("/api/auth/me");
  state.user = me;
  applyUserPreferences();
  await Promise.all([loadSubjects(), loadTasks(), loadPlannerTasks(), loadNotes(), loadAlarms(), loadAnalytics()]);
}

function applyUserPreferences() {
  if (!state.user || !state.user.id) return;
  qs("#user-name").textContent = state.user.name;
  document.documentElement.style.setProperty("--accent", state.user.accent_color || "#7c3aed");
  applyTheme(state.user.theme_mode || "light", { persist: false });
  const timerMinutes = {
    focus: state.user.focus_minutes || 25,
    short: state.user.short_break_minutes || 5,
    long: state.user.long_break_minutes || 15,
  };
  state.timer.defaultDurations = timerMinutes;
  setTimerMode("focus");
  seedTimerSetPanel(timerMinutes);
  const settingsForm = qs("#settings-form");
  if (settingsForm) {
    settingsForm.focus_minutes.value = timerMinutes.focus;
    settingsForm.short_break_minutes.value = timerMinutes.short;
    settingsForm.long_break_minutes.value = timerMinutes.long;
    settingsForm.compact_mode.checked = !!state.user.compact_mode;
    settingsForm.accent_color.value = state.user.accent_color || "#7c3aed";
  }
}

function applyTheme(mode, { persist } = { persist: true }) {
  const m = (mode || "light").toLowerCase() === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = m;
  const btn = qs("#theme-toggle-btn");
  if (btn) btn.textContent = m === "dark" ? "Light mode" : "Dark mode";
  if (persist) {
    API.put("/api/settings", { theme_mode: m }).catch(() => {});
    if (state.user) state.user.theme_mode = m;
  }
}

function seedTimerSetPanel(timerMinutes) {
  qs("#timer-set-focus") && (qs("#timer-set-focus").value = timerMinutes.focus);
  qs("#timer-set-short") && (qs("#timer-set-short").value = timerMinutes.short);
  qs("#timer-set-long") && (qs("#timer-set-long").value = timerMinutes.long);
}

async function loadSubjects() {
  state.subjects = await API.get("/api/subjects");
  const container = qs("#subjects-list");
  const select = qs("#task-subject-select");
  if (!container || !select) return;
  container.innerHTML = "";
  select.innerHTML = '<option value="">No subject</option>';
  state.subjects.forEach((s) => {
    const pill = document.createElement("div");
    pill.className = "subject-pill";
    pill.innerHTML = `
      <span class="subject-dot" style="background:${s.color}"></span>
      <span class="subject-name">${s.name}</span>
      <button class="subject-delete" title="Delete subject" aria-label="Delete subject">×</button>
    `;
    pill.querySelector(".subject-delete").addEventListener("click", async () => {
      if (!confirm(`Delete subject "${s.name}"?`)) return;
      await API.del(`/api/subjects/${s.id}`);
      await loadSubjects();
      await loadTasks();
    });
    container.appendChild(pill);

    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
}

async function loadTasks() {
  state.tasks = await API.get("/api/tasks");
  renderTasks();
  renderPlanner();
  renderNoteTaskOptions();
}

async function loadPlannerTasks() {
  try {
    state.plannerTasks = await API.get("/api/planner/tasks");
  } catch (e) {
    // If planner routes aren't available (e.g. old server), don't break the whole app.
    state.plannerTasks = [];
  }
  renderPlanner();
}

function renderTasks() {
  const list = qs("#tasks-list");
  if (!list) return;
  list.innerHTML = "";
  const byId = Object.fromEntries(state.subjects.map((s) => [s.id, s]));

  state.tasks
    .slice()
    .sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? 1 : -1))
    .forEach((t) => {
      const div = document.createElement("div");
      div.className = "task-card";
      div.draggable = true;
      div.dataset.taskId = t.id;
      const subject = byId[t.subject_id];
      const priorityLabel = t.priority === 1 ? "High" : t.priority === 2 ? "Medium" : "Low";
      const isRunning = state.runningTask.taskId === t.id;

      let deadlineBadge = "";
      if (t.deadline) {
        const d = new Date(t.deadline);
        const isPast = d < new Date();
        deadlineBadge = `<span class="badge ${isPast ? "badge-danger" : ""}">Due ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;
      }

      div.innerHTML = `
        <input type="checkbox" ${t.completed ? "checked" : ""} />
        <div class="task-main">
          <div class="task-title">${t.title}</div>
          <div class="task-meta">
            <span class="badge">${priorityLabel} · ${t.duration_minutes} min</span>
            ${subject ? `<span class="badge" style="border-color:${subject.color};">${subject.name}</span>` : ""}
            ${deadlineBadge}
            ${isRunning ? `<span class="badge" style="border-color:rgba(34,197,94,.55);">Running · <span data-elapsed="1">00:00</span></span>` : ""}
          </div>
        </div>
        <div class="task-actions">
          <button class="secondary-btn small" data-action="startstop">${isRunning ? "Stop" : "Start"}</button>
          <button class="ghost-btn small" data-action="edit">Edit</button>
          <button class="ghost-btn small" data-action="delete">Delete</button>
        </div>
      `;

      const checkbox = div.querySelector("input[type='checkbox']");
      checkbox.addEventListener("change", () => toggleTaskCompleted(t.id, checkbox.checked));

      const startStopBtn = div.querySelector("[data-action='startstop']");
      startStopBtn.addEventListener("click", () => (isRunning ? stopTaskSession(t) : startTaskSession(t)));

      const editBtn = div.querySelector("[data-action='edit']");
      const delBtn = div.querySelector("[data-action='delete']");
      editBtn.addEventListener("click", () => editTaskPrompt(t));
      delBtn.addEventListener("click", () => deleteTask(t.id));

      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/task-id", String(t.id));
      });

      list.appendChild(div);
    });
}

async function startTaskSession(task) {
  // Stop any running task locally (backend will also enforce this).
  if (state.runningTask.taskId && state.runningTask.taskId !== task.id) {
    const prevId = state.runningTask.taskId;
    try {
      await API.post(`/api/tasks/stop/${prevId}`, {});
    } catch {}
  }

  const data = await API.post(`/api/tasks/start/${task.id}`, {});
  const sess = data.session;
  state.runningTask = {
    taskId: task.id,
    sessionId: sess.id,
    startedAt: new Date(sess.start_time).getTime(),
  };

  // Start timer automatically for this task duration.
  state.timer.managedSession = true;
  state.timer.currentSessionId = sess.id;
  state.timer.currentPlannerTaskId = null;
  state.timer.mode = "focus";
  state.timer.remaining = (task.duration_minutes || 30) * 60;
  updateTimerDisplay();
  startTimer();
  renderTasks();
}

async function stopTaskSession(task) {
  try {
    await API.post(`/api/tasks/stop/${task.id}`, {});
  } finally {
    pauseTimer();
    state.timer.managedSession = false;
    state.timer.currentSessionId = null;
    state.runningTask = { taskId: null, sessionId: null, startedAt: null };
    await loadAnalytics();
    renderTasks();
  }
}

async function toggleTaskCompleted(id, completed) {
  await API.put(`/api/tasks/${id}`, { completed });
  await loadTasks();
  await loadAnalytics();
}

function editTaskPrompt(task) {
  const title = prompt("Edit task title", task.title);
  if (!title) return;
  API.put(`/api/tasks/${task.id}`, { title }).then(loadTasks);
}

async function deleteTask(id) {
  if (!confirm("Delete this task?")) return;
  await API.del(`/api/tasks/${id}`);
  await loadTasks();
}

function renderPlanner() {
  const grid = qs("#planner-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayLabel = (d) => d.charAt(0).toUpperCase() + d.slice(1, 3);

  const tasksByDay = {};
  const plannerByDay = {};
  days.forEach((d) => (tasksByDay[d] = []));
  days.forEach((d) => (plannerByDay[d] = []));
  state.tasks.forEach((t) => {
    if (t.planned_day && tasksByDay[t.planned_day]) tasksByDay[t.planned_day].push(t);
  });
  state.plannerTasks.forEach((pt) => {
    if (pt.day_of_week && plannerByDay[pt.day_of_week]) plannerByDay[pt.day_of_week].push(pt);
  });

  days.forEach((d) => {
    const col = document.createElement("div");
    col.className = "planner-column";
    col.innerHTML = `
      <div class="planner-head">
        <h4>${dayLabel(d)}</h4>
        <button class="ghost-btn small planner-add" type="button" data-day="${d}">+ Add</button>
      </div>
      <div class="planner-droppable" data-day="${d}"></div>
    `;
    const drop = col.querySelector(".planner-droppable");

    drop.addEventListener("dragover", (e) => e.preventDefault());
    drop.addEventListener("drop", async (e) => {
      const taskId = e.dataTransfer.getData("text/task-id");
      if (!taskId) return;
      const task = state.tasks.find((t) => String(t.id) === String(taskId));
      if (!task) return;
      await API.post("/api/planner/task", {
        task_text: task.title,
        day: d,
        duration_minutes: task.duration_minutes || 30,
      });
      await loadPlannerTasks();
    });

    // Planner tasks (interactive)
    plannerByDay[d]
      .slice()
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "running" ? -1 : 1))
      .forEach((pt) => {
        const card = document.createElement("div");
        card.className = `planner-card status-${pt.status}`;
        card.innerHTML = `
          <div class="planner-card-title">${escapeHtml(pt.task_text)}</div>
          <div class="planner-card-actions">
            <button class="secondary-btn small" data-action="start">Start</button>
            <button class="primary-btn small" data-action="complete">Complete</button>
            <button class="ghost-btn small" data-action="delete">Delete</button>
          </div>
        `;
        const startBtn = card.querySelector("[data-action='start']");
        const completeBtn = card.querySelector("[data-action='complete']");
        const delBtn = card.querySelector("[data-action='delete']");

        startBtn.disabled = pt.status === "running" || pt.status === "completed";
        completeBtn.disabled = pt.status === "completed";

        startBtn.addEventListener("click", () => startPlannerTask(pt));
        completeBtn.addEventListener("click", () => completePlannerTask(pt));
        delBtn.addEventListener("click", async () => {
          if (!confirm("Delete planner task?")) return;
          await API.del(`/api/planner/task/${pt.id}`);
          await loadPlannerTasks();
          await loadAnalytics();
        });

        drop.appendChild(card);
      });

    // Legacy chips (drag sources) — keep showing planned tasks as chips
    tasksByDay[d].forEach((t) => {
      const chip = document.createElement("div");
      chip.className = "planner-task";
      chip.textContent = t.title;
      chip.draggable = true;
      chip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/task-id", String(t.id));
      });
      drop.appendChild(chip);
    });

    grid.appendChild(col);
  });

  qsa(".planner-add").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const day = btn.dataset.day;
      const text = prompt(`Add a study task for ${day}`);
      if (!text) return;
      await API.post("/api/planner/task", { task_text: text, day, duration_minutes: state.timer.defaultDurations?.focus || 25 });
      await loadPlannerTasks();
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function startPlannerTask(pt) {
  const updated = await API.post(`/api/planner/start/${pt.id}`, {});
  state.timer.currentPlannerTaskId = updated.id;
  state.timer.mode = "focus";
  state.timer.remaining = (updated.duration_minutes || 25) * 60;
  updateTimerDisplay();
  startTimer();
  await loadPlannerTasks();
}

async function completePlannerTask(pt) {
  pauseTimer();
  if (state.timer.currentPlannerTaskId === pt.id) state.timer.currentPlannerTaskId = null;
  await API.post(`/api/planner/stop/${pt.id}`, {});
  await Promise.all([loadPlannerTasks(), loadAnalytics()]);
}

async function loadNotes() {
  state.notes = await API.get("/api/notes");
  renderNotes();
}

function renderNoteTaskOptions() {
  const select = qs("#note-task-select");
  if (!select) return;
  select.innerHTML = '<option value="">General</option>';
  state.tasks.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.title;
    select.appendChild(opt);
  });
}

function renderNotes() {
  const container = qs("#notes-list");
  if (!container) return;
  container.innerHTML = "";
  state.notes
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((n) => {
      const div = document.createElement("div");
      div.className = "note-card";
      const task = state.tasks.find((t) => t.id === n.task_id);
      const created = new Date(n.created_at);
      div.innerHTML = `
        <div>${n.content}</div>
        <div class="note-meta">
          <span>${task ? task.title : "General"}</span>
          <span>${created.toLocaleString()}</span>
          <button class="ghost-btn small" data-action="delete">Delete</button>
        </div>
      `;
      div.querySelector("[data-action='delete']").addEventListener("click", async () => {
        await API.del(`/api/notes/${n.id}`);
        await loadNotes();
      });
      container.appendChild(div);
    });
}

async function loadAlarms() {
  state.alarms = await API.get("/api/alarms");
  renderAlarms();
}

function renderAlarms() {
  const list = qs("#alarms-list");
  if (!list) return;
  list.innerHTML = "";
  state.alarms.forEach((a) => {
    const row = document.createElement("div");
    row.className = "alarm-row";
    const d = new Date(a.fire_at);
    const timeText = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    row.innerHTML = `
      <span>${timeText}</span>
      <button class="ghost-btn small" data-action="delete">×</button>
    `;
    row.querySelector("[data-action='delete']").addEventListener("click", async () => {
      await API.del(`/api/alarms/${a.id}`);
      await loadAlarms();
    });
    list.appendChild(row);
  });
}

async function clearAllAlarms() {
  if (!state.alarms.length) return;
  if (!confirm("Clear all alarms?")) return;
  await Promise.allSettled(state.alarms.map((a) => API.del(`/api/alarms/${a.id}`)));
  await loadAlarms();
}

async function loadAnalytics() {
  const data = await API.get("/api/analytics/summary");
  const weekHours = data.total_week_hours.toFixed(1);
  qs("#metric-week-hours").textContent = weekHours;
  qs("#metric-completion").textContent = `${Math.round(data.completion_rate * 100)}%`;
  qs("#metric-score").textContent = data.productivity_score;
  qs("#metric-streak").textContent = `${data.study_streak_days || 0} days`;
  qs("#metric-focus-count").textContent = data.focus_sessions_count || 0;
  qs("#metric-focus-avg").textContent = `${Math.round(data.focus_sessions_avg_minutes || 0)} min`;

  renderCharts(data);
}

let charts = { daily: null, weekly: null, subjects: null };

function renderCharts(data) {
  if (!window.Chart) return;

  const dailyCanvas = qs("#chart-daily");
  const weeklyCanvas = qs("#chart-weekly");
  const subjectsCanvas = qs("#chart-subjects");
  if (!dailyCanvas || !weeklyCanvas || !subjectsCanvas) return;

  const trend = data.weekly_trend || [];
  const dailyLabels = trend.map((p) => p.day.slice(5));
  const dailyValues = trend.map((p) => Number(p.hours || 0));

  const subjEntries = data.subject_breakdown || {};
  const subjLabels = Object.keys(subjEntries);
  const subjValues = subjLabels.map((k) => Number(subjEntries[k] || 0));

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c3aed";

  charts.daily?.destroy?.();
  charts.weekly?.destroy?.();
  charts.subjects?.destroy?.();

  charts.daily = new Chart(dailyCanvas, {
    type: "bar",
    data: {
      labels: dailyLabels,
      datasets: [
        {
          label: "Hours",
          data: dailyValues,
          backgroundColor: accent + "33",
          borderColor: accent,
          borderWidth: 1,
          borderRadius: 10,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(15,23,42,0.08)" } },
      },
    },
  });

  charts.weekly = new Chart(weeklyCanvas, {
    type: "line",
    data: {
      labels: dailyLabels,
      datasets: [
        {
          label: "Hours",
          data: dailyValues,
          borderColor: accent,
          backgroundColor: accent + "22",
          tension: 0.35,
          fill: true,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(15,23,42,0.08)" } },
      },
    },
  });

  charts.subjects = new Chart(subjectsCanvas, {
    type: "doughnut",
    data: {
      labels: subjLabels,
      datasets: [
        {
          data: subjValues,
          backgroundColor: [
            accent,
            "#22c55e",
            "#06b6d4",
            "#f97316",
            "#ef4444",
            "#eab308",
            "#0ea5e9",
            "#a855f7",
          ].slice(0, Math.max(3, subjLabels.length)),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      cutout: "65%",
    },
  });
}

// Pomodoro timer & focus mode
function setTimerMode(mode) {
  state.timer.mode = mode;
  const minutes = state.timer.defaultDurations?.[mode] || 25;
  state.timer.remaining = minutes * 60;
  updateTimerDisplay();
  qsa(".timer-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

function updateTimerDisplay() {
  const mins = Math.floor(state.timer.remaining / 60)
    .toString()
    .padStart(2, "0");
  const secs = (state.timer.remaining % 60).toString().padStart(2, "0");
  const text = `${mins}:${secs}`;
  const disp = qs("#timer-display");
  const focusDisp = qs("#focus-timer-display");
  if (disp) disp.textContent = text;
  if (focusDisp) focusDisp.textContent = text;
}

function startTimer() {
  if (state.timer.intervalId) return;
  if (state.timer.mode === "focus" && !state.timer.managedSession) {
    API.post("/api/sessions/start", { task_id: null }).then((s) => {
      state.timer.currentSessionId = s.id;
    });
  }
  state.timer.intervalId = setInterval(async () => {
    state.timer.remaining -= 1;
    if (state.timer.remaining <= 0) {
      clearInterval(state.timer.intervalId);
      state.timer.intervalId = null;
      updateTimerDisplay();
      try {
        if (state.timer.currentSessionId) {
          await API.post(`/api/sessions/${state.timer.currentSessionId}/end`, {});
        }
        if (state.timer.currentPlannerTaskId) {
          await API.post(`/api/planner/stop/${state.timer.currentPlannerTaskId}`, {});
          state.timer.currentPlannerTaskId = null;
          await loadPlannerTasks();
        }
        await loadAnalytics();
      } catch {}
      state.timer.currentSessionId = null;
      state.timer.managedSession = false;
      state.runningTask = { taskId: null, sessionId: null, startedAt: null };
      playAlarm();
      alert("Timer finished!");
    } else {
      updateTimerDisplay();
      updateRunningElapsedBadges();
    }
  }, 1000);
}

function updateRunningElapsedBadges() {
  if (!state.runningTask.startedAt) return;
  const elapsedSec = Math.max(0, Math.floor((Date.now() - state.runningTask.startedAt) / 1000));
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  qsa("[data-elapsed='1']").forEach((el) => (el.textContent = `${mm}:${ss}`));
}

function pauseTimer() {
  if (state.timer.intervalId) {
    clearInterval(state.timer.intervalId);
    state.timer.intervalId = null;
  }
}

function resetTimer() {
  pauseTimer();
  setTimerMode(state.timer.mode);
}

function playAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.0);
    o.stop(ctx.currentTime + 1.0);
  } catch {}
}

// Focus overlay
function enterFocusMode() {
  const overlay = qs("#focus-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  qs("#focus-quote").textContent = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

function exitFocusMode() {
  const overlay = qs("#focus-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
}

// Alarms polling
async function pollAlarms() {
  try {
    const alarms = await API.get("/api/alarms");
    const now = new Date();
    for (const a of alarms) {
      const fireAt = new Date(a.fire_at);
      if (!a.fired && fireAt <= now) {
        playAlarm();
        alert(`Alarm: ${a.label}`);
        await API.del(`/api/alarms/${a.id}`);
      }
    }
  } catch {}
}

// Section navigation
function initNavigation() {
  qsa(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      qsa(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const section = btn.dataset.section;
      qs("#section-title").textContent = section.charAt(0).toUpperCase() + section.slice(1);
      qsa(".content-section").forEach((s) => s.classList.remove("active"));
      qs(`#section-${section}`).classList.add("active");

      // On small screens, close the sidebar after navigation.
      const sidebar = qs("#sidebar");
      const backdrop = qs("#sidebar-backdrop");
      if (sidebar && backdrop && window.matchMedia("(max-width: 768px)").matches) {
        sidebar.classList.remove("open");
        backdrop.classList.add("hidden");
      }
    });
  });
}

function goToSection(section) {
  const btn = qs(`.nav-item[data-section='${section}']`);
  btn?.click?.();
}

function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
    if (typing) return;

    const key = (e.key || "").toLowerCase();
    if (key === "n") {
      goToSection("tasks");
      qs("#task-form input[name='title']")?.focus?.();
      e.preventDefault();
    }
    if (key === "p") {
      goToSection("planner");
      e.preventDefault();
    }
    if (key === "f") {
      enterFocusMode();
      e.preventDefault();
    }
  });
}

// Forms
function initForms() {
  const taskForm = qs("#task-form");
  if (taskForm) {
    taskForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(taskForm);
      await API.post("/api/tasks", {
        title: form.get("title"),
        description: form.get("description"),
        deadline: form.get("deadline") || null,
        priority: Number(form.get("priority") || 2),
        duration_minutes: Number(form.get("duration_minutes") || 30),
        subject_id: form.get("subject_id") || null,
      });
      taskForm.reset();
      await loadTasks();
    });
  }

  const toggleBtn = qs("#subject-form-toggle");
  const panel = qs("#subject-form-panel");
  const subjectForm = qs("#subject-form");
  const cancelBtn = qs("#subject-form-cancel");
  const colorInput = qs("#subject-color");
  if (toggleBtn && panel) {
    toggleBtn.addEventListener("click", () => {
      const willShow = panel.classList.contains("hidden");
      panel.classList.toggle("hidden");
      toggleBtn.textContent = panel.classList.contains("hidden") ? "+ Subject" : "Hide";
      if (willShow) {
        const nameInput = panel.querySelector("input[name='name']");
        nameInput?.focus();
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }
  cancelBtn?.addEventListener("click", () => {
    panel?.classList.add("hidden");
    if (toggleBtn) toggleBtn.textContent = "+ Subject";
  });

  qsa("#subject-swatches .swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.color;
      if (colorInput && c) colorInput.value = c;
    });
  });

  if (subjectForm) {
    subjectForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(subjectForm);
      const name = String(form.get("name") || "").trim();
      const color = String(form.get("color") || "#4f46e5").trim();
      if (!name) {
        alert("Please enter a subject name.");
        return;
      }
      try {
        await API.post("/api/subjects", { name, color });
        subjectForm.reset();
        if (colorInput) colorInput.value = "#4f46e5";
        panel?.classList.add("hidden");
        if (toggleBtn) toggleBtn.textContent = "+ Subject";
        await loadSubjects();
        await loadTasks();
      } catch (err) {
        alert(err.message || "Could not create subject");
      }
    });
  } else {
    // Safety fallback: if the form isn't found, revert to prompt-based add.
    toggleBtn?.addEventListener("click", async () => {
      const name = prompt("Subject name");
      if (!name) return;
      const color = "#4f46e5";
      try {
        await API.post("/api/subjects", { name, color });
        await loadSubjects();
        await loadTasks();
      } catch (err) {
        alert(err.message || "Could not create subject");
      }
    });
  }

  const noteForm = qs("#note-form");
  if (noteForm) {
    noteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(noteForm);
      await API.post("/api/notes", {
        content: form.get("content"),
        task_id: form.get("task_id") || null,
      });
      noteForm.reset();
      await loadNotes();
    });
  }

  const settingsForm = qs("#settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(settingsForm);
      const payload = {
        accent_color: form.get("accent_color"),
        compact_mode: settingsForm.compact_mode.checked,
        focus_minutes: Number(form.get("focus_minutes") || 25),
        short_break_minutes: Number(form.get("short_break_minutes") || 5),
        long_break_minutes: Number(form.get("long_break_minutes") || 15),
      };
      await API.put("/api/settings", payload);
      state.user = { ...state.user, ...payload };
      applyUserPreferences();
    });
  }

  const alarmForm = qs("#alarm-form");
  if (alarmForm) {
    alarmForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(alarmForm);
      await API.post("/api/alarms", {
        label: form.get("label"),
        time: form.get("time"),
      });
      alarmForm.reset();
      await loadAlarms();
    });
  }
}

function initTimerControls() {
  qsa(".timer-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTimerMode(btn.dataset.mode);
    });
  });
  qs("#timer-start")?.addEventListener("click", startTimer);
  qs("#timer-pause")?.addEventListener("click", pauseTimer);
  qs("#timer-reset")?.addEventListener("click", resetTimer);

  qs("#timer-set-toggle")?.addEventListener("click", () => {
    const panel = qs("#timer-set-panel");
    if (!panel) return;
    panel.classList.toggle("hidden");
  });

  qs("#timer-set-apply")?.addEventListener("click", async () => {
    const f = Number(qs("#timer-set-focus")?.value || state.timer.defaultDurations.focus || 25);
    const s = Number(qs("#timer-set-short")?.value || state.timer.defaultDurations.short || 5);
    const l = Number(qs("#timer-set-long")?.value || state.timer.defaultDurations.long || 15);
    const payload = {
      focus_minutes: Math.max(10, f),
      short_break_minutes: Math.max(1, s),
      long_break_minutes: Math.max(1, l),
    };
    state.timer.defaultDurations = { focus: payload.focus_minutes, short: payload.short_break_minutes, long: payload.long_break_minutes };
    seedTimerSetPanel(state.timer.defaultDurations);
    resetTimer();
    try {
      await API.put("/api/settings", payload);
      state.user = { ...state.user, ...payload };
    } catch (e) {
      console.warn(e);
    }
  });
}

function initFocusOverlay() {
  qs("#focus-mode-btn")?.addEventListener("click", enterFocusMode);
  qs("#focus-exit")?.addEventListener("click", exitFocusMode);
}

function initLogout() {
  qs("#logout-btn")?.addEventListener("click", async () => {
    await API.post("/api/auth/logout", {});
    window.location.href = "/login";
  });
}

function initAlarmsExtras() {
  qs("#alarms-clear-btn")?.addEventListener("click", clearAllAlarms);
}

function initThemeToggle() {
  qs("#theme-toggle-btn")?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme || "light";
    applyTheme(current === "dark" ? "light" : "dark", { persist: true });
  });
}

function initSidebarToggle() {
  const toggle = qs("#sidebar-toggle");
  const sidebar = qs("#sidebar");
  const backdrop = qs("#sidebar-backdrop");
  if (!toggle || !sidebar || !backdrop) return;

  toggle.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    backdrop.classList.toggle("hidden", !isOpen);
  });

  backdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    backdrop.classList.add("hidden");
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (qs("#login-form")) {
    initAuthPage();
    return;
  }
  initNavigation();
  initSidebarToggle();
  initForms();
  initTimerControls();
  initFocusOverlay();
  initLogout();
  initAlarmsExtras();
  initKeyboardShortcuts();
  initThemeToggle();
  try {
    await loadInitialData();
  } catch (e) {
    console.error(e);
    // Avoid redirect loops (e.g. one API temporarily unavailable).
    alert(e?.message || "Some data failed to load. Try refreshing once.");
  }
  setInterval(pollAlarms, 30_000);
});

