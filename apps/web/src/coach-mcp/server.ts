// Stdio MCP server that exposes the coach's read tools to the Cursor Composer
// provider. Spawned as a subprocess BY cursor-agent (see cursor-loop.ts), one
// process per coach turn. It reuses the app's real `executeTool` / `TOOLS`, so
// tool output shapes and `forUser(userId)` scoping are identical to the
// Anthropic path — no SQL duplication, and the CI scoped-SQL guard stays happy.
//
// MUST be run with the react-server condition so the `server-only` import in
// tools.ts no-ops instead of throwing:
//   node --conditions=react-server --import tsx <abs path>/server.ts
//
// Tenant binding: `userId` comes from the COACH_MCP_USER_ID env var set on the
// spawn (via mcp.json `env`). A separate process pinned to one userId cannot
// cross tenants. The DB is selected via the inherited WHOOP_DB_PATH.
//
// Protocol: newline-delimited JSON-RPC 2.0 over stdio (the transport
// cursor-agent speaks). stdout carries ONLY protocol frames — all diagnostics
// go to stderr, or cursor-agent will fail to parse the stream.
import { TOOLS, executeTool, newToolTurnState } from "@/lib/coach/tools";

// Read-only subset surfaced to Composer. `trigger_whoop_sync` is intentionally
// omitted in v1: it mutates (network + DB write), which doesn't belong in a
// read-only `--mode ask` turn. The manual Sync button / Anthropic coach still
// cover syncing.
const READ_TOOL_NAMES = new Set([
  "query_recovery",
  "query_sleep",
  "query_strain",
  "query_workouts",
  "query_naps",
  "query_journal",
  "query_daily_snapshot",
]);

const USER_ID = Number(process.env.COACH_MCP_USER_ID);

function log(msg: string, extra?: unknown) {
  process.stderr.write(
    `[coach-mcp] ${msg}${extra === undefined ? "" : " " + JSON.stringify(extra)}\n`,
  );
}

type JsonRpcId = string | number | null;
function send(msg: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id: JsonRpcId, result: unknown) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id: JsonRpcId, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function listTools() {
  return TOOLS.filter((t) => READ_TOOL_NAMES.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  }));
}

async function callTool(id: JsonRpcId, params: unknown) {
  const p = (params ?? {}) as { name?: string; arguments?: unknown };
  const name = p.name;
  if (!name || !READ_TOOL_NAMES.has(name)) {
    return replyError(id, -32601, `Unknown or unavailable tool: ${name}`);
  }
  try {
    const result = await executeTool(name, p.arguments ?? {}, {
      userId: USER_ID,
      turnState: newToolTurnState(),
    });
    reply(id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("tool_error", { name, message });
    // MCP convention: tool-level failures come back as a result with
    // isError:true (not a protocol error) so the model can react to them.
    reply(id, {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true,
    });
  }
}

async function handle(msg: { id?: JsonRpcId; method?: string; params?: unknown }) {
  const { id = null, method } = msg;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion:
          (msg.params as { protocolVersion?: string } | undefined)
            ?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "whoop-coach", version: "1.0.0" },
      });
      return;
    case "notifications/initialized":
      return; // notification, no response
    case "tools/list":
      reply(id, { tools: listTools() });
      return;
    case "tools/call":
      await callTool(id, msg.params);
      return;
    case "ping":
      reply(id, {});
      return;
    default:
      if (id !== null) replyError(id, -32601, `Method not found: ${method}`);
  }
}

function main() {
  if (!Number.isInteger(USER_ID) || USER_ID <= 0) {
    log("fatal: COACH_MCP_USER_ID missing or invalid");
    process.exit(1);
  }
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: JsonRpcId; method?: string; params?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        log("non-json line ignored");
        continue;
      }
      void handle(msg);
    }
  });
  process.stdin.on("end", () => process.exit(0));
  log(`ready (user_id=${USER_ID})`);
}

main();
