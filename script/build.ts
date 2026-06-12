import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

/**
 * Full TypeScript typecheck — any error aborts the build.
 * Runs against the client tsconfig so Vite aliases are respected.
 */
async function typecheckClient() {
  console.log("typechecking client (tsc --noEmit)...");
  try {
    execSync("npx tsc --noEmit -p tsconfig.client.json 2>&1", {
      encoding: "utf8",
      stdio: "pipe",
    });
    console.log("typecheck passed ✓");
  } catch (err: any) {
    const output: string = err.stdout ?? err.stderr ?? String(err);
    console.error(
      "\n✗ TypeScript errors found — build aborted.\n" +
        "Fix all errors before deploying:\n\n" +
        output +
        "\n"
    );
    process.exit(1);
  }
}

async function buildAll() {
  await typecheckClient();

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
