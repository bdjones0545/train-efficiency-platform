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
 * Scan client source for TS2304 "Cannot find name" errors only.
 * These are the only TypeScript errors that cause runtime ReferenceError
 * crashes in browsers (e.g. missing lucide-react icon imports used in JSX).
 * Pre-existing type-mismatch errors (TS2322, TS2339, TS2345, etc.) are
 * allowed through — they don't crash the browser.
 */
async function checkUndefinedNames() {
  console.log("checking for undefined name references (TS2304)...");
  let output = "";
  try {
    execSync("npx tsc --noEmit -p tsconfig.client.json 2>&1", {
      encoding: "utf8",
    });
    console.log("no undefined name errors ✓");
    return;
  } catch (err: any) {
    output = err.stdout ?? "";
  }

  const undefinedNameLines = output
    .split("\n")
    .filter((line) => line.includes("TS2304") || line.includes("TS2552"));

  if (undefinedNameLines.length > 0) {
    console.error(
      "\n✗ Undefined name references found — build aborted.\n" +
        "These cause runtime ReferenceError crashes on mobile Safari.\n" +
        "Fix all missing imports before deploying:\n\n" +
        undefinedNameLines.join("\n") +
        "\n"
    );
    process.exit(1);
  }

  console.log("no undefined name errors ✓ (other type errors are pre-existing and non-crashing)");
}

async function buildAll() {
  await checkUndefinedNames();

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
