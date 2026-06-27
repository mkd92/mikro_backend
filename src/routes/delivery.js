const express = require('express');
const router  = express.Router();
const db      = require('../db');

function normalizeStatus(raw) {
  if (!raw) return 'Pending';
  switch (raw.trim().toLowerCase()) {
    case 'pending':              return 'Pending';
    case 'packed':               return 'Packed';
    case 'shipped':
    case 'in_transit':           return 'Shipped';
    case 'delivered':
    case 'fully_delivered':
    case 'partially_delivered':  return 'Delivered';
    default:                     return raw;
  }
}

const SELECT = `
  SELECT
    v.id,
    v.voucher_number,
    v.total_amount,
    COALESCE(v.delivery_status, 'Pending') AS delivery_status,
    p.name  AS party_name,
    v.site_id,
    s.name  AS site_name,
    v.transaction_date,
    v.created_at AS invoice_created_at,
    (v.transaction_date = CURRENT_DATE) AS is_today,
    (SELECT MIN(dsh.changed_at) FROM document_status_history dsh
       JOIN delivery_challans dc ON dc.id = dsh.document_id
       WHERE dc.related_invoice_voucher_id = v.id
         AND LOWER(dsh.new_status) = 'packed') AS packed_at,
    (SELECT MIN(dsh.changed_at) FROM document_status_history dsh
       JOIN delivery_challans dc ON dc.id = dsh.document_id
       WHERE dc.related_invoice_voucher_id = v.id
         AND LOWER(dsh.new_status) IN ('shipped', 'in_transit')) AS shipped_at,
    (SELECT MIN(dsh.changed_at) FROM document_status_history dsh
       JOIN delivery_challans dc ON dc.id = dsh.document_id
       WHERE dc.related_invoice_voucher_id = v.id
         AND LOWER(dsh.new_status) IN ('delivered', 'fully_delivered', 'partially_delivered')) AS delivered_at,
    (SELECT u.full_name FROM document_status_history dsh
       JOIN delivery_challans dc ON dc.id = dsh.document_id
       JOIN users u ON u.id = dsh.changed_by
       WHERE dc.related_invoice_voucher_id = v.id
         AND LOWER(dsh.new_status) IN ('delivered', 'fully_delivered', 'partially_delivered')
       ORDER BY dsh.changed_at LIMIT 1) AS delivered_by,
    sp.name AS salesperson_name
  FROM vouchers v
  JOIN voucher_types vt ON vt.id = v.voucher_type_id
  JOIN parties p         ON p.id  = v.party_id
  JOIN sites s           ON s.id  = v.site_id
  LEFT JOIN parties sp   ON sp.id = p.responsible_party_id
  WHERE v.organization_id = 2
    AND vt.code           = 'SINV'
    AND v.is_cancelled    = false
    AND v.site_id         IN (1, 4)
    AND v.transaction_date >= CURRENT_DATE - 30
    AND (
      LOWER(COALESCE(v.delivery_status, '')) NOT IN ('delivered', 'fully_delivered', 'partially_delivered')
      OR v.transaction_date = CURRENT_DATE
    )
  ORDER BY
    CASE LOWER(COALESCE(v.delivery_status, 'pending'))
      WHEN 'pending'           THEN 0
      WHEN 'packed'            THEN 1
      WHEN 'shipped'           THEN 2
      WHEN 'delivered'         THEN 3
      WHEN 'fully_delivered'   THEN 3
      WHEN 'partially_delivered' THEN 3
      ELSE 0
    END,
    v.transaction_date DESC,
    v.voucher_number
`;

const msMin = (a, b) => {
  if (!a || !b) return null;
  const diff = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return diff >= 0 ? diff : null;
};

function mapRow(r) {
  const createdAt   = r.invoice_created_at;
  const packedAt    = r.packed_at;
  const shippedAt   = r.shipped_at;
  const deliveredAt = r.delivered_at;

  const status = normalizeStatus(r.delivery_status);

  const currentStatusSince =
    status === 'Delivered' ? (deliveredAt ?? shippedAt ?? packedAt ?? createdAt) :
    status === 'Shipped'   ? (shippedAt   ?? packedAt  ?? createdAt) :
    status === 'Packed'    ? (packedAt    ?? createdAt) :
                             createdAt;

  return {
    id:                       parseInt(r.id),
    voucher_number:           r.voucher_number,
    total_amount:             parseFloat(r.total_amount),
    delivery_status:          status,
    party_name:               r.party_name,
    site_id:                  parseInt(r.site_id),
    site_name:                r.site_name,
    transaction_date:         r.transaction_date,
    is_today:                 r.is_today,
    pending_to_packed_min:    msMin(createdAt, packedAt),
    packed_to_shipped_min:    msMin(packedAt,  shippedAt),
    shipped_to_delivered_min: msMin(shippedAt, deliveredAt),
    total_delivery_minutes:   msMin(createdAt, deliveredAt),
    delivered_by:             r.delivered_by      ?? null,
    salesperson_name:         r.salesperson_name  ?? null,
    created_at:               createdAt,
    current_status_since:     currentStatusSince,
  };
}

router.get('/orders', async (_req, res) => {
  try {
    const { rows } = await db.query(SELECT);
    res.json(rows.map(mapRow));
  } catch (err) {
    console.error('delivery/orders error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
