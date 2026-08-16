from fastapi import FastAPI
import httpx
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()

FEED_BASE_URL = "https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb"


@app.get("/")
def root():
    return {"message": "Server is running!"}

@app.get("/Route")
async def get_route():
    return "processing request"
    
    

@app.get('/GTFS-RT')
async def get_vehicles():
    api_key = os.getenv("API_KEY")

    url = f"{FEED_BASE_URL}?key={api_key}"
    print(url)

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

    return {
        "status": "success",
        "bytes_received": len(response.content)
    }