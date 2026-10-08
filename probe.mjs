#!/usr/bin/env node
/** Direct Codely Unity Bridge probe — 8-byte BE length framing. */
import net from "node:net";

const HOST = "127.0.0.1";
const PORT = 5710;

function frame(type, params) {
  const body = Buffer.from(JSON.stringify({ type, params }), "utf8");
  const header = Buffer.alloc(8);
  header.writeBigUInt64BE(BigInt(body.length), 0);
  return Buffer.concat([header, body]);
}

const sock = net.connect({ host: HOST, port: PORT });
let buf = Buffer.alloc(0);
let helloDone = false;
const pending = [];

sock.on("connect", () => {
  console.log("TCP connected to", `${HOST}:${PORT}`);
});

sock.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  if (!helloDone) {
    const nl = buf.indexOf(0x0a);
    if (nl < 0) return;
    const line = buf.subarray(0, nl).toString("ascii").trim();
    console.log("HELLO:", line);
    buf = buf.subarray(nl + 1);
    helloDone = true;
    // Skip CLIENT_VERSION plain line — this bridge build resets on it.
    // Fire framed command immediately after WELCOME.
    sock.write(frame("manage_editor", { action: "get_state" }));
  }
  while (buf.length >= 8) {
    const len = Number(buf.readBigUInt64BE(0));
    if (buf.length < 8 + len) return;
    const payload = buf.subarray(8, 8 + len).toString("utf8");
    buf = buf.subarray(8 + len);
    console.log("RESP:", payload);
    const p = pending.shift();
    if (p) p.resolve(JSON.parse(payload));
  }
});

sock.on("error", (e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

sock.on("close", () => {
  console.log("socket closed");
  process.exit(0);
});

setTimeout(() => {
  console.error("probe timeout");
  process.exit(2);
}, 8000);
