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
| `codebasePath` | Path to codebase | `./` |
| `kubeConfigPath` | Kubernetes config path | `~/.kube` |

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
