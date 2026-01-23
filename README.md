# Triagent

AI-powered Kubernetes debugging agent with terminal UI.

## Installation

```bash
# bun
bun install -g triagent

# npm
npm install -g triagent

# yarn
yarn global add triagent

# pnpm
pnpm add -g triagent
```

## Usage

```bash
# Run interactive TUI
triagent

# Run webhook server only
triagent --webhook-only

# Direct incident investigation
triagent --incident "API gateway returning 503 errors"
```

## Execution Modes

Triagent supports multiple execution modes via [Bashlet](https://github.com/anthropics/bashlet), plus a host mode that bypasses sandboxing entirely.

### Sandbox Backends (via Bashlet)

```bash
triagent                                    # Docker (default)
triagent --backend docker                   # Docker container
triagent --backend wasm                     # WebAssembly sandbox
triagent --backend microvm                  # MicroVM isolation (Firecracker)
triagent --backend auto                     # Let Bashlet choose best available
triagent --backend ssh user@host[:port]     # SSH to remote server
```

Codebases are mounted at `/workspace/<name>` and kubeconfig at `/root/.kube`.

### Host Mode

Commands run directly on your local machine, bypassing Bashlet entirely. Use this when you need access to tools not available in the sandbox.

```bash
triagent --host
```

### SSH Backend

The SSH backend runs commands on a remote server. This is useful for connecting to a Docker container or VM with pre-installed debugging tools.

```bash
triagent --backend ssh user@host
triagent --backend ssh root@debug-container.local:2222
```

**Requirements:**
- SSH key-based authentication (no password prompts)
- The remote must have the necessary CLI tools (kubectl, etc.)

**Example: Debug container setup**

```bash
# Run a container with SSH and debugging tools
docker run -d --name debug-tools \
  -p 2222:22 \
  -v ~/.kube:/root/.kube:ro \
  your-debug-image:latest

# Add to ~/.ssh/config for easy access
# Host debug-tools
#   HostName localhost
#   Port 2222
#   User root

# Connect triagent to it
triagent --backend ssh debug-tools
```

## Configuration

Configuration can be set via CLI commands or environment variables. CLI config takes precedence over environment variables.

### CLI Config

```bash
# Set configuration values
triagent config set <key> <value>

# Get a configuration value
triagent config get <key>

# List all configuration values
triagent config list

# Show config file path
triagent config path
```

### Config Keys

| Key | Description | Default |
|-----|-------------|---------|
| `aiProvider` | AI provider (`openai`, `anthropic`, `google`) | `anthropic` |
| `aiModel` | Model ID (e.g., `gpt-4o`, `claude-sonnet-4-20250514`) | Provider default |
| `apiKey` | API key for the provider | - |
| `baseUrl` | Custom API base URL (for proxies or local models) | - |
| `webhookPort` | Webhook server port | `3000` |
| `codebasePath` | Path to single codebase (legacy) | `./` |
| `kubeConfigPath` | Kubernetes config path | `~/.kube` |

### Multiple Codebases

For applications spanning multiple repositories, configure `codebasePaths` in `~/.config/triagent/config.json`:

```json
{
  "codebasePaths": [
    { "name": "frontend", "path": "/path/to/frontend-repo" },
    { "name": "backend", "path": "/path/to/backend-repo" },
    { "name": "infra", "path": "/path/to/infrastructure" }
  ]
}
```

Each codebase is mounted at `/workspace/<name>` in the sandbox. The model can access any codebase as needed during investigation.

### Custom Instructions (TRIAGENT.md)

Create `~/.config/triagent/TRIAGENT.md` to provide custom instructions to the model. These instructions are prepended to the default system prompt.

Example `TRIAGENT.md`:

```markdown
## Project Context

This is a microservices e-commerce platform with the following services:
- frontend: Next.js app in /workspace/frontend
- api: Go backend in /workspace/backend
- infra: Terraform configs in /workspace/infra

## Investigation Priorities

1. Always check the api service logs first for 5xx errors
2. The frontend service talks to api via internal DNS: api.default.svc.cluster.local
3. Common issues: Redis connection timeouts, PostgreSQL connection pool exhaustion
```

### Environment Variables

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

### Examples

```bash
# Configure with Anthropic (default)
triagent config set apiKey sk-ant-...

# Configure with OpenAI
triagent config set aiProvider openai
triagent config set apiKey sk-proj-...

# Use a custom API endpoint (e.g., proxy or local model)
triagent config set baseUrl https://your-proxy.example.com/v1
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
