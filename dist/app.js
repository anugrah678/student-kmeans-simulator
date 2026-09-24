const SAMPLE = [
  { id: "S01", marks: [35, 43, 38] }, { id: "S02", marks: [42, 37, 45] },
  { id: "S03", marks: [38, 40, 39] }, { id: "S04", marks: [45, 44, 42] },
  { id: "S05", marks: [60, 68, 61] }, { id: "S06", marks: [64, 60, 67] },
  { id: "S07", marks: [67, 66, 63] }, { id: "S08", marks: [62, 65, 65] },
  { id: "S09", marks: [82, 88, 86] }, { id: "S10", marks: [88, 81, 89] },
  { id: "S11", marks: [85, 90, 88] }, { id: "S12", marks: [91, 90, 88] }
];

const COLORS = ["#16a999", "#f58b3a", "#5267df", "#9b6ee5", "#e85d75"];
let students = structuredClone(SAMPLE);
let k = 3;
let initMode = "kmeans++";
let manualCentroids = makeManualCentroids(k);
let centroids = [];
let assignments = [];
let previousAssignments = [];
let iteration = 0;
let wcss = null;
let movement = null;
let converged = false;
let started = false;
let timer = null;
let history = [];
let historyIndex = -1;
let outlierBaseline = null;
let outlierStudentId = null;
let outlierMessage = "";

const el = (id) => document.getElementById(id);
const rows = el("inputRows");

function makeManualCentroids(count) {
  return Array.from({ length: count }, (_, index) => {
    const value = count === 1 ? 50 : Math.round(30 + (60 * index) / (count - 1));
    return [value, value, value];
  });
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => (value = value * 16807 % 2147483647) / 2147483647;
}

function distanceSquared(a, b) {
  return a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0);
}

function distance(a, b) { return Math.sqrt(distanceSquared(a, b)); }

function initializeCentroids(points, count) {
  const seed = points.flat().reduce((sum, value, index) => sum + value * (index + 11), 97);
  const random = seededRandom(Math.round(seed));
  const selected = [Math.floor(random() * points.length)];
  while (selected.length < count) {
    const weights = points.map((point, index) => selected.includes(index) ? 0 : Math.min(...selected.map(i => distanceSquared(point, points[i]))));
    const total = weights.reduce((a, b) => a + b, 0);
    let target = random() * total;
    let chosen = weights.findIndex((weight) => (target -= weight) <= 0);
    if (chosen < 0 || selected.includes(chosen)) chosen = weights.indexOf(Math.max(...weights));
    selected.push(chosen);
  }
  return selected.map(index => [...points[index]]);
}

function renderInputs() {
  rows.innerHTML = students.map((student, index) => `
    <tr>
      <td><input aria-label="Student ${index + 1} ID" data-row="${index}" data-field="id" value="${escapeHtml(student.id)}" maxlength="16"></td>
      ${student.marks.map((mark, subject) => `<td><input aria-label="${["Mathematics", "Science", "English"][subject]} marks for ${escapeHtml(student.id)}" data-row="${index}" data-subject="${subject}" type="number" min="0" max="100" value="${mark}"></td>`).join("")}
      <td><button class="remove-row" data-remove="${index}" type="button" aria-label="Remove ${escapeHtml(student.id)}">×</button></td>
    </tr>`).join("");
}

function renderInitialization() {
  document.querySelectorAll("[data-init]").forEach(button => {
    button.setAttribute("aria-checked", String(button.dataset.init === initMode));
  });
  el("manualCentroids").hidden = initMode !== "manual";
  el("initDescription").textContent = initMode === "manual"
    ? "Enter one starting point for each group."
    : "Centroids start with K-means++.";
  el("manualCentroidRows").innerHTML = manualCentroids.slice(0, k).map((centroid, group) => `
    <div class="manual-row">
      <strong style="--group:${COLORS[group]}"><i></i>G${group + 1}</strong>
      ${centroid.map((value, subject) => `<input type="number" min="0" max="100" step="1" value="${value}" data-centroid="${group}" data-dimension="${subject}" aria-label="Group ${group + 1} ${["Mathematics", "Science", "English"][subject]} starting centroid">`).join("")}
    </div>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
}

function createSnapshot() {
  return {
    centroids: centroids.map(centroid => [...centroid]),
    assignments: [...assignments],
    iteration,
    wcss,
    movement,
    converged
  };
}

function recordSnapshot() {
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  history.push(createSnapshot());
  historyIndex = history.length - 1;
}

function applySnapshot(index) {
  const snapshot = history[index];
  if (!snapshot) return;
  stopTimer();
  centroids = snapshot.centroids.map(centroid => [...centroid]);
  assignments = [...snapshot.assignments];
  iteration = snapshot.iteration;
  wcss = snapshot.wcss;
  movement = snapshot.movement;
  converged = snapshot.converged;
  historyIndex = index;
  renderSimulation();
}

function invalidateSimulation({ preserveOutlier = false } = {}) {
  stopTimer();
  started = false;
  converged = false;
  centroids = [];
  assignments = [];
  iteration = 0;
  wcss = null;
  movement = null;
  history = [];
  historyIndex = -1;
  if (!preserveOutlier) {
    outlierBaseline = null;
    outlierStudentId = null;
    outlierMessage = "";
  }
  renderSimulation();
}

function validate() {
  if (students.length < k) return `Add at least ${k} students for ${k} groups.`;
  const ids = students.map(s => s.id.trim());
  if (ids.some(id => !id)) return "Every student needs an ID.";
  if (new Set(ids).size !== ids.length) return "Student IDs must be unique.";
  if (students.some(s => s.marks.some(mark => !Number.isFinite(mark) || mark < 0 || mark > 100))) return "Enter marks from 0 to 100 for every subject.";
  if (initMode === "manual" && manualCentroids.slice(0, k).some(centroid => centroid.some(value => !Number.isFinite(value) || value < 0 || value > 100))) return "Enter every manual centroid value from 0 to 100.";
  return "";
}

function startSimulation() {
  const error = validate();
  el("inputError").textContent = error;
  if (error) return false;
  stopTimer();
  centroids = initMode === "manual"
    ? manualCentroids.slice(0, k).map(centroid => [...centroid])
    : initializeCentroids(students.map(s => s.marks), k);
  assignments = Array(students.length).fill(-1);
  previousAssignments = [];
  iteration = 0;
  wcss = students.reduce((sum, student) => sum + Math.min(...centroids.map(c => distanceSquared(student.marks, c))), 0);
  movement = 0;
  converged = false;
  started = true;
  history = [];
  historyIndex = -1;
  recordSnapshot();
  renderSimulation();
  return true;
}

function runIteration() {
  if (!started && !startSimulation()) return;
  if (converged) return;
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  previousAssignments = [...assignments];
  const newAssignments = students.map(student => {
    const distances = centroids.map(c => distanceSquared(student.marks, c));
    return distances.indexOf(Math.min(...distances));
  });

  const newCentroids = centroids.map((oldCentroid, group) => {
    const members = students.filter((_, index) => newAssignments[index] === group);
    if (!members.length) return [...oldCentroid];
    return [0, 1, 2].map(subject => members.reduce((sum, student) => sum + student.marks[subject], 0) / members.length);
  });

  movement = newCentroids.reduce((sum, centroid, index) => sum + distance(centroid, centroids[index]), 0);
  centroids = newCentroids;
  assignments = newAssignments;
  iteration += 1;
  wcss = students.reduce((sum, student, index) => sum + distanceSquared(student.marks, centroids[assignments[index]]), 0);
  converged = iteration > 1 && assignments.every((group, index) => group === previousAssignments[index]);
  if (movement < .001) converged = true;
  if (iteration >= 50) converged = true;
  if (converged) stopTimer();
  recordSnapshot();
  renderSimulation();
}

function runToResult() {
  if (!started && !startSimulation()) return;
  if (converged) return;
  if (timer) { stopTimer(); renderSimulation(); return; }
  runIteration();
  if (!converged) timer = setInterval(runIteration, 700);
  renderSimulation();
}

function stopTimer() { if (timer) clearInterval(timer); timer = null; }

function renderSimulation() {
  el("iterationValue").textContent = iteration;
  el("wcssValue").textContent = wcss == null ? "—" : wcss.toFixed(2);
  el("movementValue").textContent = movement == null ? "—" : movement.toFixed(2);
  el("runStatus").textContent = converged ? "Converged" : started ? (timer ? "Running…" : iteration ? "In progress" : "Centroids ready") : "Not started";
  el("resultState").textContent = converged ? `Converged in ${iteration} iterations` : started ? "Simulation in progress" : "Waiting for simulation";
  el("statusPill").querySelector("b").textContent = converged ? "Groups are stable" : timer ? "Simulation running" : "Ready to simulate";
  el("statusPill").classList.toggle("complete", converged);
  el("chartEmpty").hidden = started;
  el("resetButton").disabled = !started;
  el("playButton").disabled = !started || converged;
  el("stepButton").disabled = !started || converged || Boolean(timer);
  el("playIcon").textContent = timer ? "Ⅱ" : "▶";
  el("playButton").lastChild.textContent = timer ? " Pause" : " Run to result";
  el("historyNav").hidden = !started;
  el("historyPosition").textContent = started
    ? `${iteration === 0 ? "Initial state" : `Iteration ${iteration}`} · ${historyIndex + 1} of ${history.length}`
    : "Step 0 of 0";
  el("historyPrev").disabled = historyIndex <= 0;
  el("historyNext").disabled = historyIndex < 0 || historyIndex >= history.length - 1;
  drawChart();
  renderResults();
  renderPostAnalysis();
}

function drawChart() {
  const svg = el("clusterChart");
  if (!started) { svg.innerHTML = ""; return; }
  const compact = window.matchMedia("(max-width: 720px)").matches;
  const tickSize = compact ? 18 : 12;
  const pointRadius = compact ? 12 : 9;
  const pointLabelSize = compact ? 17 : 11;
  const axisLabelSize = compact ? 19 : 13;
  const left = 64, top = 28, width = 600, height = 340;
  const x = value => left + value / 100 * width;
  const y = value => top + (100 - value) / 100 * height;
  const grid = [0, 20, 40, 60, 80, 100].map(tick => `
    <line x1="${x(tick)}" y1="${top}" x2="${x(tick)}" y2="${top + height}" stroke="#e8ebf1" />
    <line x1="${left}" y1="${y(tick)}" x2="${left + width}" y2="${y(tick)}" stroke="#e8ebf1" />
    <text x="${x(tick)}" y="${top + height + 24}" text-anchor="middle" fill="#7b8496" font-size="${tickSize}">${tick}</text>
    <text x="${left - 15}" y="${y(tick) + 4}" text-anchor="end" fill="#7b8496" font-size="${tickSize}">${tick}</text>`).join("");
  const points = students.map((student, index) => {
    const group = assignments[index];
    const color = group < 0 ? "#8f98aa" : COLORS[group];
    return `<g><circle cx="${x(student.marks[0])}" cy="${y(student.marks[1])}" r="${pointRadius}" fill="${color}" fill-opacity=".9" stroke="white" stroke-width="3"><title>${escapeHtml(student.id)}: ${student.marks.join(", ")}</title></circle><text x="${x(student.marks[0]) + (compact ? 16 : 12)}" y="${y(student.marks[1]) - (compact ? 14 : 10)}" font-size="${pointLabelSize}" font-weight="700" fill="#39445a">${escapeHtml(student.id)}</text></g>`;
  }).join("");
  const centroidTrails = centroids.map((_, group) => {
    const trail = history.slice(0, historyIndex + 1)
      .map(snapshot => snapshot.centroids[group])
      .filter(Boolean)
      .map(point => `${x(point[0])},${y(point[1])}`);
    if (trail.length < 2) return "";
    return `<polyline points="${trail.join(" ")}" fill="none" stroke="${COLORS[group]}" stroke-width="3" stroke-dasharray="7 7" stroke-linecap="round" stroke-linejoin="round" opacity=".42"><title>Group ${group + 1} centroid path</title></polyline>`;
  }).join("");
  const centreMarks = centroids.map((c, index) => `<g transform="translate(${x(c[0])} ${y(c[1])})"><circle r="${compact ? 19 : 15}" fill="white" stroke="${COLORS[index]}" stroke-width="4"/><path d="M-6-6L6 6M6-6L-6 6" stroke="${COLORS[index]}" stroke-width="4" stroke-linecap="round"/><title>Group ${index + 1} centroid: ${c.map(v => v.toFixed(1)).join(", ")}</title></g>`).join("");
  svg.innerHTML = `${grid}<line x1="${left}" y1="${top + height}" x2="${left + width}" y2="${top + height}" stroke="#768095" stroke-width="1.5"/><line x1="${left}" y1="${top}" x2="${left}" y2="${top + height}" stroke="#768095" stroke-width="1.5"/>${centroidTrails}${points}${centreMarks}<text x="${left + width / 2}" y="418" text-anchor="middle" font-size="${axisLabelSize}" font-weight="700" fill="#515c72">Mathematics marks</text><text transform="translate(18 ${top + height / 2}) rotate(-90)" text-anchor="middle" font-size="${axisLabelSize}" font-weight="700" fill="#515c72">Science marks</text>`;
}

function renderResults() {
  if (!started || assignments.every(value => value < 0)) {
    el("groupCards").innerHTML = `<div class="result-empty">Run the simulation to see group members, centroids, and final assignments.</div>`;
    el("resultTableWrap").hidden = true;
    return;
  }
  el("groupCards").innerHTML = centroids.map((centroid, group) => {
    const members = students.filter((_, index) => assignments[index] === group);
    return `<article class="group-card" style="--group:${COLORS[group]}"><header><h3>Group ${group + 1}</h3><span>${members.length} student${members.length === 1 ? "" : "s"}</span></header><p class="member-list">${members.length ? members.map(m => escapeHtml(m.id)).join(" · ") : "No students assigned"}</p><div class="centroid-values">${["MATHS", "SCIENCE", "ENGLISH"].map((label, i) => `<div><span>${label}</span><b>${centroid[i].toFixed(1)}</b></div>`).join("")}</div></article>`;
  }).join("");
  el("resultRows").innerHTML = students.map((student, index) => {
    const group = assignments[index];
    return `<tr><td><b>${escapeHtml(student.id)}</b></td><td>${student.marks.join(", ")}</td><td><span class="cluster-chip" style="--group:${COLORS[group]}"><i></i>Group ${group + 1}</span></td><td>${distance(student.marks, centroids[group]).toFixed(2)}</td></tr>`;
  }).join("");
  el("resultTableWrap").hidden = false;
}

function renderDistanceExplanation() {
  const hasAssignments = started && assignments.some(group => group >= 0);
  el("distanceDetails").hidden = !hasAssignments;
  if (!hasAssignments) return;
  const select = el("distanceStudent");
  const previous = select.value;
  select.innerHTML = students.map((student, index) => `<option value="${index}">${escapeHtml(student.id)}</option>`).join("");
  if (previous && Number(previous) < students.length) select.value = previous;
  const index = Number(select.value || 0);
  const student = students[index];
  const distances = centroids.map(centroid => distance(student.marks, centroid));
  const nearest = distances.indexOf(Math.min(...distances));
  el("distanceContent").innerHTML = `
    <table class="distance-table"><thead><tr><th>Centroid</th><th>Coordinates</th><th>Distance</th></tr></thead><tbody>
      ${centroids.map((centroid, group) => `<tr><td>Group ${group + 1}</td><td>${centroid.map(value => value.toFixed(1)).join(", ")}</td><td class="${group === nearest ? "distance-winner" : ""}">${distances[group].toFixed(2)}${group === nearest ? " · nearest" : ""}</td></tr>`).join("")}
    </tbody></table>
    <p class="distance-conclusion"><b>${escapeHtml(student.id)}</b> joins Group ${nearest + 1} because ${distances[nearest].toFixed(2)} is its smallest Euclidean distance.</p>`;
}

function addOutlierDemo() {
  if (!converged) return;
  outlierBaseline = {
    centroids: centroids.map(centroid => [...centroid]),
    wcss,
    k
  };
  let suffix = 1;
  let id = "OUTLIER";
  while (students.some(student => student.id === id)) {
    suffix += 1;
    id = `OUTLIER${suffix}`;
  }
  const marks = [5, 98, 12];
  students.push({ id, marks });
  outlierStudentId = id;
  initMode = "manual";
  manualCentroids = outlierBaseline.centroids.map(centroid => [...centroid]);
  outlierMessage = `${id} (${marks.join(", ")}) was added. The original centroids are kept as the starting points; run again to compare.`;
  renderInputs();
  renderInitialization();
  invalidateSimulation({ preserveOutlier: true });
}

function renderOutlierComparison() {
  const button = el("addOutlierButton");
  const outlierExists = outlierStudentId && students.some(student => student.id === outlierStudentId);
  button.disabled = !converged || Boolean(outlierExists);
  button.textContent = outlierExists ? "Outlier added" : "Add outlier student";
  el("outlierStatus").textContent = outlierMessage;
  el("outlierComparison").hidden = true;
  if (!converged || !outlierBaseline || !outlierExists) return;
  const outlierIndex = students.findIndex(student => student.id === outlierStudentId);
  const group = assignments[outlierIndex];
  const newCentroid = centroids[group];
  const oldCentroid = outlierBaseline.centroids[group] || outlierBaseline.centroids[0];
  const shift = distance(oldCentroid, newCentroid);
  el("outlierComparison").hidden = false;
  el("outlierComparison").innerHTML = `<div><span>Before outlier</span><b>${oldCentroid.map(value => value.toFixed(1)).join(", ")}</b></div><div><span>After outlier</span><b>${newCentroid.map(value => value.toFixed(1)).join(", ")}</b></div><div><span>Centroid shift</span><b>${shift.toFixed(2)}</b></div>`;
  el("outlierStatus").textContent = `${outlierStudentId} joined Group ${group + 1}. That centroid moved ${shift.toFixed(2)} marks.`;
}

function renderPostAnalysis() {
  const showAnalysis = converged || Boolean(outlierBaseline);
  el("postAnalysis").hidden = !showAnalysis;
  renderDistanceExplanation();
  renderOutlierComparison();
}

rows.addEventListener("input", event => {
  const input = event.target.closest("input");
  if (!input) return;
  const row = Number(input.dataset.row);
  if (input.dataset.field === "id") students[row].id = input.value;
  else students[row].marks[Number(input.dataset.subject)] = input.value === "" ? NaN : Number(input.value);
  invalidateSimulation();
});

rows.addEventListener("click", event => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  students.splice(Number(button.dataset.remove), 1);
  renderInputs();
  invalidateSimulation();
});

el("addStudent").addEventListener("click", () => {
  const next = students.length + 1;
  students.push({ id: `S${String(next).padStart(2, "0")}`, marks: [50, 50, 50] });
  renderInputs();
  invalidateSimulation();
  rows.querySelector(`tr:last-child input`).focus();
});

el("loadSample").addEventListener("click", () => { students = structuredClone(SAMPLE); k = 3; initMode = "kmeans++"; manualCentroids = makeManualCentroids(k); updateKButtons(); renderInputs(); renderInitialization(); invalidateSimulation(); });
document.querySelectorAll("[data-k]").forEach(button => button.addEventListener("click", () => { k = Number(button.dataset.k); manualCentroids = makeManualCentroids(k); updateKButtons(); renderInitialization(); invalidateSimulation(); }));
function updateKButtons() { document.querySelectorAll("[data-k]").forEach(button => button.setAttribute("aria-checked", String(Number(button.dataset.k) === k))); }
document.querySelectorAll("[data-init]").forEach(button => button.addEventListener("click", () => { initMode = button.dataset.init; renderInitialization(); invalidateSimulation(); }));
el("manualCentroidRows").addEventListener("input", event => {
  const input = event.target.closest("[data-centroid]");
  if (!input) return;
  manualCentroids[Number(input.dataset.centroid)][Number(input.dataset.dimension)] = input.value === "" ? NaN : Number(input.value);
  invalidateSimulation();
});
el("startButton").addEventListener("click", startSimulation);
el("stepButton").addEventListener("click", runIteration);
el("playButton").addEventListener("click", runToResult);
el("resetButton").addEventListener("click", startSimulation);
el("historyPrev").addEventListener("click", () => applySnapshot(historyIndex - 1));
el("historyNext").addEventListener("click", () => applySnapshot(historyIndex + 1));
el("distanceStudent").addEventListener("change", renderDistanceExplanation);
el("addOutlierButton").addEventListener("click", addOutlierDemo);

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const controller = new AbortController();
  const register = tool => Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {});
  register({
    name: "set_student_marks",
    title: "Set student marks",
    description: "Replace the visible student dataset with IDs and marks out of 100 for Mathematics, Science, and English.",
    inputSchema: { type: "object", properties: { students: { type: "array", minItems: 2, items: { type: "object", properties: { id: { type: "string" }, mathematics: { type: "number", minimum: 0, maximum: 100 }, science: { type: "number", minimum: 0, maximum: 100 }, english: { type: "number", minimum: 0, maximum: 100 } }, required: ["id", "mathematics", "science", "english"], additionalProperties: false } } }, required: ["students"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!input?.students || input.students.length < 2) throw new Error("Provide at least two students.");
      students = input.students.map(s => ({ id: String(s.id).trim(), marks: [s.mathematics, s.science, s.english] }));
      const error = validate();
      if (error) { students = structuredClone(SAMPLE); throw new Error(error); }
      renderInputs(); invalidateSimulation();
      return { studentCount: students.length, status: "dataset_updated" };
    }
  });
  register({
    name: "run_kmeans_simulation",
    title: "Run K-means simulation",
    description: "Set K and run the current visible student marks through K-means until the groups converge.",
    inputSchema: { type: "object", properties: { k: { type: "integer", minimum: 2, maximum: 5 } }, required: ["k"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!Number.isInteger(input?.k) || input.k < 2 || input.k > 5) throw new Error("K must be an integer from 2 to 5.");
      k = input.k; updateKButtons();
      if (!startSimulation()) throw new Error(el("inputError").textContent);
      while (!converged && iteration < 50) runIteration();
      return { k, iterations: iteration, wcss: Number(wcss.toFixed(2)), groups: centroids.map((centroid, group) => ({ group: group + 1, centroid: centroid.map(v => Number(v.toFixed(2))), students: students.filter((_, i) => assignments[i] === group).map(s => s.id) })) };
    }
  });
}

renderInputs();
renderInitialization();
renderSimulation();
registerWebMcpTools();
window.addEventListener("resize", drawChart);
