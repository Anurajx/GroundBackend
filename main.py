from fastapi import FastAPI
import httpx
from dotenv import load_dotenv
import os
import math
from google.transit import gtfs_realtime_pb2

load_dotenv()

app = FastAPI()

FEED_BASE_URL = "https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb"


@app.get("/")
def root():
    return {"message": "Server is running!"}


@app.get("/Route")
async def get_route():
    return {"message": "processing request"}


def calculate_distance(lat1, lng1, lat2, lng2):
    """
    Calculate distance between two coordinates in kilometers.
    Uses the Haversine formula.
    """

    R = 6371.0  # Earth's radius in km

    lat1 = math.radians(lat1)
    lat2 = math.radians(lat2)

    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(delta_lng / 2) ** 2
    )

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


@app.get("/GTFS-RT")
async def get_vehicles(
    lat: float,
    lng: float,
    radius: float = 2.0
):
    RT_api_key = os.getenv("RT_API_KEY")

    if not RT_api_key:
        return {"error": "RT_API_KEY is not configured"}

    url = f"{FEED_BASE_URL}?key={RT_api_key}"

    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            headers={
                "Accept": "application/x-protobuf"
            }
        )

    if response.status_code != 200:
        return {
            "error": response.status_code,
            "message": response.text
        }

    # Decode GTFS-Realtime protobuf
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(response.content)

    buses = []

    for entity in feed.entity:

        # Ignore entities that aren't vehicles
        if not entity.HasField("vehicle"):
            continue

        vehicle = entity.vehicle

        # Ignore vehicles without a position
        if not vehicle.HasField("position"):
            continue

        vehicle_lat = vehicle.position.latitude
        vehicle_lng = vehicle.position.longitude

        distance = calculate_distance(
            lat,
            lng,
            vehicle_lat,
            vehicle_lng
        )

        # Ignore buses outside requested radius
        if distance > radius:
            continue

        buses.append({
            "vehicleId": vehicle.vehicle.id,
            "tripId": vehicle.trip.trip_id,
            "routeId": vehicle.trip.route_id,
            "lat": vehicle_lat,
            "lng": vehicle_lng,
            "bearing": vehicle.position.bearing,
            "timestamp": vehicle.timestamp,
            "distance": round(distance, 3)
        })

    return {
        "user": {
            "lat": lat,
            "lng": lng
        },
        "radius_km": radius,
        "count": len(buses),
        "buses": buses
    }
    
    
@app.get
async def get_route(
    start_lat: float,
    start_lon: float,
    drop_lat: float,
    drop_lon: float,
    mode: str
):
    ROUTE_api_key= os.getenv("ROUTE_API_KEY")
    if not ROUTE_api_key:
        return {"ROUTE_API_KEY is not configured in .env"}
        