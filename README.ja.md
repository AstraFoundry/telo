# Telo

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](https://github.com/ProjectKumo/telo)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

> ワークスペース認識 AI エージェントを統合した、プライバシー重視の次世代 Telegram デスクトップクライアント。

---

## 概要

**Telo** は、**React 19**、**Electron 44**、および **AI SDK** を用いて構築された高性能 Telegram デスクトップクライアントです。リアルタイムなチャット体験に加え、会話の流れを直接読み取って要約、返信文の作成、多言語翻訳、タスクの抽出などを自律的に支援する AI アシスタントを統合しています。

プライバシーとゼロトラストセキュリティを最優先に設計されており、Telegram のセッション情報や API キーはすべて Electron のメインプロセス内で OS キーチェーン（`safeStorage`）によって暗号化されます。フロントエンドのレンダラーは非特権サンドボックス内で安全に動作し、機密情報に直接アクセスすることはありません。

```text
+-------------------+----------------------------------+------------------------+
|   チャット一覧    |           会話ビュー             |    グローバル AI       |
|                   |                                  |                        |
| • ダイレクト / 群 | • 引用付き返信プレビュー         | • AG-UI ストリーム出力 |
| • チャンネル購読  | • 送信メッセージのインライン編集 | • 思考中シマーアニメ   |
| • 未読・ミュート  | • メッセージ転送 & 削除確認      | • ワークスペース認識   |
| • ピン留めダイアログ| • Markdown 入力コンポーザー     | • 複数スレッド管理     |
| • コンテキストメニュー| • バブル右クリックメニュー   | • OS デスクトップ通知  |
+-------------------+----------------------------------+------------------------+
```

---

## 主な機能

### ⚡ 純粋な TypeScript による MTProto クライアント

- **軽量かつ高速**：Telegram MTProto プロトコルを純粋な TypeScript で実装した `teleproto` を採用。肥大化した C++ ネイティブバイナリや TDLib のビルド依存関係は一切不要です。
- **スムーズな認証フロー**：SMS / Telegram アプリ内コード送信および 2 段階認証（2FA クラウドパスワード）に完全対応。
- **ログイン不要のデモモード（Demo Workspace）**：`make dev DEMO=1` で起動すると、ログインなしで UI とエージェントを体験できます。アプリ内にデモ用ボタンはありません。

### 🤖 ワークスペース認識グローバル AI エージェント

- **マルチプロバイダー対応**：OpenAI（`gpt-4o`, `o3-mini` など）および OpenAI 互換のエンドポイント（DeepSeek, OpenRouter, Groq, Ollama, LM Studio）を自在に設定可能。
- **ワークスペース認識ツール（`inspectWorkspace`）**：エージェントが必要に応じて現在表示されているチャットのメタデータや会話ログを参照し、文脈に即した的確な回答を提供。
- **AG-UI プロトコルによるリアルタイムストリーミング**：思考中を示す `ThinkingShimmer`、ツール実行ステップの可視化、トークンごとのストリーミング表示、堅牢なエラーハンドリングを装備。
- **永続化スレッド管理**：複数の独立した会話スレッドを作成・切り替え可能。履歴はローカルの `agent-threads.json` に安全に保存されます。
- **バックグラウンド通知**：アプリが非アクティブな状態でも、AI のタスク完了時に OS ネイティブのデスクトップ通知でお知らせします。

### 🛡️ ゼロトラストセキュリティと鍵の完全隔離

- **厳格なサンドボックスとコンテキスト分離**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` を徹底。意図しない外部遷移を防ぎ、外部リンクは OS の既定ブラウザで安全に開きます。
- **OS キーチェーンによる暗号化（`safeStorage`）**：API キーおよび Telegram セッションは、ディスク書き込み前に OS のセキュアストレージで暗号化。
- **レンダラーでの機密情報非保持**：UI レンダラーは型付けされた IPC 経由でのみ通信し、生のキーやトークンを一切保持しません。

### 🎨 洗練されたデスクトップ体験

- **滑らかなモーション**：Motion（Framer Motion v13）と BEUI モーションコンポーネントを採用し、モーダル変形、ポップオーバー、サイドバー開閉をスムーズに演出。
- **細やかなカスタマイズ**：
  - テーマ切り替え：**システム連動**、**ライト**、**ダーク**。
  - 5 つのアクセントカラー：**ブルー**、**グリーン**、**パープル**、**レッド**、**オレンジ**。
  - メッセージ文字サイズのスライダー調整（**12px ～ 18px**）。
  - 時刻表示形式：**システム標準**、**12 時間制**、**24 時間制**。
  - 送信ショートカット設定：`Enter` 送信または `Cmd/Ctrl + Enter` 送信。
  - ショートカット操作：`Cmd/Ctrl + B` で AI エージェントパネルを瞬時に開閉。

### 💬 充実したメッセージ＆チャット操作

- **引用返信**：返信元メッセージのスナップショットを引用表示。
- **メッセージ編集**：送信済みメッセージをその場で編集、`edited` バッジを表示。
- **メッセージ転送**：別チャットへの転送とサイドバープレビューの即時同期。
- **メッセージ削除**：確認モーダルを伴う安全なメッセージ削除。
- **チャット管理**：ピン留め / 解除、通知ミュート / 解除、既読 / 未読の切り替え。

---

## アーキテクチャと設計方針

Telo は業界標準の設計パターンを採用し、明確な関心の分離を実現しています。

```text
+-------------------------------------------------------------------------+
|                  フロントエンド：React 19 (FSD 設計)                     |
|    app  -->  pages  -->  widgets  -->  features  -->  entities  --> shared|
+-------------------------------------------------------------------------+
                                    |
                    厳格に型定義された IPC 層 (contextBridge)
                    contracts/src/ipc.ts (TeloDesktopApi)
                                    |
+-------------------------------------------------------------------------+
|                バックエンド：Electron メインプロセス (DDD 設計)           |
|     interfaces  -->  application  -->  domain  <--  infrastructure     |
+-------------------------------------------------------------------------+
          |                         |                        |
     [Teleproto]                [AI SDK]             [safeStorage]
   (Telegram MTProto)     (OpenAI / 互換 API)     (OS 暗号化ローカルデータ)
```

- **フロントエンド（Feature-Sliced Design: FSD）**：`app`、`pages`、`widgets`、`features`、`entities`、`shared` の単方向依存ルールを徹底。
- **バックエンド（Domain-Driven Design: DDD）**：フレームワークに依存しない純粋な `domain`、ユースケースをまとめた `application`、外部通信を担う `infrastructure` の多層構成。
- **型安全な IPC コントラクト**：プロセス間通信はすべて `contracts/src/ipc.ts` で型定義され、安全性が保証されています。

---

## クイックスタート

### 前提条件

- **Node.js**：`v22.0.0` 以上
- **パッケージマネージャー**：`pnpm` `v9.0.0` 以上
- **ビルドツール**：`GNU Make`
- **対象 OS**：macOS、Windows、または GUI 環境を備えた Linux

### インストールと起動

1. **リポジトリのクローン**：

   ```sh
   git clone https://github.com/ProjectKumo/telo.git
   cd telo
   ```

2. **依存関係のインストール**：

   ```sh
   make install
   ```

3. **開発モードでの起動**：

   ```sh
   make dev
   ```

### 実際の Telegram アプリ認証情報で実行する場合

本番の Telegram アカウントに接続する場合は、[my.telegram.org](https://my.telegram.org) で取得した API 情報を指定して起動します。

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

オンボーディングではなくデモワークスペースを開く場合：

```sh
make dev DEMO=1
```

_※ ビルド時に API 情報が無い場合、リリース版はサインインフォームの代わりに「credentials missing」を表示します。デモワークスペースはローカル起動フラグであり、フォールバックではありません。_

---

## 品質管理とテスト

Telo はフロントエンド・バックエンド双方で徹底したテスト体制を整えています。

```sh
# フル品質ゲートの実行（フォーマット、Lint、型検査、単体テスト、Docs 検査、E2E）
make check

# Vitest による単体・統合テストの実行（カバレッジ計測付き）
make test

# Playwright による Electron エンドツーエンド（E2E）テスト
make test-e2e

# コード静的解析とフォーマット
make lint
make format
```

- **Vitest**：単体・統合テストを実行し、厳格なカバレッジ基準（ステートメント・行・関数 80% 以上、ブランチ 75% 以上）を維持。
- **Playwright**：パッケージ化された Electron 実環境上で、初期オンボーディング、メッセージ送受信、設定保存、AI 対話などの主要シナリオを網羅して検証。

---

## 主なコマンド一覧

| コマンド        | 内容                                                         |
| --------------- | ------------------------------------------------------------ |
| `make install`  | lockfile に従って依存関係をインストール                      |
| `make dev`      | ホットリロード対応の開発モードで Electron アプリを起動       |
| `make check`    | フォーマット、Lint、型検査、テスト、文書、E2E の全検証を実行 |
| `make test`     | Vitest を用いて単体・統合テストを実行しカバレッジを出力      |
| `make test-e2e` | Playwright を用いて Electron の E2E テストを実行             |
| `make lint`     | ESLint を実行し FSD 依存境界などのコード規約を検証           |
| `make format`   | Prettier でソースコードおよびドキュメントを自動フォーマット  |
| `make docs`     | markdownlint を使用して Markdown ドキュメントの構文を検証    |
| `make build`    | electron-vite でメイン、プリロード、レンダラーをビルド       |
| `make package`  | 配布用パッケージ（展開済み形式）を生成                       |
| `make reset`    | Electron のユーザーデータを削除し初回起動状態に戻す          |

---

## 設定とローカルストレージ

Telo は各種設定情報を OS 標準の Electron `userData` ディレクトリに保存します。

| ファイル名           | 用途                                                     | 保存形式                        |
| -------------------- | -------------------------------------------------------- | ------------------------------- |
| `agent.json`         | AI モデル設定およびシステムプロンプト                    | API キーは `safeStorage` 暗号化 |
| `agent-threads.json` | AI との会話スレッド履歴および選択中スレッド ID           | プレーン JSON                   |
| `telegram.session`   | Telegram MTProto セッション鍵                            | `safeStorage` 暗号化            |
| `telegram.profile`   | ユーザープロファイルおよびキャッシュ画像                 | `safeStorage` 暗号化            |
| `dialogs.json`       | 復元用のチャット一覧とフォルダ未読バッジ                 | プレーン JSON                   |
| `preferences.json`   | テーマ、強調色、文字サイズ、時刻表記、ショートカット設定 | プレーン JSON                   |

_※ キーチェーンが存在しないヘッドレス Linux CI 環境では、`TELO_PLAINTEXT_SECRETS=1` を指定してテストを実行可能です。_

---

## パッケージングと配布

各 OS 向けの配布用インストーラーやバイナリを簡単に作成できます。

```sh
# 配布用パッケージのビルド
pnpm release
```

- **macOS**：Apple Silicon / Intel 向け DMG および ZIP パッケージ（`.dmg`, `.zip`）
- **Windows**：NSIS インストーラー（`.exe`）
- **Linux**：AppImage および Debian パッケージ（`.AppImage`, `.deb`）

---

## 技術ドキュメント一覧

設計と実装の詳細については、[`docs/`](docs/) 配下の各種ドキュメントをご覧ください。

- [プロジェクトアーキテクチャ (Architecture)](docs/project/architecture.md) — モジュール境界、データフロー、IPC 設計。
- [AI エージェントと AG-UI 連携 (Agent & AG-UI)](docs/project/agent.md) — AG-UI イベントプロトコル、ワークスペーススナップショット、スレッド管理。
- [フロントエンド設計ガイド (FSD Guidelines)](docs/frontend/README.md) — Feature-Sliced Design のレイヤー規則とコンポーネント設計。
- [バックエンド設計ガイド (DDD Guidelines)](docs/backend/README.md) — ドメイン駆動設計、リポジトリ、ユースケースサービス。
- [ローカル開発ガイド (Local Development)](docs/operations/local-dev.md) — 環境構築、シークレット管理、デバッグ手順。
- [テスト戦略 (Testing Strategy)](docs/quality/testing.md) — Vitest カバレッジ基準および Playwright E2E テスト。
- [リリースプロセス (Release Process)](docs/operations/deployment.md) — ビルドマトリクス、署名、公証、ロールバック手順。

---

## 免責事項

Telo は独立したサードパーティ製オープンソースクライアントであり、Telegram FZ-LLC または Telegram Messenger Inc. との提携、スポンサーシップ、または公式な関連は一切ありません。

---

## ライセンス

本プロジェクトは [MIT ライセンス](LICENSE) のもとで公開されています。
