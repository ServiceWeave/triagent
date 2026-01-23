import { Bashlet, type SshOptions } from "@bashlet/sdk";
import { $ } from "bun";
import { readFile as fsReadFile, readdir } from "fs/promises";
import type { Config, CodebaseEntry } from "../config.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxOptions {
  codebasePaths: CodebaseEntry[];
  kubeConfigPath: string;
  timeout?: number;
  useHost?: boolean;
  /** Backend to use: 'docker' (default), 'ssh', 'wasm', 'microvm', or 'auto' */
  backend?: "docker" | "ssh" | "wasm" | "microvm" | "auto";
  /** SSH configuration (required when backend='ssh') */
  ssh?: {
    host: string;
    user: string;
    port?: number;
    keyFile?: string;
  };
}

// Map user-friendly backend names to Bashlet SDK names
type BashletBackend = "wasmer" | "firecracker" | "docker" | "ssh" | "auto";
const backendMap: Record<NonNullable<SandboxOptions["backend"]>, BashletBackend> = {
  wasm: "wasmer",
  microvm: "firecracker",
  docker: "docker",
  ssh: "ssh",
  auto: "auto",
};

// Sandbox state
let bashletInstance: Bashlet | null = null;
let hostMode = false;
let hostWorkdir = "./";
let currentBackend: SandboxOptions["backend"] | null = null;

export async function createSandbox(options: SandboxOptions): Promise<void> {
  hostMode = options.useHost ?? false;
  hostWorkdir = options.codebasePaths[0]?.path || "./";

  // Host mode: bypass Bashlet entirely
  if (hostMode) {
    return;
  }

  // Reuse existing instance if already initialized
  if (bashletInstance) {
    return;
  }

  const backend = options.backend || "docker";
  currentBackend = backend;
  const bashletBackend = backendMap[backend];

  // SSH backend requires special configuration
  if (backend === "ssh") {
    if (!options.ssh) {
      throw new Error("SSH configuration required when using ssh backend");
    }

    const sshOptions: SshOptions = {
      host: options.ssh.host,
      user: options.ssh.user,
      port: options.ssh.port,
      keyFile: options.ssh.keyFile,
      useControlMaster: true,
      connectTimeout: 30,
    };

    bashletInstance = new Bashlet({
      backend: bashletBackend,
      ssh: sshOptions,
      workdir: "/workspace",
      timeout: options.timeout || 120,
    });

    return;
  }

  // All other backends (docker, wasm, microvm, auto) use mounts
  const codebaseMounts = options.codebasePaths.map((entry) => ({
    hostPath: entry.path,
    guestPath: `/workspace/${entry.name}`,
  }));

  bashletInstance = new Bashlet({
    backend: bashletBackend,
    mounts: [
      ...codebaseMounts,
      { hostPath: options.kubeConfigPath, guestPath: "/root/.kube" },
    ],
    workdir: "/workspace",
    timeout: options.timeout || 120,
    envVars: [
      { key: "KUBECONFIG", value: "/root/.kube/config" },
      { key: "HOME", value: "/root" },
    ],
  });
}

export function isHostMode(): boolean {
  return hostMode;
}

export function isRemoteMode(): boolean {
  return currentBackend === "ssh";
}

export function getBackend(): SandboxOptions["backend"] | "host" | null {
  if (hostMode) return "host";
  return currentBackend;
}

export function getRemoteInfo(): { target: string; workdir: string } | null {
  if (currentBackend !== "ssh" || !bashletInstance) return null;
  return { target: "ssh", workdir: "/workspace" };
}

export async function execCommand(command: string): Promise<CommandResult> {
  // Host mode: execute locally
  if (hostMode) {
    try {
      const result = await $`sh -c ${command}`.cwd(hostWorkdir).nothrow().quiet();
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: result.exitCode,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  }

  // Sandbox or SSH mode: execute via bashlet
  if (!bashletInstance) {
    throw new Error("Sandbox not initialized. Call createSandbox first.");
  }

  try {
    const result = await bashletInstance.exec(command);
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode ?? 0,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
}

export async function readFile(path: string): Promise<string> {
  // Host mode: read locally
  if (hostMode) {
    const fullPath = path.startsWith("/") ? path : `${hostWorkdir}/${path}`;
    try {
      return await fsReadFile(fullPath, "utf-8");
    } catch (error) {
      throw new Error(
        `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Sandbox or SSH mode: read via bashlet
  if (!bashletInstance) {
    throw new Error("Sandbox not initialized. Call createSandbox first.");
  }

  try {
    const content = await bashletInstance.readFile(path);
    return content;
  } catch (error) {
    throw new Error(
      `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function listDir(path: string): Promise<string[]> {
  // Host mode: list locally
  if (hostMode) {
    const fullPath = path.startsWith("/") ? path : `${hostWorkdir}/${path}`;
    try {
      const entries = await readdir(fullPath);
      return entries;
    } catch (error) {
      throw new Error(
        `Failed to list directory ${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Sandbox or SSH mode: list via bashlet
  if (!bashletInstance) {
    throw new Error("Sandbox not initialized. Call createSandbox first.");
  }

  try {
    const output = await bashletInstance.listDir(path);
    return output.split("\n").filter((line) => line.trim().length > 0);
  } catch (error) {
    throw new Error(
      `Failed to list directory ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function initSandboxFromConfig(
  config: Config,
  options: {
    useHost?: boolean;
    backend?: "docker" | "ssh" | "wasm" | "microvm" | "auto";
    ssh?: { host: string; user: string; port?: number; keyFile?: string };
  } = {}
): Promise<void> {
  await createSandbox({
    codebasePaths: config.codebasePaths,
    kubeConfigPath: config.kubeConfigPath,
    timeout: 120,
    useHost: options.useHost,
    backend: options.backend,
    ssh: options.ssh,
  });
}
