import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const networkTool = createTool({
  id: "network",
  description: `Debug network connectivity and policies in Kubernetes.
Use this tool to:
- Test DNS resolution from within pods
- Check connectivity between services
- Analyze NetworkPolicies
- View service endpoints
- Trace network paths

This tool executes kubectl commands to inspect network-related resources
and can run network diagnostics inside pods using kubectl exec.`,
  inputSchema: z.object({
    operation: z.enum(["dns", "connectivity", "policies", "endpoints", "trace"]).describe(
      "Operation: dns (resolve names), connectivity (test connection), policies (list NetworkPolicies), endpoints (show service endpoints), trace (network path)"
    ),
    source: z.object({
      pod: z.string().optional().describe("Source pod name for tests"),
      namespace: z.string().optional().describe("Source namespace"),
    }).optional().describe("Source for network tests"),
    target: z.object({
      host: z.string().optional().describe("Target hostname or IP"),
      port: z.number().optional().describe("Target port"),
      service: z.string().optional().describe("Target service name"),
      namespace: z.string().optional().describe("Target namespace"),
    }).optional().describe("Target for network tests"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { operation, source, target } = context;

    try {
      switch (operation) {
        case "dns": {
          const hostname = target?.host || target?.service;
          if (!hostname) {
            return {
              success: false,
              data: "",
              error: "Target host or service is required for DNS lookup",
            };
          }

          // Try to resolve DNS from within a pod if specified
          if (source?.pod && source?.namespace) {
            const cmd = `kubectl exec -n ${source.namespace} ${source.pod} -- nslookup ${hostname} 2>&1 || kubectl exec -n ${source.namespace} ${source.pod} -- getent hosts ${hostname} 2>&1`;
            const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
            return {
              success: true,
              data: `DNS lookup for ${hostname} from ${source.namespace}/${source.pod}:\n${stdout}${stderr ? `\nErrors: ${stderr}` : ""}`,
            };
          }

          // Fallback to coredns query
          const { stdout } = await execAsync(
            `kubectl get svc -A -o json | grep -i "${hostname}" || echo "Service not found in cluster"`,
            { timeout: 30000 }
          );
          return {
            success: true,
            data: `DNS/Service lookup for ${hostname}:\n${stdout}`,
          };
        }

        case "connectivity": {
          if (!source?.pod || !source?.namespace) {
            return {
              success: false,
              data: "",
              error: "Source pod and namespace are required for connectivity test",
            };
          }

          const targetHost = target?.host || target?.service;
          const targetPort = target?.port || 80;

          if (!targetHost) {
            return {
              success: false,
              data: "",
              error: "Target host or service is required",
            };
          }

          // Build full service name if namespace provided
          const fullTarget = target?.namespace && target?.service
            ? `${target.service}.${target.namespace}.svc.cluster.local`
            : targetHost;

          // Try different connectivity tools
          const tests = [
            `kubectl exec -n ${source.namespace} ${source.pod} -- nc -zv ${fullTarget} ${targetPort} 2>&1`,
            `kubectl exec -n ${source.namespace} ${source.pod} -- wget -q --spider --timeout=5 http://${fullTarget}:${targetPort} 2>&1`,
            `kubectl exec -n ${source.namespace} ${source.pod} -- curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://${fullTarget}:${targetPort} 2>&1`,
          ];

          const results: string[] = [`Connectivity test from ${source.namespace}/${source.pod} to ${fullTarget}:${targetPort}\n`];

          for (const test of tests) {
            try {
              const { stdout, stderr } = await execAsync(test, { timeout: 15000 });
              if (stdout.trim() || stderr.trim()) {
                results.push(`✓ ${stdout.trim()}${stderr ? ` ${stderr.trim()}` : ""}`);
                break;
              }
            } catch (e) {
              results.push(`✗ Connection failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          return {
            success: true,
            data: results.join("\n"),
          };
        }

        case "policies": {
          const namespace = source?.namespace || target?.namespace;
          const nsArg = namespace ? `-n ${namespace}` : "-A";

          const { stdout: policies } = await execAsync(
            `kubectl get networkpolicy ${nsArg} -o wide 2>&1`,
            { timeout: 30000 }
          );

          let details = "";
          if (namespace) {
            try {
              const { stdout } = await execAsync(
                `kubectl get networkpolicy ${nsArg} -o yaml 2>&1`,
                { timeout: 30000 }
              );
              // Extract just the important parts
              const policyNames = stdout.match(/name:\s+(\S+)/g) || [];
              const podSelectors = stdout.match(/podSelector:[\s\S]*?(?=ingress:|egress:|spec:|---)/g) || [];
              details = `\nPolicy details:\n${policyNames.join("\n")}`;
            } catch {
              // Ignore details errors
            }
          }

          return {
            success: true,
            data: `NetworkPolicies${namespace ? ` in ${namespace}` : " (all namespaces)"}:\n${policies}${details}`,
          };
        }

        case "endpoints": {
          const service = target?.service;
          const namespace = target?.namespace || "default";

          if (!service) {
            // List all endpoints
            const { stdout } = await execAsync(
              `kubectl get endpoints -A -o wide 2>&1`,
              { timeout: 30000 }
            );
            return {
              success: true,
              data: `All endpoints:\n${stdout}`,
            };
          }

          const { stdout: endpoints } = await execAsync(
            `kubectl get endpoints ${service} -n ${namespace} -o yaml 2>&1`,
            { timeout: 30000 }
          );

          const { stdout: svc } = await execAsync(
            `kubectl get svc ${service} -n ${namespace} -o wide 2>&1`,
            { timeout: 30000 }
          );

          return {
            success: true,
            data: `Service: ${service} in ${namespace}\n\n${svc}\n\nEndpoints:\n${endpoints}`,
          };
        }

        case "trace": {
          const targetHost = target?.host || target?.service;
          if (!targetHost) {
            return {
              success: false,
              data: "",
              error: "Target host or service is required for trace",
            };
          }

          const results: string[] = [`Network trace to ${targetHost}:\n`];

          // Get service details if it's a service name
          if (target?.service) {
            const ns = target.namespace || "default";
            try {
              const { stdout: svc } = await execAsync(
                `kubectl get svc ${target.service} -n ${ns} -o jsonpath='{.spec.clusterIP}:{.spec.ports[0].port}' 2>&1`,
                { timeout: 10000 }
              );
              results.push(`Service ClusterIP: ${svc}`);

              const { stdout: endpoints } = await execAsync(
                `kubectl get endpoints ${target.service} -n ${ns} -o jsonpath='{.subsets[*].addresses[*].ip}' 2>&1`,
                { timeout: 10000 }
              );
              results.push(`Backend pods: ${endpoints || "None"}`);
            } catch {
              results.push("Could not get service details");
            }
          }

          // If we have a source pod, trace from there
          if (source?.pod && source?.namespace) {
            try {
              const { stdout } = await execAsync(
                `kubectl exec -n ${source.namespace} ${source.pod} -- traceroute -n -m 10 ${targetHost} 2>&1 || kubectl exec -n ${source.namespace} ${source.pod} -- tracepath ${targetHost} 2>&1`,
                { timeout: 60000 }
              );
              results.push(`\nTraceroute from ${source.namespace}/${source.pod}:\n${stdout}`);
            } catch (e) {
              results.push(`\nTraceroute not available: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          return {
            success: true,
            data: results.join("\n"),
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
  },
});
