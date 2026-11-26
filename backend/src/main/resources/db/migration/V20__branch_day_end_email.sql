-- Preserve any outlet-scoped settings/history from V19 while switching the active feature to branch scope.
ALTER TABLE day_end_email_settings RENAME TO day_end_email_settings_outlet_legacy;
ALTER TABLE day_end_email_deliveries RENAME TO day_end_email_deliveries_outlet_legacy;
DROP INDEX day_end_email_due;
DROP INDEX day_end_email_history;

CREATE TABLE day_end_email_settings (
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    recipients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipients)='array'),
    scheduled boolean NOT NULL DEFAULT false,
    send_time time NOT NULL DEFAULT '23:00',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id,branch_id),
    FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE day_end_email_deliveries (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    business_date date NOT NULL,
    trigger varchar(12) NOT NULL CHECK (trigger IN ('MANUAL','SCHEDULED')),
    status varchar(12) NOT NULL CHECK (status IN ('SENDING','SENT','FAILED')),
    attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 10),
    started_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    last_error varchar(500) NOT NULL DEFAULT '',
    requested_by uuid,
    UNIQUE (tenant_id,branch_id,business_date),
    FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id,requested_by) REFERENCES users(tenant_id,id)
);

CREATE INDEX day_end_email_due ON day_end_email_settings(tenant_id,scheduled,send_time);
CREATE INDEX day_end_email_history ON day_end_email_deliveries(tenant_id,branch_id,business_date DESC);

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

-- Carry settings forward only when every outlet in a branch had identical settings.
-- Conflicting outlet configurations are retained in the legacy tables for owner review.
INSERT INTO day_end_email_settings(tenant_id,branch_id,recipients,scheduled,send_time)
SELECT tenant_id,branch_id,
       CASE WHEN count(DISTINCT recipients)=1 AND count(DISTINCT scheduled)=1 AND count(DISTINCT send_time)=1
            THEN jsonb_agg(recipients)->0 ELSE '[]'::jsonb END,
       CASE WHEN count(DISTINCT recipients)=1 AND count(DISTINCT scheduled)=1 AND count(DISTINCT send_time)=1
            THEN bool_or(scheduled) ELSE false END,
       min(send_time)
FROM (
    SELECT s.tenant_id,o.branch_id,s.recipients,s.scheduled,s.send_time
    FROM day_end_email_settings_outlet_legacy s
    JOIN outlets o ON o.tenant_id=s.tenant_id AND o.id=s.outlet_id
) old_settings
GROUP BY tenant_id,branch_id
HAVING count(*)=(select count(*) from outlets o where o.tenant_id=old_settings.tenant_id and o.branch_id=old_settings.branch_id);
