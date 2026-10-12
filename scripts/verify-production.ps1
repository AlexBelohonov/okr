$ErrorActionPreference = 'Continue' # Windows PowerShell treats Docker progress on stderr as error records.
$productionNames = @('POSTGRES_PASSWORD','APP_URL','EMAIL_MODE','COOKIE_SECURE')
$productionPrevious = @{}
foreach ($setting in $productionNames) { $productionPrevious[$setting] = [Environment]::GetEnvironmentVariable($setting, 'Process') }
try {
  $env:POSTGRES_PASSWORD = '5892acf490837ec87a85d785cab49519'
  $env:APP_URL = 'https://okr.company.test'
  $env:EMAIL_MODE = 'selfhosted'
  $env:COOKIE_SECURE = 'true'
  docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Production Compose validation failed' }
  docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm --no-deps api npm run operations:check -w @okr/api
  if ($LASTEXITCODE -ne 0) { throw 'Safe production configuration rejected' }
  docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm --no-deps -e APP_URL=http://okr.company.test api npm run operations:check -w @okr/api
  if ($LASTEXITCODE -eq 0) { throw 'Unsafe HTTP origin accepted' }
  docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm --no-deps -e DATABASE_URL=postgresql://okr:local-development-only@db:5432/okr api npm run operations:check -w @okr/api
  if ($LASTEXITCODE -eq 0) { throw 'Weak database secret accepted' }
  docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm --no-deps -e COOKIE_SECURE=false api npm run start -w @okr/api
  if ($LASTEXITCODE -eq 0) { throw 'API started with unsafe cookies' }
  docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm --no-deps -e COOKIE_SECURE=false worker npm run worker -w @okr/api
  if ($LASTEXITCODE -eq 0) { throw 'Worker started with unsafe cookies' }
  Write-Output 'Production checks passed: overlay, safe configuration, HTTP/weak-secret rejection, API/worker startup rejection. No production deployment performed.'
  # The last native command intentionally fails; do not report that rejection as a failed verification.
  $global:LASTEXITCODE = 0
} finally {
  foreach ($setting in $productionNames) { [Environment]::SetEnvironmentVariable($setting, $productionPrevious[$setting], 'Process') }
}
