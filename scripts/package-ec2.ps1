param([string]$Destination = 'artifacts/okr-ec2.zip')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseDestination = if ([IO.Path]::IsPathRooted($Destination)) { [IO.Path]::GetFullPath($Destination) } else { [IO.Path]::GetFullPath((Join-Path $releaseRoot $Destination)) }
if (Test-Path -LiteralPath $releaseDestination) { throw 'Archive already exists; choose a new filename.' }
$fixedPaths = @(
  'Dockerfile','.dockerignore','package.json','package-lock.json','tsconfig.base.json',
  'docker-compose.yml','docker-compose.production.yml','infra/nginx.conf',
  'infra/terraform/ec2/bootstrap.sh','infra/terraform/ec2/render-runtime.py',
  'infra/terraform/ec2/okr-compose.sh','infra/terraform/ec2/docker-compose.ec2.yml','infra/terraform/ec2/Caddyfile'
)
$releaseFiles = @($fixedPaths | ForEach-Object { Get-Item -LiteralPath (Join-Path $releaseRoot $_) })
foreach ($tree in @('apps','packages')) {
  $releaseFiles += Get-ChildItem -LiteralPath (Join-Path $releaseRoot $tree) -File -Recurse | Where-Object {
    $relative = $_.FullName.Substring($releaseRoot.Length + 1).Replace('\','/')
    $relative -notmatch '(^|/)(node_modules|dist|test|tests|\.git|\.aws|\.codex)(/|$)' -and
    $_.Name -notmatch '^\.env($|\.)' -and $_.Extension -notin @('.log','.dump','.zip','.pem','.key')
  }
}
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($releaseDestination)) | Out-Null
$stream = [IO.File]::Open($releaseDestination, [IO.FileMode]::CreateNew)
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($file in $releaseFiles | Sort-Object FullName -Unique) {
    # Refuse links/junctions and paths escaping the explicitly allowed source trees.
    $current = $file
    while ($current -and $current.FullName -ne $releaseRoot) {
      if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release inputs must not contain symbolic links or junctions.' }
      $current = if ($current -is [IO.FileInfo]) { $current.Directory } else { $current.Parent }
    }
    if (-not $file.FullName.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release input escaped the repository.' }
    $entryName = $file.FullName.Substring($releaseRoot.Length + 1).Replace('\','/')
    $entry = $archive.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
    $input = $file.OpenRead()
    $output = $entry.Open()
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
  }
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Output ('Release archive: ' + $releaseDestination)
Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $releaseDestination -Algorithm SHA256).Hash.ToLowerInvariant())
