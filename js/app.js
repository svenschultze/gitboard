import {
  createBoard,
  createProject,
  uid,
  validateProject,
  projectContent,
  loadWorkspace,
  saveWorkspace,
  STORAGE_KEY,
  COLORS,
} from "./model.js";
import { BoardEditor } from "./editor.js";
import { GitHubClient } from "./github.js";
import { importDrawio } from "./drawio.js";
import { icon } from "./icons.js";

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = () => new Date().toISOString();
const button = (action, label, glyph, cls = "", extra = "") =>
  `<button type="button" data-action="${action}" class="${cls}" ${extra}>${glyph ? icon(glyph) : ""}${label ? `<span>${label}</span>` : ""}</button>`;
const iconButton = (action, label, glyph, extra = "") =>
  button(
    action,
    "",
    glyph,
    "icon-button",
    `title="${esc(label)}" aria-label="${esc(label)}" ${extra}`,
  );
const templates = [
  ["blank", "Blank canvas", "A fresh start for anything.", "board"],
  ["brainstorm", "Brainstorm", "Give your ideas room to grow.", "spark"],
  ["kanban", "Project planner", "Move work from idea to done.", "grid"],
  ["retrospective", "Retrospective", "Look back and move forward.", "refresh"],
];
let workspace, recoveryError;
try {
  workspace = loadWorkspace();
} catch (error) {
  recoveryError = error;
  const p = createProject("Recovered workspace");
  workspace = {
    projects: [p],
    activeProjectId: p.id,
    activeBoardId: p.boards[0].id,
  };
}
let { projects, activeProjectId, activeBoardId } = workspace;
let github = null,
  githubUser = null,
  githubBusy = false,
  toastTimer,
  saveTimer,
  externalChange = false;
const pendingRepositories = new Map(
  projects
    .filter((p) => p.pendingRepository)
    .map((p) => [p.id, p.pendingRepository]),
);
let currentSelection = [],
  currentView = { zoom: 1 },
  saveFailed = false,
  importBusy = false;
const project = () =>
  projects.find((p) => p.id === activeProjectId) ?? projects[0];
const board = () =>
  project().boards.find((b) => b.id === activeBoardId) ?? project().boards[0];
const connected = () =>
  project().repository || pendingRepositories.get(project().id);
const dirty = () =>
  !project().lastSyncedContent ||
  project().lastSyncedContent !== projectContent(project());

$("#app").innerHTML = `
  <aside class="sidebar" aria-label="Projects and boards">
    <a class="brand" href="#" aria-label="GitBoard home"><img src="./assets/favicon.svg" alt=""><span>gitboard<span class="brand-dot">.</span></span><span class="brand-tag">BETA</span></a>
    <div class="workspace-label">YOUR WORKSPACE</div>
    <button id="project-switch" class="project-switch" data-action="projects"><span class="project-avatar">C</span><span class="project-info"><strong id="project-name"></strong><small id="project-subtitle"></small></span>${icon("chevron", 16)}</button>
    <div class="search-wrap">${icon("search", 17)}<input id="board-search" placeholder="Find a board…" aria-label="Find a board"><kbd>⌘ K</kbd></div>
    <div class="boards-label"><span>${icon("grid", 15)} My boards <span id="board-count" class="count"></span></span>${iconButton("new-board", "Create a board", "plus")}</div>
    <div id="board-list" class="board-list"></div>
    ${button("new-board", "Create a board", "plus", "new-board-button")}
    <div class="sidebar-spacer"></div>
    <div class="github-card"><span class="github-card-icon">${icon("branch", 20)}</span><strong>Big ideas. Small commits.</strong><p>Give your boards a home on GitHub.</p>${button("github", "Connect GitHub", "github", "github-card-button")}</div>
    <div class="sidebar-footer"><span class="user-avatar">Y</span><span><strong id="user-name">Your workspace</strong><small>Personal workspace</small></span>${iconButton("help", "Help and keyboard shortcuts", "help")}</div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="breadcrumb">${iconButton("toggle-sidebar", "Toggle sidebar", "menu")}<span id="breadcrumb-project"></span>${icon("right", 13)}<strong id="breadcrumb-board"></strong></div><div class="topbar-actions"><span class="local-status" id="save-status"><span></span>Saved locally</span>${button("github", "Connect GitHub", "github", "secondary-button", 'id="github-top"')}</div></header>
    <div class="board-heading"><div class="board-heading-left"><span class="board-symbol">${icon("board", 21)}</span><div><button id="board-title" data-action="board-settings" class="board-title"></button><span class="board-meta" id="board-meta"></span></div>${iconButton("board-settings", "Board settings", "more")}</div><div class="board-heading-actions">${iconButton("undo", "Undo (⌘/Ctrl Z)", "undo", 'id="undo" disabled')}${iconButton("redo", "Redo (⌘/Ctrl Shift Z)", "redo", 'id="redo" disabled')}<span class="divider"></span>${button("import", "Import", "upload", "secondary-button", 'title="Import a board or diagram"')}${button("export", "Export", "download", "secondary-button")}${button("commit", "Save to GitHub", "cloud", "primary-button", 'id="commit-button"')}</div></div>
    <section class="canvas-shell" aria-label="Whiteboard workspace">
      <div id="canvas" class="canvas"></div>
      <nav class="tools" aria-label="Drawing tools">
        ${[
          ["select", "pointer", "Select", "V"],
          ["hand", "hand", "Hand", "H"],
          ["sticky", "sticky", "Sticky note", "N"],
          ["text", "text", "Text", "T"],
          ["rect", "rectangle", "Rectangle", "R"],
          ["ellipse", "circle", "Ellipse", "O"],
          ["diamond", "diamond", "Diamond", "D"],
          ["arrow", "arrow", "Connector", "A"],
          ["line", "line", "Line", "L"],
          ["draw", "pen", "Pen", "P"],
          ["frame", "frame", "Frame", "F"],
          ["image", "image", "Upload image", ""],
        ]
          .map(
            ([tool, glyph, label, key]) =>
              `<button type="button" data-tool="${tool}" title="${label}${key ? ` (${key})` : ""}" aria-label="${label}" class="tool-button ${tool === "select" ? "active" : ""}">${icon(glyph, 21)}<span class="tool-tooltip">${label}${key ? `<kbd>${key}</kbd>` : ""}</span></button>`,
          )
          .join("")}
      </nav>
      <div id="properties" class="properties" hidden></div>
      <div class="canvas-caption"><span class="tiny-spark">✦</span> A little space for your next big idea.</div>
      <div class="canvas-controls"><span class="canvas-hint" id="canvas-hint">Drag to select · Space to pan</span><div class="zoom-controls">${iconButton("zoom-out", "Zoom out", "minus")}<button type="button" data-action="zoom-reset" id="zoom-value" title="Reset zoom">100%</button>${iconButton("zoom-in", "Zoom in", "plus")}<span class="divider"></span>${iconButton("fit", "Fit board to screen", "fit")}</div>${iconButton("help", "Help and shortcuts", "help")}</div>
      <div id="empty-hint" class="empty-hint" hidden><span>✦</span><h2>Make room for an idea.</h2><p>Add a sticky note, sketch something,<br>or simply see where the canvas takes you.</p>${button("add-sticky", "Add your first note", "sticky", "primary-button")}<small>Or press <kbd>N</kbd> and click anywhere</small></div>
    </section>
  </main>
  <input type="file" id="image-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
  <input type="file" id="import-file" accept="application/json,.json,.drawio,.xml,application/xml,text/xml,application/vnd.jgraph.mxfile" hidden>
`;

const editor = new BoardEditor($("#canvas"), {
  onChange(items) {
    board().items = items;
    board().updatedAt = date();
    project().updatedAt = date();
    persist();
    updateStatus();
    $("#empty-hint").hidden = items.length > 0;
    renderThumbnail(board());
  },
  onView(view) {
    board().view = view;
    currentView = view;
    $("#zoom-value").textContent = `${Math.round(view.zoom * 100)}%`;
    persist();
  },
  onSelection(items) {
    currentSelection = items;
    renderProperties();
  },
  onHistory({ canUndo, canRedo }) {
    $("#undo").disabled = !canUndo;
    $("#redo").disabled = !canRedo;
  },
  onToolChange(tool) {
    document.querySelectorAll("[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    });
    $("#canvas-hint").textContent =
      tool === "select"
        ? "Drag to select · Space to pan"
        : tool === "hand"
          ? "Drag to explore your canvas"
          : tool === "draw"
            ? "Draw freely · Escape to select"
            : "Click or drag to create · Escape to select";
  },
  onError: (message) => toast(message, true),
});

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $("#toast");
  el.textContent = message;
  el.className = `show ${error ? "error" : ""}`;
  toastTimer = setTimeout(
    () => {
      el.className = "";
    },
    error ? 7000 : 3500,
  );
}
function persist(immediate = false) {
  if (recoveryError || externalChange) return;
  clearTimeout(saveTimer);
  const save = () => {
    try {
      saveWorkspace(projects, activeProjectId, activeBoardId);
      saveFailed = false;
    } catch {
      saveFailed = true;
      toast(
        "Local storage is full or unavailable. Export your project to keep a backup.",
        true,
      );
    }
    updateStatus();
  };
  if (immediate) save();
  else saveTimer = setTimeout(save, 250);
}
function updateStatus() {
  const p = project();
  $("#save-status").innerHTML =
    `<span></span>${saveFailed ? "Save failed — export a backup" : externalChange ? "Updated in another tab" : "Saved locally"}`;
  $("#save-status").classList.toggle("failed", saveFailed || externalChange);
  $("#board-meta").textContent =
    `${p.boards.length} ${p.boards.length === 1 ? "board" : "boards"} in this project${p.repository ? `  ·  ${p.repository.branch}` : "  ·  Personal board"}`;
  $("#github-top").innerHTML =
    `${icon("github")}<span>${githubUser ? esc(githubUser.login) : "Connect GitHub"}</span>`;
  const commit = $("#commit-button");
  commit.innerHTML = `${icon(githubBusy ? "refresh" : "cloud")}<span>${githubBusy ? "Syncing…" : connected() && !dirty() ? "Synced to GitHub" : "Save to GitHub"}</span>`;
  commit.disabled = githubBusy;
  $(".github-card-button").innerHTML =
    `${icon("github", 17)}<span>${githubUser ? "Manage GitHub sync" : "Connect GitHub"}</span>`;
  $("#user-name").textContent = githubUser
    ? githubUser.login
    : "Your workspace";
}
function miniature(boardData) {
  const items = boardData.items;
  if (!items.length) return '<div class="thumbnail-empty"><span>✦</span></div>';
  const xs = items.map((i) => i.x),
    ys = items.map((i) => i.y),
    minX = Math.min(...xs),
    minY = Math.min(...ys);
  const w = Math.max(300, ...items.map((i) => i.x + i.width - minX)),
    h = Math.max(180, ...items.map((i) => i.y + i.height - minY));
  const previewStride = Math.max(1, Math.ceil(items.length / 160));
  return `<svg viewBox="${minX - 20} ${minY - 20} ${w + 40} ${h + 40}" aria-hidden="true">${items
    .filter((i, index) => index % previewStride === 0)
    .map((i) => {
      if (["draw", "arrow", "line"].includes(i.type))
        return `<polyline points="${(i.points || []).map((p) => `${Number(p[0])},${Number(p[1])}`).join(" ")}" fill="none" stroke="${esc(i.stroke)}" stroke-width="3"/>`;
      if (i.type === "text")
        return `<rect x="${i.x}" y="${i.y + 8}" width="${Math.min(i.width, i.text.length * i.fontSize * 0.3)}" height="${Math.min(i.fontSize, 16)}" rx="4" fill="${esc(i.textColor || i.stroke)}" opacity=".5"/>`;
      if (i.type === "image")
        return `<image href="${esc(i.src)}" x="${i.x}" y="${i.y}" width="${i.width}" height="${i.height}"/>`;
      return `<rect x="${i.x}" y="${i.y}" width="${i.width}" height="${i.height}" rx="${i.type === "sticky" ? 0 : 6}" fill="${esc(i.fill)}" stroke="${i.type === "frame" ? "#d8dbe1" : "none"}" stroke-width="2"/>`;
    })
    .join("")}</svg>`;
}
function renderThumbnail(b) {
  const el = document.getElementById(`thumb-${b.id}`);
  if (el) el.innerHTML = miniature(b);
}
function renderSidebar(filter = $("#board-search").value) {
  const p = project();
  $("#project-name").textContent = p.name;
  $(".project-avatar").textContent = p.name[0]?.toUpperCase() || "P";
  $("#project-subtitle").textContent = p.repository
    ? `${p.repository.owner}/${p.repository.repo}`
    : "Personal project";
  $("#breadcrumb-project").textContent = p.name;
  $("#breadcrumb-board").textContent = board().name;
  $("#board-title").innerHTML = `${esc(board().name)} ${icon("chevron", 15)}`;
  $("#board-count").textContent = p.boards.length;
  const matches = p.boards.filter((b) =>
    b.name.toLowerCase().includes(filter.toLowerCase()),
  );
  $("#board-list").innerHTML =
    matches
      .map(
        (b, i) =>
          `<button type="button" class="board-card ${b.id === activeBoardId ? "active" : ""}" data-board="${esc(b.id)}"><div class="board-thumbnail" id="thumb-${b.id}">${miniature(b)}</div><div class="board-card-name"><span>${esc(b.name)}</span>${b.id === activeBoardId ? '<span class="active-dot"></span>' : ""}</div><small>${b.items.length} objects${b.id === activeBoardId ? " · Open now" : ""}</small></button>`,
      )
      .join("") || '<p class="no-results">No boards found.</p>';
  $("#board-list .board-card.active")?.scrollIntoView({ block: "nearest" });
  updateStatus();
}
function activate(pId, bId, resetHistory = false) {
  editor.finishEditing();
  editor.cancelGesture();
  activeProjectId = pId;
  activeBoardId = bId ?? project().boards[0].id;
  if (!project().boards.some((b) => b.id === activeBoardId))
    activeBoardId = project().boards[0].id;
  $("#board-search").value = "";
  currentSelection = [];
  editor.setBoard(board(), { resetHistory });
  currentView = board().view;
  $("#zoom-value").textContent = `${Math.round(currentView.zoom * 100)}%`;
  $("#empty-hint").hidden = board().items.length > 0;
  renderSidebar();
  renderProperties();
  persist();
  if (innerWidth < 760) $("#app").classList.remove("sidebar-open");
}
function renderProperties(force = false) {
  const el = $("#properties");
  el.hidden = !currentSelection.length;
  if (!currentSelection.length) return;
  if (
    !force &&
    el.contains(document.activeElement) &&
    document.activeElement.type === "color"
  )
    return;
  const i = currentSelection[0];
  el.innerHTML = `<span class="selection-count">${currentSelection.length > 1 ? `${currentSelection.length} objects` : { sticky: "Sticky note", rect: "Rectangle", draw: "Drawing" }[i.type] || i.type[0].toUpperCase() + i.type.slice(1)}</span><span class="divider"></span><div class="swatches">${COLORS.map((c) => `<button type="button" data-fill="${c}" style="--swatch:${c}" class="swatch ${i.fill === c ? "selected" : ""}" title="Fill ${c}" aria-label="Fill ${c}"></button>`).join("")}<label class="custom-color" title="Custom fill"><input type="color" id="custom-fill" aria-label="Custom fill color" value="${/^#[0-9a-f]{6}$/i.test(i.fill) ? i.fill : "#ffffff"}">${icon("palette", 16)}</label></div><span class="divider"></span><label class="stroke-input" title="Stroke and text color"><input type="color" id="stroke-color" value="${/^#[0-9a-f]{6}$/i.test(i.stroke) ? i.stroke : "#353846"}" aria-label="Stroke and text color"></label><select id="font-size" aria-label="Font size">${Array.from(
    new Set([12, 16, 18, 20, 24, 28, 32, 40, 48, 64, i.fontSize]),
  )
    .sort((a, b) => a - b)
    .map(
      (n) =>
        `<option value="${n}" ${n === i.fontSize ? "selected" : ""}>${n}</option>`,
    )
    .join(
      "",
    )}</select>${iconButton("bold", "Bold", "bold")}${iconButton("duplicate-selected", "Duplicate selected objects", "copy")}${iconButton("lock-selected", i.locked ? "Unlock objects" : "Lock objects", i.locked ? "unlock" : "lock")}${iconButton("front", "Bring to front", "front")}${iconButton("back", "Send to back", "back")}<span class="divider"></span>${iconButton("delete-selected", "Delete selected objects", "trash")}`;
  $("#custom-fill").oninput = (e) =>
    editor.updateSelected({ fill: e.target.value });
  $("#custom-fill").onchange = () => renderProperties(true);
  $("#stroke-color").oninput = (e) =>
    editor.updateSelected({
      stroke: e.target.value,
      textColor: e.target.value,
    });
  $("#stroke-color").onchange = () => renderProperties(true);
  $("#font-size").onchange = (e) =>
    editor.updateSelected({ fontSize: Number(e.target.value) });
}

function modal(title, subtitle, content, submit, submitLabel = "") {
  const d = $("#modal");
  if (d.open) d.close();
  d.innerHTML = `<form id="modal-form"><div class="modal-header"><div class="modal-symbol">${icon("spark", 23)}</div>${iconButton("close-modal", "Close dialog", "close")}</div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p class="modal-subtitle">${esc(subtitle)}</p>` : ""}<div class="modal-content">${content}</div><div id="modal-error" class="inline-error" role="alert" hidden></div>${submitLabel ? `<div class="modal-footer">${button("close-modal", "Cancel", null, "secondary-button")}<button type="submit" class="primary-button" id="modal-submit">${esc(submitLabel)}</button></div>` : ""}</form>`;
  $("#modal-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!submit) return;
    const submitButton = $("#modal-submit");
    if (submitButton) submitButton.disabled = true;
    $("#modal-error").hidden = true;
    try {
      await submit(new FormData(e.currentTarget));
    } catch (error) {
      const el = $("#modal-error");
      if (el) {
        el.textContent = error.message;
        el.hidden = false;
      }
    } finally {
      if (submitButton?.isConnected) submitButton.disabled = false;
    }
  };
  d.showModal();
  setTimeout(
    () =>
      d.querySelector("input:not([type=radio]):not([type=checkbox])")?.focus(),
    50,
  );
}
function field(
  label,
  name,
  value = "",
  placeholder = "",
  type = "text",
  extra = "",
) {
  return `<label class="form-field">${label}<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}></label>`;
}
function templatePicker() {
  return `<span class="field-label">Start with a template</span><div class="template-grid">${templates.map(([id, title, desc, glyph], i) => `<label class="template-card"><input type="radio" name="template" value="${id}" ${i === 0 ? "checked" : ""}><span class="template-art ${id}">${icon(glyph, 28)}<i></i><i></i><i></i></span><strong>${title}</strong><small>${desc}</small></label>`).join("")}</div>`;
}
function newBoard() {
  modal(
    "A fresh canvas awaits.",
    "Every big idea starts somewhere.",
    field(
      "Board name",
      "name",
      "Untitled board",
      "",
      "text",
      'required maxlength="200"',
    ) + templatePicker(),
    (data) => {
      const b = createBoard(
        data.get("name").trim() || "Untitled board",
        data.get("template"),
      );
      project().boards.push(b);
      project().updatedAt = date();
      $("#modal").close();
      activate(project().id, b.id);
      toast("Your new board is ready.");
    },
    "Create board",
  );
}
function newProject() {
  modal(
    "Make space for something new.",
    "Keep related boards together in a project.",
    field(
      "Project name",
      "name",
      "My new project",
      "",
      "text",
      'required maxlength="200"',
    ) +
      field(
        "Description (optional)",
        "description",
        "",
        "What are you working on?",
      ) +
      templatePicker(),
    (data) => {
      const p = createProject(
        data.get("name").trim() || "Untitled project",
        data.get("template"),
      );
      p.description = data.get("description");
      projects.push(p);
      $("#modal").close();
      activate(p.id, p.boards[0].id);
      toast("Project created. Connect GitHub whenever you’re ready.");
    },
    "Create project",
  );
}
function projectManager() {
  modal(
    "Your projects",
    "A home for every kind of idea.",
    `<div class="project-list">${projects.map((p) => `<button type="button" data-project="${p.id}" class="project-row ${p.id === activeProjectId ? "selected" : ""}"><span class="project-avatar">${esc(p.name[0]?.toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${p.boards.length} boards · ${p.repository ? esc(`${p.repository.owner}/${p.repository.repo}`) : "Local project"}</small></span>${icon(p.id === activeProjectId ? "check" : "right", 18)}</button>`).join("")}</div><div class="modal-action-grid">${button("new-project", "New project", "plus", "primary-button")}${button("project-settings", "Project settings", "folder", "secondary-button")}${button("import", "Import file", "upload", "secondary-button")}${button("github", "Import from GitHub", "github", "secondary-button")}</div>`,
  );
}
function projectSettings() {
  const p = project();
  modal(
    "Project settings",
    "Organize your workspace.",
    field(
      "Project name",
      "name",
      p.name,
      "",
      "text",
      'required maxlength="200"',
    ) +
      field("Description", "description", p.description) +
      `<div class="settings-actions">${button("export-project", "Export project backup", "download", "secondary-button")}${button("delete-project", "Delete local project", "trash", "danger-button")}</div>`,
    (data) => {
      p.name = data.get("name").trim() || p.name;
      p.description = data.get("description");
      p.updatedAt = date();
      persist();
      renderSidebar();
      $("#modal").close();
    },
    "Save changes",
  );
}
function boardSettings() {
  const b = board();
  modal(
    "Board settings",
    "Give this canvas a name that fits.",
    field(
      "Board name",
      "name",
      b.name,
      "",
      "text",
      'required maxlength="200"',
    ) +
      `<div class="settings-actions">${button("duplicate-board", "Duplicate board", "copy", "secondary-button")}${button("export", "Export board", "download", "secondary-button")}${button("delete-board", "Delete board", "trash", "danger-button")}</div>`,
    (data) => {
      b.name = data.get("name").trim() || b.name;
      b.updatedAt = date();
      project().updatedAt = date();
      persist();
      renderSidebar();
      $("#modal").close();
    },
    "Save changes",
  );
}
function confirmAction(title, description, label, fn) {
  modal(
    title,
    description,
    '<p class="confirmation-note">This action only affects your local workspace. Sync changes explicitly when you’re ready.</p>',
    () => {
      fn();
      $("#modal").close();
    },
    label,
  );
}
function download(content, filename, type = "application/json") {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const filename = (name, extension) =>
  `${name.replace(/[^a-zA-Z0-9_\-]/g, "-").replace(/-+/g, "-") || "gitboard"}.${extension}`;
function exportProject() {
  download(
    JSON.stringify(validateProject(project()), null, 2),
    filename(project().name, "json"),
  );
  toast("Project backup exported.");
}
function exportDialog() {
  modal(
    "Take your ideas with you.",
    "Export the current board or back up the whole project.",
    `<div class="export-options">${button("export-png", "PNG image", "image", "export-option")}${button("export-svg", "SVG vector", "frame", "export-option")}${button("export-board", "Board JSON", "board", "export-option")}${button("export-project", "Project JSON", "folder", "export-option")}</div><p class="help-note">JSON files preserve editable objects. Project backups include every board and embedded image.</p>`,
  );
}
function importDialog() {
  modal(
    "Bring your ideas in.",
    "Import a diagram or pick up where you left off.",
    `<div class="export-options">${button("import-drawio", "draw.io diagram", "board", "export-option")}${button("import-json", "GitBoard JSON", "folder", "export-option")}</div><p class="help-note">Choose a <strong>.drawio</strong> or <strong>.xml</strong> file to create an editable board for each diagram page. JSON imports restore GitBoard boards or projects.</p>`,
  );
}
function chooseImport(format) {
  if (importBusy) return toast("Your file is still importing.");
  const input = $("#import-file");
  input.accept =
    format === "drawio"
      ? ".drawio,.xml,application/xml,text/xml,application/vnd.jgraph.mxfile"
      : ".json,application/json";
  input.click();
}
async function importFile(file) {
  if (importBusy)
    throw new Error("Wait for the current file to finish importing.");
  if (file.size > 40_000_000)
    throw new Error(
      "This file is too large. Choose a file smaller than 40 MB.",
    );
  const target = project();
  importBusy = true;
  try {
    const source = await file.text();
    if (
      source.trimStart().startsWith("<") ||
      /\.(drawio|xml)$/i.test(file.name)
    ) {
      const { boards: importedBoards, warnings } = await importDrawio(source, {
        filename: file.name,
      });
      if (!projects.includes(target))
        throw new Error(
          "The destination project was removed. Choose a project and import again.",
        );
      if (target.boards.length + importedBoards.length > 200)
        throw new Error(
          "A project can contain up to 200 boards. Import this file into a new project.",
        );
      // Validate every page before adding anything to the existing project.
      validateProject({
        ...target,
        boards: [...target.boards, ...importedBoards],
      });
      target.boards.push(...importedBoards);
      target.updatedAt = date();
      $("#modal").close();
      activate(target.id, importedBoards[0].id);
      editor.fit();
      persist(true);
      toast(
        `Imported ${importedBoards.length} ${importedBoards.length === 1 ? "board" : "boards"} from draw.io.`,
      );
      if (warnings.length) {
        modal(
          "Your diagram is ready.",
          "Some diagram features were simplified during import.",
          `<ul class="import-notices">${warnings
            .slice(0, 20)
            .map((warning) => `<li>${esc(warning)}</li>`)
            .join(
              "",
            )}</ul>${warnings.length > 20 ? `<p class="help-note">And ${warnings.length - 20} more notices.</p>` : ""}<div class="modal-footer">${button("close-modal", "Open board", null, "primary-button")}</div>`,
        );
      }
      return;
    }
    let raw;
    try {
      raw = JSON.parse(source);
    } catch {
      throw new Error("Choose a valid GitBoard JSON or draw.io XML file.");
    }
    if (!raw || typeof raw !== "object")
      throw new Error("Choose a GitBoard project or board JSON file.");
    if (raw.schemaVersion === 1 && Array.isArray(raw.boards)) {
      if (projects.length >= 200)
        throw new Error("Your workspace can contain up to 200 projects.");
      const p = validateProject(raw);
      const old = projects.find((x) => x.id === p.id);
      if (old) {
        p.id = uid();
        p.name += " (imported)";
      }
      projects.push(p);
      activate(p.id, p.boards[0].id);
    } else if (raw.items && raw.id) {
      const p = createProject("Import");
      p.boards = [raw];
      const b = validateProject(p).boards[0];
      if (!projects.includes(target))
        throw new Error(
          "The destination project was removed. Choose a project and import again.",
        );
      if (target.boards.some((x) => x.id === b.id)) b.id = uid();
      if (target.boards.length >= 200)
        throw new Error("A project can contain up to 200 boards.");
      validateProject({ ...target, boards: [...target.boards, b] });
      target.boards.push(b);
      target.updatedAt = date();
      activate(target.id, b.id);
    } else
      throw new Error(
        "Choose a GitBoard project or board JSON file, or a draw.io diagram.",
      );
    $("#modal").close();
    toast("Your import is ready to edit.");
  } finally {
    importBusy = false;
  }
}
async function addImage(file) {
  const destinationBoardId = board().id;
  if (file.size > 4_000_000)
    throw new Error(
      "Use an image smaller than 4 MB so your project stays easy to save.",
    );
  if (
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Could not open this image."));
    image.src = src;
  });
  if (board().id !== destinationBoardId)
    throw new Error("Open the original board to add this image.");
  const factor = Math.min(1, 600 / image.width, 600 / image.height);
  editor.addItem("image", {
    src,
    width: image.width * factor,
    height: image.height * factor,
  });
  toast("Image added to your board.");
}

function githubDialog() {
  if (!github) {
    modal(
      "Your ideas, versioned.",
      "Connect GitHub to save projects as repositories.",
      `<div class="integration-banner">${icon("github", 32)}<div><strong>A repository for each project.</strong><p>All your boards. One commit. A history you can come back to.</p></div></div>${field("Personal access token", "token", "", "github_pat_…", "password", 'required autocomplete="off" spellcheck="false"')}<p class="help-note">Your token stays in memory and is cleared when you reload. Choose repository access with <strong>Contents: read and write</strong>. Creating repositories also needs <strong>Administration: write</strong>.</p><a class="text-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create a fine-grained token ${icon("external", 13)}</a>`,
      async (data) => {
        const client = new GitHubClient(data.get("token"));
        githubBusy = true;
        updateStatus();
        try {
          const user = await client.getUser();
          github = client;
          githubUser = user;
          toast(`Connected as ${user.login}.`);
        } finally {
          githubBusy = false;
          updateStatus();
        }
        githubDialog();
      },
      "Connect GitHub",
    );
    return;
  }
  const r = connected();
  modal(
    "Your GitHub workspace",
    `Connected as ${githubUser.login}. Your token is kept in memory.`,
    `${r ? `<div class="repository-card">${icon("github", 28)}<div><strong>${esc(r.owner)}/${esc(r.repo)}</strong><small>${icon("branch", 13)} ${esc(r.branch)} · ${project().repository ? (dirty() ? "Local changes to commit" : "Up to date") : "Initial save pending"}</small></div><a href="https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}" target="_blank" rel="noopener noreferrer" title="Open repository">${icon("external", 16)}</a></div><div class="modal-action-grid">${button("commit", "Commit changes", "cloud", "primary-button")}${button("pull", "Pull latest", "download", "secondary-button")}${button("detach", "Disconnect repository", "unlock", "secondary-button")}</div>` : `<div class="integration-banner">${icon("branch", 30)}<div><strong>Give this project a home.</strong><p>Create a new repository or connect an existing empty one.</p></div></div><div class="modal-action-grid">${button("create-repo", "Create repository", "plus", "primary-button")}${button("link-repo", "Link existing repo", "branch", "secondary-button")}</div>`}<hr><div class="modal-action-grid">${button("import-repo", "Import a GitHub project", "download", "secondary-button")}${button("disconnect-github", "Disconnect GitHub", "github", "secondary-button")}</div><p class="help-note">Projects are saved in <code>gitboard/project.json</code> and <code>gitboard/boards/</code>. GitHub sync is manual; local changes save automatically.</p>`,
  );
}
function createRepoDialog() {
  if (!github) return githubDialog();
  const p = project();
  modal(
    "A home for your project.",
    "Create a GitHub repository and save all boards in one commit.",
    field(
      "Repository name",
      "name",
      p.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      "my-project",
      "text",
      'required pattern="[A-Za-z0-9_.\\-]+" maxlength="100"',
    ) +
      field(
        "Description",
        "description",
        p.description || "A GitBoard project",
      ) +
      field(
        "Organization (optional)",
        "organization",
        "",
        "Leave blank for your personal account",
      ) +
      `<label class="checkbox-label"><input name="private" type="checkbox" checked><span><strong>Private repository</strong><small>Only people you give access to can see your boards.</small></span></label><p class="help-note">Your token needs Administration write permission to create a repository, and Contents write to save boards. New repositories need token access too.</p>`,
    async (data) => {
      githubBusy = true;
      updateStatus();
      try {
        const result = await github.createRepository({
          name: data.get("name"),
          description: data.get("description"),
          private: data.has("private"),
          organization: data.get("organization").trim() || undefined,
        });
        p.pendingRepository = {
          owner: result.owner.login,
          repo: result.name,
          branch: result.default_branch,
        };
        pendingRepositories.set(p.id, p.pendingRepository);
        persist(true);
        await pushSnapshot(p, "Create GitBoard project");
        $("#modal").close();
        toast("Repository created and your project is saved.");
      } catch (error) {
        if (pendingRepositories.has(p.id)) {
          toast(
            `Repository created, but the initial save failed: ${error.message}`,
            true,
          );
          githubDialog();
        } else throw error;
      } finally {
        githubBusy = false;
        updateStatus();
      }
    },
    "Create & save project",
  );
}
function repoFields() {
  return (
    field(
      "Repository",
      "repository",
      "",
      "owner/repository",
      "text",
      'required spellcheck="false"',
    ) +
    field(
      "Branch (optional)",
      "branch",
      "",
      "Use the default branch",
      "text",
      'spellcheck="false"',
    )
  );
}
function parseRepository(value) {
  value = value
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = value.split("/");
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_.-]+$/.test(p)))
    throw new Error("Enter a repository as owner/name.");
  return { owner: parts[0], repo: parts[1] };
}
function importRepoDialog() {
  if (!github) return githubDialog();
  modal(
    "Bring a project into your workspace.",
    "Open all boards from an existing GitBoard repository.",
    repoFields() +
      `<p class="help-note">The repository must contain <code>gitboard/project.json</code>. Importing leaves your current project in your workspace.</p>`,
    async (data) => {
      githubBusy = true;
      updateStatus();
      try {
        const imported = await github.readProject({
          ...parseRepository(data.get("repository")),
          branch: data.get("branch").trim() || undefined,
        });
        const existing = projects.find((p) => p.id === imported.id);
        if (existing) {
          if (
            existing.repository?.owner === imported.repository.owner &&
            existing.repository?.repo === imported.repository.repo
          ) {
            activate(existing.id, existing.boards[0].id);
            $("#modal").close();
            toast(
              "This project is already open. Use Pull latest to refresh it.",
            );
            return;
          }
          throw new Error(
            "A project with this ID is already in your workspace. Export it before deleting or replacing it.",
          );
        }
        projects.push(imported);
        $("#modal").close();
        activate(imported.id, imported.boards[0].id);
        toast("Project imported from GitHub.");
      } finally {
        githubBusy = false;
        updateStatus();
      }
    },
    "Import project",
  );
}
function linkRepoDialog() {
  const p = project();
  modal(
    "Connect an existing repository.",
    "Save this project in a repository you already own.",
    repoFields() +
      `<p class="help-note">Use a repository initialized with a README. Repositories containing a GitBoard project should be imported instead. Other repository files are preserved.</p>`,
    async (data) => {
      githubBusy = true;
      updateStatus();
      try {
        const r = parseRepository(data.get("repository"));
        const repo = await github.getRepository(r.owner, r.repo);
        p.pendingRepository = {
          ...r,
          branch: data.get("branch").trim() || repo.default_branch,
        };
        pendingRepositories.set(p.id, p.pendingRepository);
        persist(true);
        await pushSnapshot(p, "Add GitBoard project");
        $("#modal").close();
        updateStatus();
        toast("Project connected and saved to GitHub.");
      } finally {
        githubBusy = false;
        updateStatus();
      }
    },
    "Connect & save",
  );
}
async function pushSnapshot(p, message) {
  const snapshot = structuredClone(p);
  snapshot.repository ||= pendingRepositories.get(p.id);
  const content = projectContent(snapshot);
  const metadata = await github.pushProject(snapshot, message);
  p.repository = metadata;
  p.lastSyncedContent = content;
  delete p.pendingRepository;
  pendingRepositories.delete(p.id);
  persist(true);
  updateStatus();
}
function commitDialog() {
  if (!github) return githubDialog();
  if (!connected()) return createRepoDialog();
  const p = project(),
    r = connected();
  modal(
    "Save a little progress.",
    `${r.owner}/${r.repo} · ${r.branch}`,
    `<div class="commit-summary">${icon("branch", 22)}<span><strong>${p.boards.length} boards in this commit</strong><small>${p.boards.reduce((sum, b) => sum + b.items.length, 0)} objects · ${dirty() ? "Local changes ready to save" : "Project matches the last saved version"}</small></span></div>${field("Commit message", "message", p.repository ? "Update boards" : "Create GitBoard project", "", "text", 'required maxlength="500"')}<p class="help-note">All boards are saved together. If someone has updated this branch, syncing stops so you can pull their changes first.</p>`,
    async (data) => {
      githubBusy = true;
      updateStatus();
      try {
        await pushSnapshot(p, data.get("message"));
        $("#modal").close();
        toast("Your project is committed to GitHub.");
      } finally {
        githubBusy = false;
        updateStatus();
      }
    },
    "Commit to GitHub",
  );
}
function pullDialog() {
  if (!github) return githubDialog();
  const p = project();
  if (!p.repository)
    return toast("Save this project to a repository first.", true);
  const isDirty = dirty();
  modal(
    "Get the latest from GitHub.",
    isDirty
      ? "You have local changes. Keep a backup before replacing them."
      : "Refresh every board from the connected branch.",
    `${isDirty ? `<div class="notice">${icon("download", 20)}<p>Your current project will be downloaded as a JSON backup before the remote version replaces it.</p></div>` : ""}<p class="help-note">${esc(p.repository.owner)}/${esc(p.repository.repo)} · ${esc(p.repository.branch)}</p>`,
    async () => {
      githubBusy = true;
      updateStatus();
      const original = projectContent(p);
      try {
        const remote = await github.readProject(p.repository);
        if (!projects.includes(p))
          throw new Error(
            "The local project was removed during this pull. Import the repository to open it again.",
          );
        if (activeProjectId === p.id) {
          editor.finishEditing();
          editor.cancelGesture();
        }
        if (projectContent(p) !== original)
          throw new Error(
            "The local project changed during the pull. Try again to keep your latest edits.",
          );
        if (remote.id !== p.id)
          throw new Error(
            "The remote repository contains a different project. Import it as a separate project.",
          );
        if (isDirty)
          download(
            JSON.stringify(validateProject(p), null, 2),
            filename(`${p.name}-before-pull`, "json"),
          );
        projects[projects.findIndex((x) => x.id === p.id)] = remote;
        $("#modal").close();
        activate(
          remote.id,
          remote.boards.some((b) => b.id === activeBoardId)
            ? activeBoardId
            : remote.boards[0].id,
          true,
        );
        toast("Latest version pulled from GitHub.");
      } finally {
        githubBusy = false;
        updateStatus();
      }
    },
    isDirty ? "Back up & pull" : "Pull latest",
  );
}
function helpDialog() {
  modal(
    "A few shortcuts. Endless possibilities.",
    "Keep your hands on your ideas.",
    `<div class="shortcut-list">${[
      ["Select / hand", "V / H"],
      ["Sticky note / text", "N / T"],
      ["Rectangle / ellipse / diamond", "R / O / D"],
      ["Connector / line / pen / frame", "A / L / P / F"],
      ["Pan the canvas", "Space + drag"],
      ["Zoom", "Ctrl/⌘ + scroll"],
      ["Select multiple objects", "Shift + click"],
      ["Copy / paste / duplicate", "Ctrl/⌘ C / V / D"],
      ["Undo / redo", "Ctrl/⌘ Z / Shift Z"],
      ["Delete objects", "Delete / Backspace"],
      ["Find a board", "Ctrl/⌘ K"],
    ]
      .map(
        ([label, key]) => `<div><span>${label}</span><kbd>${key}</kbd></div>`,
      )
      .join(
        "",
      )}</div><p class="help-note">Double-click a note or shape to edit its text. Drag selection handles to resize. Work saves in this browser; export a backup or connect GitHub to keep it elsewhere. GitHub sync uses commits, without live multiplayer cursors.</p>`,
  );
}

const actions = {
  "toggle-sidebar": () => $("#app").classList.toggle("sidebar-open"),
  "close-modal": () => $("#modal").close(),
  projects: projectManager,
  "new-project": newProject,
  "new-board": newBoard,
  "project-settings": projectSettings,
  "board-settings": boardSettings,
  help: helpDialog,
  undo: () => editor.undo(),
  redo: () => editor.redo(),
  "zoom-in": () => editor.zoomBy(1.2),
  "zoom-out": () => editor.zoomBy(1 / 1.2),
  "zoom-reset": () => editor.setZoom(1),
  fit: () => editor.fit(),
  "add-sticky": () => editor.addItem("sticky"),
  "duplicate-selected": () => editor.duplicateSelected(),
  "delete-selected": () => editor.deleteSelected(),
  "lock-selected": () =>
    editor.updateSelected({ locked: !currentSelection[0]?.locked }),
  bold: () =>
    editor.updateSelected({
      bold: !(
        currentSelection[0]?.bold || currentSelection[0]?.fontWeight === 700
      ),
      fontWeight:
        currentSelection[0]?.bold || currentSelection[0]?.fontWeight === 700
          ? 400
          : 700,
    }),
  front: () => editor.reorderSelected?.("front"),
  back: () => editor.reorderSelected?.("back"),
  "duplicate-board": () => {
    const b = structuredClone(board());
    b.id = uid();
    b.name += " (copy)";
    b.createdAt = b.updatedAt = date();
    const ids = new Map(b.items.map((i) => [i.id, uid()]));
    b.items.forEach((i) => {
      i.id = ids.get(i.id);
      if (i.startId) i.startId = ids.get(i.startId);
      if (i.endId) i.endId = ids.get(i.endId);
    });
    project().boards.push(b);
    project().updatedAt = date();
    $("#modal").close();
    activate(project().id, b.id);
    toast("Board duplicated.");
  },
  "delete-board": () => {
    if (project().boards.length === 1)
      return toast("Keep at least one board in your project.", true);
    const p = project(),
      b = board();
    confirmAction(
      "Delete this board?",
      `“${b.name}” and its objects will be removed. Export it first if you need a copy.`,
      "Delete board",
      () => {
        p.boards = p.boards.filter((x) => x.id !== b.id);
        p.updatedAt = date();
        activate(p.id, p.boards[0].id);
      },
    );
  },
  "delete-project": () => {
    const p = project();
    confirmAction(
      "Delete this local project?",
      `“${p.name}” will be removed from this browser. Its GitHub repository stays available.`,
      "Delete project",
      () => {
        projects = projects.filter((x) => x.id !== p.id);
        if (!projects.length) projects = [createProject("My project")];
        activate(projects[0].id, projects[0].boards[0].id);
      },
    );
  },
  export: exportDialog,
  "export-project": exportProject,
  "export-board": () => {
    download(JSON.stringify(board(), null, 2), filename(board().name, "json"));
    toast("Editable board exported.");
  },
  "export-svg": () => {
    download(
      editor.exportSvg(),
      filename(board().name, "svg"),
      "image/svg+xml",
    );
    toast("SVG exported.");
  },
  "export-png": async () => {
    try {
      const result = await editor.exportPng();
      download(result, filename(board().name, "png"), "image/png");
      toast("PNG exported.");
    } catch (e) {
      toast(e.message, true);
    }
  },
  import: importDialog,
  "import-json": () => chooseImport("json"),
  "import-drawio": () => chooseImport("drawio"),
  github: githubDialog,
  "create-repo": createRepoDialog,
  "import-repo": importRepoDialog,
  "link-repo": linkRepoDialog,
  commit: commitDialog,
  pull: pullDialog,
  detach: () =>
    confirmAction(
      "Disconnect this repository?",
      "Your local boards and GitHub repository remain available.",
      "Disconnect",
      () => {
        delete project().repository;
        delete project().pendingRepository;
        delete project().lastSyncedContent;
        pendingRepositories.delete(project().id);
        persist();
        renderSidebar();
      },
    ),
  "disconnect-github": () => {
    github = null;
    githubUser = null;
    $("#modal").close();
    updateStatus();
    toast("GitHub disconnected. Your boards are saved locally.");
  },
};
document.addEventListener("click", (e) => {
  const target = e.target.closest(
    "[data-action],[data-tool],[data-board],[data-project],[data-fill]",
  );
  if (!target) return;
  if (target.dataset.action) {
    e.preventDefault();
    if (
      githubBusy &&
      [
        "github",
        "create-repo",
        "link-repo",
        "import-repo",
        "commit",
        "pull",
        "detach",
        "disconnect-github",
      ].includes(target.dataset.action)
    )
      return toast("Wait for the current GitHub sync to finish.", true);
    const result = actions[target.dataset.action]?.();
    if (result?.catch) result.catch((error) => toast(error.message, true));
  }
  if (target.dataset.tool) {
    if (target.dataset.tool === "image") $("#image-file").click();
    else editor.setTool(target.dataset.tool);
  }
  if (target.dataset.board) activate(activeProjectId, target.dataset.board);
  if (target.dataset.project) {
    $("#modal").close();
    activate(target.dataset.project);
  }
  if (target.dataset.fill) editor.updateSelected({ fill: target.dataset.fill });
});
$("#board-search").addEventListener("input", (e) =>
  renderSidebar(e.target.value),
);
$("#image-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file)
    try {
      await addImage(file);
    } catch (error) {
      toast(error.message, true);
    }
};
$("#import-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file)
    try {
      await importFile(file);
    } catch (error) {
      toast(error.message, true);
    }
};
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const rect = $("#modal").getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      $("#modal").close();
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if ($("#modal").open) $("#modal").close();
    $("#app").classList.add("sidebar-open");
    $("#board-search").focus();
    $("#board-search").select();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (!externalChange) persist(true);
  if (externalChange || saveFailed) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) {
    externalChange = true;
    clearTimeout(saveTimer);
    updateStatus();
    toast(
      "This workspace changed in another tab. Export your local project, then reload to get that version.",
      true,
    );
  }
});
activate(activeProjectId, activeBoardId);
if (recoveryError) {
  modal(
    "Your saved workspace needs attention.",
    recoveryError.message,
    `${button("backup-raw", "Download saved data", "download", "primary-button")}${button("reset-workspace", "Reset workspace", "refresh", "danger-button")}<p class="help-note">Your existing data has been left in storage. Download a copy before resetting.</p>`,
  );
  actions["backup-raw"] = () =>
    download(
      localStorage.getItem(STORAGE_KEY) || "{}",
      "gitboard-recovery.json",
    );
  actions["reset-workspace"] = () =>
    confirmAction(
      "Reset saved workspace?",
      "Download your saved data first. Reset replaces the unreadable local workspace.",
      "Reset workspace",
      () => {
        recoveryError = null;
        persist(true);
      },
    );
}
