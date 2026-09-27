# Discord Hermes Jarvis MVP Runbook

版本：1.0  
適用範圍：Discord 作為入口的私人 Hermes Jarvis MVP  
維護狀態：部署前請先填寫本文件的 Deployment Inventory

## 0. 目的與使用方式

本 Runbook 用於從零建立、驗證、維護與故障排除 Discord Hermes Jarvis MVP。

本方案採用控制平面與執行平面分離：

```text
Discord
   ↓
Discord Bot API / Event ingress
   ↓
Cloudflare Worker（驗證、權限、去重、快速 ACK）
   ↓
Modal HTTP Function（短生命週期 Hermes invocation）
   ↓
Hermes Agent Runtime
   ├── GitHub Private Wiki
   ├── Persistent Storage
   ├── Modal Sandbox（短任務）
   └── Daytona（Coding Sandbox，第二階段）
```

重要原則：

- Cloudflare Worker 只處理 ingress，不執行長時間 Hermes Agent Loop。
- Modal Runtime 以請求驅動、scale-to-zero 為預設，不假設它是永遠在線的 VPS。
- GitHub Private Repository 保存可讀、可版本控制的 Wiki 與設定範本。
- Persistent Storage 保存 `state.db`、`MEMORY.md`、`USER.md` 等執行狀態。
- 所有 Secret 只能放在 Secret Manager、Modal Secrets、Cloudflare Secrets 或 GitHub Actions Secrets。
- 任何刪除、部署 Production、Merge、花費金錢或暴露 Secret 的操作，都必須先取得明確確認。

### 0.1 運作模式

| 模式 | 入口 | Runtime | 適用情境 | 是否需要常駐資源 |
|---|---|---|---|---|
| MVP Cloud | Discord → Worker → Modal | Modal HTTP Function | 日常互動、Strict-$0 | 否，可能有 cold start |
| Strict-$0 Schedule | GitHub Actions → Hermes → Discord | GitHub Actions | Daily Insight、Weekly Report、Wiki 維護 | 否 |
| Hermes Native | Discord → Hermes Gateway | NAS、VPS 或本機 | Cron、Kanban、Heartbeat、Persistent Agent | 是 |

本 Runbook 的必要路徑是 Discord；Telegram 僅列為未來擴充，不是 MVP 依賴。

## 1. Deployment Inventory

部署前完成以下表格。不要把 Token、API Key 或 Secret 寫入此文件。

| 項目 | 值 | 狀態 |
|---|---|---|
| Discord Server 名稱 / ID | `Liam 的伺服器` | ☐ |
| Discord Application ID | `________________` | ☐ |
| Discord Bot 名稱 | `Jarvis` | ☐ |
| Discord Bot Token 存放位置 | `________________` | ☐ |
| Discord Owner User ID | `249763790709719040` | ☐ |
| Discord 頻道清單 | 見第 3 節 | ☐ |
| Cloudflare Account / Worker | `________________` | ☐ |
| Discord Interactions Endpoint | `________________` | ☐ |
| Cloudflare Webhook Secret 存放位置 | `________________` | ☐ |
| Modal Workspace / App | `________________` | ☐ |
| Modal Secrets 名稱 | `________________` | ☐ |
| Hermes Provider / Model | `________________` | ☐ |
| GitHub Wiki Repository | `________________` | ☐ |
| GitHub Branch | `main` | ☐ |
| Persistent Volume 名稱 | `________________` | ☐ |
| Daytona Workspace / API Key | 第二階段 | ☐ |
| 成本模式 | Strict-$0 / Native | ☐ |
| 維運負責人 | `________________` | ☐ |
| 最後驗證日期 | `________________` | ☐ |

## 2. 元件配置與健康檢查

| 元件 | 部署位置 | 主要責任 | 常駐 | 健康檢查 | 失效替代方案 |
|---|---|---|---|---|---|
| Discord Bot | Discord Cloud | 訊息、頻道與權限 | 否 | Bot Online、測試訊息 | 使用 Native Gateway 或暫停入口 |
| Cloudflare Worker | Cloudflare | 驗證、allowlist、dedup、快速 ACK | 否 | Worker logs、health endpoint | 暫時改用 Native Gateway |
| Hermes Runtime | Modal | Agent 推理、工具與記憶 | 否 | invocation log、測試回覆 | 本機 / NAS / VPS Gateway |
| GitHub Wiki | GitHub Private Repo | Markdown 知識庫與版本控制 | 儲存服務 | `git fetch`、受保護分支 | 使用本地唯讀備份 |
| Persistent Storage | Modal Volume 或等價儲存 | `state.db`、memory、session | 是 | Volume mount、SQLite 檢查 | 進入唯讀模式，禁止覆蓋狀態 |
| Modal Sandbox | Modal | 短批次、研究與 burst job | 否 | Job status、timeout | 本機 Docker |
| Daytona | Daytona | Clone、Build、Test、Debug | 否 | Sandbox status、測試結果 | Modal Sandbox 或本機 Docker |

## 3. Discord Bot 建立與設定

### 3.1 建立 Application 與 Bot

1. 開啟 [Discord Developer Portal](https://discord.com/developers/applications)。
2. 建立 Application，名稱設定為 `Jarvis`。
3. 在 Bot 頁面建立 Bot。
4. 產生並安全保存 Bot Token。Token 不得提交 Git、貼到聊天或寫入 Runbook。
5. 在 Bot → Privileged Gateway Intents 開啟：
   - Message Content Intent
   - Server Members Intent（只有需要成員查詢時才開啟）
6. 記錄 Application ID。

### 3.2 建立頻道

在私人 Server 建立：

```text
#jarvis          一般對話
#inbox           想法與連結收集
#research        研究任務
#coding          程式開發
#review          審查與結果
#daily-insight   每日摘要
#agent-log       Agent 執行紀錄
```

MVP 初期只開放 `#jarvis` 與 `#inbox`，完成驗收後再開放其他頻道。

開啟 Discord Developer Mode 後，複製並記錄：

- 自己的 User ID
- Server ID
- 上述各頻道的 Channel ID

### 3.3 邀請 Bot

在 OAuth2 / Installation 設定：

- Scopes：`bot`、`applications.commands`
- 最小權限：View Channels、Send Messages、Read Message History
- 建議權限：Embed Links、Attach Files、Send Messages in Threads、Add Reactions

邀請後確認 Bot 出現在 Server 成員清單中。Bot 尚未啟動時顯示 Offline 是正常的。

### 3.4 權限與 Allowlist

MVP 僅允許單一 Discord User ID。不要只依賴頻道權限，Runtime 仍必須執行 User ID allowlist。

```env
DISCORD_BOT_TOKEN=<存放於 Secret Manager>
DISCORD_ALLOWED_USERS=<你的 Discord User ID>
```

驗收：

- 允許使用者可以取得回覆。
- 未授權使用者被拒絕或忽略。
- Log 不包含完整 Token。

## 4. Cloudflare Worker

### 4.1 職責與邊界

Worker 只做以下工作：

1. 接收 Discord Event 或 Interaction。
2. 驗證 Discord 簽章與請求時間戳。
3. 執行 Server、Channel、User allowlist。
4. 以 Event ID 做 deduplication，避免重複執行。
5. 在 Discord 要求的時間內快速 ACK。
6. 將已驗證的任務交給 Modal Runtime。

Worker 不得：

- 執行長時間 Hermes loop。
- 保存明文 Bot Token 或 Model API Key。
- 直接寫入 Wiki 或 `state.db`。
- 以未驗證的 Discord payload 觸發 Modal。

### 4.2 初始化與 Secret

依團隊採用的 Cloudflare Wrangler 流程建立 Worker。部署前準備：

```text
DISCORD_APPLICATION_ID
DISCORD_PUBLIC_KEY
DISCORD_SERVER_ID
DISCORD_ALLOWED_USER_ID
MODAL_FUNCTION_URL
DISCORD_WEBHOOK_SECRET
```

其中 Token 與 Secret 使用 Cloudflare Secret，不放入公開環境變數或 `wrangler.toml`。

### 4.3 Event Handler 合約

Worker 與 Modal 之間使用最小 payload，避免把不必要的 Discord metadata 傳入 Runtime：

```json
{
  "event_id": "discord-event-id",
  "user_id": "discord-user-id",
  "server_id": "discord-server-id",
  "channel_id": "discord-channel-id",
  "message_id": "discord-message-id",
  "content": "使用者訊息",
  "received_at": "2026-08-09T00:00:00Z"
}
```

Modal 端必須再次驗證內部 webhook secret；不要把 Worker 的 allowlist 視為唯一安全邊界。

### 4.4 部署與驗收

1. 在非 Production Worker 建立測試環境。
2. 設定 Cloudflare Secrets。
3. 發布 Worker。
4. 在 Discord Developer Portal 設定 Interactions Endpoint URL。
5. 完成 Discord 的 endpoint verification challenge。
6. 從 Discord 傳送測試訊息。
7. 透過 Cloudflare logs 確認：驗證成功、allowlist 通過、dedup key 建立、Modal 被觸發。
8. 重送相同 Event ID，確認不會重複執行。

預期結果：Worker 能快速回應 Discord，長時間推理由 Modal / Hermes 完成。

## 5. Hermes Runtime（Modal MVP）

### 5.1 前置條件

- Modal 帳號與 Workspace。
- Hermes 安裝來源與固定版本。
- 已設定 Model Provider。
- Modal Secret 已建立。
- GitHub Wiki Repository 已建立。
- Persistent Volume 已建立並可掛載。

Hermes 官方文件：

- [Quickstart](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/quickstart.md)
- [Discord 設定](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/discord.md)
- [CLI 指令](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md)

### 5.2 安裝與 Provider

Linux / Modal Image 中執行官方安裝流程：

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes --version
hermes setup
```

若採用 Nous Portal：

```bash
hermes setup --portal
```

先完成一次普通對話，再接入 Discord、Cron、Sandbox 或多代理功能。Provider API Key 只能由 Modal Secret 注入。

### 5.3 Hermes Home 與環境變數

Persistent Volume 中建立 Hermes Home，至少包含：

```text
SOUL.md
USER.md
MEMORY.md
config.yaml
state.db
```

環境變數範本：

```env
DISCORD_BOT_TOKEN=<Modal Secret>
DISCORD_ALLOWED_USERS=<Discord User ID>
WIKI_PATH=/workspace/wiki
OPENROUTER_API_KEY=<若使用 OpenRouter，從 Modal Secret 注入>
```

不要在 GitHub Wiki 保存 `.env`、Token 或 API Key。

### 5.4 建議 `config.yaml`

第一階段可使用以下安全預設，再依實際 Hermes 版本調整鍵名：

```yaml
checkpoints:
  enabled: true
  max_snapshots: 20
  max_total_size_mb: 500
  auto_prune: true

delegation:
  max_concurrent_children: 3
  max_spawn_depth: 1

gateway:
  message_timestamps:
    enabled: true
```

若啟用 Daytona 或 Modal terminal backend，必須先完成單獨的 Sandbox 驗收，不要在首次部署同時開啟所有工具。

### 5.5 Modal Function 邊界

Modal Function 必須具備：

- 固定 Hermes 版本。
- 最小必要 Python / system dependencies。
- Persistent Volume mount。
- Modal Secrets mount。
- 明確 timeout、memory 與 concurrency 上限。
- correlation ID 與結構化 log。
- 可重試但不重複寫入的處理邏輯。

Invocation 流程：

```text
收到已驗證 payload
  ↓
載入 Hermes Home、Wiki 與 session state
  ↓
執行 Hermes Agent
  ↓
更新 Wiki / state.db
  ↓
回覆 Discord
  ↓
記錄成功或失敗狀態
```

Wiki commit 與 state 更新必須考慮 concurrency；同一時間只允許一個寫入者，或使用鎖與可重試策略避免覆蓋資料。

### 5.6 Cold Start 驗收

首次請求記錄：

- cold start 時間
- Hermes 啟動時間
- Provider 首次回應時間
- 完整 Discord 回覆時間
- timeout 與重試次數

如果冷啟動超出 Discord interaction 回應期限，不要讓 Worker 等待完整 Agent 結果；改用 deferred response，再由 Modal 完成後續回覆。

## 6. Hermes Native Gateway（替代部署）

Native Gateway 適合 NAS、VPS 或開發機，不是 Strict-$0 的必要元件。

前景測試：

```bash
hermes gateway run
```

服務模式依作業系統與 Hermes 版本使用：

```bash
hermes gateway install
hermes gateway start
hermes gateway status
hermes gateway restart
```

Native Mode 適合：

- Hermes Cron。
- Kanban Dispatcher。
- Heartbeat。
- Persistent Agent。
- 需要低延遲與長時間 Session 的工作。

如果沒有 NAS、VPS 或其他免費常駐資源，不要為了等待 Discord 訊息而讓整套 Hermes 24 小時運行；改用 Modal invocation 與 GitHub Actions。

## 7. GitHub Wiki 與 Persistent Storage

### 7.1 建立 Wiki Repository

建立 GitHub Private Repository，例如 `jarvis-wiki`，在本機或部署環境初始化：

```bash
mkdir -p wiki/{raw,concepts,entities,ideas,projects}
touch wiki/SCHEMA.md wiki/index.md wiki/log.md
git init
git remote add origin <PRIVATE_REPOSITORY_URL>
git add wiki
git commit -m "Initialize Jarvis wiki"
git branch -M main
git push -u origin main
```

建議結構：

```text
wiki/
├── SCHEMA.md
├── index.md
├── log.md
├── raw/
├── concepts/
├── entities/
├── ideas/
└── projects/
```

### 7.2 資料責任邊界

GitHub 保存：

```text
wiki/
SOUL.md
AGENTS.md
skills/
projects/
```

Persistent Storage 保存：

```text
MEMORY.md
USER.md
state.db
```

`.gitignore` 至少包含：

```gitignore
.env
*.key
*.pem
secrets/
state.db
__pycache__/
.venv/
```

### 7.3 備份與還原

備份前先確認沒有正在執行的寫入工作：

```bash
git status --short
git add wiki SOUL.md AGENTS.md
git commit -m "backup: Jarvis knowledge state"
git push
```

還原前：

1. 停止會寫入 Wiki 的 Worker / Job。
2. 建立當前 Volume 與 Repository 備份。
3. 從指定 commit 或 tag 還原。
4. 執行 Wiki integrity check。
5. 重新啟動 Runtime。
6. 執行第 11 節驗收。

禁止使用未確認目標的遞迴刪除或覆蓋指令。

## 8. Jarvis 行為與 Wiki 設定

### 8.1 `SOUL.md`

```markdown
# Jarvis

You are my private AI assistant.

## Language

Always respond in Traditional Chinese unless the task requires another language.

## Behavior

- Be proactive but conservative with side effects.
- Prefer primary sources for research.
- Preserve source URL, title, author, and capture time.
- Ask before deleting data, deploying production, merging, or spending money.
- Never expose secrets.

## Discord routing

- #jarvis: general assistant
- #inbox: capture ideas and URLs
- #research: research and synthesis
- #coding: software engineering
- #review: review reports and approvals
- #daily-insight: scheduled summaries
- #agent-log: operational events only

## URL capture

When a message contains a URL and asks for整理,研究,摘要, or收進 Wiki:

1. Preserve the raw URL and capture timestamp.
2. Extract the source.
3. Search the existing Wiki before creating a duplicate.
4. Separate source claims, agent inference, and user opinion.
5. Store the result in the appropriate Wiki directory.
6. Reply with a concise summary and the created or updated path.

## Coding safety

Before changing a repository:

1. Read AGENTS.md.
2. Create a branch or worktree.
3. Ensure checkpoints are enabled.
4. Run tests after modifications.
5. Report the diff and test result before any deployment.
```

### 8.2 `USER.md` 與 `MEMORY.md`

`USER.md` 保存穩定的使用者偏好，例如：

```markdown
# User Preferences

- Preferred language: Traditional Chinese
- Prefer concise status updates
- Ask before destructive or external side effects
- Coding work should include a plan and test result
```

`MEMORY.md` 保存穩定環境事實，例如：

```markdown
# Jarvis Memory

- Canonical Wiki: private GitHub repository
- Runtime mode: Modal invocation for MVP
- Coding sandbox: Daytona in phase two
- Main Discord channel: #jarvis
```

不要把大型文章或完整聊天記錄塞入 `MEMORY.md`；完整 Session History 應由 `state.db` 保存，知識文章應進 Wiki。

### 8.3 Wiki `AGENTS.md`

```markdown
# Jarvis Wiki Instructions

Every external source must retain:

- source_url
- captured_at
- title
- author or publisher when known
- published_at when known
- source_type

New unstructured notes go to inbox/.
Promote mature material into ideas/, projects/, entities/, or concepts/.

Before creating a page:

1. Search filenames and existing content.
2. Read SCHEMA.md and index.md.
3. Prefer updating an existing page over creating duplicates.

Separate source claims, agent inference, and user opinion.
Never make an inference appear to be a source claim.
```

## 9. Sandbox 與 Coding Workflow（第二階段）

### 9.1 用途分工

| 工具 | 用途 | 不負責 |
|---|---|---|
| Daytona | Clone、Build、Test、Debug、持續 workspace | 不作 Discord ingress |
| Modal Sandbox | 短任務、Batch、Research burst | 不假設長期保存工作區 |
| Docker | 本機開發與隔離測試 | 不作 Production 高可用保證 |

### 9.2 固定 Coding 流程

```text
Requirement
  ↓
Research
  ↓
Plan
  ↓
Branch / Worktree
  ↓
Coding
  ↓
Test
  ↓
Review
  ↓
Report
```

執行規則：

- 每個任務使用獨立 Branch 或 Worktree。
- 開啟 Checkpoints，並限制快照大小與保留數量。
- 測試失敗不得回報為完成。
- 未經確認不得 Merge、Deploy Production 或刪除遠端資源。
- Agent Log 只記錄必要的狀態，不記錄 Secret。

## 10. 排程與通知

### 10.1 Strict-$0 Mode

以 GitHub Actions 執行 Daily Insight、Weekly Report 與 Wiki Maintenance。Secrets 使用 GitHub Actions Secrets：

```text
MODEL_PROVIDER_KEY
DISCORD_BOT_TOKEN
DISCORD_CHANNEL_ID
GITHUB_TOKEN 或專用 Deploy Key
```

Job 流程：

```text
GitHub Actions
  ↓
Checkout Wiki
  ↓
啟動 Hermes one-shot task
  ↓
更新 Wiki
  ↓
Commit / Push
  ↓
Discord Notification
```

排程 Job 必須具備：timeout、重試上限、失敗通知與避免重複 commit 的邏輯。

### 10.2 Hermes Native Mode

Native Gateway 可提供：

- Hermes Cron
- Kanban Dispatcher
- Persistent Agent
- Heartbeat 與長期任務

切換到 Native Mode 前，確認已經有 NAS、VPS 或其他明確的常駐資源，並設定服務重啟、Log rotation 與 Secret rotation。

## 11. 分階段部署與驗收

### Phase 0：Inventory

前置條件：能取得 Discord、Cloudflare、Modal 與 GitHub 帳號。

操作：完成第 1 節 Deployment Inventory。

驗收：每個必要元件都有 owner、部署位置、Secret 存放位置與回復方案。

### Phase 1：Discord

操作：完成 Bot、Intents、頻道、OAuth 權限與 allowlist。

驗收：Bot 可被邀請至 Server，且只有允許使用者能觸發測試指令。

### Phase 2：Worker

操作：部署測試 Worker、設定 Endpoint、完成 Discord verification、連接 Modal 測試 URL。

驗收：Worker 可驗證 payload、快速 ACK、拒絕未授權使用者、去重重送 Event。

### Phase 3：Hermes / Modal

操作：部署 Hermes Image、Secrets、Volume、Function 與 timeout。

驗收：Discord 執行：

```text
@Jarvis hello
```

預期收到繁體中文回覆，且 Log 可由 correlation ID 串起完整流程。

### Phase 4：Wiki / Memory

操作：建立 GitHub Wiki、掛載 Persistent Storage、加入 `SOUL.md`、`USER.md`、`MEMORY.md` 與 `AGENTS.md`。

驗收：傳送：

```text
https://example.com
請整理並存入 Wiki
```

預期：來源成功讀取、保留 provenance、建立或更新 Wiki Entry、回覆摘要與路徑。

### Phase 5：Research

操作：在 `#research` 執行研究任務。

```text
分析這個 side project 的市場、技術風險與 MVP 方案。
```

驗收：研究結果可回覆 Discord，並寫入指定 Wiki 目錄。

### Phase 6：Coding Sandbox

操作：先加入 Daytona，再加入 Modal Sandbox burst job。

驗收：能 Clone Repository、建立 Branch / Worktree、執行測試、回報 Review，且不直接修改 Production。

## 12. 故障排除

### 12.1 Discord Bot Offline

症狀：Bot 不在線或完全沒有回應。

檢查：

1. 確認 Hermes Gateway 或 Modal invocation 是否正在運作。
2. 確認 Bot Token 是否已更新且未過期。
3. 確認 Application 的 Intents 與 OAuth 權限。
4. 檢查 Worker 與 Modal logs。

處理：更新 Secret 後重新部署相關服務，再執行 `@Jarvis hello`。

### 12.2 User Not Allowed

症狀：Bot 在線，但不回覆本人或回覆拒絕訊息。

檢查：

```text
Discord User ID
Discord Server ID
Discord Channel ID
DISCORD_ALLOWED_USERS
```

處理：修正 allowlist，重新部署 Worker / Runtime，確認 Log 未洩露 Token。

### 12.3 Cloudflare Signature / Verification Failed

症狀：Discord Endpoint 驗證失敗或所有 Event 被拒絕。

檢查：

- Application Public Key 是否正確。
- Worker 是否使用原始 request body 驗證簽章。
- timestamp 是否被正確傳入驗證。
- Endpoint URL 是否指向目前環境。

處理：先在測試 Worker 修正與驗證，不要直接修改 Production Endpoint。

### 12.4 Modal Cold Start 或 Timeout

症狀：Worker 成功 ACK，但 Discord 沒有最終回覆。

檢查：

- Modal Function 是否成功啟動。
- Image 是否缺少 Hermes 或 system dependency。
- Volume 是否成功掛載。
- Provider 是否在 timeout 內回覆。
- Discord 是否需要 deferred response。

處理：提高合理 timeout、減少 Image 啟動內容、使用 deferred response；禁止以無限重試造成重複 Agent 任務。

### 12.5 Wiki Push 失敗

症狀：Agent 回覆成功，但 Wiki 沒有更新或 push 失敗。

檢查：

```bash
git status --short
git remote -v
git branch --show-current
git pull --rebase
```

處理：先保存本地變更，再處理權限、分支或衝突；不要用 force push 覆蓋未知資料。

### 12.6 Persistent Storage 無法掛載

症狀：`state.db`、`MEMORY.md` 或 `USER.md` 消失，或 Session 無法延續。

處理：

1. 停止新的寫入工作。
2. 檢查 Volume 名稱與 mount path。
3. 檢查檔案權限與磁碟容量。
4. 從最近一次備份還原到隔離位置。
5. 驗證 SQLite 與 Wiki 完整性後才重新上線。

### 12.7 Hermes Provider 無回應

檢查 Provider status、API Key、模型名稱、quota、timeout 與最近部署變更。短期可切換到已驗證的 fallback provider，但必須記錄成本與模型差異，不可默默改變 Production 行為。

### 12.8 Secret 遺失或疑似洩露

立即執行：

1. 停止相關 Runtime。
2. 旋轉 Discord Token、Provider Key、Webhook Secret 與 Deploy Key。
3. 搜尋 Git history、Worker logs、Modal logs、CI logs。
4. 移除誤提交內容並評估是否需要重寫歷史。
5. 重新部署並執行完整權限驗收。

不要把洩露的 Secret 貼回聊天或寫入 Issue。

## 13. 維運程序

### 13.1 更新 Hermes 或 Runtime

1. 記錄目前版本與部署 commit。
2. 備份 `state.db`、memory 與 Wiki。
3. 在測試環境更新 Image 或 Hermes 版本。
4. 執行基本聊天、URL capture、Research 與權限測試。
5. 確認成本與 timeout 沒有異常。
6. 再部署 Production。
7. 保留上一版 Image / Function 以便 rollback。

### 13.2 成本檢查

每週檢查：

- Modal invocation 次數、CPU、memory、cold start。
- GitHub Actions minutes。
- Provider token 用量與費用。
- Daytona workspace 執行時間。
- Persistent Storage 使用量。

超出預算時，先暫停排程與高成本模型，再調查原因；不要直接刪除資料。

### 13.3 版本與備份

所有部署應記錄：

```text
部署時間
Git commit / Image tag
Hermes 版本
Model Provider / Model
變更項目
測試結果
Rollback 目標
```

## 14. 標準回報格式

```markdown
## Completed

- 完成項目

## Deployment Location

- 部署位置

## Changed Files

- 修改檔案

## Test Result

- PASS / FAIL
- 測試摘要

## Known Issues

- 已知問題

## Next Step

- 下一步
```

## 15. 最終 MVP 驗收清單

### Discord

- [ ] Bot 已建立並加入私人 Server。
- [ ] Message Content Intent 已設定。
- [ ] 頻道已建立。
- [ ] Bot 權限符合最小權限原則。
- [ ] Owner User ID 已加入 allowlist。
- [ ] 未授權使用者無法操作。

### Cloudflare / Modal

- [ ] Worker 可通過 Discord endpoint verification。
- [ ] Worker 可驗證簽章、allowlist 與 deduplication。
- [ ] Worker 不執行長時間 Hermes loop。
- [ ] Modal Function 可啟動 Hermes。
- [ ] Modal Secrets 與 Volume 已掛載。
- [ ] Cold start、timeout、重試與 correlation ID 已驗證。

### Hermes

- [ ] Hermes 版本已記錄。
- [ ] Provider 已設定並通過普通對話測試。
- [ ] `SOUL.md`、`USER.md`、`MEMORY.md`、`config.yaml` 已建立。
- [ ] Checkpoints 已依需求啟用。
- [ ] 不必要的高風險工具尚未開啟。

### Wiki / Storage

- [ ] GitHub Repository 為 Private。
- [ ] Wiki 目錄與 Schema 已建立。
- [ ] `AGENTS.md` 已設定 provenance 與去重規則。
- [ ] Persistent Storage 可掛載。
- [ ] `state.db` 與 memory 已備份。
- [ ] `.gitignore` 不會提交 Secret 或執行狀態。

### 功能

- [ ] `@Jarvis hello` 能回覆繁體中文。
- [ ] URL 能建立或更新 Wiki Entry。
- [ ] Research 任務能回覆並保存結果。
- [ ] Coding 任務會使用 Branch / Worktree 與測試。
- [ ] 不會未經確認 Deploy、Merge、刪除或花費金錢。

### 維運

- [ ] 已完成一次 Wiki 備份與還原演練。
- [ ] 已完成 Secret rotation 演練或記錄程序。
- [ ] 已確認 Modal、Provider、GitHub Actions 成本監控。
- [ ] 已保留上一版部署以便 rollback。
- [ ] 已完成故障排除測試。

## 16. 參考文件

- `deep-research-report.md`
- `Discord_Hermes_Jarvis_Codex_Deployment_Manual.md`
- [Hermes Quickstart](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/getting-started/quickstart.md)
- [Hermes Discord Setup](https://github.com/nousresearch/hermes-agent/blob/main/website/docs/user-guide/messaging/discord.md)
- [Hermes CLI Commands](https://github.com/nousresearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md)

