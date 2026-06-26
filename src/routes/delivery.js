const express = require('express');
const router  = express.Router();
const db      = require('../db');

const BASE_SELECT = `
  SELECT
    v.id,
    v.voucher_number,
    v.total_amount,
    COALESCE(v.delivery_status, 'Pending') AS delivery_status,
    v.delivery_datetime,
    p.name  AS party_name,
    v.site_id,
    s.name  AS site_name,
    v.transaction_date
  FROM vouchers v
  JOIN voucher_types vt ON vt.id = v.voucher_type_id
  JOIN parties p         ON p.id  = v.party_id
  JOIN sites s           ON s.id  = v.site_id
  WHERE v.organization_id = 2
    AND vt.code = 'SINV'
    AND v.is_cancelled = false
    AND v.site_id IN (1, 4)
`;

function mapRow(r) {
  return {
    id:                parseInt(r.id),
    voucher_number:    r.voucher_number,
    total_amount:      parseFloat(r.total_amount),
    delivery_status:   r.delivery_status,
    delivery_datetime: r.delivery_datetime ? r.delivery_datetime.toISOString() : null,
    party_name:        r.party_name,
    site_id:           parseInt(r.site_id),
    site_name:         r.site_name,
    transaction_date:  r.transaction_date,
  };
}

// Today's run
router.get('/pipeline', async (_req, res) => {
  try {
    const { rows } = await db.query(BASE_SELECT + `
      AND v.transaction_date = CURRENT_DATE
      ORDER BY
        CASE COALESCE(v.delivery_status, 'Pending')
          WHEN 'Pending'          THEN 0
          WHEN 'Out for Delivery' THEN 1
          WHEN 'Delivered'        THEN 2
          ELSE 3
        END,
        v.voucher_number
    `);
    res.json(rows.map(mapRow));
  } catch (err) {
    console.error('delivery/pipeline error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Backlog — undelivered orders before today
router.get('/orders', async (_req, res) => {
  try {
    const { rows } = await db.query(BASE_SELECT + `
      AND v.transaction_date < CURRENT_DATE
      AND COALESCE(v.delivery_status, 'Pending') != 'Delivered'
      ORDER BY v.transaction_date ASC, v.voucher_number
    `);
    res.json(rows.map(mapRow));
  } catch (err) {
    console.error('delivery/orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
