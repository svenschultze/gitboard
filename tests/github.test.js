import test from "node:test";
import assert from "node:assert/strict";
import {
  GitHubClient,
  GitHubConflictError,
  GitHubError,
} from "../js/github.js";
import { createBoard, createProject, projectContent } from "../js/model.js";

const PREFIX = "/repos/octocat/workshop";
const HEAD = "a".repeat(40);
const NEXT_HEAD = "b".repeat(40);

function file(data, overrides = {}) {
  return {
    type: "file",
    encoding: "base64",
    content: Buffer.from(JSON.stringify(data), "utf8").toString("base64"),
    ...overrides,
  };
}

function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mockGitHub(routes) {
  const calls = [];
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.github.com");
    const request = {
      path: parsed.pathname + parsed.search,
      options,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(request);
    const key = `${options.method} ${request.path}`;
    assert.ok(Object.hasOwn(routes, key), `Unexpected GitHub request: ${key}`);
    const result = routes[key];
    return typeof result === "function" ? result(request) : response(result);
  };
  return { client: new GitHubClient("test-token", fetch), calls };
}

function projectFixture() {
  const project = createProject("Atelier — 東京 🚀", "blank");
  project.description = "Ideas from Zürich and São Paulo";
  project.boards[0].name = "Bienvenue, 世界";
  project.boards[0].items.push({
    id: "unicode-note",
    type: "sticky",
    x: -230,
    y: 145,
    width: 240,
    height: 180,
    text: "こんにちは 🌱\nCrème brûlée — Привет",
    fill: "#fff2a8",
    stroke: "#353846",
    fontSize: 22,
  });
  project.boards[0].view = { x: 123, y: -42, zoom: 0.75 };
  project.boards.push(createBoard("Research 🧠", "blank"));
  project.boards[1].items.push({
    id: "sketch",
    type: "draw",
    x: 4,
    y: 8,
    width: 38,
    height: 41,
    text: "",
    fill: "transparent",
    stroke: "#353846",
    fontSize: 20,
    points: [
      [4, 8],
      [12, 49],
      [42, 24],
    ],
  });
  return project;
}

function manifest(project) {
  const portable = JSON.parse(projectContent(project));
  return {
    schemaVersion: 1,
    id: portable.id,
    name: portable.name,
    description: portable.description,
    createdAt: portable.createdAt,
    updatedAt: portable.updatedAt,
    boards: portable.boards.map(({ id, name }) => ({ id, name })),
  };
}

function readRoutes(project, branch = "main") {
  return {
    [`GET ${PREFIX}`]: {
      name: "workshop",
      owner: { login: "octocat" },
      default_branch: branch,
    },
    [`GET ${PREFIX}/git/ref/heads/${encodeURIComponent(branch)}`]: {
      object: { type: "commit", sha: HEAD },
    },
    [`GET ${PREFIX}/contents/gitboard/project.json?ref=${HEAD}`]: file(
      manifest(project),
    ),
    ...Object.fromEntries(
      project.boards.map((board) => [
        `GET ${PREFIX}/contents/gitboard/boards/${board.id}.json?ref=${HEAD}`,
        file(board),
      ]),
    ),
  };
}

function pushRoutes(project, { hasManifest = true, updateStatus = 200 } = {}) {
  return {
    [`GET ${PREFIX}/git/ref/heads/main`]: {
      object: { type: "commit", sha: HEAD },
    },
    [`GET ${PREFIX}/git/commits/${HEAD}`]: { tree: { sha: "root-tree" } },
    [`GET ${PREFIX}/git/trees/root-tree`]: {
      tree: [
        { path: "README.md", type: "blob", sha: "readme" },
        { path: "gitboard", type: "tree", sha: "project-tree" },
        { path: "src", type: "tree", sha: "unrelated-tree" },
      ],
    },
    [`GET ${PREFIX}/git/trees/project-tree`]: {
      tree: [
        { path: "boards", type: "tree", sha: "boards-tree" },
        ...(hasManifest
          ? [{ path: "project.json", type: "blob", sha: "manifest-blob" }]
          : []),
      ],
    },
    [`GET ${PREFIX}/git/trees/boards-tree`]: {
      tree: [
        {
          path: "deleted-board.json",
          type: "blob",
          mode: "100644",
          sha: "old-board",
        },
        { path: "orphan.json", type: "blob", mode: "100644", sha: "orphan" },
        { path: "notes.txt", type: "blob", sha: "notes" },
        ...project.boards.map((board) => ({
          path: `${board.id}.json`,
          type: "blob",
          mode: "100644",
          sha: "existing-board",
        })),
      ],
    },
    [`GET ${PREFIX}/contents/gitboard/project.json?ref=${HEAD}`]: file(
      manifest(project),
    ),
    [`POST ${PREFIX}/git/trees`]: { sha: "new-tree" },
    [`POST ${PREFIX}/git/commits`]: { sha: NEXT_HEAD },
    [`PATCH ${PREFIX}/git/refs/heads/main`]: () =>
      response(
        updateStatus === 200
          ? { object: { sha: NEXT_HEAD } }
          : { message: "Update is not a fast forward" },
        updateStatus,
      ),
  };
}

function connect(project, headSha = HEAD) {
  project.repository = {
    owner: "octocat",
    repo: "workshop",
    branch: "main",
    headSha,
  };
  return project;
}

test("imports multiple UTF-8 boards from one immutable snapshot and records the sync baseline", async () => {
  const original = projectFixture();
  const { client, calls } = mockGitHub(readRoutes(original));
  const imported = await client.readProject({
    owner: "octocat",
    repo: "workshop",
  });
  assert.equal(projectContent(imported), projectContent(original));
  assert.equal(imported.repository.headSha, HEAD);
  assert.equal(imported.repository.branch, "main");
  assert.equal(imported.lastSyncedContent, projectContent(original));
  assert.ok(imported.repository.syncedAt);
  assert.equal(
    calls.filter((call) => call.path.includes("/contents/")).length,
    3,
  );
  assert.ok(
    calls
      .filter((call) => call.path.includes("/contents/"))
      .every((call) => call.path.endsWith(`ref=${HEAD}`)),
  );
  assert.ok(
    calls.every(
      (call) => call.options.headers.Authorization === "Bearer test-token",
    ),
  );
  assert.ok(
    calls.every(
      (call) =>
        call.options.redirect === "error" &&
        call.options.credentials === "omit",
    ),
  );
  assert.equal(JSON.stringify(client), "{}");
});

test("branches containing slashes are encoded without reading a different branch", async () => {
  const project = projectFixture();
  const { client, calls } = mockGitHub(readRoutes(project, "team/design"));
  const imported = await client.readProject({
    owner: "octocat",
    repo: "workshop",
    branch: "team/design",
  });
  assert.equal(imported.repository.branch, "team/design");
  assert.ok(calls.some((call) => call.path.includes("/heads/team%2Fdesign")));
});

test("a large board uses the Git Blobs API when Contents omits its payload", async () => {
  const project = projectFixture();
  const routes = readRoutes(project);
  const board = project.boards[0];
  routes[
    `GET ${PREFIX}/contents/gitboard/boards/${board.id}.json?ref=${HEAD}`
  ] = { type: "file", encoding: "none", content: "", sha: "large-blob" };
  routes[`GET ${PREFIX}/git/blobs/large-blob`] = file(board);
  const { client, calls } = mockGitHub(routes);
  assert.equal(
    projectContent(
      await client.readProject({ owner: "octocat", repo: "workshop" }),
    ),
    projectContent(project),
  );
  assert.ok(calls.some((call) => call.path.endsWith("/git/blobs/large-blob")));
});

test("a repository without a GitBoard manifest fails with actionable guidance and no writes", async () => {
  const routes = readRoutes(projectFixture());
  routes[`GET ${PREFIX}/contents/gitboard/project.json?ref=${HEAD}`] = () =>
    response({ message: "Not Found" }, 404);
  const { client, calls } = mockGitHub(routes);
  await assert.rejects(
    client.readProject({ owner: "octocat", repo: "workshop" }),
    /does not contain a GitBoard project/,
  );
  assert.ok(calls.every((call) => call.options.method === "GET"));
});

test("a missing board or mismatched board ID prevents importing a corrupt project", async () => {
  for (const mismatched of [false, true]) {
    const project = projectFixture();
    const board = project.boards[0];
    const routes = readRoutes(project);
    routes[
      `GET ${PREFIX}/contents/gitboard/boards/${board.id}.json?ref=${HEAD}`
    ] = mismatched
      ? file({ ...board, id: "wrong-board-id" })
      : () => response({}, 404);
    const { client } = mockGitHub(routes);
    await assert.rejects(
      client.readProject({ owner: "octocat", repo: "workshop" }),
      mismatched ? /does not match/ : /file is missing/,
    );
  }
});

test("oversized and path-traversing manifests are rejected before any board request", async () => {
  for (const invalidBoards of [
    Array.from({ length: 201 }, (_, i) => ({
      id: `board-${i}`,
      name: "Board",
    })),
    [{ id: "../../private", name: "Invalid board" }],
  ]) {
    const project = projectFixture();
    const routes = readRoutes(project);
    routes[`GET ${PREFIX}/contents/gitboard/project.json?ref=${HEAD}`] = file({
      ...manifest(project),
      boards: invalidBoards,
    });
    const { client, calls } = mockGitHub(routes);
    await assert.rejects(
      client.readProject({ owner: "octocat", repo: "workshop" }),
      GitHubError,
    );
    assert.ok(
      !calls.some((call) => call.path.includes("/contents/gitboard/boards/")),
    );
  }
});

test("a changed remote head is rejected before creating any Git object", async () => {
  const project = connect(projectFixture(), "c".repeat(40));
  const { client, calls } = mockGitHub(pushRoutes(project));
  await assert.rejects(client.pushProject(project), GitHubConflictError);
  assert.equal(calls.length, 1);
  assert.equal(project.repository.headSha, "c".repeat(40));
});

test("all boards commit atomically, deleted and orphaned board files are removed, and unrelated files survive", async () => {
  const project = connect(projectFixture());
  project.repository.token = "do-not-export";
  project.lastSyncedContent = "local-only baseline";
  const { client, calls } = mockGitHub(pushRoutes(project));
  const metadata = await client.pushProject(project, "Workshop update — café");
  const mutation = calls.filter((call) => call.options.method !== "GET");
  assert.deepEqual(
    mutation.map((call) => call.options.method),
    ["POST", "POST", "PATCH"],
  );
  const tree = mutation[0].body;
  assert.equal(tree.base_tree, "root-tree");
  const removed = tree.tree.filter((entry) => entry.sha === null);
  assert.deepEqual(
    removed.map((entry) => entry.path),
    ["gitboard/boards/deleted-board.json", "gitboard/boards/orphan.json"],
  );
  assert.ok(tree.tree.every((entry) => entry.path.startsWith("gitboard/")));
  assert.ok(
    !tree.tree.some((entry) => /README|src|notes\.txt/.test(entry.path)),
  );
  assert.equal(tree.tree.filter((entry) => entry.content).length, 3);
  assert.ok(!JSON.stringify(tree).includes("do-not-export"));
  assert.ok(!JSON.stringify(tree).includes("local-only baseline"));
  assert.deepEqual(JSON.parse(tree.tree[0].content), manifest(project));
  assert.deepEqual(mutation[1].body, {
    message: "Workshop update — café",
    tree: "new-tree",
    parents: [HEAD],
  });
  assert.deepEqual(mutation[2].body, { sha: NEXT_HEAD, force: false });
  assert.equal(metadata.headSha, NEXT_HEAD);
  assert.equal(metadata.owner, "octocat");
  assert.equal(metadata.branch, "main");
  assert.equal(
    project.repository.headSha,
    HEAD,
    "caller applies metadata only after a successful sync",
  );
});

test("an initial push cannot replace an existing GitBoard manifest", async () => {
  const project = connect(projectFixture(), null);
  const { client, calls } = mockGitHub(pushRoutes(project));
  await assert.rejects(
    client.pushProject(project),
    /already contains a GitBoard project/,
  );
  assert.ok(calls.every((call) => call.options.method === "GET"));
});

test("the first project push into an initialized repository preserves its README", async () => {
  const project = connect(projectFixture(), null);
  const routes = pushRoutes(project);
  routes[`GET ${PREFIX}/git/trees/root-tree`] = {
    tree: [{ path: "README.md", type: "blob", sha: "readme" }],
  };
  const { client, calls } = mockGitHub(routes);
  assert.equal(
    (await client.pushProject(project, "Create project")).headSha,
    NEXT_HEAD,
  );
  const tree = calls.find((call) => call.options.method === "POST").body;
  assert.equal(tree.base_tree, "root-tree");
  assert.equal(tree.tree.length, 3);
  assert.ok(
    tree.tree.every(
      (entry) => entry.path.startsWith("gitboard/") && entry.sha !== null,
    ),
  );
});

test("board files without a project manifest are protected against an initial push", async () => {
  const project = connect(projectFixture(), null);
  const { client, calls } = mockGitHub(
    pushRoutes(project, { hasManifest: false }),
  );
  await assert.rejects(
    client.pushProject(project),
    /without a project manifest/,
  );
  assert.ok(calls.every((call) => call.options.method === "GET"));
});

test("an imported connection cannot replace another project with a different ID", async () => {
  const project = connect(projectFixture());
  const routes = pushRoutes(project);
  routes[`GET ${PREFIX}/contents/gitboard/project.json?ref=${HEAD}`] = file({
    ...manifest(project),
    id: "another-project",
  });
  const { client, calls } = mockGitHub(routes);
  await assert.rejects(
    client.pushProject(project),
    /different GitBoard project/,
  );
  assert.ok(calls.every((call) => call.options.method === "GET"));
});

test("a branch change during commit creation fails with a conflict and never force pushes", async () => {
  for (const updateStatus of [409, 422]) {
    const project = connect(projectFixture());
    const { client, calls } = mockGitHub(pushRoutes(project, { updateStatus }));
    await assert.rejects(client.pushProject(project), GitHubConflictError);
    assert.equal(calls.at(-1).body.force, false);
    assert.equal(project.repository.headSha, HEAD);
  }
});

test("truncated repository trees stop sync before any mutation", async () => {
  const project = connect(projectFixture());
  const routes = pushRoutes(project);
  routes[`GET ${PREFIX}/git/trees/boards-tree`] = { tree: [], truncated: true };
  const { client, calls } = mockGitHub(routes);
  await assert.rejects(
    client.pushProject(project),
    /incomplete repository tree/,
  );
  assert.ok(calls.every((call) => call.options.method === "GET"));
});

test("new personal and organization repositories are initialized for an immediate atomic push", async () => {
  const { client, calls } = mockGitHub({
    "POST /user/repos": { name: "personal", default_branch: "main" },
    "POST /orgs/team/repos": { name: "workshop", default_branch: "main" },
  });
  await client.createRepository({
    name: "personal",
    description: "A new project",
    private: true,
  });
  await client.createRepository({ name: "workshop", organization: "team" });
  assert.deepEqual(calls[0].body, {
    name: "personal",
    description: "A new project",
    private: true,
    auto_init: true,
  });
  assert.equal(calls[1].body.auto_init, true);
  assert.equal(calls[1].body.private, false);
});

test("repository listing follows all GitHub pagination links", async () => {
  const first =
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
  const { client, calls } = mockGitHub({
    [`GET ${first}`]: () =>
      response([{ id: 1 }], 200, {
        link: '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=2>; rel="last"',
      }),
    "GET /user/repos?page=2": [{ id: 2 }],
  });
  assert.deepEqual(await client.listRepositories(), [{ id: 1 }, { id: 2 }]);
  assert.equal(calls.length, 2);
});

test("pagination cannot send the token to another origin", async () => {
  const first =
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
  const { client, calls } = mockGitHub({
    [`GET ${first}`]: () =>
      response([], 200, {
        link: '<https://example.com/steal-token>; rel="next"',
      }),
  });
  await assert.rejects(client.listRepositories(), /invalid pagination link/);
  assert.equal(calls.length, 1);
});

test("authentication, permission, missing repository, rate limit, and network errors give recovery guidance", async () => {
  const cases = [
    [401, {}, {}, /unexpired personal access token/],
    [
      403,
      { message: "Resource not accessible by personal access token" },
      {},
      /Contents read\/write/,
    ],
    [404, { message: "Not Found" }, {}, /Check the owner/],
    [
      403,
      { message: "API rate limit exceeded" },
      { "x-ratelimit-remaining": "0", "retry-after": "120" },
      /about 2 minute/,
    ],
    [429, {}, {}, /rate limit/],
    [503, {}, {}, /temporarily unavailable/],
  ];
  for (const [status, body, headers, expected] of cases) {
    const { client } = mockGitHub({
      "GET /user": () => response(body, status, headers),
    });
    await assert.rejects(
      client.getUser(),
      (error) =>
        error instanceof GitHubError &&
        error.status === status &&
        expected.test(error.message),
    );
  }
  const offline = new GitHubClient("test-token", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(offline.getUser(), /Check your connection/);
});
