CREATE TABLE outlet_print_policies (
    tenant_id uuid NOT NULL,
    outlet_id uuid NOT NULL,
    kot_on_send boolean NOT NULL DEFAULT true,
    nc_kot_on_send boolean NOT NULL DEFAULT true,
    bill_before_payment boolean NOT NULL DEFAULT true,
    receipt_after_settlement boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, outlet_id),
    FOREIGN KEY (tenant_id, outlet_id) REFERENCES outlets (tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE outlet_print_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlet_print_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outlet_print_policies
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO outlet_print_policies (tenant_id, outlet_id)
SELECT tenant_id, id FROM outlets
ON CONFLICT DO NOTHING;

ALTER TABLE users DROP CONSTRAINT users_permitted_actions;
ALTER TABLE users ADD CONSTRAINT users_permitted_actions CHECK (
  permitted_actions IS NULL OR (
    role <> 'OWNER' AND cardinality(permitted_actions) > 0 AND
    permitted_actions <@ ARRAY['DASHBOARD','ORDER','DISCOUNT','TRANSFER','KITCHEN','BILL','CANCEL','REPORT','SETTINGS','USERS','PRINT','PRINT_BILL','REPRINT_KOT','REPRINT_NC_KOT','REPRINT_BILL','PRINT_JOBS','PRINT_TEST','PRINT_RETRY']::text[]
  )
);

-- Preserve existing users' broad PRINT access while making the individual actions assignable.
UPDATE users
SET permitted_actions = array_remove(permitted_actions, 'PRINT') ||
    ARRAY['PRINT_BILL','REPRINT_KOT','REPRINT_NC_KOT','REPRINT_BILL','PRINT_JOBS','PRINT_TEST','PRINT_RETRY']::text[]
WHERE permitted_actions IS NOT NULL
  AND 'PRINT' = ANY(permitted_actions)
  AND NOT (role = 'KITCHEN' AND cardinality(permitted_actions) = 1);

ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_status_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_status_check
    CHECK (status IN ('PENDING','CLAIMED','PRINTED','FAILED','UNCERTAIN','SUPPRESSED'));
