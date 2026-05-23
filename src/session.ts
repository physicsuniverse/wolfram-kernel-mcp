import { WolframProtocol } from "./protocol.js";
import { parseCells, hasError } from "./utils/result-parser.js";
import { extractGraphics } from "./utils/graphics.js";
import type { WolframExecutor } from "./utils/graphics.js";
import type {
  SessionConfig,
  SessionInfo,
  SessionSnapshot,
  ExecutionResult,
  OutputCell,
} from "./types.js";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface SessionState {
  config: SessionConfig;
  protocol: WolframProtocol;
  createdAt: Date;
  executionCount: number;
  variables: string[];
}

const sessions = new Map<string, SessionState>();
const EXECUTION_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const OUT_VAR_RE = /^Out\[\d+\]=\s*/;

function parseVariableList(raw: string): string[] {
  const stripped = raw.trim().replace(OUT_VAR_RE, "");
  const cleaned = stripped.replace(/^\{/, "").replace(/\}$/, "");
  if (!cleaned) return [];
  return cleaned.split(",").map((v) => v.trim()).filter((v) => v.length > 0);
}

function buildSessionInfo(id: string, state: SessionState): SessionInfo {
  return {
    id,
    name: state.config.name,
    createdAt: state.createdAt.toISOString(),
    status: state.protocol.isAlive() ? "running" : "dead",
    executionCount: state.executionCount,
    variables: state.variables,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createSession(config: SessionConfig): Promise<SessionInfo> {
  const sessionId = config.id || crypto.randomUUID();
  const protocol = new WolframProtocol(config.kernelPath);
  await protocol.start();

  const state: SessionState = {
    config: { ...config, id: sessionId },
    protocol,
    createdAt: new Date(),
    executionCount: 0,
    variables: [],
  };
  sessions.set(sessionId, state);

  return buildSessionInfo(sessionId, state);
}

export async function executeInSession(
  sessionId: string,
  code: string,
): Promise<ExecutionResult> {
  const state = sessions.get(sessionId);
  if (!state) throw new Error(`Session "${sessionId}" not found`);
  if (!state.protocol.isAlive()) throw new Error(`Session "${sessionId}" kernel has exited`);

  const startTime = performance.now();

  // AbortController so timeout can cancel the stdout reader and release the
  // lock for subsequent execute calls (fixes abandoned-reader bug #3).
  const abortController = new AbortController();

  try {
    const { lines } = await withTimeout(
      state.protocol.execute(code, abortController.signal),
      EXECUTION_TIMEOUT_MS,
    );

    const cells = parseCells(lines);

    // Resolve graphics outputs SEQUENTIALLY (not Promise.all).
    // Sequential processing avoids concurrent stdout reader acquisition
    // and ensures each Export's % / Out[n] reference is correct.
    const executor: WolframExecutor = (c) => state.protocol.executeRaw(c);
    const finalized: OutputCell[] = [];
    for (const cell of cells) {
      finalized.push(await finalizeCell(sessionId, executor, cell));
    }

    state.executionCount++;

    // Refresh variable list (non-critical)
    try {
      const varsRaw = await state.protocol.executeRaw('Names["Global`*"]');
      state.variables = parseVariableList(varsRaw);
    } catch { /* keep previous list */ }

    const timing = Math.round(performance.now() - startTime);

    return {
      sessionId,
      input: code,
      outputs: finalized,
      timing,
      success: !hasError(finalized),
    };
  } catch (err: unknown) {
    // Cancel any in-flight stdout read so the reader lock is released.
    abortController.abort();

    return {
      sessionId,
      input: code,
      outputs: [{ type: "error", message: err instanceof Error ? err.message : String(err) }],
      timing: Math.round(performance.now() - startTime),
      success: false,
    };
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const state = sessions.get(sessionId);
  if (!state) return;
  try { await state.protocol.close(); } catch { /* ok */ }
  sessions.delete(sessionId);
}

export function listSessions(): SessionInfo[] {
  return Array.from(sessions.entries()).map(([id, state]) => buildSessionInfo(id, state));
}

export async function getSessionVariables(sessionId: string): Promise<string[]> {
  const state = sessions.get(sessionId);
  if (!state) throw new Error(`Session "${sessionId}" not found`);

  const output = await state.protocol.executeRaw('Names["Global`*"]');
  return parseVariableList(output);
}

export async function saveSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  const state = sessions.get(sessionId);
  if (!state) throw new Error(`Session "${sessionId}" not found`);

  const namesOutput = await state.protocol.executeRaw('Names["Global`*"]');
  const names = parseVariableList(namesOutput);

  const definitions: string[] = [];
  for (const name of names) {
    try {
      const def = await state.protocol.executeRaw(`Definition[${name}]`);
      const trimmed = def.trim();
      if (trimmed) definitions.push(trimmed);
    } catch { /* skip */ }
  }

  return {
    sessionId,
    timestamp: new Date().toISOString(),
    definitions,
    rawDump: definitions.join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// Graphics finalization
// ---------------------------------------------------------------------------

async function finalizeCell(
  sessionId: string,
  exec: WolframExecutor,
  cell: OutputCell,
): Promise<OutputCell> {
  if (cell.type !== "graphics") return cell;

  try {
    const result = await extractGraphics(exec, sessionId, "png", cell.outNumber);
    return result;
  } catch (err: unknown) {
    return { type: "error", message: `Graphics extraction failed: ${err}` };
  }
}
