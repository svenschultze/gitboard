import test from "node:test";
import assert from "node:assert/strict";
import { convertDrawioCells, drawioLabelToText } from "../js/drawio.js";
import { createProject, projectContent, validateProject } from "../js/model.js";

const roots = () => [{ id: "0" }, { id: "1", parent: "0" }];
const node = (id, x, y, extra = {}) => ({
  id,
  parent: "1",
  vertex: true,
  value: id,
  style: "rounded=0;html=0;",
  geometry: { x, y, width: 100, height: 60 },
  ...extra,
});
const named = (board, name) => board.items.find((item) => item.text === name);

function portableBoard(board) {
  const project = createProject("Imported diagrams", "blank");
  project.boards.push(board);
  return validateProject(JSON.parse(projectContent(project))).boards[1];
}

test("draw.io nested groups and relative vertices become absolute editable objects", () => {
  const { board, warnings } = convertDrawioCells(
    [
      ...roots(),
      node("group", 100, 200, {
        style: "group;",
        geometry: { x: 100, y: 200, width: 400, height: 300 },
      }),
      node("relative", 0, 0, {
        parent: "group",
        geometry: {
          x: 0.5,
          y: 0.25,
          width: 80,
          height: 40,
          relative: true,
          offset: { x: 10, y: 20 },
        },
      }),
      node("nested", 20, 30, { parent: "group", style: "group;" }),
      node("leaf", 7, 11, { parent: "nested" }),
    ],
    { name: "Grouped page" },
  );
  assert.equal(board.name, "Grouped page");
  assert.equal(board.items.length, 2);
  assert.deepEqual(
    [named(board, "relative").x, named(board, "relative").y],
    [310, 295],
  );
  assert.deepEqual(
    [named(board, "leaf").x, named(board, "leaf").y],
    [127, 241],
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(portableBoard(board), board);
});

test("draw.io common shapes and typography survive portable project validation", () => {
  const { board } = convertDrawioCells([
    ...roots(),
    node("styled", 10, 20, {
      style:
        "rounded=1;arcSize=20;fillColor=#ccece4;strokeColor=#112233;fontColor=#334455;fontSize=14;fontStyle=7;fontFamily=Helvetica;align=right;verticalAlign=top;whiteSpace=wrap;strokeWidth=0;dashed=1;opacity=75;",
    }),
    node("oval", 120, 20, { style: "ellipse;" }),
    node("decision", 230, 20, { style: "rhombus;" }),
    node("label", 340, 20, { style: "text;html=0;" }),
  ]);
  const item = named(board, "styled");
  assert.equal(item.type, "rect");
  assert.ok(item.cornerRadius > 0);
  assert.equal(item.fill, "#ccece4");
  assert.equal(item.stroke, "#112233");
  assert.equal(item.textColor, "#334455");
  assert.equal(item.fontSize, 14);
  assert.equal(item.bold, true);
  assert.equal(item.italic, true);
  assert.equal(item.underline, true);
  assert.equal(item.align, "right");
  assert.equal(item.verticalAlign, "top");
  assert.equal(item.wrap, true);
  assert.equal(item.strokeWidth, 0);
  assert.equal(item.dashed, true);
  assert.equal(item.opacity, 0.75);
  assert.equal(named(board, "oval").type, "ellipse");
  assert.equal(named(board, "decision").type, "diamond");
  assert.equal(named(board, "label").type, "text");
  assert.deepEqual(portableBoard(board), board);
});

test("draw.io HTML labels decode entities and line breaks while script content stays inert", () => {
  const text = drawioLabelToText(
    '<div>First &amp; second</div><div>Third<br>Fourth&nbsp;line</div><script>alert("bad")</script>',
  );
  assert.match(text, /First & second\nThird\nFourth.line/);
  assert.doesNotMatch(text, /<|>|alert/);
  assert.equal(drawioLabelToText("A < B & C", false), "A < B & C");
  const { board } = convertDrawioCells([
    ...roots(),
    node("html", 0, 0, {
      value: "<b>Plan</b><br>Next &amp; last",
      style: "text;html=1;",
    }),
    node("literal", 0, 80, { value: "A < B", style: "text;html=0;" }),
  ]);
  assert.equal(board.items[0].text, "Plan\nNext & last");
  assert.equal(board.items[1].text, "A < B");
});

test("draw.io connectors preserve waypoints, attachment sides, and arrowheads", () => {
  const { board } = convertDrawioCells([
    ...roots(),
    node("source", 100, 100),
    node("target", 400, 100, { style: "ellipse;" }),
    {
      id: "connector",
      parent: "1",
      edge: true,
      source: "source",
      target: "target",
      value: "Approval",
      style:
        "endArrow=block;startArrow=oval;exitX=1;exitY=0.5;entryX=0;entryY=0.5;strokeColor=#112233;",
      geometry: { relative: true, points: [{ x: 250, y: 130 }] },
    },
    {
      id: "line",
      parent: "1",
      edge: true,
      value: "",
      style: "endArrow=none;startArrow=none;",
      geometry: {
        sourcePoint: { x: -20, y: -10 },
        targetPoint: { x: 30, y: 40 },
      },
    },
  ]);
  const edge = board.items.find((item) => item.type === "arrow");
  assert.equal(named(board, "Approval").type, "text");
  assert.equal(edge.type, "arrow");
  assert.deepEqual(edge.points, [
    [200, 130],
    [250, 130],
    [400, 130],
  ]);
  assert.equal(edge.startId, named(board, "source").id);
  assert.equal(edge.endId, named(board, "target").id);
  assert.deepEqual(edge.startAnchor, { x: 1, y: 0.5 });
  assert.deepEqual(edge.endAnchor, { x: 0, y: 0.5 });
  assert.equal(edge.startArrow, true);
  assert.equal(edge.endArrow, true);
  const line = board.items.find((item) => item.type === "line");
  assert.deepEqual(line.points, [
    [-20, -10],
    [30, 40],
  ]);
  assert.equal(line.endArrow, false);
  assert.deepEqual(portableBoard(board), board);
});

test("draw.io embedded raster images import while external and unsafe images are reported", () => {
  const { board, warnings } = convertDrawioCells([
    ...roots(),
    node("embedded", 0, 0, {
      style: "shape=image;image=data:image/png,iVBORw0KGgo=;",
    }),
    node("embedded-base64", 150, 0, {
      style: "shape=image;image=data:image/png;base64,iVBORw0KGgo=;",
    }),
    node("remote", 250, 0, {
      style: "shape=image;image=https://example.com/tracker.png;",
    }),
    node("unsafe", 300, 0, { style: "shape=image;image=javascript:alert(1);" }),
    node("vector", 450, 0, {
      style: "shape=image;image=data:image/svg+xml,PHN2Zz4=;",
    }),
  ]);
  const images = board.items.filter((item) => item.type === "image");
  assert.equal(images.length, 2);
  assert.equal(images[1].src, "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(images[0].src, "data:image/png;base64,iVBORw0KGgo=");
  assert.ok(warnings.length >= 1);
  assert.ok(!JSON.stringify(board).includes("https://example.com"));
  assert.ok(!JSON.stringify(board).includes("javascript:"));
  assert.deepEqual(portableBoard(board), board);
});

test("draw.io conversion gives independent imports unique IDs suitable for GitHub board files", () => {
  const cells = [...roots(), node("object/with:unsafe-id", 20, 40)];
  const first = convertDrawioCells(cells).board;
  const second = convertDrawioCells(cells).board;
  const project = createProject("Many pages", "blank");
  project.boards.push(first, second);
  const portable = JSON.parse(projectContent(project));
  assert.equal(portable.boards.length, 3);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.match(first.items[0].id, /^[a-zA-Z0-9_-]+$/);
  assert.deepEqual(validateProject(portable), portable);
});

test("draw.io invalid identities and cyclic group geometry are rejected", () => {
  assert.throws(
    () =>
      convertDrawioCells([
        ...roots(),
        node("same", 0, 0),
        node("same", 10, 10),
      ]),
    /duplicate/i,
  );
  assert.throws(
    () =>
      convertDrawioCells([
        ...roots(),
        node("a", 0, 0, { parent: "b", style: "group;" }),
        node("b", 0, 0, { parent: "a", style: "group;" }),
      ]),
    /cyclic/i,
  );
  assert.throws(
    () =>
      convertDrawioCells([
        ...roots(),
        node("bad", 0, 0, { geometry: undefined }),
      ]),
    /geometry/i,
  );
  for (const value of [Infinity, NaN, 1e9]) {
    assert.throws(
      () => convertDrawioCells([...roots(), node("bad", value, 0)]),
      /geometry|coordinate|number/i,
    );
  }
});
