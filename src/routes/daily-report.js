const express = require('express');
const db      = require('../db');
const router  = express.Router();

const n  = v => parseFloat(v)  || 0;
const ni = v => parseInt(v)    || 0;

function fmtMin(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

router.get('/report', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const [
      heroRows,
      deliveryHeroRows,
      siteRevenueRows,
      salesmanRows,
      collectionsRows,
      newCustomerRows,
      topProductRows,
      outstandingRows,
      deliveryOpsRows,
      deliveryAgentRows,
    ] = await Promise.all([

      // ── Hero: revenue + invoice count + collections ────────────────
      db.query(`
        SELECT
          SUM(v.total_amount) FILTER (WHERE vt.code = 'SINV')      AS revenue,
          COUNT(*)            FILTER (WHERE vt.code = 'SINV')::int  AS invoice_count,
          SUM(v.total_amount) FILTER (WHERE vt.code = 'RCT')       AS collections,
          COUNT(*)            FILTER (WHERE vt.code = 'RCT')::int   AS receipt_count
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.transaction_date = $1
          AND v.is_cancelled = false
          AND vt.code IN ('SINV', 'RCT')
      `, [date]),

      // ── Delivered/total ────────────────────────────────────────────
      db.query(`
        SELECT
          COUNT(DISTINCT dc.related_invoice_voucher_id)::int AS total,
          COUNT(DISTINCT dc.related_invoice_voucher_id) FILTER (
            WHERE LOWER(v.delivery_status) IN ('delivered','fully_delivered','partially_delivered')
          )::int AS delivered
        FROM vouchers v
        JOIN delivery_challans dc ON dc.related_invoice_voucher_id = v.id
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.transaction_date = $1
      `, [date]),

      // ── Revenue by site + party group ──────────────────────────────
      db.query(`
        SELECT
          v.site_id,
          s.name                                     AS site_name,
          COALESCE(pg.name, 'Other')                 AS party_group,
          SUM(v.total_amount)                        AS revenue,
          COUNT(*)::int                              AS invoice_count
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        JOIN parties       p  ON p.id  = v.party_id
        LEFT JOIN party_groups pg ON pg.id = p.party_group_id
        JOIN sites         s  ON s.id  = v.site_id
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.transaction_date = $1
          AND v.is_cancelled = false
          AND vt.code = 'SINV'
        GROUP BY v.site_id, s.name, pg.name
        ORDER BY v.site_id, revenue DESC
      `, [date]),

      // ── Salesman contribution (excl. corporate/purchase) ───────────
      db.query(`
        SELECT
          v.site_id,
          s.name                                     AS site_name,
          COALESCE(sp.name, 'Unassigned')            AS salesperson,
          SUM(v.total_amount)                        AS revenue
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        JOIN parties       p  ON p.id  = v.party_id
        JOIN sites         s  ON s.id  = v.site_id
        LEFT JOIN parties sp  ON sp.id = p.responsible_party_id
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.transaction_date = $1
          AND v.is_cancelled = false
          AND vt.code = 'SINV'
          AND COALESCE(p.party_group_id, 0) NOT IN (2, 4)
        GROUP BY v.site_id, s.name, sp.name
        ORDER BY v.site_id, revenue DESC
      `, [date]),

      // ── Collections by site ────────────────────────────────────────
      db.query(`
        SELECT
          v.site_id,
          s.name          AS site_name,
          SUM(v.total_amount) AS collections,
          COUNT(*)::int   AS receipt_count
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        JOIN sites s ON s.id = v.site_id
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.transaction_date = $1
          AND v.is_cancelled = false
          AND vt.code = 'RCT'
        GROUP BY v.site_id, s.name
        ORDER BY collections DESC
      `, [date]),

      // ── New customers added on date ────────────────────────────────
      db.query(`
        SELECT
          p.name                                     AS customer_name,
          s.name                                     AS site_name,
          p.site_id,
          COALESCE(sp.name, 'Unknown')               AS added_by
        FROM parties p
        JOIN sites         s  ON s.id  = p.site_id
        LEFT JOIN parties sp  ON sp.id = p.responsible_party_id
        WHERE p.organization_id = 2
          AND p.site_id IN (1, 4)
          AND COALESCE(p.party_group_id, 0) NOT IN (4)
          AND DATE(p.created_at AT TIME ZONE 'Asia/Kolkata') = $1
        ORDER BY p.created_at
      `, [date]),

      // ── Top 5 products ─────────────────────────────────────────────
      db.query(`
        SELECT
          i.name                     AS item_name,
          SUM(vi.quantity)::float    AS total_units,
          SUM(vi.total_amount)       AS total_revenue
        FROM voucher_items vi
        JOIN items         i  ON i.id  = vi.item_id
        JOIN vouchers      v  ON v.id  = vi.voucher_id
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.transaction_date = $1
          AND v.is_cancelled = false
          AND vt.code = 'SINV'
        GROUP BY i.name
        ORDER BY total_revenue DESC
        LIMIT 5
      `, [date]),

      // ── Outstanding receivables (as-of-today snapshot) ─────────────
      db.query(`
        SELECT
          v.site_id,
          s.name         AS site_name,
          SUM(v.amount_due)  AS outstanding,
          COUNT(*)::int  AS open_invoice_count
        FROM vouchers v
        JOIN voucher_types vt ON vt.id = v.voucher_type_id
        JOIN sites s ON s.id = v.site_id
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.is_cancelled = false
          AND vt.code = 'SINV'
          AND v.payment_status IN ('Unpaid', 'Partially Paid')
          AND v.amount_due > 0
        GROUP BY v.site_id, s.name
        ORDER BY outstanding DESC
      `, []),

      // ── Delivery operations per site ───────────────────────────────
      db.query(`
        WITH timing AS (
          SELECT
            v.site_id,
            v.id AS voucher_id,
            LOWER(v.delivery_status) AS delivery_status,
            (SELECT MIN(dsh.changed_at) FROM document_status_history dsh
               JOIN delivery_challans dc2 ON dc2.id = dsh.document_id
               WHERE dc2.related_invoice_voucher_id = v.id
                 AND LOWER(dsh.new_status) = 'packed') AS packed_at,
            (SELECT MIN(dsh.changed_at) FROM document_status_history dsh
               JOIN delivery_challans dc2 ON dc2.id = dsh.document_id
               WHERE dc2.related_invoice_voucher_id = v.id
                 AND LOWER(dsh.new_status) IN ('shipped','in_transit')) AS shipped_at,
            (SELECT MIN(dsh.changed_at) FROM document_status_history dsh
               JOIN delivery_challans dc2 ON dc2.id = dsh.document_id
               WHERE dc2.related_invoice_voucher_id = v.id
                 AND LOWER(dsh.new_status) IN ('delivered','fully_delivered','partially_delivered')) AS delivered_at
          FROM vouchers v
          JOIN delivery_challans dc ON dc.related_invoice_voucher_id = v.id
          WHERE v.organization_id = 2
            AND v.site_id IN (1, 4)
            AND v.transaction_date = $1
        )
        SELECT
          site_id,
          COUNT(DISTINCT voucher_id)::int AS total,
          COUNT(DISTINCT voucher_id) FILTER (
            WHERE delivery_status IN ('delivered','fully_delivered','partially_delivered')
          )::int AS delivered,
          AVG(EXTRACT(EPOCH FROM (shipped_at  - packed_at)) / 60)
            FILTER (WHERE shipped_at  IS NOT NULL AND packed_at IS NOT NULL)::int
            AS avg_packed_to_shipped_min,
          AVG(EXTRACT(EPOCH FROM (delivered_at - shipped_at)) / 60)
            FILTER (WHERE delivered_at IS NOT NULL AND shipped_at IS NOT NULL)::int
            AS avg_shipped_to_delivered_min,
          AVG(EXTRACT(EPOCH FROM (delivered_at - packed_at)) / 60)
            FILTER (WHERE delivered_at IS NOT NULL AND packed_at IS NOT NULL)::int
            AS avg_end_to_end_min
        FROM timing
        GROUP BY site_id
        ORDER BY site_id
      `, [date]),

      // ── Delivery agents (who shipped) ──────────────────────────────
      db.query(`
        SELECT
          v.site_id,
          u.full_name           AS agent_name,
          COUNT(DISTINCT dc.related_invoice_voucher_id)::int AS order_count
        FROM document_status_history dsh
        JOIN delivery_challans dc ON dc.id = dsh.document_id
        JOIN vouchers v ON v.id = dc.related_invoice_voucher_id
        JOIN users    u ON u.id = dsh.changed_by
        WHERE v.organization_id = 2
          AND v.site_id IN (1, 4)
          AND v.transaction_date = $1
          AND LOWER(dsh.new_status) IN ('shipped','in_transit')
        GROUP BY v.site_id, u.full_name
        ORDER BY v.site_id, order_count DESC
      `, [date]),
    ]);

    // ── Build site revenue map ─────────────────────────────────────────────
    const siteMap = {};
    for (const r of siteRevenueRows.rows) {
      if (!siteMap[r.site_id]) {
        siteMap[r.site_id] = {
          site_id:       r.site_id,
          site_name:     r.site_name,
          total_revenue: 0,
          invoice_count: 0,
          breakdown:     [],
        };
      }
      siteMap[r.site_id].total_revenue += n(r.revenue);
      siteMap[r.site_id].invoice_count += r.invoice_count;
      siteMap[r.site_id].breakdown.push({ party_group: r.party_group, revenue: n(r.revenue), invoice_count: r.invoice_count });
    }

    // ── Build salesman map ─────────────────────────────────────────────────
    const salesmanMap = {};
    for (const r of salesmanRows.rows) {
      if (!salesmanMap[r.site_id]) {
        salesmanMap[r.site_id] = { site_id: r.site_id, site_name: r.site_name, salesmen: [] };
      }
      salesmanMap[r.site_id].salesmen.push({ name: r.salesperson, revenue: n(r.revenue) });
    }

    // ── Build delivery map ─────────────────────────────────────────────────
    const deliveryMap = {};
    for (const r of deliveryOpsRows.rows) {
      deliveryMap[r.site_id] = {
        site_id:                    r.site_id,
        total:                      r.total,
        delivered:                  r.delivered,
        avg_packed_to_shipped_min:  r.avg_packed_to_shipped_min,
        avg_shipped_to_delivered_min: r.avg_shipped_to_delivered_min,
        avg_end_to_end_min:         r.avg_end_to_end_min,
        agents:                     [],
      };
    }
    for (const r of deliveryAgentRows.rows) {
      if (deliveryMap[r.site_id]) {
        deliveryMap[r.site_id].agents.push({ name: r.agent_name, order_count: r.order_count });
      }
    }

    const hero         = heroRows.rows[0] ?? {};
    const totalRevenue = n(hero.revenue);

    res.json({
      date,
      revenue:           totalRevenue,
      invoice_count:     ni(hero.invoice_count),
      collections:       n(hero.collections),
      new_customer_count: newCustomerRows.rows.length,
      delivered:         deliveryHeroRows.rows[0]?.delivered   ?? 0,
      delivery_total:    deliveryHeroRows.rows[0]?.total        ?? 0,

      sites: Object.values(siteMap).map(s => ({
        ...s,
        revenue_pct: totalRevenue > 0
          ? Math.round((s.total_revenue / totalRevenue) * 1000) / 10
          : 0,
      })),

      salesman_by_site: Object.values(salesmanMap),

      collections_by_site: collectionsRows.rows.map(r => ({
        site_id:       r.site_id,
        site_name:     r.site_name,
        collections:   n(r.collections),
        receipt_count: r.receipt_count,
      })),

      new_customers: newCustomerRows.rows.map(r => ({
        customer_name: r.customer_name,
        site_name:     r.site_name,
        site_id:       r.site_id,
        added_by:      r.added_by,
      })),

      top_products: topProductRows.rows.map((r, i) => ({
        rank:    i + 1,
        name:    r.item_name,
        units:   Math.round(parseFloat(r.total_units) || 0),
        revenue: n(r.total_revenue),
      })),

      outstanding: {
        total:   outstandingRows.rows.reduce((sum, r) => sum + n(r.outstanding), 0),
        by_site: outstandingRows.rows.map(r => ({
          site_id:            r.site_id,
          site_name:          r.site_name,
          outstanding:        n(r.outstanding),
          open_invoice_count: r.open_invoice_count,
        })),
      },

      delivery_by_site: Object.values(deliveryMap).map(d => ({
        ...d,
        packed_to_shipped:      fmtMin(d.avg_packed_to_shipped_min),
        shipped_to_delivered:   fmtMin(d.avg_shipped_to_delivered_min),
        end_to_end:             fmtMin(d.avg_end_to_end_min),
      })),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
