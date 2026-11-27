# tarunru-hunt
## メガネハント

ソースは [game/](game/) にあります。ルートの `index.html`、`assets/`、`models/`、`licenses/` は GitHub Pages 用のビルド出力です。

```sh
cd game
npm ci
npm run build
```

変更を公開するときは、`game/dist/` の中身をリポジトリのルートに配置します。Pages で公開するブランチの `/(root)` が公開元です。ゲームの設定と攻撃仕様は [game/README.md](game/README.md) を参照してください。
