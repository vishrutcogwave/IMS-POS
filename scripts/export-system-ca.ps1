param([Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference = 'Stop'
$certificates = @(Get-ChildItem Cert:\CurrentUser\Root) + @(Get-ChildItem Cert:\LocalMachine\Root)
$pem = ($certificates | Sort-Object Thumbprint -Unique | ForEach-Object {
  "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($_.RawData, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----"
}) -join "`n"
[IO.File]::WriteAllText($OutputFile, $pem, [Text.Encoding]::ASCII)
Write-Output 'Exported public system-trusted root certificates; no trust settings were changed.'
