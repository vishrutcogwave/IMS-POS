CREATE TABLE stewards (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    outlet_id uuid NOT NULL,
    name varchar(120) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    FOREIGN KEY (tenant_id, outlet_id) REFERENCES outlets (tenant_id, id)
);
CREATE UNIQUE INDEX steward_name_per_outlet ON stewards (tenant_id, outlet_id, lower(name));
ALTER TABLE stewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE stewards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stewards
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);