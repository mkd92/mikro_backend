const express    = require('express');
const router     = express.Router();
const { query }  = require('../db');

router.get('/customers', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        p.id                                                           AS party_id,
        p.name                                                         AS customer_name,
        s.name                                                         AS branch,
        rp.name                                                        AS sales_rep,
        MAX(v.transaction_date)                                        AS last_purchase_date,
        (CURRENT_DATE - MAX(v.transaction_date))::int                  AS days_inactive,
        COUNT(CASE WHEN v.payment_status IN ('Unpaid','Partially Paid')
                   THEN 1 END)::int                                    AS open_invoice_count,
        SUM(CASE WHEN v.payment_status IN ('Unpaid','Partially Paid')
                 THEN v.amount_due ELSE 0 END)::numeric                AS total_outstanding,
        MIN(CASE WHEN v.payment_status IN ('Unpaid','Partially Paid')
                 THEN v.transaction_date END)                          AS oldest_due_date
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
      GROUP BY p.id, p.name, s.name, rp.name
      HAVING SUM(CASE WHEN v.payment_status IN ('Unpaid','Partially Paid')
                      THEN v.amount_due ELSE 0 END) > 0
      ORDER BY total_outstanding DESC
    `);

    res.json(rows.map(r => ({
      party_id:           parseInt(r.party_id),
      customer_name:      r.customer_name,
      branch:             r.branch,
      sales_rep:          r.sales_rep || null,
      last_purchase_date: r.last_purchase_date || null,
      days_inactive:      parseInt(r.days_inactive),
      open_invoice_count: parseInt(r.open_invoice_count),
      total_outstanding:  parseFloat(r.total_outstanding),
      oldest_due_date:    r.oldest_due_date || null,
    })));
  } catch (err) {
    console.error('risk/customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices', async (req, res) => {
  const partyId = parseInt(req.query.party_id);
  if (!partyId) return res.status(400).json({ error: 'party_id is required' });

  try {
    const { rows } = await query(`
      SELECT
        v.voucher_number,
        v.transaction_date,
        v.total_amount,
        v.amount_due,
        v.payment_status
      FROM vouchers v
      JOIN voucher_types vt ON vt.id = v.voucher_type_id
      WHERE v.organization_id = 2
        AND vt.code           = 'SINV'
        AND v.is_cancelled    = false
        AND v.party_id        = $1
        AND v.payment_status  IN ('Unpaid', 'Partially Paid')
        AND v.amount_due      > 0
      ORDER BY v.transaction_date ASC
    `, [partyId]);

    res.json(rows.map(r => ({
      voucher_number:   r.voucher_number,
      transaction_date: r.transaction_date,
      total_amount:     parseFloat(r.total_amount),
      amount_due:       parseFloat(r.amount_due),
      payment_status:   r.payment_status,
    })));
  } catch (err) {
    console.error('risk/invoices error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
