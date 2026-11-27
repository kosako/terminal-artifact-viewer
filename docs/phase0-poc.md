# Phase 0 PoC の記録

- 実施日: 2026-11-26 から 2026-11-27
- 判定: **Go** (2026-11-27、利用者が受け入れた)。前提が 2 つつく。Herdr の中では、利用者が zsh の設定に 1 行を足す (8 の 1)。セルの縦横比は端末の font で変わり、今は利用者の設定で合わせる前提である (4.3、7)。v0.1 で決めることと作ることは 7 にある。
- 記録の区分: 成功 / 失敗 / 未検証 / 定義 (条件を決めた項目)

## 1. 対象の版 (V01)

| 項目 | 版・設定 |
| --- | --- |
| macOS | 26.7.3 (25G342) |
| iTerm2 | 3.7.9 |
| Herdr | 0.9.5 (TUI、Homebrew)。`[terminal] kitty_graphics` は未設定で、本体の雛形では既定が `true` |
| Claude Code | 2.1.332。fullscreen の描画 (`e.viewport.isFullscreen: true`) |

## 2. 結果の一覧

| ID | 区分 | 観測 |
| --- | --- | --- |
| V01 | 成功 | 上の表のとおり記録した |
| V02 | 成功 | iTerm2 直下の shell で、iTerm2 の inline images (OSC 1337、`preserveAspectRatio=1`) の PNG が、縦横比を保って表示された |
| V03 | 成功 | Herdr の pane の shell で、kitty graphics protocol の PNG が表示された。列数だけを渡すと縦に伸びた (4.3) |
| V04 | 成功 | Claude Code の会話の中で、mod の `Image` 要素が実画像を描いた。Herdr の中では `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` が要り、無いと `alt` の文字 (元の path) が出た。iTerm2 直下では FORCE なしで描けた |
| V05 | 成功 | `[image]` 行の元は `SendUserFile` の結果で、mod は構造化された値から画像の path を取れた (3) |
| V06 | 成功 | 専用の command も追加の prompt も無しに、`SendUserFile` の結果の行の下に実画像が出た |
| V07 | 成功 | Herdr + FORCE で 5 枚を 1 回で送り、送った順に表示された。scroll、pane の幅の変更、入力は問題なかった (人の目視)。幅の変更では描き直しが記録に残った (4.4)。Herdr で別の pane に移って戻っても、移った先に画像は残らず、戻ると元の位置に描き直された (2026-11-27、人の目視) |
| V08 | 定義 | 読み取りの条件を 5 に定めた |
| V09 | 成功 | 参考 OSS 3 件を読み比べた (6) |

F04 (縦横比の維持) は、最初の版 (比 0.5) では満たせなかった。Herdr では縦に約 1.2 倍伸び、iTerm2 直下では画像の下に空き行が出た。原因と直し方は 4.3 にある。

直した版 (比 0.41) は、Herdr + FORCE と iTerm2 直下 (FORCE なし) の両方で F04 を満たした (2026-11-27)。

AC の見通し (AC は v0.1 の受け入れ基準で、PoC は合成した画像で試した): AC01 から AC04 は成り立つ見通し。AC06 は縮小の経路だけ確かめた。AC08 は目視で大きな問題が無かった。AC09 は、FORCE なしで `alt` に戻ることと、本体が `alt` を選んだことを mod が検出できることを、Herdr で確かめた (4.5)。iTerm2 直下 (fullscreen) では、描けたときに検出が誤って働かないことを確かめた。検出した後に engine の行だけに戻す処理は、まだ作っていない。AC05、AC07、AC10 は v0.1 の test で確かめる。

## 3. 画像参照の取得 (V05)

- `[image]` 行は、Claude Code の添付の行を描く部品が出している。形は `› [image] <path> <size>` で、`SendUserFile` の結果が使う。
- `ui.render` の `ToolUse` と `ToolResult` は、どちらも `SendUserFile` の行で呼ばれる。結果が出た後の `e.props.output.attachments[]` には、次の値が入る。
  - `path` (絶対 path)
  - `isImage`
  - `media_type`
  - `pathValidated`
  - `size` (byte 数)
- `tool.call` の `result` にも同じ `attachments` が入る。
- 画面の文字を拾う必要は無い (brief の 5.1 の優先 1 で取れる)。
- 本体の送信の処理では、`pathValidated: true` は「local の path を解決し、stat に成功した」という意味だった。network の path (`/net` など) は送信の前に拒む。`isImage` と `media_type` は拡張子から決めているだけなので、中身は mod が先頭の byte で確かめる。
- `SendUserMessage` も同じ添付の行を使うが、PoC では試していない。権限の経路も読んでいない。v0.1 の対象からは外す。

## 4. 描画の経路 (V02 から V04、V06)

### 4.1 本体の端末の判定

Claude Code 2.1.332 の本体の文字列から読んだ判定は次のとおり。

- kitty graphics は、XTVERSION の応答が kitty 0.28 以上か Ghostty のときに使う。`CLAUDE_CODE_FORCE_TERMINAL_IMAGES` があれば判定を通さずに使う。
- iTerm2 の inline images は、XTVERSION の応答が iTerm2 3.5 以上のときに使う。bytes の source だけで、fullscreen の描画のときに限る。
- tmux と screen の中では、上とは別の扱いになる。
- Herdr の中の Claude Code は、どちらの判定にも当たらなかった。参考 OSS の 1 件は、Herdr の terminal 名が `libghostty` と返るためと書いている。そのため FORCE が要る。

### 4.2 `Image` 要素の source

- 使える形は 4 つ。`{ png }` の base64 (decode 後 2 MiB まで)、`{ rgba, width, height }`、`{ file, format }`、`{ shm, ... }`。iTerm2 の方式では bytes だけが描ける。
- JPEG を直接は受けない。PoC では macOS 標準の `sips` で PNG に変換した。
- 2 MiB を超える PNG は、長辺 1600px に縮めた。8.9MB、3000x2000 の PNG が 1.6MB、1600x1066 になった。
- `sips -Z` は小さい画像を拡大するので、長辺が 1600px を超えるときだけ渡す。

### 4.3 セルの縦横比

- mod の API は、セルの画素の大きさを公開していない (本体の内部には持っている)。`RenderViewport` は桁数と行数だけを持つ。
- PoC は、セルの幅と高さの比を 0.5 と仮定した。実機 (この環境の font) では約 7.0 x 16.9px で、比は 0.41 だった。
- 比が違うときの見え方は、方式で違った。
  - kitty の方式 (Herdr) は、箱いっぱいに引き伸ばす。縦に約 1.2 倍伸びた。
  - iTerm2 の方式 (直下) は、比を保って箱に収める。画像の下に空き行が出た。
- 比を 0.41 にした版で、Herdr + FORCE の実機で試した (2026-11-27)。640x360 の画像は 100 x 23 桁、300x600 の画像は 29 x 24 桁の箱になった。kitty の方式は箱いっぱいに描くので、表示の比は箱の比になる。実測のセルの大きさから計算すると、箱の幅と高さの比は 1.80 と 0.50 で、元の画像 (1.78 と 0.50) との差は 1.3% 以内だった。画面写しでも、円は丸く見えた (目視)。
- iTerm2 直下 (FORCE なし) でも同じ 2 枚を同じ箱の大きさで試し、画像の下の空き行は出なかった。円も丸く見えた (目視)。
- 0.41 はこの machine の font で測った値で、font や大きさが変われば比も変わる。比が合わないときの崩れ方は方式で違う。kitty の方式 (Herdr) では画像が歪み、iTerm2 の方式では空き行が出るだけで済む。
- v0.1 では、この比を利用者の設定 (`userConfig`) で持つ。既定の値は未定 (7)。

### 4.4 再描画

- pane の幅を変えると、描画の hook が呼び直され、新しい桁数が届いた。Herdr の試験では、116、95、61、59、134 桁と変わるたびに描き直した。61 桁では画像を 55 x 15 桁に縮めた。2 回目からは cache を使い、数 ms で済んだ。
- 高さだけの変更では呼ばれない (API の文書どおり)。

### 4.5 描けているかの検出

- `$.ui.blit` は、描画済みの `Image` (key で指定) の source を差し替える API である。PoC では、結果の行を描いてから 1.5 秒後に、1 枚目の `Image` へ同じ画像で差し替えを頼んだ。
- Herdr + FORCE (画像が描けた session) では、応答は `{}` だった。
- iTerm2 直下で FORCE なし (fullscreen で、画像が描けた session) でも、応答は `{}` だった。
- Herdr で FORCE なし (`alt` の文字が出た session) では、応答は `{ deny }` だった。`deny` の文は、`alt` を描いていること、kitty と iTerm2 のどちらの方式にも当たらなかったこと、端末の名前が `libghostty` だったことを書いていた。
- なので mod は、`deny` があるかどうかで、本体が `alt` の文字を選んだことを知れる。文の中身は人向けの文なので、判定には使わない。
- `{}` が示すのは、本体が画素で描く経路を選んだことまでで、端末が実際に表示したことではない。FORCE は本体の問い合わせを飛ばすので、FORCE を付けた描けない端末でも `{}` になりうる。表示したことは、人の目視 (画面写し) で確かめた。
- 未確認の点: iTerm2 直下で fullscreen でない描画のときの応答、画面の外へ scroll した `Image` への応答。

## 5. 読み取りの条件 (V08)

`$.fs` は engine の process として読み、Claude Code の権限の rule を通らない。なので mod が自分で範囲を絞る。

- 本体の `SendUserFile` は、送る前に各 file へ Read の権限の rule (deny と ask) を当て、file の同一性も控えている。成功した呼び出しの添付は、本体の読み取り許可を通ったものと見なせる。
- mod が読むのは、`SendUserFile` の結果の添付のうち、次をすべて満たすものだけにする。
  - error でない呼び出しの結果である
  - `isImage` が true である
  - `pathValidated` が true である
  - path が絶対 path である
  - `media_type` が PNG か JPEG である
- 「この session で成功した呼び出し」に限るため、v0.1 では `tool.call` の hook で `next(e)` の結果を受けた時点に、tool_use_id と path を session の state に登録する。描画の hook は、登録されたものだけを描く。resume で再生された古い行は、文字のままにする (PoC の mod は、行の `output` をそのまま信じていた)。
- 読む前に `$.fs.stat(path, { resolve: true })` で実体を確かめる。条件は次のすべて。
  - 通常 file である
  - `realPath` がある
  - 大きさが上限以下である
- 読むのは `realPath` で、先頭の byte (magic) で形式を確かめる。
- 返信の文の中の path、URL、許可外の場所は読まない。`/private/tmp` 全体や home 全体を許可しない。
- 残る隙: stat から read までの間に file が差し替えられる場合。v0.1 では、登録の時点で読み始め、読んだ bytes を検査に使う。`{ file }` の source に元の path を渡さない。

## 6. 参考 OSS (V09)

3 件とも MIT で、Claude Code の mod (`hooks.json` の `modules` と `register`) だった。

| repo | 対象 | 取り方 | 変換 | 読み取りの範囲 |
| --- | --- | --- | --- | --- |
| gdyan2022/claude-code-image-view | Read の結果、返信の中の path、URL | 構造化の値と正規表現 | `sips` / ImageMagick。session.start から起動した queue で行う | link を辿って確かめる。allow-list は無い |
| alexjsp/claude-inline-images | Read、`SendUserFile`、`SendUserMessage`、返信の中の画像 | `output.attachments` (型の裏付けは無い) | `sips` / ImageMagick。縮小はしない | 検査なし。timeout なし |
| GGGODLIN/cc-mod-image-view | 貼った画像 `[Image #n]` だけ | 正規表現と transcript | `sips` / ffmpeg / ImageMagick | 一部だけ |

判断: 自作する。どの code も取り込まない。取り入れる考え方は次の 3 つ。

- engine の行を `await next(e)` で残し、その下に足す。
- 変換は描画の hook の外の queue で行う。参考 OSS の 1 件は、描き直しで描画の hook が中断されると書いている (PoC では起きなかった)。
- 変換の前に、先頭の byte で形式を確かめる。

採らないのは次の 4 つ。

- 返信の文から正規表現で path を拾うこと
- URL を取ること
- 検査なしで外部の command に path を渡すこと
- 元の path を `{ file }` に渡すこと

## 7. v0.1 への持ち越しと、当初の UX との違い

- 配置: PoC は、engine の `[image]` 行をすべて残し、その下に「ファイル名の行 + 画像」を順に足した。brief の目標 UX の図は、行と画像を交互に並べている。v0.1 でどちらにするかを決める。
- 描けない端末の扱い: PoC は描けない端末でも、ファイル名の行と `alt` の行を足していた。これは「通常のテキスト表示」と言えない。v0.1 の案は、`$.ui.blit` の `deny` で描けないと分かったら (4.5)、何も足さずに engine の行だけに戻すこと。検出は session に 1 回でよく、結果は session の state に持つ。iTerm2 直下 (fullscreen) で描けたときに `{}` が返ることは確かめた (4.5)。
- Herdr の中だと mod が知る方法: 未定。`deny` の文の中の `libghostty` は、4.5 のとおり判定に使わない。候補は `HERDR_ENV` の有無で (8 の 1)、mod から読めるか (`$.process.hookEnv()` に入るか) は未確認。v0.1 で決める。
- 変換を描画の hook の外へ移す。変換中は文字で「準備中」と出し、済んだら `$.ui.invalidate('ui.render')` で描き直す。
- `userConfig`: セルの縦横比と、最大の行数・桁数。比の既定は未定。PoC が最初に置いた 0.5 は、この machine で F04 を満たさなかった。設定なしで合う既定を置けるか (よく使われる font での値、本体から比を知る口が増えるか) を v0.1 で調べる。
- 上限: 元の file の大きさ、画素数、1 行あたりの枚数、session の中の cache の容量。cache は memory の中だけで、永続化しない。
- 一時 file: `mktemp -d` の私的な folder に書き、読んだらすぐ消す。消せなかったときは記録に残す。
- 寸法が読めない JPEG: PoC は、先頭の 64 KiB に SOF が無いと長辺を 1601px と仮定して `sips -Z 1600` を渡すので、小さい画像を拡大しうる。v0.1 では、寸法を別の手段で確かめるか、読めないときは描かないかを決める。
- 1 つの描画の tree の中の inline の bytes の合計に上限があるか (参考 OSS の主張) は未確認。PoC の 5 枚、計約 1.7MB は描けた。

## 8. Go の条件

1. Herdr の中では、Claude Code の起動時に `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` が要る。mod からは設定できない。
   - 本体の判定は「kitty graphics の問い合わせに応答する」かつ「XTVERSION の名前が kitty 0.28 以上か Ghostty」で、mod の API にはこれを変える口が無い。
   - 決定 (2026-11-26、利用者): zsh の設定に、Herdr の中のときだけ付ける 1 行 (`[[ -n $HERDR_ENV ]] && export CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`) を足す前提にする。足すのは利用者で、README に手順と戻し方を書く。iTerm2 直下は本体の判定のまま使う。
   - Herdr の pane の shell に `HERDR_ENV` があることを、実機で確かめた (2026-11-27。値は見ず、有無だけを見た)。
   - mod は、画像が描けていないと分かったときに、この設定が要ることを 1 度だけ知らせる。Herdr の中かどうかを mod が知る方法は、7 のとおり未定。
   - 設定なしで済む道は、Claude Code が Herdr を kitty 対応と認めるか、Herdr の応答が変わるかで、どちらもこの project の外にある。
2. セルの縦横比の設定で F04 が満たせることを、実機で確かめる。Herdr + FORCE と iTerm2 直下の両方で確かめた (4.3)。

## 9. 再現の手順

1. PoC の mod (`poc/tav-probe/`) を `claude --plugin-dir <その folder>` で読み込む。Herdr の中では、起動の前に `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` を付ける。
2. Claude Code に、PNG と JPEG を `SendUserFile` で送らせる。
3. 結果の行の下に画像が出るかを見る。描画の記録は、mod の data folder (`CLAUDE_PLUGIN_DATA`) に JSON Lines で残る。

試験用の画像は、合成した 4 色の格子に円の PNG (640x360、300x600) です。ほかに、その JPEG、空白と日本語を含む名前の写し、3000x2000 の PNG を使った。

`poc/tav-probe/` の版 (記録の書き先を data folder に変え、比を 0.41 にし、4.5 の検出を足した版) は、2026-11-27 に Herdr + FORCE と iTerm2 直下で、上の手順のとおり読み込めて動いた。その後、review の指摘で 3 点を直した。対象を `SendUserFile` だけにした。一時 file を消せなかったときは、記録の上限と重複の除外を外して、その folder とともに記録する。同じ実体を別の path で送ったときも、表示の名前と `alt` は送った path にする。直した版は `claude plugin validate` だけで確かめた (型の警告は、直す前と同じ 11 件で、増えていない)。実機ではまだ動かしていない。
