CREATE TABLE platform_contact (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 email varchar(254) NOT NULL DEFAULT '',
 phone varchar(40) NOT NULL DEFAULT ''
);
INSERT INTO platform_contact DEFAULT VALUES;

CREATE TABLE platform_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid REFERENCES tenants(id),
 subject_id uuid,
 operator_email varchar(254) NOT NULL,
 action varchar(50) NOT NULL,
 reason varchar(500) NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_subject ON platform_audit(tenant_id, subject_id, id DESC);
