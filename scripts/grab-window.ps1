$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WEnum {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  delegate bool EnumProc(IntPtr h, IntPtr p);
  public static List<string> List() {
    var res = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(300); GetWindowText(h, sb, 300);
      uint pid; GetWindowThreadProcessId(h, out pid);
      R r; GetWindowRect(h, out r);
      if (sb.Length > 0) res.Add(pid + "|" + sb + "|" + r.L + "," + r.T + "," + (r.Rt - r.L) + "x" + (r.B - r.T));
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
'@

$procName = [System.IO.Path]::GetFileNameWithoutExtension((Get-ChildItem 'D:\*\*.exe' | Where-Object { $_.Length -gt 50MB } | Select-Object -First 1).FullName)
$pids = @((Get-Process -Name $procName -ErrorAction SilentlyContinue).Id)
Write-Output ("app pids: " + ($pids -join ','))
Write-Output "=== visible windows ==="
$all = [WEnum]::List()
foreach ($line in $all) {
  $pid0 = [int]($line -split '\|')[0]
  if ($pids -contains $pid0) { Write-Output ("  APP   " + $line) }
}
Write-Output "=== screens ==="
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { Write-Output ("  " + $_.DeviceName + " primary=" + $_.Primary + " bounds=" + $_.Bounds) }

# Grab the app window specifically by rect
$appLine = $all | Where-Object { $p = [int]($_ -split '\|')[0]; $pids -contains $p } | Select-Object -First 1
if ($appLine) {
  $parts = $appLine -split '\|'
  $g = $parts[2] -split ','
  $x = [int]$g[0]; $y = [int]$g[1]
  $wh = $g[2] -split 'x'
  $w = [int]$wh[0]; $h = [int]$wh[1]
  $stamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $out = "D:\PharmaEconAgent\shots\packaged-$stamp.png"
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $gr.Dispose(); $bmp.Dispose()
  Write-Output "=== window-only screenshot ==="
  Write-Output ("  " + $out + "  " + $w + "x" + $h)
}
