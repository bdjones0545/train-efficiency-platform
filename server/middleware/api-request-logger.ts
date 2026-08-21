import type { Request, RequestHandler, Response } from "express";

export type ApiRequestLogWriter = (message: string, source?: string) => void;

function statusClassification(status: number): "success" | "redirect" | "client_error" | "server_error" {
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  if (status >= 300) return "redirect";
  return "success";
}

function responseSize(res: Response): number | undefined {
  const value = res.getHeader("content-length");
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Logs API request completion metadata without observing or serializing response bodies.
 *
 * Deliberately does not wrap res.json(), inspect request headers, or derive identity fields.
 * This keeps response semantics unchanged and prevents credentials or private payload data
 * from entering the generic request log in any environment.
 */
export function createApiRequestLogger(
  writeLog: ApiRequestLogWriter,
  now: () => number = Date.now,
): RequestHandler {
  return (req: Request, res: Response, next) => {
    const startedAt = now();
    const path = req.path;

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const durationMs = Math.max(0, now() - startedAt);
      const size = responseSize(res);
      const fields = [
        `${req.method} ${path} ${res.statusCode} in ${durationMs}ms`,
        `classification=${statusClassification(res.statusCode)}`,
      ];
      if (size !== undefined) fields.push(`responseBytes=${size}`);

      writeLog(fields.join(" "));
    });

    next();
  };
}
