param([Parameter(Mandatory=$true)][string]$Destination, [string]$Database = 'okr')
$ErrorActionPreference = 'Continue' # Check native exit codes; Docker writes normal progress to stderr.
if ($Database -ne 'okr' -and $Database -notmatch '^okr_ch(?:09|10)_test_[a-z0-9_]+$') { throw 'Database must be okr or an isolated chapter acceptance database' }
$dumpTarget = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $dumpTarget) { throw 'Destination already exists; choose a new backup filename' }
$dumpTemp = '/tmp/okr-backup-' + [guid]::NewGuid().ToString('N') + '.dump'
try {
  docker compose exec -T db pg_dump -U okr -d $Database --format=custom --file=$dumpTemp
  if ($LASTEXITCODE -ne 0) { throw 'Database dump failed' }
  docker compose cp "db:$dumpTemp" $dumpTarget
  if ($LASTEXITCODE -ne 0) { throw 'Copying backup failed' }
  Write-Output "Backup saved: $dumpTarget"
} finally {
  docker compose exec -T db rm -f $dumpTemp
}
