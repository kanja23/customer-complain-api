import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)

# Allow only your Netlify domain in production
allowed_origins = os.getenv("CORS_ORIGINS", "*").split(",")
CORS(app, resources={r"/api/*": {"origins": allowed_origins}})

# Health check
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

# Example GET endpoint
@app.route("/api/jobs", methods=["GET"])
def get_jobs():
    jobs = [
        {"id": 1, "region": "Malava", "status": "Pending"},
        {"id": 2, "region": "Khayega", "status": "Pending"},
        {"id": 3, "region": "Musoli", "status": "Completed"},
        {"id": 4, "region": "Lurambi", "status": "Completed"},
    ]
    return jsonify(jobs)

# Example POST endpoint
@app.route("/api/jobs", methods=["POST"])
def create_job():
    data = request.get_json()
    return jsonify({"ok": True, "job": data}), 201

if __name__ == "__main__":
    app.run()
