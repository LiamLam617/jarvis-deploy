# 下一步：P04 Queue → Modal 固定回覆

## Gate 狀態

P04 本機準備通過，但階段狀態仍是 **`BLOCKED_APPROVAL`**。之前提出的精確遠端範圍仍未獲明確批准。使用者允許 ChatGPT Web 使用 `computer-use` skill，不代表批准 P04 遠端變更。

開始任何遠端寫入前，先讀 `ops/evidence/p04.json` 的 `approval_scope_requested`，用繁體中文簡要重述影響，請使用者明確批准或拒絕。未取得明確批准，只可做本機工作及不改變狀態的讀取。

## 待批准的精確 P04 範圍

1. 只把 `worker/migrations/0001_create_p04_job_ledger.sql` 這份 additive migration 套用到現有、目前讀回為空的 production D1 `jarvis-control`；不可清空資料庫或採破壞性 migration。
2. 將現有 P03 Preview 綁到這個 D1 與既有 `jarvis-jobs` Queue producer。兩者是共用真實遠端資源，不是隔離測試資源。
3. P04 Preview 將最多 1,200 字元 prompt 或 2,048 字元 URL 暫存於 D1，最久至成功回覆或 15 分鐘 interaction expiry。Interaction token 只以 AES-GCM 密文保存；Queue message、一般 logs 不含 prompt、URL 或 token；Modal runner 不取得 prompt／URL。
4. 在 Modal Workspace `liamlam617`、Environment `main` 建立 `jarvis-runtime-secrets`，部署 `jarvis-runtime`：min containers 0、max 1、timeout 300 秒、retry 1；不配置 GPU、Volume、Hermes、模型或 Wiki 存取。
5. 設定 P03 Preview 所需的 `JARVIS_REPLY_ENCRYPTION_KEY`、`JARVIS_INTERNAL_SECRET`、`MODAL_DISPATCH_URL`；設定 production queue consumer 所需的 `JARVIS_INTERNAL_SECRET`、`MODAL_DISPATCH_URL`；Modal Secret 保存共享 HMAC secret 與回呼至 P03 Preview 的 URL。秘密值不得進聊天、Repo、process argv 或 logs。
6. 將 `jarvis-ingress` 的 P04 production Worker 版本部署為 100% 流量，註冊唯一 Queue consumer：batch size 1、max concurrency 1、3 retries、30 秒 delay、既有 DLQ。`P04_QUEUE_ONLY=1` 保留已觀測的 production HTTP `Hello World!` 回應；Discord Endpoint 留在 P03 Preview。這仍是 production Worker 版本變更，必須涵蓋在批准中。
7. 遠端部署後，實測 Discord deferred/final reply、重複事件、Queue/Modal retry、D1 job/reply 狀態與 15 分鐘 expiry。P04 通過前不可進入 P05。

上述內容應與 `ops/evidence/p04.json` 完全一致；如 Web 端看見檔案版本不同，以最新工作區證據為準，先更新批准摘要再詢問。

## 批准後的順序

1. **刷新現況**：重新驗證帳戶、Queue、D1、Modal environment、Worker deployment、Discord Endpoint。使用者對此專案既有登入不得假設跨工作階段共享。Queue backlog 指標必須在啟用 consumer 前重新讀取；若 backlog 非零或讀取失敗，先停止並報告，不要讓新 consumer 消費未知積壓。
2. **確認工作樹與測試**：確認 ChatGPT Web 取得目前完整本機工作樹及未提交修改；保留它們。重跑適用的本機測試、`npm run check`、Wrangler dry-run、Python tests、`py_compile`、`git diff --check`。未成功的測試不得標 PASS。
3. **執行 additive D1 migration**：再次確認 `jarvis-control` ID、環境與 schema；套用 migration 後讀回表、索引與 row counts。
4. **設定 Preview 與 Modal**：先創建安全 secret，再部署受限 Modal App；讀回 App 設定、URL 及 secret 名稱，不讀回值。Secrets 只能使用官方安全輸入途徑；任何由 Windows UI 建立 persistent key／secret 的步驟，另遵從 Computer Use 即時確認規則。
5. **註冊 production Queue consumer**：部署前再次讀 backlog；部署後讀回 Worker version、100% traffic、producer/consumer counts 與設定。確認 `P04_QUEUE_ONLY=1`，production HTTP response 保持原行為，Discord Endpoint 仍是 P03 Preview。
6. **執行 live P04 測試**：使用核准 Guild、使用者和兩個頻道，不送真實私人 prompt/URL；驗證去重、重試、回覆、狀態及到期清除。只檢視必要的遮罩日誌，不讀 queue body 或洩漏 token。
7. 每個子步驟完成後即記錄真實讀回與阻塞到 `ops/evidence/p04.json`、`ops/inventory.yaml`、`ops/execution.md`。只有所有 P04 驗收通過，才把 P04 設為 `PASSED`；然後停止在 P05 閘門，不自動擴大功能。

## 已知平台限制

Cloudflare 文件確認 Worker Preview 可以送 Queue 訊息，但不能消費；使用同一 D1 ID／Queue 名稱的 Preview 會共用遠端資料。因此必須部署 production Worker consumer 才能完成這個 Preview-to-Queue 流程。參考：[Preview resources](https://developers.cloudflare.com/workers/previews/resources/)、[Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/)。

## 立即不可做的事

- 未批准前不得跑 `wrangler d1 migrations apply ... --remote`、設定遠端 binding/secret、建立 Modal Secret/App、部署 production Worker 或改 Discord Endpoint。
- 不得切換 Discord Endpoint 到 production；不進 P05，不建立 Volume，不執行 Hermes 或模型。
- 不改 Modal 帳單，不使用付款方式、升級、儲值或調整 $20 spend limit。
- 不推送 P03/P04 本機變更到 GitHub，不 reset/clean 未提交工作樹。
