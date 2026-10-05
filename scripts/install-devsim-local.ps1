$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$VenvDir = if ($env:OPENSEMILAB_DEVSIM_VENV) { $env:OPENSEMILAB_DEVSIM_VENV } else { Join-Path $RepoDir ".venv-devsim" }

py -3 -m venv $VenvDir
& (Join-Path $VenvDir "Scripts\python.exe") -m pip install --upgrade pip
& (Join-Path $VenvDir "Scripts\python.exe") -m pip install (Join-Path $RepoDir "services\devsim-worker")
Write-Host "DEVSIM is installed. Starting the local companion at http://127.0.0.1:8787"
& (Join-Path $VenvDir "Scripts\opensemilab-devsim.exe")
