param(
    [Parameter(Mandatory = $true)]
    [string]$CorpusDir,

    [Parameter(Mandatory = $true)]
    [string]$Ffmpeg,

    [Parameter(Mandatory = $true)]
    [string]$WhisperCli,

    [Parameter(Mandatory = $true)]
    [string]$BaseModel,

    [Parameter(Mandatory = $true)]
    [string]$SmallModel,

    [Parameter(Mandatory = $true)]
    [string]$VadModel
)

$ErrorActionPreference = "Stop"

foreach ($path in @($CorpusDir, $Ffmpeg, $WhisperCli, $BaseModel, $SmallModel, $VadModel)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "No existe la ruta requerida: $path"
    }
}

$outputRoot = Join-Path $CorpusDir ".benchmark"
$wavDir = Join-Path $outputRoot "wav"
$runsDir = Join-Path $outputRoot "runs"
New-Item -ItemType Directory -Force -Path $wavDir, $runsDir | Out-Null

$ffprobe = Join-Path (Split-Path -Parent $Ffmpeg) "ffprobe.exe"
if (-not (Test-Path -LiteralPath $ffprobe)) {
    throw "No se encontro ffprobe.exe junto a FFmpeg: $ffprobe"
}

$audioFiles = Get-ChildItem -LiteralPath $CorpusDir -Filter "*.m4a" | Sort-Object Name

foreach ($audio in $audioFiles) {
    $wavPath = Join-Path $wavDir ($audio.BaseName + ".wav")
    if (-not (Test-Path -LiteralPath $wavPath)) {
        & $Ffmpeg -hide_banner -loglevel error -y -i $audio.FullName -ac 1 -ar 16000 -c:a pcm_s16le $wavPath
        if ($LASTEXITCODE -ne 0) {
            throw "FFmpeg no pudo convertir $($audio.Name)"
        }
    }
}

$durations = foreach ($audio in $audioFiles) {
    $wavPath = Join-Path $wavDir ($audio.BaseName + ".wav")
    $duration = & $ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $wavPath
    if ($LASTEXITCODE -ne 0) {
        throw "FFprobe no pudo medir $wavPath"
    }
    [PSCustomObject]@{
        audio = $audio.BaseName
        duration_seconds = [Math]::Round([double]$duration, 3)
    }
}
$durations | Export-Csv -LiteralPath (Join-Path $outputRoot "durations.csv") -NoTypeInformation -Encoding utf8

$profiles = @(
    [PSCustomObject]@{ Name = "base-vad"; Model = $BaseModel; UseVad = $true },
    [PSCustomObject]@{ Name = "base-novad"; Model = $BaseModel; UseVad = $false },
    [PSCustomObject]@{ Name = "small-vad"; Model = $SmallModel; UseVad = $true },
    [PSCustomObject]@{ Name = "small-novad"; Model = $SmallModel; UseVad = $false }
)

$results = [System.Collections.Generic.List[object]]::new()

foreach ($profile in $profiles) {
    $profileDir = Join-Path $runsDir $profile.Name
    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

    foreach ($audio in $audioFiles) {
        $wavPath = Join-Path $wavDir ($audio.BaseName + ".wav")
        $outputBase = Join-Path $profileDir $audio.BaseName
        $logPath = $outputBase + ".log"

        $arguments = [System.Collections.Generic.List[string]]@(
            "--model", $profile.Model,
            "--file", $wavPath,
            "--language", "es",
            "--threads", "4",
            "--no-gpu",
            "--output-txt",
            "--output-json-full",
            "--output-file", $outputBase
        )

        if ($profile.UseVad) {
            $arguments.AddRange([string[]]@(
            "--vad",
            "--vad-model", $VadModel,
            "--vad-threshold", "0.35",
            "--vad-min-speech-duration-ms", "100",
            "--vad-min-silence-duration-ms", "500",
            "--vad-max-speech-duration-s", "28",
            "--vad-speech-pad-ms", "250",
            "--vad-samples-overlap", "0.25"
            ))
        }

        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $processOutput = & $WhisperCli @arguments 2>&1
        $exitCode = $LASTEXITCODE
        $stopwatch.Stop()
        $processOutput | Set-Content -LiteralPath $logPath -Encoding utf8

        $results.Add([PSCustomObject]@{
            profile = $profile.Name
            audio = $audio.BaseName
            elapsed_seconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
            exit_code = $exitCode
        })

        if ($exitCode -ne 0) {
            throw "Whisper fallo con $($audio.Name) usando $($profile.Name). Revisa $logPath"
        }
    }
}

$results | Export-Csv -LiteralPath (Join-Path $outputRoot "timings.csv") -NoTypeInformation -Encoding utf8
Write-Output "Benchmark finalizado: $outputRoot"
