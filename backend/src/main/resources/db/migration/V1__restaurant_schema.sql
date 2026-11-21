CREATE TABLE tenants (
 id uuid PRIMARY KEY, slug varchar(64) NOT NULL UNIQUE, name varchar(160) NOT NULL,
 receipt_address text NOT NULL DEFAULT '', tax_number varchar(80) NOT NULL DEFAULT '', phone varchar(40) NOT NULL DEFAULT '',
 receipt_footer text NOT NULL DEFAULT 'Thank you for dining with us.', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branches (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name varchar(120) NOT NULL,
 address text NOT NULL DEFAULT '', UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
CREATE TABLE outlets (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL, name varchar(120) NOT NULL,
 service_modes text[] NOT NULL DEFAULT ARRAY['DINE_IN','TAKEAWAY'], payment_methods text[] NOT NULL DEFAULT ARRAY['CASH','CARD','UPI'],
 currency varchar(3) NOT NULL DEFAULT 'INR', timezone varchar(80) NOT NULL DEFAULT 'Asia/Kolkata',
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,branch_id,name), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE users (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), email varchar(254) NOT NULL, name varchar(120) NOT NULL,
 password_hash text NOT NULL, role varchar(20) NOT NULL CHECK(role IN ('OWNER','MANAGER','CASHIER','WAITER','KITCHEN','ACCOUNTANT')),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,email)
);
CREATE TABLE user_outlets (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, outlet_id uuid NOT NULL, PRIMARY KEY(tenant_id,user_id,outlet_id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id), FOREIGN KEY(tenant_id,outlet_id) REFERENCES outlets(tenant_id,id)
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, token_hash varchar(64) NOT NULL UNIQUE,
 csrf_token varchar(128) NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE categories (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, name varchar(100) NOT NULL,
 department varchar(100) NOT NULL DEFAULT 'Kitchen', sort_order integer NOT NULL DEFAULT 0,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,outlet_id,id), UNIQUE(tenant_id,outlet_id,name),
 FOREIGN KEY(tenant_id,outlet_id) REFERENCES outlets(tenant_id,id)
);
CREATE TABLE menu_items (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, category_id uuid NOT NULL,
 name varchar(140) NOT NULL, description text NOT NULL DEFAULT '', price numeric(12,2) NOT NULL CHECK(price>=0),
 tax_rate numeric(5,2) NOT NULL DEFAULT 5 CHECK(tax_rate>=0 AND tax_rate<=100), available boolean NOT NULL DEFAULT true,
 vegetarian boolean NOT NULL DEFAULT true, variants jsonb NOT NULL DEFAULT '[]', modifiers jsonb NOT NULL DEFAULT '[]',
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,outlet_id,id), UNIQUE(tenant_id,outlet_id,name),
 FOREIGN KEY(tenant_id,outlet_id,category_id) REFERENCES categories(tenant_id,outlet_id,id)
);
CREATE TABLE restaurant_tables (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, name varchar(40) NOT NULL,
 section varchar(80) NOT NULL DEFAULT 'Main dining', seats integer NOT NULL DEFAULT 4 CHECK(seats BETWEEN 1 AND 100),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,outlet_id,id), UNIQUE(tenant_id,outlet_id,name),
 FOREIGN KEY(tenant_id,outlet_id) REFERENCES outlets(tenant_id,id)
);
CREATE TABLE orders (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, table_id uuid, number varchar(40) NOT NULL,
 service_mode varchar(20) NOT NULL CHECK(service_mode IN ('DINE_IN','TAKEAWAY','DELIVERY','ROOM_SERVICE')),
 status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','BILL_PENDING','SETTLED','CANCELLED')),
 covers integer NOT NULL DEFAULT 1 CHECK(covers BETWEEN 1 AND 100), notes text NOT NULL DEFAULT '', customer_name varchar(120) NOT NULL DEFAULT '',
 discount numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount>=0), version integer NOT NULL DEFAULT 0,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,outlet_id,id), UNIQUE(tenant_id,outlet_id,number),
 FOREIGN KEY(tenant_id,outlet_id) REFERENCES outlets(tenant_id,id),
 FOREIGN KEY(tenant_id,outlet_id,table_id) REFERENCES restaurant_tables(tenant_id,outlet_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id),
 CHECK((service_mode='DINE_IN' AND table_id IS NOT NULL) OR (service_mode<>'DINE_IN' AND table_id IS NULL))
);
CREATE UNIQUE INDEX one_active_order_per_table ON orders(tenant_id,table_id) WHERE table_id IS NOT NULL AND status IN ('OPEN','BILL_PENDING');
CREATE INDEX order_list_idx ON orders(tenant_id,outlet_id,created_at DESC);
CREATE TABLE order_items (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, menu_item_id uuid NOT NULL, category_id uuid NOT NULL,
 name varchar(200) NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 999), sent_quantity integer NOT NULL DEFAULT 0 CHECK(sent_quantity>=0),
 unit_price numeric(12,2) NOT NULL CHECK(unit_price>=0), tax_rate numeric(5,2) NOT NULL CHECK(tax_rate BETWEEN 0 AND 100),
 variant varchar(100) NOT NULL DEFAULT '', modifiers jsonb NOT NULL DEFAULT '[]', notes text NOT NULL DEFAULT '',
 cancelled boolean NOT NULL DEFAULT false, UNIQUE(tenant_id,id), UNIQUE(tenant_id,order_id,id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id), FOREIGN KEY(tenant_id,menu_item_id) REFERENCES menu_items(tenant_id,id),
 FOREIGN KEY(tenant_id,category_id) REFERENCES categories(tenant_id,id), CHECK(sent_quantity<=quantity)
);
CREATE TABLE printers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, name varchar(100) NOT NULL,
 device_key varchar(100) NOT NULL, document_type varchar(10) NOT NULL CHECK(document_type IN ('KOT','BILL','BOTH')),
 paper_width integer NOT NULL DEFAULT 80 CHECK(paper_width IN (58,80)), copies integer NOT NULL DEFAULT 1 CHECK(copies BETWEEN 1 AND 5),
 enabled boolean NOT NULL DEFAULT true, is_fallback boolean NOT NULL DEFAULT false, is_receipt boolean NOT NULL DEFAULT false,
 template varchar(20) NOT NULL DEFAULT 'STANDARD' CHECK(template IN ('STANDARD','COMPACT')),
 last_seen_at timestamptz, UNIQUE(tenant_id,id), UNIQUE(tenant_id,outlet_id,id), UNIQUE(tenant_id,outlet_id,name),
 FOREIGN KEY(tenant_id,outlet_id) REFERENCES outlets(tenant_id,id),
 CHECK(NOT is_fallback OR document_type IN ('KOT','BOTH')), CHECK(NOT is_receipt OR document_type IN ('BILL','BOTH'))
);
CREATE UNIQUE INDEX one_fallback_printer ON printers(tenant_id,outlet_id) WHERE is_fallback;
CREATE UNIQUE INDEX one_receipt_printer ON printers(tenant_id,outlet_id) WHERE is_receipt;
CREATE TABLE category_routes (
 tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, category_id uuid NOT NULL, printer_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,outlet_id,category_id), FOREIGN KEY(tenant_id,outlet_id,category_id) REFERENCES categories(tenant_id,outlet_id,id),
 FOREIGN KEY(tenant_id,outlet_id,printer_id) REFERENCES printers(tenant_id,outlet_id,id)
);
CREATE TABLE kots (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, order_id uuid NOT NULL, printer_id uuid NOT NULL,
 number varchar(40) NOT NULL, status varchar(20) NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PREPARING','READY','SERVED','CANCELLED')),
 reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,outlet_id,number),
 FOREIGN KEY(tenant_id,outlet_id,order_id) REFERENCES orders(tenant_id,outlet_id,id),
 FOREIGN KEY(tenant_id,outlet_id,printer_id) REFERENCES printers(tenant_id,outlet_id,id)
);
CREATE TABLE kot_items (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, kot_id uuid NOT NULL, order_item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0), snapshot jsonb NOT NULL,
 FOREIGN KEY(tenant_id,kot_id) REFERENCES kots(tenant_id,id), FOREIGN KEY(tenant_id,order_item_id) REFERENCES order_items(tenant_id,id)
);
CREATE INDEX kots_register_idx ON kots(tenant_id,outlet_id,created_at DESC);
CREATE TABLE bills (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, order_id uuid NOT NULL, number varchar(40) NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PAID','CANCELLED')),
 subtotal numeric(12,2) NOT NULL CHECK(subtotal>=0), discount numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount>=0),
 tax numeric(12,2) NOT NULL CHECK(tax>=0), total numeric(12,2) NOT NULL CHECK(total>=0), reason text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,outlet_id,number), FOREIGN KEY(tenant_id,outlet_id,order_id) REFERENCES orders(tenant_id,outlet_id,id)
);
CREATE INDEX bills_report_idx ON bills(tenant_id,outlet_id,created_at DESC);
CREATE TABLE bill_items (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, bill_id uuid NOT NULL, order_item_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0), snapshot jsonb NOT NULL,
 FOREIGN KEY(tenant_id,bill_id) REFERENCES bills(tenant_id,id), FOREIGN KEY(tenant_id,order_item_id) REFERENCES order_items(tenant_id,id)
);
CREATE TABLE payments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, bill_id uuid NOT NULL, method varchar(30) NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount>0), reference varchar(160) NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,bill_id) REFERENCES bills(tenant_id,id)
);
CREATE TABLE print_jobs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, printer_id uuid NOT NULL,
 document_type varchar(20) NOT NULL CHECK(document_type IN ('KOT','KOT_CANCEL','BILL','BILL_CANCEL','TEST')),
 reference_id uuid, original_job_id uuid, payload jsonb NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CLAIMED','PRINTED','FAILED','UNCERTAIN')),
 attempts integer NOT NULL DEFAULT 0, error text NOT NULL DEFAULT '', claimed_by uuid, claim_token uuid,
 claimed_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,outlet_id,printer_id) REFERENCES printers(tenant_id,outlet_id,id),
 FOREIGN KEY(tenant_id,original_job_id) REFERENCES print_jobs(tenant_id,id), FOREIGN KEY(tenant_id,claimed_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX print_queue_idx ON print_jobs(tenant_id,outlet_id,status,created_at);
CREATE TABLE audit_log (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, outlet_id uuid, user_id uuid NOT NULL,
 action varchar(80) NOT NULL, entity_type varchar(40) NOT NULL, entity_id uuid, reason text NOT NULL DEFAULT '',
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,outlet_id) REFERENCES outlets(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX audit_report_idx ON audit_log(tenant_id,outlet_id,created_at DESC);
CREATE TABLE request_keys (
 tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL, key varchar(100) NOT NULL,
 operation varchar(200) NOT NULL, request_hash varchar(64) NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,key), FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE document_counters (
 tenant_id uuid NOT NULL, outlet_id uuid NOT NULL, kind varchar(20) NOT NULL, value bigint NOT NULL,
 PRIMARY KEY(tenant_id,outlet_id,kind), FOREIGN KEY(tenant_id,outlet_id) REFERENCES outlets(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['branches','outlets','users','user_outlets','categories','menu_items','restaurant_tables','orders','order_items','printers','category_routes','kots','kot_items','bills','bill_items','payments','print_jobs','audit_log','request_keys','document_counters'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
