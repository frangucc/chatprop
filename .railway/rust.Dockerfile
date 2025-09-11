FROM rust:1.75 as builder

WORKDIR /app

# Copy Rust source
COPY discord-viewer/databento-live-test/ ./

# Build release binary
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/target/release/databento-live-test ./

# Expose port
EXPOSE 7878

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:7878/ || exit 1

CMD ["./databento-live-test"]