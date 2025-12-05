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
