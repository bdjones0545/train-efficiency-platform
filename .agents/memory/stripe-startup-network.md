---
name: Stripe startup network side effect
description: Existing app startup can contact Stripe, relevant to strict offline Stripe verification.
---

Do not restart the application during a Stripe remediation that explicitly prohibits Stripe network access unless the startup initializer has first been isolated or disabled for that run.

**Why:** The existing startup Stripe initializer attempted to contact Stripe with the configured test credential during a workflow restart, independently of webhook tests or the marketplace handler.

**How to apply:** Use deterministic signing, local HTTP, and disposable-database tests without an app restart for no-network validation. If a restart is necessary, disclose the side effect and do not perform subsequent Stripe network actions.