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

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", async (req, res) => {
    try {
      const html = await fs.promises.readFile(
        path.resolve(distPath, "index.html"),
        "utf-8",
      );
      const host = req.hostname || (req.headers.host as string) || "";
      const injected = await injectMetaTags(html, req.originalUrl, host);
      res.set("Content-Type", "text/html").send(injected);
    } catch {
      res.sendFile(path.resolve(distPath, "index.html"));
    }
  });
}
