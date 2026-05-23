import { KernelManager } from "./kernel-manager.js";

const mgr = KernelManager.getInstance();
const PORT = 12459;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    switch (path) {
      case "/create": {
        const name = url.searchParams.get("name") || "default";
        const kernelPath = url.searchParams.get("kernelPath") || undefined;
        const info = await mgr.createSession(name, kernelPath);
        return json(info);
      }
      case "/exec": {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return json({ error: "missing session param" }, 400);
        const code = await req.text();
        const result = await mgr.execute(sessionId, code);
        return json(result);
      }
      case "/list": {
        return json(mgr.list());
      }
      case "/delete": {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return json({ error: "missing session param" }, 400);
        await mgr.delete(sessionId);
        return json({ ok: true });
      }
      case "/vars": {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return json({ error: "missing session param" }, 400);
        const vars = await mgr.getVariables(sessionId);
        return json(vars);
      }
      case "/snapshot": {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) return json({ error: "missing session param" }, 400);
        const snap = await mgr.snapshot(sessionId);
        return json(snap);
      }
      case "/health": {
        return json({ status: "ok", sessions: mgr.list().length });
      }
      default:
        return json({ error: "unknown", endpoints: ["/create", "/exec", "/list", "/delete", "/vars", "/snapshot", "/health"] }, 404);
    }
  } catch (e: unknown) {
    return json({ error: String(e) }, 500);
  }
}

console.error(`Wolfram Kernel HTTP daemon on http://localhost:${PORT}`);
Bun.serve({ port: PORT, fetch: handle });
