import type { RawOutputLine, OutputCell, TextOutput, GraphicsOutput, ErrorOutput, NullOutput } from "../types.js";

const OUT_MARKER_RE = /^Out\[\d+\]=\s*/;

export function parseCells(rawLines: RawOutputLine[]): OutputCell[] {
  const outputs: OutputCell[] = [];
  let errorBuffer: string[] = [];
  let textBuffer: string[] = [];

  for (const line of rawLines) {
    if (line.isError) {
      flushTextBuffer(textBuffer, outputs);
      errorBuffer.push(line.raw.trim());
      continue;
    }

    if (line.isGraphics) {
      flushTextBuffer(textBuffer, outputs);
      flushErrorBuffer(errorBuffer, outputs);
      outputs.push(createGraphicsPlaceholder(line.outNumber));
      continue;
    }

    flushErrorBuffer(errorBuffer, outputs);

    const content = stripOutMarker(line.raw);
    if (content) {
      textBuffer.push(content);
    }
  }

  flushErrorBuffer(errorBuffer, outputs);
  flushTextBuffer(textBuffer, outputs);

  if (outputs.length === 0) {
    outputs.push({ type: "null" } satisfies NullOutput);
  }

  return outputs;
}

export function hasError(outputs: OutputCell[]): boolean {
  return outputs.some((c) => c.type === "error");
}

function flushErrorBuffer(buffer: string[], outputs: OutputCell[]): void {
  if (buffer.length === 0) return;
  outputs.push({
    type: "error",
    message: buffer.join("\n"),
  } satisfies ErrorOutput);
  buffer.length = 0;
}

function flushTextBuffer(buffer: string[], outputs: OutputCell[]): void {
  if (buffer.length === 0) return;
  outputs.push({
    type: "text",
    content: buffer.join("\n"),
  } satisfies TextOutput);
  buffer.length = 0;
}

function createGraphicsPlaceholder(outNumber?: number): GraphicsOutput {
  return {
    type: "graphics",
    format: "png",
    filePath: "",
    mimeType: "image/png",
    outNumber,
  };
}

function stripOutMarker(line: string): string {
  return line.replace(OUT_MARKER_RE, "").trim();
}
