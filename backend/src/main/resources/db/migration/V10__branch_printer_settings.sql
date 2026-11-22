ALTER TABLE outlets ADD UNIQUE (tenant_id, branch_id, id);

CREATE TABLE branch_printer_settings (
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    outlet_id uuid NOT NULL,
    pc_id varchar(32) NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, branch_id, outlet_id, pc_id),
    FOREIGN KEY (tenant_id, branch_id, outlet_id) REFERENCES outlets (tenant_id, branch_id, id) ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE branch_printer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_printer_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branch_printer_settings
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DO $$
DECLARE tenant uuid;
BEGIN
    FOR tenant IN SELECT id FROM tenants LOOP
        PERFORM set_config('app.tenant_id', tenant::text, true);
        INSERT INTO branch_printer_settings (tenant_id, branch_id, outlet_id, pc_id, settings)
        SELECT p.tenant_id, o.branch_id, p.outlet_id, p.pc_id,
            jsonb_build_object(
                'printers', jsonb_agg(jsonb_build_object('alias', p.device_key, 'name', p.name) ORDER BY p.device_key),
                'kot', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object('categoryId', r.category_id, 'alias', kp.device_key) ORDER BY r.category_id)
                    FROM category_routes r
                    JOIN printers kp ON (kp.tenant_id, kp.outlet_id, kp.id) = (r.tenant_id, r.outlet_id, r.printer_id)
                    WHERE (r.tenant_id, r.outlet_id, r.pc_id) = (p.tenant_id, p.outlet_id, p.pc_id) AND kp.enabled
                ), '[]'::jsonb),
                'bills', COALESCE(jsonb_agg(p.device_key ORDER BY p.device_key) FILTER (WHERE p.is_receipt), '[]'::jsonb))
        FROM printers p
        JOIN outlets o ON (o.tenant_id, o.id) = (p.tenant_id, p.outlet_id)
        WHERE p.tenant_id = tenant AND p.pc_id IS NOT NULL AND p.enabled
          AND (p.is_receipt OR EXISTS (SELECT 1 FROM category_routes r
              WHERE (r.tenant_id, r.outlet_id, r.pc_id, r.printer_id) = (p.tenant_id, p.outlet_id, p.pc_id, p.id)))
        GROUP BY p.tenant_id, o.branch_id, p.outlet_id, p.pc_id;
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;
