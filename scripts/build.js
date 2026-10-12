import { mkdir, copyFile, cp, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await copyFile("index.html", "dist/index.html");
await cp("js", "dist/js", { recursive: true });
await cp("css", "dist/css", { recursive: true });
await cp("assets", "dist/assets", { recursive: true });
await copyFile(".nojekyll", "dist/.nojekyll");
console.log("Static GitHub Pages site ready in dist/");
