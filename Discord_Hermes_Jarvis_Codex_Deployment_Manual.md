# Codex 部署手冊：Discord Hermes Jarvis MVP

版本：v1.1

## 目的

建立一套私人 AI Agent Jarvis：

-   Discord 作為對話入口
-   Hermes 作為 Agent Runtime
-   GitHub Markdown Wiki 作為長期知識庫
-   Modal 作為事件驅動執行環境
-   Daytona 作為 Coding Sandbox（第二階段）

核心原則：

> 不把 Hermes 當成永遠在線 VPS，而是拆分控制平面與執行平面。

------------------------------------------------------------------------

# 1. 最終部署架構

``` text
Discord
   |
Discord Bot API
   |
Cloudflare Worker
   |
Modal Runtime
   |
Hermes Agent

   |
   +---- GitHub Wiki
   |
   +---- Modal Sandbox
   |
   +---- Daytona Sandbox
```

------------------------------------------------------------------------

# 2. 是否需要本機環境？

## 結論

MVP 不需要本機常駐環境。

完整雲端部署：

``` text
Discord
   |
Cloudflare
   |
Modal
   |
Hermes
   |
GitHub
```

使用者端只需要：

-   瀏覽器
-   Discord App
-   Codex

------------------------------------------------------------------------

## 本機環境的用途

本機不是 Production Server。

用途：

### 開發測試

確認：

-   Hermes 安裝
-   Discord Bot
-   Model 設定
-   Skills

### Debug

可用 Docker 測試：

``` text
本機 Docker
      |
      |
Cloud Runtime
```

### 搬移現有設定

若已有：

-   wiki
-   repo
-   Hermes config

可先整理再部署。

------------------------------------------------------------------------

# 3. 元件部署位置

  元件             部署位置             是否常駐
  ---------------- -------------------- ----------
  Discord Bot      Discord Cloud        否
  Gateway          Cloudflare Workers   否
  Hermes Runtime   Modal                否
  Wiki             GitHub Repository    是
  Memory           Persistent Storage   是
  Coding Sandbox   Daytona              否
  Burst Job        Modal Sandbox        否

------------------------------------------------------------------------

# 4. Discord

部署位置：

Discord Cloud

負責：

-   使用者輸入
-   Channel 管理
-   Bot API

建議 Channels：

``` text
#jarvis
主對話

#inbox
想法收集

#research
研究任務

#coding
程式開發

#review
審查

#daily-insight
每日摘要

#agent-log
系統紀錄
```

------------------------------------------------------------------------

# 5. Cloudflare Worker

部署位置：

Cloudflare Workers

用途：

-   接收 Discord Event
-   驗證來源
-   權限控制
-   啟動 Hermes

不要：

``` text
Cloudflare Worker
直接執行 Hermes
```

原因：

Worker 適合做 ingress，不適合長時間 Agent loop。

------------------------------------------------------------------------

# 6. Hermes Runtime

部署位置：

## MVP：

Modal

架構：

``` text
Discord Event

↓

Cloudflare Worker

↓

Modal HTTP Function

↓

Hermes
```

優點：

-   scale-to-zero
-   無 idle server
-   按需求啟動

------------------------------------------------------------------------

# 7. Storage

## GitHub Private Repository

保存：

``` text
wiki/

SOUL.md

AGENTS.md

skills/

projects/
```

用途：

-   版本控制
-   Backup
-   Rollback

------------------------------------------------------------------------

## Persistent Storage

保存：

``` text
MEMORY.md

USER.md

state.db
```

用途：

-   長期記憶
-   Session History

------------------------------------------------------------------------

# 8. Wiki

推薦：

``` text
GitHub Private Repository
+
Markdown
+
Obsidian
```

結構：

``` text
wiki/

├── raw/
├── concepts/
├── entities/
├── ideas/
├── projects/
└── index.md
```

------------------------------------------------------------------------

# 9. Coding Sandbox

## Daytona

用途：

-   Clone Repository
-   Build
-   Test
-   Debug

流程：

``` text
Discord

↓

Hermes

↓

Daytona Sandbox

↓

Coding

↓

Test

↓

Report
```

------------------------------------------------------------------------

## Modal Sandbox

用途：

-   短任務
-   Batch Processing
-   Research Job

------------------------------------------------------------------------

# 10. 排程模式

## Strict \$0 Mode

使用：

``` text
GitHub Actions
```

適合：

-   Daily Insight
-   Weekly Report
-   Wiki Maintenance

流程：

``` text
GitHub Actions

↓

Hermes

↓

Discord Notification
```

------------------------------------------------------------------------

## Hermes Native Mode

使用：

-   常駐 Gateway
-   NAS
-   VPS

優點：

完整支援：

-   Cron
-   Kanban
-   Persistent Agent

缺點：

需要長駐資源。

------------------------------------------------------------------------

# 11. Codex 部署流程

## Phase 1

建立：

-   Discord Bot
-   Cloudflare Worker
-   GitHub Repo

驗證：

``` text
Discord Message

↓

Worker 收到
```

------------------------------------------------------------------------

## Phase 2

部署：

``` text
Modal Hermes
```

驗證：

``` text
Discord

↓

Hermes Reply
```

------------------------------------------------------------------------

## Phase 3

加入：

-   USER.md
-   MEMORY.md
-   Wiki

驗證：

``` text
URL

↓

Wiki Entry
```

------------------------------------------------------------------------

## Phase 4

加入：

-   Daytona
-   Coding Workflow

------------------------------------------------------------------------

# 12. Codex 工作規則

每次修改前：

1.  檢查目前狀態
2.  不覆蓋使用者資料
3.  保留設定備份
4.  小步修改
5.  測試後再進下一步

回報格式：

``` text
## Completed

完成：

- xxx


## Deployment Location

xxx


## Changed Files

xxx


## Test Result

PASS / FAIL


## Next Step

xxx
```

------------------------------------------------------------------------

# 13. MVP 驗收

完成：

## 基本聊天

``` text
Discord

@Jarvis hello
```

收到回答。

## 知識捕捉

輸入：

``` text
URL + 整理
```

結果：

-   讀取來源
-   建立 Wiki
-   回覆摘要

## Research

輸入：

``` text
分析這個 side project
```

結果：

-   產生分析
-   儲存知識
-   回報 Discord

------------------------------------------------------------------------

# 14. 最終部署

``` text
                 Discord

                    |

            Cloudflare Worker

                    |

                 Modal

                    |

              Hermes Jarvis

          /          |          \

       Wiki       Coding      Research

       GitHub     Daytona      Modal

                    |

              Discord Reply
```

------------------------------------------------------------------------

# 第一個 Codex 任務

不要直接安裝。

先建立：

Deployment Inventory

確認：

1.  Discord 帳號與 Bot 狀態
2.  Cloudflare 狀態
3.  Modal 狀態
4.  GitHub Repository
5.  Secrets 管理方式
6.  預計 Runtime 配置
