/*
 * SSES Rotation Planner: offline, data kept in localStorage.
 *
 * Rough map of this script:
 *   1. Constants, state and storage
 *   2. Date helpers and the rotation calculation
 *   3. Rendering (schedule, grid, appointments, activities)
 *   4. Event handlers
 *   5. Notifications and reminders
 *   6. Configuration validation, import/export and restore
 */
const letters = "ABCDEFG";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const REMINDER_MINUTES = [0, 5, 10, 15, 30, 60, 1440];

// Deep copy for plain JSON-style data (state, configuration, defaults).
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
const entryLabel = (a) => (a.kind === "task" ? "Task" : "Appointment");
// An entry's own times, falling back to the bell times of the block it is linked to.
function entryTimes(a) {
  const bell = state.bells[a.period];
  return { start: a.start || bell?.start, end: a.end || bell?.end };
}

// Declared up here because save() can call notify() during startup.
let notifyTimer;

// Local-time YYYY-MM-DD (toISOString would shift the date for non-UTC users).
function toLocalDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const STORAGE_KEY = "rotationPlannerV1";
const UNDO_KEY = STORAGE_KEY + "BeforeConfig"; // state saved just before a configuration import
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const isClock = (v) => typeof v === "string" && CLOCK_PATTERN.test(v);

// Derived from state.configuration by loadConfiguration().
let periods = ["1", "2", "3", "Adv", "4", "5", "6", "7", "8"];
let classes = {};
let grid = [];

let state = {
  anchorDate: "2000-01-03",
  anchorDay: "A",
  off: [],
  overrides: {},
  bells: {},
  appointments: [],
};
let selected = "A"; // rotation letter being shown
let direction = 1; // 1 = jump forward, -1 = jump back when a letter is picked
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved && validState(saved)) state = saved;
} catch {}
const DEFAULT_BLOCKS = [
  ["1", "08:30", "09:15"],
  ["2", "09:20", "10:05"],
  ["3", "10:10", "10:55"],
  ["Adv", "11:00", "11:35"],
  ["4", "11:40", "12:25"],
  ["5", "12:30", "13:15"],
  ["6", "13:20", "14:05"],
  ["7", "14:10", "14:55"],
  ["8", "15:00", "15:45"],
].map(([id, start, end]) => ({ id, name: `Block ${id}`, start, end }));
const defaultBells = Object.fromEntries(
  DEFAULT_BLOCKS.map((b) => [b.id, { start: b.start, end: b.end }]),
);
function applyBellDefaults() {
  if (state.bellRevision !== 1) {
    state.bells = clone(defaultBells);
    state.bellRevision = 1;
    save();
  }
}
applyBellDefaults();
const defaultConfiguration = {
  version: 1,
  blocks: clone(DEFAULT_BLOCKS),
  classes: {},
  grid: Object.fromEntries(
    [...letters].map((l) => [l, Object.fromEntries(DEFAULT_BLOCKS.map((b) => [b.id, null]))]),
  ),
  activities: [],
  referenceCalendar: { "2000-01-03": "A", "2000-01-11": "G" },
};
if (state.cleanDefaultsRevision !== 1) {
  state.configuration = clone(defaultConfiguration);
  state.bells = clone(defaultBells);
  state.off = [];
  state.overrides = {};
  state.anchorDate = "2000-01-03";
  state.anchorDay = "A";
  state.activityReminders = {};
  state.cleanDefaultsRevision = 1;
  try {
    localStorage.removeItem(UNDO_KEY);
  } catch {}
  save();
}
if (!state.configuration) state.configuration = clone(defaultConfiguration);
loadConfiguration();
function blockName(p) {
  return state.configuration.blocks.find((b) => b.id === p)?.name || "Block " + p;
}
function validDate(s) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(Date.parse(s)) &&
    new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s
  );
}
function validState(s) {
  return (
    s &&
    (!s.schoolDayOverrides ||
      Object.entries(s.schoolDayOverrides).every(
        ([d, v]) => validDate(d) && typeof v === "boolean",
      )) &&
    (!s.routines || validRoutines(s.routines)) &&
    validDate(s.anchorDate) &&
    letters.includes(s.anchorDay) &&
    s.anchorDay.length === 1 &&
    Array.isArray(s.off) &&
    s.off.every(validDate) &&
    s.overrides &&
    Object.entries(s.overrides).every(
      ([d, l]) => validDate(d) && letters.includes(l) && l.length === 1,
    ) &&
    s.bells &&
    Object.values(s.bells).every(
      (b) =>
        b &&
        ["start", "end"].every((k) => !b[k] || /^\d{2}:\d{2}$/.test(b[k])) &&
        (!b.start || !b.end || b.end > b.start),
    ) &&
    Array.isArray(s.appointments) &&
    s.appointments.every(
      (a) =>
        a &&
        (a.kind === undefined || ["appointment", "task"].includes(a.kind)) &&
        (a.completed === undefined || typeof a.completed === "boolean") &&
        typeof a.id === "string" &&
        typeof a.title === "string" &&
        validDate(a.date) &&
        typeof a.notes === "string" &&
        (!a.period || typeof a.period === "string") &&
        ["start", "end"].every(
          (k) => typeof a[k] === "string" && (!a[k] || /^\d{2}:\d{2}$/.test(a[k])),
        ) &&
        (!a.start || !a.end || a.end > a.start) &&
        (a.notify === undefined || typeof a.notify === "boolean") &&
        (a.reminderMinutes === undefined || REMINDER_MINUTES.includes(a.reminderMinutes)),
    )
  );
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    notify("Could not save. Export a backup to protect your changes.");
    return false;
  }
}
function notify(text) {
  $("status").textContent = text;
  $("status").style.display = "block";
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => ($("status").style.display = "none"), 4000);
}
// ---- Dates and rotation calculation ----
function dateObject(s) {
  return new Date(s + "T12:00:00Z");
}
function dateString(d) {
  return d.toISOString().slice(0, 10);
}
function isWeekend(s) {
  const day = dateObject(s).getUTCDay();
  return day === 0 || day === 6;
}
function isSchool(s) {
  if (isWeekend(s)) return false;
  const override = state.schoolDayOverrides?.[s];
  if (typeof override === "boolean") return override;
  return !state.off.includes(s) && state.configuration?.referenceCalendar[s] !== "OFF";
}
// Days the user has marked off: the legacy `off` list plus schoolDayOverrides set to false.
function markedDaysOff() {
  const overrides = state.schoolDayOverrides || {};
  const days = state.off.filter((d) => overrides[d] !== true);
  for (const [d, school] of Object.entries(overrides)) if (!school) days.push(d);
  return [...new Set(days)].sort();
}
const DAY_MS = 86400000;

// Number of school days in the range (from, to], where both are dates at noon UTC and
// from <= to. Same result as testing every day with isSchool(), but the cost depends on the
// number of exceptions (days off, overrides) rather than on how far apart the dates are.
function schoolDaysBetween(from, to) {
  const length = Math.round((to - from) / DAY_MS);
  const fromDay = Math.floor(from / DAY_MS);
  const weekday = (day) => (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
  // Full weeks hold 5 weekdays each; check the few leftover days one by one.
  let count = Math.floor(length / 7) * 5;
  for (let i = Math.floor(length / 7) * 7 + 1; i <= length; i++) {
    if (![0, 6].includes(weekday(fromDay + i))) count++;
  }
  // Remove weekdays that are not school days. Only listed dates can be exceptions.
  const exceptions = new Set(state.off);
  for (const [d, l] of Object.entries(state.configuration.referenceCalendar)) {
    if (l === "OFF") exceptions.add(d);
  }
  for (const [d, school] of Object.entries(state.schoolDayOverrides || {})) {
    if (!school) exceptions.add(d);
  }
  for (const d of exceptions) {
    const day = Math.floor(dateObject(d) / DAY_MS);
    if (
      day > fromDay &&
      day <= fromDay + length &&
      ![0, 6].includes(weekday(day)) &&
      !isSchool(d)
    ) {
      count--;
    }
  }
  return count;
}

// Rotation letter (A-G) for a date: a saved override wins; otherwise count school days
// forwards or backwards from the nearest reference date in the configuration.
function rotation(s) {
  if (state.overrides[s]) return state.overrides[s];
  const target = dateObject(s);
  let nearest = null; // closest reference date; the earlier one wins a tie
  for (const [date, letter] of Object.entries(state.configuration.referenceCalendar)) {
    if (letter === "OFF") continue;
    const distance = Math.abs(dateObject(date) - target);
    if (
      !nearest ||
      distance < nearest.distance ||
      (distance === nearest.distance && date.localeCompare(nearest.date) < 0)
    ) {
      nearest = { date, letter, distance };
    }
  }
  const reference = dateObject(nearest.date);
  const schoolDays =
    target >= reference
      ? schoolDaysBetween(reference, target)
      : -schoolDaysBetween(target, reference);
  return letters[(((letters.indexOf(nearest.letter) + schoolDays) % 7) + 7) % 7];
}
function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
// The date chosen in the picker, or null (with a message) when the field is empty or invalid.
// Saving a "" key into overrides or days off would make the stored state fail validation.
function selectedDate() {
  const date = $("date").value;
  if (validDate(date)) return date;
  notify("Choose a date first.");
  return null;
}
function dateChanged() {
  if (!$("date").value) return;
  selected = rotation($("date").value);
  $("appointmentDate").value = $("date").value;
  render();
}
function render() {
  const date = $("date").value,
    school = isSchool(date),
    day = letters.indexOf(selected);
  const showingToday = date === todayString();
  $("today").classList.toggle("active", showingToday);
  $("today").setAttribute("aria-pressed", String(showingToday));
  $("dateLabel").textContent = dateObject(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  $("heading").textContent = school ? `${selected} Day` : isWeekend(date) ? "Weekend" : "Day off";
  const calculation = state.overrides[date]
    ? "Saved override"
    : selected === rotation(date)
      ? "Calculated"
      : "Preview";
  $("calculation").textContent =
    `${calculation} · Reference calendar: ${Object.keys(state.configuration.referenceCalendar).length} dates. ` +
    (school ? "" : "No classes scheduled. Appointments, tasks, and routines still apply.");
  days.innerHTML = [...letters]
    .map(
      (l) =>
        `<button class="${l === selected ? "active" : ""}" data-day="${l}" aria-pressed="${l === selected}">${l}</button>`,
    )
    .join("");
  $("off").textContent = !school && !isWeekend(date) ? "Restore school day" : "Mark day off";
  $("off").disabled = isWeekend(date);
  $("filter").disabled = !school;
  $("schedule").innerHTML = school
    ? periods
        .map((p, i) => {
          const id = grid[i][day],
            c = id ? classes[id] : ["Unassigned", "", ""];
          const linked = state.appointments.filter((a) => a.date === date && a.period === p);
          if ($("filter").value && id !== $("filter").value && !linked.length) return "";
          return slotHtml(p, id, c, linked);
        })
        .join("") || '<p class="muted">This class does not meet on this rotation day.</p>'
    : dayOffHtml(date);
  renderRoutines();
  const appointments = state.appointments
    .filter((a) => a.date === date)
    .sort((a, b) => (a.start || "99").localeCompare(b.start || "99"));
  $("appointmentsHeading").textContent = "Appointments & tasks for this date";
  const content = appointments
    .map((a) => {
      const { start, end } = entryTimes(a);
      const timeLabel = start ? formatTime(start) + (end ? "–" + formatTime(end) : "") : "No time set";
      const periodLabel = a.period
        ? " · " + (a.period === "Adv" ? "Advisory" : "Period " + a.period)
        : "";
      const overlaps = appointments.some((b) => {
        if (b.id === a.id) return false;
        const other = entryTimes(b);
        return start && end && other.start && other.end && start < other.end && end > other.start;
      });
      return `
        <div class="appointment ${a.kind === "task" && a.completed ? "completed" : ""}">
          <span class="entry-tag">${entryLabel(a)}</span>
          <strong>${escapeHtml(a.title)}</strong>
          <div class="muted">
            ${timeLabel}${periodLabel}
          </div>
          <div class="muted">${escapeHtml(a.notes)}</div>
          ${overlaps ? '<small class="warning">Overlaps another appointment</small><br>' : ""}
          ${taskControl(a)}
          <button data-edit="${escapeHtml(a.id)}">Edit</button>
          <button data-delete="${escapeHtml(a.id)}">Delete</button>
        </div>`;
    })
    .join("");
  $("appointments").innerHTML =
    content ||
    '<p class="muted">Nothing planned yet. Add an appointment or task, or use Add beside a block.</p>';
  renderActivities();
  $("offList").textContent = "Marked days off: " + (markedDaysOff().join(", ") || "none");
  $("overrideLetter").value = selected;
  renderAllAppointments();
}
function renderConfiguration() {
  $("filter").innerHTML =
    '<option value="">All classes</option>' +
    Object.entries(classes)
      .map(([id, c]) => `<option value="${escapeHtml(id)}">${escapeHtml(c[0])}</option>`)
      .join("");
  $("period").innerHTML =
    '<option value="">No block</option>' +
    periods
      .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(blockName(p))}</option>`)
      .join("");
  $("anchorDay").innerHTML = [...letters].map((l) => `<option>${l}</option>`).join("");
  $("anchorDate").value = state.anchorDate;
  $("anchorDay").value = state.anchorDay;
  renderGrid();
  fillBells();
}
function renderGrid() {
  const header =
    "<thead><tr><th>Block</th>" +
    [...letters].map((letter) => `<th>${letter}</th>`).join("") +
    "</tr></thead><tbody>";
  const rows = periods
    .map((period, index) => {
      const classCells = grid[index]
        .map((id) => {
          const details = id
            ? `${escapeHtml(classes[id][0])}<br><small>${classes[id].slice(1).map(escapeHtml).join("<br>")}</small>`
            : '<span class="empty">Unassigned</span>';
          return `<td>${details}</td>`;
        })
        .join("");
      return `
        <tr>
          <th>
            ${escapeHtml(blockName(period))}<br>
            <small>${formatTime(state.bells[period]?.start)} – ${formatTime(state.bells[period]?.end)}</small>
          </th>
          ${classCells}
        </tr>`;
    })
    .join("");
  $("grid").innerHTML = header + rows + "</tbody>";
}
function fillBells() {
  $("bells").innerHTML = periods
    .map(
      (p, i) =>
        `<div class="row bell-row">
          <span class="bell-name">${escapeHtml(blockName(p))}</span>
          <input type="time" id="bellStart${i}" aria-label="${escapeHtml(p)} start" value="${state.bells[p]?.start || ""}">
          <input type="time" id="bellEnd${i}" aria-label="${escapeHtml(p)} end" value="${state.bells[p]?.end || ""}">
        </div>`,
    )
    .join("");
}
renderConfiguration();
$("days").onclick = (e) => {
  if (e.target.dataset.day) jumpRotation(e.target.dataset.day, direction);
};
$("date").onchange = dateChanged;
$("filter").onchange = render;
function move(n) {
  const date = selectedDate();
  if (!date) return;
  const d = dateObject(date);
  d.setUTCDate(d.getUTCDate() + n);
  $("date").value = dateString(d);
  dateChanged();
}
$("prev").onclick = () => move(-1);
$("next").onclick = () => move(1);
$("today").onclick = () => {
  $("date").value = todayString();
  dateChanged();
};
$("override").onclick = () => {
  const date = selectedDate();
  if (!date) return;
  state.overrides[date] = $("overrideLetter").value;
  save();
  dateChanged();
  notify("Rotation saved for this date.");
};
$("clearOverride").onclick = () => {
  const date = selectedDate();
  if (!date) return;
  delete state.overrides[date];
  save();
  dateChanged();
};
$("off").onclick = () => {
  const d = selectedDate();
  if (!d) return;
  if (isWeekend(d)) return notify("Weekends already have no classes.");
  state.schoolDayOverrides ??= {};
  state.schoolDayOverrides[d] = !isSchool(d);
  save();
  dateChanged();
};
$("saveAnchor").onclick = () => {
  const d = $("anchorDate").value;
  if (!validDate(d) || !isSchool(d)) return notify("Reference must be a school weekday.");
  const candidate = clone(state.configuration);
  candidate.referenceCalendar[d] = $("anchorDay").value;
  try {
    validateConfiguration(candidate);
  } catch (e) {
    return notify(e.message);
  }
  state.anchorDate = d;
  state.anchorDay = $("anchorDay").value;
  state.configuration = candidate;
  save();
  dateChanged();
};
$("saveBells").onclick = () => {
  const bells = {};
  for (const [i, p] of periods.entries()) {
    const start = $("bellStart" + i).value,
      end = $("bellEnd" + i).value;
    if (start && end && end <= start) return notify("Each end time must be after its start.");
    bells[p] = { start, end };
  }
  for (const b of state.configuration.blocks) {
    for (const segment of b.segments || []) {
      if (
        (bells[b.id].start && segment.start < bells[b.id].start) ||
        (bells[b.id].end && segment.end > bells[b.id].end)
      )
        return notify(
          "Block times must include their segments. Edit segment times through configuration import.",
        );
    }
  }
  state.bells = bells;
  save();
  renderGrid();
  render();
  notify("Bell times saved.");
};
function cancelEdit() {
  $("appointmentForm").reset();
  $("editId").value = "";
  $("appointmentDate").value = $("date").value;
  $("saveAppointment").textContent = "Save appointment";
  $("cancelEdit").hidden = true;
  $("entryKind").value = "appointment";
  updateEntryForm();
  updateNotifyControls();
}
$("cancelEdit").onclick = cancelEdit;
$("schedule").onclick = (e) => {
  if (e.target.dataset.newTask) {
    cancelEdit();
    $("entryKind").value = "task";
    updateEntryForm();
    $("title").focus();
    return;
  }
  if (e.target.dataset.add) {
    cancelEdit();
    $("period").value = e.target.dataset.add;
    $("title").focus();
    return;
  }
  appointmentAction(e);
};
$("appointmentForm").onsubmit = (e) => {
  e.preventDefault();
  const a = {
    id: $("editId").value || crypto.randomUUID(),
    title: $("title").value.trim(),
    date: $("appointmentDate").value,
    kind: $("entryKind").value,
    completed:
      $("entryKind").value === "task"
        ? !!state.appointments.find((x) => x.id === $("editId").value)?.completed
        : false,
    period: $("period").value,
    start: $("start").value,
    end: $("end").value,
    notes: $("notes").value.trim(),
    notify: !!$("start").value && $("notifyAppointment").checked,
    reminderMinutes: Number($("reminderMinutes").value),
  };
  if (!a.title || !validDate(a.date)) return;
  if (a.start && a.end && a.end <= a.start) return notify("End time must be after start time.");
  state.appointments = state.appointments.filter((x) => x.id !== a.id);
  state.appointments.push(a);
  save();
  $("date").value = a.date;
  cancelEdit();
  dateChanged();
  notify(a.kind === "task" ? "Task saved." : "Appointment saved.");
};
function appointmentAction(e) {
  if (e.target.dataset.complete) {
    const task = state.appointments.find(
      (a) => a.id === e.target.dataset.complete && a.kind === "task",
    );
    if (task) {
      task.completed = e.target.checked;
      save();
      render();
    }
    return;
  }
  const id = e.target.dataset.edit || e.target.dataset.delete;
  if (!id) return;
  const a = state.appointments.find((x) => x.id === id);
  if (!a) return;
  if (e.target.dataset.delete) {
    if (confirm(a.kind === "task" ? "Delete this task?" : "Delete this appointment?")) {
      state.appointments = state.appointments.filter((x) => x.id !== id);
      save();
      render();
    }
    return;
  }
  for (const field of ["title", "period", "start", "end", "notes"]) $(field).value = a[field];
  $("appointmentDate").value = a.date;
  $("editId").value = id;
  $("notifyAppointment").checked = !!a.notify;
  $("reminderMinutes").value = String(a.reminderMinutes ?? 10);
  updateNotifyControls();
  $("entryKind").value = a.kind || "appointment";
  updateEntryForm();
  $("saveAppointment").textContent = "Save changes";
  $("cancelEdit").hidden = false;
  $("title").focus();
}
$("export").onclick = () => downloadJson(state, "rotation-planner-backup.json");
$("importButton").onclick = () => $("import").click();
async function importPlannerFile(e) {
  try {
    const s = JSON.parse(await e.target.files[0].text());
    if (s && s.version === 1 && s.blocks && s.grid) {
      importConfigurationFile(s, e.target.files[0].name || "JSON file");
      return;
    }
    if (!validState(s)) throw Error();
    if (!confirm("Replace this browser’s planner with the backup?")) return;
    if (s.configuration) validateConfiguration(s.configuration);
    state = s;
    // Older backups lack this flag; without it the startup migration would
    // wipe the restored configuration, days off and overrides on refresh.
    state.cleanDefaultsRevision = 1;
    applyBellDefaults();
    if (!state.configuration) state.configuration = clone(defaultConfiguration);
    loadConfiguration();
    renderConfiguration();
    save();
    $("anchorDate").value = state.anchorDate;
    $("anchorDay").value = state.anchorDay;
    fillBells();
    cancelEdit();
    dateChanged();
    notify("Backup restored.");
  } catch (error) {
    $("configurationError").textContent =
      error.message || "That file is not a valid planner backup or configuration.";
    notify($("configurationError").textContent);
  }
  e.target.value = "";
}

// Moves the date picker to the next/previous school day whose rotation letter matches.
function jumpRotation(letter, step) {
  const d = dateObject($("date").value);
  for (let i = 0; i < 3660; i++) {
    d.setUTCDate(d.getUTCDate() + step);
    const date = dateString(d);
    if (isSchool(date) && rotation(date) === letter) {
      $("date").value = date;
      dateChanged();
      return;
    }
  }
  notify("No matching school day found within ten years. Check rotation settings.");
}
function setDirection(step) {
  direction = step;
  $("rotationPrevious").classList.toggle("active", step === -1);
  $("rotationNext").classList.toggle("active", step === 1);
  $("rotationPrevious").setAttribute("aria-pressed", String(step === -1));
  $("rotationNext").setAttribute("aria-pressed", String(step === 1));
  $("rotationHint").textContent =
    `${step === 1 ? "Next" : "Previous"} selected: letters and direction buttons jump to that occurrence of the selected rotation.`;
  jumpRotation(selected, step);
}
function todayString() {
  return toLocalDateString(new Date());
}
// Writes innerHTML only when the markup differs from the last write. Building the HTML is
// cheap; putting a long list into the page is not, and this list rarely changes between renders.
const renderedHtml = new WeakMap();
function setHtmlIfChanged(el, html) {
  if (renderedHtml.get(el) === html) return;
  el.innerHTML = html;
  renderedHtml.set(el, html);
}
function renderAllAppointments() {
  const list = [...state.appointments].sort((a, b) =>
    (a.date + (a.start || "99")).localeCompare(b.date + (b.start || "99")),
  );
  const cards = list
    .map((a) => {
      const timeLabel = a.start ? formatTime(a.start) : "No start time";
      const endLabel = a.end ? "–" + formatTime(a.end) : "";
      const periodLabel = a.period ? " · Period " + escapeHtml(a.period) : "";
      return `
        <div class="appointment ${a.kind === "task" && a.completed ? "completed" : ""}">
          <span class="entry-tag">${entryLabel(a)}</span>
          <strong>${escapeHtml(a.title)}</strong>
          <div class="muted">
            ${escapeHtml(a.date)} · ${timeLabel}${endLabel}${periodLabel}
          </div>
          <div class="muted">${escapeHtml(a.notes)}</div>
          ${a.notify && a.start ? `<small>Reminder: ${a.reminderMinutes ?? 10} minutes before</small><br>` : ""}
          <button data-open="${escapeHtml(a.date)}">View date</button>
          ${taskControl(a)}
          <button data-edit="${escapeHtml(a.id)}">Edit</button>
          <button data-delete="${escapeHtml(a.id)}">Delete</button>
        </div>`;
    })
    .join("");
  setHtmlIfChanged($("allAppointments"), cards || '<p class="muted">No appointments saved.</p>');
}
// ---- Notifications and reminders ----
function updateNotifyControls() {
  const enabled = !!$("start").value;
  $("notifyAppointment").disabled = !enabled;
  if (!enabled) $("notifyAppointment").checked = false;
  $("notifyLabel").classList.toggle("disabled", !enabled);
  $("reminderMinutes").disabled = !enabled || !$("notifyAppointment").checked;
  $("notifyReason").textContent = enabled
    ? "Reminders use this appointment’s start time. Keep the planner open."
    : "Set a start time to enable notifications.";
}
function notificationSupported() {
  return typeof Notification !== "undefined" && globalThis.isSecureContext;
}
function updateNotificationStatus() {
  const supported = notificationSupported();
  $("enableNotifications").disabled = !supported || Notification.permission === "granted";
  $("notificationStatus").textContent = !supported
    ? "Browser notifications are unavailable here. In-page reminders still work while this planner is open."
    : Notification.permission === "granted"
      ? "Browser notifications enabled."
      : Notification.permission === "denied"
        ? "Browser notifications are blocked. Change this browser’s site permissions to allow them. In-page reminders remain active."
        : "Browser notifications need your permission. In-page reminders still work.";
}
async function enableBrowserNotifications() {
  if (!notificationSupported()) return;
  try {
    await Notification.requestPermission();
  } catch {
    notify("This browser could not enable notifications. In-page reminders remain active.");
  }
  updateNotificationStatus();
}
// Adds an in-page reminder and, when permitted, a browser notification.
function showReminder(label, notificationTitle, message, tag) {
  const alertEl = document.createElement("div");
  alertEl.className = "appointment";
  alertEl.textContent = label + ": " + message;
  $("reminderAlerts").prepend(alertEl);
  if (notificationSupported() && Notification.permission === "granted") {
    try {
      new Notification(notificationTitle, { body: message, tag });
    } catch {}
  }
}
function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const a of state.appointments) {
    if (!a.notify || !a.start || a.completed) continue;
    const start = new Date(a.date + "T" + a.start).getTime(),
      due = start - (a.reminderMinutes ?? 10) * 60000,
      stamp = `${a.date}|${a.start}|${a.reminderMinutes ?? 10}`;
    if (now < due || now >= start + 60000 || a.remindedFor === stamp) continue;
    a.remindedFor = stamp;
    changed = true;
    const message = `${a.title} · ${a.date} at ${formatTime(a.start)}`;
    showReminder("Reminder", "Appointment reminder", message, a.id + "|" + stamp);
  }
  if (changed) save();
  checkActivityReminders();
}
function initializePlanner() {
  $("overrideLetter").innerHTML = [...letters].map((l) => `<option>${l}</option>`).join("");
  $("rotationPrevious").onclick = () => setDirection(-1);
  $("rotationNext").onclick = () => setDirection(1);
  $("appointments").onclick = appointmentAction;
  $("allAppointments").onclick = (e) => {
    if (e.target.dataset.open) {
      $("date").value = e.target.dataset.open;
      dateChanged();
    } else appointmentAction(e);
  };
  $("start").oninput = updateNotifyControls;
  $("notifyAppointment").onchange = () => {
    updateNotifyControls();
    if ($("notifyAppointment").checked) enableBrowserNotifications();
  };
  $("enableNotifications").onclick = enableBrowserNotifications;
  setupConfigurationImport();
  setupRoutines();
  $("entryKind").onchange = updateEntryForm;
  $("date").value = todayString();
  dateChanged();
  updateNotifyControls();
  updateNotificationStatus();
  checkReminders();
  setInterval(checkReminders, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      updateNotificationStatus();
      checkReminders();
    }
  });
}
// ---- Configuration: validation, import/export, restore ----
// Checks an imported or stored configuration. Throws an Error with a user-facing message
// on the first problem; otherwise returns a clean deep copy.
function validateConfiguration(c) {
  const fail = (m) => {
      throw Error(m);
    },
    obj = (v) => v && typeof v === "object" && !Array.isArray(v),
    str = (v, n = 300) => typeof v === "string" && v.length <= n,
    id = (v) =>
      typeof v === "string" &&
      /^[A-Za-z0-9_-]{1,60}$/.test(v) &&
      !["__proto__", "prototype", "constructor"].includes(v),
    unique = (a) => new Set(a).size === a.length;
  if (!obj(c) || c.version !== 1) fail("Use a configuration with version: 1.");
  if (!Array.isArray(c.blocks) || !c.blocks.length || c.blocks.length > 30)
    fail("blocks must contain 1–30 blocks.");
  for (const b of c.blocks) {
    if (
      !obj(b) ||
      !id(b.id) ||
      !str(b.name) ||
      !b.name.trim() ||
      !isClock(b.start) ||
      !isClock(b.end) ||
      b.end <= b.start
    )
      fail("Each block needs a unique ID, a name, and valid start/end times.");
    if (b.segments !== undefined) {
      if (!Array.isArray(b.segments) || b.segments.length > 20)
        fail("Block segments must be an array of at most 20 items.");
      let previous = b.start;
      for (const s of b.segments) {
        if (
          !obj(s) ||
          !str(s.name) ||
          !s.name.trim() ||
          !isClock(s.start) ||
          !isClock(s.end) ||
          s.start < previous ||
          s.end <= s.start ||
          s.end > b.end
        )
          fail("Block segments must be ordered, non-overlapping, and inside their block.");
        previous = s.end;
      }
    }
  }
  if (!unique(c.blocks.map((b) => b.id))) fail("Block IDs must be unique.");
  if (!obj(c.classes) || Object.keys(c.classes).length > 300)
    fail("classes must be an object with at most 300 classes.");
  for (const [k, v] of Object.entries(c.classes))
    if (!id(k) || !obj(v) || !str(v.name) || !v.name.trim() || !str(v.teacher) || !str(v.room))
      fail("Each class needs a safe ID, name, teacher, and room (empty strings are allowed).");
  if (!obj(c.grid) || Object.keys(c.grid).sort().join("") !== "ABCDEFG")
    fail("grid must contain exactly A, B, C, D, E, F, and G.");
  const ids = c.blocks.map((b) => b.id);
  for (const l of letters) {
    const day = c.grid[l];
    if (
      !obj(day) ||
      Object.keys(day).length !== ids.length ||
      !ids.every((p) => Object.hasOwn(day, p))
    )
      fail(`Grid ${l} must contain every block ID exactly once.`);
    for (const v of Object.values(day))
      if (v !== null && (typeof v !== "string" || !Object.hasOwn(c.classes, v)))
        fail(`Grid ${l} refers to an unknown class. Use null for an unassigned block.`);
  }
  if (!Array.isArray(c.activities) || c.activities.length > 100)
    fail("activities must be an array with at most 100 items.");
  for (const a of c.activities) {
    if (
      !obj(a) ||
      !id(a.id) ||
      !str(a.name) ||
      !a.name.trim() ||
      !Array.isArray(a.weekdays) ||
      !a.weekdays.length ||
      !unique(a.weekdays) ||
      !a.weekdays.every((d) => WEEKDAYS.includes(d)) ||
      !isClock(a.start) ||
      !isClock(a.end) ||
      a.end <= a.start ||
      !str(a.notes, 2000) ||
      typeof a.notify !== "boolean" ||
      !REMINDER_MINUTES.includes(a.reminderMinutes)
    )
      fail(
        "Activities need a unique ID, name, weekdays, valid times, notes, notify, and reminderMinutes.",
      );
  }
  if (!unique(c.activities.map((a) => a.id))) fail("Activity IDs must be unique.");
  if (!obj(c.referenceCalendar) || Object.keys(c.referenceCalendar).length > 5000)
    fail("referenceCalendar must be an object of dates and rotation letters.");
  for (const [d, l] of Object.entries(c.referenceCalendar)) {
    if (!validDate(d) || !["A", "B", "C", "D", "E", "F", "G", "OFF"].includes(l))
      fail("Reference dates must use YYYY-MM-DD and A–G or OFF.");
    if (l !== "OFF" && isWeekend(d)) fail("Rotation references must fall on weekdays.");
  }
  const values = Object.values(c.referenceCalendar);
  if (!values.includes("A") || !values.includes("G"))
    fail("referenceCalendar requires at least one A Day and one G Day.");
  const refs = Object.entries(c.referenceCalendar)
    .filter(([, l]) => l !== "OFF")
    .sort(([a], [b]) => a.localeCompare(b));
  for (let i = 1; i < refs.length; i++) {
    const [before, l] = refs[i - 1],
      [after, actual] = refs[i];
    let count = 0,
      d = dateObject(before);
    if ((dateObject(after) - d) / 86400000 > 36600)
      fail("Reference dates must be within 100 years of each other.");
    while (dateString(d) !== after) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (![0, 6].includes(d.getUTCDay()) && c.referenceCalendar[dateString(d)] !== "OFF") count++;
    }
    const expected = letters[(letters.indexOf(l) + count) % 7];
    if (expected !== actual)
      fail(
        `Reference conflict: ${after} is ${actual}, but ${before} (${l}) ` +
          `predicts ${expected}. Correct the letter or add missing OFF dates.`,
      );
  }
  return clone(c);
}
function loadConfiguration() {
  const c = validateConfiguration(state.configuration);
  state.configuration = c;
  periods = c.blocks.map((b) => b.id);
  classes = Object.fromEntries(
    Object.entries(c.classes).map(([id, v]) => [id, [v.name, v.teacher, v.room]]),
  );
  grid = periods.map((p) => [...letters].map((l) => c.grid[l][p]));
}
function segmentDescription(p) {
  return (state.configuration.blocks.find((b) => b.id === p)?.segments || [])
    .map(
      (s) =>
        `<small class="block-time">${escapeHtml(s.name)}: ${formatTime(s.start)} – ${formatTime(s.end)}</small>`,
    )
    .join("");
}
function activityCard(a, repeat = true) {
  return `
    <div class="appointment">
      <strong>${escapeHtml(a.name)}</strong>
      <div class="muted">${formatTime(a.start)}–${formatTime(a.end)}${repeat ? " · Weekly" : ""}</div>
      <div class="muted">Repeats ${a.weekdays.map(escapeHtml).join(" & ")}.</div>
      ${a.notes ? `<div class="muted">${escapeHtml(a.notes)}</div>` : ""}
      ${a.notify ? `<small>Reminder: ${a.reminderMinutes} minutes before</small>` : ""}
    </div>`;
}
function renderActivities() {
  const acts = state.configuration.activities;
  $("activities").innerHTML =
    acts.map((a) => activityCard(a)).join("") ||
    '<p class="muted">No recurring activities configured.</p>';
  const weekday = dateObject($("date").value).getUTCDay(),
    name = WEEKDAYS[weekday];
  $("activitiesToday").innerHTML =
    acts
      .filter((a) => a.weekdays.includes(name))
      .map((a) => activityCard(a, false))
      .join("") || '<p class="muted">No activities for this date.</p>';
}
function currentConfiguration() {
  const c = clone(state.configuration);
  for (const b of c.blocks) {
    const times = state.bells[b.id];
    if (times?.start && times?.end) {
      b.start = times.start;
      b.end = times.end;
    }
  }
  for (const d of state.off) c.referenceCalendar[d] = "OFF";
  for (const [d, l] of Object.entries(state.overrides)) c.referenceCalendar[d] = l;
  for (const [d, school] of Object.entries(state.schoolDayOverrides || {})) {
    if (!school) c.referenceCalendar[d] = "OFF";
    else if (c.referenceCalendar[d] === "OFF") delete c.referenceCalendar[d];
  }
  return c;
}
function downloadJson(data, name) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let pendingConfiguration = null;
function previewConfiguration(raw) {
  pendingConfiguration = null;
  $("configurationPreview").hidden = true;
  const c = validateConfiguration(raw);
  pendingConfiguration = c;
  const appointmentsLosingBlock = state.appointments.filter(
    (a) => a.period && !c.blocks.some((b) => b.id === a.period),
  ).length;
  const counts = [
    `${c.blocks.length} blocks`,
    `${Object.keys(c.classes).length} classes`,
    "7 rotation days",
    `${c.activities.length} activities`,
    `${Object.keys(c.referenceCalendar).length} reference dates`,
  ].join(" · ");
  $("configurationSummary").textContent =
    `${counts}. Existing appointments will be preserved. ` +
    `${appointmentsLosingBlock} appointments will lose a block link because that block is absent from this file.`;
  $("configurationError").textContent = "";
  $("configurationPreview").hidden = false;
}
function applyConfiguration() {
  if (!pendingConfiguration) return;
  const importedChanges = configurationChanges(pendingConfiguration);
  const previous = clone(state),
    next = clone(state),
    c = pendingConfiguration;
  next.configuration = c;
  next.bells = Object.fromEntries(c.blocks.map((b) => [b.id, { start: b.start, end: b.end }]));
  next.off = Object.entries(c.referenceCalendar)
    .filter(([, l]) => l === "OFF")
    .map(([d]) => d);
  next.overrides = {};
  next.schoolDayOverrides = {};
  const refs = Object.entries(c.referenceCalendar)
    .filter(([, l]) => l !== "OFF")
    .sort(([a], [b]) => a.localeCompare(b));
  [next.anchorDate, next.anchorDay] = refs[0];
  next.bellRevision = 1;
  next.rotationRevision = 2;
  const blockIds = c.blocks.map((b) => b.id);
  next.appointments = next.appointments.map((a) =>
    blockIds.includes(a.period) || !a.period ? a : { ...a, period: "" },
  );
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify(previous));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    $("configurationError").textContent =
      "Import cancelled: browser storage is full or unavailable. Export a backup first.";
    return;
  }
  state = next;
  loadConfiguration();
  renderConfiguration();
  cancelEdit();
  dateChanged();
  pendingConfiguration = null;
  $("configurationPreview").hidden = true;
  $("undoConfiguration").hidden = false;
  const message = importedChanges.length
    ? "Imported configuration. Updated: " + importedChanges.join(", ") + "."
    : "Imported configuration. This file already matches your current plan; no schedule changes were needed.";
  $("configurationResult").textContent = message + " Your appointments are preserved.";
  $("configurationResult").hidden = false;
  notify(message);
  return true;
}
function configurationChanges(c) {
  const current = currentConfiguration(),
    changes = [];
  for (const [field, label] of [
    ["blocks", "blocks and times"],
    ["classes", "class details"],
    ["grid", "rotation grid"],
    ["activities", "activities"],
    ["referenceCalendar", "reference calendar"],
  ]) {
    if (stableJson(current[field]) !== stableJson(c[field])) changes.push(label);
  }
  return changes;
}
// JSON with sorted keys, so two configurations compare equal regardless of key order.
function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableJson(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function importConfigurationFile(raw, name) {
  previewConfiguration(raw);
  if (applyConfiguration()) {
    $("configurationResult").textContent = name + ": " + $("configurationResult").textContent;
  }
}
function setupConfigurationImport() {
  $("import").onchange = importPlannerFile;
  $("resetData").onclick = () => {
    if (
      !confirm(
        "Reset all planner data? " +
          "This permanently deletes your appointments, imported schedule, activities, settings, " +
          "reminder history, and import recovery copy. The blank template will be restored. " +
          "Export all data first if you want a backup.",
      )
    )
      return;
    try {
      localStorage.removeItem(UNDO_KEY);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      notify("Reset failed: browser storage is unavailable.");
      return;
    }
    location.reload();
  };
  $("chooseConfiguration").onclick = () => $("configurationFile").click();
  $("configurationFile").onchange = async (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2000000) throw Error("Choose a JSON file smaller than 2 MB.");
      importConfigurationFile(
        JSON.parse((await file.text()).replace(/^\uFEFF/, "")),
        file.name || "JSON file",
      );
    } catch (error) {
      pendingConfiguration = null;
      $("configurationPreview").hidden = true;
      $("configurationError").textContent =
        error instanceof SyntaxError
          ? "This file is not valid JSON. Check commas and quotation marks."
          : error.message;
      notify($("configurationError").textContent);
    } finally {
      e.target.value = "";
    }
  };
  $("applyConfiguration").onclick = applyConfiguration;
  $("cancelConfiguration").onclick = () => {
    pendingConfiguration = null;
    $("configurationPreview").hidden = true;
  };
  $("exportConfiguration").onclick = () => {
    try {
      downloadJson(
        validateConfiguration(currentConfiguration()),
        "sses-planner-configuration.json",
      );
    } catch (e) {
      $("configurationError").textContent = "Cannot export configuration: " + e.message;
    }
  };
  $("downloadTemplate").onclick = () =>
    downloadJson(defaultConfiguration, "sses-planner-template.json");
  try {
    $("undoConfiguration").hidden = !localStorage.getItem(UNDO_KEY);
  } catch {
    $("undoConfiguration").hidden = true;
  }
  $("undoConfiguration").onclick = () => {
    try {
      const previous = JSON.parse(localStorage.getItem(UNDO_KEY));
      if (!previous || !validState(previous)) throw Error("No valid recovery backup found.");
      if (
        !confirm(
          "Restore the configuration from before the last import? Current appointments will be preserved.",
        )
      )
        return;
      const restored = { ...previous, appointments: state.appointments };
      if (restored.configuration) validateConfiguration(restored.configuration);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
      state = restored;
      loadConfiguration();
      renderConfiguration();
      cancelEdit();
      dateChanged();
      notify("Previous configuration restored.");
    } catch (e) {
      $("configurationError").textContent = e.message;
    }
  };
}
function checkActivityReminders() {
  const now = new Date();
  let changed = false;
  state.activityReminders ??= {};
  // Only today's and tomorrow's reminders are ever checked, so older entries are dead weight.
  // Stamps look like "id|YYYY-MM-DD|start|minutes".
  const today = toLocalDateString(now);
  for (const stamp of Object.keys(state.activityReminders)) {
    if (stamp.split("|")[1] < today) {
      delete state.activityReminders[stamp];
      changed = true;
    }
  }
  for (let offset = 0; offset <= 1; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    const date = toLocalDateString(d),
      weekday = WEEKDAYS[d.getDay()];
    for (const a of state.configuration.activities) {
      if (!a.notify || !a.weekdays.includes(weekday)) continue;
      const start = new Date(date + "T" + a.start).getTime(),
        due = start - a.reminderMinutes * 60000,
        stamp = `${a.id}|${date}|${a.start}|${a.reminderMinutes}`;
      if (Date.now() < due || Date.now() >= start + 60000 || state.activityReminders[stamp])
        continue;
      state.activityReminders[stamp] = true;
      changed = true;
      const message = `${a.name} · ${date} at ${formatTime(a.start)}`;
      showReminder("Activity reminder", "Activity reminder", message, stamp);
    }
  }
  if (changed) save();
}

// One block row in the day schedule, with any appointments/tasks linked to it.
function slotHtml(p, id, c, linked) {
  const bell = state.bells[p];
  return `
    <div class="slot">
      <div>
        <span class="pill">${escapeHtml(blockName(p))}</span>
        ${bell?.start ? `<small class="block-time">${formatTime(bell.start)}${bell.end ? " – " + formatTime(bell.end) : ""}</small>` : ""}
      </div>
      <div class="${id ? "" : "empty"}">
        <strong>${escapeHtml(c[0])}</strong>
        ${segmentDescription(p)}
        <small>${escapeHtml(c[1])}${c[2] ? " · " + escapeHtml(c[2]) : ""}</small>
        ${linked.map(linkedEntry).join("")}
      </div>
      <button data-add="${escapeHtml(p)}" aria-label="Add appointment for ${escapeHtml(blockName(p))}">Add</button>
    </div>`;
}
// Shown instead of the schedule on weekends and days off.
function dayOffHtml(date) {
  const taskButton = isWeekend(date) ? "Add weekend task" : "Add day-off task";
  const entries = state.appointments.filter((a) => a.date === date).map(linkedEntry).join("");
  return `
    <div class="day-off">
      <p class="muted">No classes today. Plan your own time below.</p>
      <button class="primary" data-new-task="true">${taskButton}</button>
      ${entries}
    </div>`;
}
function taskControl(a) {
  return a.kind === "task"
    ? `<label class="task-check"><input type="checkbox" data-complete="${escapeHtml(a.id)}" ${a.completed ? "checked" : ""}>Done</label> `
    : "";
}
function linkedEntry(a) {
  const { start } = entryTimes(a);
  return `
    <div class="linked-entry ${a.completed ? "completed" : ""}">
      <span class="entry-tag">${entryLabel(a)}</span>
      <button class="linked-title" data-edit="${escapeHtml(a.id)}">${escapeHtml(a.title)}</button>
      ${start ? `<small class="block-time">${formatTime(start)}${a.end ? " – " + formatTime(a.end) : ""}</small>` : ""}
      ${a.notes ? `<small class="block-time">${escapeHtml(a.notes)}</small>` : ""}
      ${taskControl(a)}
    </div>`;
}
function updateEntryForm() {
  const task = $("entryKind").value === "task";
  $("formHeading").textContent = task ? "Add a task" : "Add an appointment";
  $("saveAppointment").textContent = $("editId").value
    ? "Save changes"
    : task
      ? "Save task"
      : "Save appointment";
}
function validRoutines(r) {
  return (
    r &&
    isClock(r.dinnerStart) &&
    isClock(r.chapelStart) &&
    Array.isArray(r.cancelledChapel) &&
    r.cancelledChapel.every(validDate)
  );
}
function routineSettings() {
  state.routines ??= { dinnerStart: "18:00", chapelStart: "18:45", cancelledChapel: [] };
  return state.routines;
}
function renderRoutines() {
  const r = routineSettings(),
    date = $("date").value,
    sunday = dateObject(date).getUTCDay() === 0,
    cancelled = r.cancelledChapel.includes(date);
  $("dailyRoutines").innerHTML =
    `<div class="routine">
      <strong>Dinner</strong>
      <div class="muted">${formatTime(r.dinnerStart)} · Every day</div>
    </div>${sunday ? `
      <div class="routine ${cancelled ? "cancelled" : ""}">
        <strong>Sunday Chapel</strong>
        <div class="muted">${formatTime(r.chapelStart)}${cancelled ? " · Cancelled for this Sunday" : ""}</div>
        <button data-chapel="toggle">${cancelled ? "Restore chapel" : "No chapel today"}</button>
      </div>` : ""}`;
}
function setupRoutines() {
  $("dailyRoutines").onclick = (e) => {
    if (!e.target.dataset.chapel) return;
    const date = selectedDate();
    if (!date) return;
    const r = routineSettings();
    r.cancelledChapel = r.cancelledChapel.includes(date)
      ? r.cancelledChapel.filter((d) => d !== date)
      : [...r.cancelledChapel, date];
    save();
    renderRoutines();
  };
}

initializePlanner();
