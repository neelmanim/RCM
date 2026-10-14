# Stop local PostgreSQL 17 server daemon
$pgBin = "C:\Users\NEEL\pgsql\bin"
$pgData = "C:\Users\NEEL\pgsql\data"

if (Test-Path "$pgData\postmaster.pid") {
    Write-Host "Stopping local PostgreSQL server..." -ForegroundColor Yellow
    & "$pgBin\pg_ctl.exe" -D $pgData stop
} else {
    Write-Host "PostgreSQL is not currently running." -ForegroundColor Gray
}
