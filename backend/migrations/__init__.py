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
