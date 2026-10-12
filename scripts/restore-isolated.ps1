param([Parameter(Mandatory=$true)][string]$Backup)
$ErrorActionPreference = 'Continue' # Check native exit codes; Docker writes normal progress to stderr.
$restoreSource = (Resolve-Path -LiteralPath $Backup -ErrorAction Stop).Path
$restoreDatabase = 'okr_restore_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + [guid]::NewGuid().ToString('N').Substring(0,8)
$restoreTemp = '/tmp/' + $restoreDatabase + '.dump'
# Always create a new database. No --clean, DROP DATABASE, or live database target.
try {
  docker compose cp $restoreSource "db:$restoreTemp"
  if ($LASTEXITCODE -ne 0) { throw 'Copying backup failed' }
  docker compose exec -T db createdb -U okr $restoreDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Creating isolated database failed' }
  docker compose exec -T db pg_restore -U okr -d $restoreDatabase --no-owner --no-privileges --exit-on-error --single-transaction $restoreTemp
  if ($LASTEXITCODE -ne 0) { throw "Restore failed; inspect isolated database $restoreDatabase" }
  Write-Output "Restored into isolated database: $restoreDatabase"
} finally {
  docker compose exec -T db rm -f $restoreTemp
}
