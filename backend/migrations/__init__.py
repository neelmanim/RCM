# migrations/__init__.py
# Re-exports run_schema_migrations and module utilities from migrations.py
import importlib.util, os as _os

_spec = importlib.util.spec_from_file_location(
    "migrations_module",
    _os.path.join(_os.path.dirname(__file__), "..", "migrations.py"),
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

run_schema_migrations = _mod.run_schema_migrations
_ensure_execution_log_partitions = getattr(_mod, "_ensure_execution_log_partitions", None)
module = _mod


def __getattr__(name):
    return getattr(_mod, name)
