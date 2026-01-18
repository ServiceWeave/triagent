export interface KubernetesCluster {
  name: string;
  context: string;
  kubeConfigPath?: string;
  environment?: "development" | "staging" | "production";
  isActive: boolean;
}

export interface ClusterInfo {
  name: string;
  context: string;
  server: string;
  namespace?: string;
  user?: string;
}

export interface ClusterStatus {
  name: string;
  connected: boolean;
  version?: string;
  nodeCount?: number;
  lastChecked: Date;
  error?: string;
}
