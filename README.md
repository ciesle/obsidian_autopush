# Auto Push on Close

Obsidian のメインウィンドウを閉じると、保管庫の変更をコミットし、現在のブランチの追跡先へバックグラウンドでpushするデスクトップ用プラグインです。

新規ファイル、変更、削除と既にステージされた変更をまとめてコミットします。`.gitignore` で無視されたファイルは対象になりません。未コミット変更がなくても、既存の未送信コミットをpushします。

## 導入

必要なものは Node.js 18以上、Git、追跡先が設定された保管庫のブランチです。Git リポジトリのルートと保管庫のルートは一致させてください。GitHub などへの認証は、パスワード入力画面なしで利用できる状態にしてください。SSHでは ssh-agent などの設定が必要です。

このディレクトリで `.env.example` をコピーし、ローカルの保管庫パスを設定します。依存パッケージのインストールは不要です。

```bash
cp .env.example .env
```

`.env` の設定項目は次のとおりです。実際のパスや個人用の値をREADMEやソースへ書き込む必要はありません。

| 項目 | 設定内容 |
| --- | --- |
| `VAULT_PATH` | 必須。Git管理された保管庫の絶対パス。`~/Notes` のような指定も可能です。 |
| `OBSIDIAN_CONFIG_DIR` | 保管庫内の設定フォルダー。通常は `.obsidian`。 |
| `NODE_PATH` | Node.js 実行ファイルの絶対パス。空欄なら導入コマンドを実行したNode.jsを使います。 |
| `GIT_PATH` | Git 実行ファイルのパス。通常は `git`。GUIから見つからなければ絶対パスを指定します。 |
| `COMMIT_MESSAGE` | コミットメッセージ。`{date}` は実行時の日時に置き換わります。 |

空白を含む値は引用符で囲みます。`.env` は文字列として読み込み、シェルコマンドや変数展開は実行しません。環境変数に同じ項目がある場合は環境変数を優先し、保管庫パスと設定フォルダーのコマンド引数はそれより優先します。

保管庫のブランチに追跡先がない場合は、先に保管庫で設定してください。次の例は既存の `origin` の `main` を追跡する場合です。ブランチ名は実際の構成に合わせてください。

```bash
git -C /path/to/your/vault push -u origin main
```

設定後、次を実行します。

```bash
npm run check
npm test
npm run build
npm run install:vault
```

導入処理は4つのプラグインファイルを `.obsidian/plugins/autopush-on-close/` に配置し、`community-plugins.json` の既存項目を保持してプラグインIDを追加します。初回は使用した Node.js の絶対パスを設定します。既存の設定は保持し、`.env` に明示した実行ファイルやメッセージの値だけ更新します。有効化設定の変更前には `.autopush-backup` を保存します。独自の設定フォルダーの場合は第2引数で指定できます。

```bash
npm run install:vault -- /path/to/your/vault .obsidian-custom
```

`.env` は導入スクリプトが読み込み、実行時の値をプラグインのローカル設定 `data.json` に保存します。`.env` を変更したら導入コマンドを再実行してください。Obsidianの設定画面からも実行ファイルやメッセージを変更できます。

Obsidian が起動中なら再読み込みし、設定 → コミュニティプラグインで「Auto Push on Close」が有効になっていることを確認してください。制限モードが有効な場合は解除してください。保管庫の `.gitignore` に `.obsidian/` を追加すると、プラグイン設定や起動ログをpush対象から除外できます。既にGitで追跡されているファイルには無視設定が適用されません。

プラグイン設定の「今すぐ実行」で動作確認できます。この操作は実際にコミット・pushします。コマンドパレットにも「今すぐコミットしてpush」「前回の結果を表示」があります。

## 動作と制約

- メインウィンドウの `beforeunload` で独立した Node.js プロセスを起動するため、Obsidian の終了後も処理を続けます。ポップアウトウィンドウだけを閉じた場合や、プラグインを無効化した場合には起動しません。
- `beforeunload` は再読み込みや保管庫の切り替えでも発生します。別の処理が終了を取り消しても起動する場合があります。強制終了、クラッシュ、OSのシャットダウン時の完了は保証できません。
- 終了時のファイル保存を待つため2秒後にGit操作を始めます。最終保存の完了を保証するAPIはなく、必ず全変更が保存される保証はありません。
- upstream のないブランチ、detached HEAD、マージ・リベース等の途中、競合状態では停止します。自動pull、競合解消、強制pushは行いません。リモートが先行していた場合はローカルコミットを残し、通常のpush失敗として記録します。
- 各Gitコマンドは最大120秒で打ち切ります。入力待ちは無効化しています。Gitフックも通常どおり動作します。別のGit操作やノート編集との並行実行は避けてください。
- Git が GUI 環境の PATH から見つからない場合は、プラグイン設定に実行ファイルの絶対パスを指定してください。Node.js を移動・削除した場合も設定の更新が必要です。

## ログと失敗時の確認

ワーカーのログと結果は通常、保管庫内の次の場所に残ります。Gitの管理領域なのでコミット対象に含まれません。

```text
.git/autopush-on-close/worker.log
.git/autopush-on-close/last-result.json
```

起動失敗とワーカーがログ保存前に停止した原因は、次のログで確認できます。

```text
.obsidian/plugins/autopush-on-close/logs/launcher.log
```

前回の処理が失敗していれば、次回Obsidian起動時に通知します。ただし Node.js 自体の起動失敗など、結果ファイルが作成される前の失敗は起動ログの確認が必要です。ログは1MBを超えると次の追記時に `.previous` へ退避します。

同じ保管庫で処理が重なると後続処理をスキップします。ワーカーを強制終了した場合は `worker.lock` が残ることがあります。ファイルにあるPIDのプロセスが動作していないことを確認してからロックを削除し、手動コマンドで再実行してください。worktreeの場合は実際の保存場所を次で確認できます。

```bash
git -C /path/to/your/vault rev-parse --git-path autopush-on-close
```

## 開発と検証

配布物は `dist/autopush-on-close/` に生成します。ソースは CommonJS で、ビルドはファイルのコピーだけです。テストは一時ディレクトリ内のローカルGitリポジトリとbareリポジトリを使い、実際の保管庫や外部リモートに変更を加えません。

終了イベントの設計は [Obsidianのライフサイクル管理](https://docs.obsidian.md/plugins/guides/lifecycle-management)、[Electronの終了イベント](https://www.electronjs.org/docs/latest/api/browser-window)、[Node.jsの独立プロセス](https://nodejs.org/api/child_process.html#optionsdetached) を参照しています。実際のObsidianでの終了・再読み込みとGUIのPATH・認証は実機で確認してください。

## 公開するファイル

公開リポジトリにはソース、テスト、README、個人用の値を含まない `.env.example` を置きます。`.env` とその派生ファイル、ビルド結果、ログ、Agentの設定・作業記録は `.gitignore` で除外しています。Gitの認証情報は `.env` に入れず、Gitの認証設定や ssh-agent で管理してください。
