# Test suites

`config/test-suites.json` is the machine-readable source of truth for the existing test landscape. The runner invokes existing files without changing their assertions.

| Command | Purpose | Infrastructure | Mutation |
| --- | --- | --- | --- |
| `npm test` | Safe default: unit, security, and source-inspection tests | None | None |
| `npm run test:unit` | Unit and source-inspection tests | None | None |
| `npm run test:security` | Logging, auth, tenant, and secret regressions | None | None |
| `npm run test:db` | DB integration tests, each file in its own clone database; runs in CI (`db-tests` job, postgres:16 service, schema built with `drizzle-kit push --force`) | `TEST_DATABASE_URL` (a template database) plus a role allowed to `CREATE DATABASE` | Clone DB writes; the template is only read |
| `npm run test:server` | Live API tests | `TEST_BASE_URL` | May write through test API |
| `npm run test:e2e` | Browser tests | Not configured | None |
| `npm run test:all` | Default plus every available infrastructure suite | As above | As above |

The safe suites replace any inherited `DATABASE_URL` with an unreachable loopback sentinel. This supports modules that validate the variable while ensuring an accidental query cannot reach a real database. They require no provider credentials and do not start a server.

The DB runner deliberately ignores `DATABASE_URL`; set `TEST_DATABASE_URL` to an isolated, disposable PostgreSQL database whose schema was built with `drizzle-kit push`. Existing DB tests write data and may clean up their own fixtures, so never point it at production or shared data.

## Per-file database isolation in the `db` suite

The database `TEST_DATABASE_URL` names is a **template**, not the database the tests run in. For each file the runner executes

```
CREATE DATABASE "<template>_f<N>" TEMPLATE "<template>"
```

from the `postgres` maintenance database, runs `node --import tsx <file>` as its own child process with `DATABASE_URL` and `TEST_DATABASE_URL` pointing at that clone, and then drops the clone with `DROP DATABASE ... WITH (FORCE)`. Nothing is left behind on a normal or a failing run.

The file is run **directly**, not under `node --test`. `node:test` executes the tests and sets a non-zero exit code either way, but `--test` makes the runner a supervisor that spawns the file in a further child and parses a serialized stream back from it. That parser is where Node's `Unable to deserialize cloned data due to invalid or unsupported version` comes from; on Node 20 it failed `stripe-webhook.test.ts` in CI *after* all 15 of its subtests had passed.

This exists because 21 of the db files execute destructive DDL to build the tables they assert on. `server/tests/cashout-tenant-isolation.test.ts:38` runs `DROP TABLE IF EXISTS revenue_ledger_events,cashouts,coach_profiles,user_profiles,users CASCADE`, and `CASCADE` also drops the foreign keys on `bookings`, `booking_participants`, `availability_blocks` and `blocked_times`. Against one shared database, every later file calling `runApplicationMigrations()` then failed in `validateExistingBaseline`. Running one file at a time ordered that damage; it never prevented it. 

Requirements:

- The role in `TEST_DATABASE_URL` must be allowed to `CREATE DATABASE` — true for the CI `postgres` superuser and for a typical local development superuser.
- The template must already have tables. If it does not, the runner fails immediately and tells you to run `DATABASE_URL="$TEST_DATABASE_URL" node ./node_modules/drizzle-kit/bin.cjs push --force` rather than reporting dozens of confusing assertion failures.
- `CREATE DATABASE ... TEMPLATE` requires that no other session is connected to the template, so the runner never holds a connection to it while cloning. If a stray session still blocks a clone, the runner terminates only sessions owned by its own role and retries once.

The runner accepts `--jobs N` (`npm run test:db -- --jobs 4`). It defaults to 1, matching the manifest's `serial: true`; the per-file database is what makes a higher value possible at all, but the suite is not run in parallel today.

The server runner requires an already-running, non-production API in `TEST_BASE_URL` and checks reachability before launching tests. Missing infrastructure is reported as `ENVIRONMENT NOT AVAILABLE`, not as assertion failures. `test:all` marks unavailable optional suites `SKIPPED`; directly requesting one returns exit code 2.

No browser framework or E2E test exists in the repository, so `test:e2e` reports the environment as unavailable. Three unit-like provider tests remain manual because importing them reaches real DB/provider paths; `slack-alert-phase2c.test.ts` also has pre-existing policy assertion failures. `server/tests/connector-layer.test.ts` and `test-wiring.ts` remain manual because they mix infrastructure, and the latter performs explicit database writes and deletes.
