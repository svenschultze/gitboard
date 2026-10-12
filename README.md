# GitBoard

GitBoard is a Miro-inspired infinite whiteboard that runs entirely in your browser. Organize work into projects with multiple boards, keep working locally, and version each project in a GitHub repository. The application is a static site hosted at [svenschultze.github.io/gitboard](https://svenschultze.github.io/gitboard/). Source: [svenschultze/gitboard](https://github.com/svenschultze/gitboard).

## Run locally

Use Python 3 to serve the static files:

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Open <http://127.0.0.1:5173>. Serving over HTTP is required for JavaScript modules; opening `index.html` directly from disk does not work.

No packages need to be installed. Node.js 22 or newer is needed only for checks and packaging:

```sh
npm test
npm run build
```

`npm run build` creates `dist/` containing only the website. You can serve the packaged site with `python3 -m http.server 5173 --directory dist --bind 127.0.0.1`.

## Work with boards

Create a project, then add as many boards as you need. Start blank or use a brainstorm, kanban, or retrospective template. Rename, duplicate, and delete boards from their board menus. Changes save automatically to the current browser.

Use the canvas tools to add sticky notes, text, rectangles, ellipses, diamonds, frames, arrows, lines, freehand drawings, and raster images. Select objects to move, resize, or change their appearance. Double-click text objects, or press Enter with an object selected, to edit their text. Hold Shift to select multiple objects. Alt-drag duplicates the selected objects.

Pan with the hand tool, Space-drag, middle mouse button, or trackpad scroll. Ctrl-scroll or Alt-scroll zooms around the pointer. Export a board as JSON, SVG, or PNG, or export a whole project as JSON. Use **Import** to bring in a project or board JSON file, or a draw.io diagram. Images are embedded in board data rather than linked to external hosts.

| Action                          | Shortcut                                  |
| ------------------------------- | ----------------------------------------- |
| Select / hand                   | V / H                                     |
| Sticky note / text              | N / T                                     |
| Rectangle / ellipse / diamond   | R / O / D                                 |
| Line / arrow / freehand / frame | L / A / P / F                             |
| Select all                      | Ctrl/Cmd+A                                |
| Copy / cut / paste / duplicate  | Ctrl/Cmd+C / X / V / D                    |
| Undo / redo                     | Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z (or Ctrl+Y) |
| Delete selected objects         | Delete or Backspace                       |
| Edit selected text              | Enter                                     |
| Finish / cancel text editing    | Ctrl/Cmd+Enter / Escape                   |
| Nudge selection                 | Arrow keys (Shift for 10 pixels)          |
| Fit all content / 100% zoom     | 1 / 0                                     |

## Import draw.io diagrams

Choose **Import → draw.io diagram** and select a `.drawio` or `.xml` file exported by diagrams.net/draw.io. Compressed and uncompressed files are supported, including files with multiple pages and standalone `mxGraphModel` XML. Each page becomes a new board in your current project; your existing boards stay in place.

Imported shapes, labels, lines, arrows, and embedded raster images become editable GitBoard objects. Nested group positions, connector waypoints, colors, font sizes, text alignment, and common shape styles are preserved. HTML labels are converted to plain text. Import notices describe unsupported content; external image URLs and SVG images are omitted. Some specialized draw.io shapes and advanced styles are approximated with GitBoard's available shapes.

Once imported, boards save locally and can be exported as GitBoard JSON or committed to the project's GitHub repository. GitBoard does not export back to draw.io format.

## Host on GitHub Pages

The deployment below also works for your own fork or repository.

The app repository hosts the website. Project repositories hold your board data, and can be separate private repositories.

1. Create a GitHub repository for this source code, for example `git-board`, with `main` as its default branch.
2. Push this directory to that repository. If the directory is not already a Git checkout, run:

   ```sh
   git init -b main
   git add .
   git commit -m "Add GitBoard"
   git remote add origin https://github.com/YOUR-USERNAME/git-board.git
   git push -u origin main
   ```

3. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
4. Open **Actions → Deploy GitBoard to GitHub Pages** and use **Run workflow** if the initial push happened before Pages was configured.
5. Wait for the workflow to finish. Its deployment links to `https://YOUR-USERNAME.github.io/git-board/`.

Subsequent pushes to `main` run checks and deploy automatically. If you use a different default branch, change `branches: [main]` in `.github/workflows/pages.yml`. For a user site, name the app repository `YOUR-USERNAME.github.io`; the app also works at the domain root. Assets use relative URLs, so project Pages paths require no base-path configuration.

The workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Deployment uses the workflow's GitHub token; it does not require an app user's personal access token. The deployed artifact excludes tests, documentation, Git metadata, and any project repositories.

## Connect GitHub

GitHub authentication uses a personal access token because the site has no server to exchange OAuth credentials. The token stays in JavaScript memory for the current tab and is discarded when the page reloads. It is never written to browser storage, downloaded project files, or repository files.

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) for the owner of your project repository:

- **Existing repository:** select that repository and grant **Contents: Read and write**. Metadata read access is included by GitHub.
- **Create a repository from GitBoard:** also grant **Administration: Read and write**. The token must be able to access the new repository; choose an account-wide repository selection for this flow, or create the repository on GitHub first and use a token restricted to that repository.

GitHub documents these permissions for [Git references](https://docs.github.com/en/rest/git/refs#update-a-reference) and [creating a repository for the authenticated user](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user). Organization policy may require token approval. Leave the Organization field empty to create a repository under your personal account, or enter an organization where you can create repositories. Organization policy and token permissions still apply.

## Repository format

Each project lives in one repository. All its boards are saved together in one Git commit:

```text
gitboard/
  project.json
  boards/
    BOARD-ID.json
    ANOTHER-BOARD-ID.json
```

`project.json` records the project schema version, identity, name, description, timestamps, and board manifest. Each board file contains its identity, title, items, view position, zoom, and timestamps. The files are ordinary UTF-8 JSON and can be inspected in GitHub or cloned with Git. GitBoard preserves unrelated files in an existing repository.

Commits are explicit. Editing saves to the current browser; commit when you want to publish changes to GitHub. Pull when you want to load the repository version. GitBoard checks the remote revision and updates the branch without force-pushing, so concurrent repository changes are reported instead of silently overwritten. Pulling replaces the local project with the remote version. If you have local changes, the pull dialog downloads a JSON backup before replacing them. You can also export or commit local work first.

## Storage and scope

Workspaces are saved to the browser's local storage. They survive reloads on that browser and origin. They are not automatically shared with another device; use a project export or GitHub to move work between browsers. Large embedded images can exceed browser storage quotas, so use appropriately sized images and commit or export work regularly.

This is a standalone whiteboard implementation, not a complete reproduction of Miro's service. Collaboration uses Git commits and pulls. Live multiplayer cursors, simultaneous editing, organization membership, comments, voting, and Miro file compatibility are not implemented.

## Source and validation

The site uses native JavaScript modules, HTML, CSS, and an SVG canvas, with no production dependencies.

- `js/app.js` — workspace navigation, dialogs, project and board management.
- `js/editor.js` — canvas interaction and rendering.
- `js/model.js` — portable project schema, templates, validation, local persistence.
- `js/github.js` — GitHub REST API integration and project synchronization.
- `js/drawio.js` — draw.io XML decoding and conversion to editable board objects.
- `tests/` — Node's built-in test runner, including import validation and mocked GitHub requests.
- `.github/workflows/checks.yml` — syntax checks and tests for pushes and pull requests.
- `.github/workflows/pages.yml` — checked static site deployment.

Run `npm test` after changes. To syntax-check all app modules:

```sh
for file in js/*.js; do node --check "$file"; done
```

The GitHub tests mock HTTP requests; they do not create repositories or require a token. A live GitHub integration check requires your own account and a project repository.

The optional browser suite verifies editor interactions, exports/imports, mobile layout, and GitHub creation/commit/pull using intercepted HTTP requests. With the local server running on port 4173:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.mjs
```

Set `GITBOARD_URL` to test another running server. `GITBOARD_BROWSER_PATH` can select an existing Chrome executable, and `GITBOARD_PLAYWRIGHT_MODULE` can point to an externally installed Playwright module. No real GitHub account or token is used by this suite.

The draw.io browser suite exercises XML parsing, compressed multipage imports, editable objects, persistence, and portable exports:

```sh
node tests/drawio.browser.mjs
```

It uses the same browser environment variables as the main suite. Set `GITBOARD_DRAWIO_EXAMPLE` to the local 18-panel reference diagram to verify its 777 objects without storing that file in this repository. Optional `GITBOARD_DRAWIO_SCREENSHOT` and `GITBOARD_DRAWIO_DETAIL_SCREENSHOT` paths capture the imported board and a closer view. `GITBOARD_DRAWIO_BOARD_JSON` saves a converted board JSON file to the supplied path.
