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
    v.transaction_date,
    hist.status_history,
    hist.total_delivery_minutes,
    hist.delivered_by
  FROM vouchers v
  JOIN voucher_types vt ON vt.id = v.voucher_type_id
  JOIN parties p         ON p.id  = v.party_id
  JOIN sites s           ON s.id  = v.site_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        json_agg(
          json_build_object(
            'from_status',  h2.previous_status,
            'to_status',    h2.new_status,
            'changed_at',   h2.changed_at,
            'changed_by',   h2.changed_by_name,
            'duration_min', h2.duration_min
          ) ORDER BY h2.changed_at
        ),
        '[]'::json
      )                                                        AS status_history,
      MAX(CASE WHEN h2.new_status = 'Delivered'
        THEN h2.total_minutes END)                             AS total_delivery_minutes,
      MAX(CASE WHEN h2.new_status = 'Delivered'
        THEN h2.changed_by_name END)                           AS delivered_by
    FROM (
      SELECT
        vsh.previous_status,
        vsh.new_status,
        vsh.changed_at,
        COALESCE(u.full_name, u.username)                     AS changed_by_name,
        ROUND(
          EXTRACT(EPOCH FROM (
            vsh.changed_at -
            LAG(vsh.changed_at) OVER (ORDER BY vsh.changed_at)
          )) / 60
        )::int                                                 AS duration_min,
        ROUND(
          EXTRACT(EPOCH FROM (vsh.changed_at - v.created_at)) / 60
        )::int                                                 AS total_minutes
      FROM voucher_status_history vsh
      LEFT JOIN users u ON u.id = vsh.changed_by
      WHERE vsh.voucher_id = v.id
    ) h2
  ) hist ON true
  WHERE v.organization_id = 2
    AND vt.code = 'SINV'
    AND v.is_cancelled = false
    AND v.site_id IN (1, 4)
`;

function mapRow(r) {
  return {
    id:                     parseInt(r.id),
    voucher_number:         r.voucher_number,
    total_amount:           parseFloat(r.total_amount),
    delivery_status:        r.delivery_status,
    delivery_datetime:      r.delivery_datetime ? r.delivery_datetime.toISOString() : null,
    party_name:             r.party_name,
    site_id:                parseInt(r.site_id),
    site_name:              r.site_name,
    transaction_date:       r.transaction_date,
    status_history:         r.status_history || [],
    total_delivery_minutes: r.total_delivery_minutes != null ? parseInt(r.total_delivery_minutes) : null,
    delivered_by:           r.delivered_by || null,
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

// Backlog — undelivered orders from last 30 days
router.get('/orders', async (_req, res) => {
  try {
    const { rows } = await db.query(BASE_SELECT + `
      AND v.transaction_date >= CURRENT_DATE - 30
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
