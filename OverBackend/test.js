const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:3000/realtime");

ws.on("open", () => {
  console.log("Connected");
});

ws.on("message", (message) => {
  const data = JSON.parse(message);
  console.log("Received:", data);
});

ws.on("error", (err) => {
  console.error(err);
});
