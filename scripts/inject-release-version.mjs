import fs from "node:fs";

const [tag] = process.argv.slice(2);
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error("usage: node scripts/inject-release-version.mjs v<major>.<minor>.<patch>");
}

const version = tag.slice(1);
const rewriteJsonVersion = (path) => {
  const document = JSON.parse(fs.readFileSync(path, "utf8"));
  if (document.version !== "0.0.0") {
    throw new Error(`expected ${path} to contain the 0.0.0 release-version placeholder`);
  }
  document.version = version;
  fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
};
const replaceExactlyOnce = (path, pattern, replacement) => {
  const source = fs.readFileSync(path, "utf8");
  if ([...source.matchAll(new RegExp(pattern.source, "g"))].length !== 1) {
    throw new Error(`expected exactly one release-version placeholder in ${path}`);
  }
  fs.writeFileSync(path, source.replace(pattern, replacement));
};

rewriteJsonVersion("package.json");
rewriteJsonVersion("planeai-plugin.json");
replaceExactlyOnce(
  "src/routines.ts",
  /export const PLUGIN_VERSION = "0\.0\.0";/,
  `export const PLUGIN_VERSION = "${version}";`,
);

console.log(`Injected release version ${version}`);
