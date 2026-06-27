const express = require('express');
const router  = express.Router();
const db      = require('../db');

// Normalize whatever the DB stores to consistent Title Case
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
    v.created_at,
    (v.transaction_date = CURRENT_DATE) AS is_today,
    hist.status_history
  FROM vouchers v
  JOIN voucher_types vt ON vt.id = v.voucher_type_id
  JOIN parties p         ON p.id  = v.party_id
  JOIN sites s           ON s.id  = v.site_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'to_status',  vsh.new_status,
          'changed_at', vsh.changed_at,
          'changed_by', COALESCE(u.full_name, u.username)
        ) ORDER BY vsh.changed_at
      ),
      '[]'::json
    ) AS status_history
    FROM voucher_status_history vsh
    LEFT JOIN users u ON u.id = vsh.changed_by
    WHERE vsh.voucher_id = v.id
  ) hist ON true
  WHERE v.organization_id = 2
    AND vt.code           = 'SINV'
    AND v.is_cancelled    = false
    AND v.site_id         IN (1, 4)
    AND v.transaction_date >= CURRENT_DATE - 30
    AND LOWER(COALESCE(v.delivery_status, 'Pending')) != 'delivered'
  ORDER BY
    v.transaction_date DESC,
    CASE LOWER(COALESCE(v.delivery_status, 'Pending'))
      WHEN 'pending'   THEN 0
      WHEN 'packed'    THEN 1
      WHEN 'shipped'   THEN 2
      ELSE 3
    END,
    v.voucher_number
`;

const msMin = (a, b) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

function mapRow(r) {
  const history   = r.status_history || [];
  const createdAt = r.created_at instanceof Date
    ? r.created_at.toISOString()
    : r.created_at;

  // Case-insensitive history lookups — DB may store mixed case
  const packed    = history.find(e => normalizeStatus(e.to_status) === 'Packed');
  const shipped   = history.find(e => normalizeStatus(e.to_status) === 'Shipped');
  const delivered = history.find(e => normalizeStatus(e.to_status) === 'Delivered');
  const last      = history.length > 0 ? history[history.length - 1] : null;

  // Derive authoritative current status from history events first, then fall back
  // to the vouchers column. This handles cases where vouchers.delivery_status
  // is stale or stores a different casing than the history table.
  const effectiveStatus = delivered ? 'Delivered'
    : shipped               ? 'Shipped'
    : packed                ? 'Packed'
    : normalizeStatus(r.delivery_status);

  return {
    id:                       parseInt(r.id),
    voucher_number:           r.voucher_number,
    total_amount:             parseFloat(r.total_amount),
    delivery_status:          effectiveStatus,
    party_name:               r.party_name,
    site_id:                  parseInt(r.site_id),
    site_name:                r.site_name,
    transaction_date:         r.transaction_date,
    is_today:                 r.is_today,
    pending_to_packed_min:    packed                   ? msMin(createdAt,          packed.changed_at)    : null,
    packed_to_shipped_min:    packed && shipped        ? msMin(packed.changed_at,  shipped.changed_at)   : null,
    shipped_to_delivered_min: shipped && delivered     ? msMin(shipped.changed_at, delivered.changed_at) : null,
    total_delivery_minutes:   delivered                ? msMin(createdAt,          delivered.changed_at) : null,
    delivered_by:             delivered ? delivered.changed_by : null,
    current_status_since:     last ? last.changed_at : createdAt,
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
