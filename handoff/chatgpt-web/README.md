# Jarvis 專案：ChatGPT Web 接手包

狀態快照：2026-09-30 21:39（Asia/Taipei）

目前階段：**P04 — `BLOCKED_APPROVAL`**

本交接包說明如何續接既有工作，不構成任何新的遠端寫入批准。

## 交接前請提供

1. 將本資料夾的五份 Markdown 提供給 ChatGPT Web。第一次貼上 [`03-CHATGPT-WEB-PROMPT.md`](03-CHATGPT-WEB-PROMPT.md)；需要分情境操作時，從 [`04-CHATGPT-WEB-PROMPTS.md`](04-CHATGPT-WEB-PROMPTS.md) 選用提示詞。
2. 若希望它改程式並執行測試，還要讓它讀寫目前完整工作樹。P03/P04 變更目前只在本機未提交工作樹，尚未同步到 GitHub `jarvis-deploy/main`；單獨提供這些 Markdown 不含程式碼。
3. 告知 ChatGPT Web 可以使用 `computer-use` skill。它仍須先確認該工作階段實際提供此 skill、實際看到的視窗，以及能否讀寫目前專案；不得假設目前 Codex 的瀏覽器登入狀態或本機 CLI 認證會自動共享。

## 文件閱讀順序

1. `01-CURRENT-STATE.md`：已完成階段、目前環境讀回、程式與認證限制。
2. `02-P04-NEXT-STEPS.md`：P04 明確待批准的精確範圍、執行順序與驗收條件。
3. `03-CHATGPT-WEB-PROMPT.md`：可直接貼入 ChatGPT Web 的接手指示。
4. `04-CHATGPT-WEB-PROMPTS.md`：首次盤點、請求 P04 批准、批准後執行、拒絕／阻塞時使用的提示詞。

## 本專案的權威來源

ChatGPT Web 開始操作前，仍須在可用工作區重新閱讀：

- `AGENTS.md`
- `CODEX_OPERATIONS_GUIDE.md`
- `ops/inventory.yaml`
- `ops/execution.md`
- `ops/evidence/p04.json`
- `ops/p04-bridge-contract.md`

之後依指南檢查第一個未通過階段與真實資源。這包摘要不能覆蓋較新的工作區記錄；如有差異，先讀回並記錄現況，不猜測、不重建既有資源。

## Computer Use 操作界線

使用者允許 ChatGPT Web 使用 `computer-use` skill。執行 Windows UI 操作前，依 skill 先讀完整 `SKILL.md`，以及其中要求的 `guidance.md` 和 `confirmations.md`。若 Web 工作階段有該 skill，依規定透過 `node_repl` 與 `@oai/sky` 操作；不可透過 UI 自動化 Windows Terminal、PowerShell、登入／密碼視窗、密碼管理器、Windows Run 或安全性設定。登入、2FA、CAPTCHA、輸入敏感憑證與 skill 指定需即時確認的動作，由使用者接手或即時確認。

Computer Use 授權只表示可在 skill 規則內操作 UI；它**不等於** P04 遠端寫入批准，也不會擴大 P03 權限或改變 Modal 費用決定。

## 不可交接的機密

任何 Bot Token、Modal token secret、Cloudflare 憑證、`JARVIS_INTERNAL_SECRET`、`JARVIS_REPLY_ENCRYPTION_KEY`、interaction token、cookies 或瀏覽器 profile 都不得寫進這些文件、貼到對話、截圖或 Git。Discord Bot Token 已由使用者存於 Windows DPAPI 保護的 Repo 外位置；新工作階段不得要求使用者貼回 token。CLI/API 認證亦不可假設可跨 ChatGPT Web 工作階段使用。
