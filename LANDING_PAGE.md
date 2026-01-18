# Triagent

**AI-Powered Kubernetes Debugging Agent with Human-in-the-Loop Safety**

Triagent is an intelligent debugging assistant that automates Kubernetes incident investigation while keeping humans in control. Powered by advanced language models, it combines deep Kubernetes expertise with real-time cluster analysis to dramatically reduce mean time to resolution (MTTR).

---

## The Problem

Kubernetes debugging is tedious, time-consuming, and requires deep expertise:

- **Manual Investigation**: Engineers spend hours running kubectl commands, searching logs, and correlating metrics
- **Context Switching**: Jumping between terminals, dashboards, and documentation breaks focus
- **Knowledge Silos**: Tribal knowledge gets lost; junior engineers struggle without guidance
- **Risky Automation**: Existing tools either do too little (just alerting) or too much (unsafe auto-remediation)
- **Slow Incident Response**: Every minute of downtime costs money and reputation

---

## The Solution

Triagent acts as an expert SRE that never sleeps. It investigates incidents autonomously while requiring human approval before making any changes to your cluster.

### How It Works

1. **Receive an Incident** — Via interactive TUI, webhook from your alerting system, or CLI
2. **Autonomous Investigation** — Agent analyzes pods, logs, metrics, events, and git history
3. **Human-in-the-Loop** — Before any write operation, you see exactly what will run and approve it
4. **Actionable Findings** — Get root cause analysis and remediation recommendations in minutes, not hours

---

## Key Features

### Multi-Model AI Support

Choose your preferred LLM provider—Claude, GPT-4, or Gemini. Triagent adapts to your AI strategy with support for custom API endpoints and local models.

### Human-in-the-Loop Safety

Every write operation requires explicit approval. Commands are classified by risk level (low, medium, high, critical) with clear explanations of what will be executed.

### Beautiful Terminal UI

A reactive, modern terminal interface built with Solid.js. Watch investigations unfold in real-time with streaming responses, toast notifications, and intuitive approval dialogs.

### Webhook Integration

Connect to Prometheus Alertmanager, PagerDuty, Opsgenie, or any alerting system. Triagent runs investigations automatically when incidents fire.

### Comprehensive Toolset

| Tool | Capability |
|------|------------|
| **CLI** | Execute kubectl, git, and shell commands in an isolated sandbox |
| **Prometheus** | Query metrics, alerts, and discover dashboards |
| **Logs** | Search Elasticsearch or Loki with LogQL/Lucene |
| **Network** | Debug DNS, connectivity, and network policies |
| **Cost** | Analyze resource usage and estimate costs |
| **Runbook** | Search your SOPs with semantic TF-IDF matching |
| **Remediation** | Safe actions like restart, scale, and rollback |

### Multi-Cluster Management

Manage multiple Kubernetes clusters with named profiles. Switch contexts seamlessly and track which cluster each investigation targeted.

### Runbook & Custom Instructions

Drop a `RUNBOOK.md` or `TRIAGENT.md` in your repo. The agent will reference your team's standard operating procedures during investigations.

### Investigation History

Full audit trail of every investigation with metadata, duration, and outcomes. Search by status, cluster, tags, or full-text. Generate statistics and analyze patterns.

### Sandbox Isolation

Commands execute in an isolated Bashlet environment by default. Your host system stays protected while the agent has full access to kubectl and git.

---

## Use Cases

- **Pod Crash Loops** — Automatically analyze logs, events, and resource constraints
- **Service Unavailability** — Trace DNS resolution, connectivity, and pod health
- **Performance Degradation** — Query Prometheus metrics and identify bottlenecks
- **Deployment Failures** — Check recent git commits and suggest rollbacks
- **Network Issues** — Test connectivity and analyze network policies
- **Cost Anomalies** — Investigate unexpected resource usage patterns

---

## Interaction Modes

### Interactive TUI

```bash
triagent
```

Real-time debugging with visual feedback. Perfect for hands-on troubleshooting.

### Webhook Server

```bash
triagent server --port 8080
```

Accepts incidents from alerting systems. Ideal for automated triage.

### Direct CLI

```bash
triagent --incident "Pods in namespace payments are crash-looping"
```

One-shot analysis for quick investigations.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Terminal UI (TUI)              │
│     Solid.js + OpenTUI • Real-time UX       │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│           Mastra Agent Framework            │
│   Multi-turn conversations • Tool routing   │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│              Tool Execution                 │
│  CLI • Prometheus • Logs • Network • Cost   │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│           Bashlet Sandbox                   │
│    Isolated execution • Host protection     │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│          External Integrations              │
│  K8s • Prometheus • Elasticsearch • Git     │
└─────────────────────────────────────────────┘
```

---

## Tech Stack

- **Runtime**: Bun (fast TypeScript/JavaScript runtime)
- **AI**: Anthropic Claude, OpenAI GPT-4, Google Gemini
- **Framework**: Mastra (agent orchestration)
- **UI**: OpenTUI + Solid.js (reactive terminal components)
- **Sandbox**: Bashlet SDK (isolated command execution)
- **Server**: Hono (lightweight HTTP framework)

---

## Quick Start

```bash
# Install
bun install -g triagent

# Configure your cluster
triagent cluster add prod --context my-k8s-context

# Start investigating
triagent
```

---

## Who Is This For?

- **SREs** — Reduce on-call investigation time by 80%
- **DevOps Engineers** — Automate repetitive debugging tasks
- **Platform Teams** — Enable self-service incident response
- **Kubernetes Operators** — Safe, auditable automation

---

## Why Triagent?

| Feature | Triagent | Generic AI Assistants | Traditional Runbooks |
|---------|----------|----------------------|---------------------|
| Kubernetes expertise | Deep | Surface-level | Manual |
| Real-time cluster access | Yes | No | No |
| Human approval for changes | Built-in | None | Manual |
| Multi-source correlation | Logs, metrics, events, git | Limited | Manual |
| Investigation history | Searchable | None | Manual docs |
| 24/7 availability | Always | Always | Human-dependent |

---

## Safety First

Triagent is designed with production safety as a core principle:

- **No Silent Mutations**: Every write operation shows exactly what will execute
- **Risk Classification**: Commands tagged as low, medium, high, or critical risk
- **Approval Required**: Nothing changes without your explicit "yes"
- **Audit Trail**: Full history of what was run and when
- **Sandbox Default**: Commands isolated from your host system

---

## Installation & Setup

### Prerequisites

- **Bun** v1.2.0 or higher
- **kubectl** configured with cluster access
- **Docker** (optional, for sandbox isolation)
- API key for your preferred AI provider

### Install from npm

```bash
bun install -g triagent
```

### Install from Source

```bash
git clone https://github.com/ServiceWeave/triagent.git
cd triagent
bun install
bun link
```

### Initial Configuration

```bash
# Set your AI provider and API key
triagent config set aiProvider anthropic
triagent config set apiKey sk-ant-xxxxx

# Or use environment variables
export ANTHROPIC_API_KEY=sk-ant-xxxxx
export AI_PROVIDER=anthropic
```

### Add Your First Cluster

```bash
# List available Kubernetes contexts
triagent cluster list

# Add a cluster from your kubeconfig
triagent cluster add prod --context my-prod-context -e production

# Set it as active
triagent cluster use prod

# Verify connection
triagent cluster status
```

---

## Configuration Reference

Configuration is stored in `~/.config/triagent/config.json`

### Core Settings

| Key | Description | Default |
|-----|-------------|---------|
| `aiProvider` | AI provider (`openai`, `anthropic`, `google`) | `anthropic` |
| `aiModel` | Model ID (e.g., `claude-sonnet-4-20250514`, `gpt-4o`) | Provider default |
| `apiKey` | API key for your provider | — |
| `baseUrl` | Custom API endpoint (for proxies/local models) | — |
| `webhookPort` | HTTP server port | `3000` |
| `kubeConfigPath` | Path to kubeconfig | `~/.kube` |

### Observability Integrations

```json
{
  "prometheus": {
    "url": "https://prometheus.example.com",
    "auth": { "token": "bearer-token" }
  },
  "grafana": {
    "url": "https://grafana.example.com",
    "apiKey": "glsa_xxxxx"
  },
  "logProvider": "elasticsearch",
  "elasticsearch": {
    "url": "https://elasticsearch.example.com",
    "index": "app-logs-*",
    "auth": { "apiKey": "api-key" }
  },
  "loki": {
    "url": "https://loki.example.com"
  }
}
```

### Notifications

```json
{
  "notifications": {
    "slack": {
      "webhookUrl": "https://hooks.slack.com/services/xxx",
      "botToken": "xoxb-xxxxx",
      "defaultChannel": "#incidents"
    },
    "teams": {
      "webhookUrl": "https://outlook.office.com/webhook/xxx"
    }
  }
}
```

### Cost Analysis

```json
{
  "costAnalysis": {
    "provider": "aws",
    "hourlyRates": {
      "cpu": 0.048,
      "memory": 0.012,
      "storage": 0.0001
    },
    "businessImpact": {
      "revenuePerMinute": 150
    }
  }
}
```

### Multi-Codebase Support

```json
{
  "codebasePaths": [
    { "name": "api", "path": "/home/user/projects/api" },
    { "name": "frontend", "path": "/home/user/projects/frontend" },
    { "name": "infra", "path": "/home/user/projects/infrastructure" }
  ]
}
```

Each codebase is mounted at `/workspace/<name>` in the sandbox.

### Runbooks

```json
{
  "runbooks": {
    "paths": [
      "/home/user/runbooks",
      "/home/user/projects/docs/sops"
    ],
    "gitRepos": [
      "https://github.com/myorg/runbooks.git"
    ]
  }
}
```

---

## Environment Variables

All settings can be configured via environment variables:

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | AI provider (`openai`, `anthropic`, `google`) |
| `AI_MODEL` | Model ID |
| `AI_BASE_URL` | Custom API base URL |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key |
| `WEBHOOK_PORT` | Webhook server port |
| `CODEBASE_PATH` | Path to codebase |
| `KUBE_CONFIG_PATH` | Kubernetes config path |

---

## Custom Instructions

### TRIAGENT.md

Create `~/.config/triagent/TRIAGENT.md` to customize agent behavior:

```markdown
# Custom Instructions

## Team Context
- We use ArgoCD for GitOps deployments
- Production namespace: `prod-*`
- Staging namespace: `staging-*`

## Escalation Policy
- Critical issues: Page on-call via PagerDuty
- High severity: Notify #sre-alerts Slack channel

## Common Issues
- OOM kills usually caused by memory leaks in Java services
- Network timeouts often related to Istio sidecar injection
```

### RUNBOOK.md

Create `~/.config/triagent/RUNBOOK.md` for standard operating procedures:

```markdown
# Runbook: API Gateway 503 Errors

## Symptoms
- Increased 503 responses from API gateway
- Customer-facing errors in checkout flow

## Investigation Steps
1. Check pod health: `kubectl get pods -n api-gateway`
2. Review recent deployments: `kubectl rollout history`
3. Check upstream services connectivity

## Remediation
- If pods unhealthy: `kubectl rollout restart deployment/api-gateway`
- If config issue: Rollback to previous version
```

---

## Webhook Integration

### Alertmanager Configuration

```yaml
receivers:
  - name: triagent
    webhook_configs:
      - url: 'http://triagent:3000/webhook/incident'
        send_resolved: false

route:
  receiver: triagent
  group_by: ['alertname', 'namespace']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

### PagerDuty Integration

Configure PagerDuty to forward incidents to Triagent's webhook endpoint:

```
POST http://triagent:3000/webhook/incident
Content-Type: application/json

{
  "title": "High CPU Usage",
  "description": "Pod api-server-xyz using 95% CPU",
  "severity": "high",
  "source": "pagerduty",
  "labels": {
    "namespace": "production",
    "service": "api-server"
  }
}
```

### Webhook API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/incident` | POST | Submit a new incident |
| `/investigations/:id` | GET | Get investigation results |
| `/history` | GET | List all investigations |
| `/history/:id` | GET | Get investigation details |
| `/history/stats` | GET | Investigation statistics |
| `/health` | GET | Health check |

---

## Frequently Asked Questions

### Is Triagent safe to use in production?

Yes. Triagent is designed with production safety as a core principle:
- **Human-in-the-loop**: Every write operation requires explicit approval
- **Sandbox isolation**: Commands run in isolated environment by default
- **Risk classification**: High-risk operations are clearly labeled
- **Audit trail**: Full history of all commands executed

### Which AI models work best?

We recommend **Claude Sonnet** or **GPT-4o** for the best balance of capability and cost. Claude tends to be more thorough in investigations, while GPT-4 excels at parsing complex log patterns.

### Can I use local/self-hosted models?

Yes. Set the `baseUrl` configuration to point to your local endpoint (e.g., Ollama, vLLM, or any OpenAI-compatible API):

```bash
triagent config set baseUrl http://localhost:11434/v1
triagent config set aiModel llama3.1:70b
```

### How does the approval workflow work?

When the agent wants to run a command that could modify state:
1. The command is analyzed and classified by risk level
2. An approval dialog appears showing the exact command
3. You can approve, reject, or modify the command
4. Only after approval does execution proceed

### Can I customize investigation strategies?

Yes, via `TRIAGENT.md` and `RUNBOOK.md` files. The agent will incorporate your custom instructions and reference your runbooks during investigations.

### How do I integrate with my alerting system?

Run Triagent in webhook mode (`triagent --webhook-only`) and configure your alerting system (Alertmanager, PagerDuty, Opsgenie) to POST incidents to `/webhook/incident`.

### Does it support multi-tenant clusters?

Yes. Use the multi-cluster feature to manage multiple clusters, and configure namespace restrictions in your `TRIAGENT.md` custom instructions.

---

## Comparison

| Capability | Triagent | kubectl + manual | k9s | Robusta |
|------------|----------|------------------|-----|---------|
| AI-powered analysis | Yes | No | No | Yes |
| Interactive TUI | Yes | No | Yes | No |
| Human approval for changes | Yes | N/A | No | No |
| Multi-source correlation | Yes | Manual | No | Partial |
| Custom runbooks | Yes | Manual | No | No |
| Webhook integration | Yes | No | No | Yes |
| Cost analysis | Yes | No | No | Yes |
| Investigation history | Yes | No | No | Yes |

---

## Roadmap

- [x] Interactive TUI with real-time streaming
- [x] Human-in-the-loop approval system
- [x] Multi-cluster support
- [x] Prometheus/Grafana integration
- [x] Elasticsearch/Loki log search
- [x] Runbook integration with TF-IDF search
- [x] Cost analysis tools
- [x] Slack/Teams notifications
- [x] Investigation history & statistics
- [ ] Auto-remediation playbooks
- [ ] Incident correlation & deduplication
- [ ] SLA tracking & reporting
- [ ] Custom tool plugins
- [ ] Web UI dashboard

---

## License

MIT License — Free for personal and commercial use.

---

## Links

- **GitHub**: [github.com/ServiceWeave/triagent](https://github.com/ServiceWeave/triagent)
- **Issues**: [github.com/ServiceWeave/triagent/issues](https://github.com/ServiceWeave/triagent/issues)

---

*Stop firefighting. Start debugging smarter.*
