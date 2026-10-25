-- Per-environment database bootstrap, run ONCE by a database administrator before the
-- first migration (local: scripts/setup-local.mjs runs it automatically).
--
--   :owner_role   role that owns the commerce schema and runs migrations
--   :app_role     login role used by the application runtime (DATABASE_URL)
--
-- Migrations refer only to the stable group role "beautybox_runtime", so every
-- environment can name its login roles freely. The runtime role gets DML without
-- DELETE by default; migrations grant DELETE only where it is legitimate.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beautybox_runtime') THEN
    CREATE ROLE beautybox_runtime NOLOGIN;
  END IF;
END $$;

GRANT beautybox_runtime TO :"app_role";

CREATE SCHEMA IF NOT EXISTS commerce AUTHORIZATION :"owner_role";
REVOKE ALL ON SCHEMA commerce FROM PUBLIC;
GRANT USAGE ON SCHEMA commerce TO beautybox_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA commerce
  GRANT SELECT, INSERT, UPDATE ON TABLES TO beautybox_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA commerce
  GRANT USAGE, SELECT ON SEQUENCES TO beautybox_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA commerce
  GRANT EXECUTE ON FUNCTIONS TO beautybox_runtime;
