import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join } from "path";
import { readFile } from "fs/promises";
import type { KubernetesCluster, ClusterInfo, ClusterStatus } from "./types.js";
import type { ClusterConfig } from "../../cli/config.js";

const execAsync = promisify(exec);

export class MultiClusterManager {
  private clusters: Map<string, KubernetesCluster> = new Map();
  private activeCluster: string | null = null;

  constructor(clusterConfigs?: ClusterConfig[], activeClusterName?: string) {
    if (clusterConfigs) {
      for (const config of clusterConfigs) {
        this.clusters.set(config.name, {
          ...config,
          isActive: config.name === activeClusterName,
        });
      }
      this.activeCluster = activeClusterName || null;
    }
  }

  async discoverClusters(): Promise<ClusterInfo[]> {
    try {
      const { stdout } = await execAsync("kubectl config get-contexts -o name");
      const contexts = stdout.trim().split("\n").filter(Boolean);

      const clusters: ClusterInfo[] = [];
      for (const context of contexts) {
        const info = await this.getClusterInfo(context);
        if (info) {
          clusters.push(info);
        }
      }

      return clusters;
    } catch {
      return [];
    }
  }

  private async getClusterInfo(context: string): Promise<ClusterInfo | null> {
    try {
      const { stdout } = await execAsync(
        `kubectl config view -o jsonpath='{.contexts[?(@.name=="${context}")]}' --raw`
      );
      const contextData = JSON.parse(stdout || "{}");

      const { stdout: clusterStdout } = await execAsync(
        `kubectl config view -o jsonpath='{.clusters[?(@.name=="${contextData.context?.cluster}")].cluster.server}' --raw`
      );

      return {
        name: context,
        context,
        server: clusterStdout.trim(),
        namespace: contextData.context?.namespace,
        user: contextData.context?.user,
      };
    } catch {
      return null;
    }
  }

  async addCluster(config: ClusterConfig): Promise<void> {
    const cluster: KubernetesCluster = {
      ...config,
      isActive: false,
    };

    this.clusters.set(config.name, cluster);
  }

  async removeCluster(name: string): Promise<boolean> {
    if (this.activeCluster === name) {
      this.activeCluster = null;
    }
    return this.clusters.delete(name);
  }

  async setActiveCluster(name: string): Promise<boolean> {
    const cluster = this.clusters.get(name);
    if (!cluster) {
      return false;
    }

    // Deactivate all clusters
    for (const c of this.clusters.values()) {
      c.isActive = false;
    }

    // Activate the selected cluster
    cluster.isActive = true;
    this.activeCluster = name;

    return true;
  }

  getActiveCluster(): KubernetesCluster | null {
    if (!this.activeCluster) return null;
    return this.clusters.get(this.activeCluster) || null;
  }

  listClusters(): KubernetesCluster[] {
    return Array.from(this.clusters.values());
  }

  async checkClusterStatus(name: string): Promise<ClusterStatus> {
    const cluster = this.clusters.get(name);
    if (!cluster) {
      return {
        name,
        connected: false,
        lastChecked: new Date(),
        error: "Cluster not found",
      };
    }

    try {
      const kubeConfigArg = cluster.kubeConfigPath
        ? `--kubeconfig="${cluster.kubeConfigPath}"`
        : "";
      const contextArg = `--context="${cluster.context}"`;

      const { stdout: versionStdout } = await execAsync(
        `kubectl ${kubeConfigArg} ${contextArg} version --short -o json`,
        { timeout: 10000 }
      );
      const version = JSON.parse(versionStdout);

      const { stdout: nodesStdout } = await execAsync(
        `kubectl ${kubeConfigArg} ${contextArg} get nodes -o json`,
        { timeout: 10000 }
      );
      const nodes = JSON.parse(nodesStdout);

      return {
        name,
        connected: true,
        version: version.serverVersion?.gitVersion || "unknown",
        nodeCount: nodes.items?.length || 0,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        name,
        connected: false,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getKubectlArgs(): string {
    const cluster = this.getActiveCluster();
    if (!cluster) return "";

    const args: string[] = [];
    if (cluster.kubeConfigPath) {
      args.push(`--kubeconfig="${cluster.kubeConfigPath}"`);
    }
    args.push(`--context="${cluster.context}"`);

    return args.join(" ");
  }

  buildKubectlCommand(command: string): string {
    const args = this.getKubectlArgs();
    if (!args) return command;

    // Insert cluster args after 'kubectl'
    if (command.startsWith("kubectl ")) {
      return `kubectl ${args} ${command.slice(8)}`;
    }
    return command;
  }
}

// Singleton instance
let clusterManager: MultiClusterManager | null = null;

export function getClusterManager(): MultiClusterManager {
  if (!clusterManager) {
    clusterManager = new MultiClusterManager();
  }
  return clusterManager;
}

export function initClusterManager(
  clusters?: ClusterConfig[],
  activeCluster?: string
): MultiClusterManager {
  clusterManager = new MultiClusterManager(clusters, activeCluster);
  return clusterManager;
}
