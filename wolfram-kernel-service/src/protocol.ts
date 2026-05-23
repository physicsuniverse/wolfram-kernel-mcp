import { Subprocess } from "bun";
import type { RawOutputLine } from "./types.js";

const DEFAULT_WOLFRAMSCRIPT_PATH = "/usr/local/bin/wolframscript";
const IN_PROMPT_RE = /^In\[\d+\]:=/;
const ERROR_PATTERN_RE = /^[A-Za-z]\w*::\w+:/;
const GRAPHICS_MARKER = "-Graphics-";
const OUT_NUM_RE = /^Out\[(\d+)\]=/;

export class WolframProtocol {
  private proc!: Subprocess<"pipe", "pipe", "inherit">;
  private started = false;
  private kernelPath: string;

  constructor(kernelPath?: string) {
    this.kernelPath = kernelPath ?? DEFAULT_WOLFRAMSCRIPT_PATH;
  }

  async start(): Promise<void> {
    this.proc = Bun.spawn([this.kernelPath, "-linewise"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit", // drain to parent so pipe buffer never blocks the kernel
    });
    await this.consumeBanner();
    this.started = true;
  }

  private async consumeBanner(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const allLines = buffer.split("\n");
        buffer = allLines.pop() ?? "";

        for (const line of allLines) {
          if (IN_PROMPT_RE.test(line)) return;
        }
        if (IN_PROMPT_RE.test(buffer)) return;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Execute Wolfram Language code and return parsed output lines.
   *
   * @param code   Wolfram Language code to execute.
   * @param signal Optional AbortSignal to cancel a long-running execution.
   *               When aborted the stdout reader is cancelled so the next call
   *               can acquire it.
   */
  async execute(
    code: string,
    signal?: AbortSignal,
  ): Promise<{
    lines: RawOutputLine[];
    timing: number;
  }> {
    if (!this.started) throw new Error("Protocol not started");

    const startTime = Date.now();

    const sentinel = `__WL_SENTINEL_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    const payload = code.trimEnd() + `\nPrint["${sentinel}"];\n`;
    await this.proc.stdin.write(payload);

    const rawText = await this.readUntilSentinel(sentinel, signal);

    // If the kernel died during execution (pipe closed without sentinel),
    // treat it as an error rather than returning truncated data as success.
    if (!this.started || this.proc.exitCode !== null) {
      throw new Error(
        `Wolfram kernel exited with code ${this.proc.exitCode ?? "unknown"} during execution`,
      );
    }

    const lines = this.parseRawText(rawText);
    const timing = Date.now() - startTime;

    return { lines, timing };
  }

  private async readUntilSentinel(
    sentinel: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";

    // When the signal fires, cancel the reader so pending read() resolves
    // and the lock is released for the next execute call.
    const onAbort = () => reader.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        accumulated += decoder.decode(value, { stream: true });

        const idx = accumulated.indexOf(sentinel);
        if (idx !== -1) {
          const result = accumulated.slice(0, idx);
          return result;
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      reader.releaseLock();
    }

    return accumulated;
  }

  private parseRawText(raw: string): RawOutputLine[] {
    // Join wolframscript continuation lines (">    content" belongs to previous line)
    const joined = raw.replace(/\n\s*>\s*/g, " ");
    const lines = joined.split("\n");
    const results: RawOutputLine[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) continue;
      if (trimmed === "...") continue;
      if (IN_PROMPT_RE.test(trimmed)) continue;

      const isError = ERROR_PATTERN_RE.test(trimmed);
      const isGraphics = trimmed.includes(GRAPHICS_MARKER);

      // Capture Out[n] line number so graphics export can use explicit Out[n]
      // instead of fragile % references.
      const outMatch = trimmed.match(OUT_NUM_RE);
      const outNumber = outMatch ? parseInt(outMatch[1], 10) : undefined;

      results.push({ raw: line, isError, isGraphics, outNumber });
    }

    return results;
  }

  async executeRaw(code: string, signal?: AbortSignal): Promise<string> {
    const { lines } = await this.execute(code, signal);
    return lines.map((l) => l.raw).join("\n");
  }

  isAlive(): boolean {
    return this.started && this.proc.exitCode === null && !this.proc.killed;
  }

  async close(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.started = false;
    }
  }
}
