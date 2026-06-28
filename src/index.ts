import { config } from "./config";
import { DebugTools } from "./debug/DebugTools";

async function main(): Promise<void> {
  const phaseRaw = (process.env.PHASE ?? "full").toLowerCase();

  // Print the loaded config (mask password).
  const safeCfg = { ...config, password: "***" };
  console.log("Loaded config:", safeCfg);
  console.log(`PHASE env = "${process.env.PHASE ?? "(unset)"}" -> resolved to "${phaseRaw}"`);

  if (phaseRaw === "1") {
    // --- PHASE 1: Setup & Config ---
    const dt = new DebugTools();

    // Self-debug: typecheck
    const { execSync } = await import("node:child_process");
    let tscOk = false;
    try {
      execSync("npx tsc --noEmit", {
        cwd: process.cwd(),
        stdio: "pipe",
        encoding: "utf-8",
      });
      tscOk = true;
    } catch {
      tscOk = false;
    }
    dt.check("tsc clean", tscOk);
    dt.check("config complete", config.loginIp.length > 0);

    dt.report(1, "IDLE -> CONFIG_LOADED", {
      loginIp: config.loginIp,
      loginPort: String(config.loginPort),
      gamePort: String(config.gamePort),
      serverId: String(config.serverId),
      charSlot: String(config.charSlot),
      protocol: String(config.protocol),
    });
    return;
  }

  // Future phases will be dispatched here.
  console.log(`Phase "${phaseRaw}" is not yet implemented.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
