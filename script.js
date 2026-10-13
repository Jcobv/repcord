import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- page switching ----------
const buttons = document.querySelectorAll("nav button[data-page]");
const lockedButtons = document.querySelectorAll(".needs-login");
const guestOnlyButtons = document.querySelectorAll(".guest-only");
const pages = document.querySelectorAll(".page");

// remembers which page and tab you were on, so a reload puts you back there
const APP_PAGES = ["home", "calendar", "workouts", "profile"];

function remember(key, value) {
  try { sessionStorage.setItem(key, value); } catch (e) {}
}

function recall(key) {
  try { return sessionStorage.getItem(key); } catch (e) { return null; }
}

function showPage(name) {
  pages.forEach(page => {
    page.classList.toggle("active", page.id === name);
  });
  buttons.forEach(button => {
    button.classList.toggle("active", button.dataset.page === name);
  });
  if (APP_PAGES.includes(name)) remember("repcord-page", name);
  if (name === "about") window.scrollTo(0, 0);
}

buttons.forEach(button => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

// visitors start on the landing page
showPage("landing");

// ---------- small popup message ----------
const toast = document.getElementById("toast");
let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

// ---------- styled "are you sure?" window (replaces the plain browser popup) ----------
const confirmModal = document.getElementById("confirmModal");
const confirmOk = document.getElementById("confirmOk");
const confirmCancel = document.getElementById("confirmCancel");

// shows the window and waits for the answer: true = confirmed, false = cancelled
function askConfirm(title, message, okText) {
  return new Promise(resolve => {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmText").textContent = message;
    confirmOk.textContent = okText || "Delete";
    confirmModal.hidden = false;
    confirmCancel.focus(); // the safe choice is selected first

    function finish(answer) {
      confirmModal.hidden = true;
      confirmOk.removeEventListener("click", onOk);
      confirmCancel.removeEventListener("click", onCancel);
      confirmModal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(answer);
    }
    function onOk() { finish(true); }
    function onCancel() { finish(false); }
    function onBackdrop(e) { if (e.target === confirmModal) finish(false); }
    function onKey(e) { if (e.key === "Escape") finish(false); }

    confirmOk.addEventListener("click", onOk);
    confirmCancel.addEventListener("click", onCancel);
    confirmModal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

// ---------- tabs inside the Workouts page ----------
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.toggle("active", t === tab));
    panels.forEach(p => p.classList.toggle("active", p.id === tab.dataset.tab));
    remember("repcord-tab", tab.dataset.tab);
  });
});

// ---------- pick-one buttons (used for intensity) ----------
// a hidden input holds the chosen value, the buttons just show and change it
function syncSegmented(container, input) {
  container.querySelectorAll("button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === input.value);
  });
}

function bindSegmented(container, input, onChange) {
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.value;
      syncSegmented(container, input);
      if (onChange) onChange();
    });
  });
}

// ---------- data that lives in memory while the page is open ----------
let currentUser = null;
let logs = {};
let exercises = [];
let folders = [];
let dataReady = false;   // false while the logged-in user's data is still downloading from Firestore

function displayNameOf(user) {
  return user.displayName || user.email.split("@")[0];
}

// numbers count up to their new value
function setNumber(element, target) {
  if (element.dataset.target === String(target)) return;
  element.dataset.target = target;

  const start = Number(element.textContent) || 0;
  const startTime = performance.now();
  const duration = 600;

  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    element.textContent = Math.round(start + (target - start) * progress);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ---------- landing page sample heatmap (just for show) ----------
const previewGrid = document.getElementById("previewGrid");
let seed = 7;

function random() {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

for (let i = 0; i < 7 * 20; i++) {
  const box = document.createElement("div");
  const r = random();
  let level = "";
  if (r > 0.35 && r <= 0.6) level = " light";
  else if (r > 0.6 && r <= 0.85) level = " moderate";
  else if (r > 0.85) level = " failure";
  box.className = "day pv" + level;
  box.style.animationDelay = (i * 6) + "ms";
  previewGrid.appendChild(box);
}

// the login page shows a copy of the same sample heatmap
document.getElementById("authGrid").innerHTML = previewGrid.innerHTML;

// ---------- calendar ----------
const grid = document.getElementById("grid");
const monthRow = document.getElementById("monthRow");
const year = new Date().getFullYear();
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(d) {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function buildCalendar() {
  grid.innerHTML = "";
  monthRow.innerHTML = "";
  document.getElementById("calendarYear").textContent = year;

  const todayText = formatDate(new Date());
  const tracks = [];     // the width of every column (the gaps between months are narrow ones)
  let column = 1;        // the next free column (grid columns count from 1)
  let weekColumns = 0;

  for (let m = 0; m < 12; m++) {
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const startRow = new Date(year, m, 1).getDay();       // 0 = Sunday ... 6 = Saturday
    const weeks = Math.ceil((startRow + daysInMonth) / 7);

    // the month name sits above its own block of columns
    const label = document.createElement("span");
    label.textContent = monthNames[m];
    label.style.gridColumn = column + " / span " + weeks;
    monthRow.appendChild(label);

    // every day gets its own column and row, so each month stays together as one block
    for (let day = 1; day <= daysInMonth; day++) {
      const slot = startRow + day - 1;
      const date = formatDate(new Date(year, m, day));

      const box = document.createElement("div");
      box.className = "day";
      box.dataset.date = date;
      box.title = date;
      box.style.gridColumn = column + Math.floor(slot / 7);
      box.style.gridRow = (slot % 7) + 1;

      if (date === todayText) {
        box.classList.add("today");
      }

      grid.appendChild(box);
    }

    for (let w = 0; w < weeks; w++) tracks.push("minmax(0, 1fr)");
    column += weeks;
    weekColumns += weeks;

    // a narrow empty column between one month and the next
    if (m < 11) {
      tracks.push("var(--month-gap)");
      column += 1;
    }
  }

  grid.style.gridTemplateColumns = tracks.join(" ");
  monthRow.style.gridTemplateColumns = tracks.join(" ");
  document.getElementById("calendarInner").style.setProperty("--cols", weekColumns);
}

buildCalendar();

const logBox = document.getElementById("logBox");
const logDate = document.getElementById("logDate");
const intensity = document.getElementById("intensity");
const intensityPicker = document.getElementById("intensityPicker");
const logError = document.getElementById("logError");
const deleteLogBtn = document.getElementById("deleteLog");
let selectedDate = null;

const logFolder = document.getElementById("logFolder");
const logFolderField = document.getElementById("logFolderField");
const logFolderChips = document.getElementById("logFolderChips");
const createSplitBtn = document.getElementById("createSplitBtn");
let logExisting = null;      // the workout already saved on the selected day, if there is one

bindSegmented(intensityPicker, intensity);

// A day can only be logged with a folder. This fills the dropdown in the log panel.
// Old workouts that were typed by hand (before folders existed) stay editable through one extra option.
function renderLogFolders(preferred) {
  const keep = preferred !== undefined ? preferred : logFolder.value;
  const hasOld = !!logExisting && !folders.some(f => f.id === logExisting.folderId);
  const noFolders = folders.length === 0 && !hasOld;

  logFolder.hidden = noFolders;
  createSplitBtn.hidden = !noFolders;
  logFolder.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a split";
  placeholder.disabled = true;
  logFolder.appendChild(placeholder);

  folders.forEach(f => {
    const option = document.createElement("option");
    option.value = f.id;
    option.textContent = f.name;
    logFolder.appendChild(option);
  });

  if (hasOld) {
    const option = document.createElement("option");
    option.value = "__old__";
    option.textContent = (logExisting.folder || logExisting.workout) + " (previous workout)";
    logFolder.appendChild(option);
  }

  if (folders.some(f => f.id === keep)) logFolder.value = keep;
  else if (hasOld) logFolder.value = "__old__";
  else logFolder.value = "";

  showFolderChips();
}

// shows the exercises of the chosen folder under the dropdown
function showFolderChips() {
  logFolderChips.innerHTML = "";
  const folder = folders.find(f => f.id === logFolder.value);
  const list = folder ? folder.exercises
    : (logFolder.value === "__old__" && logExisting.exercises) ? logExisting.exercises
    : [];
  logFolderChips.hidden = list.length === 0;

  list.forEach(name => {
    const chip = document.createElement("span");
    chip.className = "ex-chip";
    chip.textContent = name;
    logFolderChips.appendChild(chip);
  });
}

logFolder.addEventListener("change", showFolderChips);

// no folders yet: take the user straight to the new-folder window
createSplitBtn.addEventListener("click", () => {
  logBox.hidden = true;
  showPage("workouts");
  document.querySelector('.tab[data-tab="foldersTab"]').click();
  openFolderEditor(null);
});

// current streak = days in a row up to today (or yesterday if today is not logged yet)
function calcStreaks() {
  const dates = Object.keys(logs).sort();
  if (dates.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const before = new Date(dates[i - 1] + "T00:00:00");
    const after = new Date(dates[i] + "T00:00:00");
    const gap = Math.round((after - before) / 86400000);
    run = gap === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  let current = 0;
  const day = new Date();
  if (!logs[formatDate(day)]) day.setDate(day.getDate() - 1);
  while (logs[formatDate(day)]) {
    current++;
    day.setDate(day.getDate() - 1);
  }

  return { current: current, longest: longest };
}

function renderStreaks() {
  const streaks = calcStreaks();
  const thisMonth = formatDate(new Date()).slice(0, 7);

  document.getElementById("streakCurrent").textContent = streaks.current;
  document.getElementById("streakLongest").textContent = streaks.longest;
  document.getElementById("streakMonth").textContent =
    Object.keys(logs).filter(date => date.startsWith(thisMonth)).length;
  document.getElementById("streakTotal").textContent = Object.keys(logs).length;
}

function paintCalendar() {
  document.querySelectorAll("#grid .day[data-date]").forEach(box => {
    box.classList.remove("light", "moderate", "failure");
    box.title = box.dataset.date;
    const log = logs[box.dataset.date];
    if (log) {
      box.classList.add(log.intensity);
      box.title = `${box.dataset.date}: ${log.workout}`;
    }
  });
  renderStreaks();
}

function openLog(date) {
  selectedDate = date;
  const existing = logs[date];

  const pretty = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  logDate.textContent = date === formatDate(new Date()) ? pretty + " (today)" : pretty;
  logExisting = existing || null;
  renderLogFolders(existing && existing.folderId ? existing.folderId : "");
  intensity.value = existing ? existing.intensity : "";
  syncSegmented(intensityPicker, intensity);
  logError.textContent = "";
  deleteLogBtn.hidden = !existing;
  logBox.hidden = false;
  logBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

grid.addEventListener("click", (e) => {
  const box = e.target.closest(".day");
  if (!box || box.classList.contains("empty")) return;

  if (!currentUser) {
    openAuth(false);
    return;
  }

  openLog(box.dataset.date);
});

document.getElementById("saveLog").addEventListener("click", async () => {
  const choice = logFolder.value;

  if (folders.length === 0 && !logExisting) {
    logError.textContent = "Create a split first, then come back to log your workout.";
    return;
  }

  if (choice === "" || intensity.value === "") {
    logError.textContent = "Please choose a split and an intensity.";
    return;
  }

  let entry;
  if (choice === "__old__") {
    // an old hand-typed workout: keep it as it was, only the intensity can change
    entry = { ...logExisting, intensity: intensity.value };
  } else {
    // the workout is named after the folder; a copy of its exercises is kept for that day
    const chosen = folders.find(f => f.id === choice);
    entry = {
      workout: chosen.name,
      intensity: intensity.value,
      folderId: chosen.id,
      folder: chosen.name,
      exercises: chosen.exercises.slice()
    };
  }

  try {
    await setDoc(doc(db, "users", currentUser.uid, "logs", selectedDate), entry);
    logs[selectedDate] = entry;
    paintCalendar();
    renderHistory();
    logBox.hidden = true;
    showToast("Workout saved");

    // little pop animation on the square that was just saved
    const square = grid.querySelector(`.day[data-date="${selectedDate}"]`);
    if (square) {
      square.classList.add("pop");
      setTimeout(() => square.classList.remove("pop"), 500);
    }
  } catch (error) {
    logError.textContent = "Could not save. Please try again.";
  }
});

// deletes one workout (used by the calendar and by the history list)
async function removeLog(date) {
  const sure = await askConfirm(
    "Delete this workout?",
    "The workout logged on " + date + " will be removed from your calendar and history.",
    "Delete workout"
  );
  if (!sure) return false;

  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "logs", date));
    delete logs[date];
    paintCalendar();
    renderHistory();
    showToast("Workout deleted");
    return true;
  } catch (error) {
    showToast("Could not delete. Please try again.");
    return false;
  }
}

deleteLogBtn.addEventListener("click", async () => {
  const done = await removeLog(selectedDate);
  if (done) logBox.hidden = true;
});

document.getElementById("cancelLog").addEventListener("click", () => {
  logBox.hidden = true;
});

document.getElementById("calLogToday").addEventListener("click", () => {
  openLog(formatDate(new Date()));
});

// ---------- progress (exercises and chart) ----------
const exList = document.getElementById("exerciseList");
const chartCard = document.getElementById("chartCard");
const chartSelect = document.getElementById("chartSelect");
const chartSummary = document.getElementById("chartSummary");
const chartBox = document.getElementById("chartBox");

function makeId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// every exercise remembers if you use kg or lb (old ones count as kg)
function unitOf(ex) {
  return ex && ex.unit === "lb" ? "lb" : "kg";
}

function convertWeight(value, from, to) {
  if (from === to) return value;
  const result = from === "kg" ? value * 2.2046226 : value / 2.2046226;
  return Math.round(result * 10) / 10;
}

function renderChart() {
  chartBox.innerHTML = "";
  chartSummary.textContent = "";

  if (!chartSelect.value) {
    chartBox.textContent = "Create a split to see your charts.";
    return;
  }
  const ex = exercises.find(item => item.id === chartSelect.value);
  if (!ex) {
    chartBox.textContent = "No history yet. Save a weight for this exercise in the box above.";
    return;
  }

  const history = (ex.history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (history.length === 0) {
    chartBox.textContent = "No history yet. Save a weight for this exercise in the box above.";
    return;
  }

  const n = history.length;
  const firstWeight = history[0].weight;
  const lastWeight = history[n - 1].weight;
  const change = Math.round((lastWeight - firstWeight) * 10) / 10;
  const u = unitOf(ex);
  chartSummary.textContent =
    `${firstWeight} ${u} to ${lastWeight} ${u} (${change >= 0 ? "+" : ""}${change} ${u})`;

  const W = 600, H = 260, left = 48, right = 20, top = 20, bottom = 36;
  const weights = history.map(h => h.weight);
  const low = Math.max(0, Math.min(...weights) - 5);
  const high = Math.max(...weights) + 5;

  const x = i => (n === 1 ? (left + W - right) / 2 : left + (i * (W - left - right)) / (n - 1));
  const y = w => top + ((high - w) * (H - top - bottom)) / (high - low);

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg">`;

  // horizontal grid lines with weight labels
  for (let t = 0; t <= 4; t++) {
    const value = low + (t * (high - low)) / 4;
    const lineY = y(value);
    svg += `<line class="chart-grid" x1="${left}" x2="${W - right}" y1="${lineY}" y2="${lineY}"/>`;
    svg += `<text class="chart-text" x="${left - 8}" y="${lineY + 4}" text-anchor="end">${Math.round(value)}</text>`;
  }

  // the line, then the dots and date labels
  const points = history.map((h, i) => `${x(i)},${y(h.weight)}`).join(" ");
  svg += `<polyline class="chart-line" pathLength="1" points="${points}"/>`;

  history.forEach((h, i) => {
    svg += `<circle class="chart-dot" cx="${x(i)}" cy="${y(h.weight)}" r="5"><title>${h.date}: ${h.weight} ${u} for ${h.reps} reps</title></circle>`;
    if (i === 0 || i === n - 1 || n <= 6) {
      svg += `<text class="chart-text" x="${x(i)}" y="${H - 12}" text-anchor="middle">${h.date.slice(5)}</text>`;
    }
  });

  svg += "</svg>";
  chartBox.innerHTML = svg;
}

chartSelect.addEventListener("change", renderChart);

// one card for every exercise
function renderExercises(selectId) {
  renderHome();
  exList.innerHTML = "";

  if (exercises.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No lifts saved yet. Pick a split above and add your weights to start tracking.";
    exList.appendChild(empty);
  }

  exercises.forEach(ex => {
    const card = document.createElement("div");
    card.className = "ex-card";

    const name = document.createElement("h4");
    name.textContent = ex.name;

    // latest weight, max weight and reps
    const stats = document.createElement("div");
    stats.className = "ex-stats";
    [["Latest", ex.latest + " " + unitOf(ex)], ["Max", ex.max + " " + unitOf(ex)], ["Reps", ex.reps]].forEach(pair => {
      const box = document.createElement("div");
      const value = document.createElement("strong");
      value.textContent = pair[1];
      const label = document.createElement("small");
      label.textContent = pair[0];
      box.append(value, label);
      stats.appendChild(box);
    });

    // bar: how close the latest weight is to the max
    const bar = document.createElement("div");
    bar.className = "ex-bar";
    const fill = document.createElement("span");
    fill.style.width = Math.min(100, Math.round((ex.latest / ex.max) * 100)) + "%";
    bar.appendChild(fill);

    // change since the first saved entry
    const history = (ex.history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const change = document.createElement("p");
    change.className = "ex-change";
    if (history.length > 1) {
      const diff = Math.round((history[history.length - 1].weight - history[0].weight) * 10) / 10;
      change.textContent = (diff > 0 ? "+" : "") + diff + " " + unitOf(ex) + " since your first entry";
      change.classList.add(diff > 0 ? "up" : diff < 0 ? "down" : "flat");
    } else {
      change.textContent = "Update this lift later to see your change";
    }

    const actions = document.createElement("div");
    actions.className = "ex-actions";

    const chartBtn = document.createElement("button");
    chartBtn.textContent = "Chart";
    chartBtn.className = "btn-small btn-ghost";
    chartBtn.addEventListener("click", () => {
      chartSelect.value = ex.id;
      renderChart();
      chartCard.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const updateBtn = document.createElement("button");
    updateBtn.textContent = "Update";
    updateBtn.className = "btn-small btn-ghost";
    updateBtn.addEventListener("click", () => {
      const split = folders.find(f => f.exercises.some(n => makeId(n) === ex.id));
      if (!split) {
        showToast("Add this exercise to a split first");
        return;
      }
      document.getElementById("flSelect").value = split.id;
      buildFolderRows();
      const row = [...document.querySelectorAll("#flRows .fl-row")]
        .find(r => makeId(r.dataset.name) === ex.id);
      document.getElementById("folderLog").scrollIntoView({ behavior: "smooth", block: "center" });
      if (row) row.querySelector(".fl-w").focus();
    });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "btn-small btn-danger";
    del.addEventListener("click", async () => {
      const sure = await askConfirm(
        'Delete "' + ex.name + '"?',
        "Its saved weights and chart history will be removed. This can't be undone.",
        "Delete lift"
      );
      if (!sure) return;
      try {
        await deleteDoc(doc(db, "users", currentUser.uid, "exercises", ex.id));
        exercises = exercises.filter(item => item.id !== ex.id);
        renderExercises();
        showToast("Exercise deleted");
      } catch (error) {
        showToast("Could not delete. Please try again.");
      }
    });

    actions.append(chartBtn, updateBtn, del);
    card.append(name, stats, bar, change, actions);
    exList.appendChild(card);
  });

  // fill the chart dropdown from your splits and keep the same exercise selected
  const previous = selectId || chartSelect.value;
  chartSelect.innerHTML = "";
  const seen = new Set();

  function addGroup(label, names) {
    const group = document.createElement("optgroup");
    group.label = label;
    names.forEach(name => {
      const id = makeId(name);
      if (seen.has(id)) return;
      seen.add(id);
      const option = document.createElement("option");
      option.value = id;
      option.textContent = name;
      group.appendChild(option);
    });
    if (group.children.length) chartSelect.appendChild(group);
  }

  folders.forEach(f => addGroup(f.name, f.exercises));
  // lifts you saved earlier that are not in any split
  addGroup("Other", exercises.map(ex => ex.name));

  if ([...chartSelect.options].some(o => o.value === previous)) {
    chartSelect.value = previous;
  }
  renderChart();
  renderFolderLog();
}

// ---------- update lifts straight from a split ----------
// shows the folders in the dropdown and builds one row per exercise of the chosen folder
function renderFolderLog() {
  const card = document.getElementById("folderLog");
  const select = document.getElementById("flSelect");
  card.style.display = folders.length ? "" : "none";

  const keep = select.value;
  select.innerHTML = "";
  folders.forEach(f => {
    const option = document.createElement("option");
    option.value = f.id;
    option.textContent = f.name;
    select.appendChild(option);
  });
  if (folders.some(f => f.id === keep)) select.value = keep;
  buildFolderRows();
}

function buildFolderRows() {
  const rows = document.getElementById("flRows");
  rows.innerHTML = "";
  const folder = folders.find(f => f.id === document.getElementById("flSelect").value);
  if (!folder) return;

  folder.exercises.forEach(name => {
    // the last saved numbers show as hints, so you only type what changed
    const saved = exercises.find(ex => ex.id === makeId(name));

    const row = document.createElement("div");
    row.className = "fl-row";
    row.dataset.name = name;

    const label = document.createElement("span");
    label.textContent = name;

    const w = document.createElement("input");
    w.type = "number";
    w.className = "fl-w";
    w.step = "any";

    // kg or lb, remembered for each exercise
    const u = document.createElement("select");
    u.className = "fl-u";
    u.setAttribute("aria-label", "Weight unit");
    ["kg", "lb"].forEach(unit => {
      const option = document.createElement("option");
      option.value = unit;
      option.textContent = unit;
      u.appendChild(option);
    });
    u.value = unitOf(saved);

    const r = document.createElement("input");
    r.type = "number";
    r.className = "fl-r";
    r.placeholder = saved ? saved.reps + " reps" : "reps";

    function showHint() {
      w.placeholder = saved
        ? convertWeight(saved.latest, unitOf(saved), u.value) + " " + u.value
        : u.value;
    }
    u.addEventListener("change", showHint);
    showHint();

    row.append(label, w, u, r);
    rows.appendChild(row);
  });
}

document.getElementById("flSelect").addEventListener("change", buildFolderRows);

document.getElementById("flSave").addEventListener("click", async () => {
  const err = document.getElementById("flError");
  if (!currentUser) {
    err.textContent = "Please log in first.";
    return;
  }

  const today = formatDate(new Date());
  let count = 0;

  for (const row of document.querySelectorAll("#flRows .fl-row")) {
    const name = row.dataset.name;
    const id = makeId(name);
    const existing = exercises.find(ex => ex.id === id);

    const typedWeight = Number(row.querySelector(".fl-w").value);
    const typedReps = Number(row.querySelector(".fl-r").value);
    const unit = row.querySelector(".fl-u").value;
    if (!typedWeight && !typedReps) continue; // empty row, skip it

    // if you switched kg or lb, the old numbers are converted so the chart stays in one unit
    let base = existing;
    if (existing && unitOf(existing) !== unit) {
      const from = unitOf(existing);
      base = {
        ...existing,
        latest: convertWeight(existing.latest, from, unit),
        max: convertWeight(existing.max, from, unit),
        history: (existing.history || []).map(h => ({ ...h, weight: convertWeight(h.weight, from, unit) }))
      };
    }

    // anything you leave blank uses the last saved number
    const latest = typedWeight || (base ? base.latest : 0);
    const reps = typedReps || (base ? base.reps : 0);

    if (latest <= 0 || reps <= 0 || !Number.isInteger(reps)) {
      err.textContent = "Check " + name + ": add a weight and a whole number of reps.";
      return;
    }

    const max = Math.max(latest, base ? base.max : 0);
    const history = base && base.history
      ? base.history.filter(h => h.date !== today)
      : [];
    history.push({ date: today, weight: latest, reps: reps });

    const data = { name: name, latest: latest, max: max, reps: reps, unit: unit, history: history };
    try {
      await setDoc(doc(db, "users", currentUser.uid, "exercises", id), data);
      const saved = { id: id, ...data };
      if (existing) {
        exercises = exercises.map(ex => (ex.id === id ? saved : ex));
      } else {
        exercises.push(saved);
      }
      count++;
    } catch (error) {
      err.textContent = "Could not save " + name + ". Please try again.";
      return;
    }
  }

  if (count === 0) {
    err.textContent = "Type a weight or reps for at least one exercise.";
    return;
  }

  err.textContent = "";
  renderExercises();
  showToast(count + (count === 1 ? " exercise updated" : " exercises updated"));
});

// ---------- workouts history (search, filter, grouped by month) ----------
const searchBox = document.getElementById("searchBox");
const filterIntensity = document.getElementById("filterIntensity");
const historyList = document.getElementById("historyList");
const historyCount = document.getElementById("historyCount");

const intensityNames = {
  light: "Light",
  moderate: "Moderate",
  failure: "Failure"
};

// one row in the history list
function makeHistoryRow(date) {
  const log = logs[date];
  const d = new Date(date + "T00:00:00");

  const row = document.createElement("li");
  row.className = "h-row";

  const box = document.createElement("div");
  box.className = "h-datebox";
  const dayNumber = document.createElement("strong");
  dayNumber.textContent = d.getDate();
  const weekday = document.createElement("small");
  weekday.textContent = d.toLocaleDateString("en-US", { weekday: "short" });
  box.append(dayNumber, weekday);

  const main = document.createElement("div");
  main.className = "h-main";
  const name = document.createElement("strong");
  name.textContent = log.workout;
  const full = document.createElement("small");
  full.textContent = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    (log.folder ? " · " + log.folder : "");
  if (log.exercises && log.exercises.length) full.title = log.exercises.join(", ");
  main.append(name, full);

  const badge = document.createElement("span");
  badge.className = "badge " + log.intensity;
  badge.textContent = intensityNames[log.intensity];

  const actions = document.createElement("div");
  actions.className = "h-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "row-btn";
  editBtn.title = "Edit";
  editBtn.setAttribute("aria-label", "Edit workout");
  editBtn.innerHTML = '<svg class="ic"><use href="#i-edit"/></svg>';
  editBtn.addEventListener("click", () => {
    showPage("calendar");
    openLog(date);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "row-btn danger";
  deleteBtn.title = "Delete";
  deleteBtn.setAttribute("aria-label", "Delete workout");
  deleteBtn.innerHTML = '<svg class="ic"><use href="#i-trash"/></svg>';
  deleteBtn.addEventListener("click", () => removeLog(date));

  actions.append(editBtn, deleteBtn);
  row.append(box, main, badge, actions);
  return row;
}

function renderHistory() {
  renderHome();
  const text = searchBox.value.trim().toLowerCase();
  const level = filterIntensity.value;

  const allDates = Object.keys(logs).sort().reverse();
  const dates = allDates.filter(date => {
    const log = logs[date];
    if (level !== "" && log.intensity !== level) return false;
    if (text !== "" && !log.workout.toLowerCase().includes(text)) return false;
    return true;
  });

  historyList.innerHTML = "";
  historyCount.textContent = dates.length === allDates.length
    ? allDates.length + (allDates.length === 1 ? " workout" : " workouts")
    : "Showing " + dates.length + " of " + allDates.length + " workouts";

  if (dates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = allDates.length === 0
      ? "No workouts yet. Log one from your calendar."
      : "No workouts match your search.";
    historyList.appendChild(empty);
    return;
  }

  // group the workouts by month, newest month first
  const groups = {};
  dates.forEach(date => {
    const key = date.slice(0, 7);
    if (!groups[key]) groups[key] = [];
    groups[key].push(date);
  });

  Object.keys(groups).forEach(key => {
    const monthName = new Date(key + "-01T00:00:00").toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });

    const heading = document.createElement("h4");
    heading.className = "month-head";
    heading.textContent = monthName;
    const count = document.createElement("span");
    count.textContent = groups[key].length + (groups[key].length === 1 ? " workout" : " workouts");
    heading.appendChild(count);

    const list = document.createElement("ul");
    list.className = "h-list";
    groups[key].forEach(date => list.appendChild(makeHistoryRow(date)));

    historyList.append(heading, list);
  });
}

searchBox.addEventListener("input", renderHistory);
bindSegmented(document.getElementById("intensityFilter"), filterIntensity, renderHistory);

// ---------- exercise library and folders ----------
const LIBRARY = {
  Chest: ["Bench Press", "Incline Bench Press", "Decline Bench Press", "Dumbbell Bench Press", "Incline Dumbbell Press", "Decline Dumbbell Press", "Smith Machine Bench Press", "Machine Chest Press", "Incline Machine Press", "Chest Fly", "Incline Dumbbell Fly", "Decline Dumbbell Fly", "Cable Crossover", "Low Cable Fly", "High Cable Fly", "Pec Deck", "Push Up", "Wide Push Up", "Diamond Push Up", "Incline Push Up", "Decline Push Up", "Chest Dip", "Svend Press", "Landmine Press", "Dumbbell Pullover", "Floor Press", "Pause Bench Press", "Resistance Band Chest Press"],
  Back: ["Deadlift", "Rack Pull", "Pull Up", "Wide Grip Pull Up", "Neutral Grip Pull Up", "Assisted Pull Up", "Chin Up", "Lat Pulldown", "Close Grip Lat Pulldown", "Wide Grip Lat Pulldown", "Reverse Grip Lat Pulldown", "Straight Arm Pulldown", "Cable Pullover", "Barbell Row", "Pendlay Row", "Yates Row", "Dumbbell Row", "Single Arm Cable Row", "Seated Cable Row", "Chest Supported Row", "Machine Row", "T Bar Row", "Landmine Row", "Meadows Row", "Seal Row", "Inverted Row", "Face Pull", "Back Extension", "Reverse Hyperextension", "Good Morning", "Superman"],
  Shoulders: ["Overhead Press", "Seated Barbell Press", "Dumbbell Shoulder Press", "Machine Shoulder Press", "Arnold Press", "Push Press", "Behind The Neck Press", "Landmine Shoulder Press", "Cuban Press", "Lateral Raise", "Cable Lateral Raise", "Leaning Lateral Raise", "Machine Lateral Raise", "Front Raise", "Plate Front Raise", "Cable Front Raise", "Rear Delt Fly", "Reverse Pec Deck", "Cable Rear Delt Fly", "Bent Over Rear Delt Raise", "Upright Row", "Band Pull Apart", "Y Raise", "Pike Push Up", "Handstand Push Up"],
  Traps: ["Shrugs", "Barbell Shrug", "Dumbbell Shrug", "Trap Bar Shrug", "Smith Machine Shrug", "Cable Shrug", "Behind The Back Shrug", "Snatch Grip High Pull", "Prone Trap Raise"],
  Biceps: ["Barbell Curl", "EZ Bar Curl", "Dumbbell Curl", "Alternating Dumbbell Curl", "Incline Dumbbell Curl", "Hammer Curl", "Cross Body Hammer Curl", "Rope Hammer Curl", "Cable Hammer Curl", "Preacher Curl", "Dumbbell Preacher Curl", "Machine Preacher Curl", "Cable Curl", "Concentration Curl", "Spider Curl", "Drag Curl", "Zottman Curl", "Bayesian Curl", "Behind The Back Cable Curl", "21s Curl", "Resistance Band Curl"],
  Triceps: ["Tricep Pushdown", "Rope Pushdown", "V Bar Pushdown", "Reverse Grip Pushdown", "Single Arm Cable Pushdown", "Band Tricep Pushdown", "Skull Crusher", "Dumbbell Skull Crusher", "Overhead Tricep Extension", "Cable Overhead Tricep Extension", "Seated Dumbbell Tricep Extension", "Close Grip Bench Press", "JM Press", "Tate Press", "Tricep Dip", "Bench Dip", "Machine Tricep Dip", "Tricep Kickback", "Cable Tricep Kickback", "Tricep Extension Machine"],
  Forearms: ["Wrist Curl", "Barbell Wrist Curl", "Dumbbell Wrist Curl", "Cable Wrist Curl", "Reverse Wrist Curl", "Behind The Back Wrist Curl", "Reverse Curl", "Cable Reverse Curl", "Finger Curl", "Wrist Roller", "Gripper Crush", "Plate Pinch", "Dead Hang", "Farmers Walk", "Suitcase Carry", "Dumbbell Pronation", "Dumbbell Supination"],
  Core: ["Plank", "Side Plank", "Plank Shoulder Tap", "Body Saw Plank", "Crunches", "Decline Crunch", "Weighted Crunch", "Machine Crunch", "Cable Crunch", "Bicycle Crunch", "Reverse Crunch", "Oblique Crunch", "Sit Up", "Decline Sit Up", "V Up", "Leg Raise", "Hanging Leg Raise", "Hanging Knee Raise", "Captains Chair Leg Raise", "Toes To Bar", "Flutter Kicks", "Heel Touch", "Russian Twist", "Landmine Twist", "Woodchopper", "Cable Woodchop", "Pallof Press", "Ab Wheel Rollout", "Dragon Flag", "Hollow Hold", "L Sit", "Dead Bug", "Bird Dog", "Stir The Pot", "Mountain Climbers", "Medicine Ball Slam"],
  Glutes: ["Hip Thrust", "Single Leg Hip Thrust", "Smith Machine Hip Thrust", "Glute Bridge", "Single Leg Glute Bridge", "Banded Glute Bridge", "Frog Pump", "Romanian Deadlift", "Sumo Deadlift", "Cable Pull Through", "Cable Kickback", "Glute Kickback Machine", "Donkey Kick", "Fire Hydrant", "Hip Abduction", "Banded Lateral Walk", "Step Up", "Curtsy Lunge"],
  Quads: ["Squat", "Front Squat", "Box Squat", "Pause Squat", "Zercher Squat", "Overhead Squat", "Safety Bar Squat", "Smith Machine Squat", "Goblet Squat", "Hack Squat", "Pendulum Squat", "Belt Squat", "Sissy Squat", "Spanish Squat", "Cossack Squat", "Pistol Squat", "Jump Squat", "Box Jump", "Wall Sit", "Leg Press", "Single Leg Press", "Leg Extension", "Lunges", "Walking Lunges", "Reverse Lunge", "Forward Lunge", "Lateral Lunge", "Split Squat", "Bulgarian Split Squat", "Hip Adduction", "Copenhagen Plank"],
  Hamstrings: ["Leg Curl", "Lying Leg Curl", "Seated Leg Curl", "Standing Leg Curl", "Stiff Leg Deadlift", "Dumbbell Romanian Deadlift", "Single Leg Romanian Deadlift", "Nordic Hamstring Curl", "Glute Ham Raise", "Swiss Ball Leg Curl", "Slider Leg Curl"],
  Calves: ["Calf Raise", "Standing Calf Raise", "Seated Calf Raise", "Leg Press Calf Raise", "Donkey Calf Raise", "Single Leg Calf Raise", "Smith Machine Calf Raise", "Tibialis Raise"],
  Cardio: ["Running", "Treadmill", "Walking", "Incline Walk", "Sprints", "Hill Sprints", "Hiking", "Cycling", "Stationary Bike", "Assault Bike", "Rowing Machine", "Ski Erg", "Stair Climber", "Elliptical", "Jump Rope", "Jumping Jacks", "High Knees", "Burpees", "Battle Ropes", "Boxing", "Shadow Boxing", "Swimming", "Sled Push", "Sled Pull", "HIIT", "Dancing"],
  "Full Body": ["Clean", "Power Clean", "Hang Clean", "Snatch", "Clean And Jerk", "Thruster", "Kettlebell Swing", "Kettlebell Clean", "Kettlebell Snatch", "Turkish Get Up", "Devil Press", "Man Maker", "Wall Ball", "Bear Crawl", "Sandbag Carry", "Tire Flip"]
};

const allLibraryNames = Object.values(LIBRARY).flat();

// finds which muscle group an exercise belongs to (custom exercises have none)
function muscleOf(name) {
  return Object.keys(LIBRARY).find(group => LIBRARY[group].includes(name)) || "";
}

// real pictures can go here later, e.g. "Bench Press": "images/bench-press.jpg"
const EXERCISE_IMAGES = {};

// the small picture shown before an exercise name (a photo if we have one, else its muscle icon)
function exerciseThumb(name) {
  const thumb = document.createElement("span");
  thumb.className = "ex-thumb";

  if (EXERCISE_IMAGES[name]) {
    const img = document.createElement("img");
    img.src = EXERCISE_IMAGES[name];
    img.alt = "";
    img.loading = "lazy";
    thumb.appendChild(img);
    return thumb;
  }

  const group = muscleOf(name);
  const icon = group ? "i-m-" + group.toLowerCase().replace(/\s+/g, "-") : "i-dumbbell";
  thumb.innerHTML = '<svg class="ic"><use href="#' + icon + '"/></svg>';
  return thumb;
}

const folderList = document.getElementById("folderList");
const folderModal = document.getElementById("folderModal");
const folderName = document.getElementById("folderName");
const folderError = document.getElementById("folderError");
const libSearch = document.getElementById("libSearch");
let editingFolderId = null;
let folderDrafts = {};   // unsaved folder windows, so a misclick doesn't lose them ("new" = the New Folder window)
let picked = new Set();
let activeMuscle = "All";

// the folder cards
function renderFolders() {
  renderLogFolders();
  renderFolderLog();
  folderList.innerHTML = "";

  if (folders.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No splits yet. Create one like Push Day or Leg Day.";
    folderList.appendChild(empty);
    return;
  }

  folders.forEach(folder => {
    const card = document.createElement("div");
    card.className = "folder-card";

    const head = document.createElement("div");
    head.className = "folder-head";
    const title = document.createElement("h4");
    title.textContent = folder.name;
    const count = document.createElement("span");
    count.textContent = folder.exercises.length + (folder.exercises.length === 1 ? " exercise" : " exercises");
    head.append(title, count);

    const rows = document.createElement("ul");
    rows.className = "folder-ex-list";
    folder.exercises.slice(0, 4).forEach(name => {
      const li = document.createElement("li");

      const text = document.createElement("span");
      text.className = "ex-text";
      const label = document.createElement("strong");
      label.textContent = name;
      const group = document.createElement("small");
      group.textContent = muscleOf(name) || "Custom";
      text.append(label, group);

      li.append(exerciseThumb(name), text);
      rows.appendChild(li);
    });
    if (folder.exercises.length > 4) {
      const more = document.createElement("li");
      more.className = "more";
      more.textContent = "+" + (folder.exercises.length - 4) + " more";
      rows.appendChild(more);
    }

    const actions = document.createElement("div");
    actions.className = "ex-actions";

    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.className = "btn-small btn-ghost";
    edit.addEventListener("click", () => openFolderEditor(folder));

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "btn-small btn-danger";
    del.addEventListener("click", () => removeFolder(folder));

    actions.append(edit, del);
    card.append(head, rows, actions);
    folderList.appendChild(card);
  });
}

// draws everything inside the folder window
function renderPicker() {
  // the exercises picked so far (the x removes one)
  const chips = document.getElementById("pickedChips");
  chips.innerHTML = "";
  picked.forEach(name => {
    const chip = document.createElement("span");
    chip.className = "ex-chip picked";
    chip.textContent = name;

    const x = document.createElement("button");
    x.type = "button";
    x.className = "chip-x";
    x.setAttribute("aria-label", "Remove " + name);
    x.textContent = "×";
    x.addEventListener("click", () => {
      picked.delete(name);
      renderPicker();
    });

    chip.appendChild(x);
    chips.appendChild(chip);
  });
  document.getElementById("pickedCount").textContent = picked.size + " selected";

  // muscle group buttons
  const muscleBox = document.getElementById("muscleChips");
  muscleBox.innerHTML = "";
  ["All", ...Object.keys(LIBRARY)].forEach(group => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = group;
    b.className = "muscle-chip" + (group === activeMuscle ? " active" : "");
    b.addEventListener("click", () => {
      activeMuscle = group;
      renderPicker();
    });
    muscleBox.appendChild(b);
  });

  // the library list
  const list = document.getElementById("libList");
  const keepScroll = list.scrollTop;
  list.innerHTML = "";
  const text = libSearch.value.trim().toLowerCase();
  let shown = 0;

  Object.keys(LIBRARY).forEach(group => {
    if (activeMuscle !== "All" && activeMuscle !== group) return;

    const names = LIBRARY[group].filter(n => n.toLowerCase().includes(text));
    if (names.length === 0) return;

    const heading = document.createElement("h5");
    heading.className = "lib-group";
    heading.textContent = group;

    const gridBox = document.createElement("div");
    gridBox.className = "lib-grid";

    names.forEach(n => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lib-item" + (picked.has(n) ? " on" : "");
      const label = document.createElement("span");
      label.textContent = n;
      b.append(exerciseThumb(n), label);
      b.addEventListener("click", () => {
        if (picked.has(n)) picked.delete(n);
        else picked.add(n);
        renderPicker();
      });
      gridBox.appendChild(b);
      shown++;
    });

    list.append(heading, gridBox);
  });

  if (shown === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No exercise found. You can add your own below.";
    list.appendChild(empty);
  }

  list.scrollTop = keepScroll;
}

function openFolderEditor(folder) {
  editingFolderId = folder ? folder.id : null;
  document.getElementById("folderModalTitle").textContent = folder ? "Edit split" : "New split";

  const draft = folderDrafts[editingFolderId || "new"];
  if (draft) {
    // bring back what the user had before the window got closed
    folderName.value = draft.name;
    picked = new Set(draft.picked);
    activeMuscle = draft.muscle;
    libSearch.value = draft.search;
    document.getElementById("customExercise").value = draft.custom;
    showToast("Restored your unsaved changes");
  } else {
    folderName.value = folder ? folder.name : "";
    picked = new Set(folder ? folder.exercises : []);
    activeMuscle = "All";
    libSearch.value = "";
    document.getElementById("customExercise").value = "";
  }

  folderError.textContent = "";
  renderPicker();
  folderModal.hidden = false;
  folderName.focus();
}

// keepDraft = true when the window was closed by accident (click outside or Escape)
function closeFolderEditor(keepDraft) {
  const key = editingFolderId || "new";
  const custom = document.getElementById("customExercise").value;

  if (keepDraft === true && (folderName.value.trim() !== "" || picked.size > 0 || custom.trim() !== "")) {
    folderDrafts[key] = {
      name: folderName.value,
      picked: Array.from(picked),
      muscle: activeMuscle,
      search: libSearch.value,
      custom: custom
    };
  } else {
    delete folderDrafts[key];
  }

  folderModal.hidden = true;
}

// add an exercise that is not in the library
function addCustomExercise() {
  const input = document.getElementById("customExercise");
  const name = input.value.trim();
  if (name === "") return;

  // reuse the library spelling if it is already there
  const match = allLibraryNames.find(n => n.toLowerCase() === name.toLowerCase());
  picked.add(match || name);
  input.value = "";
  renderPicker();
}

async function saveFolder() {
  const name = folderName.value.trim();

  if (name === "" || !/[A-Za-z0-9]/.test(name)) {
    folderError.textContent = "Please give your split a name.";
    return;
  }
  if (picked.size === 0) {
    folderError.textContent = "Pick at least 1 exercise.";
    return;
  }

  const id = editingFolderId || makeId(name);
  const clash = folders.some(f =>
    f.id !== editingFolderId && (f.id === id || f.name.toLowerCase() === name.toLowerCase())
  );
  if (clash) {
    folderError.textContent = "You already have a split with that name.";
    return;
  }

  const data = { name: name, exercises: [...picked] };

  try {
    await setDoc(doc(db, "users", currentUser.uid, "folders", id), data);

    const saved = { id: id, ...data };
    if (editingFolderId) {
      folders = folders.map(f => (f.id === id ? saved : f));
    } else {
      folders.push(saved);
    }

    renderFolders();
    closeFolderEditor();
    showToast(editingFolderId ? "Split updated" : "Split created");
  } catch (error) {
    folderError.textContent = "Could not save. Please try again.";
  }
}

async function removeFolder(folder) {
  const sure = await askConfirm(
    'Delete "' + folder.name + '"?',
    "Only the split is removed. Your saved weights, charts and logged workouts stay.",
    "Delete split"
  );
  if (!sure) return;

  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "folders", folder.id));
    folders = folders.filter(f => f.id !== folder.id);
    delete folderDrafts[folder.id];
    renderFolders();
    showToast("Split deleted");
  } catch (error) {
    showToast("Could not delete. Please try again.");
  }
}

document.getElementById("newFolderBtn").addEventListener("click", () => openFolderEditor(null));
document.getElementById("closeFolder").addEventListener("click", () => closeFolderEditor(false));
document.getElementById("cancelFolder").addEventListener("click", () => closeFolderEditor(false));
document.getElementById("saveFolder").addEventListener("click", saveFolder);
document.getElementById("addCustom").addEventListener("click", addCustomExercise);
libSearch.addEventListener("input", renderPicker);

document.getElementById("customExercise").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addCustomExercise();
});

// click the dark background, or press Escape, to close the window
folderModal.addEventListener("click", (e) => {
  if (e.target === folderModal) closeFolderEditor(true);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !folderModal.hidden) closeFolderEditor(true);
});

// ---------- home page ----------
const statIds = ["statWorkouts", "statExercises", "statFailure", "statStreak"];

// the 7 tiles for this week (Monday to Sunday)
function renderWeek() {
  const strip = document.getElementById("weekStrip");
  strip.innerHTML = "";

  const today = new Date();
  const todayText = formatDate(today);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateText = formatDate(d);
    const log = logs[dateText];

    const tile = document.createElement("div");
    tile.className = "week-day" + (log ? " " + log.intensity : "") + (dateText === todayText ? " today" : "");
    tile.title = log ? dateText + ": " + log.workout : dateText;

    const dayName = document.createElement("small");
    dayName.textContent = d.toLocaleDateString("en-US", { weekday: "short" });
    const dayNumber = document.createElement("strong");
    dayNumber.textContent = d.getDate();
    tile.append(dayName, dayNumber);

    tile.addEventListener("click", () => {
      showPage("calendar");
      openLog(dateText);
    });

    strip.appendChild(tile);
    if (log) count++;
  }

  document.getElementById("weekCount").textContent = count + " of 7 days";
}

// the last 5 workouts
function renderRecent() {
  const list = document.getElementById("recentList");
  list.innerHTML = "";

  const dates = Object.keys(logs).sort().reverse().slice(0, 5);

  if (dates.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No workouts yet. Log your first one!";
    list.appendChild(item);
    return;
  }

  dates.forEach(date => {
    const log = logs[date];
    const item = document.createElement("li");

    const dateEl = document.createElement("span");
    dateEl.className = "h-date";
    dateEl.textContent = new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const nameEl = document.createElement("span");
    nameEl.className = "h-name";
    nameEl.textContent = log.workout;

    const badge = document.createElement("span");
    badge.className = "badge " + log.intensity;
    badge.textContent = intensityNames[log.intensity];

    item.append(dateEl, nameEl, badge);
    list.appendChild(item);
  });
}

// the 3 exercises with the highest max weight
function renderTopLifts() {
  const list = document.getElementById("topLifts");
  list.innerHTML = "";

  const top = exercises.slice().sort((a, b) => convertWeight(b.max, unitOf(b), "kg") - convertWeight(a.max, unitOf(a), "kg")).slice(0, 3);

  if (top.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No exercises yet. Add one in Workouts, then Progress.";
    list.appendChild(item);
    return;
  }

  top.forEach(ex => {
    const item = document.createElement("li");

    const info = document.createElement("div");
    info.className = "lift-info";
    const name = document.createElement("strong");
    name.textContent = ex.name;
    const sub = document.createElement("small");
    sub.textContent = "Latest " + ex.latest + " " + unitOf(ex) + " x " + ex.reps + " reps";
    info.append(name, sub);

    const max = document.createElement("span");
    max.className = "lift-max";
    max.textContent = ex.max + " " + unitOf(ex);

    item.append(info, max);
    list.appendChild(item);
  });
}

function renderHome() {
  renderProfile();

  const greeting = document.getElementById("homeGreeting");
  const dateEl = document.getElementById("homeDate");
  const welcome = document.getElementById("welcomeText");
  const stats = document.getElementById("stats");
  const homeActions = document.getElementById("homeActions");
  const homeGrid = document.getElementById("homeGrid");

  if (!currentUser) {
    greeting.textContent = "Home";
    dateEl.textContent = "";
    welcome.textContent = "Log in to start tracking your workouts.";
    stats.hidden = true;
    homeActions.hidden = true;
    homeGrid.hidden = true;
    statIds.forEach(id => {
      const el = document.getElementById(id);
      el.textContent = "0";
      delete el.dataset.target;
    });
    return;
  }

  const now = new Date();
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // still downloading: show the greeting only, so the page never flashes empty numbers or the logged-out text
  if (!dataReady) {
    greeting.textContent = part + ", " + displayNameOf(currentUser);
    dateEl.textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    welcome.textContent = "Loading your workouts...";
    stats.hidden = true;
    homeActions.hidden = true;
    homeGrid.hidden = true;
    return;
  }

  const streak = calcStreaks().current;
  const todayLog = logs[formatDate(now)];

  greeting.textContent = part + ", " + displayNameOf(currentUser);
  dateEl.textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (todayLog) {
    welcome.textContent = streak > 1
      ? "Nice work. You're on a " + streak + "-day streak."
      : "Nice work. Today's workout is logged.";
  } else if (streak > 0) {
    welcome.textContent = "Keep your " + streak + "-day streak alive and log today's workout.";
  } else {
    welcome.textContent = "Start your streak today and log your first workout.";
  }

  document.getElementById("todayStatus").textContent = todayLog
    ? "Logged today: " + todayLog.workout
    : "No workout logged yet today";
  document.getElementById("logTodayBtn").textContent = todayLog
    ? "Edit today's workout"
    : "+ Log today's workout";

  stats.hidden = false;
  homeActions.hidden = false;
  homeGrid.hidden = false;

  setNumber(document.getElementById("statWorkouts"), Object.keys(logs).length);
  setNumber(document.getElementById("statExercises"), exercises.length);
  setNumber(
    document.getElementById("statFailure"),
    Object.values(logs).filter(log => log.intensity === "failure").length
  );
  setNumber(document.getElementById("statStreak"), streak);

  renderWeek();
  renderRecent();
  renderTopLifts();
}

document.getElementById("viewAllWorkouts").addEventListener("click", () => {
  showPage("workouts");
  document.querySelector('.tab[data-tab="historyTab"]').click();
});

document.getElementById("viewProgress").addEventListener("click", () => {
  showPage("workouts");
  document.querySelector('.tab[data-tab="progressTab"]').click();
});

document.getElementById("logTodayBtn").addEventListener("click", () => {
  showPage("calendar");
  openLog(formatDate(new Date()));
});

// ---------- username rules (used when registering and in the profile) ----------
function usernameProblem(name) {
  if (name.length < 3) {
    return "Username must be at least 3 characters.";
  }
  if (name.length > 20) {
    return "Username can't be longer than 20 characters.";
  }
  if (!/^[A-Za-z0-9_ ]+$/.test(name)) {
    return "Username can only have letters, numbers, spaces, and underscores.";
  }
  return "";
}

// ---------- profile menu and profile page ----------
const profileMenu = document.getElementById("profileMenu");
const profileBtn = document.getElementById("profileBtn");
const dropdown = document.getElementById("dropdown");
const profileName = document.getElementById("profileName");
const profileMsg = document.getElementById("profileMsg");

profileBtn.addEventListener("click", () => {
  dropdown.hidden = !dropdown.hidden;
});

// clicking anywhere outside the menu closes the dropdown
document.addEventListener("click", (e) => {
  if (!e.target.closest("#profileMenu")) {
    dropdown.hidden = true;
  }
});

document.getElementById("viewProfile").addEventListener("click", () => {
  dropdown.hidden = true;
  profileMsg.textContent = "";
  showPage("profile");
});

document.getElementById("menuLogout").addEventListener("click", () => {
  dropdown.hidden = true;
  signOut(auth);
});

document.getElementById("profileLogout").addEventListener("click", () => {
  signOut(auth);
});

// bars showing how many Light, Moderate and Failure days there are
function renderBreakdown() {
  const box = document.getElementById("breakdown");
  box.innerHTML = "";

  const names = { light: "Light", moderate: "Moderate", failure: "Failure" };
  const counts = { light: 0, moderate: 0, failure: 0 };
  Object.values(logs).forEach(log => {
    if (counts[log.intensity] !== undefined) counts[log.intensity]++;
  });

  const total = counts.light + counts.moderate + counts.failure;
  document.getElementById("breakdownTotal").textContent =
    total + (total === 1 ? " workout" : " workouts");

  if (total === 0) {
    const empty = document.createElement("p");
    empty.className = "bd-empty";
    empty.textContent = "Log a workout to see your breakdown.";
    box.appendChild(empty);
    return;
  }

  ["light", "moderate", "failure"].forEach(level => {
    const percent = Math.round((counts[level] / total) * 100);

    const row = document.createElement("div");
    row.className = "bd-row";

    const label = document.createElement("span");
    label.textContent = names[level];

    const track = document.createElement("div");
    track.className = "bd-track";
    const fill = document.createElement("span");
    fill.className = "bd-fill " + level;
    fill.style.width = percent + "%";
    track.appendChild(fill);

    const count = document.createElement("span");
    count.className = "bd-count";
    count.textContent = counts[level] + " (" + percent + "%)";

    row.append(label, track, count);
    box.appendChild(row);
  });
}

// how often each split was trained (top 5), counted by the workout name on each logged day
function renderSplitBreakdown() {
  const box = document.getElementById("splitBreakdown");
  box.innerHTML = "";

  const counts = {};
  Object.values(logs).forEach(log => {
    const name = (log.workout || "").trim();
    if (name === "") return;
    const key = name.toLowerCase();
    if (!counts[key]) counts[key] = { name, count: 0 };
    counts[key].count++;
  });

  const list = Object.values(counts).sort((a, b) => b.count - a.count);
  const total = Object.keys(logs).length;
  document.getElementById("splitTotal").textContent = list.length + (list.length === 1 ? " split" : " splits");

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "bd-empty";
    empty.textContent = "Log a workout to see which splits you train most.";
    box.appendChild(empty);
    return;
  }

  list.slice(0, 5).forEach(item => {
    const percent = Math.round((item.count / total) * 100);

    const row = document.createElement("div");
    row.className = "bd-row";

    const label = document.createElement("span");
    label.className = "bd-name";
    label.textContent = item.name;
    label.title = item.name;

    const track = document.createElement("div");
    track.className = "bd-track";
    const fill = document.createElement("span");
    fill.className = "bd-fill moderate";
    fill.style.width = percent + "%";
    track.appendChild(fill);

    const count = document.createElement("span");
    count.className = "bd-count";
    count.textContent = item.count + (item.count === 1 ? " day" : " days");

    row.append(label, track, count);
    box.appendChild(row);
  });
}

function renderProfile() {
  if (!currentUser) return;

  const name = displayNameOf(currentUser);
  const initial = name.charAt(0).toUpperCase();
  const streaks = calcStreaks();

  profileBtn.textContent = initial;
  document.getElementById("profileAvatar").textContent = initial;
  document.getElementById("profileTitle").textContent = name;
  document.getElementById("profileEmail").textContent = currentUser.email;
  document.getElementById("profileSince").textContent =
    new Date(currentUser.metadata.creationTime).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  document.getElementById("profileWorkouts").textContent = Object.keys(logs).length;
  document.getElementById("profileExercises").textContent = exercises.length;
  document.getElementById("profileStreak").textContent = streaks.current;
  document.getElementById("profileLongest").textContent = streaks.longest;
  renderBreakdown();
  renderSplitBreakdown();
}

document.getElementById("saveName").addEventListener("click", async () => {
  const name = profileName.value.trim();

  const problem = usernameProblem(name);
  if (problem !== "") {
    profileMsg.textContent = problem;
    return;
  }

  try {
    await updateProfile(auth.currentUser, { displayName: name });
    profileName.value = "";
    profileMsg.textContent = "Username saved.";
    renderHome();
  } catch (error) {
    profileMsg.textContent = "Could not save the username. Please try again.";
  }
});

// ---------- load this user's data from Firestore ----------
async function loadData() {
  logs = {};
  exercises = [];
  folders = [];

  if (currentUser) {
    const logSnap = await getDocs(collection(db, "users", currentUser.uid, "logs"));
    logSnap.forEach(d => {
      logs[d.id] = d.data();
    });

    const exSnap = await getDocs(collection(db, "users", currentUser.uid, "exercises"));
    exSnap.forEach(d => {
      exercises.push({ id: d.id, ...d.data() });
    });

    const folderSnap = await getDocs(collection(db, "users", currentUser.uid, "folders"));
    folderSnap.forEach(d => {
      folders.push({ id: d.id, ...d.data() });
    });
  }

  dataReady = true;
  paintCalendar();
  renderExercises();
  renderHistory();
  renderFolders();
}

// ---------- login and register page ----------
const guestButtons = document.getElementById("guestButtons");
const authTitle = document.getElementById("authTitle");
const authUsername = document.getElementById("authUsername");
const usernameHint = document.getElementById("usernameHint");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const passwordHint = document.getElementById("passwordHint");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const switchText = document.getElementById("switchText");
const switchMode = document.getElementById("switchMode");
const authError = document.getElementById("authError");
let registerMode = false;

// switches the card between login mode and register mode
function setMode(register) {
  registerMode = register;

  authUsername.hidden = !register;
  usernameHint.hidden = !register;
  passwordHint.hidden = !register;
  registerBtn.hidden = !register;
  loginBtn.hidden = register;

  authTitle.textContent = register ? "Create your account" : "Welcome back";
  switchText.textContent = register ? "Already have an account?" : "New to RepCord?";
  switchMode.textContent = register ? "Login" : "Create an account";
  authError.textContent = "";
}

// opens the separate login/register page in the chosen mode
function openAuth(register) {
  setMode(register);
  showPage("auth");
}

switchMode.addEventListener("click", () => {
  setMode(!registerMode);
});

setMode(false);

// buttons that lead to the login/register page
document.getElementById("navLogin").addEventListener("click", () => openAuth(false));
document.getElementById("navRegister").addEventListener("click", () => openAuth(true));

// clicking the RepCord name goes home (or to the landing page when logged out)
document.querySelector("nav h1").addEventListener("click", () => {
  showPage(currentUser ? "home" : "landing");
});

function showAuthError(error) {
  const messages = {
    "auth/invalid-email": "That email isn't valid.",
    "auth/email-already-in-use": "That email is already registered. Try logging in.",
    "auth/weak-password": "That password is too weak.",
    "auth/invalid-credential": "Wrong email or password."
  };
  authError.textContent = messages[error.code] || "Something went wrong. Please try again.";
}

function checkAuthInputs() {
  if (authEmail.value.trim() === "" || authPassword.value === "") {
    authError.textContent = "Please enter your email and password.";
    return false;
  }
  return true;
}

// returns a message if the password breaks a rule, or "" if it is fine
function passwordProblem(password) {
  if (password.length < 7) {
    return "Password must be at least 7 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password needs at least 1 capital letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password needs at least 1 number.";
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    return "Password needs at least 1 special character, like !@#$%.";
  }
  return "";
}

registerBtn.addEventListener("click", async () => {
  const username = authUsername.value.trim();

  const usernameIssue = usernameProblem(username);
  if (usernameIssue !== "") {
    authError.textContent = usernameIssue;
    return;
  }

  if (!checkAuthInputs()) return;

  const problem = passwordProblem(authPassword.value);
  if (problem !== "") {
    authError.textContent = problem;
    return;
  }

  try {
    const result = await createUserWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value);

    // save the username on the new account, then refresh the greeting
    await updateProfile(result.user, { displayName: username });
    renderHome();
    authError.textContent = "";
  } catch (error) {
    showAuthError(error);
  }
});

loginBtn.addEventListener("click", async () => {
  if (!checkAuthInputs()) return;
  try {
    await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value);
    authError.textContent = "";
  } catch (error) {
    showAuthError(error);
  }
});

// runs on page load and every time someone logs in or out
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateAboutCta();
  folderDrafts = {};
  dataReady = false;
  renderHome();   // fills the greeting right away, before Firestore answers

  // remember if someone is logged in, so the next reload doesn't flash the landing page
  try { localStorage.setItem("repcord-session", user ? "1" : "0"); } catch (e) {}

  // logged in: show the avatar and the app pages. logged out: Login and Sign up buttons
  profileMenu.hidden = !user;
  guestButtons.hidden = !!user;
  dropdown.hidden = true;
  lockedButtons.forEach(button => {
    button.hidden = !user;
  });

  // the About guide is only for visitors, so it disappears once someone is logged in
  guestOnlyButtons.forEach(button => {
    button.hidden = !!user;
  });

  if (user) {
    authUsername.value = "";
    authEmail.value = "";
    authPassword.value = "";
    setMode(false);

    // after logging in or registering, go to Home
    const activePage = document.querySelector(".page.active").id;
    if (activePage === "auth" || activePage === "landing" || activePage === "about") {
      const savedPage = recall("repcord-page");
      showPage(APP_PAGES.includes(savedPage) ? savedPage : "home");

      // put the Workouts tab back too (History, Progress or Splits)
      const savedTab = recall("repcord-tab");
      const tabButton = document.querySelector('.tab[data-tab="' + savedTab + '"]');
      if (tabButton) tabButton.click();
    }
  } else {
    logBox.hidden = true;
    try { sessionStorage.removeItem("repcord-page"); sessionStorage.removeItem("repcord-tab"); } catch (e) {}
    showPage("landing");
  }

  document.documentElement.classList.remove("returning");
  await loadData();
});

// ---------- login page extras ----------
const togglePw = document.getElementById("togglePw");

// the eye button shows or hides the password
togglePw.addEventListener("click", () => {
  const show = authPassword.type === "password";
  authPassword.type = show ? "text" : "password";
  togglePw.classList.toggle("showing", show);
});

// pressing Enter submits the form
[authUsername, authEmail, authPassword].forEach(field => {
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      (registerMode ? registerBtn : loginBtn).click();
    }
  });
});

// ---------- about page ----------
// the practice calendar: click a square to cycle empty > light > moderate > failure
(function buildAboutDemo() {
  const demo = document.getElementById("aboutDemo");
  const levels = ["", "light", "moderate", "failure"];
  let aboutSeed = 11;

  function aboutRandom() {
    aboutSeed = (aboutSeed * 9301 + 49297) % 233280;
    return aboutSeed / 233280;
  }

  function levelOf(square) {
    return levels.findIndex(level => level !== "" && square.classList.contains(level));
  }

  function cycle(square) {
    const now = Math.max(levelOf(square), 0);
    const next = (now + 1) % levels.length;
    levels.forEach(level => level && square.classList.remove(level));
    if (levels[next]) square.classList.add(levels[next]);
  }

  for (let i = 0; i < 7 * 10; i++) {
    const square = document.createElement("div");
    const r = aboutRandom();
    let level = "";
    if (r > 0.35 && r <= 0.6) level = " light";
    else if (r > 0.6 && r <= 0.85) level = " moderate";
    else if (r > 0.85) level = " failure";
    square.className = "day" + level;
    square.setAttribute("role", "button");
    square.setAttribute("tabindex", "0");
    square.setAttribute("aria-label", "Practice square. Press to change its color.");
    demo.appendChild(square);
  }

  demo.addEventListener("click", (e) => {
    const square = e.target.closest(".day");
    if (square) cycle(square);
  });

  demo.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const square = e.target.closest(".day");
    if (!square) return;
    e.preventDefault();
    cycle(square);
  });
})();

// guests see "Create an account", logged-in users see "Go to Home"
function updateAboutCta() {
  document.querySelectorAll(".ab-guest-cta").forEach(el => { el.hidden = !!currentUser; });
  document.querySelectorAll(".ab-user-cta").forEach(el => { el.hidden = !currentUser; });
}

updateAboutCta();

// buttons on the about page and the landing page
document.querySelectorAll("[data-about]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.about;
    if (action === "signup") openAuth(true);
    else if (action === "login") openAuth(false);
    else if (action === "guide") showPage("about");
    else showPage("home");
    window.scrollTo(0, 0);
  });
});

// "About / User guide" link in the footer
document.getElementById("footAbout").addEventListener("click", (e) => {
  e.preventDefault();
  showPage("about");
});