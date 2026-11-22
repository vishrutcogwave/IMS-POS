CREATE TABLE menu_units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  name varchar(80) NOT NULL,
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES outlets(tenant_id,id)
);
CREATE TABLE menu_taxes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  name varchar(80) NOT NULL,
  rate numeric(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES outlets(tenant_id,id)
);
CREATE UNIQUE INDEX menu_units_name ON menu_units(tenant_id,outlet_id,lower(name));
CREATE UNIQUE INDEX menu_taxes_name ON menu_taxes(tenant_id,outlet_id,lower(name));
ALTER TABLE menu_items
  ADD COLUMN unit_id uuid,
  ADD COLUMN tax_id uuid,
  ADD FOREIGN KEY (tenant_id,outlet_id,unit_id) REFERENCES menu_units(tenant_id,outlet_id,id),
  ADD FOREIGN KEY (tenant_id,outlet_id,tax_id) REFERENCES menu_taxes(tenant_id,outlet_id,id);
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['menu_units','menu_taxes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',relation);
  END LOOP;
END $$;
