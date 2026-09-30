#!/usr/bin/env node
/**
 * Codely Unity Bridge → MCP adapter (stdio → TCP).
 *
 * Protocol (from cn.tuanjie.codely.bridge):
 *   1. TCP connect to localhost:<unity_port>
 *   2. Server sends one ASCII line: "WELCOME UNITY-TCP 1 FRAMING=1 SERVER_VERSION=3\n"
 *      (older builds: "WELCOME Codely-Bridge 1 FRAMING=1")
 *   3. After handshake every message is: 8-byte big-endian uint64 length + UTF-8 JSON
 *   4. Request:  { "type": "<command>", "params": { "action"?: "...", ... } }
 *   5. Response: { "success": bool, "message": string, "data"?: any, "code"?: string, "error"?: string }
 *
 * Port file (heartbeat / handshake registry):
 *   <UnityProject>/Temp/.com-unity-codely.json   (bridge 1.0.81+)
 *   <UnityProject>/.com-unity-codely.json        (legacy / project-root copy)
 *   Fields: { "unity_port": number, ... }  — unity_port <= 0 means not connected.
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HOST = process.env.CODELY_UNITY_HOST || "127.0.0.1";
function readProjectArg() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--project");
  if (index >= 0) {
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error("--project 后必须提供 Unity/团结工程目录");
    }
    return path.resolve(args[index + 1]);
  }
  return process.env.CODELY_UNITY_PROJECT
    ? path.resolve(process.env.CODELY_UNITY_PROJECT)
    : null;
}
const PROJECT = readProjectArg();
const DEFAULT_TIMEOUT_MS = Number(process.env.CODELY_UNITY_TIMEOUT_MS || 60_000);
const CONNECT_TIMEOUT_MS = Number(process.env.CODELY_UNITY_CONNECT_TIMEOUT_MS || 5_000);
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const CLIENT_VERSION = 2; // advertise for notifications; harmless if ignored

// ---------------------------------------------------------------------------
// Port discovery
// ---------------------------------------------------------------------------

function readPortFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const port = Number(raw?.unity_port);
    return Number.isInteger(port) ? { port, file, raw } : null;
  } catch {
    return null;
  }
}

function resolvePort() {
  const envPort = Number(process.env.CODELY_UNITY_PORT || 0);
  if (Number.isInteger(envPort) && envPort > 0) {
    return { port: envPort, file: "env:CODELY_UNITY_PORT", raw: null };
  }
  if (!PROJECT) return null;
  const project = PROJECT;
  const candidates = [
    path.join(project, "Temp", ".com-unity-codely.json"),
    path.join(project, ".com-unity-codely.json"),
  ];
  const seen = new Set();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    const hit = readPortFile(file);
    if (hit) return hit;
  }
  return null;
}

function readHeartbeat() {
  if (!PROJECT) return null;
  const project = PROJECT;
  const files = [
    path.join(project, "Temp", ".com-unity-codely.json"),
    path.join(project, ".com-unity-codely.json"),
  ];
  for (const file of files) {
    const hit = readPortFile(file);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TCP client (length-prefixed JSON frames)
// ---------------------------------------------------------------------------

class UnityBridgeClient {
  constructor() {
    this.socket = null;
    this.recvBuf = Buffer.alloc(0);
    this.pending = []; // { resolve, reject, timer }
    this.hello = null;
    this.port = null;
    this.lock = Promise.resolve();
  }

  get connected() {
    return !!this.socket && !this.socket.destroyed;
  }

  async ensureConnected() {
    const info = resolvePort();
    if (this.connected && this.port === info?.port) return;
    if (this.connected) this.destroy();
    if (!info || !(info.port > 0)) {
      const hb = readHeartbeat();
      const reason = hb
        ? `unity_port=${hb.raw?.unity_port} (未连接/桥未启动). 文件: ${hb.file}`
        : !PROJECT
          ? "未配置工程目录。请通过 --project 或 CODELY_UNITY_PROJECT 指定目标工程。"
            : `未找到握手文件（工程目录：${PROJECT}）。请确认目录是目标工程，已安装 Codely Bridge，并在编辑器中连接。`;
      throw new Error(`Unity Codely Bridge 不可用: ${reason}`);
    }
    await this._connect(info.port);
  }

  _connect(port) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: HOST, port });
      let settled = false;
      let timer;
      let onData;
      let onClose;
      const onFail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (onData) sock.off("data", onData);
        sock.off("error", onFail);
        if (onClose) sock.off("close", onClose);
        sock.destroy();
        if (this.socket === sock) {
          this.socket = null;
          this.port = null;
          this.recvBuf = Buffer.alloc(0);
          this.hello = null;
        }
        reject(
          new Error(
            `连接 ${HOST}:${port} 失败: ${err?.message || err}. ` +
              `确认团结编辑器已打开且 unity_port 有效。`
          )
        );
      };
      timer = setTimeout(
        () => onFail(new Error(`connect timeout ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS
      );

      let handshakeBuf = Buffer.alloc(0);
      let handshakeDone = false;

      onData = (chunk) => {
        if (!handshakeDone) {
          handshakeBuf = Buffer.concat([handshakeBuf, chunk]);
          const nl = handshakeBuf.indexOf(0x0a);
          if (nl < 0) {
            if (handshakeBuf.length > 512) onFail(new Error("handshake too long"));
            return;
          }
          const line = handshakeBuf.subarray(0, nl).toString("ascii").trim();
          const rest = handshakeBuf.subarray(nl + 1);
          if (!/WELCOME/i.test(line) || !/FRAMING=1/i.test(line)) {
            onFail(new Error(`意外握手: ${line}`));
            return;
          }
          settled = true;
          clearTimeout(timer);
          sock.off("error", onFail);
          if (onClose) sock.off("close", onClose);
          handshakeDone = true;
          this.hello = line;
          // Do NOT send CLIENT_VERSION plain line: bridge 3.x (WELCOME UNITY-TCP)
          // resets the socket on it. Framed traffic alone is enough.
          sock.off("data", onData);
          sock.on("data", (c) => this._onFrameData(c));
          // Keep a persistent error handler after handshake — otherwise
          // ECONNRESET becomes an unhandled 'error' and kills the MCP process.
          sock.on("error", (err) => {
            if (this.socket !== sock) return;
            this._failAll(err);
            this.socket = null;
            this.port = null;
            this.recvBuf = Buffer.alloc(0);
            this.hello = null;
            sock.destroy();
          });
          sock.on("close", () => {
            if (this.socket === sock) {
              this._failAll(new Error("connection closed"));
              this.socket = null;
              this.port = null;
              this.hello = null;
              this.recvBuf = Buffer.alloc(0);
            }
          });
          this.socket = sock;
          this.port = port;
          this.recvBuf = Buffer.alloc(0);
          clearTimeout(timer);
          sock.setTimeout(0);
          // Process any leftover framed bytes that arrived with the handshake.
          if (rest.length) this._onFrameData(rest);
          resolve();
          return;
        }
      };

      sock.setNoDelay(true);
      sock.setTimeout(CONNECT_TIMEOUT_MS + 500);
      sock.once("error", onFail);
      onClose = () => {
        if (!handshakeDone) onFail(new Error("closed during handshake"));
      };
      sock.once("close", onClose);
      sock.on("data", onData);
    });
  }

  _onFrameData(chunk) {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
    while (this.recvBuf.length >= 8) {
      const len = Number(this.recvBuf.readBigUInt64BE(0));
      if (len > MAX_FRAME_BYTES) {
        this._failAll(new Error(`frame too large: ${len}`));
        this.destroy();
        return;
      }
      if (this.recvBuf.length < 8 + len) return;
      const payload = this.recvBuf.subarray(8, 8 + len);
      this.recvBuf = this.recvBuf.subarray(8 + len);
      let msg;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch (e) {
        // Non-JSON notification/frame — surface as error to waiters only if a request is pending.
        if (this.pending.length) {
          this._settle(this.pending.shift(), null, new Error(`bad JSON frame: ${e.message}`));
        }
        continue;
      }
      // Notifications have notification_type and no success field.
      if (msg && typeof msg.notification_type === "string" && msg.success === undefined) {
        // Drop or log — MCP tools are request/response; ignore push events for now.
        continue;
      }
      if (this.pending.length) {
        this._settle(this.pending.shift(), msg, null);
      }
    }
  }

  _settle(entry, msg, err) {
    if (!entry) return;
    clearTimeout(entry.timer);
    if (err) entry.reject(err);
    else entry.resolve(msg);
  }

  _failAll(err) {
    while (this.pending.length) this._settle(this.pending.shift(), null, err);
  }

  destroy() {
    this._failAll(new Error("connection closed"));
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.port = null;
    this.recvBuf = Buffer.alloc(0);
    this.hello = null;
  }

  /** Serialize requests — response matching is by arrival order. */
  async send(type, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const run = async () => {
      await this.ensureConnected();
      const body = Buffer.from(JSON.stringify({ type, params }), "utf8");
      const header = Buffer.alloc(8);
      header.writeBigUInt64BE(BigInt(body.length), 0);
      return new Promise((resolve, reject) => {
        const entry = {
          resolve,
          reject,
          timer: setTimeout(() => {
            const i = this.pending.indexOf(entry);
            if (i >= 0) this.pending.splice(i, 1);
            reject(new Error(`Unity 命令超时 (${timeoutMs}ms): ${type}`));
          }, timeoutMs),
        };
        this.pending.push(entry);
        try {
          this.socket.write(Buffer.concat([header, body]));
        } catch (e) {
          this._settle(entry, null, e);
          this.destroy();
        }
      });
    };
    // Chain onto the lock so concurrent MCP calls stay strictly ordered.
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => {});
    return p;
  }
}

const client = new UnityBridgeClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(obj, isError = false) {
  const text =
    typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function errResult(e) {
  const msg = e?.message || String(e);
  return textResult(`Unity Bridge 调用失败: ${msg}`, true);
}

function unwrap(resp) {
  // Bridge already returns {success,message,data,...}. Prefer data for readability
  // but always keep the envelope so failures are obvious.
  return resp;
}

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

const tools = [
  {
    name: "bridge_status",
    description:
      "查看 Codely Unity Bridge 握手文件与端口状态，不建立 TCP 也可调用。用于诊断是否已 /init unity。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "send_raw",
    description:
      "向 Codely Bridge 发送任意命令。type 为命令名，params 为参数对象。返回完整 JSON 响应。",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "命令类型，如 manage_gameobject / manage_scene / manage_asset / manage_editor / manage_gameview / manage_screenshot / execute_csharp_script / execute_menu_item / read_console / manage_job",
        },
        params: {
          type: "object",
          description: "命令参数，通常含 action 等字段",
        },
        timeout_ms: {
          type: "number",
          description: "超时毫秒，默认 60000",
        },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_csharp",
    description:
      "在团结编辑器内执行 C# 片段（execute_csharp_script）。适合调 Animator、改 clip、查组件。勿写 .cs 到磁盘以免 domain reload。script 为代码体；默认 import System/UnityEngine/UnityEditor 等。",
    inputSchema: {
      type: "object",
      properties: {
        script: { type: "string", description: "C# 源码（方法体或完整可编译片段）" },
        summary: { type: "string", description: "脚本用途说明（日志）" },
        execution_mode: {
          type: "string",
          enum: ["editor", "play"],
          description: "editor=编辑模式；play=播放模式；省略=不限",
        },
        capture_logs: { type: "boolean", description: "捕获日志，默认 true" },
        enable_repl: {
          type: "boolean",
          description: "REPL 会话模式，默认 false（一次性）",
        },
        timeout_seconds: {
          type: "number",
          description: "脚本异步超时秒数（传给桥）",
        },
        timeout_ms: {
          type: "number",
          description: "MCP 侧等待超时，默认 120000",
        },
      },
      required: ["script"],
      additionalProperties: false,
    },
  },
  {
    name: "manage_gameobject",
    description:
      "场景 GameObject 操作。action: create/modify/delete/find/list_children/get_components/add_component/remove_component/set_component_property/select/create_batch/edit_batch/ensure_component 等。target 可用 name/path/instanceID，配 searchMethod。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "动作名，见 description" },
        target: {
          description: "目标：字符串（名称或层级路径）或 instanceID 数字",
        },
        searchMethod: {
          type: "string",
          enum: ["by_name", "by_path", "by_id"],
        },
        name: { type: "string" },
        parent: { description: "父节点：名称/路径/instanceID" },
        tag: { type: "string" },
        layer: { type: "string" },
        primitiveType: { type: "string" },
        position: { type: "array", items: { type: "number" } },
        rotation: { type: "array", items: { type: "number" } },
        scale: { type: "array", items: { type: "number" } },
        setActive: { type: "boolean" },
        componentProperties: { type: "object" },
        componentsToAdd: { type: "array" },
        componentsToRemove: { type: "array" },
        componentName: { type: "string" },
        extra: {
          type: "object",
          description: "其余 action 专用参数，原样并入 params",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "screenshot",
    description:
      "截图/录制。action: capture_scene_view / capture_main_camera / capture_specific_camera / capture_asset / start_game_view_recording / finish_game_view_recording。注意 capture_game_view 已禁用。",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "capture_scene_view | capture_main_camera | capture_specific_camera | capture_asset | start_game_view_recording | finish_game_view_recording",
        },
        path: { type: "string", description: "保存目录，默认 <ProjectRoot>/screenshots" },
        filename: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        view: {
          type: "string",
          description: "current|cardinal|all|front|back|left|right|top|bottom|iso",
        },
        camera_name: { type: "string", description: "capture_specific_camera 用" },
        recording_id: {
          type: "string",
          description: "finish_game_view_recording 用",
        },
        durationSeconds: { type: "number" },
        fps: { type: "number" },
        encodeFps: { type: "number" },
        over_time: { type: "string", description: '例如 "5" 或 "5x1"' },
        as_gif: { type: "object", description: "GIF 录制子参数" },
        extra: { type: "object" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "manage_scene",
    description:
      "场景操作。action: create/load/save/ensure_scene_open/ensure_scene_saved/get_hierarchy/get_active/get_build_settings。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        name: { type: "string" },
        path: { type: "string", description: "例如 Assets/Scenes/Town.unity" },
        buildIndex: { type: "number" },
        extra: { type: "object" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "manage_asset",
    description:
      "资产操作。action: create/modify/delete/duplicate/move/search/get_info/import/create_folder/get_components/ensure_has_meta/ensure_meta_integrity。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        path: { type: "string" },
        destination: { type: "string" },
        assetType: { type: "string" },
        properties: { type: "object" },
        searchPattern: { type: "string" },
        filterType: { type: "string" },
        extra: { type: "object" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "manage_gameview",
    description: "GameView 分辨率。action: get_resolution / set_resolution / list_resolutions。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "execute_menu_item",
    description: "执行编辑器菜单项。默认 action=execute，参数 menu_path/menuPath。",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "execute | get_available_menus",
        },
        menu_path: { type: "string" },
        filter: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "manage_editor",
    description:
      "编辑器控制。action: get_state / play / stop / pause / resume / step / refresh / request_compile / wait_for_idle / get_selection / get_project_root 等。Play Mode 写操作会被 write guard 拦截。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        timeoutSeconds: { type: "number" },
        singleFrame: { type: "boolean" },
        targetPaused: { type: "boolean" },
        extra: { type: "object" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: "read_console",
    description: "读/清 Console。action: get | clear。types/count/filterText 等可选。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "clear"] },
        types: { type: "array", items: { type: "string" } },
        count: { type: "number" },
        filterText: { type: "string" },
        includeStacktrace: { type: "boolean" },
        scope: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "manage_job",
    description:
      "查询/取消异步 job。action: status|list|cancel。job_id 必填（status/cancel）。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "list", "cancel", "check"] },
        job_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

function mergeParams(props, extra) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) out[k] = v;
  }
  return out;
}

async function callTool(name, args) {
  switch (name) {
    case "bridge_status": {
      const hb = readHeartbeat();
      const resolved = resolvePort();
      return textResult({
        handshake_file: hb?.file || null,
        unity_port: hb?.raw?.unity_port ?? null,
        resolved_port: resolved?.port ?? null,
        last_heartbeat: hb?.raw?.last_heartbeat ?? null,
        reason: hb?.raw?.reason ?? null,
        reloading: hb?.raw?.reloading ?? null,
        project_path: hb?.raw?.project_path ?? null,
        note:
          resolved && resolved.port > 0
            ? `可连接 ${HOST}:${resolved.port}`
            : !PROJECT
              ? "未配置工程目录。请通过 --project 或 CODELY_UNITY_PROJECT 指定目标工程。"
              : "unity_port 无效或握手文件缺失；请确认已安装 Codely Bridge 并在编辑器中连接。",
      });
    }

    case "send_raw": {
      const resp = await client.send(
        args.type,
        args.params || {},
        args.timeout_ms || DEFAULT_TIMEOUT_MS
      );
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "execute_csharp": {
      const params = {
        script: args.script,
        capture_logs: args.capture_logs ?? true,
      };
      if (args.summary) params.summary = args.summary;
      if (args.execution_mode) params.execution_mode = args.execution_mode;
      if (args.enable_repl) params.enable_repl = true;
      if (args.timeout_seconds) params.timeoutSeconds = args.timeout_seconds;
      const resp = await client.send(
        "execute_csharp_script",
        params,
        args.timeout_ms || 120_000
      );
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "manage_gameobject": {
      const { action, target, searchMethod, extra, ...rest } = args;
      const params = mergeParams(
        { action, target, searchMethod, ...rest },
        extra
      );
      const resp = await client.send("manage_gameobject", params);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "screenshot": {
      const { action, extra, ...rest } = args;
      const params = mergeParams({ action, ...rest }, extra);
      const resp = await client.send("manage_screenshot", params, 90_000);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "manage_scene": {
      const { action, extra, ...rest } = args;
      const params = mergeParams({ action, ...rest }, extra);
      const resp = await client.send("manage_scene", params);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "manage_asset": {
      const { action, extra, ...rest } = args;
      const params = mergeParams({ action, ...rest }, extra);
      const resp = await client.send("manage_asset", params);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "manage_gameview": {
      const { action, extra, ...rest } = args;
      const params = mergeParams({ action, ...rest }, extra);
      const resp = await client.send("manage_gameview", params);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "execute_menu_item": {
      const { action, extra, ...rest } = args;
      const params = mergeParams(
        { action: action || "execute", ...rest },
        extra
      );
      const resp = await client.send("execute_menu_item", params);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "manage_editor": {
      const { action, extra, ...rest } = args;
      const params = mergeParams({ action, ...rest }, extra);
      const resp = await client.send("manage_editor", params, 90_000);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "read_console": {
      const { action, extra, ...rest } = args;
      const params = mergeParams({ action: action || "get", ...rest }, extra);
      const resp = await client.send("read_console", params);
      return textResult(unwrap(resp), resp?.success === false);
    }

    case "manage_job": {
      const { action, job_id, reason, extra, ...rest } = args;
      const params = mergeParams(
        {
          action: action === "check" ? "status" : action,
          job_id: job_id || undefined,
          id: job_id || undefined,
          reason,
          ...rest,
        },
        extra
      );
      const resp = await client.send("manage_job", params);
      return textResult(unwrap(resp), resp?.success === false);
    }

    default:
      return textResult(`未知工具: ${name}`, true);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC / MCP over stdio
// ---------------------------------------------------------------------------

const SERVER_INFO = {
  name: "codely-unity",
  version: "1.0.0",
};

function writeMsg(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  writeMsg({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message, data) {
  writeMsg({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", async (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  // Notifications (no id)
  if (id === undefined || id === null) {
    return;
  }

  try {
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            "Codely Unity Bridge MCP adapter. Open the configured Unity/Tuanjie project and connect the Codely Bridge before calling editor tools.",
        });
        break;

      case "ping":
        reply(id, {});
        break;

      case "tools/list":
        reply(id, { tools });
        break;

      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments || {};
        if (!tools.some((t) => t.name === name)) {
          replyError(id, -32602, `Unknown tool: ${name}`);
          break;
        }
        const result = await callTool(name, args);
        reply(id, result);
        break;
      }

      default:
        replyError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (id !== undefined && id !== null) {
      reply(id, errResult(e));
    }
  }
});

rl.on("close", () => {
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  client.destroy();
  process.exit(0);
});
process.on("SIGTERM", () => {
  client.destroy();
  process.exit(0);
});
