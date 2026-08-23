import { pool } from "../server/db";
import { runApplicationMigrations } from "../server/application-migrations";

try {
  await runApplicationMigrations(pool);
} finally {
  await pool.end();
}
