const express = require('express');
const db = require('../db');

const router = express.Router();
const n = v => parseFloat(v) || 0;

router.get('/summary', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        CASE v.transaction_date
          WHEN CURRENT_DATE                    THEN 'Today'
          WHEN CURRENT_DATE - INTERVAL '1 day' THEN 'Yesterday'
        END AS label,
        v.transaction_date::text,
        COUNT(*)::int AS invoice_count,
        SUM(v.total_amount) AS sales
      FROM vouchers v
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      WHERE v.organization_id = 2
        AND vt.code = 'SINV'
        AND v.is_cancelled = false
        AND v.site_id IN (1, 4)
        AND v.transaction_date IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')
      GROUP BY v.transaction_date
      ORDER BY v.transaction_date DESC
    `);
    res.json(rows.map(r => ({
      label:            r.label,
      transaction_date: r.transaction_date,
      invoice_count:    r.invoice_count,
      sales:            n(r.sales),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/monthly', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        DATE_TRUNC('month', v.transaction_date)::date::text AS month,
        COALESCE(SUM(v.total_amount) FILTER (WHERE v.site_id = 1), 0) AS mogappair,
        COALESCE(SUM(v.total_amount) FILTER (WHERE v.site_id = 4), 0) AS medavakkam,
        COALESCE(SUM(v.total_amount), 0) AS total_sales
      FROM vouchers v
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      WHERE v.organization_id = 2
        AND vt.code = 'SINV'
        AND v.is_cancelled = false
        AND v.site_id IN (1, 4)
        AND v.transaction_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months')
      GROUP BY DATE_TRUNC('month', v.transaction_date)
      ORDER BY month ASC
    `);
    res.json(rows.map(r => ({
      month:       r.month,
      mogappair:   n(r.mogappair),
      medavakkam:  n(r.medavakkam),
      total_sales: n(r.total_sales),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/breakdown', async (_req, res) => {
  try {
    const [sitesResult, groupsResult] = await Promise.all([
      db.query(`
        SELECT
          CASE v.transaction_date
            WHEN CURRENT_DATE                    THEN 'today'
            WHEN CURRENT_DATE - INTERVAL '1 day' THEN 'yesterday'
          END AS period,
          v.site_id,
          s.name AS site_name,
          COUNT(*)::int AS invoice_count,
          SUM(v.total_amount) AS total_amount
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        JOIN sites s ON s.id = v.site_id
        WHERE v.organization_id = 2
          AND vt.code = 'SINV'
          AND v.is_cancelled = false
          AND v.site_id IN (1, 4)
          AND v.transaction_date IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')
        GROUP BY v.transaction_date, v.site_id, s.name
        ORDER BY v.transaction_date DESC, v.site_id ASC
      `),
      db.query(`
        SELECT
          CASE v.transaction_date
            WHEN CURRENT_DATE                    THEN 'today'
            WHEN CURRENT_DATE - INTERVAL '1 day' THEN 'yesterday'
          END AS period,
          v.site_id,
          COALESCE(pg.name, 'Other') AS group_name,
          COUNT(*)::int AS invoice_count,
          SUM(v.total_amount) AS total_amount
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        JOIN parties p ON p.id = v.party_id
        LEFT JOIN party_groups pg ON pg.id = p.party_group_id
        WHERE v.organization_id = 2
          AND vt.code = 'SINV'
          AND v.is_cancelled = false
          AND v.site_id IN (1, 4)
          AND v.transaction_date IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')
        GROUP BY v.transaction_date, v.site_id, pg.name
        ORDER BY v.transaction_date DESC, total_amount DESC
      `),
    ]);

    res.json({
      sites: sitesResult.rows.map(r => ({
        period:        r.period,
        site_id:       r.site_id,
        site_name:     r.site_name,
        invoice_count: r.invoice_count,
        total_amount:  n(r.total_amount),
      })),
      groups: groupsResult.rows.map(r => ({
        period:        r.period,
        site_id:       r.site_id,
        group_name:    r.group_name,
        invoice_count: r.invoice_count,
        total_amount:  n(r.total_amount),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/trend', async (req, res) => {
  try {
    const { granularity = 'daily', from, to, exclude_corporate } = req.query;

    if (!['daily', 'weekly', 'monthly'].includes(granularity)) {
      return res.status(400).json({ error: 'Invalid granularity. Use daily, weekly, or monthly.' });
    }
    if (!from || !to) {
      return res.status(400).json({ error: 'Query params from and to are required (YYYY-MM-DD).' });
    }

    const truncUnit = { daily: 'day', weekly: 'week', monthly: 'month' }[granularity];
    const excludeCorp = exclude_corporate === 'true';

    const corpJoin = excludeCorp
      ? 'JOIN parties p ON p.id = v.party_id LEFT JOIN party_groups pg ON pg.id = p.party_group_id'
      : '';
    const corpFilter = excludeCorp
      ? "AND (pg.name IS NULL OR pg.name NOT ILIKE '%corporate%')"
      : '';

    const sql = `
      SELECT
        DATE_TRUNC($1, v.transaction_date)::date::text AS date,
        COALESCE(SUM(v.total_amount) FILTER (WHERE v.site_id = 1), 0) AS mogappair,
        COALESCE(SUM(v.total_amount) FILTER (WHERE v.site_id = 4), 0) AS medavakkam,
        COALESCE(SUM(v.total_amount), 0) AS total_sales
      FROM vouchers v
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      ${corpJoin}
      WHERE v.organization_id = 2
        AND vt.code = 'SINV'
        AND v.is_cancelled = false
        AND v.site_id IN (1, 4)
        AND v.transaction_date BETWEEN $2::date AND $3::date
        ${corpFilter}
      GROUP BY DATE_TRUNC($1, v.transaction_date)
      ORDER BY date ASC
    `;

    const { rows } = await db.query(sql, [truncUnit, from, to]);
    res.json(rows.map(r => ({
      date:        r.date,
      mogappair:   n(r.mogappair),
      medavakkam:  n(r.medavakkam),
      total_sales: n(r.total_sales),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
