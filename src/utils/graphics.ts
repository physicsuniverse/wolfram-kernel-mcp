import { mkdir } from "node:fs/promises";
import type { GraphicsOutput } from "../types.js";

const OUTPUT_BASE = "/tmp/wolfram-kernel";

export type WolframExecutor = (code: string) => Promise<string>;

export async function extractGraphics(
  exec: WolframExecutor,
  sessionId: string,
  format: "png" | "svg",
  outNumber?: number,
): Promise<GraphicsOutput> {
  const dir = `${OUTPUT_BASE}/${sessionId}`;
  await mkdir(dir, { recursive: true });

  const timestamp = Date.now();
  const filename = `output_${timestamp}.${format}`;
  const filePath = `${dir}/${filename}`;

  // Use explicit Out[n] reference when available, otherwise fall back to %
  // Out[n] avoids corruption when multiple graphics are exported sequentially
  // because % (Out[$Line]) changes after each Export call.
  const ref = outNumber !== undefined ? `Out[${outNumber}]` : "%";
  const exportCmd = `Export["${filePath}", ${ref}]`;
  const rawOutput = await exec(exportCmd);

  const pathMatch = rawOutput.match(/"([^"]+)"/);
  const actualPath = pathMatch ? pathMatch[1] : filePath;

  const mimeType = format === "png" ? "image/png" : "image/svg+xml";

  return {
    type: "graphics",
    format,
    filePath: actualPath,
    mimeType,
  };
}
