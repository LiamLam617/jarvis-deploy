# 零成本、事件驅動的 Hermes Agent「私人 Jarvis」架構研究

> 研究基準日期：2026-08-08。以下以 Hermes Agent 現行官方文件、Modal、Daytona、Cloudflare、GitHub 等一手資料為準。這點很重要，因為研究提示詞中的若干數字與行為已經被 2026 年版本更新，例如「47 個工具」「6 種 terminal backend」「8 種 auxiliary model task」「Telegram 可直接展開 `@URL`」「Checkpoint 預設自動快照」都已不完全正確。citeturn16view0turn16view1turn16view3turn15view2turn15view3

## 結論摘要與推薦架構

### 最重要的研究結論

這套「私人 Jarvis」**可以做到基礎設施接近或維持 $0/月，但不能把「整套系統必然 $0」當成保證**。Hermes 本身是 MIT 授權，Telegram Bot API 不收使用費，而 Cloudflare Workers、GitHub Actions、Modal 都有足以支撐個人低頻工作流的免費額度；但 LLM inference 是否為零成本，最後取決於你選的 provider/model。Hermes 官方的 Nous Tool Gateway 明確屬於付費 Portal 訂閱者功能，因此若使用 Nous Portal，就不能稱為端到端零成本。citeturn15view2turn13search19turn16view1turn23view0turn23view5turn23view6

第二個、也是架構上最容易誤解的地方是：

**Hermes 官方的 Modal / Daytona 整合，本質上首先是 terminal backend，而不是「把整個 Hermes Gateway 丟上去就自動變成 serverless bot hosting」。** 現行 Hermes Terminal Backend 清單把 Modal、Daytona 與 local、Docker、SSH、Singularity、Vercel Sandbox 並列，作用是讓 agent 的 terminal / file / code execution 發生在隔離或遠端環境。要讓「整個 Telegram → Hermes Gateway」在 Modal 上真正 scale-to-zero，需要另外把 Hermes 包成 HTTP/ASGI invocation service；這不是現行文件提供的一鍵 gateway deployment target。citeturn16view1turn20search26turn7view2

因此，我建議把 Jarvis 分成兩個平面：

**控制平面**負責手機訊息、事件、排程、狀態與路由；**執行平面**才負責 browser、code、shell、subagent 等重型工作。這樣 serverless 才能發揮價值，而不是為了等 Telegram 訊息讓完整 VM 長駐。

### 推薦端到端架構圖

```text
                    ┌──────────────────────────────┐
                    │         手機 / Telegram       │
                    │ 文字 / URL / 語音 / 圖片 / 任務 │
                    └──────────────┬───────────────┘
                                   │ Telegram Webhook
                                   ▼
                    ┌──────────────────────────────┐
                    │ Cloudflare Worker            │
                    │ $0 edge ingress              │
                    │                              │
                    │ • 驗證 webhook secret         │
                    │ • allowlist / dedup           │
                    │ • 判斷 event type             │
                    │ • 快速 ACK                    │
                    │ • 觸發 Hermes invocation      │
                    └──────────────┬───────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
                 ▼                                   ▼
      ┌─────────────────────┐            ┌─────────────────────┐
      │ Modal HTTP Function │            │ GitHub Actions      │
      │ 互動型任務            │            │ 定時 / CI / 長批次    │
      │ scale-to-zero       │            │ 外部 scheduler      │
      └──────────┬──────────┘            └──────────┬──────────┘
                 │                                  │
                 └────────────────┬─────────────────┘
                                  ▼
                    ┌──────────────────────────────┐
                    │ Hermes Agent Core            │
                    │                              │
                    │ SOUL.md / AGENTS.md          │
                    │ MEMORY.md / USER.md          │
                    │ state.db + FTS5              │
                    │ Skills / Curator             │
                    │ session_search               │
                    └──────────────┬───────────────┘
                                   │
                 ┌─────────────────┼───────────────────┐
                 │                 │                   │
                 ▼                 ▼                   ▼
        ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
        │ delegate_task  │ │ execute_code   │ │ Native tools   │
        │ 短期 subagents │ │ 程序化流水線     │ │ web/browser    │
        │ ≤3 concurrent │ │                │ │ file/vision/MCP│
        └────────┬───────┘ └────────┬───────┘ └────────┬───────┘
                 │                  │                  │
                 └────────────┬─────┴──────────────────┘
                              ▼
                ┌───────────────────────────────┐
                │ Execution Sandbox             │
                │                               │
                │ Daytona：workspace / code     │
                │ Modal Sandbox：burst compute  │
                │ Docker：本機隔離               │
                │ SSH：已有伺服器                 │
                └──────────────┬────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ Markdown LLM Wiki│ │ GitHub / Project │ │ 外部 MCP / APIs  │
│ + Obsidian       │ │ source / deploy  │ │ Drive/Notion/HA │
│ private Git repo │ │ worktrees        │ │ etc.             │
└────────┬─────────┘ └────────┬─────────┘ └──────────────────┘
         │                    │
         └────────────┬───────┘
                      ▼
              ┌───────────────────┐
              │ hermes send       │
              │ Telegram 回報      │
              │ 不要求 gateway 常駐 │
              └───────────────────┘
```

其中 Cloudflare Worker 不應執行 Hermes 本身；Workers Free 的 CPU 時間非常有限，適合當 ingress、驗證與喚醒層。Modal HTTP endpoints 則原生支援 idle 時 scale to zero，來 request 時重新啟動 container；Modal 官方也明確說 cold start 存在，因此不能假設固定毫秒級回應。citeturn23view5turn14search7turn14search13turn14search3

**Daytona 更適合 Jarvis 的「Agent execution workspace」，Modal 更適合 Jarvis 的「event-driven invocation host」。** Daytona 原生概念是可建立、停止、暫停、恢復的完整 sandbox，而且目前預設 idle 15 分鐘後 auto-stop；Modal 的 Function / Endpoint 模型則直接以 request 驅動 autoscaling 和 scale-to-zero。citeturn14search2turn14search6turn14search7turn14search13

### 建議保留兩種運作模式

**Strict-$0 / event-driven mode**：Telegram Webhook → Cloudflare → Modal one-shot Hermes；排程交給 GitHub Actions / Modal schedule；執行沙箱按需啟動。優點是真正沒有 idle compute。缺點是 Hermes 原生 gateway 內的部分長駐型能力，例如 Kanban dispatcher，不能假設在 host 睡眠期間持續運作。

**Hermes-native mode**：讓 `hermes gateway` 常駐或部署在真正支援 HTTP auto-wake + persistent disk 的 host；Telegram 使用 webhook；內置 Cron、Kanban、Persistent Goals 等完全由 Hermes 管。這是能力最完整的 Jarvis，但若沒有自己的 NAS、樹莓派、舊電腦或免費 always-on 資源，通常就不是嚴格的 $0。Hermes 官方團隊 Telegram 教學甚至直接用「約 $5/月 VPS 即足夠」作為常駐 gateway 的典型方案。citeturn17search0turn17search3turn16view8

我的推薦是：**日常互動走 Strict-$0，真正需要 durable multi-agent pipeline 時才喚起「native worker window」；不要為了 24 小時等訊息而付 24 小時計算費。**

## Hermes 全功能盤點與現行版本校正

### 研究提示詞中需要修正的地方

首先是幾個會直接改變架構的版本差異。

| 提示詞中的假設 | 2026-08 現況 | 對 Jarvis 的影響 |
|---|---|---|
| 47 個內置工具 | 官方 code-derived registry 現為 **約 82 tools** | 必須把 Kanban、video、desktop GUI、Spotify plugin、project tools 等新能力納入盤點。citeturn16view0 |
| 6 種 terminal backend | 現為 **7 種**：local、Docker、SSH、Singularity、Modal、Daytona、Vercel Sandbox | Vercel Sandbox 也值得保留為替代執行環境。citeturn16view1 |
| 8 種 auxiliary tasks | 現行 model dashboard 已顯示 **11 個 auxiliary task slots** | 成本分級能力比提示詞描述更完整。citeturn16view3 |
| Telegram 可用 `@URL` | **不可以由 gateway 展開**；Context References 主要是 CLI 功能 | 手機丟 URL 要讓 agent 偵測 raw URL，再使用 `web_extract`/相關 skill。citeturn15view2 |
| Checkpoint 自動存在 | v2 起 **default off、opt-in** | Jarvis coding profile 應主動設 `checkpoints.enabled: true`。citeturn15view3 |
| Honcho 是核心內置記憶 | 現為外部 **Memory Provider Plugin**；內置記憶仍常駐 | 第一版可完全不裝 Honcho，之後再疊加深度 user modeling。citeturn20search11turn20search4 |
| 「三層 persistent memory」是官方模型 | 現行 Persistent Memory 文件正式定義的是 `MEMORY.md` + `USER.md`；完整 session history 另外進 `state.db` + FTS5 | 架構上可以把它抽象成 semantic / working / episodic，但不要誤以為 Hermes 現行 API 有獨立的「daily episodic-memory tier」。citeturn20search8turn24search12 |

### 閉環學習與記憶

Hermes 的核心定位仍是 self-improving agent：會從使用經驗建立技能、在使用中改進技能、提示自己保存持久知識，並逐漸建立對使用者的模型。這是 Jarvis 最值得利用的核心特性之一。citeturn17search9turn24search8

但內置長期記憶不是拿來當大型知識庫。現行官方設定中，`MEMORY.md` 是 agent 對環境、慣例、學習心得的精簡記憶，`USER.md` 是使用者偏好與風格；兩者都有刻意的字數上限，會在 session 開始時以 frozen snapshot 注入 prompt。完整 Telegram/CLI/Discord 等對話則存在 `~/.hermes/state.db`，包含完整 message history、metadata、token counts、timestamps，並有 SQLite FTS5 full-text search。citeturn20search8turn24search12

因此 Jarvis 應該把資訊分成：

**`USER.md`**：你的偏好，例如「回答使用 zh-TW」「寫程式前先 plan」「Side project 優先 Python/FastAPI」。

**`MEMORY.md`**：長期穩定的環境事實，例如 wiki path、repo 命名慣例、常用 deployment target。

**`state.db` / session_search**：找回「之前聊過什麼」。

**LLM Wiki**：真正的文章、想法、研究、技術決策與外部知識。

這比把幾千篇 clipping 全塞 memory 健康得多。Hermes 甚至已原生附帶 `llm-wiki` skill，它明確以「persistent, compounding interlinked Markdown knowledge base」為設計目標，並使用 raw sources → wiki pages → schema 的三層知識架構；預設 `WIKI_PATH=~/wiki`，完全不要求資料庫。citeturn22view6

Honcho 則應視為第二階段。它在內置記憶之上提供 dialectic reasoning、深度 user modeling、semantic search 與 persistent conclusions；Hermes 現在共有八種外部 Memory Provider，包括 Honcho、OpenViking、Mem0、Hindsight、Holographic、RetainDB、ByteRover、Supermemory，而且一次只啟用一種外部 provider，內置 `MEMORY.md`/`USER.md` 仍同時存在。citeturn20search4turn20search19

對私人 Jarvis，我會先不裝 Honcho：**用一兩個月原生記憶後，確認真的需要「對你這個人做長期推理」再導入。**

### Context Files 與 Context References

Hermes 能自動發現 `.hermes.md/HERMES.md`、`AGENTS.md`、`CLAUDE.md`、`.cursorrules` 等專案 context files；`SOUL.md` 則是全域 personality/context。專案層 context 有優先序，nested project context 也能漸進發現。citeturn1search9turn1search1

這非常適合 Jarvis：

- `SOUL.md`：定義 Jarvis 人格、風險偏好、通知風格。
- wiki repo 的 `AGENTS.md`：定義 ingest / taxonomy / provenance 規則。
- coding repo 的 `AGENTS.md`：定義 test、branch、deploy、review 規則。
- 不同 repo 不需要重新 prompt 一遍。

`@file:`、`@folder:`、`@diff`、`@staged`、`@git:N`、`@url:` 的 Context References 也很強，但它是**CLI 前處理功能**。Telegram/Discord message 不會被 gateway 展開。官方文件明確寫明：訊息平台上的 `@` syntax 原樣透傳，agent 仍然可以自行呼叫 `read_file`、`search_files`、`web_extract`。citeturn15view2

所以手機端應採用：

```text
❌ 不建議：
@url:https://youtube.com/...

✅ 建議：
https://youtube.com/...
幫我收進 wiki，重點放 agent architecture
```

甚至連後半句都可以省掉；在 `SOUL.md` 中定義「單獨收到 URL 時預設視為 inbox capture」即可。

### Checkpoints、工作樹與 coding 安全

Checkpoint 在啟用後會於 `write_file`、`patch` 和多種 destructive terminal command 前自動建立 shadow-git snapshot，真正 repo 的 `.git` 不會被修改；`/rollback` 可回復整個 checkpoint 或單一檔案。現行 v2 預設卻是 `enabled: false`。citeturn15view3

因此 Side Project profile 應明確開啟：

```yaml
checkpoints:
  enabled: true
  max_snapshots: 20
  max_total_size_mb: 500
  auto_prune: true
```

官方同樣建議將 checkpoints 與 Git worktrees 結合，尤其多代理平行修改同一 repository 時。citeturn15view3

這比讓研究 agent、coder agent 和 reviewer 三個人同時碰同一 working tree 安全得多。

### Terminal backend 全盤

現行官方 backend 是：

**Local**：最低延遲，開發方便，但 agent 直接碰 host。

**Docker**：適合本機安全隔離；Hermes 會保持一個 persistent container，在 process 生命週期內 terminal、file、`execute_code` 與 delegate subagent 共用其工作環境。citeturn20search26

**SSH**：很適合已有 VPS/NAS/home server 的人。

**Singularity**：HPC / rootless cluster 場景。

**Modal**：serverless cloud execution。

**Daytona**：persistent cloud sandbox/workspace。

**Vercel Sandbox**：snapshot-backed cloud microVM。citeturn16view1

Jarvis 主架構我會採用 **Docker + Daytona/Modal 雙層**：

```text
普通研究 / Markdown
→ 不啟動 remote sandbox

需要 pip/npm/build/test
→ Daytona small sandbox

非常短暫 burst job / 並行執行
→ Modal Sandbox

本機開發與排錯
→ Docker
```

### Messaging Gateway 全盤

提示詞中的 20+ 平台概念仍然正確，但現行平台表已更大。除了 Telegram、Discord、Slack、Google Chat、WhatsApp、Signal、SMS、Email、Home Assistant、Mattermost、Matrix、DingTalk、Feishu/Lark、WeCom、Weixin、BlueBubbles、QQ、Yuanbao、Teams 等之外，目前還列有 WhatsApp Cloud API、WeCom Callback、Photon/iMessage、LINE、ntfy、Raft、IRC、Buzz、SimpleX 等 adapter / variant。citeturn16view4

對 Jarvis **只啟用 Telegram** 是正確選擇。單一 gateway 的價值是未來加 Discord/Slack/Email 時可以共用 Hermes session/memory 基礎，而不需要做三套 agent。Hermes 的所有平台對話本身都會進統一 session storage。citeturn24search12

Telegram 本身已支援 text、voice、images、files、threads、typing 與 streaming，因此作為「手機 Jarvis UI」足夠完整。citeturn16view4turn24search2

### Model 與 Provider

Hermes 的 main model 負責每個 user turn、tool loop、streamed response；auxiliary models 則承擔較便宜的 side jobs。目前文件的 dashboard 已顯示 **11 task slots**，而官方列出的典型 side jobs包括 context compression、vision、web-page summarization、approval scoring、MCP tool routing、session-title generation、skill search。每個 auxiliary slot 都能獨立 override。citeturn16view2turn16view3

所以最合理的成本架構不是「所有東西都上最強模型」，而是：

```text
Main Jarvis reasoning        → 高品質模型
Research subagents           → 中價模型
Daily digest                 → 中低價模型
Web-page summarization       → flash / mini model
Context compression          → flash / mini model
Session title                → 最便宜模型
Vision                       → 小型 multimodal model
Weekly strategic synthesis   → 高品質模型
```

Cron 本身另外還支援 per-job model pin 與全域 `cron.model`，所以 Daily News 與 Weekly Insight 可以天然分不同成本層。citeturn16view9

### 現行內置工具並非 47 個

現行 authoritative registry 是約 82 tools，官方 breakdown 為：

- browser core 10 個，加 2 個 CDP-gated browser tools；
- file 4；
- Home Assistant 4；
- terminal 2；
- desktop GUI 6；
- web 2；
- Feishu 5；
- Spotify plugin 7；
- Yuanbao 5；
- Kanban 12；
- project desktop 3；
- Discord 2；
- video 3；
- 以及 memory、clarify、`delegate_task`、`execute_code`、`cronjob`、`session_search`、skill management、TTS、image generation、vision、video analysis、todo、computer use、X search 等 standalone tools。MCP tools 還能動態加入，不算在固定 built-in registry 裡。citeturn16view0

也就是說，你原先的「web / multimodal / terminal / file / memory / sandbox / delegation / cron / messaging / HA / MCP」分類方向沒有錯，但 **2026 Hermes 已明顯進化成比 47-tool snapshot 更完整的 agent runtime。**

### Skills 系統

Bundled skill 會於安裝時複製到 `~/.hermes/skills/`，`hermes update` 會同步新增 bundled skill，同時尊重本地修改；遺失的官方 skill 可用 `hermes skills reset ... --restore` 回復。citeturn22view3

對 Jarvis 特別值得直接使用的 bundled skills 包括：

`llm-wiki`、Obsidian、Google Workspace、Notion、YouTube content、GitHub、Hugging Face，以及 Hermes 自我配置 skill。Google Workspace skill 現在能處理 Gmail、Calendar、Drive、Contacts、Sheets、Docs。citeturn22view6turn20search16

Optional catalog 中，目前仍可確認 `evm`、`hyperliquid`、`solana`，以及 FastMCP；其中 EVM skill 可只讀查詢八條 EVM chain 且不要求 API key，FastMCP 則用於建立與部署 Python MCP server。citeturn22view4turn20search13turn20search25

反而提示詞中的 `agent-browser` **不應再視為架構依賴**：我在現行 Optional Skills Catalog 未找到這個名稱，而 Hermes 本身已有完整 browser toolset，因此 Jarvis 直接依賴 built-in browser / web tools 比較穩。citeturn22view4turn16view0

## 事件驅動宿主、Modal 與 Daytona 的成本模型

### Telegram 一定應該使用 Webhook

Hermes Telegram gateway 預設是 long polling。官方文件特別指出，long polling 適合 local / always-on host；若部署到可休眠 cloud host，應使用 webhook，因為 polling 是 gateway 主動 outbound 拉取訊息，會讓機器必須一直活著，而 webhook 是 Telegram 主動送 inbound HTTP request，才允許 host sleep when idle。citeturn17search0

所以：

```text
Long Polling
Telegram ← Hermes 不斷問「有訊息嗎？」
→ gateway 永遠不能真的休眠

Webhook
Telegram → HTTPS request → Hermes
→ 沒訊息時 host 可以為 0
```

Hermes 的官方環境變數是：

```bash
TELEGRAM_WEBHOOK_URL=https://jarvis.example.com/telegram
TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

而且 webhook secret 在設定 URL 後是 required。citeturn17search0

### Modal vs Daytona

| 項目 | Modal | Daytona |
|---|---|---|
| 核心模型 | serverless Function / Endpoint / Sandbox | agent-oriented full sandbox |
| idle compute | Function 預設可 scale to zero | sandbox 預設 idle 15 分鐘 auto-stop |
| inbound HTTP | Endpoint 是一級公民，request 會 scale up | 更自然的模式是透過 API create/start sandbox |
| workspace 感 | 較 ephemeral/function-oriented | 強，完整 filesystem / network / dev environment |
| 適合 Hermes | event runner、短 burst、平行 jobs | coding workspace、build/test、持續幾十分鐘的 agent task |
| Hermes 原生角色 | terminal backend | terminal backend |
| 免費額度 | $30 **每月** credit | $200 free compute included，但官方頁未標示為每月 recurring，因此應保守視為 onboarding/trial credit |
| 我的選擇 | **控制面 invocation** | **執行面 workspace** |

Modal 官方 Starter 是 $0 base fee，含每月 $30 free compute credit；一般 Function CPU 為 $0.0000131 / physical-core-second、RAM $0.00000222 / GiB-second。Modal Sandbox 的 CPU/RAM 費率較高，分別是 $0.00003942 / physical-core-second 與 $0.00000667 / GiB-second。citeturn23view0turn23view2

若只做 illustrative estimate，Modal Sandbox 使用最小 0.125 physical core + 1 GiB RAM：

```text
CPU:
0.125 × $0.00003942 × 3600
≈ $0.0177 / hour

RAM:
1 × $0.00000667 × 3600
≈ $0.0240 / hour

total ≈ $0.0418 / active hour
```

也就是非常輕量的 sandbox 即使一個月真的 active 幾十小時，仍很容易留在 $30 credit 內；但真正 coding sandbox 若配置更多 RAM，成本會線性上升。以上只是資源費率換算，不代表 Hermes 必然只佔 1 GiB。citeturn23view2

Daytona 現行費率為 vCPU $0.0504/hour、RAM $0.0162/GiB/hour，storage 在前 5 GB free 後約 $0.000108/GiB/hour；官方頁面目前標示包含 $200 free compute。citeturn23view3turn23view4

所以 Daytona 最小 1 vCPU + 1 GiB RAM 大約：

```text
$0.0504 + $0.0162
= $0.0666 / active hour
```

1 vCPU + 5 GiB 則約：

```text
$0.0504 + 5 × $0.0162
= $0.1314 / active hour
```

Daytona lifecycle 的優勢是 sandbox stopped / paused 後主要只保留 storage billing，archive 可進一步停止資源 billing；而目前 sandbox 預設也會在 15 分鐘 idle 後 auto-stop。citeturn6view0turn14search2

**因此長期維持 $0 的勝者其實是 Modal**，原因不是單價一定比 Daytona 低，而是 Modal 的 **$30/month 是 recurring free credit**；Daytona 的 $200 官方 wording 比較像首次 free compute，不應在財務模型裡假設每月重新送 $200。citeturn23view0turn23view3

### 冷啟動不要用猜的

Modal 官方明確說沒有 warm container 時會 spin up 新 container，也就是 cold start；官方提供多種優化方式，但沒有承諾一個適用所有 image 的固定延遲。citeturn14search3

Daytona 官方宣稱 sandbox 可以在 milliseconds 級啟動，但這是 vendor platform claim，不是與「包含完整 Hermes + Python dependencies + repo checkout」的 Modal endpoint 做同條件 benchmark，因此不宜直接得出「Daytona 一定比 Modal 快」的結論。citeturn23view3

實務上 Jarvis 應優化的是：

```text
Telegram 收到訊息
       │
       ├─ Worker 立刻 ACK
       │
       └─ async trigger Hermes
             │
             └─ Hermes 完成後再 push Telegram
```

而不是要求 Telegram HTTP request 一直等到 40 秒研究任務完成。

### Cloudflare Workers 的角色

Cloudflare Workers Free 目前提供每日 100,000 requests，Free CPU limit 為每 invocation 10 ms；Paid plan 最低 $5/月，之後才進更大量 request / CPU usage pricing。citeturn5view2turn23view5

所以 Worker 完全足夠負責：

```text
驗證 Telegram secret
→ 解析 chat_id / update_id
→ allowlist
→ dedup
→ dispatch Modal / GitHub Action
→ 立即回 200
```

卻**不適合在 Worker 裡直接啟動 Python Hermes agent loop**。

對個人 Jarvis，一天 100 個 Telegram event 都只有 Free request 上限的千分之一量級，request quota 幾乎不會成為瓶頸。citeturn5view2

### GitHub Actions 的角色

GitHub Free 私有 repository 目前含 2,000 GitHub-hosted Actions minutes/月、500 MB artifact storage 與每 repo 10 GB cache；標準 public repository runners 則免費。超過 private Free quota 後，現行 baseline Linux 2-core runner 是約 $0.006/minute。citeturn23view6turn14search10

這非常適合外部 scheduler：

```text
每天 Insight：3 min × 30
每週深度 synthesis：8 min × 4
repo maintenance：10 min × 4

約 162 min / month
```

與 2,000 分鐘額度相比還有大量餘裕。

但我**不建議每一則 Telegram 即時聊天都啟動 GitHub Actions**。Actions 更適合：

- cron replacement；
- overnight research；
- repo maintenance；
- CI/CD；
- 定期 wiki lint / consolidation。

即時手機互動則交給 Modal endpoint。

### 成本總表

| 元件 | 免費範圍 | 超出後 | Jarvis 判斷 |
|---|---|---|---|
| Hermes Agent | MIT 軟體本身無 license fee | 無 Hermes license overage | 核心 |
| Telegram Bot | Bot API 免費 | 無按 message 計價 | 核心。citeturn13search19 |
| Cloudflare Workers | 100k req/day Free，有限 CPU | Paid 最低約 $5/月 | webhook edge。citeturn23view5turn5view2 |
| Modal Starter | $30 compute credit/月 | CPU/RAM 按秒付費 | **推薦 event runtime**。citeturn23view0 |
| Modal Sandbox | 同 credit pool | CPU $0.00003942/core/s；RAM $0.00000667/GiB/s | burst code。citeturn23view2 |
| Daytona | $200 free compute included；非明示 monthly | vCPU $0.0504/h；RAM $0.0162/GiB/h | coding sandbox。citeturn23view3 |
| GitHub Actions private | 2,000 min/月 | Linux 2-core 約 $0.006/min | 外部排程。citeturn23view6turn14search10 |
| Markdown LLM Wiki | filesystem 本身無 API cost | 取決於 host/storage | **canonical KB**。citeturn22view6 |
| Google Drive | Google account 共用 15 GB free storage | 超出改 Google One，價格依區域 | optional mirror。citeturn18search2turn18search8 |
| LLM inference | provider/model 決定 | 可能成為最大成本 | **不能保證 $0**。citeturn16view2turn16view1 |

因此最精確的描述是：

> **「$0 infrastructure floor、pay-only-if-you-use AI」Jarvis，而不是無條件 $0 total-cost Jarvis。**

## 手機、知識庫、Idea 與 Insight Pipeline

### 手機互動設計

Telegram 是第一版最佳入口，不只是因為文字訊息；Hermes adapter 本身已支援 voice memo、images、files 與 scheduled task result delivery。citeturn24search2turn16view4

建議建立四種隱式 intent：

```text
純文字短句
→ note / idea capture

包含 URL
→ source ingestion

「做／實作／debug／deploy...」
→ task / coding

「研究／比較／查...」
→ research
```

使用者不應被迫記 `/capture`、`/research` 等指令。Jarvis 應先從自然語言判斷，只在高風險 destructive action 時要求確認。

Telegram bot 必須鎖 allowlist。Hermes Gateway 的安全預設就是拒絕不在 allowlist 或未配對的 user，官方也建議使用 `TELEGRAM_ALLOWED_USERS`。因為 Telegram profile 可以擁有完整 terminal tools，這不是可省略的設定。citeturn16view5

### URL → LLM Wiki

由於 Telegram 不會展開 `@url:`，建議把下面規則寫入 `SOUL.md` 或 wiki skill instructions：

```text
當 Telegram 訊息包含 URL：

1. 判斷來源類型。
2. YouTube → 優先 youtube-content skill。
3. 一般網頁 → web_extract。
4. 把原文 / metadata 存進 wiki/raw。
5. 抽取：
   - 一句摘要
   - 核心論點
   - 可行動項
   - 與既有 wiki page 的關聯
   - source URL / captured_at
6. 更新 entity / concept page。
7. 更新 index.md。
8. append log.md。
9. Telegram 回覆：
   「已收錄：xxx；新增 2 個 concepts；與 Y 有關。」
```

這與 Hermes 自帶 `llm-wiki` skill 原生模型完全一致：raw source 不改、agent 維護 interlinked wiki pages，由 `SCHEMA.md` 管 taxonomy，由 `index.md` 作 catalog，`log.md` 保留 append-only operation history。citeturn22view6

因此我會選：

**Canonical store：Markdown LLM Wiki + private Git repository。**

**Human UI：Obsidian。**

**Notion：只做選擇性 mirror，不做 source of truth。**

**Google Drive：只做 backup / 文件共享。**

這樣即使 Notion API 或 SaaS pricing 改變，你的私人知識仍然只是 Git 可版本控制的 `.md` 文件。Hermes 本身也已 bundled `llm-wiki`、Obsidian、Notion、Google Workspace 等 skills，所以不需要自行從零寫 integration。citeturn22view3turn20search16

### Idea / 隨手筆記 Pipeline

我建議不要把所有 idea 直接寫 MEMORY.md。

合理流程是：

```text
Telegram:
「idea：做一個 AI agent benchmark viewer」
              │
              ▼
wiki/inbox/2026-08-08-ai-agent-benchmark-viewer.md
              │
              ├─ type: idea
              ├─ captured_at
              ├─ source: telegram
              ├─ status: inbox
              └─ tags
              │
              ▼
每日整理
              │
              ├─ duplicate?
              ├─ existing project?
              ├─ existing concept?
              ├─ actionable?
              └─ worth promoting?
              │
       ┌──────┼────────┐
       ▼      ▼        ▼
    ideas/ projects/ concepts/
```

只有真正長期穩定的資訊才升級成 Hermes Memory，例如：

```text
USER.md:
- User prefers ideas to be captured without asking follow-up questions.

MEMORY.md:
- Canonical knowledge base lives at ~/wiki.
- Side projects use GitHub private repos by default.
```

這符合 Hermes bounded memory 的用途，比把每次靈感都寫進有限的 `MEMORY.md` 更合理。citeturn20search8

而「三個月前我說過哪個 idea？」則交給 `session_search` / FTS5 和 wiki search，而不是硬塞 system prompt。Hermes 的完整 session history 已原生落在 SQLite + FTS5。citeturn24search12

### AI News 與 Insight

原生 Cron 現在已能：

- one-shot / recurring；
- pause / resume / edit / trigger / remove；
- 每 job 掛一個或多個 skill；
- output 回 origin chat、local file 或 platform target；
- fresh agent session 執行；
- 甚至有 no-agent script mode，完全不花 LLM token。citeturn16view9

例如官方直接支援：

```bash
hermes cron create "every 1h" \
  "Summarize new feed items" \
  --skill blogwatcher
```

也支援自然語言要求：

```text
Every morning at 9am,
check Hacker News for AI news
and send me a summary on Telegram.
```

Hermes 會自己使用 `cronjob` tool 建立 schedule。citeturn16view10

Jarvis 可以設兩層：

```text
Daily Collector
07:30 JST
cheap model
↓
抓 AI / agent / model / OSS releases
↓
去重
↓
寫 wiki/raw/news/
↓
Telegram 5 條摘要

Weekly Synthesizer
Sunday 09:00 JST
strong model
↓
讀本週 raw/news
+ 既有 concepts
↓
找 trend / contradiction / implications
↓
產出：
「本週真正值得注意的 3 個變化」
```

Daily job 不需要 frontier reasoning；Weekly synthesis 才值得強模型。Cron 的 per-job model pin、`cron.model` 與 auxiliary models 可以把這個 cost split 原生實現。citeturn16view9turn16view3

但 Strict-$0 serverless profile 有一個關鍵 trade-off：**沒有長駐 scheduler，就不能假設 Hermes 原生 scheduler 在睡眠期間準時 dispatch。** Kanban dispatcher 已明確是 gateway-embedded，而且 gateway 不運作時 ready task 會留在 queue；因此，基於同樣的 runtime 原則，我會讓 strict serverless profile 的時鐘來源放到 GitHub Actions / Modal Scheduler，而 Hermes native Cron 留給 gateway-active profile。這是根據 Hermes gateway/dispatcher 架構做的設計推論。citeturn16view8turn15view5

## Coding、Side Project 與執行安全

### execute_code 應該用在哪裡

`execute_code` 和 `delegate_task` 不應互相替代。

Hermes 官方的判斷很清楚：

```text
需要 reasoning / judgment
→ delegate_task

機械式 multi-step pipeline
→ execute_code
```

`execute_code` 用 Python 對 Hermes tools 做 programmatic RPC，適合把「搜尋 20 頁 → extract → normalize → dedup → 寫 CSV」壓成一個 code execution，而不是模型做二三十次工具呼叫。子 agent 本身也保留 `execute_code`。citeturn21view0

因此 Coding Jarvis 可以這樣分：

```text
需求拆解 / architecture
→ main agent

找 library / API / docs
→ research subagent

大量 mechanical file operation
→ execute_code

build / pytest / npm test
→ Daytona / Modal terminal

security / regression review
→ reviewer subagent
```

### Side Project 安全流水線

推薦：

```text
Telegram：
「幫 sideproject-x 加 OAuth」
        │
        ▼
建立 task branch / git worktree
        │
        ▼
啟用 checkpoint
        │
        ▼
Research subagent
        │
        ▼
Coder
        │
        ▼
execute_code / terminal
        │
        ├─ lint
        ├─ test
        └─ build
        │
        ▼
Reviewer
        │
     pass?
   ┌────┴─────┐
   no         yes
   │           │
   ▼           ▼
coder retry   git diff summary
               │
               ▼
         Telegram 回報
               │
               ▼
        human approve deploy
```

Checkpoint 被啟用後，在 agent 修改檔案、執行 destructive terminal command 前會建立 shadow snapshot；`/rollback diff N` 可以先查看，再決定是否 rollback。citeturn15view3

再配合 Git worktree，researcher、coder、reviewer 不需要競爭同一 working directory。官方也直接把 worktree + checkpoints 視為多 agent coding 的建議安全組合。citeturn15view3

### Daytona vs Modal 用於 coding

對持續 10–60 分鐘、有 repo / package cache / build artifacts 的 coding session，我偏 Daytona。

它的 sandbox 本來就是完整隔離 computer，具有 filesystem、network stack、vCPU/RAM/disk，且提供 lifecycle / auto-stop；這比把每一個 shell call 當 Function invocation 更貼近「遠端開發 workspace」。citeturn14search15turn14search2

對 30 秒的 script、100 個平行 transformation、一次性的 dependency-isolated execution，我偏 Modal。

換言之：

> **Modal 是 lambda-like worker；Daytona 是 disposable remote workstation。**

### GitHub / Hugging Face Deploy

GitHub side projects 很自然，因為 GitHub Actions 在 private GitHub Free 仍有每月 2,000 分鐘 runner quota。citeturn23view6

Hugging Face Spaces 則不應在 2026 年架構裡再無條件標示「免費 compute deployment」。目前官方文件雖仍列 CPU Basic hardware 無 hourly hardware charge，但同時指出建立需要 compute 的 Gradio/Docker Space 可能要求 paid plan。因此它可以是 deployment target，但**不應納入「保證零成本」的核心假設**。citeturn13search4

對真正 $0 side project，我優先排序會是：

```text
static app
→ GitHub Pages / static host

API / scheduled utility
→ Modal

agent test environment
→ Daytona

demo ML app
→ HF Spaces（部署前重新確認當期 account requirement）
```

### 任務完成回手機

這裡有一個非常實用、而且能讓 serverless 架構大幅簡化的原生功能：`hermes send`。

```bash
hermes send --to telegram "deploy finished"

echo "tests passed" | hermes send --to telegram

hermes send \
  --to telegram:-1001234567890 \
  --file /tmp/report.md
```

對 Telegram 等 bot-token 平台，`hermes send` 通常**不需要 gateway 正在運作**；它會直接讀 Hermes credentials 後呼叫平台 API，送完即退出。citeturn24search1turn24search6

這是整個 event-driven Jarvis 很重要的一塊：

```text
Worker wakes job
→ Hermes job executes
→ host exits
→ hermes send pushes result
```

完全沒有「為了回一則 Telegram 而讓 gateway 常駐」的必要。

## Agent Team 與原生多代理編排

### delegate_task 已經比提示詞描述更成熟

現行 `delegate_task`：

- 每個 child 有完全獨立 fresh conversation；
- 繼承 parent enabled toolsets；
- 有自己的 terminal session；
- child 的中間工具輸出不污染 parent context；
- 只有 final summary 回 parent；
- top-level delegation 可 background 執行；
- 預設最多 **3 個 concurrent subagents**，可調，沒有硬上限；
- batches 超過 limit 會報錯，不會偷偷 truncate。citeturn21view0

設定是：

```yaml
delegation:
  max_concurrent_children: 3
  max_spawn_depth: 1
```

預設 `max_spawn_depth: 1` 代表 flat delegation；提高後才可以建立 orchestrator → child-of-child 的樹狀 delegation。官方也特別警告，例如 concurrency 3、depth 3 的 fan-out 可能快速膨脹到 27 個 leaves，成本會乘法放大。citeturn21view0

另外 child agent 並非全功能複製：leaf child 不能自行呼叫 `clarify`、`memory`、`send_message`、`cronjob` 或再次 delegation；但會保留 `execute_code`。這正好形成合理的權限邊界。citeturn21view0

### 建議的短期角色拆解

單次研究任務：

```text
Main Jarvis
│
├─ Researcher A
│    研究官方文件
│
├─ Researcher B
│    找競品 / alternatives
│
└─ Reviewer
     尋找矛盾 / unsupported claims
          │
          ▼
     Main synthesis
```

Coding：

```text
Main Jarvis
│
├─ Researcher
│    查 docs / architecture
│
├─ Coder
│    implementation
│
└─ Reviewer
     test / security / spec compliance
```

這些用 `delegate_task` 就夠，不值得引入 n8n/LangGraph。

### 但「真正的 Agent Team」應該看 Kanban

這是提示詞最值得更新的部分。

2026 Hermes 已有 **native Kanban multi-agent board**，不是只有 transient `delegate_task`。Kanban 使用 durable `~/.hermes/kanban.db`，task/handoff 都寫進 persistent SQLite；不同 named profiles 是獨立 agent processes，可以持久協作。citeturn16view7

官方甚至直接說 Kanban 是為了解決 fragile in-process subagent swarms 的問題。citeturn16view7

因此：

```text
delegate_task
= fork / join
= 短暫平行思考
= 一個 parent turn 的延伸

Kanban
= durable task queue
= persistent named workers
= 跨 session pipeline
= retry / handoff / audit
```

你的長期 Agent Team 最適合：

```text
Telegram
   │
   ▼
Jarvis / orchestrator
   │
   ▼
Kanban task
   │
   ├── researcher profile
   │       ↓
   │    research artifact
   │
   ├── writer profile
   │       ↓
   │    draft
   │
   ├── reviewer profile
   │       ↓
   │    review
   │
   └── coder profile
           ↓
        implementation
```

Kanban 現在有自己的 `kanban_*` toolset，包括 show、list、complete、block、heartbeat、comment、attachments、create、link、unblock 等。citeturn16view7

### 為什麼目前不需要 n8n / LangGraph

對這個私人 Jarvis，我會明確選：

**第一版不要 n8n，也不要 LangGraph。**

因為 Hermes 原生現在已經有：

```text
短期 fan-out             → delegate_task
durable team             → Kanban
schedule                 → Cron
external inbound event   → Webhooks
lifecycle outbound event → Event Hooks
mechanical workflow      → execute_code
persistent behavior      → Profiles / Skills
```

Hermes Webhook adapter 本身還能接受 GitHub、GitLab、JIRA、Stripe 等外部事件，做 HMAC validation、payload → agent prompt 轉換，再把結果送回來源或 Telegram；動態 subscription 也可由 `hermes webhook subscribe` 建立。citeturn17search2turn17search4

Event Hooks 則是反方向：Hermes lifecycle event 發生時主動 POST signed JSON 到其他 HTTP endpoints，因此 inbound + outbound event loop 都已有原生 primitive。citeturn17search6

只有當未來真的遇到「Hermes Kanban 無法描述的 deterministic cross-system orchestration」時，才應引入外部 orchestrator；否則只是多一個 state store、多一套 retry semantics、多一個故障面。

### Strict serverless 對 Kanban 的限制

這裡必須誠實指出：Kanban dispatcher 預設跑在 gateway process 內，60 秒 tick 一次；官方明確說沒有 running gateway 時，`ready` tasks 只會留在 queue，直到 gateway 再起來。citeturn16view8

所以：

```text
完全 scale-to-zero
+
durable Kanban
```

可以共存，但不是「睡著時仍主動工作」。

真正策略應是：

```text
外部事件 / scheduler
→ wake gateway worker
→ dispatcher 消化 ready tasks
→ board empty
→ worker sleep
```

或接受一個低成本 always-on control plane。

### Skills 如何避免 subagent 重複踩坑

Hermes 的 bundled skill catalog 會自動 seed profile，並在 update 時同步官方新增技能。citeturn20search12turn22view3

但對自學、自建 skills，我建議做成一個 canonical skills repository：

```text
jarvis-skills/
├── research-source-quality/
├── ingest-youtube/
├── deploy-modal/
├── project-python-fastapi/
├── review-security/
└── wiki-taxonomy/
```

由 Curator / main profile 負責改進；所有 worker profile 從相同版本同步。不要讓 researcher、coder、reviewer 分別發明三套「怎麼 deploy Modal」的 skill。

對 skill mutation 還應開 write approval。Hermes 已原生支援 skill change staging、`/skills diff`、approve、reject，可避免 agent 在學習過程把一個好 skill 自我修改壞掉。citeturn22view5

## Hermes 原生能力採用矩陣

以下把提示詞功能與 2026 額外功能一起納入，避免只照舊版 47-tool checklist 而漏掉新能力。

| Hermes 能力 | Jarvis 決策 | 理由 |
|---|---|---|
| Self-improving learning loop | **使用** | Jarvis 長期價值核心。citeturn24search8 |
| `MEMORY.md` | **使用** | 只存 durable environment knowledge。citeturn20search8 |
| `USER.md` | **使用** | 使用者偏好與溝通模式。citeturn20search8 |
| Session working context | **使用** | 正常 conversational reasoning。 |
| `state.db` + FTS5 | **使用** | 跨 Telegram / CLI session recall。citeturn24search12 |
| Honcho | **第二階段** | 有明確 deep-user-modeling 需求才開。citeturn20search11 |
| 其他 Memory Providers | **記錄** | OpenViking/Mem0/Hindsight 等先不增加複雜度。citeturn20search4 |
| `.hermes.md` / `AGENTS.md` / `CLAUDE.md` / `.cursorrules` | **使用** | project-specific policy。citeturn1search9 |
| `SOUL.md` | **使用** | Jarvis personality / routing policy。citeturn1search1 |
| Context References `@file/@url/@diff/...` | **CLI 使用** | Telegram gateway 不展開。citeturn15view2 |
| Checkpoints / `/rollback` | **Coding profile 強制開** | destructive change safety；目前 default off。citeturn15view3 |
| Git worktrees | **使用** | multi-agent code isolation。citeturn15view3 |
| Cron | **Native mode 使用** | daily/weekly insights。citeturn16view9 |
| External GitHub Action scheduler | **Strict-$0 使用** | 讓 host 真正 sleep。citeturn23view6 |
| `delegate_task` | **使用** | transient research/code/review parallelism。citeturn21view0 |
| Kanban | **第二階段強烈使用** | durable named-agent team。citeturn16view7 |
| Persistent Goals | **值得使用** | 長期 Jarvis objective management；現為 Automation 功能之一。citeturn16view7 |
| Session Heartbeats | **值得使用** | 長期 session / active-work monitoring。citeturn16view7 |
| Event Hooks | **使用** | push lifecycle events，不輪詢。citeturn17search6 |
| Inbound Webhooks | **使用** | GitHub 等外部事件 → Hermes。citeturn17search4 |
| Batch Processing | **暫緩** | 大批 offline workloads 再啟用；現為 native Automation feature。citeturn16view7 |
| `execute_code` | **使用** | mechanical multi-tool pipelines，降低 tool-loop token cost。citeturn21view0 |
| Tool Search | **使用預設機制** | MCP/plugins 擴大後避免所有 schema 常駐 context。 |
| LSP semantic diagnostics | **Coding profile 使用** | 程式碼 diagnostics。 |
| Curator | **使用** | skills / learned knowledge 維護。 |
| Mixture of Agents | **記錄、暫不核心依賴** | 多模型 ensemble 會增加 inference spend。 |
| Plugins / built-in plugins | **按需** | 不為了完整而全開。 |
| Web search / extraction | **使用** | research / news / URL ingest。citeturn16view0 |
| Browser automation | **使用** | JS-heavy / interactive 網頁。citeturn16view0 |
| Vision | **使用** | Telegram screenshots / image understanding。citeturn16view0 |
| Image generation | **暫不使用** | 與核心 Jarvis 無直接關係。 |
| TTS | **第二階段** | commute / hands-free insight。 |
| Voice mode | **第二階段** | Telegram voice memo 已有價值；Discord real-time voice 非 MVP。citeturn24search2turn16view4 |
| Video tools | **記錄** | 現行 built-in registry 已有 video generation/analyze/edit/extend。citeturn16view0 |
| File tools | **使用** | wiki / coding 核心。citeturn16view0 |
| Terminal / process | **使用** | coding / deploy 核心。citeturn16view0 |
| TODO | **使用** | lightweight personal task state。 |
| Computer Use / Desktop GUI | **暫緩** | serverless Jarvis 不應依賴 desktop state。citeturn16view0 |
| Home Assistant | **第三階段** | 真正做 smart-home Jarvis 時再開。 |
| Spotify tools | **暫不使用** | 非研究目標。citeturn16view0 |
| Feishu tools | **暫不使用** | Telegram-first。citeturn16view0 |
| Yuanbao tools | **暫不使用** | Telegram-first。citeturn16view0 |
| Discord tools | **暫不使用** | 可作未來 desktop/team channel。 |
| MCP | **使用，但少量** | 真正缺 native integration 才加。citeturn16view0 |
| FastMCP skill | **按需** | 自己製作 MCP server 時使用。citeturn20search25 |
| ACP / API Server | **記錄** | 外部 client / agent interoperability 時再啟用。 |
| Provider routing / fallback | **使用** | 控制成本與 availability。 |
| Credential pools | **視 provider 使用** | 大量 concurrent worker 才重要。 |
| Profiles | **使用** | Jarvis / researcher / coder / reviewer。 |
| Telegram | **核心** | mobile UI。citeturn24search2 |
| Discord / Slack / WhatsApp 等 | **暫不使用** | Gateway 已支援，未來可直接擴充。citeturn16view4 |
| Local backend | **開發使用** | troubleshooting。citeturn16view1 |
| Docker backend | **本機 sandbox 使用** | deterministic local execution。citeturn20search26 |
| Daytona backend | **主要 coding sandbox** | workspace-oriented。citeturn16view1 |
| Modal backend | **burst execution 使用** | scale / serverless。citeturn16view1 |
| SSH | **若已有 NAS/VPS 就使用** | incremental infrastructure cost 可為零。 |
| Singularity | **記錄** | HPC 才需要。citeturn16view1 |
| Vercel Sandbox | **記錄** | 第七種現行 backend。citeturn16view1 |
| Bundled `llm-wiki` | **核心** | 正好對應知識庫需求。citeturn22view6 |
| Bundled Obsidian | **使用** | human-facing Markdown knowledge UI。 |
| YouTube content | **使用** | 手機分享影片 → ingest。 |
| Google Workspace | **optional** | Drive/Docs/Gmail/Calendar mirror。citeturn20search16 |
| Notion | **optional** | 不當 canonical DB。 |
| GitHub skills | **Coding 使用** | repo / PR workflow。 |
| Hugging Face | **optional** | 不假設 deployment 永遠免費。citeturn13search4 |
| EVM / Solana / Hyperliquid | **暫不使用但保留** | 真正有 crypto research 才開。citeturn22view4 |
| `agent-browser` optional skill | **不依賴** | 現行 catalog 未列；built-in browser 已足夠。citeturn22view4turn16view0 |

因此這個 Jarvis **不是只使用你提示詞中的 A–F 功能，而是把 2026 Hermes 新增的 Kanban、Persistent Goals、Heartbeats、Hooks、Profiles、Tool Search、Curator、plugins、provider routing 等也一起納入設計。**

## 最小可行部署與設定範例

### 先做可工作的 Hermes + Telegram MVP

Hermes 官方安裝方式：

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

接著配置模型：

```bash
hermes model
```

或走 setup flow：

```bash
hermes setup
```

Hermes 官方 Quickstart 與首頁目前都使用這套 install path。citeturn17search9turn24search13

建立 Telegram bot 後：

```bash
hermes gateway setup
```

Telegram bot token 由 BotFather 建立。citeturn24search2

`~/.hermes/.env`：

```bash
TELEGRAM_BOT_TOKEN=123456789:REPLACE_ME

# 只准自己的 Telegram numeric user ID
TELEGRAM_ALLOWED_USERS=123456789

# Cloud deployment 才設定
TELEGRAM_WEBHOOK_URL=https://jarvis.example.com/telegram
TELEGRAM_WEBHOOK_SECRET=REPLACE_WITH_RANDOM_SECRET

# Knowledge base
WIKI_PATH=/workspace/wiki

# Provider credentials
OPENROUTER_API_KEY=REPLACE_ME

# Coding sandbox，選 Daytona 時
DAYTONA_API_KEY=REPLACE_ME
```

Telegram webhook 與 allowlist 都是 Hermes 官方設定面。citeturn17search0turn16view5

### Hermes config

`~/.hermes/config.yaml` 可以先採：

```yaml
# Coding safety
checkpoints:
  enabled: true
  max_snapshots: 20
  max_total_size_mb: 500
  auto_prune: true
  retention_days: 7

# Prevent self-learning from silently rewriting important skills
skills:
  write_approval: true

# Short-lived parallel agents
delegation:
  max_concurrent_children: 3
  max_spawn_depth: 1

# Start with Daytona for coding work
terminal:
  backend: daytona

# Kanban is phase-two, but prepare defaults
kanban:
  dispatch_in_gateway: true
  dispatch_interval_seconds: 60

# Show timestamps to Jarvis for temporal reasoning
gateway:
  message_timestamps:
    enabled: true
```

Checkpoint defaults與 delegation / Kanban 參數皆有官方現行文件依據。citeturn15view3turn21view0turn16view8

如果改 Modal：

```bash
hermes config set terminal.backend modal
```

改 Daytona：

```bash
hermes config set terminal.backend daytona
```

Terminal backend 名稱以現行七種官方 registry 為準。citeturn16view1

### Wiki 初始化

Bundled `llm-wiki` 已隨 Hermes 安裝，無需另外裝 community package。citeturn22view3turn22view6

建立：

```bash
mkdir -p ~/wiki
export WIKI_PATH="$HOME/wiki"
```

建議結構沿用官方 skill，再加私人 Jarvis inbox：

```text
wiki/
├── SCHEMA.md
├── index.md
├── log.md
├── inbox/
├── raw/
│   ├── articles/
│   ├── papers/
│   ├── transcripts/
│   └── assets/
├── entities/
├── concepts/
├── comparisons/
├── queries/
├── ideas/
├── projects/
└── daily/
```

其中 `SCHEMA.md/index.md/log.md/raw/entities/concepts/comparisons/queries` 都直接源自 Hermes bundled LLM Wiki 架構；`inbox/ideas/projects/daily` 是這個 Jarvis 的擴充。citeturn22view6

### SOUL.md

在 Hermes home 中建立 Jarvis personality：

```markdown
# SOUL

You are my private Jarvis.

## Default behavior

- Use Traditional Chinese unless the task requires another language.
- Be proactive, but conservative with destructive actions.
- Never deploy, delete remote data, merge, or spend money without explicit approval.
- Prefer primary sources for technical research.
- Preserve source provenance in the wiki.

## Telegram capture behavior

When a Telegram message contains only a URL or a URL with a short comment:

1. Treat it as knowledge-base ingestion unless the message clearly asks another question.
2. Do not expect @url syntax; inspect the raw URL yourself.
3. Use web extraction for normal pages.
4. Use the YouTube content skill for YouTube where appropriate.
5. Save raw source metadata before synthesis.
6. Deduplicate against the existing wiki.
7. Add backlinks to related concepts and entities.
8. Reply with a short capture receipt.

When the user writes "idea:", "想法:", or sends a short product thought:

1. Capture it to wiki/inbox first.
2. Classify it later; never discard it because it appears incomplete.

## Coding behavior

Before changing a codebase:

1. Check AGENTS.md.
2. Work in a branch/worktree.
3. Ensure checkpoints are enabled.
4. Run tests after modifications.
5. Report the diff and test status before deployment.
```

`SOUL.md` 和 project context files 是 Hermes 現行原生 context 機制的一部分。citeturn1search1turn1search9

### Wiki repository 的 AGENTS.md

```markdown
# Jarvis Wiki Instructions

The canonical knowledge base is the Markdown tree in this repository.

## Ingestion

Every external source must retain:

- source_url
- captured_at
- title
- author/publisher when known
- published_at when known
- source_type

Never overwrite raw source material after ingestion.

## Classification

New unstructured notes go to inbox/.

Promote mature material into:

- ideas/
- projects/
- entities/
- concepts/
- comparisons/

## Synthesis

Before creating a new concept page:

1. Search existing filenames.
2. Search wiki content.
3. Read SCHEMA.md.
4. Read index.md.
5. Inspect recent log.md entries.

Prefer updating an existing page over creating duplicates.

## Provenance

Separate:
- source claims,
- agent inference,
- user opinion.

Never make an inferred claim appear to come from the source.
```

這也呼應 `llm-wiki` skill 對 session orientation、dedup、schema 與 provenance 的設計。citeturn22view6

### 啟動 Native Gateway

本機驗證可以先用預設 polling：

```bash
hermes gateway start
```

或前景方式執行 gateway 方便看 log。

Cloud/serverless host 則設定前述 Telegram webhook，避免 polling 讓 machine 永遠無法睡。citeturn17search0

先在 Telegram 執行：

```text
/sethome
```

讓 Telegram chat 成為 scheduled result 的 home destination。

### Insight Cron

Native gateway profile 可以直接對 Hermes 說：

```text
每天早上 7:30，
搜尋過去 24 小時 AI agent、LLM tooling、
open-source model 與 developer AI 的重要消息。

優先官方 blog、GitHub release、研究機構與論文原始來源。
去掉與過去七天重複的消息。

先存入 LLM wiki，
最後只把最重要的五件事與你的三點 insight 發到這個 Telegram。
```

Hermes 會透過 `cronjob` 自己建立 natural-language schedule。Cron 支援 natural language、skill attachment、平台 delivery 與 model pin。citeturn16view9turn16view10

CLI 形式也可用：

```bash
hermes cron create "every day at 07:30" \
  "Collect important AI and agent news, deduplicate against the wiki, update the wiki, and produce a concise insight report." \
  --skill blogwatcher \
  --name "Daily AI Insight"
```

語法與多 skill scheduling 均為官方現行介面。citeturn16view10

### Strict-$0 排程替代

若 Gateway 必須真的睡著，可以讓 GitHub Actions 當 clock：

```yaml
name: Daily Jarvis Insight

on:
  schedule:
    # 07:30 JST = 22:30 UTC 前一天
    - cron: "30 22 * * *"
  workflow_dispatch:

jobs:
  insight:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install Hermes
        run: |
          curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"

      - name: Configure secrets
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          mkdir -p "$HOME/.hermes"
          {
            echo "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}"
            echo "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}"
            echo "WIKI_PATH=${GITHUB_WORKSPACE}/wiki"
          } > "$HOME/.hermes/.env"

      - name: Generate insight
        run: |
          hermes chat -q \
            "Review the last 24 hours of important AI-agent developments.
             Prefer primary sources.
             Update the wiki in ./wiki.
             Return a concise daily insight." \
             > /tmp/insight.txt

      - name: Send Telegram result
        env:
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          hermes send \
            --to "telegram:${TELEGRAM_CHAT_ID}" \
            --file /tmp/insight.txt

      - name: Commit wiki updates
        run: |
          git config user.name "Jarvis"
          git config user.email "jarvis@users.noreply.github.com"
          git add wiki
          git diff --cached --quiet || \
            git commit -m "jarvis: daily insight"
          git push
```

`hermes chat -q` 是 Hermes 官方 one-shot noninteractive mode，而 `hermes send` 可以在 Telegram 等 bot-token 平台不啟動 Gateway 的情況下直接投遞。citeturn24search5turn24search1

以個人 daily workflow 而言，這通常離 GitHub Free 的 2,000 Actions minutes/月仍很遠。citeturn23view6

### Agent Team MVP

短期先用 delegation：

```yaml
delegation:
  max_concurrent_children: 3
  max_spawn_depth: 1
```

然後直接對 Jarvis 說：

```text
研究這個 side project idea。

請拆成三個平行工作：
- researcher：市場與技術研究
- architect：提出最小架構
- reviewer：找風險與反例

最後由你整合，
不要讓三個 subagent 重複研究同一件事。
```

Hermes 會自動判斷何時 delegation 合理；官方文件明確說不一定需要使用者手動指定 `delegate_task`。citeturn21view0

成熟後再初始化 persistent team：

```bash
hermes kanban init
hermes gateway start

hermes kanban create \
  "Research the AI agent observability landscape" \
  --assignee researcher

hermes kanban watch
```

這些是現行官方 Kanban CLI；dispatcher 會由 gateway 啟動對應 profile worker。citeturn16view8

### 最後的實際部署選型

若今天真的開始搭，我會採用這組：

```text
手機 UI
Telegram

Webhook ingress
Cloudflare Workers Free

Interactive Hermes runtime
Modal Endpoint
scale-to-zero

Hermes persistent state
persistent volume
+ private Git repo for human-readable artifacts

Canonical knowledge
Hermes bundled LLM Wiki
+ Markdown
+ Obsidian

URL ingestion
web_extract
+ YouTube bundled skill

Short parallel intelligence
delegate_task
max concurrency = 3

Persistent agent team
Hermes Kanban
第二階段啟用

Coding workspace
Daytona
auto-stop

Burst execution
Modal Sandbox

Safety
Telegram allowlist
webhook secret
checkpoints
Git worktrees
skills.write_approval

Daily schedule
GitHub Actions in strict-$0 mode
Hermes Cron in native-gateway mode

Mobile notification
hermes send

External orchestration
n8n / LangGraph = 暫不加入
```

這個選型的核心不是「把所有 Hermes 功能都打開」，而是**所有現行 Hermes 原生能力都已被盤點，但只讓符合私人 Jarvis 任務模型的功能進入 critical path**。最關鍵的原生能力是 persistent memory + FTS5、LLM Wiki skills、Telegram、web/browser、`execute_code`、`delegate_task`、Checkpoints、Profiles/Kanban、Cron/Webhooks/Event Hooks 與 `hermes send`；Modal/Daytona 則應視為可喚醒的執行資源，而不是錯誤地把 serverless 當成一台永遠在線的 VPS。citeturn24search12turn22view6turn24search2turn21view0turn15view3turn16view7turn16view9turn17search4turn17search6turn24search1turn16view1