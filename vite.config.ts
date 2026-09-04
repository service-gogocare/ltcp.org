import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  /**
   * 相對路徑，不寫死站台掛在哪裡。
   *
   * GitHub Pages 的專案站台是 https://<帳號>.github.io/<repo>/，
   * 而自訂網域是 https://ltcp.org/ —— 兩者的根目錄不同。用 './' 的話同一份
   * 建置產物在兩種網址下都對，日後把網域接上去也不必重新建置。
   *
   * 這個程式只有一頁、沒有前端路由，所以相對路徑沒有巷弄深度的問題。
   * 若哪天加了 react-router 之類的多路徑，這裡就得改回絕對的 base。
   *
   * public/ 底下的檔案請用 externalLinks.ts 的常數（已串上 BASE_URL），
   * 不要在程式裡寫 '/檔名'。
   */
  base: './',
})
