param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [int]$Runs = 3
)

$resolved = (Resolve-Path -LiteralPath $Executable).ProviderPath
$measurements = @()
function Get-NapsProcessTree([int]$RootPid) {
  $all = @(Get-CimInstance Win32_Process -Filter "Name = 'NAPS.exe'")
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootPid)
  do {
    $added = $false
    foreach ($process in $all) {
      if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $added = $true }
    }
  } while ($added)
  return @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
}

for ($run = 1; $run -le $Runs; $run++) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $main = Start-Process -FilePath $resolved -PassThru -WindowStyle Hidden
  try {
    $rendererMs = $null
    while ($watch.ElapsedMilliseconds -lt 20000) {
      $main.Refresh()
      if ($main.HasExited) { throw "NAPS exited before opening its window (code $($main.ExitCode))." }
      $tree = @(Get-NapsProcessTree $main.Id)
      if ($tree | Where-Object { $_.CommandLine -match '--type=renderer' }) {
        $rendererMs = $watch.ElapsedMilliseconds
        break
      }
      Start-Sleep -Milliseconds 50
    }
    if ($null -eq $rendererMs) { throw 'No renderer process appeared within 20 seconds.' }
    Start-Sleep -Seconds 2
    $tree = @(Get-NapsProcessTree $main.Id)
    $processes = @($tree | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    $measurements += [pscustomobject]@{
      Run = $run
      RendererSpawnMs = $rendererMs
      ProcessCount = $processes.Count
      WorkingSetBytes = ($processes | Measure-Object WorkingSet64 -Sum).Sum
    }
  } finally {
    $tree = @(Get-NapsProcessTree $main.Id)
    foreach ($process in ($tree | Sort-Object ProcessId -Descending)) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  }
}
$measurements | ConvertTo-Json -Depth 3
