// Seeds the demo workspace on boot when SEED_DEMO=1 (idempotent: skips if it already exists).
import { execSync } from "node:child_process";
if (process.env.SEED_DEMO === "1") {
  try {
    execSync("npx tsx scripts/seed.ts", { stdio: "inherit" });
  } catch (e) {
    console.error("Demo seed failed (continuing):", e.message);
  }
}
