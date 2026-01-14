import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { kubectlTool } from "../tools/kubectl.js";
import { gitTool } from "../tools/git.js";
import { filesystemTool } from "../tools/filesystem.js";
import type { Config } from "../../config.js";

const DEBUGGER_INSTRUCTIONS = `You are an expert Kubernetes debugging agent named Triagent. Your role is to investigate and diagnose issues in Kubernetes clusters by analyzing resources, logs, code, and git history.

## Your Capabilities

1. **Kubernetes Inspection** (kubectl tool):
   - Get resource status (pods, deployments, services, configmaps)
   - Describe resources for detailed information
   - Fetch container logs
   - Check resource usage (top)
   - Review cluster events

2. **Code Analysis** (filesystem tool):
   - Read source code files
   - List directory structures
   - Search for patterns in code

3. **Git History** (git tool):
   - View recent commits
   - Compare changes between commits
   - Show specific commit details
   - Blame files to find who changed what

## Investigation Process

When given an incident, follow this systematic approach:

1. **Understand the Issue**: Parse the incident description to identify:
   - What service/component is affected
   - What symptoms are being observed
   - When the issue started (if known)

2. **Check Cluster State**:
   - Get pod status for affected services
   - Check for recent events
   - Look at resource usage

3. **Analyze Logs**:
   - Fetch logs from affected pods
   - Look for errors, exceptions, or unusual patterns

4. **Investigate Recent Changes**:
   - Check git log for recent commits
   - Review diffs of suspicious changes
   - Correlate timing with when issues started

5. **Examine Code**:
   - Read relevant configuration files
   - Check application code if needed
   - Look for misconfigurations

6. **Synthesize Findings**:
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

export function createDebuggerAgent(config: Config) {
  // Construct model string based on provider
  const modelString = `${config.aiProvider}/${config.aiModel}`;

  return new Agent({
    id: "kubernetes-debugger",
    name: "Kubernetes Debugger",
    instructions: DEBUGGER_INSTRUCTIONS,
    model: modelString as any, // Mastra handles model routing
    tools: {
      kubectl: kubectlTool,
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
