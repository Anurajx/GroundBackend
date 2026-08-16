/**
 * In-memory data store for tracking vehicle positions and polling metadata.
 * Kept global to the application and optimized for read operations.
 */
class BusStore {
  constructor() {
    // Stores vehicles. Key is vehicleId, Value is vehicle position object.
    this.buses = new Map();
    // Tracks status of the background polling worker
    this.pollingStatus = 'idle'; // 'idle' | 'polling' | 'success' | 'failure'
    // Last timestamp when data was successfully loaded or a poll failed
    this.lastPollTimestamp = null;
  }

  /**
   * Replaces the entire active bus list with the new snapshot from GTFS.
   * A full replacement is preferred over incremental updates to prevent
   * stale vehicles (whose trips have completed) from remaining in memory forever.
   * @param {Array<Object>} busList list of parsed vehicle objects
   */
  updateBuses(busList) {
    const newBuses = new Map();
    for (const bus of busList) {
      if (bus.vehicleId) {
        newBuses.set(bus.vehicleId, bus);
      }
    }
    this.buses = newBuses;
    this.pollingStatus = 'success';
    this.lastPollTimestamp = new Date().toISOString();
  }

  /**
   * Sets the current state of the polling worker.
   * @param {string} status 
   */
  setPollingStatus(status) {
    this.pollingStatus = status;
  }

  /**
   * Sets the last poll timestamp.
   * @param {string} timestamp 
   */
  setLastPollTimestamp(timestamp) {
    this.lastPollTimestamp = timestamp;
  }

  /**
   * Returns all active buses as an array.
   * @returns {Array<Object>}
   */
  getBuses() {
    return Array.from(this.buses.values());
  }

  /**
   * Returns polling service statistics.
   * @returns {Object}
   */
  getStats() {
    return {
      status: this.pollingStatus,
      lastPoll: this.lastPollTimestamp,
      count: this.buses.size
    };
  }
}

// Export a single instance to serve as our global in-memory cache.
module.exports = new BusStore();
