DROP INDEX day_end_email_history;
ALTER TABLE day_end_email_deliveries
    DROP CONSTRAINT day_end_email_deliveries_tenant_id_branch_id_business_date_key,
    ADD COLUMN start_date date,
    ADD COLUMN end_date date;

UPDATE day_end_email_deliveries SET start_date=business_date,end_date=business_date;
ALTER TABLE day_end_email_deliveries
    ALTER COLUMN start_date SET NOT NULL,
    ALTER COLUMN end_date SET NOT NULL,
    DROP COLUMN business_date,
    ADD CONSTRAINT day_end_email_branch_range_unique UNIQUE (tenant_id,branch_id,start_date,end_date),
    ADD CONSTRAINT day_end_email_valid_range CHECK (end_date>=start_date);

CREATE INDEX day_end_email_history ON day_end_email_deliveries(tenant_id,branch_id,start_date DESC,end_date DESC);
