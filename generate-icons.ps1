# Genera favicon / icone PWA / apple-touch / og-image dal marchio raster.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File generate-icons.ps1
#   powershell -ExecutionPolicy Bypass -File generate-pwa-assets.ps1   # poi gli splash iOS
#
# Sorgente: img/brand/source-icon.png  (tile arrotondato del marchio, sfondo bianco
# attorno). Dal 2026-09 il marchio dell'app e' un'immagine raster 3D, non piu' i
# vettori in img/brand/*.svg (quelli restano solo per il segno inline sulle pagine
# marketing). System.Drawing non legge SVG: si lavora direttamente sul PNG.
#
# Ritaglio: la tile occupa il bbox (233,39) 512x512 dentro source-icon.png (misurato
# sui pixel non-bianchi). Se rigeneri il PNG sorgente con dimensioni diverse, aggiorna
# $cx/$cy/$cs qui sotto.
#
# - icon-<n>.png            "any": tile a angoli arrotondati (fuori = trasparente)
# - icon-maskable-<n>.png   full-bleed verde, contenuto entro ~84% centrale
# - icon-master.png         1024 opaco, sorgente per gli splash (generate-pwa-assets.ps1)
# - apple-touch-icon.png    180 opaco (iOS applica la sua maschera)
# - favicon-16/32.png       "any"
# - favicon.svg             wrapper SVG con PNG 96px embedded (stesso segno del resto)
# - og-image.png            ricomposto: nuova tile sopra la vecchia, testo invariato

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = $PSScriptRoot

# ---- ritaglio della tile dal PNG sorgente ----
$src = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'img/brand/source-icon.png'))
$cx = 233; $cy = 39; $cs = 512
$tile = New-Object System.Drawing.Bitmap $cs, $cs, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($tile)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $cs, $cs), $cx, $cy, $cs, $cs, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose()

$RAD = 0.223  # raggio angoli / lato (dal marchio: rx 14.4 su 64)

function HQ($b) {
    $x = [System.Drawing.Graphics]::FromImage($b)
    $x.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $x.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $x.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $x.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    return $x
}
function RoundPath($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}
function GradBrush($sz) {
    $rc = New-Object System.Drawing.Rectangle 0, 0, $sz, $sz
    New-Object System.Drawing.Drawing2D.LinearGradientBrush($rc, ([System.Drawing.Color]::FromArgb(255, 0x57, 0xbd, 0x5b)), ([System.Drawing.Color]::FromArgb(255, 0x17, 0x47, 0x1f)), 45.0)
}
function SaveAny($size, $out) {
    $b = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $x = HQ $b
    $p = RoundPath 0 0 $size $size ([int][math]::Round($size * $RAD))
    $x.SetClip($p); $x.DrawImage($tile, 0, 0, $size, $size); $x.Dispose(); $p.Dispose()
    $b.Save((Join-Path $root $out), [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
    Write-Host "OK  $out ($size any)"
}
function SaveOpaque($size, $out) {
    $b = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $x = HQ $b
    $gb = GradBrush $size; $x.FillRectangle($gb, 0, 0, $size, $size); $gb.Dispose()
    $p = RoundPath 0 0 $size $size ([int][math]::Round($size * $RAD))
    $x.SetClip($p); $x.DrawImage($tile, 0, 0, $size, $size); $x.Dispose(); $p.Dispose()
    $b.Save((Join-Path $root $out), [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
    Write-Host "OK  $out ($size opaque)"
}
function SaveMaskable($size, $out) {
    $b = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $x = HQ $b
    $gb = GradBrush $size; $x.FillRectangle($gb, 0, 0, $size, $size); $gb.Dispose()
    $scale = 0.84; $s = [int][math]::Round($size * $scale); $off = [int][math]::Round(($size - $s) / 2)
    $p = RoundPath $off $off $s $s ([int][math]::Round($s * $RAD))
    $x.SetClip($p); $x.DrawImage($tile, $off, $off, $s, $s); $x.Dispose(); $p.Dispose()
    $b.Save((Join-Path $root $out), [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
    Write-Host "OK  $out ($size maskable)"
}

foreach ($s in 192, 384, 512, 1024) { SaveAny $s "icon-$s.png" }
foreach ($s in 192, 384, 512, 1024) { SaveMaskable $s "icon-maskable-$s.png" }
SaveOpaque 1024 'icon-master.png'
SaveOpaque 180 'apple-touch-icon.png'
SaveAny 32 'favicon-32.png'
SaveAny 16 'favicon-16.png'

# ---- favicon.svg: wrapper con PNG 96px embedded ----
$fav = New-Object System.Drawing.Bitmap 96, 96, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$x = HQ $fav
$p = RoundPath 0 0 96 96 ([int][math]::Round(96 * $RAD)); $x.SetClip($p)
$x.DrawImage($tile, 0, 0, 96, 96); $x.Dispose(); $p.Dispose()
$ms = New-Object System.IO.MemoryStream
$fav.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$b64 = [System.Convert]::ToBase64String($ms.ToArray()); $ms.Dispose(); $fav.Dispose()
$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="JointTracker"><image href="data:image/png;base64,' + $b64 + '" width="96" height="96"/></svg>'
[System.IO.File]::WriteAllText((Join-Path $root 'favicon.svg'), $svg)
Write-Host "OK  favicon.svg"

# ---- og-image.png: nuova tile sopra la vecchia (testo Sora invariato) ----
$ogPath = Join-Path $root 'og-image.png'
if (Test-Path $ogPath) {
    $og = [System.Drawing.Bitmap]::FromFile($ogPath)
    $ic = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'icon-512.png'))
    $x = HQ $og
    $x.DrawImage($ic, 95, 164, 302, 302)  # bbox della vecchia tile nell'og
    $x.Dispose()
    $tmp = Join-Path $root 'og-image.tmp.png'
    $og.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $og.Dispose(); $ic.Dispose()
    Move-Item -Force $tmp $ogPath
    Write-Host "OK  og-image.png (tile ricomposta)"
}

$tile.Dispose()
Write-Host ""
Write-Host "Fatto. Lancia generate-pwa-assets.ps1 per rigenerare gli splash iOS da icon-master.png."
