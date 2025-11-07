# 32チーム・トーナメント v1.4
## ルーレット修正
1. 針と結果のズレを解消：最終角度から**針が指す扇区を厳密計算**して結果表示。
2. 「SPIN!（出目を削除）」ボタンを追加：当たった項目を**リストから自動で除去**して再描画。
3. 効果音対応：
   - `/public/sfx/spin.mp3`（回転音）
   - `/public/sfx/stop.mp3`（停止時）
   ※ ZIP内の `public/sfx/README.txt` を参照し、ファイルを置くだけで有効になります。

その他：トーナメント機能は v1.3 のまま。

## 起動
```bash
cp .env.example .env
npm install
npm start
```
