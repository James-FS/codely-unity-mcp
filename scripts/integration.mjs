#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function projectArgument() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--project");
  return index >= 0 ? args[index + 1] : process.env.CODELY_UNITY_PROJECT;
}

const project = projectArgument();
if (!project) {
  console.error('Usage: node scripts/integration.mjs --project "<Unity project root>"');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [path.join(root, "server.mjs"), "--project", path.resolve(project)], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});
let tail = "";
let stderr = "";
let protocolError = null;
const responses = new Map();
const waiters = new Map();

child.stdout.on("data", (chunk) => {
  tail += chunk.toString();
  const lines = tail.split(/\r?\n/);
  tail = lines.pop();
  for (const line of lines.filter(Boolean)) {
    try {
      const message = JSON.parse(line);
      responses.set(message.id, message);
      waiters.get(message.id)?.(message);
    } catch {
      protocolError = `non-JSON stdout: ${line}`;
    }
  }
});
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

function waitFor(id) {
  if (responses.has(id)) return Promise.resolve(responses.get(id));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for MCP response ${id}`)), 10_000);
    waiters.set(id, (message) => { clearTimeout(timer); waiters.delete(id); resolve(message); });
  });
}

try {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "codely-unity-integration", version: "1.0.0" } } });
  const init = await waitFor(1);
  if (init.error) throw new Error(init.error.message || "MCP initialize failed");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "bridge_status", arguments: {} } });
  const bridgeReply = await waitFor(2);
  const bridge = JSON.parse(bridgeReply.result.content[0].text);
  if (!(bridge.unity_port > 0) || bridge.reason !== "ready") throw new Error(`Bridge not ready: ${JSON.stringify(bridge)}`);
  console.log(`PASS bridge_status: ready on port ${bridge.unity_port}`);

  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "manage_editor", arguments: { action: "get_state" } } });
  const editorReply = await waitFor(3);
  if (editorReply.result?.isError) throw new Error(editorReply.result.content?.[0]?.text || "manage_editor get_state failed");
  const outer = JSON.parse(editorReply.result.content[0].text);
  const editor = outer?.data?.data;
  if (outer?.success !== true || !editor) throw new Error("manage_editor returned no successful editor state");
  console.log(`PASS manage_editor get_state: play=${editor.isPlaying}, compiling=${editor.isCompiling}, updating=${editor.isUpdating}`);
  if (protocolError || stderr.trim()) throw new Error(protocolError || `unexpected server stderr: ${stderr}`);
} catch (error) {
  console.error(`FAIL integration: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  child.kill();
}
