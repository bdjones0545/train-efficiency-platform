import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { injectMetaTags } from "./meta";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve hashed assets (JS/CSS) with long-lived cache — their filenames change on rebuild.
  // Serve index.html with no-cache so browsers always fetch the latest entry point and
  // pick up new hashed asset filenames after a redeploy.
  app.use(
    express.static(distPath, {
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      },
    }),
  );

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", async (req, res) => {
    try {
      const html = await fs.promises.readFile(
        path.resolve(distPath, "index.html"),
        "utf-8",
      );
      const host = req.hostname || (req.headers.host as string) || "";
      const injected = await injectMetaTags(html, req.originalUrl, host);
      res
        .set("Content-Type", "text/html")
        .set("Cache-Control", "no-cache, no-store, must-revalidate")
        .set("Pragma", "no-cache")
        .set("Expires", "0")
        .send(injected);
    } catch {
      res
        .set("Cache-Control", "no-cache, no-store, must-revalidate")
        .sendFile(path.resolve(distPath, "index.html"));
    }
  });
}
