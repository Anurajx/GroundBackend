const busStore = require('../store/busStore');
const { calculateHaversineDistance } = require('../utils/haversine');

/**
 * Nearby Buses Endpoint
 * GET /nearby?lat=28.6139&lng=77.2090&radius=3000
 */
module.exports = async function (fastify, opts) {
  fastify.get('/nearby', {
    schema: {
      query: {
        type: 'object',
        required: ['lat', 'lng', 'radius'],
        properties: {
          lat: { 
            type: 'number', 
            minimum: -90, 
            maximum: 90 
          },
          lng: { 
            type: 'number', 
            minimum: -180, 
            maximum: 180 
          },
          radius: { 
            type: 'number', 
            minimum: 0 
          }
        }
      }
    }
  }, async (request, reply) => {
    const { lat, lng, radius } = request.query;
    
    const allBuses = busStore.getBuses();
    const nearbyBuses = [];

    for (const bus of allBuses) {
      // Calculate distance in meters
      const distance = calculateHaversineDistance(lat, lng, bus.lat, bus.lng);
      
      if (distance <= radius) {
        nearbyBuses.push({
          vehicleId: bus.vehicleId,
          routeId: bus.routeId,
          lat: Number(bus.lat.toFixed(6)),
          lng: Number(bus.lng.toFixed(6)),
          distanceMeters: Math.round(distance) // Round to nearest meter
        });
      }
    }

    // Sort by distance (nearest first)
    nearbyBuses.sort((a, b) => a.distanceMeters - b.distanceMeters);

    return {
      count: nearbyBuses.length,
      buses: nearbyBuses
    };
  });
};
