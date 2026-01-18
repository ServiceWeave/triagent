import { Bashlet } from "@bashlet/sdk";
import { $ } from "bun";
import { readFile as fsReadFile, readdir } from "fs/promises";
import { randomBytes } from "crypto";
import { Client, type ConnectConfig, type ClientChannel, type SFTPWrapper } from "ssh2";
import { homedir } from "os";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Config, CodebaseEntry } from "../config.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RemoteConfig {
  /** SSH connection string: user@host or user@host:port */
  target: string;
  /** Path to private key (defaults to ~/.ssh/id_rsa, ~/.ssh/id_ed25519) */
  privateKeyPath?: string;
  /** SSH port (default: 22) */
  port?: number;
}

export interface SandboxOptions {
  codebasePaths: CodebaseEntry[];
  kubeConfigPath: string;
  timeout?: number;
  useHost?: boolean;
  remote?: RemoteConfig;
}

// Sandbox state
let bashletInstance: Bashlet | null = null;
let hostMode = false;
let hostWorkdir = "./";

// Remote SSH state
let remoteConfig: RemoteConfig | null = null;
let remoteWorkdir: string | null = null;
let sessionId: string | null = null;
let sshClient: Client | null = null;
let sshShell: ClientChannel | null = null;
let sftpClient: SFTPWrapper | null = null;
let shellBuffer = "";
let shellReady = false;

/** Parse target string into user, host, port */
function parseTarget(target: string): { user: string; host: string; port: number } {
  let user = "root";
  let host = target;
  let port = 22;

  // Parse user@host:port format
  if (target.includes("@")) {
    [user, host] = target.split("@");
  }
  if (host.includes(":")) {
    const parts = host.split(":");
    host = parts[0];
    port = parseInt(parts[1], 10);
  }

  return { user, host, port };
}

/** Find SSH private key */
function findPrivateKey(customPath?: string): Buffer | undefined {
  const paths = customPath
    ? [customPath]
    : [
        join(homedir(), ".ssh", "id_ed25519"),
        join(homedir(), ".ssh", "id_rsa"),
        join(homedir(), ".ssh", "id_ecdsa"),
      ];

  for (const p of paths) {
    if (existsSync(p)) {
      return readFileSync(p);
    }
  }
  return undefined;
}

/** Connect to SSH server and establish persistent shell */
async function connectSSH(config: RemoteConfig): Promise<void> {
  const { user, host, port } = parseTarget(config.target);
  const privateKey = findPrivateKey(config.privateKeyPath);

  const connectConfig: ConnectConfig = {
    host,
    port: config.port ?? port,
    username: user,
    privateKey,
    // Use SSH agent if no key found
    agent: !privateKey ? process.env.SSH_AUTH_SOCK : undefined,
    readyTimeout: 30000,
  };

  return new Promise((resolve, reject) => {
    sshClient = new Client();

    sshClient.on("ready", async () => {
      try {
        // Get SFTP client for file operations
        sftpClient = await new Promise<SFTPWrapper>((res, rej) => {
          sshClient!.sftp((err, sftp) => {
            if (err) rej(err);
            else res(sftp);
          });
        });

        // Create interactive shell for command execution
        sshShell = await new Promise<ClientChannel>((res, rej) => {
          sshClient!.shell({ term: "dumb" }, (err, stream) => {
            if (err) rej(err);
            else res(stream);
          });
        });

        // Buffer shell output
        sshShell.on("data", (data: Buffer) => {
          shellBuffer += data.toString();
        });

        sshShell.stderr.on("data", (data: Buffer) => {
          shellBuffer += data.toString();
        });

        // Wait for shell to be ready (initial prompt)
        await new Promise<void>((res) => setTimeout(res, 500));
        shellBuffer = ""; // Clear initial banner/prompt
        shellReady = true;

        resolve();
      } catch (err) {
        reject(err);
      }
    });

    sshClient.on("error", (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    sshClient.connect(connectConfig);
  });
}

/** Execute command through persistent shell with output parsing */
async function execSSHCommand(command: string, timeout = 120000): Promise<CommandResult> {
  if (!sshShell || !shellReady) {
    throw new Error("SSH shell not connected");
  }

  // Generate unique marker for output parsing
  const marker = `__TRIAGENT_END_${randomBytes(4).toString("hex")}__`;

  // Clear buffer and send command with exit code capture
  shellBuffer = "";
  const wrappedCommand = `${command}; echo "${marker}:$?"`;
  sshShell.write(wrappedCommand + "\n");

  // Wait for marker in output
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const markerIndex = shellBuffer.indexOf(marker);
    if (markerIndex !== -1) {
      // Parse output - find the exit code after the marker
      const afterMarker = shellBuffer.slice(markerIndex);
      const exitCodeMatch = afterMarker.match(new RegExp(`${marker}:(\\d+)`));
      const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 0;

      // Extract stdout (everything before the marker, minus the echoed command)
      let output = shellBuffer.slice(0, markerIndex);

      // Remove the echoed command from output (first line)
      const lines = output.split("\n");
      if (lines.length > 0 && lines[0].includes(command.slice(0, 20))) {
        lines.shift();
      }
      output = lines.join("\n").trim();

      return {
        stdout: output,
        stderr: "",
        exitCode,
      };
    }
    await new Promise((res) => setTimeout(res, 50));
  }

  return {
    stdout: shellBuffer,
    stderr: "Command timed out",
    exitCode: 124,
  };
}

/** Read file via SFTP */
async function readFileSSH(path: string): Promise<string> {
  if (!sftpClient) {
    throw new Error("SFTP not connected");
  }

  return new Promise((resolve, reject) => {
    sftpClient!.readFile(path, "utf8", (err, data) => {
      if (err) reject(new Error(`Failed to read file: ${err.message}`));
      else resolve(data as string);
    });
  });
}

/** List directory via SFTP */
async function listDirSSH(path: string): Promise<string[]> {
  if (!sftpClient) {
    throw new Error("SFTP not connected");
  }

  return new Promise((resolve, reject) => {
    sftpClient!.readdir(path, (err, list) => {
      if (err) reject(new Error(`Failed to list directory: ${err.message}`));
      else resolve(list.map((item) => item.filename));
    });
  });
}

/** Disconnect SSH connection */
export function disconnectSSH(): void {
  if (sshShell) {
    sshShell.end();
    sshShell = null;
  }
  if (sftpClient) {
    sftpClient.end();
    sftpClient = null;
  }
  if (sshClient) {
    sshClient.end();
    sshClient = null;
  }
  shellReady = false;
  shellBuffer = "";
}

export async function createSandbox(options: SandboxOptions): Promise<void> {
  hostMode = options.useHost ?? false;
  hostWorkdir = options.codebasePaths[0]?.path || "./";

  // Handle remote mode
  if (options.remote) {
    remoteConfig = options.remote;
    sessionId = randomBytes(4).toString("hex");
    remoteWorkdir = `/tmp/triagent-${sessionId}`;

    // Connect to remote via SSH
    await connectSSH(remoteConfig);

    // Create workspace directory
    const result = await execSSHCommand(`mkdir -p ${remoteWorkdir} && cd ${remoteWorkdir}`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create remote workspace: ${result.stderr || result.stdout}`);
    }

    // Register cleanup on process exit
    process.on("exit", disconnectSSH);
    process.on("SIGINT", () => {
      disconnectSSH();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      disconnectSSH();
      process.exit(0);
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
  return remoteConfig !== null;
}

export function getRemoteInfo(): { target: string; workdir: string; sessionId: string } | null {
  if (!remoteConfig || !remoteWorkdir || !sessionId) return null;
  return { target: remoteConfig.target, workdir: remoteWorkdir, sessionId };
}

export async function execCommand(command: string): Promise<CommandResult> {
  // Remote mode: execute via persistent SSH shell
  if (remoteConfig) {
    try {
      return await execSSHCommand(command);
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  }

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

  // Sandbox mode: execute via bashlet
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
  // Remote mode: read via SFTP
  if (remoteConfig) {
    const fullPath = path.startsWith("/") ? path : `${remoteWorkdir}/${path}`;
    try {
      return await readFileSSH(fullPath);
    } catch (error) {
      throw new Error(
        `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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

  // Sandbox mode: read via bashlet
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
  // Remote mode: list via SFTP
  if (remoteConfig) {
    const fullPath = path.startsWith("/") ? path : `${remoteWorkdir}/${path}`;
    try {
      return await listDirSSH(fullPath);
    } catch (error) {
      throw new Error(
        `Failed to list directory ${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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

  // Sandbox mode: list via bashlet
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
  options: { useHost?: boolean; remote?: RemoteConfig } = {}
): Promise<void> {
  await createSandbox({
    codebasePaths: config.codebasePaths,
    kubeConfigPath: config.kubeConfigPath,
    timeout: 120,
    useHost: options.useHost,
    remote: options.remote,
  });
}
