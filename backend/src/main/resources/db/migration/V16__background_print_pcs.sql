CREATE TABLE print_pcs (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    branch_id uuid NOT NULL,
    credential_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,branch_id),
    UNIQUE (tenant_id,branch_id,id),
    FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE print_pc_pairings (
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    code_hash char(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id,branch_id),
    FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
ALTER TABLE print_jobs ADD COLUMN target_branch_id uuid;
ALTER TABLE print_jobs ADD COLUMN target_pc_id uuid;
ALTER TABLE print_jobs ADD COLUMN expires_at timestamptz;
ALTER TABLE print_jobs ADD COLUMN delivery_started_at timestamptz;
ALTER TABLE print_jobs ADD COLUMN delivery_plan jsonb;
ALTER TABLE print_jobs ADD COLUMN delivery_results jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE print_jobs ADD COLUMN next_print_attempt_at timestamptz;
ALTER TABLE print_jobs ADD FOREIGN KEY (tenant_id,target_branch_id,target_pc_id)
    REFERENCES print_pcs(tenant_id,branch_id,id);
CREATE INDEX print_pc_queue ON print_jobs(tenant_id,target_pc_id,status,created_at,id)
    WHERE target_pc_id IS NOT NULL;
DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['print_pcs','print_pc_pairings'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',tab);
    END LOOP;
END $$;
