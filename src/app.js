const express = require('express');
const cors = require('cors');

const salesRouter     = require('./routes/sales');
const customersRouter = require('./routes/customers');
const riskRouter      = require('./routes/risk');
const followupRouter  = require('./routes/followup');
const deliveryRouter     = require('./routes/delivery');
const dailyReportRouter  = require('./routes/daily-report');
const locationsRouter    = require('./routes/locations');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/sales',     salesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/risk',      riskRouter);
app.use('/api/followup',  followupRouter);
app.use('/api/delivery',     deliveryRouter);
app.use('/api/daily-report', dailyReportRouter);
app.use('/api/locations',   locationsRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
