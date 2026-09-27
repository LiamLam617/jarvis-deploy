**我的建議是：保留「Discord＋Hermes＋私人 Markdown 知識庫」的方向，但不要直接照目前的 Runbook 部署；先把它改成「免費額度用完就停止，絕不自動切換付費服務」的版本。**

你原本將「接收訊息」與「執行 Agent」分開，這個原則值得保留；部署手冊本來也明確要求，不要把 Hermes 當成永遠在線的 VPS。 不過，原始研究也已提醒：**基礎設施免費，不代表模型推理與整套系統必然免費。**

以下依 **2026 年 9 月 21 日查到的官方資料**，先確認方向，再給你實際的註冊、準備與設定順序。

# 一、先確認：「完全免費」要怎麼實現？

我建議把這次的限制定為：

> **每月實際支付 $0；允許免費額度、限流與冷啟動；額度不足時停止服務，不儲值、不升級，也不切換到付費模型。**

但還有一個必須分開處理的条件：**實付 $0，不等於完全不需要付款方式。**

Modal 現在雖然仍提供每月 **$30 免費運算額度**，官方卻明確要求帳號提供付款方式。因此，它只能列為「有條件採用」，不能直接稱為免綁卡、零扣款風險的服務。([Modal][1])

| 你的要求                          | 我建議的方向                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| 保留 Hermes、完整雲端、實付 $0，接受提供付款方式 | 採用下面的架構，但先確認 Modal 能設定並保存 **$0 實付支出上限**。                                    |
| 保留 Hermes、完整雲端，而且完全不能提供付款方式   | **目前這份 Modal 方案不符合要求**，不能照原文件繼續。                                            |
| 完全不提供付款方式，願意先不要 Hermes        | 改做 Cloudflare 上的輕量 Jarvis，提供聊天、收錄、摘要與知識庫操作；但這是另一個實作，不是把完整 Hermes 搬進 Worker。 |

**下面的主要路線以「保留 Hermes」為前提。Modal 的費用限制是第一個驗收關卡，不是部署完成後才處理。**

# 二、我會採用的第一版架構

```text
Discord
  /jarvis、/capture、/status
           │
           ▼
Cloudflare Worker
  驗證簽章、限制使用者、快速回覆
           │
           ▼
Cloudflare Queue
  暫存工作、有限重試
           │
           ▼
Modal：按需啟動 Hermes
  不執行常駐 Discord Gateway
           │
           ├── Cloudflare Workers AI：免費模型推理
           ├── Modal Volume：Hermes 記憶與對話狀態
           └── GitHub 私有 Repository：Markdown 知識庫
           │
           ▼
Discord：回覆執行結果

Cloudflare D1：工作狀態、事件去重
Cloudflare Cron：之後才加入每日排程
```

這裡有四項需要修改原文件。

### 1. Discord 入口改成 `/jarvis`，不是普通的 `@Jarvis` 訊息

你目前的 Runbook 一方面設定 **Interactions Endpoint**，另一方面又用普通的 `@Jarvis hello` 當驗收；這兩者不能直接連在一起。 

HTTP Interactions 適合 Slash Commands、按鈕等互動；一般頻道訊息事件則走 Discord Gateway。**採用不用常駐 Gateway 的版本，第一版就應使用 `/jarvis` 等指令。**([Documentation - Discord][2])

### 2. 模型推理也要使用免費額度

建議先測試 Workers AI 上的：

```text
@cf/qwen/qwen3-30b-a3b-fp8
```

官方模型頁標示它支援工具呼叫，內容長度上限為 32,768 tokens；Workers AI 也提供 OpenAI 相容介面，適合作為 Hermes 自訂 Provider 的候選。**這代表有整合依據，不代表我已替你的帳號驗證完整 Hermes 工具流程。**([Cloudflare Docs][3])

第一版不加入付費 Provider 的金鑰，也不設定付費備援模型。

### 3. Daytona 先移出必要路徑

Daytona 官網目前將免費運算額度描述為 **free trial**，不能當成每月持續補充的免費資源。因此先不要註冊、不要建立 Sandbox；第一版的聊天與知識收錄也不需要它。([Daytona][4])

### 4. GitHub Actions 不拿來承擔日常聊天服務

原文件用 GitHub Actions 執行 Daily Insight。 但目前 GitHub 條款對 Actions 的用途有軟體開發相關限制，不能把有免費分鐘數理解成可任意充當一般 serverless 應用後端。這次我會讓它只負責測試、建置與部署；私人摘要排程改由 Cloudflare Cron 觸發同一條工作流程。([GitHub Docs][5])

# 三、需要註冊哪些網站？

**第一版只有四個主要帳號。** Workers、Workers AI、Queues、D1 都在同一個 Cloudflare 帳號裡，不需要分別註冊。

| 服務與入口                                                                   | 這次用途                          | 免費條件與注意事項                                                |
| ----------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| [Discord Developer Portal](https://discord.com/developers/applications) | 建立 Jarvis Application、Bot 與指令 | 使用現有 Discord 帳號即可；Application 並不代表 Discord 會替你執行 Hermes。 |
| [Cloudflare 註冊](https://dash.cloudflare.com/sign-up)                    | 訊息入口、工作佇列、模型推理                | 選擇 Workers Free，不啟用付費方案。                                 |
| [GitHub 註冊](https://github.com/signup)                                  | 部署程式與私人 Markdown 知識庫          | 使用普通私有 Repository，不依賴私有 Repository 的 Wiki 頁籤。            |
| [Modal](https://modal.com/)                                             | 執行 Hermes、保存執行狀態              | 有每月免費額度，但要求付款方式，必須先通過支出限制檢查。                             |

其中「GitHub Wiki」要特別講清楚：**我们要的是私有 Repository 裡面的 `wiki/` 資料夾，不是 GitHub 介面上的 Wiki 功能。** GitHub Free 的私有 Repository 不包含那個 Wiki 功能，但不妨礙你用一般 Markdown 檔案建立知識庫。([GitHub Docs][6])

相關免費額度如下，這些是平台上限，不代表全部都能拿來執行同樣數量的 Agent 任務：

| 資源            | 目前免費額度                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| Workers       | 每日 100,000 次請求；Free 的 CPU 時間限制為每次 10 ms。([Cloudflare Docs][7])                         |
| Workers AI    | 每日 10,000 Neurons；Free 額度用完後操作會失敗，而不是直接進入付費使用。部分模型另外要求付款設定，不能任選。([Cloudflare Docs][8]) |
| Queues        | 每日 10,000 次操作，免費方案保留訊息 24 小時；一般訊息的寫入、讀取、刪除會分別計算操作。([Cloudflare Docs][9])               |
| D1            | 每日 500 萬列讀取、10 萬列寫入，總儲存 5 GB。([Cloudflare Docs][10])                                   |
| Modal Starter | 每月 $30 運算額度，但不是 LLM API 額度，也不是無限使用。([Modal][1])                                        |

# 四、實際設定順序

## 第 0 步：先確認 Modal 的「實付 $0」限制

這一步要在建立運算工作之前完成。

在 Modal 建立帳號後，查看 **Settings → Usage & Billing**，確認目前方案與當期免費額度。

Modal 有兩個不同的設定：

**Workspace budget／Usage limit** 限制的是「扣除免費額度之前」的使用金額；**Spend limit** 才是「扣除免費額度之後，實際自付金額」的上限。只設定前者，或只收到用量通知，都不等於禁止扣款。([Modal][11])

我建議這次的起始設定為：

```text
方案：Starter
當期免費額度：確認帳號實際顯示的金額

Workspace usage budget：$20
Workspace spend limit：$0
```

`$20` 是我建議的保守使用上限，不是平台預設；前提是當期確實有 $30 適用額度。

**必須確認 `$0` 能成功儲存，重新開啟頁面後仍然有效。** 官方文件說明了 Spend limit 的限制機制，但我尚未登入你的帳號，也沒有證據能保證每個帳號介面都接受相同設定。若不能設定，這條路線就不能通過你的零支出要求；不要改填 `$1`、不要先部署再觀察帳單。

## 第 1 步：整理帳號與識別碼，不先收集一堆服務金鑰

你 Runbook 已經記錄：

```text
Discord Server 名稱：Liam 的伺服器
Bot 名稱：Jarvis
Owner User ID：249763790709719040
```

這些資料可以沿用，不需要重新問你。 尚未填寫的 Application ID、Server ID、Channel ID、Cloudflare Account ID，再隨後面步驟補上。

準備一份 Inventory，只記錄帳號、資源名稱、ID 與「Secret 存在哪裡」，**不要記錄 Token 本身**。

這次的設計不要求你購買網域、VPS 或 GPU，也不把新的 Codex 訂閱列為必要條件。部署時可以暫時使用自己的電腦與終端機，但它不需要成為全天運作的伺服器。

## 第 2 步：建立兩個 GitHub 私有 Repository

前往 [建立 Repository](https://github.com/new)，建立：

```text
jarvis-deploy
jarvis-wiki
```

兩者都選 **Private**。

`jarvis-deploy` 放部署程式、設定範本與測試；`jarvis-wiki` 放真正的知識內容。我建議先用這個小型結構：

```text
jarvis-wiki/
├── AGENTS.md
└── wiki/
    ├── SCHEMA.md
    ├── index.md
    ├── log.md
    ├── inbox/
    ├── raw/
    ├── concepts/
    ├── ideas/
    └── projects/
```

這延續你的 Markdown 知識庫方向；`inbox/` 用來容納尚未整理的連結與想法。

部署 Repository 至少忽略：

```gitignore
.env
.env.*
!.env.example
secrets/
*.key
*.pem
state.db*
.venv/
__pycache__/
```

先不要把日常對話資料庫或整個 Hermes Home 推進 Git。你的 Runbook 本來就將「可讀知識」與「執行狀態」分開保存。

待程式需要寫入 Wiki 時，再建立只限 `jarvis-wiki` 的存取憑證；設計上只給內容讀寫能力，不给帳號管理或其他 Repository 權限。

## 第 3 步：建立 Discord Application 與 Bot

開啟 [Discord Developer Portal](https://discord.com/developers/applications)，建立名為 `Jarvis` 的 Application。

在 **General Information** 記錄：

```text
Application ID
Public Key
```

到 **Bot** 頁面建立或設定 Bot，安全保存 Bot Token。接著使用 Guild Install，設定：

```text
Scopes：
bot
applications.commands
```

權限先從 `View Channels`、`Send Messages` 開始；需要附件時才加入 `Attach Files`。不要給 Administrator。

在自己的伺服器先建立兩個頻道即可：

```text
#jarvis
#inbox
```

這也符合你 Runbook「先只開放兩個頻道」的安排。 開啟 Discord Developer Mode，取得 Server ID 與兩個 Channel ID。

這版是 Slash Commands 入口，**不要為了接收普通訊息而啟用 Message Content Intent，也不要啟動常駐 Gateway**。HTTP Interactions 不需要依賴那條普通訊息接收路徑。([Documentation - Discord][2])

第一版預計註冊：

| 指令                   | 用途                 |
| -------------------- | ------------------ |
| `/jarvis prompt:...` | 與 Hermes 對話        |
| `/capture url:...`   | 收錄連結，之後再加入擷取與摘要    |
| `/status`            | 查看服務、工作或額度狀態，不呼叫模型 |

**指令必須透過 Discord API 註冊；只在 Portal 填入 Endpoint，不會自動產生這些指令。** 建議先註冊為你私人伺服器的 Guild Commands，方便測試。([Documentation - Discord][12])

## 第 4 步：建立 Cloudflare 免費資源

在 Cloudflare 帳號內使用 **Workers Free**。先用平台提供的 `workers.dev` 位址，不必購買自己的網域。([Cloudflare Docs][13])

我建議這次統一使用以下名稱：

```text
Worker：jarvis-ingress
Queue：jarvis-jobs
失敗工作 Queue：jarvis-dead-letter
D1 Database：jarvis-control
```

Worker 第一個版本只需要完成「有效請求回固定文字」，不要同時接上 Hermes、Wiki、排程。

之後再加入 Queue 與 D1。D1 保存的是：

```text
Discord interaction ID
工作狀態
建立時間
Modal 工作識別碼
必要的重試資訊
```

**D1 不拿來直接替代 Hermes 的 `state.db`。** 前者是我們自己設計的工作管理資料，後者是 Hermes 原生執行狀態，不能只改一個連線設定就互換。

Worker 的一般設定可以準備為：

```text
DISCORD_APPLICATION_ID
DISCORD_PUBLIC_KEY
DISCORD_GUILD_ID
DISCORD_ALLOWED_USER_ID
DISCORD_ALLOWED_CHANNEL_IDS
MODAL_FUNCTION_URL
```

其中使用者 ID 沿用 Inventory 的值，而且所有 Discord ID 都以字串保存。

Worker 到 Modal 的內部認證，另外建立一個隨機 Secret，例如：

```text
JARVIS_INTERNAL_SECRET
```

不要把它叫成 Discord 的簽章金鑰：Discord 請求驗證使用的是 Application Public Key；內部 Secret 是我們另外設計的服務間認證。

## 第 5 步：設定 Workers AI，先單獨測通模型

在 Cloudflare 開啟 **Workers AI → Use REST API**，使用 **Create a Workers AI API Token** 建立專用 Token，並取得 Account ID。官方流程提供專用 Token 範本，不需要使用權限過大的 Global API Key。([Cloudflare Docs][14])

先測試這個候選模型：

```text
@cf/qwen/qwen3-30b-a3b-fp8
```

Hermes 使用的 OpenAI 相容 Base URL 為：

```text
https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1
```

這是 Cloudflare 的介面，不是 OpenAI 的付費 API。([Cloudflare Docs][15])

此階段的驗收不是只看 Playground 能回答一句話，而是依序確認：

**普通文字可以回答；工具呼叫可以完成；模型取得工具結果後能產生最終回答。**

這個模型的工具呼叫支援有官方依據，但完整 Hermes 相容性與你的工作品質仍要實測。([Cloudflare Docs][3])

Workers AI 的免費額度按 Neurons 計算，不是按「你傳送幾則 Discord 訊息」計算；一次 Agent 任務可能包含多次模型請求。額度用完時應回覆「今日免費額度已用完」，不要無限重試。([Cloudflare Docs][8])

## 第 6 步：配置 Hermes 與 Modal 的執行環境

這一階段才真正處理 Hermes。

先固定 Hermes 的版本或 commit，不要讓每次啟動都重新安裝不確定的最新版。Modal 建立一個 Volume，例如：

```text
jarvis-data
```

掛載到：

```text
/data
```

我建議指定：

```text
HERMES_HOME=/data/hermes
WIKI_PATH=/data/jarvis-wiki/wiki
```

Hermes Home 應保留原生目錄結構，例如：

```text
/data/hermes/
├── config.yaml
├── SOUL.md
├── state.db
├── memories/
│   ├── MEMORY.md
│   └── USER.md
└── skills/
```

**你文件裡把兩個記憶檔直接放在 Home 根目錄的寫法需要更新。** 目前官方文件將它們放在 `memories/` 子目錄，而且明確提醒：模型說「已記住」不等於真正寫入記憶。([Hermes Agent][16])

模型設定可先採用以下範本：

```yaml
model:
  provider: custom
  default: "@cf/qwen/qwen3-30b-a3b-fp8"
  base_url: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1"
  context_length: 32768

agent:
  max_turns: 6
  api_max_retries: 1
  auto_recovery_cycles: 0

fallback_providers: []

auxiliary:
  compression:
    provider: main
  title_generation:
    provider: main
```

這裡的 `6` 是建議的起始工具迭代上限，不是平台要求。主 Provider 應是 `custom`；輔助任務的 `main` 表示沿用主模型連線，兩者不能互換。([Hermes Agent][17])

Cloudflare Workers AI Token 由 Modal Secret 注入：

```text
OPENAI_API_KEY=<Cloudflare Workers AI Token>
```

不放進 `config.yaml` 或 Git。第一版也不要注入其他付費模型服務的金鑰。

Modal 執行設定先採保守值：

```text
常駐容器數：0
最大執行容器數：1
同時處理的 Agent 工作：1
單次工作硬性逾時：300 秒
GPU：不用
```

這是第一版的設計限制；實際 CPU、記憶體大小要根據 Hermes 啟動測試調整。Modal 支援縮到零與容器數限制，但冷啟動、保留中的容器等仍需計入用量。([Modal][18])

**聊天、排程與 Wiki 更新都必須走同一個序列化的執行入口。** Volume 不會自動提供共享檔案的安全鎖；工作完成時要結束資料庫寫入並明確保存 Volume，不能讓兩個程序同時改同一份狀態。([Modal][19])

先測試一次性對話：

```bash
hermes chat --oneshot -q "請用繁體中文回答：連線成功。"
```

目前 CLI 的 `-q` 在互動終端機中可能繼續保持會話，因此應明確使用 `--oneshot`。正式處理 Discord 輸入時，則使用 `--query-file` 或安全的程序參數傳遞，不把使用者訊息拼接成 shell 指令。([Hermes Agent][20])

## 第 7 步：接通 Discord，但要補上真正的橋接程式

**三份文件目前描述了架構與操作要求，並沒有提供一套可直接部署的完整 Worker／Modal 橋接程式。** Runbook 列出了它們應具備的行為，但不能只註冊帳號、填入 Token 就自動得到那些功能。 

至少還需要實作以下三部分：

| 程式                | 必須完成的工作                                  |
| ----------------- | ---------------------------------------- |
| Discord 指令註冊程式    | 建立 `/jarvis`、`/capture`、`/status`        |
| Cloudflare Worker | 簽章驗證、PING、allowlist、事件去重、快速回覆、放入 Queue   |
| Modal 執行包裝        | 驗證內部請求、啟動 Hermes、恢復對話、保存狀態、回傳 Discord 結果 |

連接時的順序應是：

**先完成 Worker 固定回覆 → 設定 Discord Interactions Endpoint → 驗證指令 → 接上 Modal 固定回覆 → 最後才接上 Hermes。**

Discord 要求初次回應在 **3 秒內**完成；interaction token 的有效期間是 **15 分鐘**。所以 Worker 必須先回 deferred response，再由後面的工作更新結果，不能等待 Hermes 全部做完才回應。([Documentation - Discord][21])

Queue 用來承接工作；不要把「Worker 回覆後繼續等待」當成可靠的長時間 Agent 執行機制。Modal 接收端也應快速接受並派發工作，而不是讓整條 HTTP 連線等待模型完成。([Modal][22])

此外，**保存 `state.db` 不代表程式自動知道這則訊息屬於哪段對話**。橋接程式要保存 Discord 頻道／使用者與 Hermes session 的對應，並在下一次工作恢復正確的 session。

這一階段至少要測到：本人能操作、其他人被拒絕、同一事件不重複執行，以及容器停止後重新啟動仍能讀到原有記憶。

## 第 8 步：最後才加入 URL 整理與每日摘要

先讓 `/capture` **確定保存 URL 與你的備註**，再加入網頁擷取與模型摘要。這樣即使網站無法擷取，原始連結也不會遺失。

Hermes 的網頁工具目前有免費、免金鑰的選項，例如其 Tavily 整合；但免費模式有速率與能力限制，不應保證所有網站都能讀取。第一版不要自動改用付費擷取或瀏覽器服務。([Tavily Docs][23])

每日摘要等到手動流程穩定後，再使用 **Cloudflare Cron → 相同 Queue → 相同 Modal 執行入口**。Cron 本身不會讓後面的模型與運算成本消失，仍受同一套免費額度限制；其排程時間以 UTC 配置。([Cloudflare Docs][24])

第一版暫不加入多人使用、語音、多 Agent 平行工作、Daytona，以及任意 Repository 的自動修改或部署。

# 五、這次應該怎麼判定「完成」？

不是看到 Bot 回覆一句話就算完成，而是同時滿足下面三項：

**功能完成：** `/jarvis` 能回答，`/capture` 能產生真正的 Markdown 檔案，冷啟動後能延續指定對話與讀取記憶。

**安全完成：** 只有允許的使用者與頻道能觸發任務；Secrets 不進 Git、不進日誌；重送同一個事件不會重複寫入或重複執行。

**費用完成：** Cloudflare 維持 Free；Modal 的實付支出限制已確認；免費額度不足時明確停止，沒有付費模型備援、無限重試或自動升級。

**因此，方向可以保留，但目前應將它稱為「有條件的零支出方案」，不是已驗證的完全免費部署。第一個實際動作是確認 Modal 的 `$0` 實付限制；通過後才依序建立 GitHub、Discord、Cloudflare 資源，再補上橋接程式。若你連付款方式都不接受，就應在這個關卡改走純 Cloudflare 的輕量版本，而不是讓「免費額度」掩蓋原架構的付款條件。**

[1]: https://modal.com/pricing "Plan Pricing | Modal"
[2]: https://docs.discord.com/developers/platform/interactions?utm_source=chatgpt.com "Interactions & Commands - Documentation - Discord"
[3]: https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/ "qwen3-30b-a3b-fp8 (Qwen) · Cloudflare AI docs · Cloudflare Workers AI docs"
[4]: https://www.daytona.io/pricing?utm_source=chatgpt.com "Daytona - Secure Infrastructure for Running AI-Generated Code"
[5]: https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features "GitHub Terms for Additional Products and Features - GitHub Docs"
[6]: https://docs.github.com/en/communities/documenting-your-project-with-wikis/about-wikis "About wikis - GitHub Docs"
[7]: https://developers.cloudflare.com/workers/platform/pricing/ "Pricing · Cloudflare Workers docs"
[8]: https://developers.cloudflare.com/workers-ai/platform/pricing/ "Pricing · Cloudflare Workers AI docs"
[9]: https://developers.cloudflare.com/queues/platform/pricing/ "Cloudflare Queues - Pricing · Cloudflare Queues docs"
[10]: https://developers.cloudflare.com/d1/platform/pricing/ "Pricing · Cloudflare D1 docs"
[11]: https://modal.com/docs/guide/budgets "Budgets | Modal Docs"
[12]: https://docs.discord.com/developers/interactions/application-commands?utm_source=chatgpt.com "Application Commands - Documentation - Discord"
[13]: https://developers.cloudflare.com/workers/get-started/guide/ "Get started - CLI · Cloudflare Workers docs"
[14]: https://developers.cloudflare.com/workers-ai/get-started/rest-api/ "Get started - REST API · Cloudflare Workers AI docs"
[15]: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/ "OpenAI compatible API endpoints · Cloudflare Workers AI docs"
[16]: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/ "Persistent Memory | Hermes Agent"
[17]: https://hermes-agent.nousresearch.com/docs/user-guide/configuration/ "Hermes Agent Configuration | Hermes Agent"
[18]: https://modal.com/docs/guide/scale?utm_source=chatgpt.com "Scaling out | Modal Docs"
[19]: https://modal.com/docs/guide/volumes "Volumes | Modal Docs"
[20]: https://hermes-agent.nousresearch.com/docs/reference/cli-commands/ "CLI Commands Reference | Hermes Agent"
[21]: https://docs.discord.com/developers/interactions/receiving-and-responding?utm_source=chatgpt.com "Receiving and Responding to Interactions - Documentation - Discord"
[22]: https://modal.com/docs/guide/job-queue "Job processing | Modal Docs"
[23]: https://docs.tavily.com/documentation/integrations/hermes-agent?utm_source=chatgpt.com "Hermes Agent - Tavily Docs"
[24]: https://developers.cloudflare.com/workers/configuration/cron-triggers/ "Cron Triggers · Cloudflare Workers docs"
