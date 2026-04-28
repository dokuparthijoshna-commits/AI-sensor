"""
AI Sensor Fault Detection - Flask Backend
=========================================
Run this on your laptop FIRST before connecting ESP32.

Install dependencies:
    pip install flask scikit-learn pandas flask-cors

Run:
    python server.py

Your laptop IP (find it):
    Windows: ipconfig  →  IPv4 Address
    Mac/Linux: ifconfig  →  inet
    Use THAT IP in your ESP32 code as serverName
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from sklearn.ensemble import IsolationForest
from datetime import datetime
import json

app = Flask(__name__)
CORS(app)  # Allow dashboard to fetch data

# ── 1. Train model on "normal" baseline data ──────────────────────────────────
# These are typical healthy readings. Expand this list for better accuracy.
normal_data = pd.DataFrame({
    "temp":     [24, 25, 26, 27, 28, 29, 30, 26, 27, 25],
    "humidity": [45, 50, 55, 60, 65, 55, 50, 48, 62, 58]
})

model = IsolationForest(contamination=0.1, random_state=42)
model.fit(normal_data)

print("✅ Isolation Forest model trained on baseline data")

# ── 2. Storage ────────────────────────────────────────────────────────────────
latest_status = {
    "status": "Waiting",
    "data": {},
    "timestamp": None,
    "anomaly_reason": []
}
history = []   # last 100 readings

# ── 3. Routes ─────────────────────────────────────────────────────────────────

@app.route('/data', methods=['POST'])
def receive_data():
    """ESP32 POSTs sensor readings here every 5 seconds"""
    global latest_status

    raw = request.json
    print(f"📡 Received: {raw}")

    # Validate fields
    required = ["temp", "humidity"]
    for field in required:
        if field not in raw:
            return jsonify({"error": f"Missing field: {field}"}), 400

    source = raw.get("source", "real")

    # Run through Isolation Forest
    df = pd.DataFrame([{
        "temp": float(raw["temp"]),
        "humidity": float(raw["humidity"])
    }])
    prediction = model.predict(df)   # 1 = normal, -1 = anomaly
    score = float(model.score_samples(df)[0])  # lower = more anomalous

    # Extra threshold check (catches extreme faults the model might miss early)
    threshold_flags = []
    if float(raw["temp"]) > 50 or float(raw["temp"]) < 5:
        threshold_flags.append(f"Temp {raw['temp']}°C out of range")
    if float(raw["humidity"]) > 85 or float(raw["humidity"]) < 15:
        threshold_flags.append(f"Humidity {raw['humidity']}% out of range")

    is_anomaly = (prediction[0] == -1) or len(threshold_flags) > 0

    latest_status = {
        "status": "Anomaly" if is_anomaly else "Normal",
        "data": raw,
        "timestamp": datetime.now().strftime("%H:%M:%S"),
        "anomaly_reason": threshold_flags,
        "score": round(score, 4),
        "source": source
    }

    # Save to history
    history.append({**latest_status})
    if len(history) > 100:
        history.pop(0)

    # Console feedback
    icon = "🔴 ANOMALY" if is_anomaly else "🟢 Normal"
    print(f"{icon} | Score: {score:.3f} | Source: {source} | {raw}")

    return jsonify({"message": "OK", "status": latest_status["status"]})


@app.route('/status', methods=['GET'])
def get_status():
    """Dashboard polls this every 2 seconds"""
    return jsonify(latest_status)


@app.route('/history', methods=['GET'])
def get_history():
    """Dashboard fetches last N readings for charts"""
    n = int(request.args.get('n', 30))
    return jsonify(history[-n:])


@app.route('/health', methods=['GET'])
def health():
    """Quick check that server is running"""
    return jsonify({"server": "online", "readings": len(history)})


# ── 4. Start ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("\n🚀 Server starting on http://0.0.0.0:5000")
    print("📌 Open http://localhost:5000/health to verify")
    print("📌 Dashboard polls http://localhost:5000/status")
    print("📌 ESP32 should POST to http://YOUR_LAPTOP_IP:5000/data\n")
    app.run(host='0.0.0.0', port=5000, debug=True)
