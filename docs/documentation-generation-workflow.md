---
Document Type: Governance
Verification Status: N/A
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Documentation Generation Workflow

When creating documentation under `/docs`, do not rely primarily on existing
documentation or assumptions.

Instead, treat the repository as the source of truth.

For each document:

1. Scan the entire codebase relevant to the subsystem.
2. Identify all major components automatically.
3. Infer architecture from the implementation.
4. Cross-reference existing documentation.
5. Generate the documentation using `docs/_template.md`.
6. Highlight any uncertainties separately rather than guessing.
7. Identify missing documentation opportunities.
8. Suggest architectural inconsistencies if discovered.

Documentation should describe the implementation that actually exists—not the
implementation we hope exists.

When implementation and documentation disagree, report the discrepancy rather than
silently choosing one.

The objective is to make `/docs` a continuously accurate representation of the
repository.
