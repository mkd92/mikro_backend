const express   = require('express');
const router    = express.Router();
const { query } = require('../db');

router.get('/customers', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        p.id                              AS party_id,
        p.name                            AS customer_name,
        s.id                              AS site_id,
        s.name                            AS branch,
        p.geo_location,
        p.phone,
        MAX(v.transaction_date)           AS last_order_date,
        COUNT(*)::int                     AS orders_last_30d,
        SUM(v.total_amount)::numeric      AS revenue_last_30d
      FROM vouchers v
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      JOIN parties p        ON p.id  = v.party_id
      JOIN sites s          ON s.id  = v.site_id
      WHERE v.organization_id   = 2
        AND vt.code             = 'SINV'
        AND v.is_cancelled      = false
        AND v.site_id           IN (1, 4)
        AND v.transaction_date  >= CURRENT_DATE - INTERVAL '30 days'
        AND p.name              NOT ILIKE '%emp%'
      GROUP BY p.id, p.name, s.id, s.name, p.geo_location, p.phone
      ORDER BY revenue_last_30d DESC
    `);

    res.json(rows.map(r => ({
      party_id:        parseInt(r.party_id),
      customer_name:   r.customer_name,
      site_id:         parseInt(r.site_id),
      branch:          r.branch,
      geo_location:    r.geo_location || null,
      phone:           r.phone        || null,
      last_order_date: r.last_order_date,
      orders_last_30d: parseInt(r.orders_last_30d),
      revenue_last_30d: parseFloat(r.revenue_last_30d),
    })));
  } catch (err) {
    console.error('locations/customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
