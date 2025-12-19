# OSU-Denken Web API
大阪産業大学 電子計算研究部の [電研公式サイト](https://osu-denken.github.io/) のバックエンド API <br />
Cloudflare Workers上で稼働しています。

## 機能

- **Blog API**: GitHub リポジトリ内の Markdown ファイルをブログ記事として管理 (取得、一覧、更新) 
- **User API**: Firebase Authentication と連携したユーザー認証・管理機能 (大産大のドメインを持つメールアドレスのみ登録可能)
- **Invite API**: 新規ユーザー登録のための招待コード発行・管理機能
- **Portal API**: 部員向けポータルサイト用の情報集約、および外部サービス (GitHub, Discord) への招待機能

## セットアップ

### 前提

- [Node.js](https://nodejs.org/) (v20 以降)
- [pnpm](https://pnpm.io/ja/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (Cloudflare アカウントでのログインが必要)

### インストール

1.  リポジトリをクローンする:
    ```bash
    git clone git://github.com/osu-denken/web-api.git
    cd web-api
    ```

2.  依存関係をインストールする:
    ```bash
    pnpm install
    ```

### ローカルでの開発
開発サーバーを起動する。変更は自動的にリロードされる。
`.dev.vars` ファイルをプロジェクトルートに作成し、必要な環境変数を設定すること (後述の「シークレットと環境変数」を参照)。

```bash
pnpm dev
```

### デプロイ
変更を Cloudflare Workers にデプロイする。

```bash
pnpm deploy
```

---

## API エンドポイント
**ベース URL**: Cloudflare のデプロイ先に依存する。

#### `GET /`
Welcomeメッセージを返す。

#### `GET /ping`
サーバーの稼働確認用。`pong` という文字列を返す。

---

### Blog API (`/blog`)
ブログはJekyllを使ったblogリポジトリで管理されており、GitHub APIでアクセスするためのAPI

#### `GET /v2/blog/list`
記事の一覧を取得する

- **構造**:
    ```json
    [
      {
        "name": "<ファイル名>",
        "sha": "<ハッシュ値>",
        "size": <サイズ>,
        "meta": {
          "title": "<タイトル名>",
          ...
        }
      }
    ]
    ```

#### `GET /v2/blog/get?page=<slug>`

指定した ページ名 `slug` (ファイル名から `.md` を除いたもの) の本文とメタデータを取得する。

- **クエリパラメータ**:
    - `page` (必須): 記事のスラッグ

- **構造**:
    ```json
    {
      "name": "<ファイル名>",
      "sha": "<ハッシュ値>",
      "size": <サイズ>,
      "meta": {
        "title": "<タイトル名>",
        ...
      },
      "content": "<内容>"
    }
    ```

#### `POST /v2/blog/update`
ブログ記事を新規作成または更新する。Firebase の ID トークンによる認証が必要である。

- **ヘッダー**:
    - `Authorization: Bearer <ID_TOKEN>` (必須)
    - `page`: 記事のスラッグ (必須)
    - `meta`: JSON 文字列化されたメタデータ (必須)
- **ボディ**:
    - 記事の本文 (Markdown) (必須)

---

### User API (`/user`)

Firebase Authentication を利用したユーザー管理 API である。ユーザー登録は `osaka-sandai.ac.jp` ドメインのメールアドレスに限定される。
すべてのエンドポイントは `POST` メソッドを要求する。

#### `POST /user/exists`

- **ボディ**: `{ "email": "gXXXXXXX@ge.osaka-sandai.ac.jp" }`
- **説明**: 指定されたメールアドレスのユーザーが存在するかどうかを確認する。

#### `POST /user/register`

- **ボディ**: `{ "email": "gXXXXXXX@ge.osaka-sandai.ac.jp", "password": "...", "passphrase": "..." }`
- **説明**: 新規ユーザーを登録する。`passphrase` には管理者から共有された合言葉、もしくは招待コードを指定する。

#### `POST /user/login`

- **ボディ**: `{ "email": "gXXXXXXX@ge.osaka-sandai.ac.jp", "password": "..." }`
- **説明**: ログインし、Firebase の ID トークンを取得する。

#### `POST /user/info`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: 認証されたユーザーの詳細情報を取得する。

#### `POST /user/update`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "displayName": "New Name", "photoUrl": "...", "password": "..." }`
- **説明**: ユーザー情報 (表示名, プロフィール写真, パスワード) を更新する。

#### `POST /user/resetPassword`

- **ボディ**: `{ "email": "gXXXXXXX@ge.osaka-sandai.ac.jp" }`
- **説明**: パスワードリセットメールを送信する。

---

### Invite API (`/invite`)

ユーザー登録に必要な招待コードを管理する API である。
すべてのエンドポイントは `POST` メソッドを要求する。

#### `POST /invite/validate`

- **ボディ**: `{ "code": "..." }`
- **説明**: 招待コードが有効かどうかを検証する。

#### `POST /invite/create`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: 新しい招待コードを生成する。コードは24時間有効である。認証されたユーザーのみ実行可能である。

#### `POST /invite/delete`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "code": "..." }`
- **説明**: 指定した招待コードを無効化する。認証されたユーザーのみ実行可能である。

---

### Portal API (`/portal`, `/github`, `/discord`)

部員向けポータルや外部サービス連携のための API である。
すべてのエンドポイントは `POST` メソッドと認証を要求する。

#### `POST /portal`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: ポータルサイトに必要なユーザー情報や各種情報をまとめて取得する。

#### `POST /github/invite`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "email": "..." }`
- **説明**: 指定したメールアドレスに GitHub Organization への招待を送信する。

#### `POST /discord/invite`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: Discord サーバーへの招待コードを返す。

---

## シークレットと環境変数

この Worker を動作させるには、いくつかのシークレットと環境変数を設定する必要がある。
ローカル開発では `.dev.vars` ファイルに、本番環境では Wrangler の `secret` コマンドを使用して設定する。

`npx wrangler secret put <KEY_NAME>`

### 必須のシークレット

- **`GITHUB_TOKEN`**: GitHub API トークン。ブログ記事が格納されているリポジトリへの `repo` スコープと、Organization への招待を行うための `admin:org` スコープが必要である。
- **`FIREBASE_API_KEY`**: Firebase プロジェクトの Web API キー。
- **`REGISTER_PASSPHRASE`**: 新規ユーザー登録時に使用する共通の合言葉。(招待コードを基本的に使うため、あまり使わない)
- **`DISCORD_INVITE`**: Discord サーバーの招待コード。
- **`GOOGLE_SA_KEY`**: Google Spreadsheet用のキー
- **`MEMBERS_SPREADSHEET_ID`**: 名簿のシートID
- **`SECRET_KEY`**: 暗号化用などのシークレットキー

### KV Namespace Bindings

Wrangler の設定 (`wrangler.jsonc`) で、以下の KV Namespace がバインドされている必要がある。

- **`BLOG_META`**: ブログ記事のメタデータのキャッシュ用。
- **`INVITE_CODE`**: ユーザー登録の招待コード保存用。
- **`LOGS`**: API の操作ログ記録用。
- **`MEMBERS`**: 名簿のキャッシュ用
- **`CACHE`** 汎用キャッシュ用
