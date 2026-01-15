import { Bashlet } from "@bashlet/sdk";
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
}

let bashletInstance: Bashlet | null = null;
let hostMode = false;
let hostWorkdir = "./";

export function createSandbox(options: SandboxOptions): void {
  hostMode = options.useHost ?? false;
  // Use first codebase as default working directory
  hostWorkdir = options.codebasePaths[0]?.path || "./";

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

export async function execCommand(command: string): Promise<CommandResult> {
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

export function initSandboxFromConfig(config: Config, useHost: boolean = false): void {
  createSandbox({
    codebasePaths: config.codebasePaths,
    kubeConfigPath: config.kubeConfigPath,
    timeout: 120,
    useHost,
  });
}
