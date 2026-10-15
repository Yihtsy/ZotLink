param([string]$Folder)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Notify([string]$Text) {
    [System.Windows.Forms.MessageBox]::Show($Text, 'ZotLink') | Out-Null
}
try {
    $base = Join-Path $env:LOCALAPPDATA 'ZotLink\windows-menu'
    $configPath = Join-Path $base 'root.json'
    if (Test-Path -LiteralPath $configPath) {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.root) {
            $rootPath = [IO.Path]::GetFullPath($config.root).TrimEnd('\', '/')
            $folderPath = [IO.Path]::GetFullPath($Folder).TrimEnd('\', '/')
            $inside = $folderPath.Equals($rootPath, [StringComparison]::OrdinalIgnoreCase) -or
                $folderPath.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)
            if (-not $inside) {
                Notify '该文件夹不在 ZotLink 设置的附件顶层目录内，请检查路径或顶层目录设置。'
                exit
            }
        }
    }
    if (-not (Get-Process zotero -ErrorAction SilentlyContinue)) {
        Notify 'Zotero 尚未开启，请先启动 Zotero 再重试。'
        exit
    }
    $id = [Guid]::NewGuid().ToString('N')
    $request = Join-Path $base ($id + '.request.json')
    $response = Join-Path $base ($id + '.response.json')
    $temporary = Join-Path $base ($id + '.tmp')
    @{ path = $Folder; createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $request
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $response) {
            $result = Get-Content -LiteralPath $response -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not $result.ok) { Notify $result.message }
            exit
        }
        Start-Sleep -Milliseconds 250
    }
    Notify 'ZotLink 未响应，请确认插件已启用并等待 Zotero 完成启动后重试。'
} catch {
    Notify $_.Exception.Message
} finally {
    foreach ($file in @($request, $response, $temporary)) {
        if ($file -and (Test-Path -LiteralPath $file)) {
            Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
        }
    }
}
