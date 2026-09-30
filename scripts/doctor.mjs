#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

function option(name) {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1] || null;
}

const projectInput = option("--project") || process.env.CODELY_UNITY_PROJECT;
if (!projectInput) {
  console.error("FAIL project: pass --project <project-root> or set CODELY_UNITY_PROJECT");
  process.exit(2);
}
const project = path.resolve(projectInput);
const host = process.env.CODELY_UNITY_HOST || "127.0.0.1";
const timeoutMs = Number(process.env.CODELY_UNITY_CONNECT_TIMEOUT_MS || 5000);

function report(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${detail}`);
}

const isDirectory = fs.existsSync(project) && fs.statSync(project).isDirectory();
report("project", isDirectory, project);
if (!isDirectory) process.exit(1);
const hasAssets = fs.existsSync(path.join(project, "Assets")) && fs.statSync(path.join(project, "Assets")).isDirectory();
report("Assets", hasAssets, hasAssets ? "directory found" : "not found; this may not be an editor project root");

let bridgeVersion = null;
for (const relative of ["Packages/packages-lock.json", "Packages/manifest.json"]) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(project, relative), "utf8"));
    const packages = manifest.dependencies || {};
    const entry = Object.entries(packages).find(([name]) => /codely\.bridge/i.test(name));
    if (entry) {
      bridgeVersion = typeof entry[1] === "string" ? entry[1] : entry[1]?.version || null;
      if (bridgeVersion) break;
    }
  } catch { /* the other manifest may still contain package metadata */ }
}
console.log(`INFO Codely Bridge package: ${bridgeVersion || "version not found in project manifests"}`);

const candidates = [
  path.join(project, "Temp", ".com-unity-codely.json"),
  path.join(project, ".com-unity-codely.json"),
];
let record = null;
let handshakeFile = null;
for (const file of candidates) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number.isInteger(Number(value?.unity_port))) {
      record = value;
      handshakeFile = file;
      break;
    }
  } catch { /* try the next supported location */ }
}

let port = Number(process.env.CODELY_UNITY_PORT || record?.unity_port || 0);
const validPort = Number.isInteger(port) && port > 0 && port <= 65535;
report("handshake file", !!handshakeFile || !!process.env.CODELY_UNITY_PORT, handshakeFile || (process.env.CODELY_UNITY_PORT ? "using CODELY_UNITY_PORT override" : "not found or invalid JSON"));
report("TCP port", validPort, validPort ? `${host}:${port}` : "unity_port is missing, zero, or outside 1..65535");
if (!validPort) process.exit(1);

const socket = net.connect({ host, port });
let buffer = Buffer.alloc(0);
let finished = false;
const timer = setTimeout(() => finish(false, `no Bridge handshake within ${timeoutMs} ms`), timeoutMs);
socket.on("connect", () => {});
socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  const newline = buffer.indexOf(0x0a);
  if (newline < 0) {
    if (buffer.length > 512) finish(false, "handshake line exceeds 512 bytes");
    return;
  }
  const line = buffer.subarray(0, newline).toString("ascii").trim();
  finish(/WELCOME/i.test(line) && /FRAMING=1/i.test(line), line || "empty handshake");
});
socket.on("error", (error) => finish(false, `${error.code || "TCP error"}: ${error.message}`));

function finish(ok, detail) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  socket.destroy();
  report("Bridge TCP handshake", ok, detail);
  if (ok && !hasAssets) process.exitCode = 1;
  else process.exitCode = ok ? 0 : 1;
}
