import { projectContent, validateProject } from "./model.js";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const PROJECT_PATH = "gitboard/project.json";
const BOARDS_PATH = "gitboard/boards";

export class GitHubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export class GitHubConflictError extends GitHubError {
  constructor(
    message = "This repository changed on GitHub. Pull the latest project before pushing your changes.",
    status = 409,
  ) {
    super(message, status);
    this.name = "GitHubConflictError";
  }
}

function segment(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("/") ||
    /[\u0000-\u001f]/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new GitHubError(`Enter a valid GitHub ${label}.`);
  }
  return encodeURIComponent(value.trim());
}

function repositoryPath(owner, repo) {
  return `/repos/${segment(owner, "owner")}/${segment(repo, "repository name")}`;
}

function branchSegment(branch) {
  if (
    typeof branch !== "string" ||
    !branch.trim() ||
    /[\u0000-\u001f]/.test(branch)
  ) {
    throw new GitHubError(
      "The repository has no usable branch. Initialize it with a README on GitHub first.",
    );
  }
  return encodeURIComponent(branch);
}

function boardId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new GitHubError(
      "A board has an invalid ID. Board IDs may contain letters, numbers, underscores, and hyphens.",
    );
  }
  return id;
}

function decodeContent(file, path) {
  if (file.encoding === "utf-8" || file.encoding === "utf8")
    return file.content;
  if (file.encoding !== "base64" || typeof file.content !== "string") {
    throw new GitHubError(
      `GitHub did not return readable content for ${path}.`,
    );
  }
  try {
    const bytes = Uint8Array.from(
      atob(file.content.replace(/\s/g, "")),
      (char) => char.charCodeAt(0),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubError(`${path} contains invalid UTF-8 data.`);
  }
}

function jsonFile(file, path) {
  try {
    return JSON.parse(decodeContent(file, path));
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    throw new GitHubError(
      `${path} is not valid JSON. Repair the file in GitHub before importing it.`,
    );
  }
}

function checkManifest(manifest) {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.id !== "string" ||
    typeof manifest.name !== "string" ||
    !Array.isArray(manifest.boards) ||
    !manifest.boards.length ||
    manifest.boards.length > 200
  ) {
    throw new GitHubError(
      "This repository has an invalid GitBoard project manifest. Expected schemaVersion 1 and between 1 and 200 boards.",
    );
  }
  const ids = new Set();
  for (const board of manifest.boards) {
    boardId(board?.id);
    if (ids.has(board.id))
      throw new GitHubError(
        "The GitBoard project manifest contains duplicate board IDs.",
      );
    ids.add(board.id);
  }
  return manifest;
}

async function readBoards(boards, read) {
  const results = new Array(boards.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, boards.length) }, async () => {
      while (next < boards.length) {
        const index = next++;
        results[index] = await read(boards[index]);
      }
    }),
  );
  return results;
}

function errorMessage(status, body, headers) {
  const detail = typeof body?.message === "string" ? body.message : "";
  if (status === 401)
    return "GitHub rejected your token. Reconnect with a valid, unexpired personal access token.";
  if (status === 403 || status === 429) {
    if (
      status === 429 ||
      headers.get("x-ratelimit-remaining") === "0" ||
      /rate limit/i.test(detail)
    ) {
      const retry = Number(headers.get("retry-after"));
      const reset = Number(headers.get("x-ratelimit-reset"));
      const seconds =
        retry > 0
          ? retry
          : reset > 0
            ? Math.max(1, reset - Math.floor(Date.now() / 1000))
            : 0;
      return `GitHub's API rate limit was reached. ${seconds ? `Try again in about ${Math.ceil(seconds / 60)} minute(s).` : "Wait a few minutes before trying again."}`;
    }
    return `GitHub denied access. Give your token access to this repository and Contents read/write permissions. Repository creation also requires Administration or Repository creation write access; organizations may require SSO approval.${detail ? ` GitHub: ${detail}` : ""}`;
  }
  if (status === 404)
    return "GitHub could not find that repository or resource. Check the owner, repository, branch, and token access.";
  if (status === 422)
    return `GitHub could not accept this change. Check the repository name, token permissions, and branch rules.${detail ? ` GitHub: ${detail}` : ""}`;
  if (status === 409)
    return `GitHub reported a repository conflict. Pull the latest project and check that the branch is initialized.${detail ? ` GitHub: ${detail}` : ""}`;
  if (status >= 500)
    return "GitHub is temporarily unavailable. Your local project is safe; try syncing again shortly.";
  return `GitHub request failed (${status}).${detail ? ` ${detail}` : " Try again."}`;
}

/** Browser-only GitHub REST client. Tokens stay in memory and only go to api.github.com. */
export class GitHubClient {
  #token;
  #fetch;

  constructor(token = "", fetchImpl = globalThis.fetch) {
    this.#token = typeof token === "string" ? token.trim() : "";
    if (typeof fetchImpl !== "function")
      throw new GitHubError("This browser cannot connect to GitHub.");
    // Native browser fetch requires the Window receiver, even when stored privately.
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async #request(path, { method = "GET", body } = {}) {
    const url = new URL(path, API_ROOT);
    if (url.origin !== API_ROOT || url.username || url.password)
      throw new GitHubError(
        "Refusing a GitHub request outside api.github.com.",
      );
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.#fetch(url.href, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new GitHubError(
        "Could not reach GitHub. Check your connection, then try again.",
      );
    }
    let data = null;
    if (response.status !== 204) {
      try {
        data = await response.json();
      } catch {
        if (response.ok)
          throw new GitHubError(
            "GitHub returned an unreadable response. Try again.",
          );
      }
    }
    if (!response.ok)
      throw new GitHubError(
        errorMessage(response.status, data, response.headers),
        response.status,
      );
    return { data, headers: response.headers };
  }

  async getUser() {
    return (await this.#request("/user")).data;
  }

  async listRepositories() {
    const repositories = [];
    const seen = new Set();
    let next = `${API_ROOT}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`;
    while (next) {
      if (seen.has(next))
        throw new GitHubError(
          "GitHub returned an invalid pagination link. Try again.",
        );
      seen.add(next);
      const { data, headers } = await this.#request(next);
      if (!Array.isArray(data))
        throw new GitHubError("GitHub returned an invalid repository list.");
      repositories.push(...data);
      const match = (headers.get("link") || "").match(
        /<([^>]+)>;\s*rel="next"/,
      );
      next = match?.[1] || null;
      if (next) {
        const url = new URL(next, API_ROOT);
        if (url.origin !== API_ROOT || url.pathname !== "/user/repos")
          throw new GitHubError("GitHub returned an invalid pagination link.");
      }
    }
    return repositories;
  }

  async getRepository(owner, repo) {
    return (await this.#request(repositoryPath(owner, repo))).data;
  }

  async createRepository({
    name,
    description = "",
    private: isPrivate = false,
    organization,
  } = {}) {
    segment(name, "repository name");
    const path = organization
      ? `/orgs/${segment(organization, "organization")}/repos`
      : "/user/repos";
    return (
      await this.#request(path, {
        method: "POST",
        body: {
          name: name.trim(),
          description,
          private: Boolean(isPrivate),
          auto_init: true,
        },
      })
    ).data;
  }

  async #head(path, branch) {
    const { data } = await this.#request(
      `${path}/git/ref/heads/${branchSegment(branch)}`,
    );
    if (data?.object?.type !== "commit" || !data.object.sha)
      throw new GitHubError("GitHub returned an invalid branch reference.");
    return data.object.sha;
  }

  async #file(path, filename, headSha) {
    const { data } = await this.#request(
      `${path}/contents/${filename}?ref=${encodeURIComponent(headSha)}`,
    );
    if (data?.type !== "file")
      throw new GitHubError(`${filename} must be a regular JSON file.`);
    let file = data;
    // The Contents API omits base64 data above 1 MB. The Git Blobs API preserves it.
    if (
      (file.encoding !== "base64" || typeof file.content !== "string") &&
      file.sha
    ) {
      file = (
        await this.#request(`${path}/git/blobs/${encodeURIComponent(file.sha)}`)
      ).data;
    }
    return jsonFile(file, filename);
  }

  async readProject({ owner, repo, branch } = {}) {
    const path = repositoryPath(owner, repo);
    const repository = await this.getRepository(owner, repo);
    branch ||= repository.default_branch;
    const headSha = await this.#head(path, branch);
    let manifest;
    try {
      manifest = checkManifest(await this.#file(path, PROJECT_PATH, headSha));
    } catch (error) {
      if (error.status === 404)
        throw new GitHubError(
          "This repository does not contain a GitBoard project (gitboard/project.json). Choose a GitBoard repository or create a new project repository.",
          404,
        );
      throw error;
    }
    const boards = await readBoards(manifest.boards, async ({ id }) => {
      let board;
      try {
        board = await this.#file(path, `${BOARDS_PATH}/${id}.json`, headSha);
      } catch (error) {
        if (error.status === 404)
          throw new GitHubError(
            `Board ${id} is listed in the project manifest but its JSON file is missing. Repair the repository before importing it.`,
            404,
          );
        throw error;
      }
      if (board?.id !== id)
        throw new GitHubError(
          `Board ${id} does not match its file. Repair the repository before importing it.`,
        );
      return board;
    });
    let project;
    try {
      project = validateProject({ ...manifest, boards });
    } catch (error) {
      throw new GitHubError(
        `The repository's project data is invalid. ${error.message}`,
      );
    }
    project.repository = {
      owner: repository.owner?.login || owner,
      repo: repository.name || repo,
      branch,
      headSha,
      syncedAt: new Date().toISOString(),
    };
    project.lastSyncedContent = projectContent(project);
    return project;
  }

  async #tree(path, sha) {
    const { data } = await this.#request(
      `${path}/git/trees/${encodeURIComponent(sha)}`,
    );
    if (!Array.isArray(data?.tree) || data.truncated)
      throw new GitHubError(
        "GitHub returned an incomplete repository tree. Sync was stopped to protect existing files.",
      );
    return data.tree;
  }

  async pushProject(project, message = "Update GitBoard project") {
    validateProject(project);
    const portable = JSON.parse(projectContent(project));
    const connection = project.repository;
    if (!connection)
      throw new GitHubError(
        "Connect this project to a GitHub repository before pushing.",
      );
    const { owner, repo } = connection;
    const path = repositoryPath(owner, repo);
    const branch =
      connection.branch ||
      (await this.getRepository(owner, repo)).default_branch;
    const headSha = await this.#head(path, branch);
    if (connection.headSha && connection.headSha !== headSha)
      throw new GitHubConflictError();
    const commit = (
      await this.#request(`${path}/git/commits/${encodeURIComponent(headSha)}`)
    ).data;
    if (!commit?.tree?.sha)
      throw new GitHubError("GitHub returned an invalid commit tree.");
    const rootTree = await this.#tree(path, commit.tree.sha);
    const directory = rootTree.find((entry) => entry.path === "gitboard");
    if (directory && directory.type !== "tree")
      throw new GitHubError(
        "The repository contains a file named gitboard. Rename it before connecting this project.",
      );
    const projectTree = directory ? await this.#tree(path, directory.sha) : [];
    const hasManifest = projectTree.some(
      (entry) => entry.path === "project.json",
    );
    if (hasManifest) {
      if (!connection.headSha)
        throw new GitHubConflictError(
          "This repository already contains a GitBoard project. Import it before pushing changes.",
        );
      const remote = checkManifest(
        await this.#file(path, PROJECT_PATH, headSha),
      );
      if (remote.id !== portable.id)
        throw new GitHubConflictError(
          "This repository contains a different GitBoard project. Import that project or create a new repository.",
        );
    }
    const boardsDirectory = projectTree.find(
      (entry) => entry.path === "boards",
    );
    if (boardsDirectory && boardsDirectory.type !== "tree")
      throw new GitHubError(
        "gitboard/boards must be a directory. Repair the repository before syncing.",
      );
    if (boardsDirectory && !hasManifest)
      throw new GitHubError(
        "This repository has a gitboard/boards directory without a project manifest. Repair it or choose a new repository; existing board files were not changed.",
      );
    const oldBoards = boardsDirectory
      ? await this.#tree(path, boardsDirectory.sha)
      : [];
    const manifest = {
      schemaVersion: 1,
      id: portable.id,
      name: portable.name,
      description: portable.description || "",
      createdAt: portable.createdAt,
      updatedAt: portable.updatedAt,
      boards: portable.boards.map((board) => ({
        id: boardId(board.id),
        name: board.name,
      })),
    };
    const entries = [
      {
        path: PROJECT_PATH,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(manifest, null, 2) + "\n",
      },
    ];
    const filenames = new Set();
    for (const board of portable.boards) {
      const filename = `${boardId(board.id)}.json`;
      filenames.add(filename);
      entries.push({
        path: `${BOARDS_PATH}/${filename}`,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(board, null, 2) + "\n",
      });
    }
    for (const old of oldBoards) {
      if (
        old.type === "blob" &&
        old.path.endsWith(".json") &&
        !filenames.has(old.path)
      )
        entries.push({
          path: `${BOARDS_PATH}/${old.path}`,
          mode: old.mode || "100644",
          type: "blob",
          sha: null,
        });
    }
    const tree = (
      await this.#request(`${path}/git/trees`, {
        method: "POST",
        body: { base_tree: commit.tree.sha, tree: entries },
      })
    ).data;
    if (!tree?.sha)
      throw new GitHubError(
        "GitHub did not return the new tree. The branch was not changed.",
      );
    const newCommit = (
      await this.#request(`${path}/git/commits`, {
        method: "POST",
        body: {
          message: String(message || "Update GitBoard project"),
          tree: tree.sha,
          parents: [headSha],
        },
      })
    ).data;
    if (!newCommit?.sha)
      throw new GitHubError(
        "GitHub did not return the new commit. The branch was not changed.",
      );
    try {
      await this.#request(`${path}/git/refs/heads/${branchSegment(branch)}`, {
        method: "PATCH",
        body: { sha: newCommit.sha, force: false },
      });
    } catch (error) {
      if (error.status === 409 || error.status === 422)
        throw new GitHubConflictError(
          `GitHub could not update this branch. It may have changed during the push or its rules prevent direct updates. Pull the latest project and check branch rules. ${error.message}`,
          error.status,
        );
      throw error;
    }
    return {
      owner,
      repo,
      branch,
      headSha: newCommit.sha,
      syncedAt: new Date().toISOString(),
    };
  }
}
