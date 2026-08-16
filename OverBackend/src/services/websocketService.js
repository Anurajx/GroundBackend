/**
 * Tracks connected WebSocket clients and handles event broadcasting.
 */
class WebSocketService {
  constructor() {
    this.clients = new Set();
  }

  /**
   * Registers a client socket.
   * @param {WebSocket} socket 
   */
  addClient(socket) {
    this.clients.add(socket);
  }

  /**
   * Unregisters a client socket.
   * @param {WebSocket} socket 
   */
  removeClient(socket) {
    this.clients.delete(socket);
  }

  /**
   * Broadcasts structured JSON data to all open clients.
   * @param {Object} data 
   */
  broadcast(data) {
    const payload = JSON.stringify(data);
    
    for (const client of this.clients) {
      try {
        // readyState 1 is WebSocket.OPEN
        if (client.readyState === 1) {
          client.send(payload);
        } else {
          // If connection is closing or closed, clean up.
          this.removeClient(client);
        }
      } catch (err) {
        console.error('Failed to send data to WebSocket client, removing client:', err.message);
        this.removeClient(client);
      }
    }
  }

  /**
   * Retrieves active connections count.
   * @returns {number}
   */
  getConnectionCount() {
    return this.clients.size;
  }
}

module.exports = new WebSocketService();
