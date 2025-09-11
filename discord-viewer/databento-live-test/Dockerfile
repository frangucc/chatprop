FROM rust:1.82 as builder

WORKDIR /app

# Copy only the Rust project files
COPY discord-viewer/databento-live-test/Cargo.toml ./
COPY discord-viewer/databento-live-test/Cargo.lock ./
COPY discord-viewer/databento-live-test/src ./src

# Update Cargo.lock to match this Cargo version
RUN cargo update

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