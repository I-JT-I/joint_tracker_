# Genera gli splash screen iOS a partire da icon-master.png.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File generate-pwa-assets.ps1
#
# --- ICONE (favicon, PWA, apple-touch, og-image): NON le genera piu' questo script ---
# Dal redesign del marchio (2026-09) le icone sono rasterizzate direttamente dai file
# vettoriali in img/brand/ con @resvg/resvg-js-cli (nessuna dipendenza aggiunta al repo,
# si usa via `npx`). System.Drawing non sa leggere SVG, quindi lo script resta solo per
# gli splash. Comandi per rigenerare le icone (da eseguire nella root del repo):
#
#   R() { npx --yes @resvg/resvg-js-cli --log-level error "$@"; }
#   # "any": tile arrotondato, dettaglio pieno
#   for s in 192 384 512 1024; do R --fit-width $s img/brand/jt-icon.svg icon-$s.png; done
#   # maskable: tile a tutto quadro (no raggio), contenuto entro ~78% centrale
#   #   (jt-maskable.svg = jt-icon.svg con <rect> senza rx + arte in <g transform="translate(32 32) scale(.78) translate(-32 -32)">)
#   for s in 192 384 512 1024; do R --fit-width $s <jt-maskable.svg> icon-maskable-$s.png; done
#   R --fit-width 16  img/brand/jt-icon-small.svg favicon-16.png
#   R --fit-width 32  img/brand/jt-icon-small.svg favicon-32.png
#   R --fit-width 180 <jt-fullbleed.svg>          apple-touch-icon.png   # opaco, iOS applica la sua maschera
#   R --fit-width 1024 <jt-fullbleed.svg>         icon-master.png        # sorgente per gli splash qui sotto
#   # favicon.svg (root) = copia di img/brand/jt-icon-small.svg senza il blocco <metadata> C2PA
#   # og-image.png (1200x630) = render di un SVG dedicato con font Sora (vedi handoff)

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
