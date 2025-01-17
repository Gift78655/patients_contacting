const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Ensure 'uploads' directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Serve static files
app.use('/uploads', express.static(uploadsDir));

// Twilio configuration
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(accountSid, authToken);

// Nodemailer configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// Multer configuration for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
});

// MySQL Database configuration (using cloud-hosted database)
const db = mysql.createConnection({
  host: process.env.DB_HOST,       // Use cloud DB host
  user: process.env.DB_USER,       // Use cloud DB username
  password: process.env.DB_PASSWORD, // Use cloud DB password
  database: process.env.DB_NAME,    // Use cloud DB name
  port: process.env.DB_PORT || 3306, // Default MySQL port if not defined
});

// Connect to the database
db.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  } else {
    console.log('✅ Connected to the MySQL database.');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('Server is healthy!');
});

// Fetch patient details by ID
app.get('/api/patient/:id', (req, res) => {
  const patientId = req.params.id;
  const query = 'SELECT * FROM Patients WHERE patient_id = ?';

  db.query(query, [patientId], (err, result) => {
    if (err) {
      res.status(500).json({ error: 'Database query error' });
    } else if (result.length === 0) {
      res.status(404).json({ error: 'Patient not found' });
    } else {
      res.status(200).json(result[0]);
    }
  });
});

// Send Email
app.post('/api/send-email', upload.single('file'), (req, res) => {
  const { recipientEmails, subject, body } = req.body;
  const file = req.file;

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: recipientEmails.split(','), // Expecting a comma-separated string of emails
    subject,
    text: body,
    ...(file && {
      attachments: [
        {
          filename: file.originalname,
          path: path.join(uploadsDir, file.filename),
        },
      ],
    }),
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error('❌ Error sending email:', err.message);
      res.status(500).json({ error: 'Failed to send email' });
    } else {
      console.log('✅ Email sent successfully:', info.response);

      // Delete the file after sending
      if (file) {
        fs.unlink(file.path, (unlinkErr) => {
          if (unlinkErr) console.error('❌ Error deleting file:', unlinkErr.message);
          else console.log('✅ File deleted successfully:', file.path);
        });
      }

      res.status(200).json({ message: 'Email sent successfully', info });
    }
  });
});

// Send SMS
app.post('/api/send-sms', (req, res) => {
  const { recipientPhones, message } = req.body;

  const sendPromises = recipientPhones.map((phone) =>
    twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    })
  );

  Promise.all(sendPromises)
    .then((results) => res.status(200).json({ message: 'SMS sent successfully', results }))
    .catch((err) => res.status(500).json({ error: 'Failed to send SMS', details: err.message }));
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
