ALTER TABLE printers ADD COLUMN pc_id varchar(32);
ALTER TABLE category_routes ADD COLUMN pc_id varchar(32) NOT NULL DEFAULT '';
ALTER TABLE category_routes DROP CONSTRAINT category_routes_pkey;
ALTER TABLE category_routes ADD PRIMARY KEY (tenant_id,outlet_id,pc_id,category_id);
ALTER TABLE outlets ADD COLUMN default_print_pc varchar(32);