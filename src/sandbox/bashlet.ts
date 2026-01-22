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
  /** Backend to use: 'docker' (default) or 'ssh' */
  backend?: "docker" | "ssh";
  /** SSH configuration (required when backend='ssh') */
  ssh?: {
    host: string;
    user: string;
    port?: number;
    keyFile?: string;
  };
}

// Sandbox state
let bashletInstance: Bashlet | null = null;
let hostMode = false;
let hostWorkdir = "./";
let sshMode = false;
let sshWorkdir = "/workspace";

export async function createSandbox(options: SandboxOptions): Promise<void> {
  hostMode = options.useHost ?? false;
  hostWorkdir = options.codebasePaths[0]?.path || "./";

  // Handle SSH backend mode
  if (options.backend === "ssh" && options.ssh) {
    sshMode = true;

    const sshOptions: SshOptions = {
      host: options.ssh.host,
      user: options.ssh.user,
      port: options.ssh.port,
      keyFile: options.ssh.keyFile,
      useControlMaster: true,
      connectTimeout: 30,
    };

    bashletInstance = new Bashlet({
      backend: "ssh",
      ssh: sshOptions,
      workdir: sshWorkdir,
      timeout: options.timeout || 120,
    });

    return;
  }

  if (hostMode) {
    return;
  }

  if (bashletInstance) {
    return;
  }

  // Mount each codebase at /workspace/<name>
  const codebaseMounts = options.codebasePaths.map((entry) => ({
    hostPath: entry.path,
    guestPath: `/workspace/${entry.name}`,
  }));

  bashletInstance = new Bashlet({
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
  return sshMode;
}

export function getRemoteInfo(): { target: string; workdir: string; sessionId: string } | null {
  if (!sshMode || !bashletInstance) return null;
  // Return a placeholder - actual SSH details are managed by bashlet
  return { target: "ssh", workdir: sshWorkdir, sessionId: "bashlet-ssh" };
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
    backend?: "docker" | "ssh";
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
