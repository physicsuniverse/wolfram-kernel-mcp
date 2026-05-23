/** Shared types for Wolfram Kernel Service */

export interface SessionConfig {
  id: string;
  name: string;
  createdAt: Date;
  kernelPath?: string; // path to MathKernel, defaults to wolframscript
}

export interface SessionInfo {
  id: string;
  name: string;
  createdAt: string;
  status: "running" | "dead" | "starting";
  executionCount: number;
  variables: string[];
}

export interface ExecutionResult {
  sessionId: string;
  input: string;
  outputs: OutputCell[];
  timing: number; // ms
  success: boolean;
}

export type OutputCell =
  | TextOutput
  | GraphicsOutput
  | ErrorOutput
  | NullOutput;

export interface TextOutput {
  type: "text";
  content: string;
}

export interface GraphicsOutput {
  type: "graphics";
  format: "png" | "svg" | "gif";
  filePath: string;
  mimeType: string;
  outNumber?: number; // Out[n] line this graphic came from, for correct %-free Export
}

export interface ErrorOutput {
  type: "error";
  message: string;
  stack?: string;
}

export interface NullOutput {
  type: "null";
}

/** Raw line from wolframscript stdout */
export interface RawOutputLine {
  raw: string;
  isError: boolean;
  isGraphics: boolean;
  outNumber?: number; // Out[n]= line number extracted from the output marker
}

/** Session state snapshot for save/restore */
export interface SessionSnapshot {
  sessionId: string;
  timestamp: string;
  definitions: string[]; // list of variable/function definitions
  rawDump: string; // Save[] output
}
