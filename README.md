# 長照人員教育訓練積分查詢與效期管理系統 (v5.0 雲端整合版)

本專案由原 Python Tkinter GUI 應用程式完整轉移至網頁版 (React + TS + Vite + Firebase)，並整合了多租戶機構權限管理與自動化小卡起訖日儲存功能。

---

## 🛠️ 技術棧 (Technology Stack)
* **前端核心**：React (Vite) + TypeScript
* **樣式設計**：Vanilla CSS (極簡暗黑毛玻璃 Glassmorphism，支援高度互動 hover 動畫與表單驗證)
* **資料解析**：SheetJS (`xlsx`)，支援在瀏覽器端本機直接解析衛福部匯出之 Excel
* **後端服務**：Firebase (Authentication 驗證 + Cloud Firestore 資料庫)
* **版本控管**：Git (已內置安全過濾機制，自動排除私密憑證 `.env` 與上傳的學員資料 `.xlsx`/`.csv`)

---

## 📝 核心積分計算邏輯與規則 (Business Rules)
本系統之核心統計演算法定義於 [`src/calculator.ts`](file:///c:/Users/MAC/Desktop/ltcp_manager/src/calculator.ts)，整合了以下法規邏輯：
1. **換證總分要求**：須達 **120 分**。
2. **專業品質、倫理、法規 (QER)**：最低要求 **24 分**，且採計上限為 **36 分**。
3. **線上課程 (Online) 上限判定**：
   * 依據學員小卡**生效日期**判定：
     * 生效日期在 **民國 112 年 10 月 12 日前 (含)**：線上課程採計上限為 **60 分**。
     * 生效日期在 **民國 112 年 10 月 12 日後**：線上課程採計上限為 **40 分**。
4. **四大核心課程 (消防、緊急、感控、性別)**：
   * 每科積分皆須 **$\ge 1$ 分**。
   * 四科總分累計須 **$\ge 10$ 分**。
5. **多元與原住民文化課程**：
   * 舊制文化敏感度課程：上限採計 **2 分**。
   * 新制：缺「原住民族文化」（需 $\ge 1$）或缺「多元族群文化」（需 $\ge 1$）均會於日誌及 CSV 中印出警告。
6. **同步線上課程實體認定**：`01-3 視訊課程` 預設歸類為**實體課程**以利積分統計。

---

## 📅 效期雙向自動計算邏輯
為了減輕使用者手動計算負擔，表格欄位具備雙向推算：
* **生效日期 $\rightarrow$ 到期日**：`生效日期 + 6 年 - 1 天`（例如：`112/09/01` $\rightarrow$ `118/08/31`）。
* **到期日 $\rightarrow$ 生效日期 (回推)**：`到期日 + 1 天 - 6 年`（例如：`118/08/31` $\rightarrow$ `112/09/01`）。

---

## 🔒 角色權限管理 (RBAC) & 資料庫架構
系統區分兩種登入角色，資料存放於 Firestore 中以確保多租戶資料完全隔離：

### 1. 資料庫結構 (Firestore Schema)
* **`users/{uid}`** (用戶基本檔)：
  ```json
  {
    "email": "string",
    "name": "string (機構名稱)",
    "orgId": "string (機構專屬ID)",
    "role": "user | admin"
  }
  ```
* **`organizations/{orgId}/student_cards/{studentId}`** (學員效期儲存庫)：
  ```json
  {
    "name": "string (姓名)",
    "effectiveDate": "string (生效日期, 如 112/09/01)",
    "expiryDate": "string (到期日, 如 118/08/31)",
    "updatedAt": "string (ISO timestamp)"
  }
  ```

### 2. 角色權限定義
* **一般機構用戶 (`role === 'user'`)**
  * 系統預設註冊角色。
  * 僅能 CRUD 本身機構 (`orgId`) 的學員小卡資料，無法看到超級管理員控制面板。
* **超級管理員 (`role === 'admin'`)**
  * 須由管理員在 Firebase Console 中，手動將該 `users/{uid}` 文件中的 `role` 欄位設為 `"admin"`。
  * 登入後會載入「👑 超級管理員控制面板」，可以切換並 CRUD 系統中所有註冊機構的學員資料。

---

## ⚡ Mock 本地測試模式 (LocalStorage Fallback)
若未配置環境變數，系統會自動切換為本地 Mock 模式以利單機測試。此模式預設了兩組測試帳密：
* **一般用戶帳密**：
  * 帳號：`test@example.com`
  * 密碼：`password`
* **超級管理員帳密**：
  * 帳號：`admin@example.com`
  * 密碼：`adminpassword`
* **忘記密碼模擬**：Mock 模式下點擊忘記密碼，系統會直接在瀏覽器彈出視窗（`alert`）中模擬出密碼重設網址。

---

## 🚀 環境變數與連線設定 (`.env`)
當準備連接真實的 Firebase 服務時，請在專案根目錄下建立 [`.env`](file:///c:/Users/MAC/Desktop/ltcp_manager/.env) 檔案並填寫：
```env
VITE_FIREBASE_API_KEY=你的_API_Key
VITE_FIREBASE_AUTH_DOMAIN=你的_Auth_Domain
VITE_FIREBASE_PROJECT_ID=你的_Project_Id
VITE_FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=你的_Sender_Id
VITE_FIREBASE_APP_ID=你的_App_Id
```
*(注意：修改 `.env` 後需要重啟開發伺服器才會生效。)*

同時請在你的 Firebase Console 啟用 **Firestore Database (default)**，並在 **Authentication** -> **Sign-in method** 中啟用 **Email/Password** 登入。
安全規則請直接參考並套用專案中的 [`firestore.rules`](file:///c:/Users/MAC/Desktop/ltcp_manager/firestore.rules)。
