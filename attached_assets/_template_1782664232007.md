---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---

# [Document Title]

Every document in `/docs` should follow the same structure.

---

## Document Status

Every document generated from this template should open with its own YAML
frontmatter block:

```yaml
---
Document Type: Governance | Architecture | Implementation | Operations | Reference
Verification Status: N/A | Architecture Specification | Partially Verified | Verified Against Source | Verified Against Production
Last Reviewed: <date>
Owner: <accountable team or role>
---
```

`Document Type` and `Verification Status` vary independently — see
`docs/documentation-status-legend.md` for the full classification system and which
combinations apply to which kinds of documents. Governance documents always use
`Verification Status: N/A`; Architecture, Implementation, and Operations documents
progress through the verification sequence as they're checked against the real
codebase.

---

## Purpose

What this subsystem exists to accomplish.

---

## Responsibilities

What this subsystem owns.

---

## Does NOT Own

What belongs elsewhere.

---

## Architecture

High-level design.

---

## Components

Major modules.

---

## Data Flow

How information moves through the subsystem.

---

## Dependencies

Internal dependencies.

External dependencies.

---

## Security Considerations

Authentication.

Authorization.

Data ownership.

Validation.

---

## Failure Modes

Common failures.

Recovery strategies.

---

## Performance Considerations

Scalability.

Caching.

Indexes.

Concurrency.

---

## Future Improvements

Known opportunities.

Technical debt.

Planned evolution.

---

## Related Documentation

Links to other documents.

---

## Last Updated

Date

Author

Version
