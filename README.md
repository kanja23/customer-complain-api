# Simple Complaint Log System

A lightweight complaint/issue logging system built with a **frontend (Netlify)** and a **backend API (Render)**.
The system allows users to log complaints, track resolution progress and generate reports.

---

## 🚀 Features

* **Dashboard** – Overview of open, resolved and overdue complaints.
* **New Complaint Form** – Easy input with auto-generated complaint ID.
* **Complaint List** – Search, filter and color-coded statuses.
* **Escalation Logic** – Automatically flags overdue complaints.
* **Reports** – Export data in Excel or PDF.

---

## 🛠 Tech Stack

* **Frontend:** HTML, CSS, JavaScript (deployed on Netlify)
* **Backend:** Flask API (deployed on Render)
* **Database:** SQLite (for demo) / can be swapped with PostgreSQL

---

## 📂 API Endpoints

```
GET    /api/complaints       → List all complaints  
POST   /api/complaints       → Add a new complaint  
PUT    /api/complaints/:id   → Update complaint status/details  
DELETE /api/complaints/:id   → Remove a complaint  
```

## 📌 Usage

1. Open the dashboard to view complaint stats.
2. Use **New Complaint** form to log issues.
3. Track progress in the **Complaint List**.
4. Export reports from the **Reports** tab.

---

## 📖 License

MIT License – Free to use and modify.
