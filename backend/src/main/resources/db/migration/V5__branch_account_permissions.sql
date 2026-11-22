ALTER TABLE users ADD COLUMN permitted_actions text[];
ALTER TABLE users ADD CONSTRAINT users_permitted_actions CHECK (
  permitted_actions IS NULL OR (
    role <> 'OWNER' AND cardinality(permitted_actions) > 0 AND
    permitted_actions <@ ARRAY['DASHBOARD','ORDER','DISCOUNT','TRANSFER','KITCHEN','BILL','CANCEL','REPORT','SETTINGS','USERS','PRINT']::text[]
  )
);
