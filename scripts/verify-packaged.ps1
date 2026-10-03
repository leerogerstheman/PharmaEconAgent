param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Question = 'ICER',
  [string]$Shot = 'D:\PharmaEconAgent\shots\98-packaged-e2e.png'
)
# ASCII-only on purpose: Windows PowerShell 5.1 parses .ps1 as ANSI (GBK on zh-CN),
# so CJK literals in this file get mangled. Pass the CJK exe path from outside.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class U32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(150);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
  }
}
'@

$procName = [System.IO.Path]::GetFileNameWithoutExtension($Exe)
Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Output "launching: $Exe"
Start-Process -FilePath $Exe -PassThru | Out-Null

$win = $null
$deadline = (Get-Date).AddSeconds(120)
while (-not $win -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $win = Get-Process -Name $procName -ErrorAction SilentlyContinue |
         Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}
if (-not $win) { Write-Output 'RESULT: window never appeared (FAIL)'; exit 1 }
Write-Output "RESULT: window shown OK (pid $($win.Id))"
Start-Sleep -Seconds 4

[U32]::ShowWindow($win.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
[U32]::SetForegroundWindow($win.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 1
$r = New-Object U32+RECT
[U32]::GetWindowRect($win.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
Write-Output "window rect: $($r.Left),$($r.Top) ${w}x${h}"

# Click the input box (coords derived from the live window rect so multi-monitor
# placement does not matter), type, then submit with Enter. Clicking the Send
# button is avoided on purpose: its exact offset is the one thing that varies
# with window chrome, whereas Enter exercises the same code path.
$inputX = $r.Left + [int]($w * 0.40)
$inputY = $r.Bottom - 60

[U32]::Click($inputX, $inputY)
Start-Sleep -Milliseconds 800
$ws = New-Object -ComObject WScript.Shell
$ws.SendKeys($Question)
Start-Sleep -Milliseconds 1200
$ws.SendKeys('{ENTER}')
Start-Sleep -Seconds 12

[U32]::SetForegroundWindow($win.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Write-Output "screenshot: $Shot"
Write-Output "RESULT: OK"
