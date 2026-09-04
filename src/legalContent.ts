/**
 * 隱私權政策與服務使用條款的內容
 * ---------------------------------------------------------------------------
 * 存成結構化資料而不是一段 HTML 字串或外部 .txt：
 *
 *   - 純文字檔連結出去，使用者看到的是一片無格式的字，而且離開了程式的深淺色主題
 *   - 直接塞 HTML 字串就得用 dangerouslySetInnerHTML，為了排版開一個 XSS 面
 *
 * 條文內容是法務文件，**逐字照抄，不要順稿**。要改內容請改這裡，
 * 並同步更新 lastUpdated。
 */

export interface LegalSection {
  heading: string;
  /** 段落。與 bullets 可以並存，段落先出現 */
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  /** 開頭那一句總述 */
  intro: string;
  /** 更新日期與適用範圍 */
  meta: string;
  sections: LegalSection[];
}

export const COMPANY_NAME = '知多思科技股份有限公司';
export const COMPANY_TAX_ID = '90598296';
export const CONTACT_EMAIL = 'service@gogocare.com.tw';

export const PRIVACY_POLICY: LegalDocument = {
  title: '隱私權政策',
  intro: `我們重視您的個人資料保護。本政策說明 ${COMPANY_NAME} 如何蒐集、使用與保護您的資料。`,
  meta: `最後更新日期：2026 年 7 月 02 日。本政策適用於 ${COMPANY_NAME}（統一編號 ${COMPANY_TAX_ID}）`
    + '所經營之長照萬事屋（https://portaly.cc/Care.Yorozuya）網站及其雲端軟體服務。',
  sections: [
    {
      heading: '1. 我們蒐集的資料',
      bullets: [
        '您主動提供：當您填寫預約 Demo 表單或來信時提供的姓名、單位名稱、Email、電話與訊息內容。',
        '服務使用資料：使用本公司服務時所建立之帳號與營運資料（依服務合約另定資料處理條款）。',
        '自動蒐集：瀏覽器類型、裝置資訊、IP 位址與網站使用紀錄（透過 Cookie 與分析工具）。',
      ],
    },
    {
      heading: '2. 使用目的',
      bullets: [
        '回覆您的諮詢、安排產品展示與後續服務。',
        '提供、維運與改善本公司服務。',
        '網站流量分析與使用體驗優化。',
        '依法令要求或主管機關通知配合提供。',
      ],
    },
    {
      heading: '3. 個資法依據',
      paragraphs: [
        '我們依《個人資料保護法》蒐集、處理及利用您的個人資料，蒐集之特定目的包含：行銷、客戶管理與服務、契約或類似契約之事務。',
      ],
    },
    {
      heading: '4. 資料保存與安全',
      paragraphs: [
        '您的資料儲存於部署在 GCP（亞太地區）之雲端環境，採 HTTPS 加密傳輸、帳密加密儲存、組織間資料完全隔離，並具備稽核日誌與每日備份。我們僅在達成蒐集目的之必要期間內保存您的資料。',
      ],
    },
    {
      heading: '5. 資料分享與第三方',
      paragraphs: [
        '除下列情形外，我們不會將您的個人資料出售或提供給第三方：(a) 取得您的同意；(b) 為提供服務所必要之雲端／分析等委外處理者（受保密義務拘束）；(c) 法令規定或主管機關、司法機關依法要求。',
      ],
    },
    {
      heading: '6. Cookie',
      paragraphs: [
        '本網站使用 Cookie 與類似技術以維持功能與分析流量。您可透過瀏覽器設定拒絕 Cookie，但部分功能可能受影響。',
      ],
    },
    {
      heading: '7. 您的權利',
      paragraphs: [
        `依個資法，您得就您的個人資料行使查詢、閱覽、補充更正、停止蒐集處理利用及刪除等權利。如需行使，請來信 ${CONTACT_EMAIL}。`,
      ],
    },
    {
      heading: '8. 聯絡我們',
      paragraphs: [`如對本政策有任何疑問，請聯絡：${CONTACT_EMAIL}。`],
    },
  ],
};

export const TERMS_OF_SERVICE: LegalDocument = {
  title: '服務使用條款',
  intro: `歡迎使用 ${COMPANY_NAME} 所開發之 AI 工具。使用本服務即表示您同意以下條款。`,
  meta: `最後更新日期：2026 年 7 月 02 日。本條款由 ${COMPANY_NAME}（統一編號 ${COMPANY_TAX_ID}）提供。`
    + '若中英文版本有歧異，以中文版為準。',
  sections: [
    {
      heading: '1. 服務範圍',
      paragraphs: [
        `${COMPANY_NAME}提供雲端軟體服務。實際功能、規格與服務水準以雙方簽訂之服務合約或方案說明為準。`,
      ],
    },
    {
      heading: '2. 帳號與責任',
      paragraphs: [
        '您應妥善保管帳號與密碼，並對該帳號下的一切活動負責。如發現未經授權之使用，請立即通知我們。',
      ],
    },
    {
      heading: '3. 使用規範',
      bullets: [
        '不得用於違法用途或侵害他人權利。',
        '不得嘗試破壞、逆向工程或未經授權存取系統。',
        '上傳之資料應確保您具有合法處理之權利（尤其涉及個案個人資料時）。',
      ],
    },
    {
      heading: '4. 智慧財產權',
      paragraphs: [
        `本服務之軟體、介面、商標與內容之智慧財產權均屬 ${COMPANY_NAME}或其授權人所有。您於服務中建立之營運資料，所有權仍屬於您。`,
      ],
    },
    {
      heading: '5. 付費、試用與終止',
      paragraphs: [
        '試用、計費方式與期間依方案說明或合約約定。任一方得依約定條件終止服務；終止後資料之返還與刪除依合約處理。',
      ],
    },
    {
      heading: '6. 服務變更與中斷',
      paragraphs: [
        '我們可能因維護、升級或不可抗力暫停或調整服務，並儘可能事先通知。我們持續以每月小版、每季大版的節奏迭代功能。',
      ],
    },
    {
      heading: '7. 免責聲明',
      paragraphs: [
        `本服務依「現狀」提供。於法律允許之最大範圍內，${COMPANY_NAME}不就服務之不中斷或無錯誤作擔保；對於間接、衍生性損害不負賠償責任。本條款不排除依法不得排除之責任。`,
      ],
    },
    {
      heading: '8. 準據法與管轄',
      paragraphs: [
        `本條款以中華民國法律為準據法。因本條款所生之爭議，雙方同意以 ${COMPANY_NAME}登記所在地之管轄法院為第一審管轄法院。`,
      ],
    },
    {
      heading: '9. 聯絡我們',
      paragraphs: [`如對本條款有任何疑問，請聯絡：${CONTACT_EMAIL}。`],
    },
  ],
};
