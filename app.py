from flask import Flask, request, jsonify
import json
from datetime import datetime, timedelta

app = Flask(__name__)

# Load staff users
with open("users.json") as f:
    users = json.load(f)

complaints = []

# --- LOGIN ---
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    staff_no = data.get("staff_no")
    password = data.get("password")

    user = next((u for u in users if u["staff_no"] == staff_no), None)

    if user and password == staff_no[:4]:
        return jsonify({"message": "Login successful", "user": user}), 200
    return jsonify({"error": "Invalid credentials"}), 401


# --- COMPLAINT LOG ---
@app.route("/api/complaints", methods=["GET", "POST"])
def complaints_api():
    global complaints

    # Auto check for escalation
    now = datetime.now()
    for c in complaints:
        if c["status"] == "Pending":
            logged_time = datetime.fromisoformat(c["date_logged"])
            if now - logged_time > timedelta(days=3):
                c["status"] = "Escalated"

    if request.method == "GET":
        return jsonify(complaints)

    if request.method == "POST":
        complaint = request.json
        complaint["id"] = len(complaints) + 1
        complaint["date_logged"] = datetime.now().isoformat()
        complaint["status"] = "Pending"
        complaints.append(complaint)
        return jsonify({"message": "Complaint added"}), 201


# --- MARK AS RESOLVED ---
@app.route("/api/complaints/<int:cid>/resolve", methods=["POST"])
def resolve_complaint(cid):
    global complaints
    for c in complaints:
        if c["id"] == cid:
            c["status"] = "Resolved"
            return jsonify({"message": f"Complaint {cid} marked as resolved"}), 200
    return jsonify({"error": "Complaint not found"}), 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
