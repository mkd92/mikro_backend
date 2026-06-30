const express   = require('express');
const router    = express.Router();
const { query } = require('../db');

router.get('/customers', async (_req, res) => {
  try {
    const { rows } = await query(`
      WITH order_gaps AS (
        SELECT
          p.id                                                        AS party_id,
          p.name                                                      AS customer_name,
          s.name                                                      AS branch,
          rp.name                                                     AS sales_rep,
          p.phone,
          v.transaction_date,
          v.total_amount,
          ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY v.transaction_date DESC) AS rn,
          (v.transaction_date
            - LAG(v.transaction_date) OVER (PARTITION BY p.id ORDER BY v.transaction_date)
          ) AS gap_days,
          EXTRACT(HOUR FROM v.created_at AT TIME ZONE 'Asia/Kolkata')           AS order_hour
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        JOIN parties p        ON p.id  = v.party_id
        JOIN sites s          ON s.id  = v.site_id
        LEFT JOIN parties rp  ON rp.id = p.responsible_party_id
        WHERE v.organization_id = 2
          AND vt.code           = 'SINV'
          AND v.is_cancelled    = false
          AND v.site_id         IN (1, 4)
          AND p.name            NOT ILIKE '%emp%'
          AND p.party_group_id  != 2
      ),
      customer_stats AS (
        SELECT
          party_id,
          customer_name,
          branch,
          sales_rep,
          phone,
          MAX(CASE WHEN rn = 1 THEN transaction_date END)  AS last_purchase_date,
          MAX(CASE WHEN rn = 1 THEN total_amount END)      AS last_order_amount,
          COUNT(*)                                          AS total_orders,
          AVG(gap_days)                                     AS avg_cycle_days,
          ROUND(AVG(order_hour))::int                       AS usual_order_hour
        FROM order_gaps
        GROUP BY party_id, customer_name, branch, sales_rep, phone
      )
      SELECT
        party_id,
        customer_name,
        branch,
        sales_rep,
        phone,
        last_purchase_date,
        last_order_amount::numeric,
        total_orders::int,
        ROUND(avg_cycle_days)::int                                              AS avg_cycle_days,
        usual_order_hour,
        CASE WHEN avg_cycle_days IS NOT NULL
             THEN (last_purchase_date + ROUND(avg_cycle_days)::int)::date
        END                                                                     AS predicted_next_order_date,
        CASE WHEN avg_cycle_days IS NOT NULL
             THEN (last_purchase_date + ROUND(avg_cycle_days)::int - CURRENT_DATE)::int
        END                                                                     AS days_until_order
      FROM customer_stats
      WHERE last_purchase_date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY
        usual_order_hour ASC NULLS LAST,
        days_until_order ASC NULLS LAST
    `);

    res.json(rows.map(r => ({
      party_id:                 parseInt(r.party_id),
      customer_name:            r.customer_name,
      branch:                   r.branch,
      sales_rep:                r.sales_rep          || null,
      phone:                    r.phone              || null,
      last_purchase_date:       r.last_purchase_date || null,
      last_order_amount:        parseFloat(r.last_order_amount) || 0,
      total_orders:             parseInt(r.total_orders),
      avg_cycle_days:           r.avg_cycle_days != null ? parseInt(r.avg_cycle_days) : null,
      usual_order_hour:         r.usual_order_hour != null ? parseInt(r.usual_order_hour) : null,
      predicted_next_order_date: r.predicted_next_order_date || null,
      days_until_order:         r.days_until_order  != null ? parseInt(r.days_until_order) : null,
    })));
  } catch (err) {
    console.error('followup/customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
