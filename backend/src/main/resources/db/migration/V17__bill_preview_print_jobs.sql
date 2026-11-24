ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_document_type_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_document_type_check
    CHECK(document_type IN ('KOT','KOT_CANCEL','BILL_PREVIEW','BILL','BILL_CANCEL','TEST'));
