import { uid, boundsOf, validateProject } from "./model.js";

const NS = "http://www.w3.org/2000/svg";
const XHTML = "http://www.w3.org/1999/xhtml";
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const editableTarget = (target) =>
  target instanceof Element &&
  !!target.closest('input, textarea, select, [contenteditable="true"]');
const pathTypes = new Set(["arrow", "line", "draw"]);
const textTypes = new Set([
  "sticky",
  "rect",
  "ellipse",
  "diamond",
  "text",
  "frame",
]);
const toolKeys = {
  v: "pointer",
  h: "hand",
  n: "sticky",
  t: "text",
  r: "rect",
  o: "ellipse",
  d: "diamond",
  l: "line",
  a: "arrow",
  p: "draw",
  f: "frame",
};

function svgElement(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null)
      node.setAttribute(key, String(value));
  });
  return node;
}

function unitedBounds(rects) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

function intersects(a, b) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/** A self-contained, SVG-based canvas. Documents and view state have separate callbacks. */
export class BoardEditor {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.boardId = null;
    this.items = [];
    this.view = { x: 0, y: 0, zoom: 1 };
    this.tool = "pointer";
    this.selected = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = [];
    this.gesture = null;
    this.editing = null;
    this.spaceDown = false;
    this.listeners = [];
    this.id = `canvas-${uid()}`;
    this.container.classList.add("board-editor");
    this.container.tabIndex = 0;
    this.container.setAttribute("role", "application");
    this.container.setAttribute(
      "aria-label",
      "Whiteboard canvas. Press N for a sticky note, V to select, or Space to pan.",
    );
    this.svg = svgElement("svg", {
      class: "board-editor__svg",
      width: "100%",
      height: "100%",
      "aria-hidden": "true",
    });
    this.defs = svgElement("defs");
    const pattern = svgElement("pattern", {
      id: `${this.id}-grid`,
      width: 24,
      height: 24,
      patternUnits: "userSpaceOnUse",
    });
    pattern.append(
      svgElement("circle", { cx: 1, cy: 1, r: 1, fill: "#d3d8e2" }),
    );
    this.pattern = pattern;
    this.defs.append(pattern);
    const marker = svgElement("marker", {
      id: `${this.id}-arrow`,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 8,
      markerHeight: 8,
      orient: "auto-start-reverse",
      markerUnits: "strokeWidth",
    });
    marker.append(
      svgElement("path", {
        d: "M 1 1 L 9 5 L 1 9",
        fill: "none",
        stroke: "context-stroke",
        "stroke-width": 1.7,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
    this.defs.append(marker);
    this.background = svgElement("rect", {
      width: "100%",
      height: "100%",
      fill: `url(#${this.id}-grid)`,
    });
    this.scene = svgElement("g", { class: "board-editor__scene" });
    this.selectionLayer = svgElement("g", { class: "board-editor__selection" });
    this.svg.append(
      this.defs,
      this.background,
      this.scene,
      this.selectionLayer,
    );
    this.hint = document.createElement("div");
    this.hint.className = "board-editor__empty";
    this.hint.innerHTML =
      '<span class="board-editor__empty-symbol">✦</span><strong>A blank canvas. Endless possibilities.</strong><span>Choose a tool on the left, or press <kbd>N</kbd> to add a sticky note.</span>';
    this.live = document.createElement("div");
    this.live.className = "board-editor__sr-only";
    this.live.setAttribute("aria-live", "polite");
    this.container.append(this.svg, this.hint, this.live);
    this.measureCanvas = document.createElement("canvas");
    this.measureContext = this.measureCanvas.getContext("2d");
    this.listen(this.svg, "pointerdown", (event) => this.pointerDown(event));
    this.listen(this.svg, "pointermove", (event) => this.pointerMove(event));
    this.listen(this.svg, "pointerup", (event) => this.pointerUp(event));
    this.listen(this.svg, "pointercancel", () => this.cancelGesture());
    this.listen(this.svg, "dblclick", (event) => this.doubleClick(event));
    this.listen(this.svg, "wheel", (event) => this.wheel(event), {
      passive: false,
    });
    this.listen(this.svg, "contextmenu", (event) => event.preventDefault());
    this.listen(window, "keydown", (event) => this.keyDown(event));
    this.listen(window, "keyup", (event) => {
      if (event.code === "Space") {
        this.spaceDown = false;
        this.updateCursor();
      }
    });
    this.listen(window, "blur", () => {
      this.spaceDown = false;
      this.updateCursor();
    });
    this.listen(this.container, "dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    this.listen(this.container, "drop", (event) => this.drop(event));
    this.listen(window, "paste", (event) => this.pasteEvent(event));
    this.resizeObserver = new ResizeObserver(() => {
      this.renderView();
      this.renderSelection();
    });
    this.resizeObserver.observe(this.container);
    this.render();
    this.emitHistory();
  }

  listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    this.listeners.push(() =>
      target.removeEventListener(name, handler, options),
    );
  }

  setBoard(board, { resetHistory = false } = {}) {
    this.finishEditing();
    this.cancelGesture();
    const different = this.boardId !== board.id;
    this.boardId = board.id;
    this.items = clone(board.items || []);
    if (different || resetHistory) {
      this.selected.clear();
      this.undoStack = [];
      this.redoStack = [];
      this.view = { x: 0, y: 0, zoom: 1, ...board.view };
      this.view.zoom = clamp(Number(this.view.zoom) || 1, 0.1, 4);
    }
    this.selected = new Set(
      [...this.selected].filter((id) =>
        this.items.some((item) => item.id === id),
      ),
    );
    this.render();
    this.emitSelection();
    this.emitHistory();
    this.callbacks.onView?.({ ...this.view });
  }

  setTool(tool) {
    this.finishEditing();
    this.tool =
      tool === "select"
        ? "pointer"
        : tool === "pen"
          ? "draw"
          : tool === "rectangle"
            ? "rect"
            : tool === "circle"
              ? "ellipse"
              : tool;
    this.updateCursor();
    this.renderSelection();
    this.callbacks.onToolChange?.(
      this.tool === "pointer" ? "select" : this.tool,
    );
  }

  getTool() {
    return this.tool === "pointer" ? "select" : this.tool;
  }
  getSelection() {
    return this.items.filter((item) => this.selected.has(item.id)).map(clone);
  }

  updateCursor() {
    this.container.dataset.tool = this.spaceDown ? "hand" : this.tool;
    this.container.classList.toggle("is-panning", this.gesture?.kind === "pan");
  }

  emitSelection() {
    const selection = this.getSelection();
    this.callbacks.onSelection?.(selection);
    this.live.textContent = selection.length
      ? `${selection.length} object${selection.length === 1 ? "" : "s"} selected`
      : "";
  }

  emitHistory() {
    this.callbacks.onHistory?.({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  commit(before) {
    if (JSON.stringify(before) === JSON.stringify(this.items)) return;
    this.undoStack.push(clone(before));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.callbacks.onChange?.(clone(this.items));
    this.emitHistory();
    this.emitSelection();
  }

  undo() {
    this.finishEditing();
    if (!this.undoStack.length) return;
    this.redoStack.push(clone(this.items));
    this.items = this.undoStack.pop();
    this.afterHistory();
  }

  redo() {
    this.finishEditing();
    if (!this.redoStack.length) return;
    this.undoStack.push(clone(this.items));
    this.items = this.redoStack.pop();
    this.afterHistory();
  }

  afterHistory() {
    this.selected = new Set(
      [...this.selected].filter((id) =>
        this.items.some((item) => item.id === id),
      ),
    );
    this.render();
    this.callbacks.onChange?.(clone(this.items));
    this.emitSelection();
    this.emitHistory();
  }

  screenPoint(event) {
    const rect = this.svg.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  worldPoint(event) {
    const point = this.screenPoint(event);
    return {
      x: (point.x - this.view.x) / this.view.zoom,
      y: (point.y - this.view.y) / this.view.zoom,
    };
  }

  center() {
    return {
      x: (this.container.clientWidth / 2 - this.view.x) / this.view.zoom,
      y: (this.container.clientHeight / 2 - this.view.y) / this.view.zoom,
    };
  }

  itemAt(point, excludedIds = new Set()) {
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (
        excludedIds.has(item.id) ||
        pathTypes.has(item.type) ||
        item.type === "frame"
      )
        continue;
      const rect = this.bounds(item);
      if (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
      )
        return item;
    }
    return null;
  }

  connectorPoints(item) {
    const points = item.points?.length
      ? item.points.map((point) => [...point])
      : [
          [item.x, item.y],
          [item.x + item.width, item.y + item.height],
        ];
    if (item.type !== "arrow" && item.type !== "line") return points;
    const start = this.items.find((target) => target.id === item.startId);
    const end = this.items.find((target) => target.id === item.endId);
    if (!start && !end) return points;
    const startCenter = start
      ? { x: start.x + start.width / 2, y: start.y + start.height / 2 }
      : { x: points[0][0], y: points[0][1] };
    const endCenter = end
      ? { x: end.x + end.width / 2, y: end.y + end.height / 2 }
      : { x: points.at(-1)[0], y: points.at(-1)[1] };
    const boundary = (target, origin, toward) => {
      const dx = toward.x - origin.x,
        dy = toward.y - origin.y;
      if (!dx && !dy) return [origin.x, origin.y];
      let scale;
      if (target.type === "ellipse")
        scale =
          1 /
          Math.sqrt(
            (dx / (target.width / 2)) ** 2 + (dy / (target.height / 2)) ** 2,
          );
      else if (target.type === "diamond")
        scale =
          1 /
          (Math.abs(dx) / (target.width / 2) +
            Math.abs(dy) / (target.height / 2));
      else
        scale = Math.min(
          dx ? Math.abs(target.width / 2 / dx) : Infinity,
          dy ? Math.abs(target.height / 2 / dy) : Infinity,
        );
      return [origin.x + dx * scale, origin.y + dy * scale];
    };
    if (start) points[0] = boundary(start, startCenter, endCenter);
    if (end) points[points.length - 1] = boundary(end, endCenter, startCenter);
    return points;
  }

  bounds(item) {
    if (pathTypes.has(item.type)) {
      const points = this.connectorPoints(item);
      if (points.length) {
        const xs = points.map((point) => point[0]),
          ys = points.map((point) => point[1]);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      }
    }
    const result = boundsOf(item);
    return {
      x: result.x,
      y: result.y,
      width: result.width,
      height: result.height,
    };
  }

  selectionBounds() {
    return unitedBounds(
      this.items
        .filter((item) => this.selected.has(item.id))
        .map((item) => this.bounds(item)),
    );
  }

  defaultItem(type, options = {}) {
    const sizes = {
      sticky: [190, 190],
      rect: [220, 140],
      ellipse: [200, 140],
      diamond: [200, 160],
      text: [260, 72],
      frame: [520, 340],
      image: [280, 200],
      arrow: [200, 0],
      line: [200, 0],
      draw: [0, 0],
    };
    const [defaultWidth, defaultHeight] = sizes[type] || sizes.rect;
    const width = options.width ?? defaultWidth,
      height = options.height ?? defaultHeight;
    const center = this.center();
    const item = {
      id: uid(),
      type,
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
      text: type === "frame" ? "Frame" : "",
      fill:
        type === "sticky"
          ? "#fff2a8"
          : type === "text" || pathTypes.has(type) || type === "frame"
            ? "transparent"
            : "#ffffff",
      stroke: "#373b48",
      fontSize: type === "frame" ? 18 : type === "sticky" ? 22 : 20,
      ...options,
    };
    if (type === "arrow" || type === "line")
      item.points = options.points || [
        [item.x, item.y],
        [item.x + item.width, item.y + item.height],
      ];
    return item;
  }

  addItem(type, options = {}) {
    this.finishEditing();
    const before = clone(this.items);
    const item = this.defaultItem(type, options);
    if (type === "frame") this.items.unshift(item);
    else this.items.push(item);
    this.selected = new Set([item.id]);
    this.render();
    this.commit(before);
    this.emitSelection();
    this.container.focus({ preventScroll: true });
    return item;
  }

  updateSelected(patch) {
    this.finishEditing();
    const before = clone(this.items);
    this.items = this.items.map((item) =>
      this.selected.has(item.id) ? { ...item, ...patch } : item,
    );
    this.render();
    this.commit(before);
  }

  deleteSelected() {
    this.finishEditing();
    if (!this.selected.size) return;
    const before = clone(this.items);
    this.items = this.items.filter(
      (item) => !this.selected.has(item.id) || item.locked,
    );
    this.items.forEach((item) => {
      if (this.selected.has(item.startId)) delete item.startId;
      if (this.selected.has(item.endId)) delete item.endId;
    });
    this.selected.clear();
    this.render();
    this.commit(before);
    this.emitSelection();
  }

  duplicateSelected() {
    this.finishEditing();
    const originals = this.getSelection();
    if (!originals.length) return;
    this.insertCopies(originals, 28, 28);
  }

  insertCopies(originals, dx, dy) {
    const before = clone(this.items);
    const ids = new Map(originals.map((item) => [item.id, uid()]));
    const copies = originals.map((original) => {
      const item = clone(original);
      item.id = ids.get(original.id);
      item.x += dx;
      item.y += dy;
      if (item.points)
        item.points = item.points.map((point) => [
          point[0] + dx,
          point[1] + dy,
        ]);
      if (item.startId) item.startId = ids.get(item.startId);
      if (item.endId) item.endId = ids.get(item.endId);
      return item;
    });
    this.items.push(...copies);
    this.selected = new Set(copies.map((item) => item.id));
    this.render();
    this.commit(before);
    this.emitSelection();
  }

  reorderSelected(direction) {
    this.finishEditing();
    if (!this.selected.size) return;
    const before = clone(this.items);
    const chosen = this.items.filter((item) => this.selected.has(item.id));
    const others = this.items.filter((item) => !this.selected.has(item.id));
    this.items =
      direction === "back" || direction === "backward"
        ? [...chosen, ...others]
        : [...others, ...chosen];
    this.render();
    this.commit(before);
  }

  selectAll() {
    this.finishEditing();
    this.selected = new Set(this.items.map((item) => item.id));
    this.renderSelection();
    this.emitSelection();
  }

  pointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (editableTarget(event.target)) return;
    this.finishEditing();
    this.container.focus({ preventScroll: true });
    event.preventDefault();
    this.svg.setPointerCapture(event.pointerId);
    const point = this.worldPoint(event),
      screen = this.screenPoint(event);
    const handle = event.target.closest?.("[data-handle]")?.dataset.handle;
    const endpoint =
      event.target.closest?.("[data-endpoint]")?.dataset.endpoint;
    const itemId = event.target.closest?.("[data-item-id]")?.dataset.itemId;
    if (event.button === 1 || this.spaceDown || this.tool === "hand") {
      this.gesture = { kind: "pan", screen, view: { ...this.view } };
      this.updateCursor();
      return;
    }
    if (endpoint !== undefined && this.tool === "pointer") {
      const item = this.items.find((candidate) => candidate.id === itemId);
      if (!item || item.locked) return;
      const before = clone(this.items);
      item.points = this.connectorPoints(item);
      const attachment = endpoint === "0" ? "startId" : "endId";
      delete item[attachment];
      this.gesture = {
        kind: "endpoint",
        id: item.id,
        index: Number(endpoint),
        attachment,
        before,
      };
      return;
    }
    if (handle && this.selected.size && this.tool === "pointer") {
      const rect = this.selectionBounds();
      const selectedItems = this.items.filter(
        (item) => this.selected.has(item.id) && !item.locked,
      );
      if (!selectedItems.length) return;
      this.gesture = {
        kind: "resize",
        handle,
        point,
        rect,
        originals: clone(selectedItems),
        before: clone(this.items),
      };
      return;
    }
    if (this.tool === "pointer") {
      if (itemId) {
        const item = this.items.find((candidate) => candidate.id === itemId);
        if (
          this.lastClick?.id === itemId &&
          performance.now() - this.lastClick.time < 350 &&
          Math.hypot(
            screen.x - this.lastClick.screen.x,
            screen.y - this.lastClick.screen.y,
          ) < 8 &&
          textTypes.has(item.type) &&
          !item.locked
        ) {
          this.lastClick = null;
          this.startEditing(item);
          return;
        }
        if (event.shiftKey) {
          if (this.selected.has(itemId)) this.selected.delete(itemId);
          else this.selected.add(itemId);
        } else if (!this.selected.has(itemId))
          this.selected = new Set([itemId]);
        this.renderSelection();
        this.emitSelection();
        if (!this.selected.has(itemId) || item.locked) return;
        if (event.altKey) {
          const originals = this.getSelection();
          this.insertCopies(originals, 0, 0);
        }
        let moving = this.items.filter(
          (candidate) => this.selected.has(candidate.id) && !candidate.locked,
        );
        const frame = moving.find((candidate) => candidate.type === "frame");
        if (frame && moving.length === 1) {
          const frameBounds = this.bounds(frame);
          moving = this.items.filter((candidate) => {
            const rect = this.bounds(candidate);
            return (
              candidate.id === frame.id ||
              (!candidate.locked &&
                rect.x >= frameBounds.x &&
                rect.y >= frameBounds.y &&
                rect.x + rect.width <= frameBounds.x + frameBounds.width &&
                rect.y + rect.height <= frameBounds.y + frameBounds.height)
            );
          });
        }
        this.gesture = {
          kind: "move",
          point,
          originals: clone(moving),
          before: clone(this.items),
        };
      } else {
        const initial = event.shiftKey ? new Set(this.selected) : new Set();
        this.selected = new Set(initial);
        this.gesture = { kind: "marquee", point, current: point, initial };
        this.renderSelection();
        this.emitSelection();
      }
      return;
    }
    if (this.tool === "image") return;
    const before = clone(this.items);
    const item = this.defaultItem(this.tool, { x: point.x, y: point.y });
    if (pathTypes.has(item.type)) {
      item.points = [
        [point.x, point.y],
        [point.x, point.y],
      ];
      item.width = 0;
      item.height = 0;
      if (item.type !== "draw") {
        const attached = this.itemAt(point);
        if (attached) item.startId = attached.id;
      }
    }
    if (item.type === "frame") this.items.unshift(item);
    else this.items.push(item);
    this.selected = new Set([item.id]);
    this.gesture = {
      kind: "create",
      point,
      current: point,
      id: item.id,
      before,
      moved: false,
    };
    this.render();
    this.emitSelection();
  }

  pointerMove(event) {
    if (!this.gesture) return;
    const gesture = this.gesture;
    const point = this.worldPoint(event);
    if (gesture.kind === "pan") {
      const screen = this.screenPoint(event);
      this.view.x = gesture.view.x + screen.x - gesture.screen.x;
      this.view.y = gesture.view.y + screen.y - gesture.screen.y;
      this.renderView();
      this.callbacks.onView?.({ ...this.view });
      return;
    }
    if (gesture.kind === "marquee") {
      gesture.current = point;
      const rect = {
        x: Math.min(point.x, gesture.point.x),
        y: Math.min(point.y, gesture.point.y),
        width: Math.abs(point.x - gesture.point.x),
        height: Math.abs(point.y - gesture.point.y),
      };
      this.selected = new Set(gesture.initial);
      this.items.forEach((item) => {
        if (intersects(rect, this.bounds(item))) this.selected.add(item.id);
      });
      this.renderSelection();
      this.emitSelection();
      return;
    }
    if (gesture.kind === "move") {
      let dx = point.x - gesture.point.x,
        dy = point.y - gesture.point.y;
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      gesture.originals.forEach((original) => {
        const item = this.items.find(
          (candidate) => candidate.id === original.id,
        );
        item.x = original.x + dx;
        item.y = original.y + dy;
        if (original.points)
          item.points = original.points.map((coordinate) => [
            coordinate[0] + dx,
            coordinate[1] + dy,
          ]);
        if (pathTypes.has(item.type)) {
          const movingIds = new Set(
            gesture.originals.map((original) => original.id),
          );
          if (!movingIds.has(original.startId)) delete item.startId;
          if (!movingIds.has(original.endId)) delete item.endId;
        }
      });
    } else if (gesture.kind === "endpoint") {
      const item = this.items.find((candidate) => candidate.id === gesture.id);
      item.points[gesture.index] = [point.x, point.y];
      const target = this.itemAt(
        point,
        new Set([
          item.id,
          item[gesture.attachment === "startId" ? "endId" : "startId"],
        ]),
      );
      if (target) item[gesture.attachment] = target.id;
      else delete item[gesture.attachment];
      this.updatePathBounds(item);
    } else if (gesture.kind === "resize") {
      this.resizeItems(gesture, point, event.shiftKey);
    } else if (gesture.kind === "create") {
      const item = this.items.find((candidate) => candidate.id === gesture.id);
      if (!item) return;
      gesture.current = point;
      gesture.moved =
        gesture.moved ||
        Math.hypot(point.x - gesture.point.x, point.y - gesture.point.y) *
          this.view.zoom >
          4;
      if (!gesture.moved) return;
      if (item.type === "draw") {
        const last = item.points.at(-1);
        if (
          Math.hypot(last[0] - point.x, last[1] - point.y) * this.view.zoom >
          1.5
        )
          item.points.push([point.x, point.y]);
        this.updatePathBounds(item);
      } else if (item.type === "arrow" || item.type === "line") {
        let end = [point.x, point.y];
        if (event.shiftKey) {
          const dx = point.x - gesture.point.x,
            dy = point.y - gesture.point.y;
          const angle =
            (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
          const length = Math.hypot(dx, dy);
          end = [
            gesture.point.x + Math.cos(angle) * length,
            gesture.point.y + Math.sin(angle) * length,
          ];
        }
        item.points[1] = end;
        this.updatePathBounds(item);
        const target = this.itemAt(
          { x: end[0], y: end[1] },
          new Set([item.startId, item.id]),
        );
        if (target) item.endId = target.id;
        else delete item.endId;
      } else {
        let width = Math.abs(point.x - gesture.point.x),
          height = Math.abs(point.y - gesture.point.y);
        if (event.shiftKey) width = height = Math.max(width, height);
        item.x =
          point.x < gesture.point.x ? gesture.point.x - width : gesture.point.x;
        item.y =
          point.y < gesture.point.y
            ? gesture.point.y - height
            : gesture.point.y;
        item.width = Math.max(20, width);
        item.height = Math.max(20, height);
      }
    }
    this.render();
  }

  updatePathBounds(item) {
    const xs = item.points.map((point) => point[0]),
      ys = item.points.map((point) => point[1]);
    item.x = Math.min(...xs);
    item.y = Math.min(...ys);
    item.width = Math.max(...xs) - item.x;
    item.height = Math.max(...ys) - item.y;
  }

  resizeItems(gesture, point, preserveRatio) {
    const original = gesture.rect;
    let left = original.x,
      top = original.y,
      right = original.x + original.width,
      bottom = original.y + original.height;
    if (gesture.handle.includes("w")) left = Math.min(point.x, right - 20);
    if (gesture.handle.includes("e")) right = Math.max(point.x, left + 20);
    if (gesture.handle.includes("n")) top = Math.min(point.y, bottom - 20);
    if (gesture.handle.includes("s")) bottom = Math.max(point.y, top + 20);
    let width = right - left,
      height = bottom - top;
    if (preserveRatio && original.width && original.height) {
      const ratio = original.width / original.height;
      if (width / height > ratio) height = width / ratio;
      else width = height * ratio;
      if (gesture.handle.includes("w")) left = right - width;
      else right = left + width;
      if (gesture.handle.includes("n")) top = bottom - height;
      else bottom = top + height;
    }
    const sx = width / (original.width || 1),
      sy = height / (original.height || 1);
    gesture.originals.forEach((source) => {
      const item = this.items.find((candidate) => candidate.id === source.id);
      item.x = left + (source.x - original.x) * sx;
      item.y = top + (source.y - original.y) * sy;
      item.width = Math.max(1, source.width * sx);
      item.height = Math.max(1, source.height * sy);
      if (source.points) {
        item.points = source.points.map((coordinate) => [
          left + (coordinate[0] - original.x) * sx,
          top + (coordinate[1] - original.y) * sy,
        ]);
        delete item.startId;
        delete item.endId;
        this.updatePathBounds(item);
      }
    });
  }

  pointerUp(event) {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    if (this.svg.hasPointerCapture(event.pointerId))
      this.svg.releasePointerCapture(event.pointerId);
    this.updateCursor();
    if (gesture.kind === "create") {
      const item = this.items.find((candidate) => candidate.id === gesture.id);
      if (!item) return;
      if (!gesture.moved && pathTypes.has(item.type)) {
        if (item.type === "draw") {
          item.points = [
            [item.x, item.y],
            [item.x + 1, item.y + 1],
          ];
        } else {
          item.points = [
            [item.x, item.y],
            [item.x + 200, item.y],
          ];
          item.width = 200;
        }
      }
      this.render();
      this.commit(gesture.before);
      const shouldEdit = textTypes.has(item.type) && item.type !== "frame";
      this.setTool("pointer");
      if (shouldEdit) this.startEditing(item);
    } else if (gesture.before) {
      const changed =
        JSON.stringify(gesture.before) !== JSON.stringify(this.items);
      if (changed) this.render();
      else this.renderSelection();
      if (gesture.kind === "move" && !changed && gesture.originals.length === 1)
        this.lastClick = {
          id: gesture.originals[0].id,
          time: performance.now(),
          screen: this.screenPoint(event),
        };
      else this.lastClick = null;
      this.commit(gesture.before);
    } else this.renderSelection();
    this.emitSelection();
  }

  cancelGesture() {
    if (this.gesture?.before) this.items = this.gesture.before;
    this.gesture = null;
    this.updateCursor();
    this.render();
  }

  doubleClick(event) {
    if (this.tool === "hand" || this.spaceDown || editableTarget(event.target))
      return;
    const id = event.target.closest?.("[data-item-id]")?.dataset.itemId;
    const point = this.worldPoint(event);
    const item =
      this.items.find((candidate) => candidate.id === id) ||
      [...this.items].reverse().find((candidate) => {
        if (!textTypes.has(candidate.type)) return false;
        const rect = this.bounds(candidate);
        return (
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y - (candidate.type === "frame" ? 36 : 0) &&
          point.y <= rect.y + rect.height
        );
      });
    if (item && textTypes.has(item.type) && !item.locked)
      this.startEditing(item);
    else if (!id && this.tool === "pointer") {
      const created = this.addItem("text", { x: point.x, y: point.y });
      this.startEditing(
        this.items.find((candidate) => candidate.id === created.id),
      );
    }
  }

  startEditing(item) {
    if (!item || !textTypes.has(item.type) || item.locked) return;
    this.finishEditing();
    this.selected = new Set([item.id]);
    const padding = item.type === "text" || item.type === "frame" ? 0 : 16;
    const foreign = svgElement("foreignObject", {
      x: item.x + padding,
      y: item.type === "frame" ? item.y - 30 : item.y + padding,
      width: Math.max(40, item.width - padding * 2),
      height:
        item.type === "frame" ? 32 : Math.max(30, item.height - padding * 2),
      class: "board-editor__text-edit",
    });
    const textarea = document.createElementNS(XHTML, "textarea");
    textarea.className = "board-editor__textarea";
    textarea.value = item.text || "";
    textarea.setAttribute("aria-label", "Edit object text");
    textarea.setAttribute("placeholder", "Type something…");
    textarea.style.fontSize = `${item.fontSize || 20}px`;
    textarea.style.color = item.textColor || item.stroke || "#292d38";
    textarea.style.fontWeight = item.bold
      ? "700"
      : String(item.fontWeight || 500);
    textarea.style.fontStyle = item.italic ? "italic" : "normal";
    textarea.style.textAlign =
      item.align ||
      (item.type === "text" || item.type === "frame" ? "left" : "center");
    textarea.style.paddingTop =
      item.type === "sticky" ||
      item.type === "rect" ||
      item.type === "ellipse" ||
      item.type === "diamond"
        ? `${Math.max(0, (item.height - padding * 2 - (item.fontSize || 20) * 1.4) / 2 - 4)}px`
        : "0";
    textarea.addEventListener("pointerdown", (event) =>
      event.stopPropagation(),
    );
    textarea.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        this.finishEditing(false);
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.finishEditing();
      }
    });
    textarea.addEventListener("input", () => {
      const lines = textarea.value.split("\n").length;
      textarea.style.paddingTop =
        item.type === "text" || item.type === "frame"
          ? "0"
          : `${Math.max(0, (item.height - padding * 2 - (item.fontSize || 20) * 1.4 * lines) / 2 - 4)}px`;
    });
    textarea.addEventListener("blur", () => {
      if (this.editing?.textarea === textarea) this.finishEditing();
    });
    foreign.append(textarea);
    this.editing = {
      id: item.id,
      before: clone(this.items),
      foreign,
      textarea,
    };
    this.render();
    this.emitSelection();
    requestAnimationFrame(() => {
      if (this.editing?.textarea === textarea) {
        textarea.focus();
        textarea.select();
      }
    });
  }

  finishEditing(save = true) {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const item = this.items.find((candidate) => candidate.id === editing.id);
    if (item && save) item.text = editing.textarea.value;
    editing.foreign.remove();
    this.render();
    if (save) this.commit(editing.before);
    this.container.focus({ preventScroll: true });
  }

  wheel(event) {
    if (editableTarget(event.target)) return;
    event.preventDefault();
    this.finishEditing();
    const screen = this.screenPoint(event);
    if (
      event.ctrlKey ||
      event.metaKey ||
      (!event.deltaX && event.deltaMode !== 0)
    )
      this.zoomAt(Math.exp(-event.deltaY * 0.002), screen);
    else if (event.altKey) this.zoomAt(Math.exp(-event.deltaY * 0.002), screen);
    else {
      this.view.x -= event.deltaX;
      this.view.y -= event.deltaY;
      this.renderView();
      this.callbacks.onView?.({ ...this.view });
    }
  }

  zoomAt(factor, point) {
    const oldZoom = this.view.zoom;
    const zoom = clamp(oldZoom * factor, 0.1, 4);
    this.view.x = point.x - ((point.x - this.view.x) / oldZoom) * zoom;
    this.view.y = point.y - ((point.y - this.view.y) / oldZoom) * zoom;
    this.view.zoom = zoom;
    this.renderView();
    this.renderSelection();
    this.callbacks.onView?.({ ...this.view });
  }

  zoomBy(factor) {
    this.finishEditing();
    this.zoomAt(factor, {
      x: this.container.clientWidth / 2,
      y: this.container.clientHeight / 2,
    });
  }
  setZoom(zoom) {
    this.zoomBy(zoom / this.view.zoom);
  }

  fit() {
    this.finishEditing();
    const rect = unitedBounds(this.items.map((item) => this.bounds(item)));
    if (!rect) {
      this.view = { x: 0, y: 0, zoom: 1 };
    } else {
      const width = this.container.clientWidth,
        height = this.container.clientHeight;
      const zoom = clamp(
        Math.min(
          (width - 160) / Math.max(rect.width, 1),
          (height - 150) / Math.max(rect.height, 1),
        ),
        0.1,
        2,
      );
      this.view = {
        x: width / 2 - (rect.x + rect.width / 2) * zoom,
        y: height / 2 - (rect.y + rect.height / 2) * zoom,
        zoom,
      };
    }
    this.renderView();
    this.renderSelection();
    this.callbacks.onView?.({ ...this.view });
  }

  keyDown(event) {
    if (
      !this.container.isConnected ||
      !this.container.clientWidth ||
      editableTarget(event.target) ||
      document.querySelector("dialog[open]")
    )
      return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        event.shiftKey ? this.redo() : this.undo();
      } else if (key === "y") {
        event.preventDefault();
        this.redo();
      } else if (key === "a") {
        event.preventDefault();
        this.selectAll();
      } else if (key === "d") {
        event.preventDefault();
        this.duplicateSelected();
      } else if (key === "c") {
        event.preventDefault();
        this.copySelection();
      } else if (key === "x") {
        event.preventDefault();
        this.copySelection(true);
      } else if (key === "v") {
        return;
      } else if (key === "+" || key === "=") {
        event.preventDefault();
        this.zoomBy(1.2);
      } else if (key === "-") {
        event.preventDefault();
        this.zoomBy(1 / 1.2);
      } else if (key === "0") {
        event.preventDefault();
        this.fit();
      }
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      this.spaceDown = true;
      this.updateCursor();
      return;
    }
    if (event.key === "Escape") {
      this.cancelGesture();
      this.selected.clear();
      this.setTool("pointer");
      this.renderSelection();
      this.emitSelection();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteSelected();
    } else if (event.key === "Enter" && this.selected.size === 1) {
      event.preventDefault();
      this.startEditing(this.items.find((item) => this.selected.has(item.id)));
    } else if (event.key.startsWith("Arrow") && this.selected.size) {
      event.preventDefault();
      const before = clone(this.items),
        amount = event.shiftKey ? 10 : 1;
      const dx =
        event.key === "ArrowRight"
          ? amount
          : event.key === "ArrowLeft"
            ? -amount
            : 0;
      const dy =
        event.key === "ArrowDown"
          ? amount
          : event.key === "ArrowUp"
            ? -amount
            : 0;
      this.items.forEach((item) => {
        if (!this.selected.has(item.id) || item.locked) return;
        item.x += dx;
        item.y += dy;
        if (item.points)
          item.points = item.points.map((point) => [
            point[0] + dx,
            point[1] + dy,
          ]);
      });
      this.render();
      this.commit(before);
    } else if (toolKeys[event.key.toLowerCase()]) {
      event.preventDefault();
      this.setTool(toolKeys[event.key.toLowerCase()]);
    } else if (event.key === "1") this.fit();
    else if (event.key === "0") this.setZoom(1);
  }

  async copySelection(cut = false) {
    const selection = this.getSelection();
    if (!selection.length) return;
    this.clipboard = selection;
    if (cut) this.deleteSelected();
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ format: "gitboard-items", items: selection }),
      );
    } catch {
      /* Clipboard permission is optional; in-app copy remains available. */
    }
  }

  async paste() {
    const boardId = this.boardId;
    try {
      const text = await navigator.clipboard.readText();
      if (this.boardId !== boardId || !this.container.isConnected) return;
      if (text) {
        this.pasteText(text);
        return;
      }
    } catch {
      /* Fall back to the in-app clipboard. */
    }
    if (this.boardId === boardId) this.pasteItems(this.clipboard);
  }

  pasteText(text) {
    try {
      const data = JSON.parse(text);
      if (data?.format === "gitboard-items") {
        const items = this.sanitizeClipboardItems(data.items);
        if (items) this.pasteItems(items);
        else
          this.callbacks.onError?.(
            "These clipboard objects are invalid and could not be pasted.",
          );
        return;
      }
    } catch {
      /* Ordinary text is also useful on a board. */
    }
    if (text.length > 100000) {
      this.callbacks.onError?.("Choose a shorter text selection to paste.");
      return;
    }
    this.addItem("text", {
      text,
      width: 420,
      height: Math.min(600, Math.max(72, Math.ceil(text.length / 36) * 27)),
    });
    this.setTool("pointer");
  }

  pasteItems(items) {
    items = this.sanitizeClipboardItems(items);
    if (!items?.length) return;
    const rect = unitedBounds(items.map((item) => boundsOf(item)));
    const center = this.center();
    this.insertCopies(
      items,
      center.x - rect.x - rect.width / 2,
      center.y - rect.y - rect.height / 2,
    );
    this.setTool("pointer");
  }

  validClipboardItems(items) {
    return this.sanitizeClipboardItems(items) !== null;
  }

  sanitizeClipboardItems(items) {
    if (!Array.isArray(items) || items.length > 500) return null;
    try {
      return validateProject({
        schemaVersion: 1,
        id: "clipboard",
        name: "Clipboard",
        boards: [
          {
            id: "clipboard-board",
            name: "Clipboard",
            items,
            view: { x: 0, y: 0, zoom: 1 },
          },
        ],
      }).boards[0].items;
    } catch {
      return null;
    }
  }

  pasteEvent(event) {
    if (
      editableTarget(event.target) ||
      !this.container.clientWidth ||
      document.querySelector("dialog[open]")
    )
      return;
    const files = [...(event.clipboardData?.files || [])].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length) {
      event.preventDefault();
      files.forEach((file) => this.importImage(file));
      return;
    }
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      event.preventDefault();
      this.pasteText(text);
    } else if (this.clipboard.length) {
      event.preventDefault();
      this.pasteItems(this.clipboard);
    }
  }

  drop(event) {
    if (editableTarget(event.target)) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])].filter((file) =>
      file.type.startsWith("image/"),
    );
    const point = this.worldPoint(event);
    files.forEach((file, index) =>
      this.importImage(file, {
        x: point.x + index * 24,
        y: point.y + index * 24,
      }),
    );
  }

  importImage(file, point) {
    const boardId = this.boardId;
    if (file.size > 8 * 1024 * 1024) {
      this.callbacks.onError?.("Choose an image smaller than 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () =>
      this.callbacks.onError?.("The image could not be read.");
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        if (this.boardId !== boardId || !this.container.isConnected) {
          this.callbacks.onError?.(
            "Open the original board to add this image.",
          );
          return;
        }
        const factor = Math.min(1, 600 / Math.max(image.width, image.height));
        let src = reader.result;
        if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(src)) {
          const raster = document.createElement("canvas");
          const rasterScale = Math.min(
            1,
            2400 / Math.max(image.width, image.height),
          );
          raster.width = Math.max(1, Math.round(image.width * rasterScale));
          raster.height = Math.max(1, Math.round(image.height * rasterScale));
          raster
            .getContext("2d")
            .drawImage(image, 0, 0, raster.width, raster.height);
          src = raster.toDataURL("image/png");
        }
        if (src.length > 12_000_000) {
          this.callbacks.onError?.(
            "This image is too large to embed. Choose a smaller image.",
          );
          return;
        }
        this.addItem("image", {
          src,
          width: image.width * factor,
          height: image.height * factor,
          ...(point || {}),
        });
        this.setTool("pointer");
      };
      image.onerror = () =>
        this.callbacks.onError?.("This image format could not be opened.");
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  renderView() {
    const transform = `translate(${this.view.x} ${this.view.y}) scale(${this.view.zoom})`;
    this.scene.setAttribute("transform", transform);
    this.selectionLayer.setAttribute("transform", transform);
    this.pattern.setAttribute("patternTransform", transform);
    this.pattern.firstChild.setAttribute("r", 1 / Math.sqrt(this.view.zoom));
  }

  render() {
    this.scene.replaceChildren();
    this.items.forEach((item) => this.scene.append(this.renderItem(item)));
    if (this.editing) this.scene.append(this.editing.foreign);
    this.hint.hidden = this.items.length > 0;
    this.renderView();
    this.renderSelection();
    this.updateCursor();
  }

  renderItem(item, exporting = false) {
    const group = svgElement("g", {
      "data-item-id": item.id,
      class: `board-editor__item board-editor__item--${item.type}${item.locked ? " is-locked" : ""}`,
      opacity:
        item.opacity === undefined ? 1 : clamp(Number(item.opacity), 0, 1),
    });
    const x = Number(item.x) || 0,
      y = Number(item.y) || 0,
      width = Math.max(1, Number(item.width) || 1),
      height = Math.max(1, Number(item.height) || 1);
    const fill = item.fill || "#ffffff",
      stroke = item.stroke || "#373b48";
    const shapeAttrs = {
      fill,
      stroke,
      "stroke-width": item.strokeWidth || 2,
      ...(item.dashed ? { "stroke-dasharray": "7 5" } : {}),
    };
    if (item.type === "sticky") {
      if (!exporting)
        group.append(
          svgElement("rect", {
            x: x + 2,
            y: y + 4,
            width,
            height,
            rx: 2,
            fill: "#162033",
            opacity: 0.08,
          }),
        );
      group.append(
        svgElement("rect", {
          x,
          y,
          width,
          height,
          rx: 2,
          fill: fill === "transparent" ? "#fff2a8" : fill,
          stroke: "none",
        }),
      );
      group.append(
        svgElement("path", {
          d: `M ${x + width - 18} ${y + height} L ${x + width} ${y + height - 18} L ${x + width} ${y + height} Z`,
          fill: "#000000",
          opacity: 0.055,
        }),
      );
    } else if (item.type === "rect")
      group.append(
        svgElement("rect", { x, y, width, height, rx: 8, ...shapeAttrs }),
      );
    else if (item.type === "ellipse")
      group.append(
        svgElement("ellipse", {
          cx: x + width / 2,
          cy: y + height / 2,
          rx: width / 2,
          ry: height / 2,
          ...shapeAttrs,
        }),
      );
    else if (item.type === "diamond")
      group.append(
        svgElement("polygon", {
          points: `${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`,
          ...shapeAttrs,
        }),
      );
    else if (item.type === "frame") {
      group.append(
        svgElement("rect", {
          x,
          y,
          width,
          height,
          rx: 8,
          fill: fill === "transparent" ? "#ffffff" : fill,
          "fill-opacity": fill === "transparent" ? 0.35 : 1,
          stroke: item.stroke === "#373b48" ? "#acb4c4" : stroke,
          "stroke-width": 1.5,
          "stroke-dasharray": "8 5",
        }),
      );
    } else if (item.type === "image") {
      group.append(
        svgElement("rect", { x, y, width, height, rx: 4, fill: "#e9edf3" }),
      );
      const source =
        typeof item.src === "string" &&
        /^(data:image\/(?:png|jpeg|jpg|gif|webp|avif|bmp);|https?:\/\/)/i.test(
          item.src,
        )
          ? item.src
          : "";
      if (source)
        group.append(
          svgElement("image", {
            x,
            y,
            width,
            height,
            href: source,
            preserveAspectRatio: "xMidYMid meet",
          }),
        );
    } else if (pathTypes.has(item.type)) {
      const points = this.connectorPoints(item);
      const d = points
        .map((point, index) => `${index ? "L" : "M"} ${point[0]} ${point[1]}`)
        .join(" ");
      if (!exporting)
        group.append(
          svgElement("path", {
            d,
            fill: "none",
            stroke: "transparent",
            "stroke-width": Math.max(18 / this.view.zoom, 10),
            "pointer-events": "stroke",
          }),
        );
      group.append(
        svgElement("path", {
          d,
          fill: "none",
          stroke,
          "stroke-width": item.strokeWidth || (item.type === "draw" ? 3 : 2),
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          ...(item.dashed ? { "stroke-dasharray": "7 5" } : {}),
          ...(item.type === "arrow"
            ? { "marker-end": `url(#${this.id}-arrow)` }
            : {}),
        }),
      );
    } else {
      group.append(
        svgElement("rect", {
          x,
          y,
          width,
          height,
          fill: "transparent",
          stroke: "none",
        }),
      );
    }
    if (textTypes.has(item.type) && (exporting || this.editing?.id !== item.id))
      this.appendText(group, item);
    if (item.locked && !exporting) {
      const lock = svgElement("text", {
        x: x + width - 15,
        y: y + 16,
        "font-size": 12,
        fill: "#777f90",
        "pointer-events": "none",
      });
      lock.textContent = "⌑";
      group.append(lock);
    }
    return group;
  }

  wrappedLines(text, width, fontSize) {
    if (!text) return [];
    const context = this.measureContext;
    context.font = `500 ${fontSize}px Inter, Arial, sans-serif`;
    const lines = [];
    String(text)
      .split("\n")
      .forEach((paragraph) => {
        if (!paragraph) {
          lines.push("");
          return;
        }
        const words = paragraph.split(/\s+/);
        let line = "";
        words.forEach((word) => {
          const candidate = line ? `${line} ${word}` : word;
          if (context.measureText(candidate).width > width && line) {
            lines.push(line);
            line = word;
          } else line = candidate;
          if (context.measureText(line).width > width && line.length > 1) {
            let segment = "";
            for (const character of line) {
              if (
                context.measureText(segment + character).width > width &&
                segment
              ) {
                lines.push(segment);
                segment = character;
              } else segment += character;
            }
            line = segment;
          }
        });
        lines.push(line);
      });
    return lines;
  }

  appendText(group, item) {
    if (!item.text) return;
    const fontSize = clamp(Number(item.fontSize) || 20, 8, 120);
    const left = item.type === "text" || item.type === "frame";
    const align = item.align || (left ? "left" : "center");
    const padding = left ? 0 : item.type === "diamond" ? item.width * 0.2 : 16;
    const lines = this.wrappedLines(
      item.text,
      Math.max(20, item.width - padding * 2),
      fontSize,
    );
    const lineHeight = fontSize * 1.35;
    const availableHeight =
      item.type === "frame" ? Infinity : item.height - (left ? 0 : 20);
    const maximum = Math.max(1, Math.floor(availableHeight / lineHeight));
    const visible = lines.slice(0, maximum);
    if (lines.length > maximum)
      visible[maximum - 1] = `${visible[maximum - 1].replace(/\s+\S*$/, "")}…`;
    const x =
      align === "left"
        ? item.x + padding
        : align === "right"
          ? item.x + item.width - padding
          : item.x + item.width / 2;
    const y =
      item.type === "frame"
        ? item.y - 12
        : left
          ? item.y + fontSize
          : item.y + (item.height - visible.length * lineHeight) / 2 + fontSize;
    const text = svgElement("text", {
      x,
      y,
      fill: item.textColor || item.stroke || "#292d38",
      "font-family": "Inter, Arial, sans-serif",
      "font-size": fontSize,
      "font-weight": item.bold
        ? 700
        : item.fontWeight || (item.type === "frame" ? 600 : 500),
      "font-style": item.italic ? "italic" : "normal",
      "text-anchor":
        align === "left" ? "start" : align === "right" ? "end" : "middle",
      "pointer-events": "none",
    });
    visible.forEach((line, index) => {
      const span = svgElement("tspan", { x, dy: index ? lineHeight : 0 });
      span.textContent = line || "\u00a0";
      text.append(span);
    });
    group.append(text);
  }

  renderSelection() {
    this.selectionLayer.replaceChildren();
    const zoom = this.view.zoom;
    if (this.gesture?.kind === "marquee") {
      const { point, current } = this.gesture;
      this.selectionLayer.append(
        svgElement("rect", {
          x: Math.min(point.x, current.x),
          y: Math.min(point.y, current.y),
          width: Math.abs(point.x - current.x),
          height: Math.abs(point.y - current.y),
          fill: "#6455ec",
          "fill-opacity": 0.08,
          stroke: "#6455ec",
          "stroke-width": 1 / zoom,
          "pointer-events": "none",
        }),
      );
    }
    if (!this.selected.size) return;
    const rect = this.selectionBounds();
    if (!rect) return;
    const padding = 4 / zoom;
    const x = rect.x - padding,
      y = rect.y - padding,
      width = rect.width + padding * 2,
      height = rect.height + padding * 2;
    this.selectionLayer.append(
      svgElement("rect", {
        x,
        y,
        width,
        height,
        fill: "none",
        stroke: "#6655e8",
        "stroke-width": 1.5 / zoom,
        "pointer-events": "none",
      }),
    );
    const selectedItems = this.items.filter((item) =>
      this.selected.has(item.id),
    );
    if (
      selectedItems.every((item) => item.locked) ||
      this.editing ||
      this.tool !== "pointer"
    )
      return;
    if (
      selectedItems.length === 1 &&
      ["line", "arrow"].includes(selectedItems[0].type)
    ) {
      const item = selectedItems[0],
        points = this.connectorPoints(item);
      [0, points.length - 1].forEach((index) =>
        this.selectionLayer.append(
          svgElement("circle", {
            cx: points[index][0],
            cy: points[index][1],
            r: 5 / zoom,
            fill: "#ffffff",
            stroke: "#6655e8",
            "stroke-width": 1.5 / zoom,
            "data-endpoint": index,
            "data-item-id": item.id,
            class: "board-editor__endpoint",
            "pointer-events": "all",
          }),
        ),
      );
      return;
    }
    if (this.selected.size > 1)
      selectedItems.forEach((item) => {
        const b = this.bounds(item);
        this.selectionLayer.append(
          svgElement("rect", {
            x: b.x - padding / 2,
            y: b.y - padding / 2,
            width: b.width + padding,
            height: b.height + padding,
            fill: "none",
            stroke: "#8b7ef0",
            "stroke-width": 0.7 / zoom,
            "pointer-events": "none",
          }),
        );
      });
    const handles = {
      nw: [x, y],
      n: [x + width / 2, y],
      ne: [x + width, y],
      e: [x + width, y + height / 2],
      se: [x + width, y + height],
      s: [x + width / 2, y + height],
      sw: [x, y + height],
      w: [x, y + height / 2],
    };
    Object.entries(handles).forEach(([name, [hx, hy]]) => {
      const handle = svgElement("rect", {
        x: hx - 4 / zoom,
        y: hy - 4 / zoom,
        width: 8 / zoom,
        height: 8 / zoom,
        rx: 1.5 / zoom,
        fill: "#ffffff",
        stroke: "#6655e8",
        "stroke-width": 1.5 / zoom,
        "data-handle": name,
        class: `board-editor__handle board-editor__handle--${name}`,
      });
      this.selectionLayer.append(handle);
    });
  }

  exportSvg() {
    this.finishEditing();
    const rect = unitedBounds(this.items.map((item) => this.bounds(item))) || {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    };
    const padding = 48;
    const x = rect.x - padding,
      y = rect.y - padding;
    const width = Math.max(1, rect.width + padding * 2),
      height = Math.max(1, rect.height + padding * 2);
    const svg = svgElement("svg", {
      xmlns: NS,
      width,
      height,
      viewBox: `${x} ${y} ${width} ${height}`,
    });
    const defs = this.defs.cloneNode(true);
    defs.querySelector("pattern")?.remove();
    svg.append(
      defs,
      svgElement("rect", { x, y, width, height, fill: "#ffffff" }),
    );
    this.items.forEach((item) => svg.append(this.renderItem(item, true)));
    return new XMLSerializer().serializeToString(svg);
  }

  async exportPng() {
    const svg = this.exportSvg();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () =>
          reject(new Error("The board could not be exported."));
        image.src = url;
      });
      const scale = Math.min(2, 8192 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.scale(scale, scale);
      context.drawImage(image, 0, 0);
      return await new Promise((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("The board could not be exported.")),
          "image/png",
        ),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  destroy() {
    this.finishEditing();
    this.listeners.forEach((remove) => remove());
    this.resizeObserver.disconnect();
    this.container.replaceChildren();
    this.container.classList.remove("board-editor");
  }
}
