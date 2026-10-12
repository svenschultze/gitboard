// Optional real-browser verification. Fixtures here are synthetic.
// Supply a private local example through GITBOARD_DRAWIO_EXAMPLE; it is never copied into the repository.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { deflateRawSync } from "node:zlib";

const { chromium } = await import(
  process.env.GITBOARD_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  ...(process.env.GITBOARD_BROWSER_PATH
    ? { executablePath: process.env.GITBOARD_BROWSER_PATH }
    : {}),
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") failures.push(message.text());
});
page.on("request", (request) => {
  if (request.url().startsWith("https://example.com/"))
    failures.push("An imported label or image loaded an external URL.");
});
const baseURL = process.env.GITBOARD_URL || "http://127.0.0.1:4173";
const xmlEscape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const model = (label = "Editable shape") => `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="group" parent="1" vertex="1" style="group;"><mxGeometry x="100" y="200" width="600" height="400" as="geometry"/></mxCell>
  <mxCell id="rectangle" parent="group" vertex="1" value="${xmlEscape(label)}" style="rounded=1;html=1;whiteSpace=wrap;fillColor=#ccece4;strokeColor=#112233;fontColor=#223344;fontSize=18;align=left;verticalAlign=top;fontStyle=5;"><mxGeometry x="20" y="30" width="260" height="120" as="geometry"/></mxCell>
  <mxCell id="target" parent="group" vertex="1" value="Second node" style="ellipse;html=0;fillColor=#ded6ff;"><mxGeometry x="350" y="30" width="180" height="120" as="geometry"/></mxCell>
  <mxCell id="connector" parent="group" edge="1" source="rectangle" target="target" value="Proceed" style="endArrow=block;startArrow=none;exitX=1;exitY=0.5;entryX=0;entryY=0.5;html=0;"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="300" y="90"/></Array></mxGeometry></mxCell>
</root></mxGraphModel>`;
const htmlLabel =
  "<div>Editable & safe</div><div>Next<br>Line</div><script>window.__drawioExecuted = true</script>";
const compressed = deflateRawSync(
  Buffer.from(encodeURIComponent(model(htmlLabel))),
).toString("base64");
const multipage = `<mxfile><diagram id="compressed" name="Compressed page">${compressed}</diagram><diagram id="plain" name="Plain page">${model()}</diagram></mxfile>`;

const action = (name, inDialog = false) =>
  page
    .locator(`${inDialog ? "#modal " : ""}[data-action="${name}"]`)
    .first()
    .click();
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
const closeDialog = async () => {
  if (
    await page
      .locator("#modal")
      .isVisible()
      .catch(() => false)
  )
    await action("close-modal", true);
};
async function upload(name, data, mimeType = "application/xml") {
  await page.locator("#import-file").setInputFiles({
    name,
    mimeType,
    buffer: Buffer.isBuffer(data) ? data : Buffer.from(data),
  });
  await settle();
}
async function expectBoardCount(count) {
  await page.waitForFunction((expected) => {
    const ws = JSON.parse(localStorage.getItem("gitboard.workspace.v1"));
    return (
      ws?.projects.find((project) => project.id === ws.activeProjectId)?.boards
        .length === expected
    );
  }, count);
}

try {
  await page.goto(baseURL);
  await page.waitForSelector("#board-list .board-card");
  await action("projects");
  await action("new-project", true);
  await page.locator('#modal input[name="name"]').fill("Draw.io import QA");
  await page.locator("#modal-submit").click();
  await settle();
  const original = await selectedBoard();
  const originalProjectId = (await active()).id;

  // Native XML parser, raw-deflate decoding, and app integration: one page becomes one added board.
  await action("import");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    action("import-drawio", true),
  ]);
  await chooser.setFiles({
    name: "multipage.drawio",
    mimeType: "application/xml",
    buffer: Buffer.from(multipage),
  });
  await settle();
  await expectBoardCount(3);
  await closeDialog();
  let project = await active();
  assert.equal(project.id, originalProjectId);
  assert.deepEqual(project.boards[0], original);
  assert.deepEqual(
    project.boards.slice(1).map((board) => board.name),
    ["Compressed page", "Plain page"],
  );
  assert.equal(project.boards[1].items.length, 4);
  assert.equal(await page.evaluate(() => window.__drawioExecuted), undefined);
  const imported = project.boards[1];
  const rectangle = imported.items.find((item) => item.type === "rect");
  assert.equal(rectangle.x, 120);
  assert.equal(rectangle.y, 230);
  assert.equal(rectangle.text, "Editable & safe\nNext\nLine");
  assert.equal(rectangle.underline, true);
  const connector = imported.items.find((item) => item.type === "arrow");
  assert.deepEqual(connector.points, [
    [380, 290],
    [400, 290],
    [450, 290],
  ]);
  assert.equal(connector.startId, rectangle.id);
  assert.equal(
    await page.locator("#canvas script, #canvas foreignObject").count(),
    0,
  );

  // Imported text can be edited normally and survives a reload and JSON export.
  await page.locator(`[data-board="${imported.id}"]`).click();
  await page.locator(`#canvas [data-item-id="${rectangle.id}"]`).dblclick();
  await page
    .locator('textarea[aria-label="Edit object text"]')
    .fill("Edited imported label");
  await page.keyboard.press("Control+Enter");
  await settle();
  assert.equal(
    (await selectedBoard()).items.find((item) => item.id === rectangle.id).text,
    "Edited imported label",
  );
  await page.reload();
  await page.waitForSelector(`#canvas [data-item-id="${rectangle.id}"]`);
  assert.equal(
    (await selectedBoard()).items.find((item) => item.id === rectangle.id).text,
    "Edited imported label",
  );
  await page.locator(`#canvas [data-item-id="${rectangle.id}"]`).click();
  assert.equal(await page.locator("#font-size").inputValue(), "18");
  await action("bold");
  await settle();
  assert.equal(
    (await selectedBoard()).items.find((item) => item.id === rectangle.id).bold,
    false,
  );
  assert.equal(
    (await selectedBoard()).items.find((item) => item.id === rectangle.id)
      .fontWeight,
    400,
  );
  await page.keyboard.press("Control+z");
  await settle();
  assert.equal(
    (await selectedBoard()).items.find((item) => item.id === rectangle.id).bold,
    true,
  );
  assert.equal(
    (await selectedBoard()).items.find((item) => item.id === rectangle.id)
      .fontWeight,
    700,
  );
  await action("export");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    action("export-project", true),
  ]);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.boards.length, 3);
  assert.deepEqual(exported.boards[1].items, (await selectedBoard()).items);
  assert.equal(exported.repository, undefined);
  await action("close-modal", true);

  // The same imported objects use the project schema committed by GitHub integration.
  const schema = await page.evaluate(async () => {
    const { projectContent, validateProject } = await import("./js/model.js");
    const ws = JSON.parse(localStorage.getItem("gitboard.workspace.v1"));
    const project = ws.projects.find(
      (candidate) => candidate.id === ws.activeProjectId,
    );
    const serialized = projectContent(project);
    return {
      before: JSON.parse(serialized),
      after: validateProject(JSON.parse(serialized)),
    };
  });
  assert.deepEqual(schema.after, schema.before);

  await upload("standalone.xml", model("Standalone XML"));
  await expectBoardCount(4);
  await closeDialog();
  assert.equal((await selectedBoard()).items.length, 4);

  const wrapped = await page.evaluate(async () => {
    const { importDrawio } = await import("./js/drawio.js");
    return importDrawio(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <object id="wrapper" label="&lt;b&gt;Wrapped &amp;amp; label&lt;/b&gt;&lt;img src=&quot;https://example.com/label-tracker.png&quot; onerror=&quot;window.__drawioExecuted=true&quot;&gt;"><mxCell parent="1" vertex="1" style="text;html=1;"><mxGeometry x="0" y="0" width="200" height="60" as="geometry"/></mxCell></object>
      <mxCell id="image" parent="1" vertex="1" style="shape=image;image=https://example.com/image-tracker.png;"><mxGeometry x="0" y="80" width="200" height="60" as="geometry"/></mxCell>
    </root></mxGraphModel>`);
  });
  assert.equal(wrapped.boards[0].items[0].text, "Wrapped & label");
  assert.equal(
    wrapped.boards[0].items.filter((item) => item.type === "image").length,
    0,
  );
  assert.ok(wrapped.warnings.length >= 1);
  assert.equal(await page.evaluate(() => window.__drawioExecuted), undefined);

  // Bad XML must leave all existing project data untouched.
  const beforeMalformed = (await active()).boards;
  await upload("broken.drawio", "<mxfile><diagram><mxGraphModel></diagram>");
  assert.deepEqual((await active()).boards, beforeMalformed);
  for (const source of [
    "not XML",
    "<mxfile/>",
    "<other/>",
    "<mxfile><diagram>invalid compressed data</diagram></mxfile>",
    `<mxfile><diagram id="duplicate">${model()}</diagram><diagram id="duplicate">${model()}</diagram></mxfile>`,
  ]) {
    const error = await page.evaluate(async (xml) => {
      const { importDrawio } = await import("./js/drawio.js");
      try {
        await importDrawio(xml);
        return null;
      } catch (error) {
        return error.message;
      }
    }, source);
    assert.ok(error, "Malformed or empty diagram should be rejected");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  assert.equal(
    await page
      .locator('.board-heading-actions [data-action="import"]')
      .isVisible(),
    true,
  );
  const mobileImport = await page
    .locator('.board-heading-actions [data-action="import"]')
    .boundingBox();
  assert.ok(mobileImport.x >= 0 && mobileImport.x + mobileImport.width <= 390);
  await action("import");
  assert.equal(
    await page.locator('#modal [data-action="import-drawio"]').isVisible(),
    true,
  );
  await action("close-modal", true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  if (process.env.GITBOARD_DRAWIO_EXAMPLE) {
    const bytes = await readFile(process.env.GITBOARD_DRAWIO_EXAMPLE);
    const count = (await active()).boards.length;
    await upload(basename(process.env.GITBOARD_DRAWIO_EXAMPLE), bytes);
    await expectBoardCount(count + 1);
    await closeDialog();
    const example = await selectedBoard();
    assert.equal(example.items.length, 777);
    if (process.env.GITBOARD_DRAWIO_BOARD_JSON)
      await writeFile(
        process.env.GITBOARD_DRAWIO_BOARD_JSON,
        JSON.stringify(example, null, 2) + "\n",
      );
    assert.equal(
      example.items.filter((item) => item.type === "image").length,
      7,
    );
    assert.equal(
      example.items.filter((item) => item.type === "line").length,
      45,
    );
    assert.equal(
      example.items.filter((item) => item.type === "arrow").length,
      15,
    );
    assert.equal(
      example.items.filter((item) => item.width === 1400 && item.height === 960)
        .length,
      18,
    );
    assert.ok(
      example.items.some(
        (item) => item.x === 100 && item.y === 400 && item.width === 1400,
      ),
    );
    assert.ok(
      example.items.some(
        (item) => item.x === 3020 && item.y === 5550 && item.width === 1400,
      ),
    );
    assert.equal(await page.locator("#canvas [data-item-id]").count(), 777);
    await action("fit");
    await settle();
    if (process.env.GITBOARD_DRAWIO_SCREENSHOT)
      await page.screenshot({
        path: process.env.GITBOARD_DRAWIO_SCREENSHOT,
        fullPage: true,
      });
    await page.reload();
    await page.waitForSelector("#canvas [data-item-id]");
    assert.equal((await selectedBoard()).items.length, 777);
    if (process.env.GITBOARD_DRAWIO_DETAIL_SCREENSHOT) {
      const canvas = await page.locator("#canvas").boundingBox();
      const view = (await selectedBoard()).view;
      const anchor = {
        x: canvas.x + view.x + 800 * view.zoom,
        y: canvas.y + view.y + 880 * view.zoom,
      };
      await page.mouse.move(anchor.x, anchor.y);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -Math.log(0.65 / view.zoom) / 0.002);
      await page.keyboard.up("Control");
      await settle();
      await page.keyboard.down("Space");
      await page.mouse.move(anchor.x, anchor.y);
      await page.mouse.down();
      await page.mouse.move(
        canvas.x + canvas.width / 2,
        canvas.y + canvas.height / 2,
        { steps: 6 },
      );
      await page.mouse.up();
      await page.keyboard.up("Space");
      await settle();
      await page.screenshot({
        path: process.env.GITBOARD_DRAWIO_DETAIL_SCREENSHOT,
        fullPage: true,
      });
    }
    console.log(
      "Private draw.io example: 777 editable items, 18 panels, 7 embedded images, layout and reload verified.",
    );
  }

  assert.deepEqual(failures, []);
  console.log(
    "Draw.io browser checks passed: compressed and plain multipage imports, editable text, JSON export, reload, standalone XML, invalid imports, and project schema.",
  );
} finally {
  await browser.close();
}
