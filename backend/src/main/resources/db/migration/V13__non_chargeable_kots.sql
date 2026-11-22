CREATE TABLE nc_departments (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    outlet_id uuid NOT NULL,
    name varchar(120) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    UNIQUE (tenant_id, outlet_id, id),
    FOREIGN KEY (tenant_id, outlet_id) REFERENCES outlets (tenant_id, id)
);
CREATE UNIQUE INDEX nc_department_name_per_outlet ON nc_departments (tenant_id,outlet_id,lower(name));
ALTER TABLE nc_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE nc_departments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nc_departments
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE kots
    ADD COLUMN nc_department_id uuid,
    ADD COLUMN nc_department_name varchar(120),
    ADD COLUMN nc_reason varchar(500),
    ADD FOREIGN KEY (tenant_id,outlet_id,nc_department_id) REFERENCES nc_departments (tenant_id,outlet_id,id);
ALTER TABLE order_items ADD COLUMN non_chargeable boolean NOT NULL DEFAULT false;