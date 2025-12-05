# OSU-DENKEN API
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

## ページ一覧
それぞれのページ名、ハッシュ値、ファイルサイズの一覧を取得する。

```bash
/list
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
/get?page=<ページ名>
```

## ページの更新
POSTメソッドでトークンと一緒にページ名、内容を送信してページを更新する。

```bash
/update
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
