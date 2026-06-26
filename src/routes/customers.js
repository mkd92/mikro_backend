const express = require('express');
const db = require('../db');

const router = express.Router();
const n = v => parseFloat(v) || 0;

router.get('/ar-aging', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        CASE
          WHEN CURRENT_DATE - v.transaction_date <= 30 THEN '0-30'
          WHEN CURRENT_DATE - v.transaction_date <= 60 THEN '31-60'
          WHEN CURRENT_DATE - v.transaction_date <= 90 THEN '61-90'
          ELSE '90+'
        END AS age_bucket,
        COUNT(*)::int AS invoice_count,
        SUM(v.amount_due) AS outstanding
      FROM vouchers v
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      WHERE v.organization_id = 2
        AND vt.code = 'SINV'
        AND v.is_cancelled = false
        AND v.site_id IN (1, 4)
        AND v.payment_status IN ('Unpaid', 'Partially Paid')
        AND v.amount_due > 0
      GROUP BY age_bucket
      ORDER BY MIN(CURRENT_DATE - v.transaction_date) ASC
    `);
    res.json(rows.map(r => ({
      age_bucket:    r.age_bucket,
      invoice_count: r.invoice_count,
      outstanding:   n(r.outstanding),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
