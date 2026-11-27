# terminal-artifact-viewer (仮称)

ターミナルで動く AI agent の会話の中に、agent が作った画像をそのまま表示するための project です。今は Claude Code の mod (plugin) だけがあります (v0.1)。

## できること

- Claude Code が `SendUserFile` で送った PNG と JPEG を、会話の中の、その file の `[image]` の行の直後に表示します。専用の command や prompt は要りません。
- 画像でない file の行は、そのまま残ります。
- 表示できなかった画像は、行の下に理由を 1 行出します (送った後に消えた、上書きされた、など)。
- 画像を描けない端末では、何も足さず、Claude Code の元の表示のままにします。

添付ごとに「●」の行が付きます。Claude Code の行を、画像ごとに区切って描かせているためです。

## 確かめた環境

- macOS 26.7.3
- iTerm2 3.7.9 (直下で使う場合と、その中の Herdr 0.9.5 で使う場合)
- Claude Code 2.1.332

画像の変換に macOS の `sips` を使うので、macOS だけで動きます。

## 入れ方

この repo を clone した folder から入れます。Claude Code はその folder を直接読むので、更新は `git pull` と `/reload-plugins` で済みます。

```bash
git clone https://github.com/kosako/terminal-artifact-viewer.git
claude plugin marketplace add ./terminal-artifact-viewer
claude plugin install terminal-artifact-viewer@terminal-artifact-viewer
```

GitHub から直接入れることもできます。Claude Code の prompt で次を打ち、`Add marketplace?` に `y` で答え、scope を選びます。

```text
/plugin install terminal-artifact-viewer --marketplace kosako/terminal-artifact-viewer
```

### Herdr の中で使うとき

Herdr の中では、Claude Code が端末を画像に対応したものと判定しません。起動するときに `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` が要ります。plugin からは設定できません (起動した後に変えても効かないことを確かめています)。

zsh なら、`~/.zshrc` に次の 1 行を足すと、Herdr の中で起動したときだけ付きます (Herdr は pane に `HERDR_ENV` を置きます)。

```bash
[[ -n $HERDR_ENV ]] && export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1
```

戻すときは、この行を消して、Herdr の pane を開き直します。設定が無いまま Herdr の中で画像を送ると、plugin は元の表示に戻り、この設定が要ることを 1 度だけ知らせます。

iTerm2 の直下では、この設定は要りません。

## 設定

| 項目 | 既定 | 意味 |
| --- | --- | --- |
| Cell aspect (`cellAspect`) | 0.41 | 端末のセルの幅 ÷ 高さ。0.2 から 1.0 |

画像が縦につぶれて見えたら値を上げ、縦に伸びて見えたら下げます。font や文字の大きさで変わります。0.41 は、確かめた環境 (セル 7.0 × 16.9 px) で測った値です。

設定は、Claude Code の `/config` の一覧で変えます。今の値は、次の command で見られます。

```bash
claude plugin configure terminal-artifact-viewer
```

## 止め方と外し方

```bash
claude plugin disable terminal-artifact-viewer@terminal-artifact-viewer    # 止める (enable で戻す)
claude plugin uninstall terminal-artifact-viewer@terminal-artifact-viewer  # 外す
claude plugin marketplace remove terminal-artifact-viewer                  # 入れ口も消す
```

止めたり外したりすると、Claude Code の元の表示に戻ります。Herdr のための zsh の 1 行は、別に消します。

## 読むものと読まないもの

- 読むのは、この session で成功した `SendUserFile` の結果の、PNG と JPEG の添付だけです。返信の文の中の path や URL は読みません。resume で開いた古い行は、文字のままにします。
- 送った時点の file の実体 (link を解決した path、大きさ、更新時刻) を覚え、それと違う file は読みません。
- 読むのは 20 MiB までの file、画素数 4,000 万まで、1 辺 20,000 px まで、1 回の結果で 8 枚までです。
- JPEG と 2 MiB を超える PNG は、読んだ中身の写しを私的な一時 folder に書いてから `sips` で PNG にし、長辺 1600 px まで縮めます。一時 folder は変換の後に消します。元の file は書き換えません。
- 画像は memory の中だけに置き (32 枚、合計 64 MiB まで)、file には保存しません。外部への通信はしません。

## 既知の制約

- Claude Code の mod の API に依存します。確かめたのは 2.1.332 です。
- 描けない端末かどうかは、最初の画像を描いてから確かめます。そのため、描けない端末では、画像の代わりに path の文字が 1、2 秒出てから元の表示に戻ります。
- セルの縦横比は、端末の font に合わせて設定で調整します。

## 開発

- 設計: [docs/v0.1-design.md](docs/v0.1-design.md)
- 受け入れの確認: [docs/v0.1-acceptance.md](docs/v0.1-acceptance.md)
- Phase 0 の記録: [docs/phase0-poc.md](docs/phase0-poc.md)。検証に使った mod は [poc/tav-probe/](poc/tav-probe/)
- test: `node --test 'tests/unit/**/*.spec.ts'` (CI でも走る) と `claude plugin test .`
- 手元の folder をそのまま試すときは `claude --plugin-dir .`

## ライセンス

MIT License です。全文は [LICENSE](LICENSE) にあります。
