import { Bashlet } from "@bashlet/sdk";
import type { Config } from "../config.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxOptions {
  codebasePath: string;
  kubeConfigPath: string;
  timeout?: number;
}

let bashletInstance: Bashlet | null = null;

export function createSandbox(options: SandboxOptions): Bashlet {
  if (bashletInstance) {
    return bashletInstance;
  }

  bashletInstance = new Bashlet({
    mounts: [
      { hostPath: options.codebasePath, guestPath: "/workspace" },
      { hostPath: options.kubeConfigPath, guestPath: "/root/.kube" },
    ],
    workdir: "/workspace",
    timeout: options.timeout || 120,
    envVars: [
      { key: "KUBECONFIG", value: "/root/.kube/config" },
      { key: "HOME", value: "/root" },
    ],
  });

  return bashletInstance;
}

export function getSandbox(): Bashlet {
  if (!bashletInstance) {
    throw new Error("Sandbox not initialized. Call createSandbox first.");
  }
  return bashletInstance;
}

export async function execCommand(command: string): Promise<CommandResult> {
  const sandbox = getSandbox();
  try {
    const result = await sandbox.exec(command);
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
  const sandbox = getSandbox();
  try {
    const content = await sandbox.readFile(path);
    return content;
  } catch (error) {
    throw new Error(
      `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function listDir(path: string): Promise<string[]> {
  const sandbox = getSandbox();
  try {
    const output = await sandbox.listDir(path);
    // listDir returns a newline-separated string of entries
    return output.split("\n").filter((line) => line.trim().length > 0);
  } catch (error) {
    throw new Error(
      `Failed to list directory ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function initSandboxFromConfig(config: Config): Bashlet {
  return createSandbox({
    codebasePath: config.codebasePath,
    kubeConfigPath: config.kubeConfigPath,
    timeout: 120,
  });
}
