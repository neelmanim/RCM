"""RCA 2026-09-29: backend/migrations/ (a package) shadows migrations.py and
only re-exported run_schema_migrations, so scheduled_jobs' daily
journey_partition_upkeep (`from migrations import
_ensure_execution_log_partitions`) raised ImportError in prod every day."""


def test_any_migrations_py_name_is_importable_through_the_package():
    from migrations import _ensure_execution_log_partitions, run_schema_migrations
    assert callable(_ensure_execution_log_partitions)
    assert callable(run_schema_migrations)
