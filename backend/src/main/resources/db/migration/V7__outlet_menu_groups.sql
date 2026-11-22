CREATE TABLE menu_groups (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  UNIQUE (tenant_id,outlet_id,id),
  FOREIGN KEY (tenant_id,outlet_id) REFERENCES outlets(tenant_id,id)
);
CREATE UNIQUE INDEX menu_groups_name ON menu_groups(tenant_id,outlet_id,lower(name));

ALTER TABLE categories NO FORCE ROW LEVEL SECURITY;
INSERT INTO menu_groups(id,tenant_id,outlet_id,name)
SELECT gen_random_uuid(),tenant_id,outlet_id,'General'
FROM (SELECT DISTINCT tenant_id,outlet_id FROM categories) existing_outlets;
ALTER TABLE categories ADD COLUMN group_id uuid;
UPDATE categories c SET group_id=g.id FROM menu_groups g
WHERE g.tenant_id=c.tenant_id AND g.outlet_id=c.outlet_id;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE categories ALTER COLUMN group_id SET NOT NULL,
  ADD FOREIGN KEY (tenant_id,outlet_id,group_id) REFERENCES menu_groups(tenant_id,outlet_id,id);

ALTER TABLE menu_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_groups
USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)
WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
