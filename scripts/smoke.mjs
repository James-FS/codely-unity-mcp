#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "server.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codely-mcp-smoke-"));
const project = path.join(temp, "project");
const handshake = path.join(project, "Temp", ".com-unity-codely.json");
fs.mkdirSync(path.dirname(handshake), { recursive: true });

function setPort(port) {
  fs.writeFileSync(handshake, JSON.stringify({ unity_port: port }));
}

function startMcp() {
  const env = { ...process.env };
  delete env.CODELY_UNITY_PROJECT;
  delete env.CODELY_UNITY_PORT;
  const child = spawn(process.execPath, [server, "--project", project], { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let rest = "";
  const messages = new Map();
  const waiters = new Map();
  let protocolError = null;
  child.stdout.on("data", (data) => {
    rest += data.toString();
    const lines = rest.split(/\r?\n/);
    rest = lines.pop();
    for (const line of lines.filter(Boolean)) {
      try {
        const message = JSON.parse(line);
        messages.set(message.id, message);
        waiters.get(message.id)?.(message);
      } catch {
        protocolError = `non-JSON stdout: ${line}`;
      }
    }
  });
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  return {
    child,
    messages,
    get stderr() { return stderr; },
    get protocolError() { return protocolError; },
    send(message) { child.stdin.write(JSON.stringify(message) + "\n"); },
    waitFor(id) {
      if (messages.has(id)) return Promise.resolve(messages.get(id));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`timeout waiting for MCP response ${id}`)), 4000);
        waiters.set(id, (value) => { clearTimeout(timeout); waiters.delete(id); resolve(value); });
      });
    },
    close() { child.kill(); },
  };
}

async function initialize(client) {
  client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  client.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  client.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "bridge_status", arguments: {} } });
  const [init, list, status] = await Promise.all([client.waitFor(1), client.waitFor(2), client.waitFor(3)]);
  if (init.result?.serverInfo?.version !== "1.0.0") throw new Error("initialize returned an unexpected version");
  if (!(list.result?.tools || []).some((tool) => tool.name === "send_raw")) throw new Error("tools/list did not include send_raw");
  return JSON.parse(status.result.content[0].text);
}

function frame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(8);
  header.writeBigUInt64BE(BigInt(payload.length));
  return Buffer.concat([header, payload]);
}

function mockBridge(greeting = "WELCOME UNITY-TCP 1 FRAMING=1 SERVER_VERSION=3\n") {
  let requests = 0;
  const tcpServer = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.write(greeting);
    if (!greeting.includes("WELCOME")) return socket.end();
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const size = Number(buf.readBigUInt64BE(0));
        if (buf.length < 8 + size) break;
        buf = buf.subarray(8 + size);
        requests++;
        socket.write(frame({ success: true, message: "mock editor", data: { request: requests } }));
      }
    });
  });
  return new Promise((resolve) => tcpServer.listen(0, "127.0.0.1", () => resolve({
    server: tcpServer,
    port: tcpServer.address().port,
    get requests() { return requests; },
  })));
}

async function requestEditor(client, id) {
  client.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "manage_editor", arguments: { action: "get_state" } } });
  return client.waitFor(id);
}

try {
  // Project selection must isolate handshake discovery to the selected root.
  const first = await mockBridge();
  const second = await mockBridge();
  const client = startMcp();
  try {
    setPort(first.port);
    const statusA = await initialize(client);
    if (statusA.resolved_port !== first.port) throw new Error("did not use the selected project's handshake file");
    await requestEditor(client, 4);
    setPort(second.port);
    await requestEditor(client, 5);
    if (first.requests !== 1 || second.requests !== 1) throw new Error(`port rotation did not reconnect (counts ${first.requests}/${second.requests})`);
    if (client.protocolError || client.stderr.trim()) throw new Error(client.protocolError || `unexpected stderr: ${client.stderr}`);
    console.log("PASS MCP initialize/tools/status, strict stdio JSON-RPC, and reconnect after handshake port rotation");
  } finally {
    client.close();
    first.server.close();
    second.server.close();
  }

  // A reachable TCP endpoint with the wrong handshake must fail as a tool result without crashing the process.
  const bad = await mockBridge("NOT A CODELY BRIDGE\n");
  const badClient = startMcp();
  try {
    setPort(bad.port);
    await initialize(badClient);
    badClient.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "manage_editor", arguments: { action: "get_state" } } });
    const response = await badClient.waitFor(4);
    if (!response.result?.isError) throw new Error("bad handshake was not reported as an MCP tool error");
    if (badClient.protocolError || badClient.stderr.trim()) throw new Error(badClient.protocolError || `unexpected stderr: ${badClient.stderr}`);
    console.log("PASS invalid Bridge handshake is reported without protocol noise or process crash");
  } finally {
    badClient.close();
    bad.server.close();
  }

  // A refused TCP connection must also be returned cleanly through MCP.
  const unused = net.createServer();
  const refusedPort = await new Promise((resolve) => unused.listen(0, "127.0.0.1", () => {
    const port = unused.address().port;
    unused.close(() => resolve(port));
  }));
  const refusedClient = startMcp();
  try {
    setPort(refusedPort);
    await initialize(refusedClient);
    refusedClient.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "manage_editor", arguments: { action: "get_state" } } });
    const response = await refusedClient.waitFor(4);
    if (!response.result?.isError) throw new Error("refused connection was not reported as an MCP tool error");
    if (refusedClient.protocolError || refusedClient.stderr.trim()) throw new Error(refusedClient.protocolError || `unexpected stderr: ${refusedClient.stderr}`);
    console.log("PASS refused TCP connection is reported without protocol noise or process crash");
  } finally {
    refusedClient.close();
  }
} catch (error) {
  console.error(`FAIL smoke: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
