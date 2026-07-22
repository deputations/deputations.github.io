-- 0009_additional_details.sql
-- Adds a free-text "additional_details" column to vacancies: any other
-- important info about a post not captured by the structured fields
-- (special instructions, relaxations, reservations, contact details,
-- remarks/notes/conditions). Optional; shown in the public modal only when
-- present. Inherits the table's existing RLS; the public read path uses
-- select=*, so no policy change is needed.

alter table public.vacancies
  add column if not exists additional_details text;
