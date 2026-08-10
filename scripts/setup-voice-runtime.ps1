param(
  [string]$RuntimeRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) '.runtime\voice')
)

$ErrorActionPreference = 'Stop'
$runtime = [System.IO.Path]::GetFullPath($RuntimeRoot)
$repository = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $runtime.StartsWith($repository, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The voice runtime must stay inside the Narra repository.'
}

$uv = Get-Command uv -ErrorAction Stop
$venv = Join-Path $runtime '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$models = Join-Path $runtime 'models'
New-Item -ItemType Directory -Force -Path $runtime, $models | Out-Null

if (-not (Test-Path -LiteralPath $python)) {
  & $uv.Source venv --python 3.12 $venv
  if ($LASTEXITCODE -ne 0) { throw 'uv could not create the voice Python environment.' }
}

& $uv.Source pip install --python $python 'kokoro-onnx==0.5.0' 'soundfile==0.13.1'
if ($LASTEXITCODE -ne 0) { throw 'Voice dependencies could not be installed.' }

$downloads = @(
  @{
    Name = 'kokoro-v1.0.onnx'
    Url = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx'
  },
  @{
    Name = 'voices-v1.0.bin'
    Url = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin'
  }
)

foreach ($download in $downloads) {
  $target = Join-Path $models $download.Name
  if (Test-Path -LiteralPath $target) { continue }
  $temporary = "$target.download"
  Invoke-WebRequest -Uri $download.Url -OutFile $temporary
  Move-Item -LiteralPath $temporary -Destination $target
}

& $python -c 'import kokoro_onnx, soundfile; print(1)'
if ($LASTEXITCODE -ne 0) { throw 'The Kokoro runtime diagnostic failed.' }

@{
  provider = 'KOKORO_ONNX'
  kokoroOnnxVersion = '0.5.0'
  modelVersion = '1.0'
  checkedAt = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'runtime-ready.json') -Encoding utf8

Write-Output "Voice runtime ready: $runtime"
