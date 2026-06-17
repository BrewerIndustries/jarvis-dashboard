#!/usr/bin/env node
"use strict";

/*
 * Jarvis Dashboard — local MCP server (stdio, zero dependencies).
 *
 * Exposes two tools to a local MCP client (e.g. the Claude desktop app):
 *   - add_to_jarvis   : push a project/task/note/blocker to the dashboard
 *   - list_jarvis     : read the current board
 *
 * Runs on the user's machine, so it can reach the dashboard over Tailscale.
 * Config (URL + token) is read from the environment, falling back to
 * ~/.config/jarvis/jarvis.env (override with $JARVIS_CONFIG).
 *
 * Protocol: JSON-RPC 2.0 over newline-delimited stdin/stdout. Anything that
 * isn't a protocol response MUST go to stderr (stdout is the wire).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

// --- config ------------------------------------------------------------------

function loadConfig() {
  let url = process.env.JARVIS_URL || "";
  let token = process.env.JARVIS_TOKEN || "";
  const cfgPath =
    process.env.JARVIS_CONFIG || path.join(os.homedir(), ".config", "jarvis", "jarvis.env");
  try {
    for (const line of fs.readFileSync(cfgPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (m[1] === "JARVIS_URL" && !url) url = m[2].trim();
      if (m[1] === "JARVIS_TOKEN" && !token) token = m[2].trim();
    }
  } catch {
    /* no config file; rely on env */
  }
  return { url: url.replace(/\/+$/, ""), token };
}

const log = (...a) => process.stderr.write("[jarvis-mcp] " + a.join(" ") + "\n");

// --- tool definitions --------------------------------------------------------

const TOOLS = [
  {
    name: "add_to_jarvis",
    description:
      "Add an item to the user's Jarvis project dashboard (their personal backlog/project tracker). " +
      "Use this when the user says things like 'add it to the backlog', 'put X on the dashboard', " +
      "'track this', or 'note this for later'. Projects and sub-projects are auto-created by name, " +
      "so usually you just pass a title and a project. Infer the project from context if the user " +
      "doesn't name one.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title of the item." },
        project: {
          type: "string",
          description: "Project to file it under (auto-created if new). Infer from context if unstated.",
        },
        subproject: { type: "string", description: "Optional sub-project under the project." },
        kind: {
          type: "string",
          enum: ["task", "note", "blocker", "project", "subproject"],
          description: "Defaults to task. Use note for ideas, blocker for things blocking work.",
        },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        area: {
          type: "string",
          enum: ["live", "in_progress", "mothballed"],
          description: "Lane for the project (re-send a project name with a new area to move it).",
        },
        body: { type: "string", description: "Optional longer detail." },
        url: { type: "string", description: "Optional deep link (PR, doc, etc.)." },
      },
      required: ["title"],
    },
  },
  {
    name: "list_jarvis",
    description:
      "List what's currently on the Jarvis dashboard (projects, sub-projects, tasks, notes), " +
      "grouped by lane. Use when the user asks what's on their backlog / dashboard / plate.",
    inputSchema: { type: "object", properties: {} },
  },
];

// --- tool implementations ----------------------------------------------------

async function apiAddItem(cfg, args) {
  const payload = { source: "claude-desktop" };
  for (const k of ["title", "project", "subproject", "kind", "status", "priority", "area", "body", "url"]) {
    if (args[k] != null && String(args[k]).trim() !== "") payload[k] = args[k];
  }
  const res = await fetch(cfg.url + "/api/items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-jarvis-token": cfg.token },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("dashboard returned HTTP " + res.status + " " + (await res.text()));
  const data = await res.json();
  const created = data.created || [];
  const where = payload.subproject
    ? `${payload.project} › ${payload.subproject}`
    : payload.project || "Inbox";
  return `Added "${payload.title}" to ${where} (${payload.kind || "task"}) ✓` +
    (created.length > 1 ? ` — created ${created.length} nodes.` : "");
}

async function apiListItems(cfg) {
  const res = await fetch(cfg.url + "/api/items", { headers: { "x-jarvis-token": cfg.token } });
  if (!res.ok) throw new Error("dashboard returned HTTP " + res.status);
  const items = (await res.json()).items || [];
  if (items.length === 0) return "The dashboard is empty.";

  const byId = new Map(items.map((i) => [i.id, { ...i, children: [] }]));
  const roots = [];
  for (const n of byId.values()) {
    const p = n.parentId ? byId.get(n.parentId) : null;
    if (p) p.children.push(n);
    else roots.push(n);
  }
  const AREA = { live: "LIVE", in_progress: "IN PROGRESS", mothballed: "MOTHBALLED" };
  const lanes = { live: [], in_progress: [], mothballed: [] };
  for (const r of roots) (lanes[r.area || "in_progress"] || lanes.in_progress).push(r);

  const lines = [];
  const render = (node, depth) => {
    const pad = "  ".repeat(depth);
    const tag = node.kind === "project" || node.kind === "subproject"
      ? ""
      : `[${node.status}] `;
    lines.push(`${pad}- ${tag}${node.title}`);
    node.children.forEach((c) => render(c, depth + 1));
  };
  for (const key of ["live", "in_progress", "mothballed"]) {
    if (lanes[key].length === 0) continue;
    lines.push(`## ${AREA[key]}`);
    lanes[key].forEach((n) => render(n, 0));
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function callTool(cfg, params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
  try {
    if (!cfg.url || !cfg.token) {
      throw new Error(
        "Jarvis not configured: set JARVIS_URL and JARVIS_TOKEN (env or ~/.config/jarvis/jarvis.env).",
      );
    }
    let text;
    if (name === "add_to_jarvis") text = await apiAddItem(cfg, args);
    else if (name === "list_jarvis") text = await apiListItems(cfg);
    else throw new Error("Unknown tool: " + name);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: "Error: " + err.message }], isError: true };
  }
}

// --- JSON-RPC stdio loop -----------------------------------------------------

const cfg = loadConfig();
log("started; dashboard =", cfg.url || "(unset)");

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: (params && params.protocolVersion) || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "jarvis-dashboard", version: "1.0.0" },
        },
      });
      break;
    case "notifications/initialized":
    case "notifications/cancelled":
      break; // notifications: no response
    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      break;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      break;
    case "tools/call":
      send({ jsonrpc: "2.0", id, result: await callTool(cfg, params) });
      break;
    case "resources/list":
      send({ jsonrpc: "2.0", id, result: { resources: [] } });
      break;
    case "prompts/list":
      send({ jsonrpc: "2.0", id, result: { prompts: [] } });
      break;
    default:
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
      }
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log("bad JSON:", line.slice(0, 120));
      continue;
    }
    handle(msg).catch((e) => log("handler error:", e && e.message));
  }
});
process.stdin.on("end", () => process.exit(0));
