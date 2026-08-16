const websocketService = require('../services/websocketService');
const busStore = require('../store/busStore');

/**
 * WebSocket Route
 * Handles connection establishment and client teardown.
 * ws://localhost:3000/realtime
 */
module.exports = async function (fastify, opts) {
  fastify.get('/realtime', { websocket: true }, (connection, req) => {
    const socket = connection.socket;
    
    // Add socket to active connections
    websocketService.addClient(socket);
    
    console.log(`[${new Date().toISOString()}] WebSocket client connected. Active clients: ${websocketService.getConnectionCount()}`);

    // Send the current cache state immediately upon connection
    const currentBuses = busStore.getBuses();
    try {
      socket.send(JSON.stringify({
        event: 'welcome',
        timestamp: busStore.lastPollTimestamp,
        count: currentBuses.length,
        buses: currentBuses
      }));
    } catch (err) {
      console.error('Failed to send welcome message to socket:', err.message);
    }

    socket.on('close', () => {
      websocketService.removeClient(socket);
      console.log(`[${new Date().toISOString()}] WebSocket client disconnected. Active clients: ${websocketService.getConnectionCount()}`);
    });

    socket.on('error', (err) => {
      websocketService.removeClient(socket);
      console.error(`[${new Date().toISOString()}] WebSocket client error:`, err.message);
    });
  });
};
