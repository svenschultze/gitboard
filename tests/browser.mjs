// Optional real-browser verification. Requires Playwright and a running local server.
// See README.md for setup. This file is deliberately outside the default Node test glob.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { chromium } = await import(
  process.env.GITBOARD_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  ...(process.env.GITBOARD_BROWSER_PATH
    ? { executablePath: process.env.GITBOARD_BROWSER_PATH }
    : {}),
  args: ["--no-sandbox"],
});
const baseURL = process.env.GITBOARD_URL || "http://127.0.0.1:4173";
const failures = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.on("pageerror", (error) => failures.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") failures.push(message.text());
});
const action = (name, inDialog = false) =>
  page
    .locator(`${inDialog ? "#modal " : ""}[data-action="${name}"]`)
    .first()
    .click();
const submit = () => page.locator("#modal-submit").click();
const close = () => action("close-modal", true);
const stored = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("gitboard.workspace.v1")),
  );
const active = async () => {
  const ws = await stored();
  return ws.projects.find((project) => project.id === ws.activeProjectId);
};
const selectedBoard = async () => {
  const ws = await stored();
  return ws.projects
    .find((project) => project.id === ws.activeProjectId)
    .boards.find((board) => board.id === ws.activeBoardId);
};
const settle = () => page.waitForTimeout(350);
async function download(name) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    action(name, true),
  ]);
  assert.equal(await file.failure(), null);
  return {
    name: file.suggestedFilename(),
    data: await readFile(await file.path()),
  };
}

try {
  await page.goto(baseURL);
  await page.waitForSelector("#board-list .board-card");
  assert.equal(await page.locator("#board-list .board-card").count(), 3);
  assert.equal(await page.locator("#canvas [data-item-id]").count(), 18);
  if (process.env.GITBOARD_SCREENSHOT)
    await page.screenshot({
      path: process.env.GITBOARD_SCREENSHOT,
      fullPage: true,
    });

  await action("projects");
  await action("new-project", true);
  await page.locator('#modal input[name="name"]').fill("Browser QA");
  await page
    .locator('#modal input[name="description"]')
    .fill("Verified through the real interface");
  await submit();
  await settle();
  assert.equal((await active()).name, "Browser QA");
  assert.equal(await page.locator("#canvas [data-item-id]").count(), 0);

  await action("add-sticky");
  await page.keyboard.press("Enter");
  await page
    .locator('textarea[aria-label="Edit object text"]')
    .fill("A persistent idea");
  await page.keyboard.press("Control+Enter");
  await settle();
  assert.equal((await selectedBoard()).items[0].text, "A persistent idea");
  await page.keyboard.press("Control+z");
  await settle();
  assert.equal((await selectedBoard()).items[0].text, "");
  await page.keyboard.press("Control+Shift+z");
  await settle();
  assert.equal((await selectedBoard()).items[0].text, "A persistent idea");

  const beforeResize = (await selectedBoard()).items[0].width;
  const handle = await page.locator('#canvas [data-handle="se"]').boundingBox();
  assert.ok(handle);
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 90,
    handle.y + handle.height / 2 + 40,
    { steps: 6 },
  );
  await page.mouse.up();
  await settle();
  assert.ok((await selectedBoard()).items[0].width > beforeResize + 50);
  await page.keyboard.press("Control+z");
  await settle();
  assert.equal((await selectedBoard()).items[0].width, beforeResize);
  await page.keyboard.press("Control+Shift+z");
  await settle();
  assert.ok((await selectedBoard()).items[0].width > beforeResize + 50);

  await page.locator('[data-tool="rect"]').click();
  const canvas = await page.locator("#canvas").boundingBox();
  await page.mouse.move(canvas.x + 400, canvas.y + 160);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 610, canvas.y + 290, { steps: 6 });
  await page.mouse.up();
  await settle();
  assert.equal((await selectedBoard()).items.length, 2);
  assert.equal((await selectedBoard()).items[1].type, "rect");

  await action("new-board");
  await page.locator('#modal input[name="name"]').fill("Research");
  await page
    .locator("#modal .template-card")
    .filter({ has: page.locator('input[value="brainstorm"]') })
    .click();
  await submit();
  await settle();
  assert.equal((await selectedBoard()).items.length, 10);
  const sourceBoardId = (await active()).boards[0].id;
  const targetBoardId = (await selectedBoard()).id;
  await page.locator(`[data-board="${sourceBoardId}"]`).click();
  await page.locator("#canvas [data-item-id]").first().click();
  await page.keyboard.press("Enter");
  await page
    .locator('textarea[aria-label="Edit object text"]')
    .fill("Saved when switching boards");
  await page.locator(`[data-board="${targetBoardId}"]`).click();
  await settle();
  const switchedProject = await active();
  assert.equal(
    switchedProject.boards.find((board) => board.id === sourceBoardId).items[0]
      .text,
    "Saved when switching boards",
  );
  assert.equal((await selectedBoard()).items.length, 10);
  assert.equal((await selectedBoard()).items[0].text, "What could we create?");
  await action("board-settings");
  await page.locator('#modal input[name="name"]').fill("Research renamed");
  await submit();
  await settle();
  assert.equal((await selectedBoard()).name, "Research renamed");
  await action("board-settings");
  await action("duplicate-board", true);
  await settle();
  const duplicate = await selectedBoard();
  assert.equal((await active()).boards.length, 3);
  assert.equal(duplicate.name, "Research renamed (copy)");
  assert.equal(
    new Set(
      (await active()).boards.flatMap((board) =>
        board.items.map((item) => item.id),
      ),
    ).size,
    22,
  );
  await action("board-settings");
  await action("delete-board", true);
  await submit();
  await settle();
  assert.equal((await active()).boards.length, 2);

  const researchId = (await active()).boards.find(
    (board) => board.name === "Research renamed",
  ).id;
  await page.locator(`[data-board="${researchId}"]`).click();
  await action("export");
  const boardFile = await download("export-board");
  assert.equal(JSON.parse(boardFile.data).items.length, 10);
  const svgFile = await download("export-svg");
  assert.match(svgFile.data.toString(), /<svg/);
  const pngFile = await download("export-png");
  assert.equal(pngFile.data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const projectFile = await download("export-project");
  assert.equal(JSON.parse(projectFile.data).boards.length, 2);
  await close();

  await page
    .locator("#import-file")
    .setInputFiles({
      name: boardFile.name,
      mimeType: "application/json",
      buffer: boardFile.data,
    });
  await settle();
  assert.equal((await active()).boards.length, 3);
  assert.notEqual((await selectedBoard()).id, researchId);
  await page
    .locator("#import-file")
    .setInputFiles({
      name: projectFile.name,
      mimeType: "application/json",
      buffer: projectFile.data,
    });
  await settle();
  assert.equal((await active()).name, "Browser QA (imported)");
  assert.equal((await stored()).projects.length, 3);
  await page.reload();
  await page.waitForSelector("#board-list .board-card");
  assert.equal((await active()).name, "Browser QA (imported)");
  assert.equal(await page.locator("#board-list .board-card").count(), 2);

  console.log(
    "Passed canvas, board/project lifecycle, exports/imports and reload.",
  );

  // The GitHub test performs no external requests or repository writes.
  const files = new Map();
  const requests = [];
  let headSha = "a".repeat(40),
    commits = 0;
  let readGate = null, releaseRead = null;
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = decodeURIComponent(url.pathname),
      method = request.method();
    const body = request.postDataJSON();
    requests.push({ path, method, body, headers: request.headers() });
    if (readGate && path.includes('/contents/')) await readGate;
    let data;
    if (path === "/user") data = { login: "qa-user", id: 1 };
    else if (path === "/user/repos" && method === "POST")
      data = {
        owner: { login: "qa-user" },
        name: body.name,
        default_branch: "main",
      };
    else if (path.endsWith("/git/ref/heads/main"))
      data = { object: { type: "commit", sha: headSha } };
    else if (path.includes("/git/commits/") && method === "GET")
      data = { tree: { sha: "b".repeat(40) } };
    else if (path.endsWith(`/git/trees/${"b".repeat(40)}`))
      data = {
        tree: files.size
          ? [{ path: "gitboard", type: "tree", sha: "c".repeat(40) }]
          : [],
        truncated: false,
      };
    else if (path.endsWith(`/git/trees/${"c".repeat(40)}`))
      data = {
        tree: [
          { path: "project.json", type: "blob", sha: "f".repeat(40) },
          { path: "boards", type: "tree", sha: "d".repeat(40) },
        ],
        truncated: false,
      };
    else if (path.endsWith(`/git/trees/${"d".repeat(40)}`))
      data = {
        tree: [...files.keys()]
          .filter((path) => path.startsWith("gitboard/boards/"))
          .map((path) => ({
            path: path.split("/").at(-1),
            type: "blob",
            mode: "100644",
            sha: "f".repeat(40),
          })),
        truncated: false,
      };
    else if (path.endsWith("/git/trees") && method === "POST") {
      for (const entry of body.tree)
        entry.sha === null
          ? files.delete(entry.path)
          : files.set(entry.path, JSON.parse(entry.content));
      data = { sha: "e".repeat(40) };
    } else if (path.endsWith("/git/commits") && method === "POST")
      data = { sha: String(++commits).padStart(40, "0") };
    else if (path.endsWith("/git/refs/heads/main") && method === "PATCH") {
      headSha = body.sha;
      data = { object: { sha: headSha } };
    } else if (path.includes("/contents/"))
      data = {
        type: "file",
        encoding: "base64",
        content: Buffer.from(
          JSON.stringify(files.get(path.split("/contents/")[1])),
        ).toString("base64"),
      };
    else if (/^\/repos\/qa-user\/[^/]+$/.test(path))
      data = {
        owner: { login: "qa-user" },
        name: path.split("/").at(-1),
        default_branch: "main",
      };
    else throw new Error(`Unexpected mocked GitHub request: ${method} ${path}`);
    await route.fulfill({
      status: method === "POST" ? 201 : 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
      },
      body: JSON.stringify(data),
    });
  });
  await action("github");
  await page
    .locator('#modal input[name="token"]')
    .fill("github_pat_browser_test_only");
  await submit();
  await page.locator('#modal [data-action="create-repo"]').waitFor();
  await action("create-repo", true);
  await page.locator('#modal input[name="name"]').fill("browser-qa");
  await submit();
  await page.waitForFunction(() => !document.querySelector("#modal").open);
  await settle();
  assert.equal((await active()).repository.repo, "browser-qa");
  assert.equal(files.get("gitboard/project.json").boards.length, 2);
  assert.equal(
    [...files.keys()].filter((path) => path.startsWith("gitboard/boards/"))
      .length,
    2,
  );
  assert.ok(
    !JSON.stringify(await stored()).includes("github_pat_browser_test_only"),
  );
  assert.ok(
    !JSON.stringify([...files.values()]).includes(
      "github_pat_browser_test_only",
    ),
  );
  assert.ok(
    requests.every(
      (request) =>
        request.headers.authorization === "Bearer github_pat_browser_test_only",
    ),
  );
  const ref = requests.find((request) => request.method === "PATCH");
  assert.equal(ref.body.force, false);
  await action("new-board");
  await page.locator('#modal input[name="name"]').fill("Cloud board");
  await submit();
  await settle();
  await action("commit");
  await page.locator('#modal input[name="message"]').fill("Add a third board");
  await submit();
  await page.waitForFunction(() => !document.querySelector("#modal").open);
  assert.equal(commits, 2);
  assert.equal(files.get("gitboard/project.json").boards.length, 3);
  await action("board-settings");
  await action("delete-board", true);
  await submit();
  await settle();
  assert.equal((await active()).boards.length, 2);
  await action("github");
  await action("pull", true);
  const [backup] = await Promise.all([page.waitForEvent("download"), submit()]);
  assert.equal(
    JSON.parse(await readFile(await backup.path())).boards.length,
    2,
  );
  await page.waitForFunction(() => !document.querySelector("#modal").open);
  await settle();
  assert.equal((await active()).boards.length, 3);
  assert.ok(
    (await active()).boards.some((board) => board.name === "Cloud board"),
  );
  const beforeRace = await selectedBoard();
  readGate = new Promise(resolve => { releaseRead = resolve; });
  await action("github");
  await action("pull", true);
  const requested = page.waitForRequest(request => request.url().includes("/contents/gitboard/project.json"));
  await submit();
  await requested;
  await close();
  await page.locator("#canvas [data-item-id]").first().click();
  await page.keyboard.press("Enter");
  await page.locator('textarea[aria-label="Edit object text"]').fill("New text while GitHub is loading");
  readGate = null;
  releaseRead();
  await page.waitForFunction(() => !document.querySelector("#commit-button").disabled);
  await settle();
  assert.equal((await selectedBoard()).id, beforeRace.id);
  assert.equal((await selectedBoard()).items[0].text, "New text while GitHub is loading");
  assert.equal((await active()).boards.length, 3);
  await page.reload();
  await page.waitForSelector("#github-top");
  assert.match(await page.locator("#github-top").innerText(), /Connect GitHub/);
  assert.equal((await active()).repository.repo, "browser-qa");

  console.log("Passed mocked GitHub creation/commit/pull and token privacy.");
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  mobile.on("pageerror", (error) => failures.push(error.message));
  await mobile.goto(baseURL);
  await mobile.waitForSelector("#canvas svg");
  assert.ok(await mobile.locator("#canvas").isVisible());
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mobile.locator('[data-action="toggle-sidebar"]').click();
  assert.ok(await mobile.locator("#project-switch").isVisible());
  await mobile.locator('[data-action="new-board"]').first().click();
  assert.ok(await mobile.locator("#modal").isVisible());
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mobile.locator('#modal [data-action="close-modal"]').first().click();
  await mobile.close();
  assert.deepEqual(failures, []);
  console.log(
    "Browser checks passed: editing/undo/resize, project/board lifecycle, templates, JSON/SVG/PNG, import/reload, mocked GitHub creation/sync, token privacy, mobile.",
  );
} finally {
  await browser.close();
}
