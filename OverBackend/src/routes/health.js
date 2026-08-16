const busStore = require('../store/busStore');
const websocketService = require('../services/websocketService');

/**
 * Health Check Endpoint
 * GET /health
 */
module.exports = async function (fastify, opts) {
  fastify.get('/health', async (request, reply) => {
    const stats = busStore.getStats();
    
    return {
      status: 'UP',
      polling: {
        status: stats.status,
        lastPollTimestamp: stats.lastPoll,
        totalActiveVehicles: stats.count
      },
      websockets: {
        activeConnections: websocketService.getConnectionCount()
      },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    };
  });
};
