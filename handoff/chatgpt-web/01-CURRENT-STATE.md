# Jarvis 專案目前狀態

狀態快照：2026-09-30 21:39（Asia/Taipei）。只讀刷新結果已同步至 `ops/inventory.yaml`、`ops/execution.md`、`ops/evidence/p04.json`。

## 階段 Gate

| 階段 | 狀態 | 已知結果 |
|---|---|---|
| P00–P02 | `PASSED` | 私有部署 Repo 與 Wiki Repo 已建立；詳見 `ops/evidence/p02.json`。 |
| P03 | `PASSED` | Discord Preview Endpoint 已驗證；三個真實 Slash Commands 回傳固定文字；目標頻道實際權限收斂並讀回。 |
| P04 | `BLOCKED_APPROVAL` | 本機橋接契約、程式、測試與本機 migration 通過；沒有 P04 遠端 migration、綁定、Secret、App 或部署。 |
| P05–P08 | `NOT_STARTED`／未請求 | 不得越過 P04；P08 排程仍未請求。 |

## P03 已完成內容

- Discord Application：沿用 `Hermes`，Application ID `1511992826815053844`；Guild ID `1488116208426287247`。
- 指定使用者 ID：`249763790709719040`。私有頻道：`#jarvis` ID `1553710999444529233`、`#inbox` ID `1553711115433938945`。
- 已保存 Endpoint：`https://p03-jarvis-ingress.liamlamspace.workers.dev`。此前驗證錯誤根因是本機 Public Key 少一個十六進位字元；已修正，Discord 簽章 PING 驗證及保存讀回通過。除非新讀回有差異，不要重做此診斷。
- `/status`、`/jarvis`、`/capture` 均在核准頻道收到 ephemeral 固定回覆；此時未接入 Queue、Modal、Hermes 或 Wiki。
- Hermes 在目標文字頻道的有效權限為 View Channel + Send Messages；命令僅允許指定使用者與兩個頻道。
- P03 live second-identity 測試 `NOT_RUN`，因沒有合法第二帳號；不得寫成通過，也不阻止 P03 Gate。
- production Worker 未切換；P03 Endpoint 仍指向 Preview。

## P04 本機準備

- 橋接契約：`ops/p04-bridge-contract.md`。
- Worker：`worker/src/bridge.mjs`、`worker/src/security.mjs`、`worker/src/index.mjs`；D1 migration 位於 `worker/migrations/0001_create_p04_job_ledger.sql`。
- Modal 程式：`runtime/modal_app.py`、`runtime/bridge_protocol.py`。
- Node 22.11.0 / Wrangler 4.141.0：`npm test` 19/19 PASS、`npm run check` PASS、`npm run dry-run` PASS；未上傳。
- 本機隔離 D1 migration PASS：`jarvis_jobs` 表及三個索引存在、0 rows；遠端 D1 未遷移。
- Modal SDK 1.5.5：Python `unittest` 3/3 PASS，`py_compile` PASS。FastAPI 固定於 Modal image，但本機 venv 未安裝，因此沒有宣稱 app import/deploy 通過。
- `git diff --check` 與 JSON/JSONC parse PASS。Inventory YAML parser 未安裝；改動以人工檢視，未宣稱機器解析通過。

## 2026-09-30 遠端只讀刷新

使用 Wrangler 4.141.0 與 Modal CLI 1.5.5；沒有遠端寫入。

| 資源 | 最新讀回 |
|---|---|
| Cloudflare 帳戶 | `5ec21083745c46f56581948fe5767c64`；Wrangler OAuth 可用。 |
| production Worker | `jarvis-ingress` 仍為版本 `451b02d7-b87c-43da-b71a-e0da224e42ef`，100% 流量；P04 尚未部署。此版本 HTTP `Hello World!` 的最近實際 GET 證據記於 2026-09-28。 |
| `jarvis-jobs` | ID `8c868ae58295403287b3a1fcf3de59f2`；0 producers、0 consumers。 |
| `jarvis-dead-letter` | ID `93c4b566e0ad40be964f1e5db8cbf805`；0 producers、0 consumers。 |
| Queue backlog metrics | 最新讀取仍是 2026-09-28 16:03 UTC：兩個 Queue 均 0 messages／0 bytes（point-in-time best-effort）。2026-09-30 未刷新；啟用 consumer 前必須重新查。未讀取任何 message body。 |
| D1 `jarvis-control` | ID `de6dbcab-cc2b-4d71-9fa1-f6971cdb9df6`；production、0 tables、12,288 bytes；P04 migration 未執行。 |
| Modal | Workspace `liamlam617`、active environment `main`；0 Apps、0 Secrets、0 Volumes。 |
| Discord Endpoint | 最新成功讀回在 2026-09-28，仍記錄為 P03 Preview URL；本次只讀刷新未重新開啟 Developer Portal。 |

## 工作樹與遠端 Repo

- 本機分支 `main`，HEAD `160491aaa9aa40d5f5016234fac26a7a4fc23a8f`。P03/P04 程式與紀錄目前有未提交變更；請先讀 `git status --short`，保留所有內容，不要 reset、clean 或覆寫。
- 最近已知 GitHub `LiamLam617/jarvis-deploy/main` 遠端提交為 P02 最終版 `e3c60c8e26b7e144f711077ab3d780071820e505`；P03/P04 本機變更尚未推送。`jarvis-wiki` 遠端目前是種子內容，沒有 P06 同步。
- 新 ChatGPT Web 若只能看到 GitHub Repo，便看不到 P03/P04 的本機實作；先確認是否能讀寫目前工作樹。不得為了方便自行推送或上傳私有原始資料。

## 使用者決定與認證邊界

- 使用者選擇跳過 Modal 費用設定，接受目前 Modal spend limit USD 20 與可能的 Volume 儲存費風險，繼續準備部署。沒有改帳單設定；Strict-$0 沒有通過，不得宣稱每月實付為零。
- 這個費用決定不是 P04 遠端寫入批准，也不授權付款方式、升級、儲值或調高上限。
- P03 遠端範圍已批准並完成；P04 精確範圍仍待使用者批准。使用者允許 ChatGPT Web 使用 Computer Use，也不是 P04 批准。
- Bot Token 存在 `%LOCALAPPDATA%\Jarvis\discord-bot-token.xml`，由 Windows DPAPI 保護且不在 Repo。不要讀出或要求貼回。新工作階段不能假設有本機 DPAPI、Wrangler OAuth、Modal CLI 或瀏覽器 cookie。
