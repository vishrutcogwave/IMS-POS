CREATE TABLE day_end_email_settings (
    tenant_id uuid NOT NULL,
    outlet_id uuid NOT NULL,
    recipients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipients)='array'),
    scheduled boolean NOT NULL DEFAULT false,
    send_time time NOT NULL DEFAULT '23:00',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,outlet_id),
    FOREIGN KEY (tenant_id,outlet_id) REFERENCES outlets(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE day_end_email_deliveries (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    outlet_id uuid NOT NULL,
    business_date date NOT NULL,
    trigger varchar(12) NOT NULL CHECK (trigger IN ('MANUAL','SCHEDULED')),
    status varchar(12) NOT NULL CHECK (status IN ('SENDING','SENT','FAILED')),
    attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 10),
    started_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    last_error varchar(500) NOT NULL DEFAULT '',
    requested_by uuid,
    UNIQUE (tenant_id,outlet_id,business_date),
    FOREIGN KEY (tenant_id,outlet_id) REFERENCES outlets(tenant_id,id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id,requested_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX day_end_email_due ON day_end_email_settings(tenant_id,scheduled,send_time);
CREATE INDEX day_end_email_history ON day_end_email_deliveries(tenant_id,outlet_id,business_date DESC);

ALTER TABLE day_end_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_end_email_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON day_end_email_settings
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE day_end_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_end_email_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON day_end_email_deliveries
    USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
    WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
