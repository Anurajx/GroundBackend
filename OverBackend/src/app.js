const fastify = require("fastify");
const fastifyWebsocket = require("@fastify/websocket");

const healthRoute = require("./routes/health");
const nearbyRoute = require("./routes/nearby");
const realtimeRoute = require("./routes/realtime");

/**
 * Builds the Fastify application instance.
 * Sets up middleware, hooks, and endpoints.
 */
function buildApp(opts = {}) {
  const app = fastify(opts);

  // Register @fastify/websocket to support ws:// routes
  app.register(fastifyWebsocket);

  // Hook to log incoming API requests in a clean, human-readable format
  app.addHook("onRequest", (request, reply, done) => {
    // Exclude websocket noise or ping frames if needed, but log normal connections
    console.log(
      `[${new Date().toISOString()}] API Request: ${request.method} ${request.url}`,
    );
    done();
  });

  // Hook to log completed API responses
  app.addHook("onResponse", (request, reply, done) => {
    console.log(
      `[${new Date().toISOString()}] API Response: ${request.method} ${request.url} status=${reply.statusCode} duration=${reply.elapsedTime.toFixed(2)}ms`,
    );
    done();
  });

  // Register endpoint routes
  app.register(healthRoute);
  app.register(nearbyRoute);
  app.register(realtimeRoute);

  return app;
}

module.exports = buildApp;
