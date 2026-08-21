# Test suites

`config/test-suites.json` is the machine-readable source of truth for the existing test landscape. The runner invokes existing files without changing their assertions.

| Command | Purpose | Infrastructure | Mutation |
| --- | --- | --- | --- |
| `npm test` | Safe default: unit, security, and source-inspection tests | None | None |
| `npm run test:unit` | Unit and source-inspection tests | None | None |
| `npm run test:security` | Logging, auth, tenant, and secret regressions | None | None |
| `npm run test:db` | DB integration tests | `TEST_DATABASE_URL` | Test DB writes |
| `npm run test:server` | Live API tests | `TEST_BASE_URL` | May write through test API |
| `npm run test:e2e` | Browser tests | Not configured | None |
| `npm run test:all` | Default plus every available infrastructure suite | As above | As above |

The safe suites replace any inherited `DATABASE_URL` with an unreachable loopback sentinel. This supports modules that validate the variable while ensuring an accidental query cannot reach a real database. They require no provider credentials and do not start a server.

The DB runner deliberately ignores `DATABASE_URL`; set `TEST_DATABASE_URL` to an isolated, disposable PostgreSQL database. Existing DB tests write data and may clean up their own fixtures, so never point it at production or shared data.

The server runner requires an already-running, non-production API in `TEST_BASE_URL` and checks reachability before launching tests. Missing infrastructure is reported as `ENVIRONMENT NOT AVAILABLE`, not as assertion failures. `test:all` marks unavailable optional suites `SKIPPED`; directly requesting one returns exit code 2.

No browser framework or E2E test exists in the repository, so `test:e2e` reports the environment as unavailable. Three unit-like provider tests remain manual because importing them reaches real DB/provider paths; `slack-alert-phase2c.test.ts` also has pre-existing policy assertion failures. `server/tests/connector-layer.test.ts` and `test-wiring.ts` remain manual because they mix infrastructure, and the latter performs explicit database writes and deletes.
