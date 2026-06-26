const express = require('express');
const router  = express.Router();
const pool    = require('../db');

router.get('/customers', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH overdue AS (
        SELECT
          v.party_id,
          SUM(v.amount_due)::numeric                  AS outstanding_amount,
          MAX(CURRENT_DATE - v.transaction_date)::int AS overdue_days
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        WHERE v.organization_id = 2
          AND vt.code = 'SINV'
          AND v.is_cancelled = false
          AND v.site_id IN (1, 4)
          AND v.payment_status IN ('Unpaid', 'Partially Paid')
          AND v.amount_due > 0
          AND v.transaction_date < CURRENT_DATE - 30
        GROUP BY v.party_id
      ),
      ghost AS (
        SELECT
          v2.party_id,
          MAX(v2.transaction_date)                         AS last_order_date,
          MAX(CURRENT_DATE - v2.transaction_date)::int     AS days_since_last_order
        FROM vouchers v2
        JOIN voucher_types vt2 ON vt2.id = v2.voucher_type_id
        WHERE v2.organization_id = 2
          AND vt2.code = 'SINV'
          AND v2.is_cancelled = false
          AND v2.site_id IN (1, 4)
          AND v2.transaction_date >= CURRENT_DATE - 90
          AND v2.transaction_date <  CURRENT_DATE - 30
          AND v2.party_id NOT IN (
            SELECT DISTINCT v3.party_id
            FROM vouchers v3
            JOIN voucher_types vt3 ON vt3.id = v3.voucher_type_id
            WHERE v3.organization_id = 2
              AND vt3.code = 'SINV'
              AND v3.is_cancelled = false
              AND v3.site_id IN (1, 4)
              AND v3.transaction_date >= CURRENT_DATE - 30
          )
        GROUP BY v2.party_id
      )
      SELECT
        COALESCE(o.party_id, g.party_id)              AS party_id,
        p.name                                          AS party_name,
        v_last.site_id,
        s.name                                          AS site_name,
        CASE
          WHEN o.party_id IS NOT NULL AND g.party_id IS NOT NULL THEN 'both'
          WHEN o.party_id IS NOT NULL                            THEN 'overdue_ar'
          ELSE                                                        'ghost'
        END                                             AS risk_type,
        COALESCE(o.outstanding_amount, 0)              AS outstanding_amount,
        COALESCE(o.overdue_days, 0)                    AS overdue_days,
        g.last_order_date,
        g.days_since_last_order
      FROM overdue o
      FULL JOIN ghost g ON g.party_id = o.party_id
      JOIN parties p ON p.id = COALESCE(o.party_id, g.party_id)
      JOIN LATERAL (
        SELECT lv.site_id
        FROM vouchers lv
        JOIN voucher_types lvt ON lvt.id = lv.voucher_type_id
        WHERE lv.party_id = COALESCE(o.party_id, g.party_id)
          AND lv.organization_id = 2
          AND lvt.code = 'SINV'
          AND lv.is_cancelled = false
        ORDER BY lv.transaction_date DESC
        LIMIT 1
      ) v_last ON true
      JOIN sites s ON s.id = v_last.site_id
      ORDER BY
        CASE
          WHEN o.party_id IS NOT NULL AND g.party_id IS NOT NULL THEN 0
          WHEN o.party_id IS NOT NULL                            THEN 1
          ELSE 2
        END,
        COALESCE(o.outstanding_amount, 0) DESC
    `);

    res.json(rows.map(r => ({
      party_id:              parseInt(r.party_id),
      party_name:            r.party_name,
      site_id:               parseInt(r.site_id),
      site_name:             r.site_name,
      risk_type:             r.risk_type,
      outstanding_amount:    parseFloat(r.outstanding_amount),
      overdue_days:          parseInt(r.overdue_days),
      last_order_date:       r.last_order_date ? r.last_order_date.toISOString().slice(0, 10) : null,
      days_since_last_order: r.days_since_last_order != null ? parseInt(r.days_since_last_order) : null,
    })));
  } catch (err) {
    console.error('risk/customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
