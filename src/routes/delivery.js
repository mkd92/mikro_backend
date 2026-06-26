const express = require('express');
const router = express.Router();
router.get('/pipeline', (_req, res) => res.json([]));
router.get('/orders', (_req, res) => res.json([]));
module.exports = router;
