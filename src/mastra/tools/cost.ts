import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import type { CostAnalysisConfig } from "../../cli/config.js";

const execAsync = promisify(exec);

// Default hourly rates (USD) - based on typical cloud pricing
const DEFAULT_RATES = {
  cpu: 0.03,     // per vCPU-hour
  memory: 0.004, // per GB-hour
  storage: 0.0001, // per GB-hour
};

interface ResourceUsage {
  cpuCores: number;
  memoryGB: number;
  storageGB: number;
}

interface CostEstimate {
  hourly: number;
  daily: number;
  monthly: number;
  breakdown: {
    cpu: number;
    memory: number;
    storage: number;
  };
}

// Store config for cost calculations
let costConfig: CostAnalysisConfig | null = null;

export function initCostConfig(config?: CostAnalysisConfig): void {
  costConfig = config || null;
}

function getRates(): typeof DEFAULT_RATES {
  if (costConfig?.hourlyRates) {
    return {
      cpu: costConfig.hourlyRates.cpu || DEFAULT_RATES.cpu,
      memory: costConfig.hourlyRates.memory || DEFAULT_RATES.memory,
      storage: costConfig.hourlyRates.storage || DEFAULT_RATES.storage,
    };
  }
  return DEFAULT_RATES;
}

function calculateCost(usage: ResourceUsage): CostEstimate {
  const rates = getRates();

  const cpuCost = usage.cpuCores * rates.cpu;
  const memoryCost = usage.memoryGB * rates.memory;
  const storageCost = usage.storageGB * rates.storage;

  const hourly = cpuCost + memoryCost + storageCost;

  return {
    hourly,
    daily: hourly * 24,
    monthly: hourly * 24 * 30,
    breakdown: {
      cpu: cpuCost,
      memory: memoryCost,
      storage: storageCost,
    },
  };
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

async function getResourceUsage(kind: string, name: string, namespace: string): Promise<ResourceUsage | null> {
  try {
    // Get resource requests/limits
    const { stdout } = await execAsync(
      `kubectl get ${kind.toLowerCase()} ${name} -n ${namespace} -o jsonpath='{.spec.template.spec.containers[*].resources}' 2>/dev/null || kubectl get ${kind.toLowerCase()} ${name} -n ${namespace} -o jsonpath='{.spec.containers[*].resources}' 2>/dev/null`,
      { timeout: 10000 }
    );

    // Parse CPU (convert from millicores to cores)
    const cpuMatch = stdout.match(/"cpu":\s*"?(\d+)(m)?/);
    let cpuCores = 0;
    if (cpuMatch) {
      cpuCores = cpuMatch[2] === "m"
        ? parseInt(cpuMatch[1], 10) / 1000
        : parseInt(cpuMatch[1], 10);
    }

    // Parse Memory (convert to GB)
    const memMatch = stdout.match(/"memory":\s*"?(\d+)([KMGTPEi]+)?/);
    let memoryGB = 0;
    if (memMatch) {
      const value = parseInt(memMatch[1], 10);
      const unit = memMatch[2] || "";
      const multipliers: Record<string, number> = {
        "": 1 / (1024 * 1024 * 1024),
        "Ki": 1 / (1024 * 1024),
        "Mi": 1 / 1024,
        "Gi": 1,
        "Ti": 1024,
      };
      memoryGB = value * (multipliers[unit] || 1 / (1024 * 1024 * 1024));
    }

    // Get PVC storage if any
    const { stdout: pvcStdout } = await execAsync(
      `kubectl get pvc -n ${namespace} -l app=${name} -o jsonpath='{.items[*].spec.resources.requests.storage}' 2>/dev/null || echo ""`,
      { timeout: 10000 }
    );

    let storageGB = 0;
    const storageMatches = pvcStdout.matchAll(/(\d+)([KMGTPEi]+)?/g);
    for (const match of storageMatches) {
      const value = parseInt(match[1], 10);
      const unit = match[2] || "";
      const multipliers: Record<string, number> = {
        "": 1 / (1024 * 1024 * 1024),
        "Ki": 1 / (1024 * 1024),
        "Mi": 1 / 1024,
        "Gi": 1,
        "Ti": 1024,
      };
      storageGB += value * (multipliers[unit] || 1 / (1024 * 1024 * 1024));
    }

    return { cpuCores, memoryGB, storageGB };
  } catch {
    return null;
  }
}

async function getReplicaCount(kind: string, name: string, namespace: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `kubectl get ${kind.toLowerCase()} ${name} -n ${namespace} -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1"`,
      { timeout: 10000 }
    );
    return parseInt(stdout.trim(), 10) || 1;
  } catch {
    return 1;
  }
}

export const costTool = createTool({
  id: "cost",
  description: `Analyze resource costs and incident impact.
Use this tool to:
- Estimate resource costs for Kubernetes workloads
- Calculate incident cost impact (downtime costs)
- Suggest cost optimization opportunities

Costs are calculated based on configured hourly rates or default cloud pricing.`,
  inputSchema: z.object({
    operation: z.enum(["resource", "incident", "optimization"]).describe(
      "Operation: resource (estimate workload cost), incident (calculate downtime impact), optimization (find savings)"
    ),
    target: z.object({
      kind: z.string().describe("Kubernetes resource kind"),
      name: z.string().describe("Resource name"),
      namespace: z.string().describe("Resource namespace"),
    }).optional().describe("Target resource for cost analysis"),
    timeRange: z.object({
      start: z.string().describe("Incident start time (ISO 8601)"),
      end: z.string().optional().describe("Incident end time (ISO 8601 or 'now')"),
    }).optional().describe("Time range for incident cost calculation"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.string(),
    costs: z.object({
      hourly: z.number().optional(),
      daily: z.number().optional(),
      monthly: z.number().optional(),
      incident: z.number().optional(),
      business: z.number().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (async ({ operation, target, timeRange }: any) => {

    try {
      switch (operation) {
        case "resource": {
          if (!target) {
            return {
              success: false,
              data: "",
              error: "Target resource is required for cost estimation",
            };
          }

          const usage = await getResourceUsage(target.kind, target.name, target.namespace);
          if (!usage) {
            return {
              success: false,
              data: "",
              error: `Could not get resource usage for ${target.kind}/${target.name}`,
            };
          }

          const replicas = await getReplicaCount(target.kind, target.name, target.namespace);
          const totalUsage: ResourceUsage = {
            cpuCores: usage.cpuCores * replicas,
            memoryGB: usage.memoryGB * replicas,
            storageGB: usage.storageGB,
          };

          const cost = calculateCost(totalUsage);
          const rates = getRates();

          const lines = [
            `💰 Cost Analysis: ${target.kind}/${target.name}`,
            `   Namespace: ${target.namespace}`,
            `   Replicas: ${replicas}`,
            ``,
            `📊 Resource Usage (total):`,
            `   CPU: ${totalUsage.cpuCores.toFixed(2)} cores`,
            `   Memory: ${totalUsage.memoryGB.toFixed(2)} GB`,
            `   Storage: ${totalUsage.storageGB.toFixed(2)} GB`,
            ``,
            `💵 Cost Estimate:`,
            `   Hourly:  ${formatCurrency(cost.hourly)}`,
            `   Daily:   ${formatCurrency(cost.daily)}`,
            `   Monthly: ${formatCurrency(cost.monthly)}`,
            ``,
            `📈 Breakdown (hourly):`,
            `   CPU:     ${formatCurrency(cost.breakdown.cpu)} (${formatCurrency(rates.cpu)}/core/hr)`,
            `   Memory:  ${formatCurrency(cost.breakdown.memory)} (${formatCurrency(rates.memory)}/GB/hr)`,
            `   Storage: ${formatCurrency(cost.breakdown.storage)} (${formatCurrency(rates.storage)}/GB/hr)`,
          ];

          return {
            success: true,
            data: lines.join("\n"),
            costs: {
              hourly: cost.hourly,
              daily: cost.daily,
              monthly: cost.monthly,
            },
          };
        }

        case "incident": {
          if (!timeRange) {
            return {
              success: false,
              data: "",
              error: "Time range is required for incident cost calculation",
            };
          }

          const startTime = new Date(timeRange.start);
          const endTime = timeRange.end === "now" || !timeRange.end
            ? new Date()
            : new Date(timeRange.end);

          const durationMs = endTime.getTime() - startTime.getTime();
          const durationMinutes = durationMs / 60000;
          const durationHours = durationMs / 3600000;

          // Calculate resource cost during downtime if target provided
          let resourceCost = 0;
          let usageLines: string[] = [];

          if (target) {
            const usage = await getResourceUsage(target.kind, target.name, target.namespace);
            if (usage) {
              const replicas = await getReplicaCount(target.kind, target.name, target.namespace);
              const totalUsage: ResourceUsage = {
                cpuCores: usage.cpuCores * replicas,
                memoryGB: usage.memoryGB * replicas,
                storageGB: usage.storageGB,
              };
              const cost = calculateCost(totalUsage);
              resourceCost = cost.hourly * durationHours;
              usageLines = [
                `   Affected: ${target.kind}/${target.name}`,
                `   Resource cost during incident: ${formatCurrency(resourceCost)}`,
              ];
            }
          }

          // Calculate business impact if configured
          let businessImpact = 0;
          let businessLines: string[] = [];

          if (costConfig?.businessImpact?.revenuePerMinute) {
            businessImpact = costConfig.businessImpact.revenuePerMinute * durationMinutes;
            businessLines = [
              ``,
              `📉 Business Impact:`,
              `   Revenue rate: ${formatCurrency(costConfig.businessImpact.revenuePerMinute)}/min`,
              `   Estimated lost revenue: ${formatCurrency(businessImpact)}`,
            ];
          }

          const totalCost = resourceCost + businessImpact;

          const lines = [
            `⏱️ Incident Duration Analysis`,
            ``,
            `📅 Time Range:`,
            `   Start: ${startTime.toISOString()}`,
            `   End: ${endTime.toISOString()}`,
            `   Duration: ${durationMinutes.toFixed(0)} minutes (${durationHours.toFixed(2)} hours)`,
            ``,
            `💰 Resource Cost:`,
            ...usageLines,
            ...businessLines,
            ``,
            `📊 Total Incident Cost: ${formatCurrency(totalCost)}`,
          ];

          return {
            success: true,
            data: lines.join("\n"),
            costs: {
              incident: resourceCost,
              business: businessImpact,
            },
          };
        }

        case "optimization": {
          // Get all deployments and analyze for optimization opportunities
          const { stdout } = await execAsync(
            `kubectl get deployments -A -o jsonpath='{range .items[*]}{.metadata.namespace},{.metadata.name},{.spec.replicas},{.spec.template.spec.containers[0].resources.requests.cpu},{.spec.template.spec.containers[0].resources.requests.memory}{" "}' 2>/dev/null || echo ""`,
            { timeout: 30000 }
          );

          const suggestions: string[] = [];
          const items = stdout.trim().split(" ").filter(Boolean);

          for (const item of items) {
            const [namespace, name, replicas, cpu, memory] = item.split(",");

            // Check for over-provisioned resources
            if (parseInt(replicas, 10) > 3) {
              suggestions.push(`• ${namespace}/${name}: Consider autoscaling (currently ${replicas} replicas)`);
            }

            // Check for missing resource requests
            if (!cpu || !memory) {
              suggestions.push(`• ${namespace}/${name}: Add resource requests for better scheduling`);
            }
          }

          if (suggestions.length === 0) {
            return {
              success: true,
              data: "✅ No obvious cost optimization opportunities found.\n\nConsider:\n- Reviewing unused PVCs\n- Right-sizing node pools\n- Using spot/preemptible instances",
            };
          }

          const lines = [
            `💡 Cost Optimization Suggestions:`,
            ``,
            ...suggestions,
            ``,
            `General recommendations:`,
            `- Review unused PVCs and delete if not needed`,
            `- Consider using horizontal pod autoscaling`,
            `- Use spot/preemptible instances for non-critical workloads`,
            `- Right-size resource requests based on actual usage`,
          ];

          return {
            success: true,
            data: lines.join("\n"),
          };
        }

        default:
          return { success: false, data: "", error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      return {
        success: false,
        data: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }) as any,
});
