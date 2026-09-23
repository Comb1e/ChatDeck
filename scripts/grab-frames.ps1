# 形态换形验证:屏幕区域连拍(CopyFromScreen 逐帧抓屏)。
# 透明窗口 + WebContentsView 不吃 CDP screencast(采样时机/缩放假象),截图验证必须走屏幕抓取。
# 配合 CHATDECK_WHALE_PINNED=1(鲸鱼钉住不游动)使用,区域即可复现。
# 用法: powershell -File grab-frames.ps1 -X 431 -Y 808 -W 684 -H 844 -OutDir out -Duration 2500
#       [-IntervalMs 20] [-Format bmp|png]   帧文件 f0000.bmp...,帧坐标=屏幕坐标-(X,Y)
param(
  [int]$X, [int]$Y, [int]$W, [int]$H,
  [Parameter(Mandatory)][string]$OutDir,
  [int]$Duration = 2500,
  [int]$IntervalMs = 20,
  [ValidateSet('bmp', 'png')][string]$Format = 'bmp'
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$fmt = if ($Format -eq 'png') { [System.Drawing.Imaging.ImageFormat]::Png } else { [System.Drawing.Imaging.ImageFormat]::Bmp }
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$i = 0
while ($sw.ElapsedMilliseconds -lt $Duration) {
  $g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
  $bmp.Save(('{0}\f{1:d4}.{2}' -f $OutDir, $i, $Format), $fmt)
  $i++
  Start-Sleep -Milliseconds $IntervalMs
}
$g.Dispose(); $bmp.Dispose()
$fps = [math]::Round($i / ($sw.ElapsedMilliseconds / 1000), 1)
Write-Output "frames=$i fps=$fps outdir=$OutDir origin=($X,$Y)"
