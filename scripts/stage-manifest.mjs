import fs from "node:fs";

// A package may declare only the platforms it ships, so each archive keeps its own entrypoint.
const [platform] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync("planeai-plugin.json", "utf8"));
const entrypoint = manifest.backend_entrypoints[platform];
if (!entrypoint) throw new Error(`planeai-plugin.json declares no entrypoint for ${platform}`);
manifest.backend_entrypoints = { [platform]: entrypoint };
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
