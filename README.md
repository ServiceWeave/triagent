# Triagent

AI-powered Kubernetes debugging agent with terminal UI.

## Installation

```bash
bun install triagent
```

## Usage

```bash
# Run interactive TUI
triagent

# Run webhook server only
triagent --webhook-only
```

## Configuration

Set the following environment variables:

```bash
ANTHROPIC_API_KEY=your-api-key
# or
OPENAI_API_KEY=your-api-key
# or
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key
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
