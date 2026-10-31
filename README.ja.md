# Telo

AstraFoundry が開発する、会話の隣にワークスペース認識 AI エージェントを備えたプライバシー重視の Telegram デスクトップクライアント。

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](mygo.json)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?style=flat-square)](go.mod)
[![MyGo](https://img.shields.io/badge/MyGo-0.7-47848F?style=flat-square)](go.mod)

![チャット一覧、会話ビュー、AI エージェントパネルを表示する Telo デスクトップ画面](docs/readme/hero.png)

![チャット一覧、会話ビュー、AI エージェントパネルの操作を映した Telo デスクトップアニメーション](docs/readme/demo.gif)

## 主な機能

- **ネイティブな単一プロセス**：[MyGo](https://github.com/egoist/mygo) 上の Go で実装。ネイティブウィンドウで、Electron も WebView も C ツールチェーンも不要です。TDLib 1.8.67 は `purego` で読み込み、アカウントごとのデータベースはシステムの認証情報ストアにある鍵で暗号化されます。最大 3 アカウント、シークレットチャット、サーバーフォルダーとキーワードフォルダー、投票、予約メッセージ、ステッカーに対応します。（`prebuilt-tdlib` は Windows arm64 に非対応です。）
- **Telegram for macOS との整合**：操作は [telegram-macos](https://github.com/TelegramMessenger/telegram-macos) に合わせています。メニュー、キーボードショートカット、設定、コンテキストメニューは対応する上流項目を持ち、コミット済みの整合台帳から外れると `make check` が失敗します。
- **ワークスペース認識 AI エージェント**：右側のパネル（`⌘J` / `Ctrl+J`）で未読の要約、決定事項と ToDo の抽出、翻訳・書き換え・返信下書きの入力欄への挿入、番号付き `telo://message/...` リンクによる引用、トリガールールと予約タスク（既定は `draft-only`、または `auto-send`）を実行します。
- **自分のアカウントを利用（BYOA）**：OpenAI、Anthropic、Google、Groq、xAI、Kimi、DeepSeek、Mistral（OpenAI、Anthropic、Google、xAI、Kimi はベンダーのサインイン、その他は API キー）と、任意の OpenAI 互換 HTTPS エンドポイントに対応します。
- **秘密情報は常に暗号化**：API キー、OAuth トークン、Telegram データベースの鍵は AES-256-GCM で暗号化され、鍵は OS の認証情報ストアに保存され、UI には渡りません。エージェントのコンテキストは端末を離れる前にマスキング（メール、電話番号、API キー）され、各実行ではプロンプトの SHA-256 のみを `agent-audit.jsonl` に記録し、本文は記録しません。
- **洗練されたデスクトップ体験**：AstraFoundry の Arion と共通の coss コンポーネント構造に、Telo 独自の配色を組み合わせています。システム / ライト / ダークテーマ、5 種類のアクセントカラー、12〜18 px のメッセージ文字サイズ、ローカルパスコードと自動ロック、検索できる設定、チャット種別ごとの通知とメディア自動ダウンロード設定を備えます。

## クイックスタート

### 前提条件

- **Go**：`go.mod` に記載のバージョン
- **Node.js** `>= 22.0.0` と **pnpm** `9.0.0` 以降（固定版 TDLib の配置とドキュメント検証に使用）
- **GNU Make**
- **OS**：macOS、Windows（x64）、またはグラフィカルセッションのある Linux

### インストールと起動

```sh
git clone https://github.com/AstraFoundry/telo.git
cd telo
make install
make dev
```

Telegram アカウントへのログインや AI プロバイダーの設定なしで、インメモリのデモワークスペースと決定論的なデモエージェントを試すには：

```sh
make demo
```

### Telegram および OAuth 認証情報の設定

ローカル開発で実際の Telegram アカウントにログインするには、[my.telegram.org](https://my.telegram.org) で取得したアプリケーション認証情報を渡します（または `.env.example` をコピーした `.env` に記載します）：

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

エージェントで Google のサインインを有効にするには、Generative Language API を有効化し、ループバックリダイレクト（`http://127.0.0.1`）を許可した Google Cloud デスクトップ OAuth クライアント ID を指定します：

```sh
TELO_GOOGLE_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com make dev
```

OpenAI、Anthropic、xAI、Kimi は既定で各ベンダーの公開ネイティブ OAuth クライアントを使い、`TELO_OPENAI_OAUTH_CLIENT_ID`、`TELO_ANTHROPIC_OAUTH_CLIENT_ID`、`TELO_XAI_OAUTH_CLIENT_ID`、`TELO_KIMI_OAUTH_CLIENT_ID` で上書きできます。`TELO_GOOGLE_OAUTH_CLIENT_ID` がない場合、Google は API キーを使います。

### コマンド一覧

| コマンド | 説明 |
| --- | --- |
| `make install` | ロックファイルから固定版 TDLib パッケージとドキュメントツールをインストール |
| `make dev` | TDLib を配置し、ライブリロードで Telo を起動 |
| `make demo` | インメモリのデモワークスペースで Telo を起動 |
| `make reset` | 使い捨ての空プロファイルで Telo を一度起動 |
| `make check` | CI と同じ全ゲートを実行：gofmt、vet、生成コード、FSD/DDD インポート、TDLib 機能、telegram-macos 整合、テスト、ドキュメント |
| `make test` | 配置済み libtdjson に対して Go テスト（ヘッドレス UI テストを含む）を実行 |
| `make parity` | telegram-macos 整合台帳とコードの一致を検証 |
| `make snapshots` | UI テストの描画フレームを `.workspace/snapshots` に出力 |
| `make test-live` | ログイン済みアカウントで実 Telegram ベースラインを実行（`TELO_LIVE_E2E=1`） |
| `make build` | 現在のプラットフォーム向けに Telo バイナリをビルド |
| `make package` | `mygo build` でアプリパッケージとインストーラーをビルド |
| `make help` | すべてのターゲットを表示 |

## ドキュメント

- [ドキュメント索引](docs/README.md) — ドキュメント全体の構成マップとガイド。
- [プロジェクト概要](docs/project/README.md) — プロダクトの目的と境界。
- [システムアーキテクチャ](docs/project/architecture.md) — フロントエンド FSD レイヤー、バックエンド DDD レイヤー、スレッドモデル、データフロー。
- [AI エージェント](docs/project/agent.md) — パネル、引用、BYOA プロバイダー、マスキング、自動化。
- [Telegram](docs/telegram/README.md) — TDLib 機能マトリクスと実アカウントのベースライン。
- [telegram-macos 整合](docs/telegram/parity.md) — 整合台帳と `make check` のゲート。
- [フロントエンド設計ガイド (FSD)](docs/frontend/README.md) — Go における Feature-Sliced Design とデザインシステム。
- [バックエンド設計ガイド (DDD)](docs/backend/README.md) — ドメイン駆動設計のレイヤー、ポート、ユースケース。
- [ローカル永続化](docs/backend/database.md) — 暗号化ファイルとアカウント別 TDLib ストレージ。
- [ローカル開発ガイド](docs/operations/local-dev.md) — 環境変数とランタイム設定。
- [ビルドとリリース](docs/operations/deployment.md) — パッケージング、CI、リリース成果物。
- [テスト戦略](docs/quality/testing.md) — `make check` のゲートとヘッドレス UI テスト。
- [アーキテクチャ決定記録 (ADR)](docs/decisions/README.md) — ネイティブデスクトップ、BYOA プロバイダー、自動化の安全性、TDLib カーネル、整合範囲に関する意思決定記録。

## コントリビューター

[![Telo コントリビューター](https://contrib.rocks/image?repo=AstraFoundry/telo)](https://github.com/AstraFoundry/telo/graphs/contributors)

## Star 履歴

[![Star History Chart](https://api.star-history.com/svg?repos=AstraFoundry/telo&type=Date)](https://star-history.com/#AstraFoundry/telo&Date)

## ライセンス

本プロジェクトは [MIT ライセンス](LICENSE) のもとで公開されています。

Telo は AstraFoundry による独立したサードパーティ製クライアントであり、Telegram FZ-LLC または Telegram Messenger Inc. との提携、スポンサーシップ、または公式な承認関係はありません。
