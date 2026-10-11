# migrations/__init__.py
# Re-exports run_schema_migrations so that `from migrations import run_schema_migrations`
# in main.py continues to work now that migrations/ is a package.
# migrations.py (the column/index migration module) lives as a sibling file.
import importlib.util, os as _os

_spec = importlib.util.spec_from_file_location(
    "migrations_module",
    _os.path.join(_os.path.dirname(__file__), "..", "migrations.py"),
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

run_schema_migrations = _mod.run_schema_migrations

# The loaded module itself, so a test can reach an individual migration
# without this file growing a line per migration.
module = _mod


# RCA 2026-09-29: scheduled_jobs' journey_partition_upkeep did
# `from migrations import _ensure_execution_log_partitions`, which this
# package shadowed with an ImportError — the daily job failed silently in
# prod (Render error logs, 2026-09-26 onward). Forward every other name to
# migrations.py (PEP 562) so any `from migrations import X` just works.
def __getattr__(name):
    return getattr(_mod, name)
