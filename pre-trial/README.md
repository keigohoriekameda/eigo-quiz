# Pre 教員承認・生徒試用

通常の起動では Pre Lv.1 の最初の2単元（数、曜日・月・日付）を扱います。単元の20問を教員が確認・承認した後に、生徒がその単元を解けます。20問中18問以上で合格し、間違えた問題だけを復習できます。

## ローカル試用

Node.js 22 以降と Git が必要です。開発ブランチを取得済みのリポジトリで、Windows PowerShell から実行します。

~~~powershell
git fetch origin feature/vocab-2500-foundation
git switch feature/vocab-2500-foundation
git merge --ff-only origin/feature/vocab-2500-foundation
git log -1 --oneline
$env:PRE_TRIAL_ACCOUNTS = 'C:\pre-pilot-private\accounts.json'
$env:PRE_TRIAL_STATE = 'C:\pre-pilot-private\state.json'
Remove-Item Env:PRE_TRIAL_COMMIT,Env:PRE_TRIAL_SCOPE -ErrorAction SilentlyContinue
node pre-trial/start.mjs
~~~

教材は起動時に Git の HEAD から読み込みます。PowerShell の fast-forward は開発ブランチのローカルコピーを更新する操作です。承認と進捗は教材コミット別なので、試用期間中は同じ版で運用してください。塾長が700問を確認する場合は `$env:PRE_TRIAL_SCOPE = 'all'` を指定できます。

アカウントファイルはリポジトリ外に作り、教員1人・生徒2人以上に個別のコードを発行できます。各アカウントの `code` には20〜128文字のランダムな英数字、ハイフン、アンダースコアを使います。PowerShell では `node -p "require('node:crypto').randomBytes(24).toString('base64url')"` でコードを1件生成できます。次の例の `code` は各自別々に生成して差し替えてください。

~~~json
[
  {"id":"teacher-a","name":"試用教員","role":"teacher","code":"REPLACE_WITH_RANDOM_VALUE_1"},
  {"id":"student-a","name":"試用生徒A","role":"student","code":"REPLACE_WITH_RANDOM_VALUE_2"},
  {"id":"student-b","name":"試用生徒B","role":"student","code":"REPLACE_WITH_RANDOM_VALUE_3"}
]
~~~

- [教員画面](http://127.0.0.1:4170/teacher) でログインし、単元を選びます。ID・見出し語・例文・四択・正答・解説を確認し、画面下部の確認欄にチェックを入れて承認します。
- [生徒画面](http://127.0.0.1:4170/student) でログインし、承認した単元を開きます。ユニット1だけ承認すると、ユニット2は承認待ちです。18問正解・2問誤答で合格と誤答2問の復習を確認できます。
- 別の単元の途中でログアウトし、別の生徒で同じ端末にログインして履歴の分離を確認します。元の生徒でログインし直すと「途中から再開」が表示されます。ブラウザの再読み込み後も、再ログインすれば続きから開けます。
- ローカルの保存先は `PRE_TRIAL_STATE` です。同じ状態ファイルを使うサーバーは1プロセスで運用してください。このファイルとアカウントファイルは端末の権限で管理します。別端末へ配信する場合は `PRE_TRIAL_HOST` と、その端末から信頼される証明書の `PRE_TRIAL_TLS_CERT`・`PRE_TRIAL_TLS_KEY` が必要です。自宅やスマートフォンからの試用には下記の Web 版を使います。

~~~powershell
node --test
node scripts/audit-pre.mjs
node scripts/validate-vocabulary.mjs data/pilot-reviewed.json
node scripts/audit-pre-quality.mjs
~~~

下書き700問は品質検査の対象です。正式承認用の検査は承認済みデータに対して実行します。試用画面の承認記録は保存先に記録され、教材JSONの承認状態とは別です。

Web 版の準備は [Vercel Preview・Supabase 試用手順](./WEB-PREVIEW.md) を参照してください。
