# Suika Drop

スイカゲーム風の「落として合体」パズルです。ブラウザで動作します。

## バージョン

- v0.2.0

## デモ（GitHub Pages）

GitHub Pages を有効化すると、以下で公開できます。

- [https://fujiko-f-fujikko.github.io/SuikaDrop/](https://fujiko-f-fujikko.github.io/SuikaDrop/)

## 実行方法（ローカル）

`main.js` を ES Modules（`<script type="module">`）で読み込むため、ローカルサーバーで開くのが確実です。

### Python（推奨）

```powershell
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。

### Node.js

```powershell
npx http-server -p 8000
```

ブラウザで `http://localhost:8000/` を開きます。

### VS Code Live Server

拡張機能「Live Server」を入れて、`index.html` を右クリック → 「Open with Live Server」。

## 操作方法

- マウス移動 / タッチ移動: 落とす位置を調整
- クリック / `Space`: フルーツを落とす
- `R` / 「リスタート」: やり直し

## ルール

- 同じフルーツ同士がぶつかると合体して 1 段階大きくなります（スコア加算）。
- ピンクの破線（上限ライン）より上に積み上がるとゲームオーバーです。

## 技術

- 描画: Canvas 2D
- 物理: Matter.js（`vendor/matter.min.js`）

## ライセンス

- 本プロジェクト: MIT License（`LICENSE`）
- 同梱ライブラリ: Matter.js（MIT License、`THIRD_PARTY_NOTICES.md`）
