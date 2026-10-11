-- v14.0.2 prod cleanup — ONE script, one transaction. Review the output of each step, then it commits at the end
-- only if every safety check passed. Run:  psql "$PROD_DSN" -v ON_ERROR_STOP=1 -f v14_0_2_cleanup.sql
-- Everything here is reversible: leads are soft-deleted (deleted_at), and the time zone is one column.
BEGIN;

-- 1. Safety: refuse to run if a cadence is still active on one of these leads (the app's delete would stop it; SQL does not).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM journey_enrollments e JOIN leads l ON l.id = e.lead_id
   WHERE e.status = 'active' AND l.deleted_at IS NULL
     AND (lower(l.email) LIKE '%@screen-magic.com' OR lower(l.email) LIKE '%@staging.in');
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborted: % active cadence enrollment(s) on internal leads — delete these leads from the app instead', n;
  END IF;
END $$;

-- 2. Soft-delete the internal staff leads (expect 10 rows: Aman TESTING, Ananya Bains, Priyanka Purohit, Vivek Anand,
--    Damini Kumari, Neel, Anway Patankar, Shreyash Test, Sonal Bangar, Abhilash Sonare).
UPDATE leads SET deleted_at = now()
 WHERE deleted_at IS NULL
   AND (lower(email) LIKE '%@screen-magic.com' OR lower(email) LIKE '%@staging.in')
RETURNING id, first_name, last_name, email;

-- 3. India Team's Daily Digest day follows its own time zone (prod already has it set to Asia/Kolkata at the time of
--    writing; this is a no-op then, and a fix if it was ever cleared).
UPDATE pods SET timezone = 'Asia/Kolkata' WHERE name = 'India Team' AND timezone IS DISTINCT FROM 'Asia/Kolkata';

-- 4. Mark the two people who have left, so rep lists and reports show them as Left (their leads and history stay).
UPDATE users SET left_at = now() WHERE left_at IS NULL AND name IN ('Ananya Bains', 'Damini kumari');

-- 5. Final guard: no live internal-address leads may remain, otherwise roll back instead of committing.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM leads WHERE deleted_at IS NULL
     AND (lower(email) LIKE '%@screen-magic.com' OR lower(email) LIKE '%@staging.in');
  IF n > 0 THEN RAISE EXCEPTION 'Aborted: % internal lead(s) still live', n; END IF;
END $$;

COMMIT;
-- Undo (if ever needed): UPDATE leads SET deleted_at = NULL WHERE id IN (<ids printed by step 2>);
--                        UPDATE users SET left_at = NULL WHERE name IN ('Ananya Bains', 'Damini kumari');
