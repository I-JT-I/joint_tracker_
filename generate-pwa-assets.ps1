# Genera gli splash screen iOS a partire da icon-master.png.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File generate-pwa-assets.ps1
#
# --- ICONE (favicon, PWA, apple-touch, og-image): le genera generate-icons.ps1 ---
# Dal 2026-09 il marchio dell'app e' un'immagine raster (img/brand/source-icon.png),
# non piu' i vettori in img/brand/*.svg. Questo script fa solo gli splash iOS, che
# partono da icon-master.png: quindi lancia PRIMA generate-icons.ps1, POI questo.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot
$sourcePath = Join-Path $root 'icon-master.png'   # tile del marchio a tutto quadro, 1024px
$splashDir = Join-Path $root 'splash'
$bgColor = [System.Drawing.Color]::FromArgb(255, 0x0c, 0x12, 0x0c)  # background_color del manifest

if (-not (Test-Path $sourcePath)) { throw "Non trovo $sourcePath" }
if (-not (Test-Path $splashDir)) { New-Item -ItemType Directory -Path $splashDir | Out-Null }

$source = [System.Drawing.Image]::FromFile($sourcePath)

function New-HQGraphics($bitmap) {
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    return $g
}

# ---------- Splash screen iOS (sfondo pieno, logo centrato al 32%) ----------
function New-Splash([int]$w, [int]$h, [string]$outPath) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = New-HQGraphics $bmp
    $brush = New-Object System.Drawing.SolidBrush $bgColor
    $g.FillRectangle($brush, 0, 0, $w, $h)
    $logoSize = [int]([math]::Round([math]::Min($w, $h) * 0.32))
    $x = [int]([math]::Round(($w - $logoSize) / 2))
    $y = [int]([math]::Round(($h - $logoSize) / 2))
    $g.DrawImage($source, $x, $y, $logoSize, $logoSize)
    $g.Dispose()
    $brush.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "OK  $outPath"
}

$splashSizes = @(
    @(640, 1136), @(750, 1334), @(828, 1792),
    @(1125, 2436), @(1170, 2532), @(1179, 2556), @(1242, 2688),
    @(1284, 2778), @(1290, 2796),
    @(1536, 2048), @(1620, 2160), @(1668, 2388), @(2048, 2732)
)

foreach ($s in $splashSizes) {
    $w, $h = $s
    New-Splash $w $h (Join-Path $splashDir "apple-splash-$w-$h.png")
}

$source.Dispose()
Write-Host ""
Write-Host "Fatto: $($splashSizes.Count) splash iOS. Le icone si rigenerano con resvg (vedi commento in testa)."
