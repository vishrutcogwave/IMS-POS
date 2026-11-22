CREATE TABLE branch_bill_counters (
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    kind varchar(12) NOT NULL CHECK (kind IN ('BILL','NC-BILL')),
    value bigint NOT NULL CHECK (value>0),
    PRIMARY KEY (tenant_id,branch_id,kind),
    FOREIGN KEY (tenant_id,branch_id) REFERENCES branches (tenant_id,id)
);
ALTER TABLE branch_bill_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_bill_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branch_bill_counters
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE bills ADD COLUMN non_chargeable boolean NOT NULL DEFAULT false;
ALTER TABLE bills ADD CHECK (NOT non_chargeable OR (subtotal=0 AND discount=0 AND tax=0 AND total=0));

DO $$
DECLARE restaurant uuid;
BEGIN
  FOR restaurant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', restaurant::text, true);
    INSERT INTO branch_bill_counters(tenant_id,branch_id,kind,value)
    SELECT o.tenant_id,o.branch_id,'BILL',max(substring(b.number from 6)::bigint)
    FROM bills b JOIN outlets o ON (o.tenant_id,o.id)=(b.tenant_id,b.outlet_id)
    WHERE b.tenant_id=restaurant AND b.number ~ '^BILL-[0-9]{1,15}$'
      AND substring(b.number from 6)::bigint>0
    GROUP BY o.tenant_id,o.branch_id;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;