# 32チーム・トーナメント（Railway, v1.1）

- コネクタ線（SVG）を自動描画
- モバイル最適化（横スクロール・タップ操作・stickyヘッダ）
- チーム編集／削除（スロット反映、削除時は勝敗リセット）
- ルーレット配置、全ランダム配置、勝敗入力、結果リセット
- 管理者パスワードで保護（`x-admin-pass` or 画面入力）

## 使い方
```bash
cp .env.example .env   # ADMIN_PASSWORD を設定
npm install
npm start
```

## Railway
- 環境変数 `ADMIN_PASSWORD` を設定
- 永続化を強めたい場合は Volume を追加して `db.json` を保持してください
