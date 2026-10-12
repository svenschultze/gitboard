export const STORAGE_KEY = "gitboard.workspace.v1";
export const COLORS = [
  "#fff2a8",
  "#ccece4",
  "#ded6ff",
  "#ffd5c3",
  "#cde6ff",
  "#ffffff",
];
export const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const types = new Set([
  "sticky",
  "rect",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "draw",
  "frame",
  "image",
]);
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;
const color = /^(#[0-9a-fA-F]{3,8}|transparent|none)$/;

export function boundsOf(input) {
  const items = Array.isArray(input) ? input : [input];
  if (!items.length) return { x: 0, y: 0, width: 0, height: 0 };
  const bounds = items.map((item) => {
    if (item.points?.length) {
      const xs = item.points.map((p) => p[0]),
        ys = item.points.map((p) => p[1]);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    }
    return item;
  });
  const x = Math.min(...bounds.map((i) => i.x)),
    y = Math.min(...bounds.map((i) => i.y));
  return {
    x,
    y,
    width: Math.max(...bounds.map((i) => i.x + i.width)) - x,
    height: Math.max(...bounds.map((i) => i.y + i.height)) - y,
  };
}

function item(
  type,
  x,
  y,
  width,
  height,
  text = "",
  fill = "#ffffff",
  extra = {},
) {
  return {
    id: uid(),
    type,
    x,
    y,
    width,
    height,
    text,
    fill,
    stroke: "#353846",
    fontSize: 20,
    ...extra,
  };
}

function demoItems() {
  return [
    item("text", 12, 6, 800, 70, "Big ideas start here.", "transparent", {
      fontSize: 46,
      fontWeight: 700,
      stroke: "#272b39",
    }),
    item(
      "text",
      15,
      82,
      800,
      40,
      "A little room to think, explore, and make something great.",
      "transparent",
      { fontSize: 19, stroke: "#858591" },
    ),
    item("frame", 4, 185, 320, 460, "01  DISCOVER", "#ffffff", {
      stroke: "#d9dce3",
      textColor: "#89849a",
      fontSize: 14,
    }),
    item("frame", 364, 185, 320, 460, "02  EXPLORE", "#ffffff", {
      stroke: "#d9dce3",
      textColor: "#89849a",
      fontSize: 14,
    }),
    item("frame", 724, 185, 320, 460, "03  MAKE IT HAPPEN", "#ffffff", {
      stroke: "#d9dce3",
      textColor: "#89849a",
      fontSize: 14,
    }),
    item(
      "sticky",
      31,
      220,
      264,
      165,
      "What if our best ideas\nhad a place to grow?",
      "#fff2a8",
      { fontSize: 24, stroke: "#3c3b30" },
    ),
    item("sticky", 31, 410, 123, 126, "Less friction.\nMore flow.", "#ccece4", {
      fontSize: 19,
    }),
    item("sticky", 171, 410, 124, 126, "Made for\ncurious minds.", "#ded6ff", {
      fontSize: 19,
    }),
    item("text", 40, 566, 255, 44, "Start with a question. ✦", "transparent", {
      fontSize: 17,
      stroke: "#858591",
    }),
    item(
      "sticky",
      391,
      220,
      264,
      126,
      "One canvas.\nEndless possibilities.",
      "#ded6ff",
      { fontSize: 22 },
    ),
    item(
      "sticky",
      391,
      369,
      264,
      162,
      "Sketch the messy middle.\nConnect the dots.\nFind the unexpected.",
      "#cde6ff",
      { fontSize: 22 },
    ),
    item(
      "text",
      400,
      566,
      250,
      44,
      "A good idea invites another.",
      "transparent",
      { fontSize: 17, stroke: "#858591" },
    ),
    item("sticky", 751, 220, 264, 165, "Small steps.\nBig things.", "#ccece4", {
      fontSize: 27,
    }),
    item("rect", 751, 415, 264, 91, "✓  Make it real", "#ffffff", {
      stroke: "#d5dbd8",
      textColor: "#737b74",
      fontSize: 21,
    }),
    item(
      "text",
      760,
      566,
      255,
      44,
      "Your next chapter starts here.",
      "transparent",
      { fontSize: 17, stroke: "#858591" },
    ),
    item("arrow", 310, 294, 70, 0, "", "transparent", {
      stroke: "#9993c9",
      strokeWidth: 2,
      points: [
        [310, 294],
        [380, 294],
      ],
    }),
    item("arrow", 670, 294, 70, 0, "", "transparent", {
      stroke: "#9993c9",
      strokeWidth: 2,
      points: [
        [670, 294],
        [740, 294],
      ],
    }),
    item(
      "text",
      12,
      706,
      700,
      35,
      "YOUR IDEAS, VERSIONED.  YOUR SPACE, UNLIMITED.",
      "transparent",
      { fontSize: 12, stroke: "#9999a4" },
    ),
  ];
}

export function createBoard(name = "Untitled board", template = "blank") {
  let items = [];
  if (template === "welcome") items = demoItems();
  if (template === "brainstorm") {
    items = [
      item("text", 0, 0, 850, 70, "What could we create?", "transparent", {
        fontSize: 40,
        fontWeight: 700,
      }),
    ];
    ["The big question", "Wild ideas", "Worth exploring"].forEach(
      (title, column) => {
        items.push(
          item("frame", column * 340, 140, 310, 410, title, "#ffffff", {
            stroke: "#d9dce3",
          }),
        );
        for (let row = 0; row < 2; row++)
          items.push(
            item(
              "sticky",
              column * 340 + 25,
              185 + row * 160,
              260,
              140,
              row
                ? ""
                : [
                    "What problem are\nwe trying to solve?",
                    "No idea is too big.",
                    "What should we\ntry first?",
                  ][column],
              COLORS[column],
            ),
          );
      },
    );
  }
  if (template === "kanban") {
    items = [
      item("text", 0, 0, 900, 70, "From idea to done.", "transparent", {
        fontSize: 40,
        fontWeight: 700,
      }),
    ];
    ["To do", "In progress", "Done"].forEach((title, column) => {
      items.push(
        item("frame", column * 340, 140, 310, 510, title, "#ffffff", {
          stroke: "#d9dce3",
        }),
      );
      items.push(
        item(
          "sticky",
          column * 340 + 25,
          190,
          260,
          140,
          [
            "Add your first task",
            "What are we working on?",
            "Celebrate the small wins",
          ][column],
          COLORS[column],
        ),
      );
    });
  }
  if (template === "retrospective") {
    items = [
      item("text", 0, 0, 900, 70, "Look back. Move forward.", "transparent", {
        fontSize: 40,
        fontWeight: 700,
      }),
    ];
    ["What went well?", "What could improve?", "What will we try?"].forEach(
      (title, column) => {
        items.push(
          item("frame", column * 340, 140, 310, 410, title, "#ffffff", {
            stroke: "#d9dce3",
          }),
        );
        items.push(
          item("sticky", column * 340 + 25, 190, 260, 160, "", COLORS[column]),
        );
      },
    );
  }
  const date = now();
  return {
    id: uid(),
    name,
    items,
    view: { x: 65, y: 60, zoom: template === "blank" ? 1 : 0.82 },
    createdAt: date,
    updatedAt: date,
  };
}

export function createProject(name = "Untitled project", template = "blank") {
  const date = now();
  return {
    schemaVersion: 1,
    id: uid(),
    name,
    description: "",
    boards: [
      createBoard(
        template === "welcome" ? "The big picture" : "Untitled board",
        template,
      ),
    ],
    createdAt: date,
    updatedAt: date,
  };
}

function fail(message) {
  throw new Error(`Invalid project: ${message}`);
}
function finite(n, field, positive = false) {
  if (
    typeof n !== "number" ||
    !Number.isFinite(n) ||
    Math.abs(n) > 1e7 ||
    (positive && n < 0)
  )
    fail(`${field} must be a valid number.`);
  return n;
}
function str(value, field, max = 1000) {
  if (typeof value !== "string" || value.length > max)
    fail(`${field} is missing or too long.`);
  return value;
}
function id(value) {
  if (typeof value !== "string" || !identifier.test(value))
    fail("IDs must contain only letters, numbers, hyphens, or underscores.");
  return value;
}

export function validateProject(data) {
  if (!data || typeof data !== "object" || data.schemaVersion !== 1)
    fail("unsupported file format. Expected schemaVersion 1.");
  if (
    !Array.isArray(data.boards) ||
    !data.boards.length ||
    data.boards.length > 200
  )
    fail("a project needs between 1 and 200 boards.");
  const seenBoards = new Set();
  const boards = data.boards.map((board) => {
    if (!board || typeof board !== "object") fail("invalid board.");
    const boardId = id(board.id);
    if (seenBoards.has(boardId)) fail("duplicate board ID.");
    seenBoards.add(boardId);
    if (!Array.isArray(board.items) || board.items.length > 20000)
      fail("too many or invalid board objects.");
    const seenItems = new Set();
    const items = board.items.map((i) => {
      if (!i || !types.has(i.type)) fail("unknown object type.");
      const itemId = id(i.id);
      if (seenItems.has(itemId)) fail("duplicate object ID.");
      seenItems.add(itemId);
      const result = {
        id: itemId,
        type: i.type,
        x: finite(i.x, "x"),
        y: finite(i.y, "y"),
        width: finite(i.width, "width", true),
        height: finite(i.height, "height", true),
        text: str(i.text ?? "", "text", 100000),
        fill: i.fill ?? "#ffffff",
        stroke: i.stroke ?? "#353846",
        fontSize: finite(i.fontSize ?? 20, "font size", true),
      };
      if (!color.test(result.fill) || !color.test(result.stroke))
        fail("invalid color.");
      if (i.textColor !== undefined) {
        if (typeof i.textColor !== "string" || !color.test(i.textColor))
          fail("invalid text color.");
        result.textColor = i.textColor;
      }
      if (i.points !== undefined) {
        if (
          !Array.isArray(i.points) ||
          i.points.length > 50000 ||
          !i.points.every((p) => Array.isArray(p) && p.length === 2)
        )
          fail("invalid drawing points.");
        result.points = i.points.map((p) => [
          finite(p[0], "point x"),
          finite(p[1], "point y"),
        ]);
      }
      if (
        ["line", "arrow", "draw"].includes(i.type) &&
        (!result.points || result.points.length < 2)
      )
        fail("a path needs at least two points.");
      if (i.type === "image") {
        if (
          typeof i.src !== "string" ||
          i.src.length > 12_000_000 ||
          !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
            i.src,
          )
        )
          fail("images must be embedded PNG, JPEG, WebP, or GIF data.");
        result.src = i.src;
      }
      for (const key of [
        "strokeWidth",
        "fontWeight",
        "opacity",
        "cornerRadius",
        "textPadding",
      ])
        if (i[key] !== undefined) result[key] = finite(i[key], key, true);
      if (i.align !== undefined) {
        if (!["left", "center", "right"].includes(i.align))
          fail("invalid text alignment.");
        result.align = i.align;
      }
      if (i.verticalAlign !== undefined) {
        if (!["top", "middle", "bottom"].includes(i.verticalAlign))
          fail("invalid vertical text alignment.");
        result.verticalAlign = i.verticalAlign;
      }
      if (i.fontFamily !== undefined) {
        if (
          typeof i.fontFamily !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9 _,-]{0,99}$/.test(i.fontFamily)
        )
          fail("invalid font family.");
        result.fontFamily = i.fontFamily;
      }
      for (const key of ["wrap", "underline", "startArrow", "endArrow"]) {
        if (i[key] !== undefined) {
          if (typeof i[key] !== "boolean") fail(`${key} must be a boolean.`);
          result[key] = i[key];
        }
      }
      for (const key of ["startAnchor", "endAnchor"]) {
        if (i[key] !== undefined) {
          const anchor = i[key];
          if (!anchor || typeof anchor !== "object" || Array.isArray(anchor))
            fail("invalid connector anchor.");
          const x = finite(anchor.x, "anchor x"),
            y = finite(anchor.y, "anchor y");
          if (x < 0 || x > 1 || y < 0 || y > 1)
            fail("connector anchors must be between 0 and 1.");
          result[key] = { x, y };
        }
      }
      for (const key of ["locked", "bold", "italic", "dashed"])
        if (i[key] !== undefined) result[key] = Boolean(i[key]);
      for (const key of ["startId", "endId"])
        if (i[key]) result[key] = id(i[key]);
      return result;
    });
    const view = board.view ?? { x: 0, y: 0, zoom: 1 };
    const zoom = finite(view.zoom, "zoom");
    if (zoom < 0.05 || zoom > 10) fail("zoom out of range.");
    return {
      id: boardId,
      name: str(board.name, "board name", 200),
      items,
      view: { x: finite(view.x, "view x"), y: finite(view.y, "view y"), zoom },
      createdAt: str(board.createdAt ?? now(), "createdAt"),
      updatedAt: str(board.updatedAt ?? now(), "updatedAt"),
    };
  });
  return {
    schemaVersion: 1,
    id: id(data.id),
    name: str(data.name, "project name", 200),
    description: str(data.description ?? "", "description", 10000),
    boards,
    createdAt: str(data.createdAt ?? now(), "createdAt"),
    updatedAt: str(data.updatedAt ?? now(), "updatedAt"),
  };
}

export function projectContent(project) {
  return JSON.stringify(validateProject(project));
}

export function loadWorkspace(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    const project = createProject("Creative playground", "welcome");
    project.boards.push(
      createBoard("Ideas & inspiration", "brainstorm"),
      createBoard("Next steps", "kanban"),
    );
    return {
      projects: [project],
      activeProjectId: project.id,
      activeBoardId: project.boards[0].id,
    };
  }
  const data = JSON.parse(raw);
  if (
    !Array.isArray(data.projects) ||
    !data.projects.length ||
    data.projects.length > 200
  )
    throw new Error(
      "Stored workspace is invalid. Export a backup before resetting it.",
    );
  const seen = new Set();
  const projects = data.projects.map((project) => {
    const parsed = validateProject(project);
    if (seen.has(parsed.id)) throw new Error("Duplicate project ID.");
    seen.add(parsed.id);
    if (project.repository) {
      const r = project.repository;
      if (
        typeof r.owner !== "string" ||
        !/^[a-zA-Z0-9-]+$/.test(r.owner) ||
        typeof r.repo !== "string" ||
        !/^[a-zA-Z0-9_.-]+$/.test(r.repo) ||
        typeof r.branch !== "string" ||
        r.branch.length > 255 ||
        typeof r.headSha !== "string" ||
        !/^[a-f0-9]{40,64}$/i.test(r.headSha)
      )
        throw new Error("Stored repository metadata is invalid.");
      parsed.repository = {
        owner: r.owner,
        repo: r.repo,
        branch: r.branch,
        headSha: r.headSha,
        syncedAt: r.syncedAt,
      };
      if (typeof project.lastSyncedContent === "string")
        parsed.lastSyncedContent = project.lastSyncedContent;
    }
    if (project.pendingRepository) {
      const r = project.pendingRepository;
      if (
        typeof r.owner !== "string" ||
        !/^[a-zA-Z0-9-]+$/.test(r.owner) ||
        typeof r.repo !== "string" ||
        !/^[a-zA-Z0-9_.-]+$/.test(r.repo) ||
        typeof r.branch !== "string" ||
        !r.branch ||
        r.branch.length > 255 ||
        /[\u0000-\u001f]/.test(r.branch)
      )
        throw new Error("Stored pending repository metadata is invalid.");
      parsed.pendingRepository = {
        owner: r.owner,
        repo: r.repo,
        branch: r.branch,
      };
    }
    return parsed;
  });
  const activeProject =
    projects.find((p) => p.id === data.activeProjectId) ?? projects[0];
  return {
    projects,
    activeProjectId: activeProject.id,
    activeBoardId:
      activeProject.boards.find((b) => b.id === data.activeBoardId)?.id ??
      activeProject.boards[0].id,
  };
}

export function saveWorkspace(
  projects,
  activeProjectId,
  activeBoardId,
  storage = localStorage,
) {
  const workspace = { projects, activeProjectId, activeBoardId };
  storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  return workspace;
}
