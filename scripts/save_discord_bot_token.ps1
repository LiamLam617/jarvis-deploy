# Run interactively as the Windows user who will register Discord commands.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$storeDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Jarvis'
$storePath = Join-Path $storeDirectory 'discord-bot-token.xml'
New-Item -ItemType Directory -Path $storeDirectory -Force | Out-Null

$token = Read-Host 'Enter the existing Hermes Bot Token (hidden input)' -AsSecureString
if ($token.Length -eq 0) { throw 'Bot Token cannot be empty.' }
$token | Export-Clixml -LiteralPath $storePath -Force
Write-Host "Bot Token saved with Windows user DPAPI encryption to $storePath"
