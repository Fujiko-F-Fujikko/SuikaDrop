# Suika Drop

スイカゲーム風の「落として合体」パズルです。ブラウザで動作します。

## バージョン

- v0.3.1

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
- スマホ（傾きセンサー対応端末）: 傾けるとフルーツが転がります（初回は許可が必要な場合があります）

## ルール

- 同じフルーツ同士がぶつかると合体して 1 段階大きくなります（スコア加算）。
- ピンクの破線（上限ライン）より上に積み上がるとゲームオーバーです。

## 技術

- 描画: Canvas 2D
- 物理: Matter.js（`vendor/matter.min.js`）
- 傾き操作: DeviceOrientation API
- オンライン日次ランキング: Cloudflare Workers + D1（`cloudflare/`）

## ライセンス

- 本プロジェクト: MIT License（`LICENSE`）
- 同梱ライブラリ: Matter.js（MIT License、`THIRD_PARTY_NOTICES.md`）

## オンライン日次ランキング（Cloudflare）

### 1) Cloudflare D1 を作成

Cloudflare アカウント作成後、Wrangler を使って D1 を作成します。

```powershell
npm install -g wrangler
wrangler login
wrangler d1 create suikadrop
```

表示された `database_id` を `cloudflare/wrangler.toml` の `database_id` に貼り付けてください。

### 2) スキーマを反映

```powershell
wrangler d1 execute suikadrop --file cloudflare/schema.sql
```

### 3) Worker をデプロイ

```powershell
wrangler deploy
```

デプロイ後に表示される Worker URL（例: `https://xxxx.workers.dev`）を控えます。

### 4) ゲーム側に API URL を設定

現在は `main.js` の `DEFAULT_API_BASE` が空のため、オンラインランキングが無効表示になります。

`main.js` の `DEFAULT_API_BASE` を Worker の URL に設定して push してください（例）:

```js
const DEFAULT_API_BASE = 'https://xxxx.workers.dev';
```

### 5) CORS（必要なら）

GitHub Pages の origin が異なる場合は `cloudflare/wrangler.toml` の `ALLOWED_ORIGIN` を更新して再デプロイしてください。
