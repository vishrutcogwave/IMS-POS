ALTER TABLE tenants
    ADD COLUMN subscription_max_users integer CHECK (subscription_max_users BETWEEN 1 AND 10000),
    ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

DO $$
DECLARE sample uuid;
BEGIN
    FOR sample IN SELECT id FROM tenants WHERE slug IN ('saffron', 'coastal') LOOP
        PERFORM set_config('app.tenant_id', sample::text, true);
        UPDATE tenants SET is_demo=true WHERE id=sample AND EXISTS (
            SELECT 1 FROM audit_log WHERE tenant_id=sample AND action='DEMO_CATALOG_SEED'
        );
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;