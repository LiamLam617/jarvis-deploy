# ChatGPT Web 分階段提示詞

依實際進度選用，不要一次貼上所有提示。P04 尚未批准；Computer Use 的使用許可不等於 P04 遠端寫入許可。

## A. 初次接手與唯讀盤點

```text
請接手 Jarvis 專案，所有回覆使用繁體中文。先讀交接包 README.md、01-CURRENT-STATE.md、02-P04-NEXT-STEPS.md、03-CHATGPT-WEB-PROMPT.md；若本工作階段能讀取專案，再讀 AGENTS.md、CODEX_OPERATIONS_GUIDE.md、ops/inventory.yaml、ops/execution.md、ops/evidence/p04.json 與 ops/p04-bridge-contract.md。

先確認你能否讀寫目前完整工作樹、是否看到未提交的 P03/P04 變更、目前有哪些 CLI／官方 API 工具，以及 ChatGPT Web 這個工作階段是否真的提供 computer-use skill。若使用 skill，先讀完整 SKILL.md 及它要求的 guidance.md、confirmations.md；不得假設其他 Codex 工作階段的登入 session 或本機憑證共享。

先做 P00 式只讀盤點，刷新 Cloudflare Worker/Queue/D1、Modal workspace/environment 與 Discord Endpoint 的現況。不要讀 queue message body，不顯示或輸出秘密。完成後回報：可用工具、目前階段、與交接文件相比的資源差異、未提交工作樹是否可用、下一個最小動作。

此時不得做任何遠端寫入、migration、Secret/App 建立、正式部署、Discord 設定變更或 Git push。P04 尚為 BLOCKED_APPROVAL；先完成盤點後再依下方提示請求批准。不要重問文件已列出的 ID、owner、頻道、Repo 或費用決定。
```

## B. 盤點完成後，請求 P04 明確批准

```text
請依目前最新讀回與 ops/evidence/p04.json 的 approval_scope_requested，向我提出一次明確的 P04 階段批准問題。只在最新資源狀態沒有未處理差異時提出；否則先說明差異及影響，暫停批准請求。

批准摘要必須說清楚：
1. 對現有 production D1 jarvis-control 套用唯一 additive migration 0001；不清空資料。
2. P03 Preview 綁定現有 D1 與 jarvis-jobs Queue producer，這些是真實共用資源。
3. 建立 Modal jarvis-runtime-secrets，部署 jarvis-runtime（min 0、max 1、timeout 300 秒、retry 1，無 GPU/Volume/Hermes/模型/Wiki）。
4. 設定 P03 Preview 與 production Queue consumer 所需 secrets/URL；絕不把秘密值貼到聊天或普通日誌。
5. 將 jarvis-ingress 新版本部署到 production 100% 以註冊唯一 Queue consumer（batch 1、concurrency 1、3 retries、30 秒 delay、既有 DLQ）。P04_QUEUE_ONLY=1 保留目前 Hello World HTTP 行為，Discord Endpoint 保持 P03 Preview。
6. 部署後執行 deferred/final reply、重複事件、Queue/Modal retry、D1 狀態和 15 分鐘 expiry 的 live 測試；P04 完成前不進 P05。

明確寫出這會修改真實 D1／Queue／Modal 資源，並把 Worker 正式流量版本換成新的 100% 版本；雖保留 HTTP 回覆與 Discord Preview Endpoint，仍屬 production Worker 部署。要求我回答「批准上述 P04 範圍」或「不批准，暫停 P04」。在收到我的直接明確批准前，不執行任何依賴批准的遠端操作。
```

## C. 使用者已明確批准上述 P04 範圍後

```text
這段提示詞本身不是批准。請先確認本對話中我已直接、明確批准 ops/evidence/p04.json 所列、且你剛才逐項重述的 P04 範圍；若沒有，停止並回到 B 提示詞請求批准。只有批准確實來自我，且最新資源讀回與批准摘要相符、目前工作樹可用且未提交變更已保留、本機必要測試通過時，才繼續。

依 02-P04-NEXT-STEPS.md 的次序逐項執行；使用 CLI／官方 API 完成可自動化工作，Computer Use 僅用於必要的 Dashboard UI，並遵守其 action-time confirmation、安全登入與視窗操作規則。啟用 Queue consumer 前重新查 backlog metrics；若 backlog 非零、metrics 無法讀回、D1 已有未預期 schema/data、Modal 資源有漂移、或程式/批准範圍不一致，立即停在該閘門並記錄阻塞，不要自行清除、覆寫或擴大範圍。

每個成功寫入後先讀回並驗收，再進下一個步驟。真實憑證不得進聊天、Repo、命令列參數、截圖或一般日誌。將每個實際結果、未通過測試與阻塞同步寫入 ops/evidence/p04.json、ops/inventory.yaml、ops/execution.md。只有所有 P04 live 驗收均通過才標示 P04 PASSED；隨後停止，不開始 P05。
```

## D. 使用者拒絕、尚未批准或發生阻塞

```text
目前沒有 P04 遠端寫入批准，或 P04 的前置條件／最新狀態未通過。請停止所有遠端寫入、secret/app 建立、migration、部署與 Discord 設定變更。只做不依賴批准的本機文件、程式或測試工作；保留未提交工作樹，不推送、不 reset、不 clean。

把目前狀態記錄為 BLOCKED_APPROVAL 或對應的具體 BLOCKED_*，附上時間、已觀測證據、實際錯誤與唯一必要的下一步。不要把未執行測試標為通過；不要重複索取已記錄的帳號、ID 或費用決定；不要自動進入 P05。
```
