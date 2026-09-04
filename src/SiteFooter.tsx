/**
 * 頁尾與法務文件視窗
 * ---------------------------------------------------------------------------
 * 條文用視窗開在程式裡，而不是連到一個 .txt 或另開網站：
 * 純文字檔會離開整個程式的深淺色主題與字級，看起來像另一個東西；
 * 而使用者正在讀的是「我把個案個資交給誰」這種要看得下去的內容。
 *
 * 操作手冊是 75 頁的 PDF，另開分頁交給瀏覽器的檢視器，不用 download ——
 * 大部分人只是想翻某一頁，不是要在硬碟上多一份 7MB 的檔案。
 */
import { useEffect } from 'react';
import { PRIVACY_POLICY, TERMS_OF_SERVICE, COMPANY_NAME, type LegalDocument } from './legalContent';
import { MANUAL_URL, LOGO_URL, COMPANY_PORTAL_URL } from './externalLinks';

export type LegalDocKey = 'privacy' | 'terms';

const DOCS: Record<LegalDocKey, LegalDocument> = {
  privacy: PRIVACY_POLICY,
  terms: TERMS_OF_SERVICE,
};

export function LegalModal({ doc, onClose }: { doc: LegalDocKey; onClose: () => void }) {
  const content = DOCS[doc];

  // Esc 關閉。條文視窗沒有表單，使用者的直覺就是按 Esc 或點外面
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={content.title}
    >
      <div className="modal-content legal-modal">
        <div className="legal-modal-head">
          <h3 style={{ margin: 0, color: 'var(--primary)' }}>{content.title}</h3>
          <button type="button" className="btn btn-secondary" onClick={onClose} style={{ padding: '4px 12px', minHeight: '32px' }}>
            關閉
          </button>
        </div>

        <div className="legal-body">
          <p className="legal-intro">{content.intro}</p>
          <p className="legal-meta">{content.meta}</p>

          {content.sections.map((section) => (
            <section key={section.heading} className="legal-section">
              <h4>{section.heading}</h4>
              {section.paragraphs?.map((text) => <p key={text}>{text}</p>)}
              {section.bullets && (
                <ul>
                  {section.bullets.map((text) => <li key={text}>{text}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SiteFooter({ onOpenLegal }: { onOpenLegal: (doc: LegalDocKey) => void }) {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <a
          href={COMPANY_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer-logo"
          title={COMPANY_NAME}
        >
          <img src={LOGO_URL} alt="GOGO Care" />
        </a>

        <nav className="app-footer-links">
          {/* 條文是視窗不是連結，所以用 button —— 用 <a href="#"> 會在網址列留下
              一個回不去的錨點，而且鍵盤與螢幕閱讀器會把它當成導覽 */}
          <button type="button" onClick={() => onOpenLegal('privacy')}>隱私權政策</button>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => onOpenLegal('terms')}>服務使用條款</button>
          <span aria-hidden="true">·</span>
          <a href={MANUAL_URL} target="_blank" rel="noopener noreferrer">
            使用教學（PDF）
          </a>
        </nav>

        <span className="app-footer-copy">
          © {new Date().getFullYear()} {COMPANY_NAME}
        </span>
      </div>
    </footer>
  );
}
