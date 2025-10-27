import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Marked } from "marked";
import { spawn as _spawn } from "node:child_process";
import * as crypto from "node:crypto";
import { pipeline } from "node:stream/promises";

const rootdir = path.join(import.meta.dirname, "../..");
const webdir = path.join(import.meta.dirname, "../");
const builddir = path.join(webdir, "build");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptionsWithoutStdio} options
 *
 * @returns {Promise}
 */
function spawn(command, args, options) {
  return new Promise((resolve, reject) => {
    const res = _spawn(command, args, options);

    res.on("close", (code) => (code === 0 ? resolve() : reject()));
  });
}

async function fileHash(path) {
  const f = await fs.open(path);
  const hash = crypto.createHash("sha1");
  hash.setEncoding("hex");

  await pipeline(f.createReadStream(), hash);

  return hash.read();
}
const srcsRegexp = /(?<=src *= *")(?<src>.*?)(?=")/g;

async function hashAssets(page) {
  const srcs = Array.from(page.matchAll(srcsRegexp)).map((g) => g.groups.src);

  const versionedSrcs = Object.fromEntries(
    await Promise.all(
      srcs.map(async (src) => [
        src,
        `${src}?v=${await fileHash(`${builddir}/${src}`)}`,
      ])
    )
  );

  return page.replace(/<img[^>]*>/g, function (img) {
    return img.replace(srcsRegexp, function (src) {
      return versionedSrcs[src] ?? src;
    });
  });
}

/**
 * @param {string} src
 * @param {string} dest
 */
async function copyFile(src, dest) {
  if (src.endsWith(".jpg")) {
    await spawn("magick", [
      src,
      "-auto-orient",
      "-strip",
      "-quality",
      "80",
      dest,
    ]);
    return;
  }

  await fs.cp(src, dest);
}

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

  await fs.rm(builddir, { recursive: true, force: true });
  await fs.mkdir(builddir);
  const assets = await Array.fromAsync(fs.glob(path.join(rootdir, "*.jpg")));
  await Promise.all(
    assets.map((s) => copyFile(s, `${builddir}/${path.basename(s)}`))
  );

  const marked = new Marked();
  const page = await hashAssets(
    pageTemplate.replace("<!-- content:body -->", marked.parse(markdown))
  );
  await fs.writeFile(path.join(builddir, "index.html"), page);

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
