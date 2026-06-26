const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Routes mounted after Tasks 2–7 add them here
// (Stubs and live routes imported and mounted in Task 2)

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
