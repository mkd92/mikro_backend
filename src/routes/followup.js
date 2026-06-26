const express = require('express');
const router = express.Router();
router.get('/customers', (_req, res) => res.json([]));
module.exports = router;
