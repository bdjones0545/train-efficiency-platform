---
name: Drizzle db.execute() response shape
description: db.execute() always returns a PgQueryResult object (not an array); use toN()/toArr() helpers; silent catch{} blocks + stale tsx compile cache are the two main failure modes.
---

## Rule
`db.execute(sql`...`)` in this project **always** returns a `PgQueryResult` shaped object:
```
{ command:'SELECT', rowCount:N, rows:[...], fields:[...], _parsers, _types, RowCtor, rowAsArray, _prebuiltEmptyResultObject }
```
`Array.isArray()` returns **false** on this object. Destructuring `const [x] = result` throws silently.

## Canonical helpers (put at module top-level)
```typescript
const toArr = (r: any): any[] =>
  Array.isArray(r) ? r : Array.isArray(r?.rows) ? r.rows : [];

const toN = (r: any): number => {
  if (r == null) return 0;
  if (Array.isArray(r)) return Number((r[0] as any)?.n ?? 0);
  if (Array.isArray(r?.rows)) return Number((r.rows[0] as any)?.n ?? 0);
  if (typeof (r as any)?.n === 'number') return (r as any).n;
  return 0;
};
```
Use `toN(res)` for single COUNT queries. Use `toArr(res)` for multi-row results.

**Why:** node-postgres returns PgQueryResult; Drizzle wraps it without flattening to array. Any guard using `Array.isArray(result)` falls through to a 0/[] fallback, making every counter show 0.

**How to apply:** Replace every `(res as any)[0]?.n` or `result[0]` pattern with `toN(res)` / `toArr(res)`. Applies to all COUNT, AVG, and GROUP BY queries executed via `db.execute()`.

## Silent crash trap: outer `catch {}` + tsx stale cache
When `runAlertEngine()` never logs (even with a `console.log` as the first line), two culprits:

1. **tsx stale compile cache** — the running server process uses a pre-edit compiled artifact. `restart_workflow()` alone is not sufficient if the old process was still serving requests. Fix: hard restart via `restart_workflow("Start application")` and wait for the new server's startup log before testing. Confirm by checking that stale debug logs (known-removed lines) no longer appear.

2. **Outer `catch { }` swallowing all errors** — change to `catch (e: any) { console.error('[ENGINE] CRASHED:', e?.message) }` temporarily to surface the root cause. Restore the silent catch only after confirming the engine runs clean.

## maybeFireAlert deduplication bug (fixed)
`existing` from `db.execute()` is a PgQueryResult, not an array. `(existing as any[]).length` is `undefined`; `undefined > 0` = `false`, so the guard never prevents double-inserts. Fix: use `toArr(existing).length > 0`.

## Bonus trap: variable rename inside catch{} scope
Renaming a variable used deep in a large object literal (e.g., `weekEnd` → `weekEndIso`) and missing one reference throws `ReferenceError` caught silently by `catch {}`. The signal fires but `add()` never gets called. Add targeted logs inside `if` blocks, not just before them, when debugging silent failures.
