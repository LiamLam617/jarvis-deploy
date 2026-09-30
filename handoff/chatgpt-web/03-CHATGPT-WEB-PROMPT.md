# 貼給 ChatGPT Web 的接手提示

```text
請接手 Discord × Hermes 私人 Jarvis 專案。使用者已允許你使用 computer-use skill 操作 Windows 桌面／瀏覽器。所有回覆使用繁體中文。

先讀本交接包的 README.md、01-CURRENT-STATE.md、02-P04-NEXT-STEPS.md，再在可用工作區讀 AGENTS.md、CODEX_OPERATIONS_GUIDE.md、ops/inventory.yaml、ops/execution.md、ops/evidence/p04.json、ops/p04-bridge-contract.md。依這些現況續接，不重提架構方案，不重問文件已有的 Guild、頻道、Application、owner、Repo、Modal workspace/environment、費用決定或已完成的驗收。

你必須先確認 ChatGPT Web 這個工作階段實際能存取哪些檔案、終端/官方 API 工具與瀏覽器視窗。P03/P04 程式目前在本機有未提交修改、尚未同步到 GitHub；若你看不到完整工作樹，不要假裝能修改或測試，也不要自行推送 Repo。只靠本交接 Markdown 無法完成程式部署。

使用 computer-use 前先完整閱讀 computer-use skill，以及它要求的 guidance.md 和 confirmations.md。遵守其規則：使用 skill 指定的 node_repl/@oai/sky 流程；以新快照觀察、一次執行一個動作、立即重新觀察；不可用 UI 自動化 Windows Terminal、PowerShell、登入/密碼視窗、密碼管理器、Windows Run 或 Windows 安全性設定。不要假設目前 Codex 的 Discord、Cloudflare 或 Modal 登入 session 會共享到 ChatGPT Web。需使用者登入、2FA、CAPTCHA、敏感憑證或即時確認時，只提出最小必要的人工作業；絕不要求把 Bot Token、API token、secret、cookie 貼進聊天。

P03 已通過。P04 本機實作與測試已通過，但遠端變更仍為 BLOCKED_APPROVAL。使用者允許使用 computer-use skill，不是 P04 遠端寫入批准。開始遠端寫入前，按 02-P04-NEXT-STEPS.md 與 ops/evidence/p04.json 的精確範圍，重新向使用者取得 P04 明確批准；不要預設批准。未批准時，只做有用的本機工作與只讀盤點。

批准後依 02-P04-NEXT-STEPS.md 順序操作。先刷新 Queue backlog、D1、Modal 和 Worker 狀態；Queue backlog 非零或無法確認時先停。每一階段通過後才進下一步，實際讀回、測試、失敗與阻塞寫入 ops/evidence/p04.json、ops/inventory.yaml、ops/execution.md。P04 通過前不得開始 P05；不可更改 Modal billing、Discord Endpoint 或擴大批准範圍。

請先確認你是否能讀寫目前完整工作樹，以及這個 ChatGPT Web 工作階段是否真的提供 computer-use skill；回覆目前存取狀況與下一個具體步驟。不要把任何尚未執行的測試寫成通過。
```
