import test from "node:test";
import assert from "node:assert/strict";
import {
  boundsOf,
  createBoard,
  createProject,
  loadWorkspace,
  projectContent,
  saveWorkspace,
  uid,
  validateProject,
} from "../js/model.js";

const STORAGE_KEY = "gitboard.workspace.v1";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function freshProject() {
  return createProject("Design system", "blank");
}

function withItem(item) {
  const project = freshProject();
  project.boards[0].items.push(item);
  return project;
}

test("new projects contain a valid editable blank board and independent identifiers", () => {
  const project = freshProject();
  const another = freshProject();
  assert.equal(project.name, "Design system");
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.boards.length, 1);
  assert.deepEqual(project.boards[0].items, []);
  assert.notEqual(project.id, another.id);
  assert.notEqual(project.boards[0].id, another.boards[0].id);
  assert.deepEqual(validateProject(project), project);
  assert.equal(new Set(Array.from({ length: 100 }, () => uid())).size, 100);
});

test("board creation records a usable default view", () => {
  const board = createBoard("Workshop", "blank");
  assert.equal(board.name, "Workshop");
  assert.deepEqual(board.items, []);
  assert.ok(Number.isFinite(board.view.x));
  assert.ok(Number.isFinite(board.view.y));
  assert.ok(Number.isFinite(board.view.zoom));
  assert.ok(board.view.zoom > 0);
});

test("portable exports round trip every board without GitHub credentials or local sync metadata", () => {
  const project = freshProject();
  project.boards.push(createBoard("Research", "blank"));
  project.repository = {
    owner: "example",
    repo: "design",
    branch: "main",
    token: "never-export-me",
  };
  project.lastSyncedContent = "local sync baseline";
  project.untrustedExtra = "ignored import field";
  const portable = JSON.parse(projectContent(project));
  assert.equal(portable.boards.length, 2);
  assert.equal(portable.repository, undefined);
  assert.equal(portable.lastSyncedContent, undefined);
  assert.equal(portable.untrustedExtra, undefined);
  assert.ok(!projectContent(project).includes("never-export-me"));
  assert.deepEqual(validateProject(portable), portable);
  assert.equal(
    projectContent(validateProject(portable)),
    projectContent(project),
  );
});

test("validation strips unknown data and preserves text as inert content", () => {
  const project = freshProject();
  project.name = "<img src=x onerror=alert(1)>";
  project.extra = { html: "<script>alert(1)</script>" };
  project.boards[0].extra = "unexpected";
  const clean = validateProject(project);
  assert.equal(clean.name, project.name);
  assert.equal(clean.extra, undefined);
  assert.equal(clean.boards[0].extra, undefined);
});

test("invalid schemas and duplicate board identifiers cannot enter a workspace", () => {
  assert.throws(() => validateProject(null));
  assert.throws(() => validateProject({}));
  assert.throws(() =>
    validateProject({ ...freshProject(), schemaVersion: 99 }),
  );
  assert.throws(() =>
    validateProject({ ...freshProject(), boards: "not an array" }),
  );
  const project = freshProject();
  project.boards.push(structuredClone(project.boards[0]));
  assert.throws(() => validateProject(project));
});

test("non-finite coordinates and invalid zoom are rejected instead of breaking the editor", () => {
  for (const invalid of [Infinity, -Infinity, NaN]) {
    const project = freshProject();
    project.boards[0].view.x = invalid;
    assert.throws(() => validateProject(project));
  }
  for (const invalid of [0, -1, Infinity, NaN]) {
    const project = freshProject();
    project.boards[0].view.zoom = invalid;
    assert.throws(() => validateProject(project));
  }
});

test("multiple projects and the selected board survive local storage reload", () => {
  const storage = memoryStorage();
  const first = freshProject();
  const second = createProject("Architecture", "blank");
  second.boards.push(createBoard("API", "blank"));
  const board = second.boards[1];
  const saved = saveWorkspace([first, second], second.id, board.id, storage);
  const loaded = loadWorkspace(storage);
  assert.ok(storage.getItem(STORAGE_KEY));
  assert.equal(saved.activeProjectId, second.id);
  assert.equal(loaded.activeProjectId, second.id);
  assert.equal(loaded.activeBoardId, board.id);
  assert.equal(loaded.projects.length, 2);
  assert.deepEqual(
    loaded.projects.map(projectContent),
    [first, second].map(projectContent),
  );
});

test("corrupt saved data is reported without destroying the stored backup", () => {
  for (const raw of [
    "not JSON",
    '{"projects":null}',
    '{"projects":[{"id":"broken"}]}',
  ]) {
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    assert.throws(() => loadWorkspace(storage));
    assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});

function graphic(type = "rect", extra = {}) {
  return {
    id: uid(),
    type,
    x: 12,
    y: -30,
    width: 180,
    height: 120,
    text: "An idea",
    fill: "#fff2a8",
    stroke: "#353846",
    fontSize: 20,
    ...extra,
  };
}

test("all provided templates have valid portable data", () => {
  for (const template of [
    "welcome",
    "brainstorm",
    "kanban",
    "retrospective",
    "blank",
  ]) {
    assert.doesNotThrow(() =>
      validateProject(createProject("Template", template)),
    );
  }
});

test("imported board objects retain editable text and safe image data", () => {
  const project = freshProject();
  project.boards[0].items.push(
    graphic("sticky", { text: "<script>alert(1)</script> & design" }),
    graphic("arrow", {
      height: 0,
      points: [
        [12, 20],
        [192, 20],
      ],
    }),
    graphic("image", { src: "data:image/png;base64,iVBORw0KGgo=" }),
  );
  const clean = validateProject(project);
  assert.equal(clean.boards[0].items[0].text, project.boards[0].items[0].text);
  assert.deepEqual(clean.boards[0].items[1].points, [
    [12, 20],
    [192, 20],
  ]);
  assert.equal(
    clean.boards[0].items[2].src,
    "data:image/png;base64,iVBORw0KGgo=",
  );
  assert.equal(projectContent(clean), projectContent(project));
});

test("duplicate object IDs and path-like identifiers are rejected", () => {
  const project = freshProject();
  const object = graphic();
  project.boards[0].items.push(object, structuredClone(object));
  assert.throws(() => validateProject(project));
  for (const unsafe of [
    "../../config",
    "../board",
    "a/b",
    "x?token=secret",
    "x#id",
    "",
  ]) {
    assert.throws(() =>
      validateProject(withItem(graphic("rect", { id: unsafe }))),
    );
    assert.throws(() => validateProject({ ...freshProject(), id: unsafe }));
  }
});

test("unsafe image URLs cannot become executable or external content", () => {
  for (const src of [
    "javascript:alert(1)",
    "https://example.com/image.png",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    'data:image/png;base64,abc" onload="alert(1)',
  ]) {
    assert.throws(() => validateProject(withItem(graphic("image", { src }))));
  }
});

test("non-finite object dimensions, invalid drawing points, and unsafe styles are rejected", () => {
  for (const field of [
    "x",
    "y",
    "width",
    "height",
    "fontSize",
    "strokeWidth",
    "opacity",
  ]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() =>
        validateProject(withItem(graphic("rect", { [field]: value }))),
      );
    }
  }
  for (const field of ["width", "height"]) {
    assert.throws(() =>
      validateProject(withItem(graphic("rect", { [field]: -1 }))),
    );
  }
  for (const points of [
    undefined,
    [],
    [[0, 0]],
    [
      [0, 0],
      [10, Infinity],
    ],
    [[0, 0], [1]],
    "not points",
  ]) {
    assert.throws(() => validateProject(withItem(graphic("draw", { points }))));
  }
  for (const extra of [
    { fill: "url(https://example.com/track)" },
    { stroke: "<script>" },
    { align: "justify" },
    { type: "iframe" },
  ])
    assert.throws(() => validateProject(withItem(graphic("rect", extra))));
});

test("bounds include all rectangles and path endpoints, including negative coordinates", () => {
  assert.deepEqual(boundsOf([]), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(
    boundsOf([
      graphic("rect", { x: -20, y: -40, width: 40, height: 30 }),
      graphic("rect", { x: 80, y: 10, width: 20, height: 50 }),
    ]),
    { x: -20, y: -40, width: 120, height: 100 },
  );
  assert.deepEqual(
    boundsOf(
      graphic("draw", {
        points: [
          [-50, 10],
          [5, -30],
          [100, 60],
        ],
      }),
    ),
    { x: -50, y: -30, width: 150, height: 90 },
  );
});

test("stale selection IDs recover to the first existing project and board", () => {
  const storage = memoryStorage();
  const project = freshProject();
  saveWorkspace([project], "deleted-project", "deleted-board", storage);
  const loaded = loadWorkspace(storage);
  assert.equal(loaded.activeProjectId, project.id);
  assert.equal(loaded.activeBoardId, project.boards[0].id);
});

test("repository metadata restored from storage has no arbitrary secret fields", () => {
  const storage = memoryStorage();
  const project = freshProject();
  project.repository = {
    owner: "octocat",
    repo: "design",
    branch: "main",
    headSha: "a".repeat(40),
    token: "never-restore-me",
    syncedAt: "2026-10-12T10:00:00Z",
  };
  saveWorkspace([project], project.id, project.boards[0].id, storage);
  const loaded = loadWorkspace(storage);
  assert.equal(loaded.projects[0].repository.token, undefined);
  assert.equal(loaded.projects[0].repository.owner, "octocat");
});

test('a pending repository survives reload without carrying credentials', () => {
  const storage = memoryStorage();
  const project = freshProject();
  project.pendingRepository = { owner: 'octocat', repo: 'ideas', branch: 'main', token: 'secret' };
  saveWorkspace([project], project.id, project.boards[0].id, storage);
  const loaded = loadWorkspace(storage);
  assert.deepEqual(loaded.projects[0].pendingRepository, { owner: 'octocat', repo: 'ideas', branch: 'main' });
  assert.equal(JSON.parse(projectContent(project)).pendingRepository, undefined);
});

test('pending repository branch control characters cannot enter the workspace', () => {
  for (const branch of ['', 'main\nother', 'main\u0000other']) {
    const storage = memoryStorage();
    const project = freshProject();
    project.pendingRepository = { owner: 'octocat', repo: 'ideas', branch };
    saveWorkspace([project], project.id, project.boards[0].id, storage);
    assert.throws(() => loadWorkspace(storage));
  }
});
