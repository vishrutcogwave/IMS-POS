ALTER TABLE tenants
 ADD COLUMN subscription_plan varchar(80) NOT NULL DEFAULT 'Standard',
 ADD COLUMN subscription_status varchar(12) NOT NULL DEFAULT 'ACTIVE'
   CHECK (subscription_status IN ('ACTIVE', 'TRIAL', 'SUSPENDED')),
 ADD COLUMN subscription_starts_on date,
 ADD COLUMN subscription_max_branches integer CHECK (subscription_max_branches BETWEEN 1 AND 1000),
 ADD COLUMN subscription_expires_at timestamptz;

CREATE TABLE platform_sessions (
 token_hash char(64) PRIMARY KEY,
 expires_at timestamptz NOT NULL
);

CREATE TABLE platform_subscription_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 operator_email varchar(254) NOT NULL,
 reason varchar(500) NOT NULL,
 previous_value jsonb NOT NULL,
 new_value jsonb NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_subscription_history_tenant ON platform_subscription_history(tenant_id, id DESC);
