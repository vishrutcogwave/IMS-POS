CREATE TABLE branch_print_policies (
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    kot_on_send boolean NOT NULL DEFAULT true,
    nc_kot_on_send boolean NOT NULL DEFAULT true,
    bill_before_payment boolean NOT NULL DEFAULT true,
    receipt_after_settlement boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, branch_id),
    FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id) ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE branch_print_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_print_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branch_print_policies
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Preserve existing outlet choices when consolidating to branch-wide behavior.
-- If outlets differ, the restrictive (disabled) setting wins to avoid surprise prints.
INSERT INTO branch_print_policies (tenant_id, branch_id, kot_on_send, nc_kot_on_send, bill_before_payment, receipt_after_settlement)
SELECT o.tenant_id, o.branch_id,
       bool_and(coalesce(p.kot_on_send, true)),
       bool_and(coalesce(p.nc_kot_on_send, true)),
       bool_and(coalesce(p.bill_before_payment, true)),
       bool_and(coalesce(p.receipt_after_settlement, true))
FROM outlets o
LEFT JOIN outlet_print_policies p ON p.tenant_id=o.tenant_id AND p.outlet_id=o.id
GROUP BY o.tenant_id, o.branch_id
ON CONFLICT (tenant_id, branch_id) DO NOTHING;
