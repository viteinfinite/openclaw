#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(skillDir, "package", "dist", "cli.js");
if (!existsSync(cliPath)) {
  console.error(`virb skill package is missing: ${cliPath}`);
  process.exit(1);
}

const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
