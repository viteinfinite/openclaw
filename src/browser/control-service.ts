import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { startBrowserBridgeServer } from "./bridge-server.js";
import { resolveBrowserConfig, resolveProfile } from "./config.js";
import { ensureBrowserControlAuth } from "./control-auth.js";
import { ensureChromeExtensionRelayServer } from "./extension-relay.js";
import {
  type BrowserServerState,
  createBrowserRouteContext,
  listKnownProfileNames,
} from "./server-context.js";

let state: BrowserServerState | null = null;
const log = createSubsystemLogger("browser");
const logService = log.child("service");

export function getBrowserControlState(): BrowserServerState | null {
  return state;
}

export function createBrowserControlContext() {
  return createBrowserRouteContext({
    getState: () => state,
    refreshConfigFromDisk: true,
  });
}

export async function startBrowserControlServiceFromConfig(): Promise<BrowserServerState | null> {
  if (state) {
    return state;
  }

  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  if (!resolved.enabled) {
    return null;
  }
  try {
    const ensured = await ensureBrowserControlAuth({ cfg });
    if (ensured.generatedToken) {
      logService.info("No browser auth configured; generated gateway.auth.token automatically.");
    }
  } catch (err) {
    logService.warn(`failed to auto-configure browser auth: ${String(err)}`);
  }

  state = {
    server: null,
    port: resolved.controlPort,
    resolved,
    profiles: new Map(),
  };

  // If any profile uses the Chrome extension relay, start the local relay server eagerly
  // so the extension can connect before the first browser action.
  for (const name of Object.keys(resolved.profiles)) {
    const profile = resolveProfile(resolved, name);
    if (!profile || profile.driver !== "extension") {
      continue;
    }
    await ensureChromeExtensionRelayServer({ cdpUrl: profile.cdpUrl }).catch((err) => {
      logService.warn(`Chrome extension relay init failed for profile "${name}": ${String(err)}`);
    });
  }

  logService.info(
    `Browser control service ready (profiles=${Object.keys(resolved.profiles).length})`,
  );
  return state;
}

export async function stopBrowserControlService(): Promise<void> {
  const current = state;
  if (!current) {
    return;
  }

  const ctx = createBrowserRouteContext({
    getState: () => state,
    refreshConfigFromDisk: true,
  });

  try {
    for (const name of listKnownProfileNames(current)) {
      try {
        await ctx.forProfile(name).stopRunningBrowser();
      } catch {
        // ignore
      }
    }
  } catch (err) {
    logService.warn(`openclaw browser stop failed: ${String(err)}`);
  }

  state = null;

  // Optional: Playwright is not always available (e.g. embedded gateway builds).
  try {
    const mod = await import("./pw-ai.js");
    await mod.closePlaywrightBrowserConnection();
  } catch {
    // ignore
  }
}

type BrowserBridgeAuth = {
  token?: string;
  password?: string;
};

let sandboxBridgeServer: Awaited<ReturnType<typeof startBrowserBridgeServer>> | null = null;

export async function startBrowserControlServiceWithSandboxAccess(params: {
  bridgeAuth: BrowserBridgeAuth;
}): Promise<Awaited<ReturnType<typeof startBrowserBridgeServer>> | null> {
  // If the main browser control service is already running, return early
  if (state && state.server) {
    // The service is already running; we'd need to know its port to construct the URL
    // For now, return null and let the caller handle it
    return null;
  }

  // Start the browser control service to initialize the state
  const started = await startBrowserControlServiceFromConfig();
  if (!started) {
    return null;
  }

  // Now start a bridge server that binds to all interfaces for sandbox access
  try {
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    sandboxBridgeServer = await startBrowserBridgeServer({
      resolved,
      host: "0.0.0.0",
      port: 0,
      authToken: params.bridgeAuth.token,
      authPassword: params.bridgeAuth.password,
      allowSandboxAccess: true,
    });
    logService.info(
      `Sandbox-accessible browser bridge server started on port ${sandboxBridgeServer.port}`,
    );
    return sandboxBridgeServer;
  } catch (err) {
    logService.error(`Failed to start sandbox-accessible browser bridge: ${String(err)}`);
    return null;
  }
}

export async function stopSandboxAccessibleBrowserBridge(): Promise<void> {
  if (sandboxBridgeServer) {
    try {
      await (
        await import("./bridge-server.js")
      ).stopBrowserBridgeServer(sandboxBridgeServer.server);
    } catch {
      // ignore
    }
    sandboxBridgeServer = null;
  }
}
