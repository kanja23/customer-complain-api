const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const XLSX = require("xlsx");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Database initialization
const db = new sqlite3.Database("./data.db");

// Initialize database tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    staffNumber TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL
  )`);

  // Complaints table
  db.run(`CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaintId TEXT UNIQUE NOT NULL,
    customerName TEXT NOT NULL,
    meterNo TEXT NOT NULL,
    meterType TEXT NOT NULL,
    issueType TEXT NOT NULL,
    description TEXT NOT NULL,
    assignedTo TEXT NOT NULL,
    supervisor TEXT NOT NULL,
    status TEXT DEFAULT 'New',
    loggedAt TEXT NOT NULL,
    resolvedAt TEXT
  )`);

  // Escalations table
  db.run(`CREATE TABLE IF NOT EXISTS escalations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    complaintId TEXT NOT NULL,
    escalatedAt TEXT NOT NULL,
    loggedAt TEXT NOT NULL,
    assignedTo TEXT NOT NULL,
    customerName TEXT NOT NULL,
    issueType TEXT NOT NULL
  )`);

  // Seed users
  const users = [
    { name: 'Mercy Nambiro', staffNumber: '86001', role: 'supervisor' },
    { name: 'Noel Nanzushi', staffNumber: '85905', role: 'staff' },
    { name: 'Patrick Moenga', staffNumber: '85915', role: 'staff' },
    { name: 'John Migeni', staffNumber: '85925', role: 'staff' },
    { name: 'Martin Karanja', staffNumber: '85891', role: 'admin' }
  ];

  users.forEach(user => {
    db.run(`INSERT OR IGNORE INTO users (name, staffNumber, role) VALUES (?, ?, ?)`, 
      [user.name, user.staffNumber, user.role]);
  });
});

// Email configuration
let transporter;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Helper function to generate complaint ID
const generateComplaintId = () => {
  const year = new Date().getFullYear();
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM complaints WHERE complaintId LIKE ?`, 
      [`${year}-%`], (err, row) => {
      if (err) reject(err);
      const nextNumber = (row.count + 1).toString().padStart(4, '0');
      resolve(`${year}-${nextNumber}`);
    });
  });
};

// Helper function to send email
const sendEmail = async (subject, text, html) => {
  if (!transporter || !process.env.MAIL_TO) return;
  
  try {
    const recipients = process.env.MAIL_TO.split(',');
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: recipients,
      subject,
      text,
      html
    });
  } catch (error) {
    console.error('Email sending failed:', error);
  }
};

// Routes

// Login
app.post('/api/login', (req, res) => {
  const { staffNumber, password } = req.body;
  
  if (!staffNumber || !password) {
    return res.status(400).json({ error: 'Staff number and password required' });
  }

  // PIN validation: first 4 digits of staff number
  const expectedPin = staffNumber.substring(0, 4);
  if (password !== expectedPin) {
    return res.status(401).json({ error: '⚠ Wrong username or password. Please try again.' });
  }

  db.get(`SELECT * FROM users WHERE staffNumber = ?`, [staffNumber], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user) {
      return res.status(401).json({ error: '⚠ Wrong username or password. Please try again.' });
    }

    const token = jwt.sign(
      { id: user.id, staffNumber: user.staffNumber, role: user.role },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        staffNumber: user.staffNumber,
        role: user.role
      }
    });
  });
});

// Get summary
app.get('/api/summary', authenticateToken, (req, res) => {
  const queries = [
    `SELECT COUNT(*) as total FROM complaints`,
    `SELECT COUNT(*) as resolved FROM complaints WHERE status = 'Resolved'`,
    `SELECT COUNT(*) as pending_lt3 FROM complaints WHERE status != 'Resolved' AND julianday('now') - julianday(loggedAt) < 3`,
    `SELECT COUNT(*) as pending_gte3 FROM complaints WHERE status != 'Resolved' AND julianday('now') - julianday(loggedAt) >= 3`
  ];

  Promise.all(queries.map(query => 
    new Promise((resolve, reject) => {
      db.get(query, (err, row) => {
        if (err) reject(err);
        else resolve(Object.values(row)[0]);
      });
    })
  )).then(([total, resolved, pending_lt3, pending_gte3]) => {
    res.json({ total, resolved, pending_lt3, pending_gte3 });
  }).catch(err => {
    res.status(500).json({ error: 'Database error' });
  });
});

// Create complaint
app.post('/api/complaints', authenticateToken, async (req, res) => {
  try {
    const { customerName, meterNo, meterType, issueType, description, assignedTo, supervisor } = req.body;
    
    if (!customerName || !meterNo || !meterType || !issueType || !description) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const complaintId = await generateComplaintId();
    const loggedAt = new Date().toISOString();
    
    // Auto-assign rule for prepaid
    let finalAssignedTo = assignedTo;
    if (meterType === 'Prepaid') {
      finalAssignedTo = 'John Migeni';
    }

    db.run(`INSERT INTO complaints (complaintId, customerName, meterNo, meterType, issueType, description, assignedTo, supervisor, loggedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [complaintId, customerName, meterNo, meterType, issueType, description, finalAssignedTo, supervisor, loggedAt],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Send email notification
        const emailSubject = `New Complaint Logged - ${complaintId}`;
        const emailText = `
New complaint has been logged:

Complaint ID: ${complaintId}
Customer: ${customerName}
Meter No: ${meterNo}
Meter Type: ${meterType}
Issue Type: ${issueType}
Description: ${description}
Assigned To: ${finalAssignedTo}
Supervisor: ${supervisor}
Logged At: ${new Date(loggedAt).toLocaleString()}

Please take appropriate action.

- Kakamega County Complaint Log
        `;

        sendEmail(emailSubject, emailText);

        res.json({ 
          id: this.lastID, 
          complaintId,
          assignedTo: finalAssignedTo
        });
      });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get complaints
app.get('/api/complaints', authenticateToken, (req, res) => {
  const { q, status, assignedTo, dateFrom, dateTo, limit = 50 } = req.query;
  
  let query = `SELECT *, 
    CASE 
      WHEN status = 'Resolved' THEN 0
      ELSE CAST(julianday('now') - julianday(loggedAt) AS INTEGER)
    END as daysPending
    FROM complaints WHERE 1=1`;
  
  const params = [];

  if (q) {
    query += ` AND (customerName LIKE ? OR meterNo LIKE ? OR complaintId LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  
  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  
  if (assignedTo) {
    query += ` AND assignedTo = ?`;
    params.push(assignedTo);
  }
  
  if (dateFrom) {
    query += ` AND date(loggedAt) >= ?`;
    params.push(dateFrom);
  }
  
  if (dateTo) {
    query += ` AND date(loggedAt) <= ?`;
    params.push(dateTo);
  }

  query += ` ORDER BY loggedAt DESC LIMIT ?`;
  params.push(parseInt(limit));

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Update complaint status
app.post('/api/complaints/:id/status', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  
  let newStatus, resolvedAt = null;
  
  if (action === 'progress') {
    newStatus = 'In Progress';
  } else if (action === 'resolve') {
    newStatus = 'Resolved';
    resolvedAt = new Date().toISOString();
  } else {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const updateQuery = resolvedAt 
    ? `UPDATE complaints SET status = ?, resolvedAt = ? WHERE id = ?`
    : `UPDATE complaints SET status = ? WHERE id = ?`;
  
  const params = resolvedAt ? [newStatus, resolvedAt, id] : [newStatus, id];

  db.run(updateQuery, params, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    
    res.json({ success: true, status: newStatus });
  });
});

// Get escalations
app.get('/api/escalations', authenticateToken, (req, res) => {
  const { recent } = req.query;
  
  let query = `SELECT * FROM escalations ORDER BY escalatedAt DESC`;
  
  if (recent) {
    query = `SELECT * FROM escalations WHERE datetime(escalatedAt) > datetime('now', '-20 minutes') ORDER BY escalatedAt DESC`;
  }

  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Reports CSV
app.get('/api/reports.csv', (req, res) => {
  const token = req.query.auth;
  
  if (!token) {
    return res.status(401).json({ error: 'Auth token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const query = `
      SELECT 
        complaintId as "Complaint ID",
        customerName as "Customer Name",
        meterNo as "Meter No",
        meterType as "Meter Type",
        issueType as "Type of Issue",
        CASE 
          WHEN status = 'Resolved' THEN 0
          ELSE CAST(julianday('now') - julianday(loggedAt) AS INTEGER)
        END as "Days Pending",
        assignedTo as "Assigned Staff",
        supervisor as "Supervisor",
        CASE WHEN status = 'Escalated' THEN 'Yes' ELSE 'No' END as "Escalation Flag",
        loggedAt as "Timestamp",
        resolvedAt as "Resolution Date",
        '' as "Zone Performance"
      FROM complaints
      ORDER BY loggedAt DESC
    `;

    db.all(query, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Convert to CSV
      if (rows.length === 0) {
        return res.send('No data available');
      }

      const headers = Object.keys(rows[0]).join(',');
      const csvData = rows.map(row => 
        Object.values(row).map(val => 
          typeof val === 'string' && val.includes(',') ? `"${val}"` : val
        ).join(',')
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="complaints_report.csv"');
      res.send(headers + '\n' + csvData);
    });
  });
});

// Reports XLSX
app.get('/api/reports.xlsx', (req, res) => {
  const token = req.query.auth;
  
  if (!token) {
    return res.status(401).json({ error: 'Auth token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const query = `
      SELECT 
        complaintId as "Complaint ID",
        customerName as "Customer Name",
        meterNo as "Meter No",
        meterType as "Meter Type",
        issueType as "Type of Issue",
        CASE 
          WHEN status = 'Resolved' THEN 0
          ELSE CAST(julianday('now') - julianday(loggedAt) AS INTEGER)
        END as "Days Pending",
        assignedTo as "Assigned Staff",
        supervisor as "Supervisor",
        CASE WHEN status = 'Escalated' THEN 'Yes' ELSE 'No' END as "Escalation Flag",
        loggedAt as "Timestamp",
        resolvedAt as "Resolution Date",
        '' as "Zone Performance",
        meterNo as "MeterCheck"
      FROM complaints
      ORDER BY loggedAt DESC
    `;

    db.all(query, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Check for recurrent issues (same meter in last 30 days)
      const meterCounts = {};
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      rows.forEach(row => {
        const loggedDate = new Date(row.Timestamp);
        if (loggedDate >= thirtyDaysAgo) {
          meterCounts[row["Meter No"]] = (meterCounts[row["Meter No"]] || 0) + 1;
        }
      });

      // Add recurrent flag
      const processedRows = rows.map(row => {
        const { MeterCheck, ...cleanRow } = row;
        return {
          ...cleanRow,
          "Recurrent": meterCounts[row["Meter No"]] > 1 ? "Yes" : "No"
        };
      });

      // Create workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(processedRows);

      // Style recurrent issues (basic implementation)
      processedRows.forEach((row, index) => {
        if (row.Recurrent === "Yes") {
          // Note: XLSX styling is limited in this basic implementation
          // In a full implementation, you'd use more advanced styling
        }
      });

      XLSX.utils.book_append_sheet(wb, ws, "Complaints Report");

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="complaints_report.xlsx"');
      res.send(buffer);
    });
  });
});

// Escalation cron job (runs every 15 minutes)
cron.schedule('*/15 * * * *', () => {
  console.log('Running escalation check...');
  
  const query = `
    SELECT * FROM complaints 
    WHERE status != 'Resolved' 
    AND status != 'Escalated'
    AND julianday('now') - julianday(loggedAt) >= 3
  `;

  db.all(query, (err, complaints) => {
    if (err) {
      console.error('Escalation check error:', err);
      return;
    }

    complaints.forEach(complaint => {
      // Update complaint status
      db.run(`UPDATE complaints SET status = 'Escalated' WHERE id = ?`, [complaint.id]);

      // Insert escalation record
      const escalatedAt = new Date().toISOString();
      db.run(`INSERT INTO escalations (complaintId, escalatedAt, loggedAt, assignedTo, customerName, issueType)
              VALUES (?, ?, ?, ?, ?, ?)`, 
        [complaint.complaintId, escalatedAt, complaint.loggedAt, complaint.assignedTo, complaint.customerName, complaint.issueType]);

      // Send escalation email
      const daysPending = Math.floor((new Date() - new Date(complaint.loggedAt)) / (1000 * 60 * 60 * 24));
      const emailSubject = `🔔 Complaint Escalation Alert - ${complaint.complaintId}`;
      const emailText = `
🔔 Complaint Escalation Alert
Complaint ID: ${complaint.complaintId}
Customer: ${complaint.customerName}
Meter No: ${complaint.meterNo} (${complaint.meterType})
Issue: ${complaint.issueType} (Pending ${daysPending} days)
Assigned: ${complaint.assignedTo}
Logged: ${new Date(complaint.loggedAt).toLocaleString()}
Status: Overdue – Action Required
– Sent by Kakamega East Complaint Tracker
      `;

      sendEmail(emailSubject, emailText);
    });

    if (complaints.length > 0) {
      console.log(`Escalated ${complaints.length} complaints`);
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

