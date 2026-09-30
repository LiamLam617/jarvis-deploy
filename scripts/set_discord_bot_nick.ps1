Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$storePath = Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Jarvis') 'discord-bot-token.xml'
if (-not (Test-Path -LiteralPath $storePath)) { throw 'Bot Token credential not found.' }
$secureToken = Import-Clixml -LiteralPath $storePath
if ($secureToken -isnot [securestring]) { throw 'Invalid Bot Token credential format.' }
$env:DISCORD_BOT_TOKEN = [System.Net.NetworkCredential]::new('', $secureToken).Password
try {
  & node (Join-Path $PSScriptRoot 'set_discord_bot_nick.mjs')
  if ($LASTEXITCODE -ne 0) { throw "Discord nickname operation failed (exit $LASTEXITCODE)." }
} finally {
  Remove-Item Env:DISCORD_BOT_TOKEN -ErrorAction SilentlyContinue
}
