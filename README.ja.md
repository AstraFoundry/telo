# Telo

AstraFoundry が開発する、会話の隣にワークスペース認識 AI エージェントを備えたプライバシー重視の Telegram デスクトップクライアント。

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square)](package.json)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square)](package.json)

![チャット一覧、会話ビュー、AI エージェントパネルを表示する Telo デスクトップモック](docs/readme/hero.png)

![AstraFoundry 製品ページの Telo デスクトップモックによるスクリプトデモ](docs/readme/demo.gif)

_上の画像と GIF は AstraFoundry 製品ページに掲載されている Telo デスクトップモック（チャット一覧、会話ビュー、エージェントパネル）とそのスクリプト化されたデモであり、実際の Telegram アカウントにサインインしたライブセッションではありません。_

## 主な機能

- **ネイティブ TDLib カーネル**：Electron メインプロセス内で `tdl` と `prebuilt-tdlib`（TDLib 1.8.67）を実行し、アカウントごとの SQLite データベースを `safeStorage` 由来の鍵で暗号化。マルチアカウント切り替え（最大 3 アカウント）、シークレットチャット、サーバーフォルダとローカルキーワードフォルダ、投票、予約送信、ボイスノート、ステッカー、アニメーション絵文字に対応しています（`prebuilt-tdlib` は Windows arm64 非対応）。
- **ワークスペース認識 AI エージェント**：開閉可能な右サイドパネル（`Cmd/Ctrl + B`）から AG-UI イベントプロトコルで応答をストリーミング。未読メッセージの要約、決定事項や ToDo の抽出、コンポーザー内での翻訳・書き換え・返信下書き作成、`telo://message/...` リンクによるメッセージ引用、`@Name` メンション補全に加え、トリガールールやスケジュールタスクによる自動化（既定は下書き保存の `draft-only`、または自動送信 `auto-send`）を備えています。
- **Bring Your Own Account (BYOA)**：AI SDK を通じて OpenAI、Anthropic、Google、Groq、xAI、Kimi、DeepSeek、Mistral に対応（OpenAI、Anthropic、Google、xAI、Kimi はデスクトップ OAuth 接続、Groq、DeepSeek、Mistral は API キー）。さらに任意の OpenAI 互換 HTTPS エンドポイントも利用可能です。
- **ゼロトラストなプロセス境界**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` を徹底。API キー、OAuth トークン、Telegram 認証情報は OS キーチェーン（`safeStorage`）で暗号化されてメインプロセスに留まり、型付き IPC ブリッジ（`contracts/src/ipc.ts`）を越えてレンダラーに渡ることはありません。エージェントへ送るスコープ付きコンテキストからはメールアドレス、電話番号、API キー様のトークンを自動マスクし、プロンプトの SHA-256 ハッシュをローカルの `agent-audit.jsonl` に記録します。
- **洗練されたデスクトップ UX とライブプレビュー設定**：React 19、Electron 44、Tailwind CSS v4、Motion、BEUI コンポーネントで構築。システム連動・ライト・ダークテーマ、5 色のアクセントパレット、12px〜18px のメッセージ文字サイズ調整、テーマトークンで描画されるチャット背景、実際の吹き出しや OS 通知バナーをその場で描画する検索可能な設定画面、チャット種別・メディア種別ごとの通知および自動ダウンロード制御を提供します。

## クイックスタート

### 前提条件

- **Node.js** `>= 22.0.0`
- **pnpm** `9.0.0` 以上
- **GNU Make**
- **OS**：macOS、Windows（x64）、または GUI セッションを備えた Linux

### インストールと起動

```sh
git clone https://github.com/astrafoundry/telo.git
cd telo
make install
make dev
```

Telegram アカウントへのサインインや AI プロバイダー設定を行わずに、インメモリのデモワークスペースと決定論的なデモエージェントを試す場合：

```sh
make dev DEMO=1
```

### Telegram および OAuth 認証情報の設定

ローカル開発で実際の Telegram アカウントにサインインするには、[my.telegram.org](https://my.telegram.org) で取得した API 認証情報を環境変数で渡します（または `.env.example` をコピーして `.env` に記述します）：

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

Google OAuth（`Connect account`）を有効にするには、Generative Language API を有効化しループバックリダイレクト（`http://127.0.0.1`）を許可した Google Cloud デスクトップ OAuth クライアント ID を指定します：

```sh
TELO_GOOGLE_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com make dev
```

OpenAI、Anthropic、xAI、Kimi は既定で各社の公開ネイティブ OAuth クライアントを使用し、`TELO_OPENAI_OAUTH_CLIENT_ID`、`TELO_ANTHROPIC_OAUTH_CLIENT_ID`、`TELO_XAI_OAUTH_CLIENT_ID`、`TELO_KIMI_OAUTH_CLIENT_ID` で上書き可能です。`TELO_GOOGLE_OAUTH_CLIENT_ID` が未設定の場合でも、Google は API キーで利用できます。

### コマンド一覧

| コマンド | 説明 |
| --- | --- |
| `make install` | lockfile に従って依存関係をインストールし Electron バイナリを取得 |
| `make dev` | 依存関係をインストールしホットリロード有効で Electron アプリを起動 |
| `make dev DEMO=1` | インメモリのデモワークスペースを直接開いて起動 |
| `make reset` | Electron の `userData` を削除し初回起動状態にリセット |
| `make check` | フォーマット、ESLint、TypeScript、単体テストカバレッジ、TDLib 機能検査、Markdown 検査、Playwright E2E テストを一括実行 |
| `make test` | Vitest による単体・統合テストとカバレッジ計測を実行 |
| `make test-e2e` | `e2e` モードでビルドし Playwright Electron E2E テストを実行 |
| `make test-live` | シークレット指定のライブ Telegram E2E テストを実行（`TELO_LIVE_E2E=1`） |
| `make lint` | Feature-Sliced Design の境界チェックを含む ESLint を実行 |
| `make format` | Prettier でソースコードとドキュメントをフォーマット |
| `make docs` | `markdownlint-cli2` で `README*.md` と `docs/**/*.md` を検証 |
| `make build` | `electron-vite` でメイン・プリロード・レンダラーをビルド |
| `make package` | ネイティブ TDLib バイナリを配置し展開済みアプリ成果物を生成 |
| `make tdlib-smoke` | `make package` 後にパッケージ内の `libtdjson` 読み込みを検証 |
| `pnpm release` | `electron-builder` で各 OS 向けインストーラー・配布パッケージをビルド |

## ドキュメント

- [ドキュメント索引](docs/README.md) — ドキュメント全体の構成マップとガイド。
- [プロジェクト概要](docs/project/README.md) — プロダクトの目的とセキュリティ境界。
- [システムアーキテクチャ](docs/project/architecture.md) — フロントエンド FSD レイヤー、バックエンド DDD レイヤー、IPC コントラクト、データフロー。
- [AI エージェントと AG-UI 連携](docs/project/agent.md) — ストリーミングパネル、引用、メンション、BYOA プロバイダー、マスキング監査、自動化。
- [Telegram 機能ベースライン](docs/telegram/README.md) — TDLib 機能カバレッジマトリクスとクライアントワークフロー。
- [フロントエンド設計ガイド (FSD)](docs/frontend/README.md) — Feature-Sliced Design の規約とインポートルール。
- [バックエンド設計ガイド (DDD)](docs/backend/README.md) — ドメイン駆動設計のレイヤー、ポート、ユースケース。
- [ローカル永続化](docs/backend/database.md) — 暗号化された `userData` ファイルとアカウント別 TDLib ストレージ。
- [ローカル開発ガイド](docs/operations/local-dev.md) — 環境変数、ランタイム設定、デバッグ手順。
- [ビルドとリリース](docs/operations/deployment.md) — パッケージング、ネイティブ TDLib 配置、CI、リリース成果物。
- [テスト戦略](docs/quality/testing.md) — Vitest カバレッジ基準と Playwright Electron E2E テスト。
- [アーキテクチャ決定記録 (ADR)](docs/decisions/README.md) — IPC 境界、BYOA プロバイダー、自動化の安全性、TDLib カーネルに関する意思決定記録。

## ライセンス

本プロジェクトは [MIT ライセンス](LICENSE) のもとで公開されています。

Telo は AstraFoundry による独立したサードパーティ製クライアントであり、Telegram FZ-LLC または Telegram Messenger Inc. との提携、スポンサーシップ、または公式な承認関係はありません。
