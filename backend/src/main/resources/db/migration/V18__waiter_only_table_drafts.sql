ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK(status IN ('DRAFT','OPEN','BILL_PENDING','SETTLED','CANCELLED'));

UPDATE orders o
SET status='DRAFT'
WHERE o.status='OPEN'
  AND NOT EXISTS (
      SELECT 1 FROM order_items i
      WHERE i.tenant_id=o.tenant_id AND i.order_id=o.id AND NOT i.cancelled
  );
