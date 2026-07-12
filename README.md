# OSU-Denken Web API
大阪産業大学 電子計算研究部の [電研公式サイト](https://osu-denken.github.io/) のバックエンド API <br />
Cloudflare Workers上で稼働しています。

## 機能

- **Blog API**: GitHubリポジトリ内の Markdownファイルをブログ記事として管理 (取得、一覧、更新) 
- **Image API**: ブログ記事の画像のアップロードや削除など
- **User API**: Firebase Authenticationを用いたユーザー認証、管理 (大産大のドメインを持つメールアドレスのみ登録可能)
- **Invite API**: 新規ユーザー登録のための招待コード作成、管理
- **Portal API**: 部員向けポータルサイト用の情報集約、および外部サービス (GitHub, Discord) への招待機能
- **Private Post API**: 部員だけが読める非公開記事の管理。本文ごと D1 に保存される
- **Member API**: 部員名簿の管理 (一覧、詳細、仮登録の承認・却下、編集)。名簿は D1 データベースに保存される

## セットアップ

### 前提
- [Node.js](https://nodejs.org/) (v20 以降)
- [pnpm](https://pnpm.io/ja/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (Cloudflareアカウントでのログインが必要)

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
- **ボディ**: `{ "page": "<スラッグ>", "meta": { "title": "...", ... }, "content": "<記事の本文 (Markdown)>" }`

メタデータはヘッダの長さ制限に収まらないことがあるため、ボディに入れる。`page` はヘッダでも受け付ける。

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

#### `POST /user/verifyEmail`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: ログイン中のユーザーへ確認メールを再送する。

#### `POST /user/refresh`

- **ボディ**: `{ "refreshToken": "..." }`
- **説明**: リフレッシュトークンから新しい ID トークンを取得する。

#### Google連携

大学のGoogleアカウント (`@ge.osaka-sandai.ac.jp`) でのログインと、既存アカウントへの連携を扱う。

- `POST /user/google` … Google の ID トークン (`{ "credential": "..." }`) を Firebase のトークンに交換してログイン/新規登録する。ドメイン外・未確認メールは拒否する。
- `POST /user/linkGoogle` … ログイン中のアカウントに Googleアカウントを連携する (以後どちらでもログイン可)。要認証。
- `POST /user/unlinkGoogle` … Google連携を解除する。他にログイン手段が無い場合は拒否する。要認証。
- `POST /user/providers` … そのアカウントに紐づくログイン手段 (`hasPassword` / `hasGoogle`) を返す。要認証。

#### 2段階認証 (TOTP)

- `POST /user/loginTotp` … ログイン後に預けられた `mfaPendingToken` と6桁 `code` を検証し、トークンを受け取る。
- `POST /user/totp/setup` … シークレットと QR を発行する (まだ有効化しない)。要認証。
- `POST /user/totp/enable` … `code` を検証して2段階認証を有効化し、リカバリコードを返す。要認証。
- `POST /user/totp/disable` … `code` (またはリカバリコード) を検証して解除する。要認証。

> `POST /user/login` および `POST /user/google` は、2段階認証が有効なアカウントでは `{ "mfaRequired": true, "mfaPendingToken": "..." }` を返し、トークンは渡さない。`/user/loginTotp` での検証が必要になる。

---

### Invite API (`/invite`)

ユーザー登録に必要な招待コードを管理する API である。
すべてのエンドポイントは `POST` メソッドを要求する。

#### `POST /invite/validate`

- **ボディ**: `{ "code": "..." }`
- **説明**: 招待コードが有効かどうかを検証する。

#### `POST /invite/create`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: 新しい招待コードを生成する。コードは24時間有効である。`InviteCodeCreate` 権限が必要である。

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
- **説明**: 幹部が指定したメールアドレスを GitHub Organization に招待する。`MemberManage` 権限が必要である。

#### `POST /github/join`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "username": "..." }` (連携済みなら省略可)
- **説明**: 部員自身が GitHub ユーザー名で Organization への招待を受け取る。連携済みならユーザー名を自動取得する。

#### `POST /github/username`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: 連携済みの GitHub ログイン名を返す (未連携なら `null`)。

#### `/github/token`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)。`BlogEdit` 権限が必要。
- **説明**: GitHub Personal Access Token の確認 (`GET`) / 保存 (`POST`・`PUT`) / 削除 (`DELETE`)。トークンは暗号化して保存される。

#### GitHub OAuth 連携

- `POST /github/oauth/start` … 認可 URL を返す。`BlogEdit` 権限が必要。
- `GET /github/oauth/callback` … GitHub からのコールバック。認可コードをトークンに交換して保存し、ポータルの連携タブへリダイレクトする。

> ブログ編集や画像アップロードは、各部員が連携した GitHub トークン (OAuth または PAT) を使ってコミットする。

#### `POST /discord/invite`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: Discord サーバーへの招待コードを返す。

---

### Private Post API (`/private-posts`)

部員だけが読める非公開記事の API である。
ブログ記事と違い、GitHub の公開リポジトリではなく D1 データベースに本文ごと保存される。
すべてのエンドポイントは `POST` メソッドと認証を要求する。

#### `POST /private-posts/list`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **説明**: 非公開記事を更新の新しい順に一覧する。本文は含まれない。`PrivatePostView` 権限が必要である。

#### `POST /private-posts/get`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "slug": "..." }`
- **説明**: 非公開記事の本文を取得する。`PrivatePostView` 権限が必要であり、誰が読んだかはログに記録される。

#### `POST /private-posts/update`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "slug": "...", "title": "...", "content": "..." }`
- **説明**: 非公開記事を新規作成または上書きする。`PrivatePostEdit` 権限が必要である。`slug` は英小文字・数字・ハイフンのみを受け付ける。

#### `POST /private-posts/delete`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "slug": "..." }`
- **説明**: 非公開記事を削除する。`PrivatePostEdit` 権限が必要である。

---

### Member API (`/members`)

部員名簿を管理する API である。
すべてのエンドポイントは `POST` メソッドと認証を要求し、加えて `MemberManage` 権限を要求する。

#### `POST /members/list`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **クエリパラメータ**:
    - `status` (任意): `pre-active` / `active` / `withdrawn` / `graduated` / `rejected` のいずれか。省略時は全件
- **説明**: 部員の一覧を取得する。電話番号は含まれない。

#### `POST /members/detail`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "id": 1 }`
- **説明**: 部員一人の詳細を取得する。電話番号は幹部にのみ返され、その参照はログに記録される。

#### `POST /members/approve`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "id": 1 }`
- **説明**: 仮部員 (`pre-active`) を承認して在籍 (`active`) にする。`MemberApprove` 権限が必要である。

#### `POST /members/reject`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "id": 1 }`
- **説明**: 仮部員の登録を却下する。`MemberApprove` 権限が必要である。

#### `POST /members/update`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **ボディ**: `{ "id": 1, "name": "...", "furigana": "...", "email": "...", "tel": "...", "roleBits": 0, "permBits": 0, "status": "active", "joinDate": "2025-04-01" }` (`id` 以外は変更したい項目のみ)
- **説明**: 部員の情報を更新する。項目ごとに必要な権限が異なる。
    - `tel`: 幹部のみ
    - `roleBits`: `MemberRoleEdit`
    - `permBits`: `MemberPermissionEdit`
    - `status`: `MemberDelete` (自分自身の在籍状態は変更できない)

---

### Image API (`/image`)

ブログ記事に使う画像を GitHub リポジトリの `images/` で管理する API である。
アップロード・削除には各部員が連携した GitHub トークンを使う。

#### `POST /image/list`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)。`BlogEdit` 権限が必要。
- **説明**: アップロード済み画像を一覧する。各画像にアップロード日時 (`uploadedAt`) を付ける。

#### `POST /image/upload`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)。`ImageUpload` 権限が必要。
- **ボディ**: `multipart/form-data` の `file` (必須) と `name` (任意)
- **説明**: 画像をアップロードする。対応形式は `jpg` / `png` / `webp` / `gif`、最大 20MB。`name` を省略すると UUID になる。

#### `POST /image/delete`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)。`ImageDelete` 権限が必要。
- **ボディ**: `{ "filename": "...", "sha": "..." }`
- **説明**: 画像を削除する。参照している記事では表示されなくなる。

---

### SwitchBot API (`/switchbot`)

部室の SwitchBot (Smart Lock) を操作する API である。
すべて認証と `SwitchBotControl` 権限を要求する。

- `POST /switchbot/validate` … トークンが有効かどうかを確認する。
- `POST /switchbot/list` … デバイス一覧を返す。
- `POST /switchbot/lock` … 施錠する。
- `POST /switchbot/unlock` … 解錠する。

---

### Terminal API (`/terminal`)

トップページのターミナルに表示される `welcome.md` を編集する API である。
`welcome.md` はサブモジュール [ecrd-fake-terminal](https://github.com/osu-denken/ecrd-fake-terminal) にある。

- `GET /terminal/get?page=welcome` … 内容を取得する。
- `POST /terminal/update` … 内容を更新し、コミット後に公式サイトの再ビルドを起動する。`PageEdit` 権限が必要。

---

### Site Pages API (`/site-pages`)

公式サイト本体 (Next.js) の固定ページ (`content/` 配下) を編集する API である。
すべて認証と `PageEdit` 権限を要求する。

- `POST /site-pages/list` … 編集できるファイルの一覧を返す (許可リスト方式)。
- `GET /site-pages/get?path=<path>` … ファイルの中身を取得する。
- `POST /site-pages/update` … ファイルを更新し、コミット後に再ビルドを起動する。`.json` は壊れているとサイトのビルドごと落ちるため、保存前に妥当性を検証する。

---

### Logs API (`/logs`)

API の操作ログを閲覧する API である。認証と `LogView` 権限を要求する。

#### `GET /logs/list`

- **ヘッダー**: `Authorization: Bearer <ID_TOKEN>` (必須)
- **クエリパラメータ**:
    - `type` (任意): 種別で絞り込む
    - `cursor` (任意): 続きを取得する
    - `limit` (任意): 1〜100 (既定 50)
- **説明**: 操作ログを新しい順に一覧する。

---

## レート制限

認証まわりのエンドポイントには回数制限がある。超えると `429 TOO_MANY_REQUESTS` を返す。

学内からは NAT 越しに全員が同じIPに見えるため、主となる窓はメールアドレス単位である。
IP単位の窓はそれに緩く重ねてあり、アカウントを次々に変えて試す相手を止めるためのものである。

| エンドポイント | 単位 | 窓 | 回数 |
| --- | --- | --- | --- |
| `POST /user/login` | メールアドレス | 5分 | 10 |
| `POST /user/login` | IP | 5分 | 100 |
| `POST /user/register` | メールアドレス | 1時間 | 5 |
| `POST /user/register` | IP | 1時間 | 30 |
| `POST /user/resetPassword` | メールアドレス | 1時間 | 5 |
| `POST /user/resetPassword` | IP | 1時間 | 30 |

2段階認証のコード入力だけは別で、ログイン1回につき5回まで試せる (`MFA_MAX_ATTEMPTS`)。

カウンタは `CACHE` KV の固定窓である。KV は結合性が弱く同時要求を数え落とすことがあるため、厳密な上限ではなく総当たりを非現実的な速度まで落とすためのものとして扱う。

---

## 権限と役職

権限 (`Permission`) と役職 (`Role`) はそれぞれ独立したビットフラグとして管理される。
部員の実効権限は「役職ごとのデフォルト権限」と「個別に付与された追加権限 (`perm_bits`)」の論理和である。

幹部を表す役職 (部長、副部長、主務、会計、マネージャー) のいずれかを持つ部員には、`Executive` が自動的に付与される。

### 権限 (`Permission`)

| ビット | 値 | 名前 | 内容 | 部員 | 幹部 |
| --- | --- | --- | --- | --- | --- |
| `1 << 0` | 1 | `DiscordInviteView` | Discord招待コードの閲覧 | ○ | ○ |
| `1 << 1` | 2 | `MemberView` | 構成員名簿の閲覧 | ○ | ○ |
| `1 << 2` | 4 | `BlogEdit` | ブログ記事の編集 | ○ | ○ |
| `1 << 3` | 8 | `MemberManage` | 部員管理画面を開く | | ○ |
| `1 << 4` | 16 | `MemberApprove` | 仮登録の承認・却下 | | ○ |
| `1 << 5` | 32 | `MemberPermissionEdit` | 部員の権限の変更 | | ○ |
| `1 << 6` | 64 | `MemberRoleEdit` | 部員の役職の変更 | | ○ |
| `1 << 7` | 128 | `MemberDelete` | 部員の在籍状態の変更 | | ○ |
| `1 << 8` | 256 | `PageEdit` | 固定ページの編集 | | ○ |
| `1 << 9` | 512 | `SwitchBotControl` | SwitchBotの操作 | | ○ |
| `1 << 10` | 1024 | `PrivatePostView` | 非公開記事の閲覧 | ○ | ○ |
| `1 << 11` | 2048 | `PrivatePostEdit` | 非公開記事の編集 | ○ | ○ |
| `1 << 12` | 4096 | `ImageUpload` | ブログ用画像のアップロード | ○ | ○ |
| `1 << 13` | 8192 | `ImageDelete` | ブログ用画像の削除 | ○ | ○ |
| `1 << 14` | 16384 | `InviteCodeCreate` | 招待コードの作成 | | ○ |
| `1 << 15` | 32768 | `LogView` | 操作ログの閲覧 | | ○ |

「部員」「幹部」の列は、その役職のデフォルト権限に含まれるかどうかを表す。
電話番号の閲覧・編集だけは権限ビットではなく、幹部の役職を持つかどうかで判定する。

### 役職 (`Role`)

| ビット | 値 | 名前 | 内容 | 幹部を兼ねる |
| --- | --- | --- | --- | --- |
| `1 << 1` | 2 | `Member` | 部員 | |
| `1 << 2` | 4 | `Other` | その他 | |
| `1 << 3` | 8 | `Executive` | 幹部 | - |
| `1 << 4` | 16 | `Manager` | マネージャー | ○ |
| `1 << 5` | 32 | `Accountant` | 会計 | ○ |
| `1 << 6` | 64 | `ChiefClerk` | 主務 | ○ |
| `1 << 7` | 128 | `ViceLeader` | 副部長 | ○ |
| `1 << 8` | 256 | `Leader` | 部長 | ○ |

`1 << 0` は使わない。仮部員は役職ではなく在籍状態 (`pre-active`) で表す。

在籍状態によっても実効権限は変わる。

| 在籍状態 | 実効権限 |
| --- | --- |
| `pre-active` | なし (承認待ち) |
| `active` | 役職のデフォルト権限 + 追加権限 |
| `graduated` | 部員と同等のデフォルト権限 |
| `withdrawn` / `rejected` | なし |

Firebase は認証、D1 は認可を担当する。
D1 の名簿に存在しないユーザーはログインはできるが、認証が必要なエンドポイントはすべて拒否される。
初回の認証時に Firebase のアカウントと名簿の行が `local_id` で紐づけられ、以降は名簿側のメールアドレスを変更しても追随する。

---

## データベース (D1)

部員名簿 (`members`) と非公開記事 (`private_posts`) は D1 データベース `members` に保存されている。スキーマの変更は `migrations/` にマイグレーションを追加して行う。

```bash
# ローカルに適用
npx wrangler d1 migrations apply members --local

# 本番に適用
npx wrangler d1 migrations apply members --remote
```

氏名、電話番号、生年月日などの個人情報を含むマイグレーション (`migrations/*_seed_members.sql`) と `members.csv` は `.gitignore` に登録されており、リポジトリにコミットしてはならない。
`scripts/csv-to-members-sql.mjs` は名簿の CSV からこの seed マイグレーションを生成する。

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
- **`SECRET_KEY`**: 暗号化用などのシークレットキー
- **`SWBOT_TOKEN`**: SwitchBotのトークン
- **`SWBOT_CLIENT_SECRET`**: SwitchBotのシークレットキー

### KV Namespace Bindings

Wrangler の設定 (`wrangler.jsonc`) で、以下の KV Namespace がバインドされている必要がある。

- **`BLOG_META`**: ブログ記事のメタデータのキャッシュ用。
- **`INVITE_CODE`**: ユーザー登録の招待コード保存用。
- **`LOGS`**: API の操作ログ記録用。
- **`CACHE`** 汎用キャッシュ用
- **`USER_CUSTOM`** ユーザーのカスタムデータ

### D1 Database Bindings

- **`DB`**: 部員名簿 (データベース名 `members`)
