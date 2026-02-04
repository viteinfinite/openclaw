export type SandboxDockerConfig = {
  image: string;
  containerPrefix: string;
  workdir: string;
  readOnlyRoot: boolean;
  tmpfs: string[];
  network: string;
  user?: string;
  capDrop: string[];
  env?: Record<string, string>;
  setupCommand?: string;
  pidsLimit?: number;
  memory?: string | number;
  memorySwap?: string | number;
  cpus?: number;
  ulimits?: Record<string, string | number | { soft?: number; hard?: number }>;
  seccompProfile?: string;
  apparmorProfile?: string;
  dns?: string[];
  extraHosts?: string[];
  binds?: string[];
  /**
   * Path to a directory on the host containing readonly files (SOUL.md, TOOLS.md, etc.)
   * that will be bind-mounted individually into the sandbox workspace as readonly.
   * Protected files: SOUL.md, TOOLS.md, AGENTS.md, IDENTITY.md, USER.md, HEARTBEAT.md
   */
  readonlyFilesDir?: string;
};
