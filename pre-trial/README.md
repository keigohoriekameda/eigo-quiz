# Pre 教員承認・生徒試用

このサーバーは開発ブランチを手元で実行します。GitのコミットからPre教材を読み込み、教員が承認した単元を同じコミットの生徒試用画面に提供します。教材JSONと既存のプレビューは従来どおりです。`NODE_ENV=production` では起動できません。

## Windowsで起動する

Git と Node.js 20 以上を用意します。`feature/vocab-2500-foundation` を取得し、作業ディレクトリをリポジトリのルートにします。教材コミット `3229a52335b0480a6dc2fc76f7c610cdbc57ca2f` が手元に無い場合は、浅いクローンを解除するなどしてそのコミットを取得してください。

リポジトリの外に `accounts.json` を作り、教員と生徒に別々のコードを発行します。コードは一人ずつ次のコマンドで生成し、同じ生徒には継続して同じIDを割り当てます。生徒名の欄には試用用の呼称を入れられます。

```powershell
node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))"
```

```json
[
  { "id": "teacher-1", "name": "担当教員", "role": "teacher", "code": "教員用の生成結果" },
  { "id": "student-1", "name": "試用01", "role": "student", "code": "生徒用の生成結果" }
]
```

PowerShellで実際のファイルの絶対パスを指定して起動します。`PRE_TRIAL_STATE` には進捗と承認記録が保存されます。

```powershell
$env:PRE_TRIAL_COMMIT = '3229a52335b0480a6dc2fc76f7c610cdbc57ca2f'
$env:PRE_TRIAL_ACCOUNTS = 'C:\PreTrial-Private\accounts.json'
$env:PRE_TRIAL_STATE = 'C:\PreTrial-Private\state.json'
node pre-trial/start.mjs
```

- Windowsでの教員承認は `http://127.0.0.1:4170/teacher` をChromeで開きます。
- Windowsでの生徒試用は `http://127.0.0.1:4170/student` をChromeで開きます。
- iPadでは、塾内で配信するHTTPSのホスト名で `/student` をSafariで開きます。直接配信する場合は `PRE_TRIAL_HOST` に校内の待ち受けアドレス、`PRE_TRIAL_TLS_CERT` と `PRE_TRIAL_TLS_KEY` に端末が信頼する証明書と鍵のパスを指定します。既存の校内HTTPSプロキシを使う場合は、上のループバック起動を使い、専用のホスト名から転送します。

塾内の試用対象端末に配信先を限定し、同じ状態ファイルを使うサーバーは1プロセスで運用します。状態ファイルと利用コードは担当教員の管理下に置きます。

## 承認と試用

1. 教員コードでログインし、教材コミットと単元を選びます。各単元で問題ID、見出し語、例文・語句、四択、正答と解説を20問分確認します。例文なしの直接出題も画面で区別できます。
2. 確認欄にチェックして単元を承認します。教員ID・表示名・承認日時・コミットが単元に記録されます。別のコミットでは、その版の承認を行います。要確認フラグが残る単元は承認操作の対象外です。
3. 生徒コードでログインし、承認済みの単元を選びます。通常練習では20問中18問の正解で合格です。誤答は復習に入り、復習で正答すると外れます。
4. 進捗は生徒IDと教材コミットごとにサーバーの状態ファイルに保存されます。途中で再読み込みした場合は、同じ利用コードを入力し直して再開します。共用端末では終了時にログアウトし、利用者を交代します。利用コードやログイントークンはアプリのブラウザーストレージに保存しません。

教員の単元承認は試用版に適用されます。教材の `review_status` を変更したり、本番への公開操作を行ったりするものではありません。

## 検査

直接出題のPre単語（`unit_type: word`、`prompt_type: meaning_4choice`）は、`context_en: ""` を使えます。例文中の意味を問う `meaning_in_context_4choice` と、語句全体の意味を問う `phrase_meaning_4choice` は空でない英文が必須です。品詞、四択の重複、意味グループ、未解決フラグの検査は維持します。

```powershell
node scripts/audit-pre.mjs
node scripts/audit-pre-quality.mjs
node scripts/validate-vocabulary.mjs data/pilot-reviewed.json
node --test
```

実機では教員承認と生徒試用の2画面を開き、承認前の出題制限、採点、誤答復習、再ログイン後の途中再開、生徒コードの切り替えを確認します。
