<#
 local-ocr-kit - Windows enhanced runtime. One file, no install, no admin.

 Modes:
   winocr.ps1                          serve the app at http://localhost:8137
                                       (UI from index.html next to this file, OCR via Windows.Media.Ocr)
   winocr.ps1 -Image page.png -OutFile text.txt    OCR a single image to a UTF-8 text file (CLI mode)

 Requires Windows 10/11 with at least one OCR-capable language pack (preinstalled on stock systems).
#>
param(
  [int]$Port = 8137,
  [string]$Image = "",
  [string]$OutFile = "",
  [string]$Lang = "",
  [switch]$OpenBrowser
)
$ErrorActionPreference = "Stop"

# --- WinRT bootstrap -----------------------------------------------------
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]

$AsTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, $type) {
  $task = $AsTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

function Get-OcrEngine([string]$lang) {
  $e = $null
  if ($lang) {
    $l = New-Object Windows.Globalization.Language($lang)
    $e = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l)
  } else {
    $e = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if (-not $e) { throw "No OCR language pack available (requested: '$lang')." }
  return $e
}

function Invoke-Ocr([byte[]]$bytes, [string]$lang) {
  $mem = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $writer = New-Object Windows.Storage.Streams.DataWriter($mem.GetOutputStreamAt(0))
  $writer.WriteBytes($bytes)
  $null = Await $writer.StoreAsync() ([UInt32])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($mem)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await $decoder.GetSoftwareBitmapAsync() ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = Get-OcrEngine $lang
  $res = Await $engine.RecognizeAsync($bmp) ([Windows.Media.Ocr.OcrResult])
  return (($res.Lines | ForEach-Object { $_.Text }) -join "`n")
}

# --- CLI mode ------------------------------------------------------------
if ($Image) {
  $text = Invoke-Ocr ([System.IO.File]::ReadAllBytes($Image)) $Lang
  if ($OutFile) {
    [System.IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "OCR text written to $OutFile"
  } else {
    # Console codepages mangle non-ASCII; prefer -OutFile for CJK content.
    Write-Output $text
  }
  exit 0
}

# --- Server mode ---------------------------------------------------------
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ui = @("$root\index.html", "$root\..\index.html") | Where-Object { Test-Path $_ } | Select-Object -First 1

function Send-Bytes($resp, [byte[]]$bytes, [string]$ctype, [int]$code = 200) {
  $resp.StatusCode = $code
  $resp.Headers.Add("Access-Control-Allow-Origin", "*")
  $resp.ContentType = $ctype
  $resp.ContentLength64 = $bytes.Length
  $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  $resp.OutputStream.Close()
}
function Send-Json($resp, [string]$json, [int]$code = 200) {
  Send-Bytes $resp ([System.Text.Encoding]::UTF8.GetBytes($json)) "application/json; charset=utf-8" $code
}

$staticRoot = if ($ui) { Split-Path -Parent $ui } else { $root }
$ctypes = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"; ".json"="application/json; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".md"="text/plain; charset=utf-8"; ".png"="image/png"; ".svg"="image/svg+xml" }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "local-ocr-kit running at http://localhost:$Port/  (Ctrl+C to stop)"
if ($OpenBrowser) { Start-Process "http://localhost:$Port/" }
if (-not $ui) { Write-Host "WARNING: index.html not found next to this script - only the /ocr API will work." }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $resp = $ctx.Response
  try {
    $path = $req.Url.AbsolutePath
    if ($req.HttpMethod -eq 'GET' -and $path -eq '/') {
      if ($ui) { Send-Bytes $resp ([System.IO.File]::ReadAllBytes($ui)) "text/html; charset=utf-8" }
      else { Send-Json $resp '{"error":"index.html not found"}' 404 }
    }
    elseif ($path -eq '/ping') {
      Send-Json $resp '{"ok":true,"engine":"windows"}'
    }
    elseif ($req.HttpMethod -eq 'OPTIONS') {
      $resp.Headers.Add("Access-Control-Allow-Origin", "*")
      $resp.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      $resp.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
      $resp.StatusCode = 204
      $resp.OutputStream.Close()
    }
    elseif ($req.HttpMethod -eq 'POST' -and $path -eq '/ocr') {
      $ms = New-Object System.IO.MemoryStream
      $req.InputStream.CopyTo($ms)
      $text = Invoke-Ocr $ms.ToArray() $req.QueryString['lang']
      Send-Json $resp (@{ text = $text } | ConvertTo-Json -Compress)
    }
    elseif ($req.HttpMethod -eq 'GET' -and $path -match '^/[A-Za-z0-9._/-]+$' -and $path -notmatch '\.\.') {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      $file = Join-Path $staticRoot ($path.TrimStart('/') -replace '/', '\')
      if ($ctypes.ContainsKey($ext) -and (Test-Path $file)) {
        Send-Bytes $resp ([System.IO.File]::ReadAllBytes($file)) $ctypes[$ext]
      } else {
        Send-Json $resp '{"error":"not found"}' 404
      }
    }
    else {
      Send-Json $resp '{"error":"not found"}' 404
    }
  } catch {
    try { Send-Json $resp (@{ error = $_.Exception.Message } | ConvertTo-Json -Compress) 500 } catch {}
  }
}
