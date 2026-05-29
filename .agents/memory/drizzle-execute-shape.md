---
name: Drizzle db.execute() response shape
description: db.execute() can return an array or a QueryResult object depending on context — always guard; silent catch{} blocks hide bugs.
---

## Rule
Never assume `db.execute(sql`...`)` returns a plain array. Always handle both shapes:

```typescript
const rawRows = await db.execute(sql`SELECT ...`);
const row = Array.isArray(rawRows) ? (rawRows as any[])[0] : (rawRows as any)?.rows?.[0];
```

**Why:** In some drizzle-orm + node-postgres configurations, `db.execute()` returns a `QueryResult` object (with `.rows` property) rather than a plain array. Destructuring `const [row] = result` throws `TypeError: result is not iterable` silently when the result is a non-iterable object — caught by `catch {}` blocks and returning fallbacks.

**How to apply:** Any time you write `const [x] = await db.execute(...)`, replace with the Array.isArray guard pattern above. Also applies to `getOrgAvgServicePrice()` and any other helper that uses single-row COUNT or AVG queries.

## Bonus trap: variable rename inside catch{} scope
If you rename a variable used in a large object literal (e.g., `weekEnd` → `weekEndIso`) and miss one reference deep in a metadata block, it throws `ReferenceError` caught silently by `catch {}`. The signal fires (diagnostic log appears) but `add()` never gets called because the exception happens inside the `if` block. Add targeted logs inside `if` blocks, not just before them, when debugging silent failures.
