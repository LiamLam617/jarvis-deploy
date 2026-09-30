Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$storePath = Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Jarvis') 'discord-bot-token.xml'
if (-not (Test-Path -LiteralPath $storePath)) { throw 'Bot credential not found.' }
$secureToken = Import-Clixml -LiteralPath $storePath
if ($secureToken -isnot [securestring]) { throw 'Invalid bot credential format.' }
$env:DISCORD_BOT_TOKEN = [System.Net.NetworkCredential]::new('', $secureToken).Password
try {
  & node (Join-Path $PSScriptRoot 'audit_discord_bot_access.mjs')
  if ($LASTEXITCODE -ne 0) { throw "Discord access audit failed (exit $LASTEXITCODE)." }
} finally {
  Remove-Item Env:DISCORD_BOT_TOKEN -ErrorAction SilentlyContinue
}
