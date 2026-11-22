ALTER TABLE orders ADD COLUMN waiter_name varchar(120) NOT NULL DEFAULT '';
DROP INDEX one_receipt_printer;
