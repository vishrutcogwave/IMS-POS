DROP INDEX one_fallback_printer;
CREATE UNIQUE INDEX one_fallback_printer ON printers(tenant_id, outlet_id, (coalesce(pc_id, ''))) WHERE is_fallback;
