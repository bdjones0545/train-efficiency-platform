import { pool } from "../server/db";
import { runApplicationMigrations } from "../server/application-migrations";
import { initializeRequiredSchema } from "../server/schema-bootstrap";
import { initializeRequiredFeatureSchemas } from "../server/required-feature-schemas";

try {
  await runApplicationMigrations(pool);
  await initializeRequiredSchema(pool);
  await initializeRequiredFeatureSchemas(pool);
} finally {
  await pool.end();
}
