# Triagent - AI-powered Kubernetes Debugging Agent
# This Dockerfile creates a containerized environment for running the "dry agent"
# which performs read-only investigation of Kubernetes cluster issues.

# Stage 1: Build stage
FROM oven/bun:1.2-debian AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code and config files
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tsconfig.json bunfig.toml ./

# Build the application
RUN bun run build

# Stage 2: Runtime stage
FROM oven/bun:1.2-debian AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Git for version control operations (git log, diff, blame, show)
    git \
    # curl for downloading kubectl
    curl \
    # ca-certificates for HTTPS connections
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install kubectl (latest stable)
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# Create non-root user for security (optional, can run as root if needed for kube access)
RUN groupadd -r triagent && useradd -r -g triagent triagent

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json bunfig.toml ./
COPY src/ ./src/

# Create directories for mounts
RUN mkdir -p /workspace /root/.kube && \
    chown -R triagent:triagent /app

# Environment variables with defaults
# AI Provider: openai, anthropic, google
ENV AI_PROVIDER=anthropic
# Model ID (depends on provider)
ENV AI_MODEL=claude-3-5-sonnet-20241022
# Webhook server port
ENV WEBHOOK_PORT=3000
# Codebase path (mounted volume)
ENV CODEBASE_PATH=/workspace
# Kubernetes config path
ENV KUBE_CONFIG_PATH=/root/.kube
# Kubeconfig for kubectl
ENV KUBECONFIG=/root/.kube/config
# Home directory for git and other tools
ENV HOME=/root

# API Keys - these should be provided at runtime via -e or .env file
# ENV OPENAI_API_KEY=
# ENV ANTHROPIC_API_KEY=
# ENV GOOGLE_GENERATIVE_AI_API_KEY=

# Expose webhook server port
EXPOSE 3000

# Health check for webhook mode
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Default command: run in webhook mode for container environments
# Can be overridden with: docker run triagent --incident "description"
# Or for TUI mode (requires -it): docker run -it triagent
ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["--webhook-only"]
