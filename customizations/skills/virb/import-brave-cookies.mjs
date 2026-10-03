#!/usr/bin/env node
// ABOUTME: Extracts x.com auth cookies from a Brave profile and stores them in the macOS Keychain.
// ABOUTME: Values are never printed; only cookie names and target keychain service are logged.
//
// Usage:
//   node skills/virb/import-brave-cookies.mjs                 # auto-detect profile with x.com cookies
//   node skills/virb/import-brave-cookies.mjs --profile "Default"
//   node skills/virb/import-brave-cookies.mjs --profile "/path/to/Cookies"
//   node skills/virb/import-brave-cookies.mjs --service openclaw-bird
//   node skills/virb/import-brave-cookies.mjs --cookie-file ~/.config/bird/cookies.env
//   node skills/virb/import-brave-cookies.mjs --dry-run
//
// Then read them back at runtime with:
//   BIRD_KEYCHAIN_SERVICE=openclaw-bird ./skills/virb/run-auth.sh ...
//   BIRD_COOKIE_FILE=~/.config/bird/cookies.env ./skills/virb/run-auth.sh ...
//
// Note: an agent launched from a launchd "Background" session cannot read the login
// keychain ("User interaction is not allowed"), even with -A. In that case use
// --cookie-file, which writes a mode-0600 dotenv file the wrapper reads at runtime. (Do not
// name it --env-file: Node intercepts that flag before the script runs.)
//
// Notes:
//   * Requires an unlocked login keychain. Run it from Terminal (GUI session), not a
//     headless SSH/non-interactive shell, otherwise `security` returns "User interaction
//     is not allowed".
//   * By default the stored items allow any app to read them without prompting so the
//     agent wrapper works unattended. Pass --require-approval to omit that (macOS will
//     prompt on each read).
//   * The cookie value is passed to `security` as an argv argument for a brief moment
//     (unavoidable: `security -w` does not read from stdin). It is never written to disk
//     or stdout.

import { execFileSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const BRAVE_KEYCHAIN_SERVICE = "Brave Safe Storage";
const BRAVE_KEYCHAIN_ACCOUNT = "Brave";
const BRAVE_ROOT = path.join(
  homedir(),
  "Library",
  "Application Support",
  "BraveSoftware",
  "Brave-Browser",
);
const WANTED_COOKIES = ["auth_token", "ct0"];
const HOST_SUFFIXES = ["x.com", "twitter.com"];

function parseArgs(argv) {
  const opts = {
    profile: undefined,
    service: "openclaw-bird",
    account: BRAVE_KEYCHAIN_ACCOUNT,
    dryRun: false,
    requireApproval: false,
    envFile: undefined,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--profile" || arg === "-p") {
      opts.profile = next();
    } else if (arg === "--service" || arg === "-s") {
      opts.service = next();
    } else if (arg === "--brave-account") {
      opts.account = next();
    } else if (arg === "--cookie-file") {
      opts.envFile = next();
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--require-approval") {
      opts.requireApproval = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printUsage() {
  console.log(
    [
      "Import x.com cookies from Brave into the macOS Keychain.",
      "",
      "Usage: node skills/virb/import-brave-cookies.mjs [options]",
      "",
      "Options:",
      "  -p, --profile <name|path>  Brave profile dir name or path to its Cookies DB",
      "  -s, --service <name>       Keychain service to write (default: openclaw-bird)",
      "      --brave-account <name> Keychain account for Brave Safe Storage (default: Brave)",
      "      --require-approval     Do not grant silent read access (macOS prompts each read)",
      "      --cookie-file <path>   Write AUTH_TOKEN/CT0 to a 0600 file instead of the Keychain",
      "      --dry-run              Show what would be imported without touching the Keychain",
      "  -h, --help                 Show this help",
    ].join("\n"),
  );
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function hostMatches(hostKey) {
  const host = String(hostKey ?? "").replace(/^\./, "");
  return HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function resolveCookieDbs(profile) {
  if (profile) {
    if (existsSync(profile) && statSync(profile).isFile()) {
      return [profile];
    }
    const candidate = path.join(BRAVE_ROOT, profile, "Cookies");
    if (existsSync(candidate)) {
      return [candidate];
    }
    fail(`No Brave cookies DB at "${profile}" (looked for a file and ${candidate}).`);
  }

  if (!existsSync(BRAVE_ROOT)) {
    fail(`Brave profile root not found: ${BRAVE_ROOT}`);
  }
  const profileDirs = readdirSync(BRAVE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const ordered = [
    ...profileDirs.filter((name) => name === "Default"),
    ...profileDirs.filter((name) => name !== "Default").sort(),
  ];
  const dbs = ordered
    .map((name) => path.join(BRAVE_ROOT, name, "Cookies"))
    .filter((db) => existsSync(db));
  if (dbs.length === 0) {
    fail(`No Brave cookies DB found under ${BRAVE_ROOT}.`);
  }
  return dbs;
}

function readBravePassword(account) {
  const attempts = [
    ["-s", BRAVE_KEYCHAIN_SERVICE, "-a", account],
    ["-s", BRAVE_KEYCHAIN_SERVICE],
  ];
  let lastError = "";
  for (const extra of attempts) {
    try {
      const out = execFileSync("security", ["find-generic-password", "-w", ...extra], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const password = out.trim();
      if (password) {
        return password;
      }
    } catch (error) {
      lastError = error?.stderr?.toString().trim() || error?.message || "security exited non-zero";
    }
  }
  fail(
    `Could not read "${BRAVE_KEYCHAIN_SERVICE}" from the Keychain (${lastError}).\n` +
      "Run this from an unlocked GUI Terminal session. If the item is missing, launch Brave once and make sure it can save cookies.",
  );
}

function deriveKey(password) {
  // Chromium on macOS: PBKDF2(password, "saltysalt", 1003, 16, sha1).
  return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

function removePkcs7Padding(value) {
  if (value.length === 0) {
    return value;
  }
  const padding = value[value.length - 1];
  if (!padding || padding > 16) {
    return value;
  }
  return value.subarray(0, value.length - padding);
}

function stripLeadingControlChars(value) {
  let i = 0;
  while (i < value.length && value.charCodeAt(i) < 0x20) {
    i += 1;
  }
  return value.slice(i);
}

function decodeCookieValue(plaintext, stripHashPrefix) {
  const bytes = stripHashPrefix && plaintext.length >= 32 ? plaintext.subarray(32) : plaintext;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return stripLeadingControlChars(decoded);
  } catch {
    return null;
  }
}

function decryptCookieValue(encryptedValue, key, stripHashPrefix) {
  const buf = Buffer.isBuffer(encryptedValue) ? encryptedValue : Buffer.from(encryptedValue);
  if (buf.length < 3) {
    return null;
  }
  const prefix = buf.subarray(0, 3).toString("utf8");
  if (!/^v\d\d$/.test(prefix)) {
    // Occasionally Chromium stores plaintext in encrypted_value.
    return decodeCookieValue(buf, false);
  }
  const ciphertext = buf.subarray(3);
  if (ciphertext.length === 0) {
    return "";
  }
  try {
    const iv = Buffer.alloc(16, 0x20); // Chromium's legacy IV is 16 spaces.
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(false);
    const plaintext = removePkcs7Padding(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]),
    );
    return decodeCookieValue(plaintext, stripHashPrefix);
  } catch {
    return null;
  }
}

function chromeExpiryToMs(expiresUtc) {
  const value = Number(expiresUtc);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  // Chromium epoch: microseconds since 1601-01-01 UTC.
  return value / 1000 - 11644473600000;
}

async function readCookiesFromDb(dbPath, key) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "openclaw-brave-"));
  const tempDb = path.join(tempDir, "Cookies");
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${dbPath}${suffix}`;
    if (existsSync(from)) {
      copyFileSync(from, `${tempDb}${suffix}`);
    }
  }

  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...args) => {
    const message =
      typeof warning === "string" ? warning : (warning?.message ?? warning?.type ?? "");
    if (typeof message === "string" && message.includes("SQLite is an experimental feature")) {
      return;
    }
    return originalEmitWarning(warning, ...args);
  };

  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(tempDb, { readOnly: true });
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
    const version = Number.parseInt(meta?.value ?? "0", 10) || 0;
    const stripHashPrefix = version >= 24;

    // expires_utc can exceed Number.MAX_SAFE_INTEGER; cast it to TEXT so
    // node:sqlite does not throw while decoding the row.
    const rows = db
      .prepare(
        "SELECT name, host_key, encrypted_value, CAST(expires_utc AS TEXT) AS expires_utc " +
          "FROM cookies WHERE name IN (?, ?)",
      )
      .all(WANTED_COOKIES[0], WANTED_COOKIES[1]);

    const found = new Map();
    for (const row of rows) {
      if (!WANTED_COOKIES.includes(row.name) || !hostMatches(row.host_key)) {
        continue;
      }
      const value = decryptCookieValue(row.encrypted_value, key, stripHashPrefix);
      if (!value) {
        continue;
      }
      const expiryMs = chromeExpiryToMs(row.expires_utc);
      const existing = found.get(row.name);
      const isExpired = expiryMs !== undefined && expiryMs < Date.now();
      if (isExpired && existing && !existing.expired) {
        continue;
      }
      if (!existing || isExpired === false || existing.expired) {
        found.set(row.name, { value, expired: isExpired });
      }
    }
    return found;
  } finally {
    db?.close();
    process.emitWarning = originalEmitWarning;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function storeInKeychain(service, account, value, { requireApproval }) {
  const args = ["add-generic-password", "-U", "-s", service, "-a", account];
  if (!requireApproval) {
    args.push("-A"); // Allow any application to read without prompting.
  }
  args.push("-w", value);
  try {
    execFileSync("security", args, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || "unknown error";
    fail(`Failed to store ${account} in the Keychain (${detail}).`);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  const dbs = resolveCookieDbs(opts.profile);
  const password = readBravePassword(opts.account);
  const key = deriveKey(password);

  const collected = new Map();
  const sources = new Map();
  for (const dbPath of dbs) {
    const cookies = await readCookiesFromDb(dbPath, key);
    for (const [name, entry] of cookies) {
      if (!collected.has(name)) {
        collected.set(name, entry);
        sources.set(name, dbPath);
      }
    }
    if (WANTED_COOKIES.every((name) => collected.has(name))) {
      break;
    }
  }

  const missing = WANTED_COOKIES.filter((name) => !collected.has(name));
  for (const name of collected.keys()) {
    const source = sources.get(name);
    console.log(`found ${name} in ${source}`);
  }
  for (const name of missing) {
    console.warn(`warning: ${name} not found in any Brave profile`);
  }
  if (missing.length === WANTED_COOKIES.length) {
    fail(
      "No x.com auth cookies found. Make sure Brave is logged into x.com in the selected profile.",
    );
  }

  if (opts.dryRun) {
    console.log(
      `dry-run: would store ${[...collected.keys()].join(", ")} in service "${opts.service}"`,
    );
    return;
  }

  if (opts.envFile) {
    const lines = [];
    if (collected.has("auth_token")) {
      lines.push(`AUTH_TOKEN=${collected.get("auth_token").value}`);
    }
    if (collected.has("ct0")) {
      lines.push(`CT0=${collected.get("ct0").value}`);
    }
    mkdirSync(path.dirname(path.resolve(opts.envFile)), { recursive: true });
    writeFileSync(path.resolve(opts.envFile), `${lines.join("\n")}\n`, { mode: 0o600 });
    console.log(
      `wrote ${[...collected.keys()].join(", ")} to ${path.resolve(opts.envFile)} (mode 0600)`,
    );
    console.log("");
    console.log("Run with:");
    console.log(
      `  BIRD_COOKIE_FILE=${path.resolve(opts.envFile)} ./skills/virb/run-auth.sh whoami`,
    );
    return;
  }

  for (const [name, entry] of collected) {
    const account = name === "auth_token" ? "AUTH_TOKEN" : "CT0";
    storeInKeychain(opts.service, account, entry.value, opts);
    console.log(`stored ${account} in Keychain service "${opts.service}"`);
  }

  if (missing.includes("ct0")) {
    console.warn(
      "warning: ct0 missing; requests may fail until Brave has a fresh ct0 (open x.com once).",
    );
  }
  console.log("");
  console.log("Run with:");
  console.log(`  BIRD_KEYCHAIN_SERVICE=${opts.service} ./skills/virb/run-auth.sh whoami`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
