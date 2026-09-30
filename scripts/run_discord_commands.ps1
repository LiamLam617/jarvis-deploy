param([switch] $Apply)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$storePath = Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Jarvis') 'discord-bot-token.xml'
if (-not (Test-Path -LiteralPath $storePath)) {
  throw "Bot Token not found. Run scripts/save_discord_bot_token.ps1 first: $storePath"
}

$secureToken = Import-Clixml -LiteralPath $storePath
if ($secureToken -isnot [securestring]) { throw 'Invalid Bot Token credential format.' }

$env:DISCORD_APPLICATION_ID = '1511992826815053844'
$env:DISCORD_GUILD_ID = '1488116208426287247'
$env:DISCORD_BOT_TOKEN = [System.Net.NetworkCredential]::new('', $secureToken).Password
try {
  $scriptPath = Join-Path $PSScriptRoot 'register_discord_commands.mjs'
  if ($Apply) {
    & node $scriptPath --apply
  } else {
    & node $scriptPath
  }
  if ($LASTEXITCODE -ne 0) { throw "Discord command operation failed (exit $LASTEXITCODE)." }
} finally {
  Remove-Item Env:DISCORD_BOT_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:DISCORD_APPLICATION_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DISCORD_GUILD_ID -ErrorAction SilentlyContinue
}
