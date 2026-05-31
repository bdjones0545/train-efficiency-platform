---
name: Express Route Registration Order
description: Why all new API routes must go inside registerRoutes() in server/routes.ts, not in server/index.ts
---

## Rule
ALL new Express API routes must be registered INSIDE `registerRoutes()` in `server/routes.ts`, before the `return httpServer` line. Never register routes in `server/index.ts` after the `await registerRoutes(...)` call.

**Why:** `server/vite.ts`'s `setupVite()` function is called in `server/index.ts` AFTER `registerRoutes()` returns. `setupVite()` adds `app.use(vite.middlewares)` and `app.use("/{*path}", serveHTML)` which is a catch-all that matches every URL. Any route registered after `setupVite()` is shadowed by this catch-all and will return the SPA HTML instead of JSON.

**How to apply:**
- For large new route files, use a dynamic import at the VERY END of `registerRoutes()`:
  ```typescript
  const { registerPhase10Routes } = await import("./phase10-routes");
  await registerPhase10Routes(app);
  return httpServer;
  ```
- After adding new routes, always do a clean server restart (not just hot reload) and test with `Accept: application/json` to confirm JSON is returned.
- Symptom of mis-registration: endpoint returns `text/html; charset=utf-8` with SPA content, even though server logs show `200 in Xms`.
