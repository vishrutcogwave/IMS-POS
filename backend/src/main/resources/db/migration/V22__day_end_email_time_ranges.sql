ALTER TABLE day_end_email_deliveries
    ADD COLUMN start_at timestamptz,
    ADD COLUMN end_at timestamptz;

UPDATE day_end_email_deliveries d
SET start_at = d.start_date::timestamp AT TIME ZONE coalesce((
        SELECT min(o.timezone) FROM outlets o
        WHERE o.tenant_id=d.tenant_id AND o.branch_id=d.branch_id
    ), 'Asia/Kolkata'),
    end_at = (d.end_date::timestamp + interval '23 hours 59 minutes') AT TIME ZONE coalesce((
        SELECT min(o.timezone) FROM outlets o
        WHERE o.tenant_id=d.tenant_id AND o.branch_id=d.branch_id
    ), 'Asia/Kolkata');

ALTER TABLE day_end_email_deliveries
    ALTER COLUMN start_at SET NOT NULL,
    ALTER COLUMN end_at SET NOT NULL,
    DROP CONSTRAINT day_end_email_branch_range_unique,
    ADD CONSTRAINT day_end_email_branch_time_range_unique UNIQUE (tenant_id,branch_id,start_at,end_at),
    ADD CONSTRAINT day_end_email_valid_time_range CHECK (end_at>=start_at);

DROP INDEX day_end_email_history;
CREATE INDEX day_end_email_history ON day_end_email_deliveries(tenant_id,branch_id,start_at DESC,end_at DESC);
