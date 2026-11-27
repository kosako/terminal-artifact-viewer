# Repository Instructions

この repo で作業する agent と人のための決まりです。

## 言語

- 日々のやり取りと docs は日本語にする。利用者が別の言語を求めたときは、それに従う。

## project

- `terminal-artifact-viewer` (仮称) は、ターミナルで動く AI agent の会話の中に、agent が作った画像をそのまま表示する。
- v0.1 の対象は、Claude Code の mod (plugin)、macOS の iTerm2 と、その中の Herdr、local の PNG と JPEG。
- Phase 0 (PoC) の判定は Go。v0.1 (Claude Code の mod) を作り、実機で受け入れの確認をした。

## 正本

- `docs/phase0-poc.md`: Phase 0 の検証の記録と判断。Go の前提は 8 節にある。
- `docs/v0.1-design.md`: v0.1 の決めたこと、処理の流れ、上限、しないこと。上限の値は `src/artifact/limits.ts` にまとめる。
- `docs/v0.1-acceptance.md`: brief の AC01 から AC10 の結果と、確かめた版。
- `README.md`: 利用者向けの説明と今の状態。
- planning の文書 (dashboard、作業ログ、private な参照先) は repo の外に置く。手元の参照先は `.agent-context.local.md` に
  まとめる。この file は git の管理外で、利用者が持ち、agent は読むだけにする。中の参照先を tracked な file に写さない。

## 開発

- Issue ごとに小さな PR にする。無関係な refactor をしない。
- repo の root が v0.1 の plugin (mod) で、`claude --plugin-dir <repo>` で読み込む。hooks の module は
  `src/integrations/claude-code/register.tsx`、session の state の型は `types/index.d.ts`、設定の欄は
  `.claude-plugin/plugin.json` の `userConfig`。state の値の形を変えたら、`atom` の `shape` の tag も変える。
- `poc/tav-probe/` は Phase 0 の結果を再現するための mod で、v0.1 の code を足さない。直すのは、記録の再現に要るときと、
  公開の repo に置くことで害が出うるときだけにする。
- mod の API は Claude Code の版で変わる。使った版を記録に残す。型の定義は engine が `.claude-plugin/types/` に生成し、
  git の対象にしない。
- mod が画像を読む範囲は、`docs/phase0-poc.md` の 5 節の条件に従う。返信の文から path を拾わない、URL を取りに行かない。
- tracked な file に、手元の path、secret、private な URL、利用者の情報を入れない。commit message と PR の本文も同じ。
  session の URL などの識別子も書かない。
- 例に home の下の path を書くときは、名前を placeholder にする (`/Users/<名前>/`)。URL の query などに同じ形が入るときも、
  placeholder か `%2F` に書き換える (CI の検査が URL の中も見るため)。
- AI が書いた commit には、書いた AI の `Co-Authored-By:` trailer を付ける。

## 検査

- CI の job `check` が、default branch の必須の check になっている。今は、tracked な JSON が読めることと、tracked な file に
  home の下の path が無いこと (`scripts/check-home-paths.py`。規則は script の先頭) を確かめる。
- v0.1 で test や型の検査を足すときも、この job に step を足し、job の名前は変えない (変えるなら
  `.github/repo-baseline.json` も同じ PR で直す)。paths で job を絞らない (必須の check が報告されない PR は merge できない)。
- 手元では `python3 -I scripts/check-home-paths.py` で同じ検査を走らせられる。
- `src/artifact/` は Claude Code の API を import しない。test は `tests/unit/*.spec.ts` に書き、
  `node --test 'tests/unit/**/*.spec.ts'` で走らせる (CI の `check` でも走る。node の版は `.node-version`)。
- Claude Code とのつなぎの test は `tests/claude-code/*.test.tsx` に書き、`claude plugin test <repo>` で手元で走らせる。
- module の間の import は、`.ts` の拡張子まで書く (node の test と mod の読み込みの両方で解決できる形)。
- mod の検査: `claude plugin validate <mod の folder>`。
