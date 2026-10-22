-- Read-only diagnostic. Run in project duyiihsmaqfgwezmsnjs's SQL Editor.
-- This does not change customer data, policies, permissions or schema.

-- Return one result set: the SQL Editor may display only the last statement.
with expected_tables(table_name) as (values
  ('customer_profiles'), ('saved_homes'), ('customer_records'),
  ('enquiry_notes'), ('enquiries')
), required_columns(table_name, column_name) as (values
  ('customer_profiles', 'user_id'), ('customer_profiles', 'full_name'),
  ('customer_profiles', 'email'), ('customer_profiles', 'phone'),
  ('customer_profiles', 'preferred_district'), ('customer_profiles', 'budget_min'),
  ('customer_profiles', 'budget_max'), ('customer_profiles', 'move_in_date'),
  ('customer_profiles', 'preferences'), ('customer_profiles', 'updated_at'),
  ('saved_homes', 'user_id'), ('saved_homes', 'property_id'),
  ('enquiries', 'user_id'), ('enquiries', 'appointment_at'),
  ('enquiries', 'customer_update'), ('enquiries', 'cancelled_at')
)
select array(
         select table_name from expected_tables
         where to_regclass('public.' || table_name) is null
         order by table_name
       ) as missing_tables,
       array(
         select required.table_name || '.' || required.column_name
         from required_columns required
         where not exists (
           select 1 from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = required.table_name
             and c.column_name = required.column_name
         )
         order by required.table_name, required.column_name
       ) as missing_columns,
       to_regprocedure('private.is_editor()') is not null as staff_access_helper_exists,
       to_regprocedure('public.save_customer_enquiry(uuid,text,text,timestamp with time zone,text)') is not null as staff_enquiry_update_exists;
