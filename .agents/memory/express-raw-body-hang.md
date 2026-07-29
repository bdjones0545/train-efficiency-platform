---
name: Express Raw Body Middleware Hang
description: How to safely capture raw request bytes for HMAC verification when express.json() may have already consumed the body stream.
---

## Rule

When a route needs the **raw request bytes** (e.g. for HMAC-SHA256 signature verification), the raw-body middleware must handle the case where `express.json()` (or any body-parser) already consumed the stream.

## Why

After `express.json()` parses a request body, the underlying `IncomingMessage` stream is in a consumed/ended state. Calling `req.on("data", ...)` on it will never fire any data chunks. If the middleware only waits for `req.on("end", ...)`, it may hang indefinitely on some Node.js versions/configurations, causing the request to never receive a response.

## How to apply

```typescript
(req: any, res: any, next: any) => {
  // Already captured in a previous middleware
  if (Buffer.isBuffer(req.rawBody) || typeof req.rawBody === "string") return next();

  // express.json() already parsed it — reconstruct canonical bytes
  if (req.body !== undefined) {
    req.rawBody = Buffer.from(
      typeof req.body === "string" ? req.body : JSON.stringify(req.body),
    );
    return next();
  }

  // Stream not yet consumed — collect raw bytes
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on("error", () => next());
},
```

Key points:
- Check `req.body !== undefined` **before** trying to stream — covers both valid JSON (object) and other parsed types.
- `JSON.stringify(req.body)` reconstitutes canonical bytes; HMAC verification on Kevin callbacks uses this, so Kevin must compute its signature over canonical (no extra whitespace) JSON.
- Add `req.on("error", () => next())` to prevent hanging on stream errors.
- Always restart the dev server after changing this middleware — the old version runs until restart.

## Symptoms of the bug
- Requests to the affected endpoint time out with no response (HTTP 000 / curl exit 28).
- Invalid JSON bodies return 400 quickly (express.json() sends the error before the route runs) but valid JSON bodies hang.
- Server logs show NO request log line for the hanging requests.
