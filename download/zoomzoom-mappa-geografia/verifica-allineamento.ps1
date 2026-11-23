# ZoomZoom — verifica dell'allineamento del progetto con la versione collaudata.
#
# Confronta OGNI file della cartella src\ del tuo progetto con il manifest
# SHA-256 della versione che ho compilato e collaudato (next build 47/47,
# collaudo funzionale del pulsante, mappa verificata). Se tutto corrisponde,
# il codice del tuo sito e' BYTE PER BYTE la versione verificata: non puo'
# esserci "qualcosa di diverso" nel codice, e qualsiasi differenza che vedi
# riguardera' dati, configurazione o ambiente — non i file.
#
# USO (PowerShell, dalla cartella del pacchetto estratto):
#   .\verifica-allineamento.ps1
# oppure indicando il progetto:
#   .\verifica-allineamento.ps1 -Progetto "C:\Users\Carlo\sito\zoomzoom"
#
# Se PowerShell blocca gli script (esecuzione limitata), lancia invece:
#   powershell -ExecutionPolicy Bypass -File .\verifica-allineamento.ps1
param(
  [string]$Pacchetto = $PSScriptRoot,
  [string]$Progetto = "C:\Users\Carlo\sito\zoomzoom"
)

$ErrorActionPreference = "Continue"
$manifestPath = Join-Path $Pacchetto "MANIFEST-src.sha256"
if (!(Test-Path $manifestPath)) { Write-Host "Manifest non trovato: $manifestPath" -ForegroundColor Red; exit 1 }
if (!(Test-Path (Join-Path $Progetto "src"))) { Write-Host "Cartella src non trovata in: $Progetto" -ForegroundColor Red; exit 1 }

$righe = Get-Content $manifestPath | Where-Object { $_ -match '^[0-9a-f]{64}  ' }
$ok = 0; $diversi = @(); $mancanti = @(); $attesi = @()
foreach ($r in $righe) {
  $parti = $r -split '  ', 2
  $hash = $parti[0]; $rel = $parti[1].Trim()
  $attesi += $rel
  $p = Join-Path $Progetto ($rel -replace '/', '\')
  if (!(Test-Path $p)) { $mancanti += $rel; continue }
  $h = (Get-FileHash $p -Algorithm SHA256).Hash.ToLower()
  if ($h -eq $hash) { $ok++ } else { $diversi += $rel }
}

# file presenti nel progetto ma non nella versione collaudata (solo informativo)
$presenti = Get-ChildItem (Join-Path $Progetto "src") -Recurse -File |
  ForEach-Object { "src/" + $_.FullName.Substring((Join-Path $Progetto "src").Length + 1).Replace('\','/') }
$extra = @($presenti | Where-Object { $attesi -notcontains $_ })

Write-Host ""
Write-Host "=== Verifica allineamento ZoomZoom ===" -ForegroundColor Cyan
Write-Host "Progetto confrontato : $Progetto"
Write-Host "Versione di riferimento: mappa-geografia (base commit 'fix mappa' + questo pacchetto)"
Write-Host ""
if ($ok -eq $righe.Count) { Write-Host "File identici : $ok su $($righe.Count)" -ForegroundColor Green }
else { Write-Host "File identici : $ok su $($righe.Count)" -ForegroundColor Yellow }
if ($mancanti.Count) {
  Write-Host ""
  Write-Host "MANCANTI nel progetto ($($mancanti.Count)):" -ForegroundColor Red
  $mancanti | ForEach-Object { Write-Host "  $_" }
}
if ($diversi.Count) {
  Write-Host ""
  Write-Host "DIVERSI dalla versione collaudata ($($diversi.Count)):" -ForegroundColor Red
  $diversi | ForEach-Object { Write-Host "  $_" }
}
if ($extra.Count) {
  Write-Host ""
  Write-Host "File EXTRA nel progetto, assenti dalla versione collaudata ($($extra.Count)):" -ForegroundColor Yellow
  $extra | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
if (!$mancanti.Count -and !$diversi.Count -and !$extra.Count) {
  Write-Host "TUTTO ALLINEATO: src\ coincide al byte con la versione collaudata." -ForegroundColor Green
  Write-Host "Se qualcosa sulla mappa non va, la causa e' nei DATI del database o"
  Write-Host "nelle variabili d'ambiente — non nel codice (usa il pulsante admin"
  Write-Host "'Completa provincia e regione delle città' e la rotta /api/diagnostica)."
} else {
  Write-Host "ALLINEAMENTO INCOMPLETO: applica il pacchetto (patch o copia dei file)" -ForegroundColor Yellow
  Write-Host "e rilancia questo script."
}

# stato git del progetto (informativo)
try {
  $gs = git -C $Progetto status --porcelain 2>$null
  if ($gs) {
    $n = ($gs | Measure-Object).Count
    Write-Host ""
    Write-Host "Nota: il progetto ha $n modifiche non ancora salvate con git" -ForegroundColor Yellow
    Write-Host "('git status'): registrale con git add -A e git commit prima del push."
  }
} catch {}
