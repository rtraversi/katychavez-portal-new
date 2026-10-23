-- TEST ONLY. Legacy rows as production holds them before 1627 (made-up ids).
INSERT INTO clients (id, first_name, last_name) VALUES ('c0000000-0000-0000-0000-000000000001', 'Lucía', 'Ejemplo');
INSERT INTO matters (id, client_id, case_type_id) SELECT 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', id FROM case_types WHERE key = 'daca';
INSERT INTO matters (id, client_id, case_type_id) SELECT 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000001', id FROM case_types WHERE key = 'daca';
-- Case A was seeded (1605): one row per form.
INSERT INTO matter_forms (id, matter_id, template_id, sort_order)
SELECT ('f0000000-0000-0000-0000-0000000000' || lpad(row_number() over (order by i.sort_order)::text, 2, '0'))::uuid,
       'a0000000-0000-0000-0000-00000000000a', i.template_id, i.sort_order
FROM form_package_items i;
-- Two versions of A's G-1450 and one G-28, plus edits.
INSERT INTO generated_forms (matter_id, package_id, template_id, batch_id, version_num, r2_key, file_name)
SELECT 'a0000000-0000-0000-0000-00000000000a', p.id, t.id, gen_random_uuid(), v, 'k/' || t.form_key || v, 'x.pdf'
FROM form_packages p, form_templates t, generate_series(1, 2) v WHERE t.form_key IN ('g-1450', 'g-28');
INSERT INTO form_field_edits (matter_id, template_id, field_name, value)
SELECT 'a0000000-0000-0000-0000-00000000000a', id, 'GivenName', 'Lucia' FROM form_templates WHERE form_key = 'g-1450';
-- Case B never seeded (still reading the package): its draft and edit have no row.
INSERT INTO generated_forms (matter_id, package_id, template_id, batch_id, version_num, r2_key, file_name)
SELECT 'b0000000-0000-0000-0000-00000000000b', p.id, t.id, gen_random_uuid(), 1, 'k/b', 'x.pdf' FROM form_packages p, form_templates t WHERE t.form_key = 'g-1450';
INSERT INTO form_field_edits (matter_id, template_id, field_name, value)
SELECT 'b0000000-0000-0000-0000-00000000000b', id, 'GivenName', 'B' FROM form_templates WHERE form_key = 'g-1450';
