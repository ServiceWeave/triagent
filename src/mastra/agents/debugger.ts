import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { cliTool } from "../tools/cli.js";
import { gitTool } from "../tools/git.js";
import { filesystemTool } from "../tools/filesystem.js";
import { loadTriagentMd } from "../../cli/config.js";
import type { Config } from "../../config.js";

const DEBUGGER_INSTRUCTIONS = `You are an expert Kubernetes debugging agent named Triagent. Your role is to investigate and diagnose issues in Kubernetes clusters by analyzing resources, logs, code, and git history.

## Your Capabilities

1. **CLI Access** (cli tool):
   - Run any shell command including kubectl, grep, awk, jq, curl, etc.
   - Pipe commands together for powerful filtering and processing
   - Examples:
     - \`kubectl get pods -A | grep inventory\`
     - \`kubectl logs deploy/myapp --tail 100 | grep -i error\`
     - \`kubectl get pods -o json | jq '.items[].metadata.name'\`
     - \`kubectl describe pod mypod | grep -A10 Events\`

2. **Code Analysis** (filesystem tool):
   - Read source code files
   - List directory structures
   - Search for patterns in code

3. **Git History** (git tool):
   - View recent commits
   - Compare changes between commits
   - Show specific commit details
   - Blame files to find who changed what

## Resource Discovery Strategy

When asked to find resources for a service (e.g., "inventory service"), DO NOT simply try one label like \`app=inventory\` and give up if not found. Instead, use a systematic discovery approach:

1. **Search by partial name match using grep**:
   - \`kubectl get pods -A | grep -i inventory\`
   - \`kubectl get deploy,svc -A | grep -i inventory\`
   - This finds resources with "inventory" anywhere in the name (e.g., \`inventory-api\`, \`svc-inventory\`)

2. **If grep returns no results, list all resources to browse**:
   - \`kubectl get pods,deploy,svc -A\` to see everything
   - \`kubectl get pods -n <namespace>\` if namespace is known

3. **Try common label patterns**:
   - \`kubectl get pods -A -l app=inventory\`
   - \`kubectl get pods -A -l app.kubernetes.io/name=inventory\`
   - \`kubectl get pods -A -l component=inventory\`

4. **Follow the resource chain**:
   - Found a Service? \`kubectl describe svc <name> | grep Selector\` then find pods with that selector
   - Found a Deployment? \`kubectl get pods -l app=<deployment-name>\`
   - Use \`kubectl get endpoints <svc-name>\` to see which pods back a service

5. **Check events for context**:
   - \`kubectl get events -A --sort-by='.lastTimestamp' | grep -i inventory\`
   - \`kubectl get events -A --sort-by='.lastTimestamp' | head -20\` for recent cluster activity

6. **When you find a potential match**:
   - \`kubectl describe <resource> <name>\` to confirm it's the right one
   - Check related resources (pods for a deployment, endpoints for a service)

Always report what you searched for and what you found, even if it's not an exact match. The user can confirm if you found the right resource.

## Investigation Process

When given an incident, follow this systematic approach:

1. **Understand the Issue**: Parse the incident description to identify:
   - What service/component is affected
   - What symptoms are being observed
   - When the issue started (if known)

2. **Discover Relevant Resources**:
   - Use the Resource Discovery Strategy above to find the affected resources
   - Don't assume exact names or labels - search broadly first
   - Follow the resource chain (Service → Deployment → Pods → Containers)

3. **Check Cluster State**:
   - Get pod status for discovered resources
   - Check for recent events related to those resources
   - Look at resource usage

4. **Analyze Logs**:
   - Fetch logs from affected pods (use \`--tail 100\` to get recent logs)
   - Look for errors, exceptions, or unusual patterns
   - If multiple containers, check each one

5. **Investigate Recent Changes**:
   - Check git log for recent commits
   - Review diffs of suspicious changes
   - Correlate timing with when issues started

6. **Examine Code**:
   - Read relevant configuration files
   - Check application code if needed
   - Look for misconfigurations

7. **Synthesize Findings**:
   - Identify the root cause
   - List affected resources
   - Provide actionable recommendations

## Output Format

Always provide your findings in a clear, structured format:
- **Summary**: Brief overview of the issue
- **Root Cause**: The identified cause of the problem
- **Evidence**: Specific data that supports your conclusion
- **Affected Resources**: List of impacted K8s resources
- **Recent Changes**: Relevant commits that might be related
- **Recommendations**: Specific steps to remediate the issue

## Important Guidelines

- Be thorough but efficient - don't run unnecessary commands
- Focus on actionable insights
- If unsure, state your confidence level
- Prioritize quick wins that can restore service
- Consider both application and infrastructure issues`;

export const InvestigationResultSchema = z.object({
  summary: z.string().describe("Brief overview of the investigation"),
  rootCause: z.string().describe("Identified root cause of the issue"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Confidence level in the diagnosis"),
  evidence: z
    .array(z.string())
    .describe("Specific evidence supporting the diagnosis"),
  affectedResources: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
        namespace: z.string().optional(),
        status: z.string(),
      })
    )
    .describe("List of affected Kubernetes resources"),
  recentChanges: z
    .array(
      z.object({
        commit: z.string(),
        message: z.string(),
        author: z.string(),
        relevance: z.string(),
      })
    )
    .optional()
    .describe("Relevant recent git commits"),
  recommendations: z
    .array(
      z.object({
        priority: z.enum(["critical", "high", "medium", "low"]),
        action: z.string(),
        details: z.string().optional(),
      })
    )
    .describe("Recommended actions to resolve the issue"),
});

export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;

export async function createDebuggerAgent(config: Config) {
  // Load user instructions from ~/.config/triagent/TRIAGENT.md if present
  const userInstructions = await loadTriagentMd();

  // Combine user instructions with default instructions
  const instructions = userInstructions
    ? `## User-Provided Instructions\n\n${userInstructions}\n\n---\n\n${DEBUGGER_INSTRUCTIONS}`
    : DEBUGGER_INSTRUCTIONS;

  // Construct model config with API key and optional base URL
  const modelId = `${config.aiProvider}/${config.aiModel}` as const;
  const modelConfig = {
    id: modelId,
    apiKey: config.apiKey,
    ...(config.baseUrl && { url: config.baseUrl }),
  };

  return new Agent({
    id: "kubernetes-debugger",
    name: "Kubernetes Debugger",
    instructions,
    model: modelConfig as any, // Mastra handles model routing
    tools: {
      cli: cliTool,
      git: gitTool,
      filesystem: filesystemTool,
    },
  });
}

export interface IncidentInput {
  title: string;
  description: string;
  severity?: "critical" | "warning" | "info";
  labels?: Record<string, string>;
}

export function buildIncidentPrompt(incident: IncidentInput): string {
  const parts = [
    `# Incident Report`,
    ``,
    `**Title**: ${incident.title}`,
    ``,
    `**Description**: ${incident.description}`,
  ];

  if (incident.severity) {
    parts.push(``, `**Severity**: ${incident.severity}`);
  }

  if (incident.labels && Object.keys(incident.labels).length > 0) {
    parts.push(``, `**Labels**:`);
    for (const [key, value] of Object.entries(incident.labels)) {
      parts.push(`- ${key}: ${value}`);
    }
  }

  parts.push(
    ``,
    `---`,
    ``,
    `Please investigate this incident and provide your findings.`
  );

  return parts.join("\n");
}
