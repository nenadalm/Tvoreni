import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Marked } from "marked";

const rootdir = path.join(import.meta.dirname, "../..");
const webdir = path.join(import.meta.dirname, "../");
const builddir = path.join(webdir, "build");

function isEventInteresting(e) {
  return e.filename.match(/^(?!web\/build).*\.(md|html)$/) != null;
}

export function debounce(f, ms) {
  let timeoutId = null;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => f(...args), ms);
  };
}

export async function build() {
  console.log("Building...");
  const pageTemplate = await fs.readFile(
    path.join(import.meta.dirname, "../template/page.html"),
    { encoding: "utf-8" }
  );
  const markdown = await fs.readFile(path.join(rootdir, "README.md"), {
    encoding: "utf-8",
  });

  const marked = new Marked();
  const page = pageTemplate.replace(
    "<!-- content:body -->",
    marked.parse(markdown)
  );

  await fs.rm(builddir, { recursive: true, force: true });
  await fs.mkdir(builddir);
  await fs.writeFile(path.join(builddir, "index.html"), page);

  const assets = await Array.fromAsync(fs.glob(path.join(rootdir, "*.jpg")));
  await Promise.all(
    assets.map((s) => fs.cp(s, `${builddir}/${path.basename(s)}`))
  );
  console.log("Bulid finished.");
}

const buildWatched = debounce(build, 50);

export async function watch() {
  buildWatched();
  for await (const e of fs.watch(rootdir, { recursive: true })) {
    if (!isEventInteresting(e)) {
      continue;
    }
    console.log("File changed", e);
    buildWatched();
  }
}
