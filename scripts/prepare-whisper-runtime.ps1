param(
    [string]$Destination = (Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\resources\whisper")
)

$ErrorActionPreference = "Stop"
$version = "1.9.3"
$releaseTag = "b4938"
$url = "https://github.com/ggml-org/whisper.cpp/releases/download/$releaseTag/whisper-blas-bin-x64.zip"
$expectedSha256 = "78568aa80b361382cb303438a7be3b05669651f2ca8258910394679e049d26ea"
$archive = Join-Path $env:TEMP "whisper-blas-bin-x64-$version.zip"
$extract = Join-Path $env:TEMP "whisper-blas-bin-x64-$version"

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri $url -OutFile $archive
}

$actualSha256 = Get-Sha256 $archive
if ($actualSha256 -ne $expectedSha256) {
    throw "El runtime descargado no supero la verificacion SHA-256."
}

if (Test-Path -LiteralPath $extract) {
    $resolvedExtract = (Resolve-Path -LiteralPath $extract).Path
    $resolvedTemp = (Resolve-Path -LiteralPath $env:TEMP).Path
    if (-not $resolvedExtract.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "La carpeta temporal calculada esta fuera de TEMP: $resolvedExtract"
    }
    Remove-Item -LiteralPath $resolvedExtract -Recurse -Force
}

Expand-Archive -LiteralPath $archive -DestinationPath $extract
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$release = Join-Path $extract "Release"
$required = @(
    "whisper-cli.exe",
    "whisper.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-blas.dll",
    "libopenblas.dll"
)

foreach ($name in $required) {
    Copy-Item -LiteralPath (Join-Path $release $name) -Destination (Join-Path $Destination $name) -Force
}
Get-ChildItem -LiteralPath $release -Filter "ggml-cpu-*.dll" |
    Copy-Item -Destination $Destination -Force

$vadDestination = Join-Path $Destination "ggml-silero-v6.2.0.bin"
$vadUrl = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin?download=true"
$vadSha256 = "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"
if (-not (Test-Path -LiteralPath $vadDestination)) {
    Invoke-WebRequest -Uri $vadUrl -OutFile $vadDestination
}
if ((Get-Sha256 $vadDestination) -ne $vadSha256) {
    Remove-Item -LiteralPath $vadDestination -Force
    throw "El modelo VAD no supero la verificacion SHA-256."
}

Write-Output "Runtime whisper.cpp $version ($releaseTag) preparado en $Destination"
