// Healthcheck for the zilar-server container (see deploy/docker-compose.yml).
// Exits 0 only when GET /health on the configured PORT answers 2xx.
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: controller.signal,
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
