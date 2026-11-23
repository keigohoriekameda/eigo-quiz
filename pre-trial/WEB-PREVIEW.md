# Vercel Preview・Supabase 試用手順

最初の2単元を共通アカウントで試すための構成です。ホスティング用の設定は専用の出力先に展開します。既存アプリの配信設定、認証、教材35単元（700問）はそのままです。試用アプリは Vercel の Preview 環境でのみ起動します。

## 既存 Skyline で確認した仕様

- 生徒は共通IDの前後の空白を除いて小文字化し、`login_id@AUTH_INTERNAL_EMAIL_DOMAIN` で Supabase Auth のパスワード認証を行います。Auth のユーザー UUID に対応する有効な `profiles` と、対象製品への有効期限内の `user_product_access` が必要です。製品自体も有効である必要があります。
- 教員は既存の管理者メールとパスワードで認証し、同じ UUID を持つ有効な `admin_users` で教員権限を確認します。
- このアプリは共有テーブルを参照します。承認、学習進捗、Web 試用セッションはアプリ専用の3テーブルに保存します。各リクエストでアカウントと利用権限を再確認します。途中の解答、前回の成績、問題別の復習状況、完了した出題の日時と得点を生徒 UUID・教材コミット・単元ごとに保存します。セッションの有効期限は4時間で、ログアウトすると取り消されます。共用端末では使い終わったらログアウトしてください。
- 参照した実装は [生徒認証](https://github.com/keigohoriekameda/skyline-learning-check/blob/main/src/lib/auth/student.ts) と [共通IDの変換](https://github.com/keigohoriekameda/skyline-learning-check/blob/main/src/lib/auth/idMapping.ts)、[利用権限](https://github.com/keigohoriekameda/skyline-learning-check/blob/main/src/lib/auth/productAccess.ts)、[教員認証](https://github.com/keigohoriekameda/skyline-learning-check/blob/main/src/lib/auth/teacher.ts) です。列の定義は [共通DBのSQL](https://github.com/keigohoriekameda/eiken-5-adventure/blob/main/supabase/migrations/20260714120000_initial_learning_platform.sql) と [管理者DBのSQL](https://github.com/keigohoriekameda/project-skyline-admin/blob/main/supabase/migrations/20260718000000_admin_platform.sql) を確認しました。

## 承認後に行う設定

1. **分離した試用 Supabase** を用意します。上記の既存実装と同じ Auth・共有テーブルの契約が必要です。架空の生徒2人と教員1人を登録し、有効なプロフィールと管理者レコードを準備します。この試用用に決めた製品コード（例 `eigo-pre-pilot`）を登録し、対象生徒だけに利用権限を与えます。既存 Skyline の本番ユーザーは試用プロジェクトに複製せず、実アカウントでの接続は担当者の確認を経て別途設定します。
2. [試用専用テーブルのSQL案](./pre-preview-schema.sql) を試用 DB 側でレビューします。既存の共有テーブル、既存の認証ユーザー、既存アプリの進捗への変更は含みません。権限を確認してから適用する手順です。運用上の保持期間を決め、4時間を過ぎた試用セッションの行は定期的に整理してください。
3. 最新の開発ブランチを取得した Git チェックアウトから `node pre-trial/stage-web.mjs ..\eigo-pre-preview` を実行します。出力先には新規ディレクトリを指定します。Git HEAD の教材35単元（700問）を品質検査し、その版と試用アプリを同梱します。出力先を既存と分離した Vercel プロジェクトに使い、Preview のアクセス制限と下記の環境変数を設定します。Vercel のシステム環境変数 `VERCEL_ENV` がアプリに公開されることを確認します。
4. 別途公開許可を得た後、Preview を開きます。パスは `/teacher` と `/student` です。教員が実際に各20問を確認して承認し、Windows Chrome・iPad Safari・スマートフォンで生徒2人の分離とログアウト・再開を確認します。版を切り替えると、承認と進捗の保存領域がコミット単位で分かれます。試用中は同じ版を使ってください。

| 環境変数 | Preview に設定する値 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 分離した試用 Supabase の HTTPS URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 同じプロジェクトの公開用キー |
| `SUPABASE_SECRET_KEY` | 同じプロジェクトのサーバー専用キー。コード・ブラウザ・Gitに出さない |
| `AUTH_INTERNAL_EMAIL_DOMAIN` | 試用アカウントの内部メールアドレス生成に使用したドメイン |
| `PRE_SKYLINE_PRODUCT_CODE` | 試用 DB に登録し対象者へ付与した製品コード |
| `VERCEL_ENV` | Vercel が Preview に自動設定する `preview` |

使用する API と設定の参照先は [Supabase APIキー](https://supabase.com/docs/guides/getting-started/api-keys)、[Data API の権限](https://supabase.com/docs/guides/api/securing-your-api)、[Vercel Node.js Runtime](https://vercel.com/docs/functions/runtimes/node-js) です。
