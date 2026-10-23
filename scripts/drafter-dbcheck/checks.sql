-- TEST ONLY. What 1627 promises, checked after it ran twice (made-up ids).
\set QUIET on
\pset tuples_only on
\pset format unaligned
SET client_min_messages = notice;
SELECT 'A drafts point at their row: ' || bool_and(g.matter_form_id = mf.id) || ' (' || count(*) || ' drafts)'
FROM generated_forms g JOIN matter_forms mf ON mf.matter_id = g.matter_id AND mf.template_id = g.template_id
WHERE g.matter_id = 'a0000000-0000-0000-0000-00000000000a';
SELECT 'A edit points at its G-1450 row: ' || (matter_form_id IS NOT NULL) FROM form_field_edits WHERE matter_id = 'a0000000-0000-0000-0000-00000000000a';
SELECT 'B draft and edit left NULL (no row yet): ' || ((SELECT bool_and(matter_form_id IS NULL) FROM generated_forms WHERE matter_id='b0000000-0000-0000-0000-00000000000b') AND (SELECT bool_and(matter_form_id IS NULL) FROM form_field_edits WHERE matter_id='b0000000-0000-0000-0000-00000000000b'));
SELECT 'DACA package lists G-1450 twice: ' || (count(*) = 2) FROM form_package_items i JOIN form_templates t ON t.id = i.template_id AND t.form_key = 'g-1450';
SELECT 'package now has 7 lines: ' || (count(*) = 7) FROM form_package_items;
SELECT 'columns present: ' || (count(*) = 2) FROM information_schema.columns WHERE table_name = 'matter_forms' AND column_name IN ('fee_amount', 'package_item_id');
SELECT 'old UNIQUEs gone: ' || (count(*) = 0) FROM pg_constraint WHERE contype = 'u' AND conname IN ('matter_forms_matter_id_template_id_key','generated_forms_matter_id_template_id_version_num_key','form_field_edits_matter_id_template_id_field_name_key','form_package_items_package_id_template_id_key');
-- A second G-1450 on case A, with its own v1 draft and its own edit of the same field.
INSERT INTO matter_forms (id, matter_id, template_id, sort_order, source, fee_amount)
SELECT 'f0000000-0000-0000-0000-0000000000ff', 'a0000000-0000-0000-0000-00000000000a', id, 70, 'manual', 85 FROM form_templates WHERE form_key = 'g-1450';
INSERT INTO generated_forms (matter_id, template_id, matter_form_id, batch_id, version_num, r2_key, file_name)
SELECT 'a0000000-0000-0000-0000-00000000000a', id, 'f0000000-0000-0000-0000-0000000000ff', gen_random_uuid(), 1, 'k/2nd', 'G-1450 $85 - EJEMPLO.pdf' FROM form_templates WHERE form_key = 'g-1450';
INSERT INTO form_field_edits (matter_id, template_id, matter_form_id, field_name, value)
SELECT 'a0000000-0000-0000-0000-00000000000a', id, 'f0000000-0000-0000-0000-0000000000ff', 'GivenName', 'Other' FROM form_templates WHERE form_key = 'g-1450';
SELECT 'second G-1450 holds its own v1 and edit: ' || ((SELECT count(*) FROM generated_forms WHERE matter_form_id='f0000000-0000-0000-0000-0000000000ff') = 1 AND (SELECT count(*) FROM form_field_edits WHERE matter_id='a0000000-0000-0000-0000-00000000000a' AND field_name='GivenName') = 2);
DO $$ BEGIN
  BEGIN
    INSERT INTO form_field_edits (matter_id, template_id, matter_form_id, field_name, value)
    SELECT 'a0000000-0000-0000-0000-00000000000a', id, 'f0000000-0000-0000-0000-0000000000ff', 'GivenName', 'dup' FROM form_templates WHERE form_key = 'g-1450';
    RAISE NOTICE 'one copy, one edit per field: false';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'one copy, one edit per field: true';
  END;
  BEGIN
    UPDATE matter_forms SET fee_amount = -1 WHERE id = 'f0000000-0000-0000-0000-0000000000ff';
    RAISE NOTICE 'negative fee refused: false';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'negative fee refused: true';
  END;
END $$;
SELECT 'G-1450 map fills AuthorizedPaymentAmt from form.fee_amount: ' || (field_map -> 'form1[0].#subform[0].AuthorizedPaymentAmt[0]' ->> 'source' = 'form.fee_amount') || ', rest of map kept: ' || (field_map -> 'form1[0].#subform[0].FamilyName[0]' ->> 'source' = 'client.last_name') FROM form_templates WHERE form_key = 'g-1450';
