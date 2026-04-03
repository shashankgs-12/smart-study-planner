const state = {
  data: {
    user: null,
    subjects: [],
    tasks: [],
    weekly_plans: [],
    notes: [],
    alarms: [],
    settings: null,
    analytics: null,
    quotes: [],
    daily_goal: null,
    focus_task: null,
    history: [],
  },
  activeSection: "tasks",
  taskFilter: "today",
  search: "",
  selectedNoteId: null,
  autoSaveHandle: null,
  confirmResolver: null,
  reminderCache: new Set(),
  alarmCache: new Set(),
  dragPlanId: null,
  timerPrefs: { minutes: 50, autoStart: false, sound: "glass" },
  tools: {
    timer: { total: 3000, remaining: 3000, running: false, lastTick: null },
    stopwatch: { elapsed: 0, running: false, lastTick: null, laps: [] },
    focus: { total: 3000, remaining: 3000, running: false, lastTick: null, onBreak: false },
  },
};

const ui = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  bindStaticEvents();
  initializeApp().catch((error) => {
    console.error(error);
    showToast("Failed to load the planner.", "error");
  });
});

function cacheDom() {
  ui.root = document.getElementById("app-root");
  ui.navItems = Array.from(document.querySelectorAll(".nav-item"));
  ui.sections = {
    tasks: document.getElementById("tasks-section"),
    planner: document.getElementById("planner-section"),
    notes: document.getElementById("notes-section"),
    analytics: document.getElementById("analytics-section"),
    settings: document.getElementById("settings-section"),
  };
  ui.heroMetrics = document.getElementById("hero-metrics");
  ui.quotePanel = document.getElementById("quote-panel");
  ui.alarmPreviewList = document.getElementById("alarm-preview-list");
  ui.modalBackdrop = document.getElementById("modal-backdrop");
  ui.toastContainer = document.getElementById("toast-container");
  ui.confirmDialog = document.getElementById("confirm-dialog");
  ui.confirmTitle = document.getElementById("confirm-title");
  ui.confirmMessage = document.getElementById("confirm-message");
  ui.confirmAccept = document.getElementById("confirm-accept");
  ui.confirmCancel = document.getElementById("confirm-cancel");
  ui.focusOverlay = document.getElementById("focus-overlay");
  ui.focusCountdown = document.getElementById("focus-countdown");
  ui.focusTaskLabel = document.getElementById("focus-task-label");
}

function bindStaticEvents() {
  ui.navItems.forEach((item) => {
    item.addEventListener("click", () => setActiveSection(item.dataset.section));
  });

  document.getElementById("global-search").addEventListener(
    "input",
    debounce((event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderActiveSection();
    }, 180),
  );

  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("export-button").addEventListener("click", () => {
    window.location.href = "/api/export";
  });
  document.getElementById("import-input").addEventListener("change", handleImport);
  document.getElementById("new-alarm-button").addEventListener("click", () => openAlarmModal());
  document.getElementById("focus-mode-trigger").addEventListener("click", startFocusMode);
  document.getElementById("focus-break-toggle").addEventListener("click", toggleFocusBreak);
  document.getElementById("focus-close").addEventListener("click", stopFocusMode);

  document.querySelectorAll("[data-tool-action]").forEach((button) => {
    button.addEventListener("click", () => handleToolAction(button.dataset.toolAction));
  });
  document.querySelectorAll("[data-timer-preset]").forEach((button) => {
    button.addEventListener("click", () => setTimerPreset(Number(button.dataset.timerPreset)));
  });
  document.querySelectorAll("[data-timer-custom]").forEach((button) => {
    button.addEventListener("click", () => {
      const custom = Number(prompt("Custom timer minutes:", state.timerPrefs.minutes));
      if (!Number.isNaN(custom) && custom > 0) setTimerPreset(custom);
    });
  });
  document.querySelectorAll("[data-timer-auto]").forEach((button) => {
    button.addEventListener("click", () => {
      state.timerPrefs.autoStart = !state.timerPrefs.autoStart;
      localStorage.setItem("ssp-timer-prefs", JSON.stringify(state.timerPrefs));
      showToast(state.timerPrefs.autoStart ? "Timer will auto-start." : "Timer auto-start off.", "info");
    });
  });

  ui.confirmAccept.addEventListener("click", () => resolveConfirm(true));
  ui.confirmCancel.addEventListener("click", () => resolveConfirm(false));
  ui.confirmDialog.addEventListener("click", (event) => {
    if (event.target === ui.confirmDialog) {
      resolveConfirm(false);
    }
  });
}

async function initializeApp() {
  const payload = await api("/api/bootstrap");
  state.data = payload;
  state.selectedNoteId = payload.notes[0]?.id ?? null;
  state.timerPrefs = loadTimerPrefs(payload.settings);
  state.tools.timer.total = state.timerPrefs.minutes * 60;
  state.tools.timer.remaining = state.tools.timer.total;
  state.tools.focus.total = (payload.settings.focus_minutes || 50) * 60;
  state.tools.focus.remaining = state.tools.focus.total;
  applyTheme(payload.settings);
  renderAll();
  window.setInterval(heartbeat, 1000);
}

async function api(url, options = {}) {
  const config = { headers: {}, ...options };
  if (options.body && !(options.body instanceof FormData)) {
    config.headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, config);
  if (!response.ok) {
    let message = "Something went wrong.";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch (error) {
      console.debug(error);
    }
    throw new Error(message);
  }
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

function loadTimerPrefs(settings) {
  const stored = localStorage.getItem("ssp-timer-prefs");
  if (stored) {
    try {
      return { ...settings, ...JSON.parse(stored) };
    } catch (error) {
      console.debug(error);
    }
  }
  return {
    minutes: settings.timer_default_minutes || settings.focus_minutes || 50,
    autoStart: false,
    sound: settings.alarm_sound || "glass",
  };
}

function applyTheme(settings) {
  state.data.settings = settings;
  const mode = settings.mode || localStorage.getItem("ssp-theme") || "light";
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.setProperty("--primary", settings.primary_color);
  document.documentElement.style.setProperty("--accent-1", settings.accent_color_1);
  document.documentElement.style.setProperty("--accent-2", settings.accent_color_2);
  document.documentElement.style.setProperty("--accent-3", settings.accent_color_3);
  localStorage.setItem("ssp-theme", mode);
}

function setActiveSection(sectionName) {
  state.activeSection = sectionName;
  ui.navItems.forEach((item) => item.classList.toggle("active", item.dataset.section === sectionName));
  Object.entries(ui.sections).forEach(([key, node]) => node.classList.toggle("active", key === sectionName));
  renderActiveSection();
}

function renderAll() {
  renderHero();
  renderQuote();
  renderAlarmPreview();
  renderTasksSection();
  renderPlannerSection();
  renderNotesSection();
  renderAnalyticsSection();
  renderSettingsSection();
  setActiveSection(state.activeSection);
}

function renderActiveSection() {
  if (state.activeSection === "tasks") renderTasksSection();
  if (state.activeSection === "planner") renderPlannerSection();
  if (state.activeSection === "notes") renderNotesSection();
  if (state.activeSection === "analytics") renderAnalyticsSection();
  if (state.activeSection === "settings") renderSettingsSection();
}

function renderHero() {
  const tasks = state.data.tasks.map(getLiveTask);
  const activeTasks = tasks.filter((task) => task.status === "in_progress");
  const completed = tasks.filter((task) => task.status === "completed").length;
  const overdue = tasks.filter((task) => task.status === "overdue").length;
  const totalGoal = state.data.daily_goal?.minutes || 0;
  const achieved = tasks.reduce((sum, task) => sum + task.daily_seconds, 0);

  ui.heroMetrics.innerHTML = [
    metricTile("Today Goal", formatCompactTime(totalGoal * 60), `${Math.round(achieved / 60)}m logged today`),
    metricTile("Live Tasks", String(activeTasks.length), "Persistent timers continue across reloads"),
    metricTile("Completed", String(completed), "Finished tasks in your workspace"),
    metricTile("Overdue", String(overdue), "Deadlines that need attention"),
  ].join("");
  animateNumbers(ui.heroMetrics);
}

function metricTile(label, value, detail) {
  return `
    <article class="metric-tile">
      <span class="eyebrow">${escapeHtml(label)}</span>
      <strong data-animate-number="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      <span>${escapeHtml(detail)}</span>
    </article>
  `;
}

function renderQuote() {
  const index = new Date().getDate() % Math.max(1, state.data.quotes.length);
  const quote = state.data.quotes[index] || { text: "Plan the next right step.", author: "Study Planner" };
  ui.quotePanel.innerHTML = `
    <span class="eyebrow">Motivational quote</span>
    <div>
      <h3>Stay in motion.</h3>
      <p class="quote-text">"${escapeHtml(quote.text)}"</p>
    </div>
    <strong>${escapeHtml(quote.author)}</strong>
  `;
}

function renderTasksSection() {
  const tasks = filteredTasks();
  ui.sections.tasks.innerHTML = `
    <div class="section-header">
      <div>
        <span class="eyebrow">Tasks module</span>
        <h2>Study tasks, subject color systems, and resilient timers.</h2>
      </div>
      <div class="task-actions">
        <button class="button button-secondary" id="add-subject-button" type="button">Add Subject</button>
        <button class="button button-primary" id="add-task-button" type="button">New Task</button>
      </div>
    </div>
    <div class="task-filter-bar">
      ${["today", "upcoming", "completed", "overdue"].map((filter) => `
        <button class="filter-chip ${state.taskFilter === filter ? "active" : ""}" type="button" data-task-filter="${filter}">
          ${titleCase(filter)}
        </button>
      `).join("")}
    </div>
    <div class="dashboard-grid">
      <div class="stack-grid">
        <article class="surface">
          <div class="mini-header">
            <strong>Task Queue</strong>
            <span>${tasks.length} visible</span>
          </div>
          <div class="task-list">
            ${tasks.length ? tasks.map(renderTaskCard).join("") : emptyState("No tasks yet", "Create a study task and the planner will track its focus time for you.")}
          </div>
        </article>
      </div>
      <div class="stack-grid">
        <article class="surface">
          <div class="mini-header">
            <strong>Subjects</strong>
            <span>${state.data.subjects.length}</span>
          </div>
          <div class="subject-row">
            ${
              state.data.subjects.length
                ? state.data.subjects.map(renderSubjectCard).join("")
                : emptyState("No subjects yet", "Create subjects with colors to organize tasks.")
            }
          </div>
        </article>
        <article class="surface goal-card">
          <div class="mini-header">
            <strong>Daily Goals</strong>
            <span>${state.data.daily_goal?.completed || 0}/${state.data.daily_goal?.target || 1}</span>
          </div>
          <p>${state.data.daily_goal?.minutes || 0} planned minutes across your active tasks.</p>
          <div class="progress-track">
            <div class="progress-fill" style="width:${goalPercent()}%"></div>
          </div>
        </article>
        <article class="surface">
          <div class="mini-header">
            <strong>Activity History</strong>
            <span>Recent</span>
          </div>
          <div class="history-list">
            ${state.data.history.length ? state.data.history.map(renderHistoryItem).join("") : emptyState("No activity yet", "Finished sessions and note updates will appear here.")}
          </div>
        </article>
        <article class="surface calendar-card">
          <div class="mini-header">
            <strong>Calendar View</strong>
            <span>${monthLabel()}</span>
          </div>
          <div class="calendar-grid">${renderMiniCalendar()}</div>
        </article>
      </div>
    </div>
  `;

  ui.sections.tasks.querySelector("#add-task-button").addEventListener("click", () => openTaskModal());
  ui.sections.tasks.querySelector("#add-subject-button").addEventListener("click", openSubjectModal);
  ui.sections.tasks.querySelectorAll("[data-task-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.taskFilter = button.dataset.taskFilter;
      renderTasksSection();
    });
  });
  ui.sections.tasks.querySelectorAll("[data-task-action]").forEach((button) => {
    button.addEventListener("click", () => handleTaskButton(button));
  });
  ui.sections.tasks.querySelectorAll("[data-subject-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const subject = state.data.subjects.find((item) => item.id === Number(button.dataset.subjectEdit));
      openSubjectModal(subject || null);
    });
  });
  ui.sections.tasks.querySelectorAll("[data-subject-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const subject = state.data.subjects.find((item) => item.id === Number(button.dataset.subjectDelete));
      if (!(await confirmAction("Delete subject", `Delete "${subject?.name}"? Tasks will move to General.`))) return;
      try {
        await api(`/api/subjects/${subject.id}`, { method: "DELETE" });
        state.data.subjects = state.data.subjects.filter((s) => s.id !== subject.id);
        state.data.tasks = state.data.tasks.map((task) => (task.subject?.id === subject.id ? { ...task, subject: null } : task));
        showToast("Subject deleted.", "success");
        renderTasksSection();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

function filteredTasks() {
  const search = state.search;
  return state.data.tasks
    .map(getLiveTask)
    .filter((task) => {
      const matchesFilter =
        state.taskFilter === "today"
          ? task.due_at?.startsWith(todayISO()) || ["pending", "in_progress", "paused"].includes(task.status)
          : state.taskFilter === "upcoming"
            ? (task.time_until_due_seconds ?? -1) > 0 && task.status !== "completed"
            : state.taskFilter === "completed"
              ? task.status === "completed"
              : task.status === "overdue";
      if (!matchesFilter) return false;
      if (!search) return true;
      const haystack = [task.title, task.description, task.subject?.name || ""].join(" ").toLowerCase();
      return haystack.includes(search);
    });
}

function renderTaskCard(task) {
  const statusClass = task.status.replace(/\s+/g, "_");
  return `
    <article class="task-card" data-task-id="${task.id}">
      <div class="task-head">
        <div>
          <div class="task-title-row">
            <strong>${escapeHtml(task.title)}</strong>
            <span class="status-pill ${statusClass}">${escapeHtml(task.status.replace("_", " "))}</span>
          </div>
          <p>${escapeHtml(task.description || "No description added yet.")}</p>
        </div>
        ${task.subject ? `<span class="subject-pill" style="${gradientStyle(task.subject.colors)}">${escapeHtml(task.subject.name)}</span>` : ""}
      </div>
      <div class="task-meta">
        <span>Due ${escapeHtml(dueLabel(task))}</span>
        <span data-live-remaining="${task.id}">${formatCompactTime(task.remaining_seconds)}</span>
      </div>
      <div>
        <div class="progress-track"><div class="progress-fill" data-progress-daily="${task.id}" style="width:${task.progress_percent}%"></div></div>
        <div class="task-meta">
          <span data-live-total="${task.id}">${formatCompactTime(task.total_elapsed_seconds)}</span>
          <span>${task.progress_percent}% of daily target</span>
        </div>
      </div>
      <div class="task-actions">
        ${task.is_active
          ? `<button class="button button-secondary" type="button" data-task-action="pause" data-task-id="${task.id}">Pause</button>
             <button class="button button-secondary" type="button" data-task-action="stop" data-task-id="${task.id}">Stop</button>`
          : `<button class="button button-primary" type="button" data-task-action="${task.status === "paused" || task.status === "stopped" ? "resume" : "start"}" data-task-id="${task.id}">
               ${task.status === "paused" || task.status === "stopped" ? "Resume" : "Start"}
             </button>`}
        <button class="button button-secondary" type="button" data-task-action="complete" data-task-id="${task.id}">Complete</button>
        <button class="button button-secondary" type="button" data-task-action="reset" data-task-id="${task.id}">Reset</button>
        <button class="button button-secondary" type="button" data-task-action="edit" data-task-id="${task.id}">Edit</button>
        <button class="button button-secondary" type="button" data-task-action="delete" data-task-id="${task.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderSubjectPill(subject) {
  return `<span class="subject-pill" style="${gradientStyle(subject.colors)}">${escapeHtml(subject.name)}</span>`;
}

function renderSubjectCard(subject) {
  return `
    <article class="task-card" data-subject-id="${subject.id}">
      <div class="task-head">
        <div class="task-title-row">
          <strong>${escapeHtml(subject.name)}</strong>
          <span class="status-pill pending">Subject</span>
        </div>
        <span class="subject-pill" style="${gradientStyle(subject.colors)}">${escapeHtml(subject.name)}</span>
      </div>
      <div class="task-actions">
        <button class="button button-secondary" type="button" data-subject-edit="${subject.id}">Edit</button>
        <button class="button button-secondary" type="button" data-subject-delete="${subject.id}">Delete</button>
      </div>
    </article>
  `;
}

function renderHistoryItem(item) {
  return `
    <article class="history-item">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
      <small>${escapeHtml(prettyDateTime(item.timestamp))}</small>
    </article>
  `;
}

function renderMiniCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const cells = [];
  for (let index = 0; index < offset; index += 1) {
    cells.push(`<div class="calendar-cell"></div>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dueCount = state.data.tasks.filter((task) => task.due_at?.startsWith(iso)).length;
    const isToday = day === now.getDate();
    cells.push(`
      <div class="calendar-cell ${isToday ? "today" : ""}">
        <strong>${day}</strong>
        ${dueCount ? `<small>${dueCount} due</small>` : `<small>Open</small>`}
      </div>
    `);
  }
  return cells.join("");
}

async function handleTaskButton(button) {
  const taskId = Number(button.dataset.taskId);
  const action = button.dataset.taskAction;
  const task = state.data.tasks.find((item) => item.id === taskId);
  if (!task) return;

  if (action === "edit") {
    openTaskModal(task);
    return;
  }

  if (action === "delete") {
    const confirmed = await confirmAction("Delete task", `Delete "${task.title}" permanently?`);
    if (!confirmed) return;
    try {
      await api(`/api/tasks/${taskId}`, { method: "DELETE" });
      state.data.tasks = state.data.tasks.filter((item) => item.id !== taskId);
      showToast("Task deleted.", "success");
      refreshAfterDataChange();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  try {
    const updated = await api(`/api/tasks/${taskId}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    upsertById(state.data.tasks, updated);
    state.data.focus_task = state.data.tasks.find((item) => item.status === "in_progress") || updated;
    const labels = {
      start: "Task started.",
      resume: "Task resumed.",
      pause: "Task paused.",
      stop: "Task stopped.",
      complete: "Task completed.",
      reset: "Task reset.",
    };
    showToast(labels[action] || "Task updated.", "success");
    refreshAfterDataChange();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openTaskModal(task = null) {
  const subjectOptions = state.data.subjects
    .map((subject) => `<option value="${subject.id}" ${task?.subject?.id === subject.id ? "selected" : ""}>${escapeHtml(subject.name)}</option>`)
    .join("");

  openModal({
    title: task ? "Edit task" : "Create task",
    content: `
      <form class="modal-form" id="task-form">
        <div class="modal-grid">
          <label class="field">
            <span>Title</span>
            <input name="title" value="${escapeAttribute(task?.title || "")}" required>
          </label>
          <label class="field">
            <span>Subject</span>
            <select name="subject_id">
              <option value="">General</option>
              ${subjectOptions}
            </select>
          </label>
          <label class="field">
            <span>Due Date & Time</span>
            <input type="datetime-local" name="due_at" value="${escapeAttribute(toDateTimeLocalValue(task?.due_at))}">
          </label>
          <label class="field">
            <span>Study Minutes / Day</span>
            <input type="number" min="5" step="5" name="study_minutes_per_day" value="${escapeAttribute(String(task?.study_minutes_per_day || 45))}" required>
          </label>
          <label class="field">
            <span>Estimated Minutes</span>
            <input type="number" min="5" step="5" name="estimated_minutes" value="${escapeAttribute(String(task?.estimated_minutes || 60))}" required>
          </label>
        </div>
        <label class="field">
          <span>Description</span>
          <textarea name="description" rows="4">${escapeHtml(task?.description || "")}</textarea>
        </label>
        <div class="task-actions">
          <button class="button button-secondary" type="button" data-close-modal="true">Cancel</button>
          <button class="button button-primary" type="submit">${task ? "Save Task" : "Create Task"}</button>
        </div>
      </form>
    `,
    onMount: (modal) => {
      modal.querySelector("[data-close-modal]").addEventListener("click", closeModal);
      modal.querySelector("#task-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const payload = {
          title: formData.get("title"),
          description: formData.get("description"),
          due_at: formData.get("due_at") || null,
          study_minutes_per_day: Number(formData.get("study_minutes_per_day")),
          estimated_minutes: Number(formData.get("estimated_minutes")),
          subject_id: formData.get("subject_id") ? Number(formData.get("subject_id")) : null,
        };
        try {
          const url = task ? `/api/tasks/${task.id}` : "/api/tasks";
          const method = task ? "PATCH" : "POST";
          const saved = await api(url, { method, body: JSON.stringify(payload) });
          upsertById(state.data.tasks, saved);
          closeModal();
          showToast(task ? "Task updated." : "Task created.", "success");
          refreshAfterDataChange();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    },
  });
}

function openSubjectModal(subject = null) {
  openModal({
    title: subject ? "Edit subject" : "Create subject",
    content: `
      <form class="modal-form" id="subject-form">
        <label class="field">
          <span>Subject Name</span>
          <input name="name" value="${escapeAttribute(subject?.name || "")}" placeholder="Biology" required>
        </label>
        <div class="modal-grid">
          <label class="field">
            <span>Primary Color</span>
            <input type="color" name="color_1" value="${escapeAttribute(subject?.colors?.[0] || "#6a8cff")}">
          </label>
          <label class="field">
            <span>Secondary Color</span>
            <input type="color" name="color_2" value="${escapeAttribute(subject?.colors?.[1] || "#7fe7ff")}">
          </label>
          <label class="field">
            <span>Tertiary Color</span>
            <input type="color" name="color_3" value="${escapeAttribute(subject?.colors?.[2] || "#ffc4a8")}">
          </label>
        </div>
        <div class="task-actions">
          <button class="button button-secondary" type="button" data-close-modal="true">Cancel</button>
          <button class="button button-primary" type="submit">${subject ? "Save Changes" : "Save Subject"}</button>
        </div>
      </form>
    `,
    onMount: (modal) => {
      modal.querySelector("[data-close-modal]").addEventListener("click", closeModal);
      modal.querySelector("#subject-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        try {
          const body = {
            name: formData.get("name"),
            colors: [formData.get("color_1"), formData.get("color_2"), formData.get("color_3")].filter(Boolean),
          };
          const subjectSaved = await api(subject ? `/api/subjects/${subject.id}` : "/api/subjects", {
            method: subject ? "PATCH" : "POST",
            body: JSON.stringify(body),
          });
          upsertById(state.data.subjects, subjectSaved);
          closeModal();
          showToast(subject ? "Subject updated." : "Subject added.", "success");
          renderTasksSection();
          renderNotesSection();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    },
  });
}

function renderPlannerSection() {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  ui.sections.planner.innerHTML = `
    <div class="section-header">
      <div>
        <span class="eyebrow">Weekly planner</span>
        <h2>Map study sessions, reminders, notes, and tasks across the week.</h2>
      </div>
      <div class="planner-actions">
        <button class="button button-primary" id="planner-add-general" type="button">Add Weekly Plan</button>
      </div>
    </div>
    <div class="planner-grid">
      ${days
        .map((day, index) => {
          const plans = filteredPlansForDay(index);
          return `
            <article class="day-column ${index === currentPlannerDay() ? "current-day" : ""}" data-day-column="${index}">
              <div class="planner-card-head">
                <strong>${day}</strong>
                <button class="icon-button" data-add-plan-day="${index}" type="button">+</button>
              </div>
              ${plans.length ? plans.map(renderPlannerCard).join("") : emptyState("Open day", "Add a study block, reminder, or note.", true)}
            </article>
          `;
        })
        .join("")}
    </div>
  `;

  ui.sections.planner.querySelector("#planner-add-general").addEventListener("click", () => openPlanModal());
  ui.sections.planner.querySelectorAll("[data-add-plan-day]").forEach((button) => {
    button.addEventListener("click", () => openPlanModal(Number(button.dataset.addPlanDay)));
  });
  ui.sections.planner.querySelectorAll("[data-plan-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = state.data.weekly_plans.find((item) => item.id === Number(button.dataset.planEdit));
      openPlanModal(plan?.day_of_week, plan);
    });
  });
  ui.sections.planner.querySelectorAll("[data-plan-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.planDelete);
      const plan = state.data.weekly_plans.find((item) => item.id === id);
      if (!(await confirmAction("Delete plan", `Delete "${plan?.title || "this plan"}"?`))) return;
      try {
        await api(`/api/weekly-plans/${id}`, { method: "DELETE" });
        state.data.weekly_plans = state.data.weekly_plans.filter((item) => item.id !== id);
        showToast("Plan deleted.", "success");
        renderPlannerSection();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
  bindPlannerDragAndDrop();
}

function filteredPlansForDay(dayIndex) {
  return state.data.weekly_plans
    .filter((plan) => plan.day_of_week === dayIndex)
    .filter((plan) => {
      if (!state.search) return true;
      return `${plan.title} ${plan.details}`.toLowerCase().includes(state.search);
    })
    .sort((a, b) => a.order_index - b.order_index);
}

function renderPlannerCard(plan) {
  return `
    <article class="planner-card" draggable="true" data-plan-id="${plan.id}" style="border-left: 4px solid ${escapeAttribute(plan.color)}">
      <div class="planner-card-head">
        <div>
          <strong>${escapeHtml(plan.title)}</strong>
          <span>${escapeHtml(plan.item_type)}${plan.scheduled_time ? ` • ${escapeHtml(plan.scheduled_time)}` : ""}</span>
        </div>
        <div class="planner-actions">
          <button class="icon-button" type="button" data-plan-edit="${plan.id}">Edit</button>
          <button class="icon-button" type="button" data-plan-delete="${plan.id}">Delete</button>
        </div>
      </div>
      <p>${escapeHtml(plan.details || "No extra notes.")}</p>
    </article>
  `;
}

function bindPlannerDragAndDrop() {
  ui.sections.planner.querySelectorAll("[data-plan-id]").forEach((card) => {
    card.addEventListener("dragstart", () => {
      state.dragPlanId = Number(card.dataset.planId);
    });
  });

  ui.sections.planner.querySelectorAll("[data-day-column]").forEach((column) => {
    column.addEventListener("dragover", (event) => event.preventDefault());
    column.addEventListener("drop", async () => {
      if (!state.dragPlanId) return;
      const targetDay = Number(column.dataset.dayColumn);
      const plan = state.data.weekly_plans.find((item) => item.id === state.dragPlanId);
      if (!plan) return;
      plan.day_of_week = targetDay;
      reorderPlansLocally();
      renderPlannerSection();
      try {
        await api("/api/weekly-plans/reorder", {
          method: "PATCH",
          body: JSON.stringify({
            items: state.data.weekly_plans.map((item) => ({
              id: item.id,
              day_of_week: item.day_of_week,
              order_index: item.order_index,
            })),
          }),
        });
      } catch (error) {
        showToast(error.message, "error");
      }
      state.dragPlanId = null;
    });
  });
}

function reorderPlansLocally() {
  const grouped = new Map();
  state.data.weekly_plans.forEach((plan) => {
    const group = grouped.get(plan.day_of_week) || [];
    group.push(plan);
    grouped.set(plan.day_of_week, group);
  });
  grouped.forEach((plans) => {
    plans.sort((a, b) => a.order_index - b.order_index || a.id - b.id);
    plans.forEach((plan, index) => {
      plan.order_index = index;
    });
  });
}

function openPlanModal(day = currentPlannerDay(), plan = null) {
  openModal({
    title: plan ? "Edit weekly plan" : "Add weekly plan",
    content: `
      <form class="modal-form" id="plan-form">
        <div class="modal-grid">
          <label class="field">
            <span>Title</span>
            <input name="title" value="${escapeAttribute(plan?.title || "")}" required>
          </label>
          <label class="field">
            <span>Type</span>
            <select name="item_type">
              ${["study", "reminder", "task", "note"]
                .map((type) => `<option value="${type}" ${plan?.item_type === type ? "selected" : ""}>${titleCase(type)}</option>`)
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Day</span>
            <select name="day_of_week">
              ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
                .map((label, index) => `<option value="${index}" ${Number(plan?.day_of_week ?? day) === index ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Time</span>
            <input type="time" name="scheduled_time" value="${escapeAttribute(plan?.scheduled_time || "")}">
          </label>
          <label class="field">
            <span>Color</span>
            <input type="color" name="color" value="${escapeAttribute(plan?.color || "#7fe7ff")}">
          </label>
        </div>
        <label class="field">
          <span>Details</span>
          <textarea name="details" rows="4">${escapeHtml(plan?.details || "")}</textarea>
        </label>
        <div class="planner-actions">
          <button class="button button-secondary" type="button" data-close-modal="true">Cancel</button>
          <button class="button button-primary" type="submit">${plan ? "Save Plan" : "Add Plan"}</button>
        </div>
      </form>
    `,
    onMount: (modal) => {
      modal.querySelector("[data-close-modal]").addEventListener("click", closeModal);
      modal.querySelector("#plan-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const payload = {
          title: formData.get("title"),
          item_type: formData.get("item_type"),
          day_of_week: Number(formData.get("day_of_week")),
          scheduled_time: formData.get("scheduled_time") || null,
          color: formData.get("color"),
          details: formData.get("details"),
        };
        try {
          const saved = await api(plan ? `/api/weekly-plans/${plan.id}` : "/api/weekly-plans", {
            method: plan ? "PATCH" : "POST",
            body: JSON.stringify(payload),
          });
          upsertById(state.data.weekly_plans, saved);
          closeModal();
          showToast(plan ? "Plan updated." : "Plan added.", "success");
          renderPlannerSection();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    },
  });
}

function renderNotesSection() {
  const notes = filteredNotes();
  if (!state.selectedNoteId && notes[0]) {
    state.selectedNoteId = notes[0].id;
  }
  const selected = state.data.notes.find((note) => note.id === state.selectedNoteId) || notes[0] || null;
  ui.sections.notes.innerHTML = `
    <div class="section-header">
      <div>
        <span class="eyebrow">Notes module</span>
        <h2>Subject-linked notes, autosave, tags, checklists, and favorites.</h2>
      </div>
      <div class="note-actions">
        <button class="button button-primary" id="new-note-button" type="button">New Note</button>
      </div>
    </div>
    <div class="note-layout-shell">
      <article class="surface">
        <div class="section-header">
          <strong>Note Library</strong>
          <span>${notes.length}</span>
        </div>
        <label class="field">
          <span>Search Notes</span>
          <input id="notes-search-input" value="${escapeAttribute(state.search)}" placeholder="Search titles, tags, content">
        </label>
        <div class="note-list">
          ${notes.length ? notes.map((note) => renderNoteCard(note, selected?.id)).join("") : emptyState("No notes yet", "Create general notes or keep them attached to a subject.")}
        </div>
      </article>
      <article class="surface note-editor">
        ${selected ? renderNoteEditor(selected) : emptyState("Select a note", "Your editor will appear here as soon as you create or choose a note.")}
      </article>
    </div>
  `;

  ui.sections.notes.querySelector("#new-note-button").addEventListener("click", () => openNoteModal());
  ui.sections.notes.querySelector("#notes-search-input").addEventListener(
    "input",
    debounce((event) => {
      state.search = event.target.value.trim().toLowerCase();
      renderNotesSection();
    }, 150),
  );
  ui.sections.notes.querySelectorAll("[data-note-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNoteId = Number(button.dataset.noteSelect);
      renderNotesSection();
    });
  });
  bindNoteEditorEvents(selected);
}

function filteredNotes() {
  return state.data.notes
    .filter((note) => {
      if (!state.search) return true;
      const tags = (note.tags || []).join(" ");
      return `${note.title} ${note.content} ${tags}`.toLowerCase().includes(state.search);
    })
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || Number(b.is_favorite) - Number(a.is_favorite) || b.updated_at.localeCompare(a.updated_at));
}

function renderNoteCard(note, selectedId) {
  return `
    <button class="note-card ${selectedId === note.id ? "active" : ""}" type="button" data-note-select="${note.id}">
      <div class="note-head">
        <strong>${escapeHtml(note.title)}</strong>
        <span>${note.is_pinned ? "Pinned" : note.is_favorite ? "Favorite" : "Note"}</span>
      </div>
      <p>${escapeHtml((note.content || "").slice(0, 90) || "Empty note")}</p>
      <div class="tag-row">${(note.tags || []).map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join("")}</div>
      <small>${escapeHtml(prettyDateTime(note.updated_at))}</small>
    </button>
  `;
}

function renderNoteEditor(note) {
  return `
    <div class="section-header">
      <div>
        <strong>Editor</strong>
        <span>Autosaves after you pause typing</span>
      </div>
      <div class="note-actions">
        <button class="button button-secondary" type="button" data-note-toggle-pin="${note.id}">${note.is_pinned ? "Unpin" : "Pin"}</button>
        <button class="button button-secondary" type="button" data-note-toggle-favorite="${note.id}">${note.is_favorite ? "Unfavorite" : "Favorite"}</button>
        <button class="button button-secondary" type="button" data-note-delete="${note.id}">Delete</button>
      </div>
    </div>
    <label class="field">
      <span>Title</span>
      <input id="note-title-input" value="${escapeAttribute(note.title)}">
    </label>
    <div class="modal-grid">
      <label class="field">
        <span>Subject</span>
        <select id="note-subject-select">
          <option value="">General</option>
          ${state.data.subjects.map((subject) => `<option value="${subject.id}" ${note.subject_id === subject.id ? "selected" : ""}>${escapeHtml(subject.name)}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span>Tags</span>
        <input id="note-tags-input" value="${escapeAttribute((note.tags || []).join(", "))}" placeholder="revision, formulas, exam">
      </label>
    </div>
    <label class="field">
      <span>Note Content</span>
      <textarea id="note-content-input" rows="10" placeholder="Use bullet lists, ideas, quick summaries, and reflections.">${escapeHtml(note.content || "")}</textarea>
    </label>
    <div class="section-header">
      <strong>Checklist</strong>
      <button class="button button-secondary" id="add-todo-item" type="button">Add To-do</button>
    </div>
    <div class="todo-list" id="todo-list">
      ${(note.todo_items || []).map(renderTodoItem).join("") || "<span>No to-do items yet.</span>"}
    </div>
    <small>Last updated ${escapeHtml(prettyDateTime(note.updated_at))}</small>
  `;
}

function renderTodoItem(item, index = 0) {
  return `
    <label class="todo-item" data-todo-index="${index}">
      <input type="checkbox" ${item.done ? "checked" : ""}>
      <input type="text" value="${escapeAttribute(item.text || "")}" placeholder="Add checklist item">
      <button class="icon-button" type="button" data-remove-todo="${index}">Remove</button>
    </label>
  `;
}

function bindNoteEditorEvents(selected) {
  if (!selected) return;
  const editor = ui.sections.notes;
  editor.querySelector("[data-note-toggle-pin]").addEventListener("click", async () => {
    selected.is_pinned = !selected.is_pinned;
    await saveSelectedNote();
  });
  editor.querySelector("[data-note-toggle-favorite]").addEventListener("click", async () => {
    selected.is_favorite = !selected.is_favorite;
    await saveSelectedNote();
  });
  editor.querySelector("[data-note-delete]").addEventListener("click", async () => {
    if (!(await confirmAction("Delete note", `Delete "${selected.title}"?`))) return;
    try {
      await api(`/api/notes/${selected.id}`, { method: "DELETE" });
      state.data.notes = state.data.notes.filter((note) => note.id !== selected.id);
      state.selectedNoteId = state.data.notes[0]?.id ?? null;
      showToast("Note deleted.", "success");
      renderNotesSection();
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  ["note-title-input", "note-subject-select", "note-tags-input", "note-content-input"].forEach((id) => {
    editor.querySelector(`#${id}`).addEventListener("input", scheduleNoteAutosave);
  });

  editor.querySelector("#add-todo-item").addEventListener("click", () => {
    const note = currentSelectedNote();
    note.todo_items = [...(note.todo_items || []), { text: "", done: false }];
    renderNotesSection();
  });

  editor.querySelectorAll("[data-remove-todo]").forEach((button) => {
    button.addEventListener("click", () => {
      const note = currentSelectedNote();
      note.todo_items = (note.todo_items || []).filter((_, index) => index !== Number(button.dataset.removeTodo));
      renderNotesSection();
      scheduleNoteAutosave();
    });
  });

  editor.querySelectorAll("#todo-list .todo-item").forEach((row, index) => {
    row.querySelector('input[type="checkbox"]').addEventListener("change", scheduleNoteAutosave);
    row.querySelector('input[type="text"]').addEventListener("input", scheduleNoteAutosave);
    row.dataset.todoIndex = String(index);
  });
}

function scheduleNoteAutosave() {
  clearTimeout(state.autoSaveHandle);
  state.autoSaveHandle = window.setTimeout(() => {
    saveSelectedNote().catch((error) => showToast(error.message, "error"));
  }, 600);
}

async function saveSelectedNote() {
  const note = currentSelectedNote();
  if (!note) return;
  const editor = ui.sections.notes;
  const todoItems = Array.from(editor.querySelectorAll("#todo-list .todo-item")).map((row) => ({
    done: row.querySelector('input[type="checkbox"]').checked,
    text: row.querySelector('input[type="text"]').value,
  }));
  const payload = {
    title: editor.querySelector("#note-title-input").value || "Untitled note",
    subject_id: editor.querySelector("#note-subject-select").value ? Number(editor.querySelector("#note-subject-select").value) : null,
    tags: editor.querySelector("#note-tags-input").value.split(",").map((tag) => tag.trim()).filter(Boolean),
    content: editor.querySelector("#note-content-input").value,
    todo_items: todoItems,
    is_pinned: note.is_pinned,
    is_favorite: note.is_favorite,
    is_general: !editor.querySelector("#note-subject-select").value,
  };
  const saved = await api(`/api/notes/${note.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  upsertById(state.data.notes, saved);
  state.selectedNoteId = saved.id;
  renderNotesSection();
  showToast("Note autosaved.", "info");
}

function currentSelectedNote() {
  return state.data.notes.find((note) => note.id === state.selectedNoteId);
}

function openNoteModal() {
  openModal({
    title: "Create note",
    content: `
      <form class="modal-form" id="note-create-form">
        <label class="field">
          <span>Title</span>
          <input name="title" placeholder="Chapter summary" required>
        </label>
        <div class="modal-grid">
          <label class="field">
            <span>Subject</span>
            <select name="subject_id">
              <option value="">General</option>
              ${state.data.subjects.map((subject) => `<option value="${subject.id}">${escapeHtml(subject.name)}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>Tags</span>
            <input name="tags" placeholder="exam, formulas">
          </label>
        </div>
        <label class="field">
          <span>Content</span>
          <textarea name="content" rows="5" placeholder="Start with key ideas, bullets, and checklists."></textarea>
        </label>
        <div class="note-actions">
          <button class="button button-secondary" type="button" data-close-modal="true">Cancel</button>
          <button class="button button-primary" type="submit">Create Note</button>
        </div>
      </form>
    `,
    onMount: (modal) => {
      modal.querySelector("[data-close-modal]").addEventListener("click", closeModal);
      modal.querySelector("#note-create-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        try {
          const saved = await api("/api/notes", {
            method: "POST",
            body: JSON.stringify({
              title: formData.get("title"),
              subject_id: formData.get("subject_id") ? Number(formData.get("subject_id")) : null,
              content: formData.get("content"),
              tags: String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
              todo_items: [],
              is_general: !formData.get("subject_id"),
            }),
          });
          state.data.notes.unshift(saved);
          state.selectedNoteId = saved.id;
          closeModal();
          showToast("Note created.", "success");
          renderNotesSection();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    },
  });
}

function renderAnalyticsSection() {
  const analytics = state.data.analytics || {
    range: "week",
    total_study_time: 0,
    completed_tasks: 0,
    missed_tasks: 0,
    streak_days: 0,
    subject_distribution: [],
    daily_productivity: [],
  };
  ui.sections.analytics.innerHTML = `
    <div class="section-header">
      <div>
        <span class="eyebrow">Analytics module</span>
        <h2>Live study totals, animated trends, streaks, and subject distribution.</h2>
      </div>
      <div class="task-filter-bar">
        ${["today", "week", "month", "year"]
          .map((range) => `<button class="filter-chip ${analytics.range === range ? "active" : ""}" type="button" data-analytics-range="${range}">${titleCase(range)}</button>`)
          .join("")}
      </div>
    </div>
    <div class="summary-grid">
      ${analyticsCard("Total Study", formatCompactTime(analytics.total_study_time), "Time logged in the selected range")}
      ${analyticsCard("Completed Tasks", String(analytics.completed_tasks), "Finished work across the period")}
      ${analyticsCard("Missed Tasks", String(analytics.missed_tasks), "Past-due tasks left unfinished")}
      ${analyticsCard("Streak", `${analytics.streak_days} days`, "Consecutive study days with logged time")}
    </div>
    <div class="analytics-layout">
      <article class="chart-shell">
        <div class="section-header">
          <strong>Daily Productivity Trend</strong>
          <span>${titleCase(analytics.range)}</span>
        </div>
        ${renderLineChart(analytics.daily_productivity)}
      </article>
      <article class="chart-shell">
        <div class="section-header">
          <strong>Subject Distribution</strong>
          <span>Study breakdown</span>
        </div>
        <div class="bar-list">
          ${analytics.subject_distribution.length ? analytics.subject_distribution.map(renderBarRow).join("") : emptyState("No study data yet", "Start and finish a task session to populate charts.", true)}
        </div>
      </article>
    </div>
  `;

  ui.sections.analytics.querySelectorAll("[data-analytics-range]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        state.data.analytics = await api(`/api/analytics?range=${button.dataset.analyticsRange}`);
        renderAnalyticsSection();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
  animateNumbers(ui.sections.analytics);
}

function analyticsCard(label, value, detail) {
  return `
    <article class="analytics-card">
      <span class="eyebrow">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(detail)}</span>
    </article>
  `;
}

function animateNumbers(scope) {
  const nodes = (scope || document).querySelectorAll("[data-animate-number]");
  nodes.forEach((node) => {
    const target = Number(node.dataset.animateNumber) || 0;
    const start = 0;
    const duration = 480;
    const startTs = performance.now();
    const step = (ts) => {
      const progress = Math.min(1, (ts - startTs) / duration);
      const value = Math.round(start + (target - start) * progress);
      node.textContent = isNaN(target) ? node.dataset.animateNumber : value;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function renderBarRow(row) {
  const max = Math.max(...state.data.analytics.subject_distribution.map((item) => item.value), 1);
  const width = (row.value / max) * 100;
  return `
    <div class="bar-row">
      <span>${escapeHtml(row.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
      <strong>${Math.round(row.value / 60)}m</strong>
    </div>
  `;
}

function renderLineChart(points) {
  if (!points.length) {
    return emptyState("No trend yet", "The chart will animate once sessions are logged.", true);
  }
  const width = 700;
  const height = 240;
  const padding = 24;
  const max = Math.max(...points.map((point) => point.value), 1);
  const coordinates = points.map((point, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
    const y = height - padding - (point.value / max) * (height - padding * 2);
    return { x, y, label: point.label };
  });
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  return `
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="var(--primary)"></stop>
          <stop offset="100%" stop-color="var(--accent-1)"></stop>
        </linearGradient>
      </defs>
      <polyline fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" points="${polyline}"></polyline>
      <polyline fill="none" stroke="url(#line-gradient)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" points="${polyline}"></polyline>
      ${coordinates
        .map(
          (point) => `
            <circle cx="${point.x}" cy="${point.y}" r="6" fill="white"></circle>
            <circle cx="${point.x}" cy="${point.y}" r="4" fill="var(--primary)"></circle>
            <text x="${point.x}" y="${height - 6}" text-anchor="middle" fill="var(--muted)" font-size="12">${escapeHtml(point.label)}</text>
          `,
        )
        .join("")}
    </svg>
  `;
}

function renderSettingsSection() {
  const settings = state.data.settings;
  ui.sections.settings.innerHTML = `
    <div class="section-header">
      <div>
        <span class="eyebrow">Settings module</span>
        <h2>Theme tuning, reminders, focus timing, sounds, and interface style.</h2>
      </div>
    </div>
    <form class="settings-layout" id="settings-form">
      <div class="settings-grid">
        <article class="surface">
          <div class="mini-header">
            <strong>Theme Customization</strong>
            <span>Liquid glass</span>
          </div>
          <div class="stack-grid">
            <label class="field">
              <span>Mode</span>
              <select name="mode">
                <option value="light" ${settings.mode === "light" ? "selected" : ""}>Light</option>
                <option value="dark" ${settings.mode === "dark" ? "selected" : ""}>Dark</option>
              </select>
            </label>
            <div class="chip-row">
              ${colorInput("primary_color", "Primary", settings.primary_color)}
              ${colorInput("accent_color_1", "Accent A", settings.accent_color_1)}
              ${colorInput("accent_color_2", "Accent B", settings.accent_color_2)}
              ${colorInput("accent_color_3", "Accent C", settings.accent_color_3)}
            </div>
            <label class="field">
              <span>Background Style</span>
              <select name="background_style">
                ${["aurora", "mist", "studio"].map((value) => `<option value="${value}" ${settings.background_style === value ? "selected" : ""}>${titleCase(value)}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>Card Style</span>
              <select name="card_style">
                ${["liquid", "soft-glow", "gloss"].map((value) => `<option value="${value}" ${settings.card_style === value ? "selected" : ""}>${titleCase(value)}</option>`).join("")}
              </select>
            </label>
          </div>
        </article>
        <article class="surface">
          <div class="mini-header">
            <strong>Study & Notifications</strong>
            <span>Persistent support</span>
          </div>
          <div class="stack-grid">
            <label class="field">
              <span>Focus Minutes</span>
              <input type="number" min="5" step="5" name="focus_minutes" value="${escapeAttribute(String(settings.focus_minutes))}">
            </label>
            <label class="field">
              <span>Break Minutes</span>
              <input type="number" min="1" step="1" name="break_minutes" value="${escapeAttribute(String(settings.break_minutes))}">
            </label>
            <label class="field">
              <span>Reminder Lead Time</span>
              <input type="number" min="1" step="1" name="reminder_minutes" value="${escapeAttribute(String(settings.reminder_minutes))}">
            </label>
            <label class="field">
              <span>Alarm Sound</span>
              <select name="alarm_sound">
                ${["glass", "chime", "pulse"].map((value) => `<option value="${value}" ${settings.alarm_sound === value ? "selected" : ""}>${titleCase(value)}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>Notifications</span>
              <select name="notifications_enabled">
                <option value="true" ${settings.notifications_enabled ? "selected" : ""}>Enabled</option>
                <option value="false" ${!settings.notifications_enabled ? "selected" : ""}>Disabled</option>
              </select>
            </label>
          </div>
        </article>
      </div>
      <div class="task-actions">
        <button class="button button-primary" type="submit">Save Settings</button>
      </div>
    </form>
  `;

  const form = ui.sections.settings.querySelector("#settings-form");
  form.addEventListener("input", () => {
    const formData = new FormData(form);
    applyTheme({
      ...state.data.settings,
      mode: formData.get("mode"),
      primary_color: formData.get("primary_color"),
      accent_color_1: formData.get("accent_color_1"),
      accent_color_2: formData.get("accent_color_2"),
      accent_color_3: formData.get("accent_color_3"),
    });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const saved = await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          mode: formData.get("mode"),
          primary_color: formData.get("primary_color"),
          accent_color_1: formData.get("accent_color_1"),
          accent_color_2: formData.get("accent_color_2"),
          accent_color_3: formData.get("accent_color_3"),
          background_style: formData.get("background_style"),
          card_style: formData.get("card_style"),
          focus_minutes: Number(formData.get("focus_minutes")),
          break_minutes: Number(formData.get("break_minutes")),
          reminder_minutes: Number(formData.get("reminder_minutes")),
          alarm_sound: formData.get("alarm_sound"),
          notifications_enabled: formData.get("notifications_enabled") === "true",
        }),
      });
      applyTheme(saved);
      state.tools.timer.total = saved.focus_minutes * 60;
      state.tools.focus.total = saved.focus_minutes * 60;
      showToast("Settings saved.", "success");
      renderSettingsSection();
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function colorInput(name, label, value) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input type="color" name="${name}" value="${escapeAttribute(value)}">
    </label>
  `;
}

function renderAlarmPreview() {
  ui.alarmPreviewList.innerHTML = state.data.alarms.length
    ? state.data.alarms
        .slice(0, 5)
        .map(
          (alarm) => `
            <div class="alarm-item">
              <div>
                <strong>${escapeHtml(alarm.label)}</strong>
                <div>${escapeHtml(alarm.alarm_time)} ${alarm.repeat_days?.length ? `• ${escapeHtml(alarm.repeat_days.join(", "))}` : "• One-time"}</div>
              </div>
              <div class="planner-actions">
                <button class="icon-button" type="button" data-alarm-edit="${alarm.id}">Edit</button>
                <button class="icon-button" type="button" data-alarm-toggle="${alarm.id}">${alarm.is_enabled ? "On" : "Off"}</button>
                <button class="icon-button" type="button" data-alarm-delete="${alarm.id}">Del</button>
              </div>
            </div>
          `,
        )
        .join("")
    : emptyState("No alarms set", "Add elegant study alarms with repeat options.", true);

  ui.alarmPreviewList.querySelectorAll("[data-alarm-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const alarm = state.data.alarms.find((item) => item.id === Number(button.dataset.alarmEdit));
      openAlarmModal(alarm);
    });
  });
  ui.alarmPreviewList.querySelectorAll("[data-alarm-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const alarm = state.data.alarms.find((item) => item.id === Number(button.dataset.alarmToggle));
      if (!alarm) return;
      try {
        const saved = await api(`/api/alarms/${alarm.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...alarm, is_enabled: !alarm.is_enabled }),
        });
        upsertById(state.data.alarms, saved);
        renderAlarmPreview();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
  ui.alarmPreviewList.querySelectorAll("[data-alarm-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.alarmDelete);
      const alarm = state.data.alarms.find((item) => item.id === id);
      if (!(await confirmAction("Delete alarm", `Delete "${alarm?.label || "this alarm"}"?`))) return;
      try {
        await api(`/api/alarms/${id}`, { method: "DELETE" });
        state.data.alarms = state.data.alarms.filter((item) => item.id !== id);
        renderAlarmPreview();
        showToast("Alarm deleted.", "success");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

function openAlarmModal(alarm = null) {
  const repeatDays = alarm?.repeat_days || [];
  openModal({
    title: alarm ? "Edit alarm" : "Create alarm",
    content: `
      <form class="modal-form" id="alarm-form">
        <div class="modal-grid">
          <label class="field">
            <span>Label</span>
            <input name="label" value="${escapeAttribute(alarm?.label || "Study alarm")}" required>
          </label>
          <label class="field">
            <span>Time</span>
            <input type="time" name="alarm_time" value="${escapeAttribute(alarm?.alarm_time || "07:00")}" required>
          </label>
          <label class="field">
            <span>Sound</span>
            <select name="sound">
              ${["glass", "chime", "pulse"].map((sound) => `<option value="${sound}" ${alarm?.sound === sound ? "selected" : ""}>${titleCase(sound)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="field">
          <span>Repeat Days</span>
          <div class="chip-row">
            ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
              .map(
                (day) => `
                  <label class="chip">
                    <input type="checkbox" name="repeat_days" value="${day}" ${repeatDays.includes(day) ? "checked" : ""}>
                    <span>${day}</span>
                  </label>
                `,
              )
              .join("")}
          </div>
        </div>
        <div class="field">
          <span>Enabled</span>
          <select name="is_enabled">
            <option value="true" ${alarm?.is_enabled !== false ? "selected" : ""}>Enabled</option>
            <option value="false" ${alarm?.is_enabled === false ? "selected" : ""}>Disabled</option>
          </select>
        </div>
        <div class="planner-actions">
          <button class="button button-secondary" type="button" data-close-modal="true">Cancel</button>
          <button class="button button-primary" type="submit">${alarm ? "Save Alarm" : "Add Alarm"}</button>
        </div>
      </form>
    `,
    onMount: (modal) => {
      modal.querySelector("[data-close-modal]").addEventListener("click", closeModal);
      modal.querySelector("#alarm-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const payload = {
          label: formData.get("label"),
          alarm_time: formData.get("alarm_time"),
          sound: formData.get("sound"),
          repeat_days: formData.getAll("repeat_days"),
          is_enabled: formData.get("is_enabled") === "true",
        };
        try {
          const saved = await api(alarm ? `/api/alarms/${alarm.id}` : "/api/alarms", {
            method: alarm ? "PATCH" : "POST",
            body: JSON.stringify(payload),
          });
          upsertById(state.data.alarms, saved);
          closeModal();
          renderAlarmPreview();
          showToast(alarm ? "Alarm updated." : "Alarm added.", "success");
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    },
  });
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  try {
    state.data = await api("/api/import", { method: "POST", body: formData });
    state.selectedNoteId = state.data.notes[0]?.id ?? null;
    applyTheme(state.data.settings);
    renderAll();
    showToast("Data imported.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    event.target.value = "";
  }
}

async function toggleTheme() {
  const nextMode = state.data.settings.mode === "light" ? "dark" : "light";
  try {
    const saved = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ mode: nextMode }),
    });
    applyTheme(saved);
    renderSettingsSection();
    renderActiveSection();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function handleToolAction(action) {
  if (action === "timer-start") {
    if (!state.tools.timer.remaining) {
      state.tools.timer.remaining = state.tools.timer.total;
    }
    state.tools.timer.running = true;
    state.tools.timer.lastTick = Date.now();
  }
  if (action === "timer-pause") {
    state.tools.timer.running = false;
  }
  if (action === "timer-reset") {
    state.tools.timer.running = false;
    state.tools.timer.total = (state.data.settings.focus_minutes || 50) * 60;
    state.tools.timer.remaining = state.tools.timer.total;
  }
  if (action === "stopwatch-start") {
    state.tools.stopwatch.running = !state.tools.stopwatch.running;
    state.tools.stopwatch.lastTick = Date.now();
  }
  if (action === "stopwatch-reset") {
    state.tools.stopwatch = { elapsed: 0, running: false, lastTick: null, laps: [] };
  }
  if (action === "stopwatch-lap" && state.tools.stopwatch.running) {
    state.tools.stopwatch.laps.unshift(formatClock(state.tools.stopwatch.elapsed, true));
  }
  renderToolDisplays();
}

function setTimerPreset(minutes) {
  state.timerPrefs.minutes = minutes;
  localStorage.setItem("ssp-timer-prefs", JSON.stringify(state.timerPrefs));
  state.tools.timer.total = minutes * 60;
  state.tools.timer.remaining = state.tools.timer.total;
  if (state.timerPrefs.autoStart) {
    state.tools.timer.running = true;
    state.tools.timer.lastTick = Date.now();
  } else {
    state.tools.timer.running = false;
  }
  renderToolDisplays();
  showToast(`Timer set to ${minutes} minutes.`, "info");
}

async function startFocusMode() {
  const focusTask =
    state.data.tasks.map(getLiveTask).find((task) => task.status === "in_progress") ||
    state.data.tasks.map(getLiveTask).find((task) => task.status !== "completed");
  ui.focusOverlay.classList.remove("hidden");
  state.tools.focus.onBreak = false;
  state.tools.focus.running = true;
  state.tools.focus.total = (state.data.settings.focus_minutes || 50) * 60;
  state.tools.focus.remaining = state.tools.focus.total;
  state.tools.focus.lastTick = Date.now();
  ui.focusTaskLabel.textContent = focusTask
    ? `Locked into ${focusTask.title}`
    : "No active task selected. Use the timer for a clean focus session.";
  if (focusTask && !focusTask.is_active) {
    try {
      const updated = await api(`/api/tasks/${focusTask.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      });
      upsertById(state.data.tasks, updated);
      refreshAfterDataChange();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
  showToast("Focus mode started.", "info");
}

function toggleFocusBreak() {
  state.tools.focus.onBreak = !state.tools.focus.onBreak;
  state.tools.focus.total = (state.tools.focus.onBreak ? state.data.settings.break_minutes : state.data.settings.focus_minutes) * 60;
  state.tools.focus.remaining = state.tools.focus.total;
  state.tools.focus.running = true;
  state.tools.focus.lastTick = Date.now();
}

function stopFocusMode() {
  ui.focusOverlay.classList.add("hidden");
  state.tools.focus.running = false;
  state.tools.focus.remaining = state.tools.focus.total;
}

function heartbeat() {
  tickCountdown(state.tools.timer);
  tickStopwatch(state.tools.stopwatch);
  tickCountdown(state.tools.focus);
  renderToolDisplays();
  updateAnalogClock();
  syncLiveTaskCards();

  if (!ui.focusOverlay.classList.contains("hidden")) {
    ui.focusCountdown.textContent = formatClock(state.tools.focus.remaining);
  }

  const minuteStamp = new Date().toISOString().slice(0, 16);
  if (state.minuteStamp !== minuteStamp) {
    state.minuteStamp = minuteStamp;
    maybeTriggerAlarms();
    maybeTriggerTaskReminders();
  }
}

function tickCountdown(tool) {
  if (!tool.running) return;
  const now = Date.now();
  const delta = Math.max(0, Math.round((now - (tool.lastTick || now)) / 1000));
  tool.lastTick = now;
  tool.remaining = Math.max(0, tool.remaining - delta);
  if (tool.remaining === 0) {
    tool.running = false;
    showToast("Timer finished.", "info");
    playTone();
  }
}

function tickStopwatch(tool) {
  if (!tool.running) return;
  const now = Date.now();
  const delta = Math.max(0, Math.round((now - (tool.lastTick || now)) / 1000));
  tool.lastTick = now;
  tool.elapsed += delta;
}

function renderToolDisplays() {
  const timerDisplay = document.querySelector('[data-tool-display="timer"]');
  const stopwatchDisplay = document.querySelector('[data-tool-display="stopwatch"]');
  if (timerDisplay) timerDisplay.textContent = formatClock(state.tools.timer.remaining);
  if (stopwatchDisplay) stopwatchDisplay.textContent = formatClock(state.tools.stopwatch.elapsed, true);
  const laps = document.getElementById("stopwatch-laps");
  if (laps) {
    laps.innerHTML = state.tools.stopwatch.laps
      .slice(0, 4)
      .map((lap, index) => `<div class="lap-item"><span>Lap ${index + 1}</span><strong>${lap}</strong></div>`)
      .join("");
  }
}

function syncLiveTaskCards() {
  state.data.tasks.map(getLiveTask).forEach((task) => {
    const total = document.querySelector(`[data-live-total="${task.id}"]`);
    const remaining = document.querySelector(`[data-live-remaining="${task.id}"]`);
    const progress = document.querySelector(`[data-progress-daily="${task.id}"]`);
    if (total) total.textContent = formatCompactTime(task.total_elapsed_seconds);
    if (remaining) remaining.textContent = formatCompactTime(task.remaining_seconds);
    if (progress) progress.style.width = `${task.progress_percent}%`;
  });
  renderHero();
}

function updateAnalogClock() {
  const now = new Date();
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = now.getHours() % 12 + minutes / 60;
  const set = (id, deg) => {
    const node = document.getElementById(id);
    if (node) node.style.transform = `translate(-50%, -100%) rotate(${deg}deg)`;
  };
  set("clock-second", seconds * 6);
  set("clock-minute", minutes * 6);
  set("clock-hour", hours * 30);
  const digital = document.getElementById("clock-digital");
  if (digital) {
    digital.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

function maybeTriggerAlarms() {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];
  state.data.alarms.forEach((alarm) => {
    const key = `${alarm.id}-${today}-${currentTime}`;
    const repeatsToday = !alarm.repeat_days?.length || alarm.repeat_days.includes(today);
    if (alarm.is_enabled && repeatsToday && alarm.alarm_time === currentTime && !state.alarmCache.has(key)) {
      state.alarmCache.add(key);
      showToast(`${alarm.label} is ringing.`, "info");
      sendBrowserNotification(alarm.label, `Alarm for ${currentTime}`);
      playTone();
    }
  });
}

function maybeTriggerTaskReminders() {
  if (!state.data.settings.notifications_enabled) return;
  const leadMinutes = state.data.settings.reminder_minutes || 15;
  state.data.tasks.map(getLiveTask).forEach((task) => {
    if (!task.due_at || task.status === "completed") return;
    const dueSeconds = task.time_until_due_seconds;
    if (dueSeconds <= 0 || dueSeconds > leadMinutes * 60) return;
    const key = `${task.id}-${task.due_at}`;
    if (state.reminderCache.has(key)) return;
    state.reminderCache.add(key);
    showToast(`${task.title} is due ${dueLabel(task)}.`, "info");
    sendBrowserNotification("Study reminder", `${task.title} is due ${dueLabel(task)}.`);
  });
}

function sendBrowserNotification(title, body) {
  if (!("Notification" in window) || !state.data.settings.notifications_enabled) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
    return;
  }
  if (Notification.permission === "default") {
    Notification.requestPermission()
      .then((permission) => {
        if (permission === "granted") {
          new Notification(title, { body });
        }
      })
      .catch(() => {});
  }
}

function playTone() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = "sine";
    oscillator.frequency.value = 720;
    gain.gain.setValueAtTime(0.04, context.currentTime);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  } catch (error) {
    console.debug(error);
  }
}

async function refreshAfterDataChange() {
  try {
    const payload = await api("/api/bootstrap");
    state.data = payload;
    if (!state.data.notes.find((note) => note.id === state.selectedNoteId)) {
      state.selectedNoteId = state.data.notes[0]?.id ?? null;
    }
    applyTheme(payload.settings);
    renderAll();
  } catch (error) {
    console.error(error);
  }
}

function getLiveTask(task) {
  const cloned = { ...task };
  if (cloned.is_active && cloned.current_session_started_at) {
    const startedAt = new Date(cloned.current_session_started_at);
    if (!Number.isNaN(startedAt.valueOf())) {
      const now = new Date();
      const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const dailyElapsed = Math.max(0, Math.floor((now - new Date(Math.max(startedAt.valueOf(), todayStart.valueOf()))) / 1000));
      cloned.total_elapsed_seconds += elapsed;
      cloned.daily_seconds += dailyElapsed;
      cloned.remaining_seconds = Math.max(0, cloned.remaining_seconds - elapsed);
      cloned.progress_percent = Math.min(100, Math.round((cloned.daily_seconds / Math.max(1, cloned.study_minutes_per_day * 60)) * 100));
    }
  }
  const dueAt = task.due_at ? new Date(task.due_at) : null;
  if (dueAt && !Number.isNaN(dueAt.valueOf())) {
    cloned.time_until_due_seconds = Math.floor((dueAt - new Date()) / 1000);
    if (cloned.status !== "completed" && cloned.time_until_due_seconds < 0) {
      cloned.status = "overdue";
    }
  }
  return cloned;
}

function openModal({ title, content, onMount }) {
  ui.modalBackdrop.classList.remove("hidden");
  ui.modalBackdrop.innerHTML = `
    <div class="modal-card glass-card">
      <div class="composer-header">
        <div>
          <span class="eyebrow">Composer</span>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <button class="icon-button" type="button" id="close-modal-button">Close</button>
      </div>
      ${content}
    </div>
  `;
  ui.modalBackdrop.addEventListener("click", handleBackdropClose);
  ui.modalBackdrop.querySelector("#close-modal-button").addEventListener("click", closeModal);
  if (onMount) onMount(ui.modalBackdrop);
}

function handleBackdropClose(event) {
  if (event.target === ui.modalBackdrop) {
    closeModal();
  }
}

function closeModal() {
  ui.modalBackdrop.classList.add("hidden");
  ui.modalBackdrop.innerHTML = "";
  ui.modalBackdrop.removeEventListener("click", handleBackdropClose);
}

function showToast(message, tone = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  ui.toastContainer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

function confirmAction(title, message) {
  ui.confirmTitle.textContent = title;
  ui.confirmMessage.textContent = message;
  ui.confirmDialog.classList.remove("hidden");
  return new Promise((resolve) => {
    state.confirmResolver = resolve;
  });
}

function resolveConfirm(result) {
  ui.confirmDialog.classList.add("hidden");
  if (state.confirmResolver) {
    state.confirmResolver(result);
    state.confirmResolver = null;
  }
}

function emptyState(title, description, compact = false) {
  return `
    <div class="empty-state ${compact ? "compact" : ""}">
      <div class="empty-orb"></div>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </div>
  `;
}

function goalPercent() {
  const total = (state.data.daily_goal?.target || 1) * 100;
  const achieved = state.data.tasks.map(getLiveTask).reduce((sum, task) => sum + task.progress_percent, 0);
  return Math.min(100, Math.round((achieved / total) * 100));
}

function currentPlannerDay() {
  return (new Date().getDay() + 6) % 7;
}

function monthLabel() {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date());
}

function dueLabel(task) {
  if (!task.due_at) return "sometime later";
  const due = new Date(task.due_at);
  const diff = due - new Date();
  if (diff < 0) return "now overdue";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.round((diff % 3600000) / 60000);
  if (hours > 24) {
    return due.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${Math.max(1, minutes)}m`;
}

function formatClock(seconds, includeHours = false) {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (includeHours || hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatCompactTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (hrs <= 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

function toDateTimeLocalValue(value) {
  if (!value) return "";
  return value.slice(0, 16);
}

function prettyDateTime(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function gradientStyle(colors) {
  const palette = Array.isArray(colors) && colors.length ? colors : ["#6a8cff", "#7fe7ff", "#ffc4a8"];
  return `background: linear-gradient(135deg, ${palette.join(", ")});`;
}

function titleCase(value) {
  return String(value).replace(/[-_]/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function upsertById(collection, item) {
  const index = collection.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    collection[index] = item;
  } else {
    collection.unshift(item);
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function debounce(callback, delay) {
  let timeout = null;
  return (...args) => {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), delay);
  };
}
