const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const busStore = require('../store/busStore');
const websocketService = require('./websocketService');

const FEED_BASE_URL = 'https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb';
const POLL_INTERVAL_MS = 10000; // 10 seconds

let intervalId = null;

/**
 * Performs a single request to the GTFS-Realtime endpoint,
 * decodes the protobuf, and updates the in-memory store.
 */
async function pollFeed() {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.error(`[${new Date().toISOString()}] Polling error: API_KEY is not defined in environment variables.`);
    busStore.setPollingStatus('failure');
    busStore.setLastPollTimestamp(new Date().toISOString());
    return;
  }

  console.log(`[${new Date().toISOString()}] Poll started...`);
  busStore.setPollingStatus('polling');

  try {
    const url = `${FEED_BASE_URL}?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/x-protobuf'
      }
    });

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch (_) {}
      throw new Error(`HTTP ${response.status}: ${response.statusText} - Body: ${bodyText.trim()}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Decode the GTFS-Realtime Protocol Buffer
    let feed;
    try {
      feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
    } catch (decodeError) {
      // Decode failed. Check if server returned a JSON or text error instead of binary protobuf
      let bodyText = '';
      try {
        bodyText = buffer.toString('utf8');
      } catch (_) {}
      
      if (bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
        throw new Error(`Failed to decode Protobuf (received JSON instead). Response: ${bodyText.trim()}`);
      } else if (bodyText.trim()) {
        throw new Error(`Failed to decode Protobuf (received text instead). Response: ${bodyText.trim().substring(0, 200)}`);
      }
      throw decodeError;
    }
    
    const parsedBuses = [];
    
    if (feed.entity && Array.isArray(feed.entity)) {
      for (const entity of feed.entity) {
        if (entity.vehicle) {
          const v = entity.vehicle;
          
          parsedBuses.push({
            vehicleId: v.vehicle && v.vehicle.id ? v.vehicle.id : 'unknown',
            tripId: v.trip && v.trip.tripId ? v.trip.tripId : 'unknown',
            routeId: v.trip && v.trip.routeId ? v.trip.routeId : 'unknown',
            lat: v.position && typeof v.position.latitude === 'number' ? v.position.latitude : 0.0,
            lng: v.position && typeof v.position.longitude === 'number' ? v.position.longitude : 0.0,
            bearing: v.position && typeof v.position.bearing === 'number' ? v.position.bearing : 0.0,
            timestamp: v.timestamp ? Number(v.timestamp) : Math.floor(Date.now() / 1000)
          });
        }
      }
    }

    // Update in-memory store
    busStore.updateBuses(parsedBuses);
    console.log(`[${new Date().toISOString()}] Poll success: loaded ${parsedBuses.length} active vehicles.`);

    // Broadcast the snapshot update to websocket clients
    websocketService.broadcast({
      event: 'update',
      timestamp: busStore.lastPollTimestamp,
      count: parsedBuses.length,
      buses: parsedBuses
    });

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Polling failure:`, error.message);
    busStore.setPollingStatus('failure');
    busStore.setLastPollTimestamp(new Date().toISOString());
  }
}

/**
 * Starts the interval timer for periodic feed fetches.
 */
function startPolling() {
  if (intervalId) {
    return;
  }

  // Trigger initial poll immediately on startup
  pollFeed();

  // Schedule subsequent polls
  intervalId = setInterval(async () => {
    await pollFeed();
  }, POLL_INTERVAL_MS);
}

/**
 * Stops the interval timer.
 */
function stopPolling() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log(`[${new Date().toISOString()}] Polling service stopped.`);
  }
}

module.exports = {
  startPolling,
  stopPolling,
  pollFeed
};
