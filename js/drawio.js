import { createBoard, uid, validateProject } from "./model.js";

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_ITEMS = 20000;
const MAX_PAGES = 200;
const MAX_NUMBER = 1e7;
const COLORS = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  teal: "#008080",
  maroon: "#800000",
  lime: "#00ff00",
  aqua: "#00ffff",
  fuchsia: "#ff00ff",
  olive: "#808000",
  transparent: "transparent",
  none: "none",
};

function fail(message) {
  throw new Error(`Invalid draw.io file: ${message}`);
}

function number(value, fallback, field = "geometry", positive = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  if (
    !Number.isFinite(result) ||
    Math.abs(result) > MAX_NUMBER ||
    (positive && result < 0)
  ) {
    fail(`${field} contains an invalid number.`);
  }
  return result;
}

function styleOf(value = "") {
  if (typeof value !== "string" || value.length > MAX_BYTES)
    fail("invalid cell style.");
  const style = Object.create(null);
  for (const segment of value.split(";")) {
    if (
      segment.startsWith("base64,") &&
      /^data:image\/[^;,]+$/i.test(style.image ?? "")
    ) {
      style.image += `;${segment}`;
      continue;
    }
    const divider = segment.indexOf("=");
    if (divider === -1) {
      if (segment) style[segment] = "1";
    } else {
      style[segment.slice(0, divider)] = segment.slice(divider + 1);
    }
  }
  return style;
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  ndash: "–",
  mdash: "—",
  bull: "•",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  middot: "·",
  deg: "°",
};

function decodeEntities(value) {
  return value.replace(
    /&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi,
    (match, entity) => {
      if (entity[0] !== "#")
        return Object.hasOwn(ENTITIES, entity) ? ENTITIES[entity] : match;
      const code =
        entity[1].toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "\ufffd";
    },
  );
}

// Labels are decoded as text without placing untrusted HTML in a document.
// In particular, image URLs and scripts in a draw.io label are never loaded.
export function drawioLabelToText(value = "", html = true) {
  if (typeof value !== "string" || value.length > 100000)
    fail("a label is too long.");
  if (!html) return value;
  const result = value
    .replace(/<!--[^]*?-->/g, "")
    .replace(
      /<(script|style|iframe|object|template)\b[^>]*>[^]*?<\/\1\s*>/gi,
      "",
    )
    .replace(/<br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(div|p|li|h[1-6]|tr|ul|ol|pre)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(result)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

function color(value, fallback, warnings) {
  if (value === undefined || value === "default") return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (Object.hasOwn(COLORS, value.toLowerCase()))
    return COLORS[value.toLowerCase()];
  warnings.add("Unsupported colors were replaced with default colors.");
  return fallback;
}

function appearance(style, type, warnings) {
  const fontStyle = number(style.fontStyle, 0, "font style", true);
  const result = {
    fill: color(
      style.fillColor,
      type === "text" ? "transparent" : "#ffffff",
      warnings,
    ),
    stroke: color(
      style.strokeColor,
      type === "text" ? "none" : "#000000",
      warnings,
    ),
    textColor: color(style.fontColor, "#000000", warnings),
    strokeWidth: number(style.strokeWidth, 1, "stroke width", true),
    fontSize: number(style.fontSize, 12, "font size", true),
    fontWeight: fontStyle & 1 ? 700 : 400,
    bold: Boolean(fontStyle & 1),
    italic: Boolean(fontStyle & 2),
    underline: Boolean(fontStyle & 4),
    align: ["left", "center", "right"].includes(style.align)
      ? style.align
      : "center",
    verticalAlign: ["top", "middle", "bottom"].includes(style.verticalAlign)
      ? style.verticalAlign
      : "middle",
    textPadding: number(style.spacing, 2, "text spacing", true),
    wrap: style.whiteSpace === "wrap",
    dashed: style.dashed === "1",
  };
  if (style.opacity !== undefined)
    result.opacity =
      Math.min(100, number(style.opacity, 100, "opacity", true)) / 100;
  if (style.fontFamily) {
    if (/^[A-Za-z0-9][A-Za-z0-9 _,-]{0,99}$/.test(style.fontFamily))
      result.fontFamily = style.fontFamily;
    else
      warnings.add(
        "Unsupported font names were replaced with the default font.",
      );
  }
  if (number(style.rotation, 0, "rotation") !== 0)
    warnings.add("Rotated shapes were imported without rotation.");
  if (style.flipH === "1" || style.flipV === "1")
    warnings.add("Flipped shapes were imported without flipping.");
  if (style.html === "1")
    warnings.add(
      "HTML labels were imported as editable plain text; inline formatting was flattened.",
    );
  return result;
}

function shapeType(style, warnings) {
  const shape =
    style.shape ||
    (style.text
      ? "text"
      : style.ellipse
        ? "ellipse"
        : style.rhombus
          ? "rhombus"
          : style.swimlane
            ? "swimlane"
            : "rectangle");
  if (shape === "text") return "text";
  if (shape === "ellipse") return "ellipse";
  if (shape === "rhombus" || shape === "diamond") return "diamond";
  if (shape === "image" || style.image) return "image";
  if (shape === "swimlane") {
    warnings.add(
      "Swimlanes were imported as frames; lane headers and layout were approximated.",
    );
    return "frame";
  }
  if (!["rectangle", "rect", "label"].includes(shape))
    warnings.add(
      "Unsupported shapes were approximated with editable rectangles.",
    );
  return "rect";
}

function embeddedImage(source) {
  if (typeof source !== "string") return null;
  const match =
    /^data:image\/(png|jpe?g|webp|gif)(?:;base64)?,([a-z0-9+/=\s]+)$/i.exec(
      source,
    );
  if (!match) return null;
  const body = match[2].replace(/\s/g, "");
  if (
    !body ||
    body.length > 12_000_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      body,
    )
  )
    return null;
  return `data:image/${match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase()};base64,${body}`;
}

function point(value, origin, field) {
  if (!value || typeof value !== "object") fail(`${field} is invalid.`);
  const x = Array.isArray(value) ? value[0] : value.x;
  const y = Array.isArray(value) ? value[1] : value.y;
  return [origin.x + number(x, 0, field), origin.y + number(y, 0, field)];
}

function center(bounds) {
  return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
}

function perimeter(bounds, toward, type) {
  const [cx, cy] = center(bounds),
    dx = toward[0] - cx,
    dy = toward[1] - cy;
  const rx = bounds.width / 2,
    ry = bounds.height / 2;
  if ((!dx && !dy) || !rx || !ry) return [cx, cy];
  let scale;
  if (type === "ellipse") scale = 1 / Math.hypot(dx / rx, dy / ry);
  else if (type === "diamond")
    scale = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  else
    scale = Math.min(
      dx ? Math.abs(rx / dx) : Infinity,
      dy ? Math.abs(ry / dy) : Infinity,
    );
  return [cx + dx * scale, cy + dy * scale];
}

function anchor(style, prefix, bounds, type) {
  if (style[`${prefix}X`] === undefined || style[`${prefix}Y`] === undefined)
    return null;
  const x = number(style[`${prefix}X`], 0.5, "connector anchor"),
    y = number(style[`${prefix}Y`], 0.5, "connector anchor");
  if (x < 0 || x > 1 || y < 0 || y > 1)
    fail("connector anchors must be within their shape.");
  const target = [bounds.x + x * bounds.width, bounds.y + y * bounds.height];
  const endpoint =
    style[`${prefix}Perimeter`] === "0"
      ? target
      : perimeter(bounds, target, type);
  return {
    x: bounds.width
      ? Math.max(0, Math.min(1, (endpoint[0] - bounds.x) / bounds.width))
      : 0.5,
    y: bounds.height
      ? Math.max(0, Math.min(1, (endpoint[1] - bounds.y) / bounds.height))
      : 0.5,
  };
}

function isRelative(geometry) {
  return (
    geometry.relative === true ||
    geometry.relative === "1" ||
    geometry.relative === 1
  );
}

function pathBounds(points) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function alongPath(points, fraction = 0.5, distance = 0) {
  const lengths = points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let remaining =
    lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0;
      const dx = points[i + 1][0] - points[i][0],
        dy = points[i + 1][1] - points[i][1];
      return [
        points[i][0] +
          dx * ratio -
          (lengths[i] ? (dy / lengths[i]) * distance : 0),
        points[i][1] +
          dy * ratio +
          (lengths[i] ? (dx / lengths[i]) * distance : 0),
      ];
    }
    remaining -= lengths[i];
  }
  return points[0];
}

function sanitizedBoard(board) {
  const date = board.createdAt;
  return validateProject({
    schemaVersion: 1,
    id: uid(),
    name: "Draw.io import",
    description: "",
    boards: [board],
    createdAt: date,
    updatedAt: date,
  }).boards[0];
}

/** Convert parsed draw.io cells without needing a browser XML parser. */
export function convertDrawioCells(
  cells,
  { name = "Imported diagram", labelToText = drawioLabelToText } = {},
) {
  if (!Array.isArray(cells) || cells.length > MAX_ITEMS * 2 + 2)
    fail("too many cells (maximum 20,000 imported objects per board).");
  const warnings = new Set(),
    byId = new Map(),
    styles = new Map(),
    ids = new Map(),
    bounds = new Map();
  for (const cell of cells) {
    if (
      !cell ||
      typeof cell.id !== "string" ||
      !cell.id ||
      cell.id.length > 1000
    )
      fail("a cell is missing its ID.");
    if (byId.has(cell.id)) fail(`duplicate cell ID "${cell.id}".`);
    byId.set(cell.id, cell);
    styles.set(cell.id, styleOf(cell.style));
    ids.set(cell.id, uid());
  }
  for (const cell of cells) {
    for (const field of ["parent", "source", "target"]) {
      if (cell[field] && !byId.has(cell[field]))
        fail(`cell "${cell.id}" refers to a missing ${field}.`);
    }
    if (cell.vertex && cell.edge)
      fail(`cell "${cell.id}" cannot be both a shape and connector.`);
  }
  // Resolve parent chains iteratively so deeply nested input cannot overflow the stack.
  for (const cell of cells) {
    const chain = [],
      visiting = new Set();
    let current = cell;
    while (current && !bounds.has(current.id)) {
      if (visiting.has(current.id)) fail("cyclic parent relationship.");
      visiting.add(current.id);
      chain.push(current);
      current = current.parent ? byId.get(current.parent) : null;
    }
    for (const next of chain.reverse()) {
      const parent = bounds.get(next.parent) ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
      if (
        (next.vertex || next.edge) &&
        (!next.geometry || typeof next.geometry !== "object")
      )
        fail(`cell "${next.id}" needs geometry.`);
      const geometry = next.geometry ?? {};
      if (
        next.vertex &&
        (geometry.width === undefined || geometry.height === undefined)
      )
        fail(`cell "${next.id}" needs width and height geometry.`);
      const relative = isRelative(geometry);
      const x = number(geometry.x, 0),
        y = number(geometry.y, 0);
      const offset = geometry.offset
        ? point(geometry.offset, { x: 0, y: 0 }, "geometry offset")
        : [0, 0];
      bounds.set(next.id, {
        x:
          parent.x +
          (relative && !next.edge ? x * parent.width : next.edge ? 0 : x) +
          (!next.edge ? offset[0] : 0),
        y:
          parent.y +
          (relative && !next.edge ? y * parent.height : next.edge ? 0 : y) +
          (!next.edge ? offset[1] : 0),
        width: number(geometry.width, 0, "geometry width", true),
        height: number(geometry.height, 0, "geometry height", true),
      });
    }
  }
  const objects = new Map(),
    edgePaths = new Map(),
    labels = new Map();
  for (const cell of cells) {
    if (
      !cell.vertex ||
      styles.get(cell.id).group === "1" ||
      styles.get(cell.id).shape === "group"
    )
      continue;
    const style = styles.get(cell.id),
      box = bounds.get(cell.id);
    let type = shapeType(style, warnings);
    const text = labelToText(cell.value ?? "", style.html === "1");
    const object = {
      id: ids.get(cell.id),
      type,
      ...box,
      text,
      ...appearance(style, type, warnings),
    };
    if (type === "image") {
      const src = embeddedImage(style.image);
      if (src) object.src = src;
      else {
        object.type = type = "rect";
        object.text ||= "Image not imported";
        warnings.add(
          "External or unsupported images were replaced with rectangles. Only embedded PNG, JPEG, WebP, and GIF images are imported.",
        );
      }
    }
    if (type === "rect") {
      const arc = number(style.arcSize, 20, "corner radius", true);
      const radius =
        style.absoluteArcSize === "1"
          ? arc / 2
          : (Math.min(box.width, box.height) * arc) / 200;
      object.cornerRadius =
        style.rounded === "1"
          ? Math.min(Math.min(box.width, box.height) / 2, radius)
          : 0;
    }
    objects.set(cell.id, object);
  }
  for (const cell of cells) {
    if (!cell.edge) continue;
    const style = styles.get(cell.id),
      geometry = cell.geometry,
      parent = bounds.get(cell.parent) ?? { x: 0, y: 0 };
    const source = byId.get(cell.source),
      target = byId.get(cell.target);
    const sourceBounds = bounds.get(cell.source),
      targetBounds = bounds.get(cell.target);
    if (
      geometry.points !== undefined &&
      (!Array.isArray(geometry.points) || geometry.points.length > 50000)
    )
      fail("a connector has invalid or too many waypoints.");
    const waypoints = (geometry.points ?? []).map((p) =>
      point(p, parent, "connector waypoint"),
    );
    if (!source && !geometry.sourcePoint)
      fail(`connector "${cell.id}" needs a source shape or point.`);
    if (!target && !geometry.targetPoint)
      fail(`connector "${cell.id}" needs a target shape or point.`);
    const start = source
      ? center(sourceBounds)
      : point(geometry.sourcePoint, parent, "connector source");
    const end = target
      ? center(targetBounds)
      : point(geometry.targetPoint, parent, "connector target");
    const sourceType = objects.get(cell.source)?.type ?? "rect",
      targetType = objects.get(cell.target)?.type ?? "rect";
    const startAnchor = source
      ? anchor(style, "exit", sourceBounds, sourceType)
      : null;
    const endAnchor = target
      ? anchor(style, "entry", targetBounds, targetType)
      : null;
    if (source)
      start.splice(
        0,
        2,
        ...(startAnchor
          ? [
              sourceBounds.x + startAnchor.x * sourceBounds.width,
              sourceBounds.y + startAnchor.y * sourceBounds.height,
            ]
          : perimeter(sourceBounds, waypoints[0] ?? end, sourceType)),
      );
    if (target)
      end.splice(
        0,
        2,
        ...(endAnchor
          ? [
              targetBounds.x + endAnchor.x * targetBounds.width,
              targetBounds.y + endAnchor.y * targetBounds.height,
            ]
          : perimeter(targetBounds, waypoints.at(-1) ?? start, targetType)),
      );
    if (
      !waypoints.length &&
      ["orthogonalEdgeStyle", "elbowEdgeStyle"].includes(style.edgeStyle) &&
      start[0] !== end[0] &&
      start[1] !== end[1]
    ) {
      const middle = (start[0] + end[0]) / 2;
      waypoints.push([middle, start[1]], [middle, end[1]]);
      warnings.add(
        "Automatic connector routing was approximated with editable waypoints.",
      );
    }
    if (style.curved === "1" || style.edgeStyle === "entityRelationEdgeStyle")
      warnings.add(
        "Curved or specialized connector routes were approximated with straight segments.",
      );
    const points = [start, ...waypoints, end],
      startArrow = Boolean(style.startArrow && style.startArrow !== "none"),
      endArrow = style.endArrow !== "none";
    const type = startArrow || endArrow ? "arrow" : "line";
    const object = {
      id: ids.get(cell.id),
      type,
      ...pathBounds(points),
      points,
      text: "",
      ...appearance(style, type, warnings),
      fill: "transparent",
      startArrow,
      endArrow,
    };
    if (objects.has(cell.source)) object.startId = ids.get(cell.source);
    if (objects.has(cell.target)) object.endId = ids.get(cell.target);
    if (startAnchor && object.startId) object.startAnchor = startAnchor;
    if (endAnchor && object.endId) object.endAnchor = endAnchor;
    if (
      [style.startArrow, style.endArrow].some(
        (a) => a && !["none", "classic", "block", "open"].includes(a),
      )
    )
      warnings.add(
        "Specialized connector arrowheads were approximated with standard arrows.",
      );
    objects.set(cell.id, object);
    edgePaths.set(cell.id, points);
    const text = labelToText(cell.value ?? "", style.html === "1");
    if (text) {
      const position = alongPath(
        points,
        isRelative(geometry) ? (number(geometry.x, 0) + 1) / 2 : 0.5,
        number(geometry.y, 0),
      );
      const offset = geometry.offset
        ? point(geometry.offset, { x: 0, y: 0 }, "label offset")
        : [0, 0];
      const fontSize = object.fontSize,
        width = Math.max(
          40,
          Math.min(
            2000,
            Math.max(...text.split("\n").map((line) => line.length)) *
              fontSize *
              0.65 +
              8,
          ),
        ),
        height = Math.max(
          fontSize * 1.3,
          text.split("\n").length * fontSize * 1.3,
        );
      labels.set(cell.id, {
        id: uid(),
        type: "text",
        x: position[0] + offset[0] - width / 2,
        y: position[1] + offset[1] - height / 2,
        width,
        height,
        text,
        ...appearance(style, "text", warnings),
        align: "center",
        verticalAlign: "middle",
        fill: "transparent",
        stroke: "none",
      });
    }
  }
  // Relative child vertices of edges are labels positioned along the connector.
  for (const cell of cells) {
    const object = objects.get(cell.id),
      points = edgePaths.get(cell.parent);
    if (!object || !cell.vertex || !points || !isRelative(cell.geometry))
      continue;
    const geometry = cell.geometry,
      position = alongPath(
        points,
        (number(geometry.x, 0) + 1) / 2,
        number(geometry.y, 0),
      );
    const offset = geometry.offset
      ? point(geometry.offset, { x: 0, y: 0 }, "label offset")
      : [0, 0];
    object.x = position[0] + offset[0] - object.width / 2;
    object.y = position[1] + offset[1] - object.height / 2;
  }
  const board = createBoard(String(name || "Imported diagram").slice(0, 200));
  board.items = cells.flatMap((cell) =>
    [objects.get(cell.id), labels.get(cell.id)].filter(Boolean),
  );
  if (board.items.length > MAX_ITEMS)
    fail("too many imported objects (maximum 20,000 per board).");
  try {
    return { board: sanitizedBoard(board), warnings: [...warnings] };
  } catch (error) {
    fail(
      `the diagram contains unsupported or out-of-range object data. ${error.message}`,
    );
  }
}

function parseXml(source) {
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source))
    fail("DOCTYPE and entity declarations are not supported.");
  if (typeof DOMParser === "undefined")
    throw new Error(
      "Draw.io XML import requires a browser with DOMParser support.",
    );
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.querySelector("parsererror") || !document.documentElement)
    fail("the XML is malformed.");
  return document.documentElement;
}

function child(element, name) {
  return [...element.children].find((node) => node.localName === name);
}

function geometryOf(element) {
  if (!element) return undefined;
  const geometry = {};
  for (const key of ["x", "y", "width", "height"])
    if (element.hasAttribute(key))
      geometry[key] = number(element.getAttribute(key), 0, `geometry ${key}`);
  geometry.relative = element.getAttribute("relative") === "1";
  for (const node of element.children) {
    if (node.localName === "mxPoint") {
      const as = node.getAttribute("as");
      if (["sourcePoint", "targetPoint", "offset"].includes(as))
        geometry[as] = {
          x: number(node.getAttribute("x"), 0),
          y: number(node.getAttribute("y"), 0),
        };
    } else if (
      node.localName === "Array" &&
      node.getAttribute("as") === "points"
    ) {
      geometry.points = [...node.children]
        .filter((p) => p.localName === "mxPoint")
        .map((p) => ({
          x: number(p.getAttribute("x"), 0),
          y: number(p.getAttribute("y"), 0),
        }));
    }
  }
  return geometry;
}

function cellsOf(model) {
  if (model.localName !== "mxGraphModel")
    fail("a page must contain an mxGraphModel.");
  const root = child(model, "root");
  if (!root) fail("the diagram is missing its root cells.");
  const result = [];
  for (const entry of root.children) {
    const cell = entry.localName === "mxCell" ? entry : child(entry, "mxCell");
    if (!cell) fail("the diagram contains an invalid cell wrapper.");
    const wrapper = entry === cell ? null : entry;
    result.push({
      id: wrapper?.getAttribute("id") || cell.getAttribute("id"),
      parent: cell.getAttribute("parent") || undefined,
      source: cell.getAttribute("source") || undefined,
      target: cell.getAttribute("target") || undefined,
      value: wrapper?.getAttribute("label") ?? cell.getAttribute("value") ?? "",
      style: cell.getAttribute("style") || "",
      vertex: cell.getAttribute("vertex") === "1",
      edge: cell.getAttribute("edge") === "1",
      geometry: geometryOf(child(cell, "mxGeometry")),
    });
  }
  return result;
}

async function inflatePage(encoded, remaining) {
  const base64 = encoded.replace(/\s/g, "");
  if (
    !base64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    fail("a compressed page has invalid base64 data.");
  let decompressor;
  try {
    decompressor = new DecompressionStream("deflate-raw");
  } catch {
    throw new Error(
      "This browser cannot open compressed draw.io pages. Export an uncompressed XML file from diagrams.net, or use a current browser.",
    );
  }
  try {
    const binary = atob(base64),
      bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const reader = new Blob([bytes])
      .stream()
      .pipeThrough(decompressor)
      .getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > remaining) {
        await reader.cancel();
        fail("the expanded diagrams exceed the 40 MB import limit.");
      }
      chunks.push(value);
    }
    const expanded = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      expanded.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      source: decodeURIComponent(
        new TextDecoder("utf-8", { fatal: true }).decode(expanded),
      ),
      size,
    };
  } catch (error) {
    if (error.message.startsWith("Invalid draw.io file:")) throw error;
    fail("a compressed page could not be decoded.");
  }
}

/** Import .drawio or diagrams.net XML, returning one new board for every page. */
export async function importDrawio(
  source,
  { filename = "Imported diagram" } = {},
) {
  if (typeof source !== "string" || !source.trim()) fail("the file is empty.");
  if (
    source.length > MAX_BYTES ||
    new TextEncoder().encode(source).byteLength > MAX_BYTES
  )
    fail("the file exceeds the 40 MB import limit.");
  const root = parseXml(source),
    pages = [];
  const fallbackName =
    String(filename)
      .replace(/\.(drawio|xml)$/i, "")
      .slice(0, 200) || "Imported diagram";
  if (root.localName === "mxGraphModel")
    pages.push({ model: root, name: fallbackName });
  else if (root.localName === "mxfile") {
    const diagrams = [...root.children].filter(
      (node) => node.localName === "diagram",
    );
    if (!diagrams.length || diagrams.length > MAX_PAGES)
      fail("a file needs between 1 and 200 diagram pages.");
    const pageIds = new Set();
    for (const diagram of diagrams) {
      const id = diagram.getAttribute("id");
      if (!id) continue;
      if (pageIds.has(id)) fail("duplicate diagram page ID.");
      pageIds.add(id);
    }
    let expandedBytes = 0;
    for (const [index, diagram] of diagrams.entries()) {
      let model = child(diagram, "mxGraphModel");
      if (!model) {
        const content = diagram.textContent.trim();
        if (!content) fail(`page ${index + 1} is empty.`);
        if (content.startsWith("<")) {
          expandedBytes += new TextEncoder().encode(content).byteLength;
          model = parseXml(content);
        } else {
          const expanded = await inflatePage(
            content,
            MAX_BYTES - expandedBytes,
          );
          expandedBytes += expanded.size;
          model = parseXml(expanded.source);
        }
      } else
        expandedBytes += new TextEncoder().encode(
          new XMLSerializer().serializeToString(model),
        ).byteLength;
      if (expandedBytes > MAX_BYTES)
        fail("the expanded diagrams exceed the 40 MB import limit.");
      pages.push({
        model,
        name:
          diagram.getAttribute("name") ||
          (diagrams.length === 1
            ? fallbackName
            : `${fallbackName} ${index + 1}`),
      });
    }
  } else fail("expected a draw.io mxfile or mxGraphModel XML document.");
  const boards = [],
    warnings = new Set();
  for (const page of pages) {
    const result = convertDrawioCells(cellsOf(page.model), { name: page.name });
    boards.push(result.board);
    for (const warning of result.warnings) warnings.add(warning);
  }
  return { boards, warnings: [...warnings] };
}
