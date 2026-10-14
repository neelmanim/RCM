# Start local PostgreSQL 17 server daemon
$pgBin = "C:\Users\NEEL\pgsql\bin"
$pgData = "C:\Users\NEEL\pgsql\data"
$pgLog = "C:\Users\NEEL\pgsql\logfile.log"

if (-not (Test-Path "$pgData\postmaster.pid")) {
    Write-Host "Starting local PostgreSQL server..." -ForegroundColor Cyan
    & "$pgBin\pg_ctl.exe" -D $pgData -l $pgLog start
} else {
    Write-Host "PostgreSQL is already running." -ForegroundColor Green
}
