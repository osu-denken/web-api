# OSU-DENKEN API
- https://osu-denken.github.io/debug/

## ユーザ認証
Basic認証もしくはGETパラメータで認証を行い、トークンを返す。<br />
パスワードにはSHA-256でハッシュ化した値をセットする。

- Basic認証
```bash
/auth 
```

AuthorizationヘッダにBasic認証をセットしてリクエストを送る。

- GETパラメータ
```bash
/auth?user=<ユーザID>&pass=<ハッシュ済みパスワード>
```

## 認証テスト
Bearerトークンを使って認証をテストする。

```bash
/test
```

## PING
APIの稼働確認を行う。

```bash
/ping
```

# OSU-DENKEN User API



# OSU-DENKEN Blog API

## ページ一覧
それぞれのページ名、ハッシュ値、ファイルサイズの一覧を取得する。

```bash
/blog/list
```

### 構造
```json
[
  {
    "name": "<ページ名>",
    "sha": "<ハッシュ値>",
    "size": <ファイルサイズ>
  },
  ...
]
```

## ページの取得
```bash
/blog/get?page=<ページ名>
```

### 構造
```json
{
  "name": "<ページ名>",
  "sha": "<ハッシュ値>",
  "size": <ファイルサイズ>,
  "content": "<ページ内容>"
}
```

## ページの更新
POSTメソッドでトークンと一緒にページ名、内容を送信してページを更新する。

```bash
/blog/update
```

### ヘッダ
```bash
Authorization: Bearer <トークン>
page: ページ名
```

ボディを使わずにヘッダにcontentをセットすることも可

### ボディ
```
<ページ内容>
```

## シークレットキーについて
- GITHUB_TOKEN - GitHub APIトークン (repoとadmin:orgが必要)
- AUTH_TOKEN - OSU DENKEN APIトークン
- FIREBASE_API_KEY - Firebase APIキー
- DISCORD_INVITE - Discord招待コード

### シークレットの追加
`npx wrangler secret put キー名`を入力して実行し、その後、値を入力する。
<br />
削除は `npx wrangler secret delete キー名` を実行する。