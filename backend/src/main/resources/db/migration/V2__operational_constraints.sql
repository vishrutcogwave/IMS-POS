CREATE INDEX order_lines_idx ON order_items(tenant_id,order_id);
CREATE INDEX kot_lines_idx ON kot_items(tenant_id,kot_id);
CREATE INDEX bill_lines_idx ON bill_items(tenant_id,bill_id);
CREATE INDEX payment_bill_idx ON payments(tenant_id,bill_id);
CREATE INDEX kot_order_idx ON kots(tenant_id,order_id);
CREATE INDEX bill_order_idx ON bills(tenant_id,order_id);
CREATE INDEX users_access_idx ON user_outlets(tenant_id,outlet_id,user_id);
CREATE INDEX audit_action_idx ON audit_log(tenant_id,outlet_id,action,created_at DESC);
ALTER TABLE bills ADD CONSTRAINT bill_total_consistency CHECK(discount<=subtotal AND total=subtotal-discount+tax);
