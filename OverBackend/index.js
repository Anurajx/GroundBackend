require("dotenv").config();
const buildApp = require("./src/app");
const { startPolling, stopPolling } = require("./src/services/pollingService");

const PORT = process.env.PORT || 3000;

// Create Fastify server instance.
// We disable default Fastify logging to keep console logs beautifully formatted via custom hooks.
const server = buildApp({
  logger: false,
});

async function main() {
  try {
    // Start listening on specified PORT and host.
    // Use host: '0.0.0.0' to ensure compatibility across all network interfaces.
    await server.listen({ port: Number(PORT), host: "0.0.0.0" });
    console.log(
      `[${new Date().toISOString()}] Server started! Listening on port ${PORT}`,
    );

    // Boot the background GTFS-Realtime polling service
    startPolling();
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Fatal error starting server:`,
      err.message,
    );
    process.exit(1);
  }
}

// Graceful shutdown handler
const shutdown = async () => {
  console.log(`\n[${new Date().toISOString()}] Shutting down server...`);
  stopPolling();
  try {
    await server.close();
    console.log(`[${new Date().toISOString()}] Server closed successfully.`);
    process.exit(0);
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Error during shutdown:`,
      err.message,
    );
    process.exit(1);
  }
};

// Listen for system termination signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();
