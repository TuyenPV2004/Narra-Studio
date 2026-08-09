$ErrorActionPreference = 'Stop'

$remotionRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$repositoryRoot = Resolve-Path (Join-Path $remotionRoot '..')
$fixtureRoot = Join-Path $repositoryRoot 'fixtures\documentary-90s'
$narrationDirectory = Join-Path $fixtureRoot 'audio\narration'
$musicDirectory = Join-Path $fixtureRoot 'audio\music'
$scriptPath = Join-Path $narrationDirectory 'script.txt'
$rawNarrationPath = Join-Path $narrationDirectory 'narration.raw.wav'
$narrationPath = Join-Path $narrationDirectory 'narration.wav'
$musicPath = Join-Path $musicDirectory 'music-bed.wav'

New-Item -ItemType Directory -Force -Path $narrationDirectory, $musicDirectory | Out-Null

$voice = New-Object -ComObject SAPI.SpVoice
$stream = New-Object -ComObject SAPI.SpFileStream

try {
  $stream.Open($rawNarrationPath, 3, $false)
  $voice.AudioOutputStream = $stream
  $voice.Rate = -1
  $voice.Volume = 100
  [void]$voice.Speak((Get-Content -Raw -Encoding UTF8 $scriptPath))
} finally {
  $stream.Close()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($voice)
}

Push-Location $remotionRoot
try {
  pnpm exec remotion ffmpeg -y -i $rawNarrationPath -af 'apad=pad_dur=90' -t 90 -ar 48000 -ac 2 $narrationPath
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to pad narration audio. Exit code: $LASTEXITCODE"
  }

  pnpm exec remotion ffmpeg -y -f lavfi -i 'sine=frequency=110:sample_rate=48000:duration=90' -af 'volume=0.08' -ac 2 $musicPath
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to generate music bed. Exit code: $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Output "Generated narration: $narrationPath"
Write-Output "Generated music bed: $musicPath"
