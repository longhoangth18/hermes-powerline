# hermes-powerline — Hướng dẫn đầy đủ (tiếng Việt)

Tài liệu này mô tả **toàn bộ** hệ giao diện "hy" cho Hermes Agent: nó gồm những gì, cài ra sao, chạy thế nào, tại sao `hermes update` không làm hỏng nó, cách sửa/thêm tính năng và cách kiểm tra. Đọc xong có thể dựng lại từ đầu trên một máy mới.

---

## 1. Gồm những gì

| Thành phần | File trong repo | Tác dụng |
| --- | --- | --- |
| Thanh trạng thái powerline (2 dòng) | `src/powerline.tsx`, `src/prompt.ts`, `src/promptPrefix.tsx` | Dòng 1: YOLO · trạng thái · model · context · t/s · cache · độ trễ … thư mục · nhánh · đồng hồ. Dòng 2: user · host · agent … CPU · GPU · RAM · ổ đĩa · nhiệt độ. Mỗi thanh **đậm ở mép → nhạt dần vào giữa** (đối xứng trái/phải), giữa các ô là vạch `›` xanh lá mảnh. |
| Khung code / diff / bảng | `src/codeview.tsx` | Code block thành "khung editor": chip ngôn ngữ + icon, số dòng, tô màu cú pháp ~30 ngôn ngữ (comment/docstring nhiều dòng, hàm, kiểu, hằng, decorator, lệnh shell, cờ `-x`, biến `$VAR`, key JSON/YAML, thẻ HTML, CSS). Diff có tên file + `+N −M`, số dòng cũ/mới, nền xanh/đỏ, code trong diff cũng tô màu. Bảng có viền bo góc, header nổi, cột số căn phải. |
| Cầu nối cho widget | `src/bridge.ts` | Đưa store nội bộ của TUI ra `globalThis.__hy` để widget đọc dữ liệu realtime. |
| Sidebar bên phải | `widgets/hy-sidebar.mjs` | Thứ tự: tiêu đề · model · thanh context · call/token/cache → **TODO** (thanh tiến độ, bước ▶ đang làm, **luồng phân việc**: subagent đang chạy cho bước đó hiện lồng `↳ ⠼ coder goal 12s`; hết lượt vẫn giữ todo "lượt trước") → **SUBAGENTS** (chip mỗi route: sáng cam khi chạy, ✓ khi đã chạy, mờ khi chưa; dòng task đang chạy/đã xong `route › goal`) → RUNNING → **SKILLS gọn 2 hàng** (đang nạp nhấp nháy, đã dùng sáng và lên đầu, `+N`) → **MCP** (chấm trạng thái + chữ, *đang gọi* khi dùng, số lần gọi + bao lâu trước) → **FILES** (file ghi/sửa, nhãn subagent) → cwd/nhánh ghim đáy. |
| Thanh tab phiên | `widgets/hy-tabs.mjs` | Mỗi phiên là "viên thuốc" bấm để chuyển, **`×` để đóng**, **`+` mở phiên mới**; phiên hiện tại màu tím; phiên đang chạy có spinner + ánh sáng; bên phải là chip route subagent. |
| Theme TUI | `skins/hy-dracula.yaml` (mặc định), `skins/hy-jade.yaml` (phương án khác) | Dracula theo spec chính thức: nền `#282A36`, nhấn tím `#BD93F9`, chữ phụ `#9AA5CE` (đủ tương phản 5,9:1), logo tím→hồng. |
| Theme web dashboard | `dashboard-themes/hy-dracula.yaml` (+ `hy-jade.yaml`) | Cùng bảng màu cho `hermes dashboard` và webchat; font mono JetBrainsMono Nerd Font để webchat vẽ được icon. |
| Markdown đẹp | `src/codeview.tsx` (phần "markdown") | H1 dải nền, H2 `▍`, H3 `◆`, **đậm cam**, *nghiêng vàng*, `code` chip xanh, trích dẫn `▌` vàng, bullet/số màu, kẻ ngang `─ ◆ ─`. |
| Thẻ kết quả | `src/codeview.tsx` (phần "system notice cards") | Khối `[ASYNC DELEGATION BATCH COMPLETE …]` Hermes chèn vào transcript thành thẻ: trạng thái, thời gian, từng task (✓/✗, goal, số call), JSON → `khoá: giá trị`, phần còn lại vẽ markdown. |
| Plugin số liệu | `plugin/powerline-net/` | Plugin Hermes ghi t/s thật từng lần gọi, thời gian ra token đầu, lỗi API (4xx/5xx/timeout). |
| Hook zsh | `shell/hermes-powerline.zsh` | Cho `hermes`, `hermes --yolo`, `hermes -p <profile>`, `hermes chat`, `hermes dashboard`, `hy` **dùng chung một bản build**. |
| Launcher / builder | `bin/hermes-powerline` | Dựng bản TUI đã chèn code, tự build lại khi Hermes đổi, tự quay về TUI gốc nếu không hợp. |

Màu nhận biết **độ sâu màu** (`HY` trong `src/prompt.ts`, cầu nối đưa cho widget): truecolor (iTerm/Ghostty/VS Code/`COLORTERM=truecolor`) dùng đúng tông Dracula; 256 màu (tmux, Terminal.app mặc định) dùng mã của theme `dracula/vim` (nền 236/235/234, chữ 253, xanh 84, hồng 212, tím 141, cyan 117, cam 215, vàng 228, đỏ 203, comment 61). Khi sidebar mở, powerline bỏ các ô trùng (model, context, cache, thư mục/nhánh, subagent). Màu xám "pha xanh" như `#1D2026` sẽ bị làm tròn thành ô 59 (`#5f5f5f`) và trông xám bạc. Với màu nền xanh/đỏ của diff, mã hex được chọn sao cho thuật toán làm tròn của `chalk` rơi đúng ô 22/52.

---

## 2. Cài trên máy mới (từng bước)

Yêu cầu: Hermes Agent cài từ source ở `~/.hermes/hermes-agent` (mặc định của installer), `node` (≥ 26 với Hermes hiện tại), `python3`, `rsync`, `git`, `bash`, terminal dùng **Nerd Font** (khuyên dùng JetBrainsMono Nerd Font). Trên macOS có thể cài `macmon` để có GPU + nhiệt độ.

```sh
git clone https://github.com/longhoangth18/hermes-powerline.git ~/repos/hermes-powerline
cd ~/repos/hermes-powerline
./install.sh --shell          # cài + hook zsh để mọi cách mở hermes đều đồng bộ
exec zsh                       # nạp lại shell
hermes                         # hoặc: hy  (= hermes --yolo)
```

`install.sh` làm những việc sau (tất cả là symlink, nên cập nhật chỉ cần `git pull`):

1. Link `src/*` → `~/.hermes/powerline/`, `bin/hermes-powerline` → `~/.local/bin/`.
2. Link plugin `powerline-net` → `~/.hermes/plugins/` và bật nó.
3. Link `widgets/*.mjs` → `~/.hermes/tui-widgets/` **và** `~/.hermes/profiles/*/tui-widgets/`.
4. Link `skins/hy-jade.yaml` → `~/.hermes/skins/` (+ từng profile); link theme dashboard → `~/.hermes/dashboard-themes/`.
5. Đặt `display.skin: hy-jade` (default + mọi profile) và `dashboard.theme: hy-jade` (bỏ qua bằng `--keep-skin`).
6. `--shell`: thêm **một dòng** `source …/shell/hermes-powerline.zsh` vào `~/.zshrc` (chạy lại không bị trùng).
7. Chạy `hermes-powerline doctor` để kiểm tra tương thích với bản Hermes đang có.

Gỡ: `./uninstall.sh` (xoá link, tắt plugin, trả skin/theme về `default` nếu đang là `hy-jade`, nhắc xoá dòng trong `~/.zshrc`).

---

## 3. Mọi cách mở Hermes đều đồng bộ

Hàm `hermes` trong `shell/hermes-powerline.zsh` quyết định theo **lệnh con**:

| Bạn gõ | Đi qua | Kết quả |
| --- | --- | --- |
| `hermes`, `hermes --yolo`, `hermes -p coder`, `hermes --resume <id>`, `hermes chat`, `hermes -m kimi --yolo` | `hermes-powerline run …` | TUI powerline + code view + sidebar + tab + skin |
| `hermes dashboard` (webchat) | `hermes-powerline run dashboard` | dashboard nhận `HERMES_TUI_DIR`, nên TUI nhúng trong webchat là **cùng bản build**; giao diện web dùng theme `hy-jade` |
| `hy …` | `hermes-powerline run --yolo …` | như trên, chế độ yolo |
| `hermes config …`, `gateway`, `plugins`, `sessions`, `-z "…"`, `--version`, `inbox` … | binary gốc | không tốn thời gian kiểm tra build |

- Script/cron không thấy hàm này (chỉ có trong zsh tương tác), nên luôn gọi binary gốc.
- Bỏ qua một lần: `command hermes …`. Chỉ tắt powerline một lần: `HERMES_POWERLINE=0 hermes`.
- Thiếu `hermes-powerline` trong PATH thì hàm tự gọi binary gốc, nên không bao giờ làm hỏng lệnh `hermes`.

Profile: widget và skin được link vào từng `~/.hermes/profiles/<tên>/`, nên `hermes -p coder` trông giống hệt default.

---

## 4. Vì sao `hermes update` không làm hỏng

Hermes **không có API plugin cho thanh trạng thái**, nhưng cho phép chạy một bản TUI build sẵn qua biến `HERMES_TUI_DIR`. `hermes-powerline`:

1. Chép mã nguồn TUI của Hermes sang thư mục tạm `~/.hermes/powerline/.stage` (**không bao giờ sửa file trong `~/.hermes/hermes-agent`**, nên `hermes update` không xung đột).
2. Chèn code của mình vào bản chép (bảng dưới), kiểm kiểu (tsc) phần code của mình, build ra `~/.hermes/powerline/tui`.
3. Chạy `hermes` với `HERMES_TUI_DIR` trỏ vào bản build đó.

Bản build được đóng dấu (stamp) theo commit Hermes + nội dung file nguồn + node + dependency. Sau `hermes update`, lần mở kế tiếp tự build lại (~1–3 giây).

### Chèn vào đâu — bắt buộc và tuỳ chọn

| File của Hermes | File của mình | Cách chèn | Nếu bản update làm mất anchor |
| --- | --- | --- | --- |
| `components/appChrome.tsx` | `powerline.tsx` | đổi `StatusRule` → `StatusRuleClassic`, nối file | **bắt buộc** → dùng TUI gốc + thông báo |
| `lib/prompt.ts` | `prompt.ts` | đổi tên `composerPromptText`, nối file | **bắt buộc** |
| `components/appLayout.tsx` | `promptPrefix.tsx` | đổi tên `PromptPrefix`, nối file, chèn 1 dòng | **bắt buộc** |
| `components/markdown.tsx` | `codeview.tsx` | đổi `renderTable` → `renderTableClassic`, nối file, 9 điểm chèn 1 dòng (code fence, tiêu đề, kẻ ngang, bullet, số, trích dẫn, inline code, đậm, nghiêng) | tuỳ chọn → markdown kiểu gốc, thanh vẫn chạy |
| `app/overlayStore.ts` | `bridge.ts` | nối file | tuỳ chọn → widget tự ẩn |
| `app/liveSessions.ts`, `app/useMainApp.ts` | — | chèn danh sách phiên + hàm chuyển/đóng/mở phiên | tuỳ chọn → thanh tab tự ẩn |
| `components/messageLine.tsx` | — | chèn 1 nhánh: thông báo hệ thống → thẻ kết quả | tuỳ chọn → hiện chữ thô |

Lớp bảo vệ:

| Lớp | Bắt được | Kết quả |
| --- | --- | --- |
| Kiểm anchor lúc chèn | Hermes đổi tên/bỏ thứ mình dựa vào | phần bắt buộc → TUI gốc; phần tuỳ chọn → bỏ qua phần đó (`skipped (optional): …`) |
| Typecheck phần code của mình | helper vẫn còn nhưng đổi kiểu | TUI gốc |
| Build lỗi | mọi lỗi khác | TUI gốc; ghi `.failed-stamp`, không thử lại tới khi có gì đổi (`hermes-powerline rebuild` để ép) |
| Lúc chạy | lỗi render | React error boundary → thành phần gốc; widget lỗi → khung lỗi nhỏ của Hermes; khung code lỗi → vẽ kiểu gốc cho block đó |
| Widget không có cầu nối | chạy `hermes` không qua powerline | widget không mở, không vẽ gì |

Đã kiểm thử bằng một **bản Hermes giả**: phá anchor của `markdown.tsx` + `liveSessions.ts` thì in `skipped (optional)` và vẫn build; phá `StatusRule` thì doctor báo "not compatible", `ensure` thoát mã 1, launcher chạy `hermes` gốc.

CI (`.github/workflows/compat.yml`) chạy `doctor` hằng ngày với Hermes `main`, kèm kiểm tra cú pháp shell và widget.

---

## 5. Lệnh và tuỳ chỉnh

```
hermes-powerline run [đối số hermes…]   chạy (hook zsh gọi cái này)
hermes-powerline doctor                 kiểm tra tương thích (thư mục tạm)
hermes-powerline rebuild | status
palette mono|dracula|skin   edge '#RRGGBB'|off   style arrow|round|slant|flame
icons on|off   bigicons on|off   prompt on|off   cap slant|flat|round
twoline on|off sys on|off        on|off
```

Trong Hermes: `/hy-sidebar` bật/tắt sidebar, `/hy-tabs` bật/tắt tab, `^X` trình chuyển phiên, `/new` phiên mới.

| Muốn | Làm |
| --- | --- |
| Tắt ô cảnh báo inbox | `~/.hermes/powerline/config.json`: `"inbox": false` |
| Vạch phân cách dày kiểu cũ | `config.json`: `"edgeThin": false` |
| Code/bảng kiểu gốc | `HERMES_CODEVIEW=0` |
| Không mở widget lúc khởi động | `HY_SIDEBAR=0`, `HY_TABS=0` |
| Đổi màu xanh nhấn | `hermes-powerline edge '#RRGGBB'` (thanh) + sửa `JADE` trong widget + `accent` trong `codeview.tsx` + skin/theme |

---

## 6. Sửa/thêm tính năng ở đâu

| Việc | Chỗ sửa |
| --- | --- |
| Thang xám đậm→nhạt của các thanh | `plEdgeGray(d, n)` trong `src/prompt.ts` (d = khoảng cách tới mép, n = số ô). Mép = `#262626`, trong cùng tối đa `#767676`. |
| Vạch phân cách mảnh | `PL_LOOK.thin` / `thinOf()` trong `src/prompt.ts`; chỗ vẽ: `sepR`, `arrow` trong `powerline.tsx`, 2 chỗ trong `promptPrefix.tsx`. Glyph mảnh = glyph đặc + 1 (Nerd Font). |
| Màu khung code | `PL_CV_DARK` / `PL_CV_LIGHT` trong `src/codeview.tsx` (luôn dùng mã xterm-256 có trong chú thích). |
| Thêm ngôn ngữ tô màu | `PL_LANGS` (định nghĩa) + `PL_ALIAS` (tên gọi khác) + `PL_CV_ICON` (icon) trong `codeview.tsx`. Họ C dùng `PL_C_LIKE`; ngôn ngữ dạng dòng (yaml/ini/docker/make) dùng `family`. |
| Icon | Tra mã trong font: `python -m fontTools` đọc `JetBrainsMonoNerdFontMono-Regular.ttf` → `getBestCmap()`, tìm tên `md-…`. Chỉ dùng mã đã tra (font không có thì hiện ô vuông). |
| Mục mới trong sidebar | `Sidebar()` trong `widgets/hy-sidebar.mjs`: thêm `h(Section, {...}, ...rows)`. Dữ liệu: `b.ui.get()` (info, usage, sid), `b.turn.get()` (tools, subagents, todos), `state.db` qua `readSession()`. |
| Thêm dữ liệu cho widget | `src/bridge.ts` (thêm getter) hoặc thêm một INSERT tuỳ chọn trong `bin/hermes-powerline` (khối `INSERTS`). |
| Thêm điểm chèn mới | `SPECS` / `INSERTS` trong `bin/hermes-powerline`. Anchor phải xuất hiện **đúng 1 lần**; đánh dấu `required=False` nếu thiếu nó vẫn sống được. |

Widget là symlink tới repo nên sửa trong repo **không** tự nạp lại: gõ `/widgets-reload` trong Hermes (hoặc mở lại). Sửa `src/*` thì chạy `hermes-powerline rebuild` (hoặc mở lại `hermes`, stamp đổi là tự build).

---

## 7. Quy trình kiểm tra trước khi push

1. `hermes-powerline doctor` → phải ra `typecheck: 0 error(s) … build: ok`.
2. `node --check widgets/*.mjs`, `bash -n bin/hermes-powerline install.sh uninstall.sh`, `zsh -n shell/hermes-powerline.zsh`.
3. Thử cập nhật Hermes giả: chép `~/.hermes/hermes-agent/ui-tui` sang thư mục tạm (symlink `node_modules`, `apps/shared`, chép `scripts/build`, `package*.json`), sửa anchor, chạy `HERMES_AGENT_DIR=<bản chép> hermes-powerline doctor`.
4. Nhìn thật: mở TUI trong `tmux` (`env -u TMUX COLORTERM=truecolor tmux new-session -d -x 180 -y 50 'hermes-powerline run'`), gửi prompt bằng `tmux send-keys`, chụp `tmux capture-pane -p -e`, render ra PNG (PIL + JetBrainsMono Nerd Font). **Thoát bằng `/quit`**, đừng `kill`, vì kill để lại phiên mồ côi trong gateway (chỉ mất khi gateway khởi động lại).
5. Đo CPU lúc rảnh: `ps -o cputime= -p <pid node>` trước/sau 30 giây (mức đã đo: ~0,29 s/30 s có widget, ~0,26 s không widget).
6. Thử cài/gỡ trong HERMES_HOME giả: `HERMES_HOME=/tmp/x ZDOTDIR=/tmp/x HERMES_POWERLINE_BIN=/tmp/x/bin ./install.sh --shell`, rồi `./uninstall.sh`.

---

## 8. Sự cố thường gặp

| Hiện tượng | Xử lý |
| --- | --- |
| Mở `hermes` thấy thanh gốc, kèm dòng "using the stock Hermes TUI" | Hermes vừa đổi thứ mình dựa vào. `hermes-powerline doctor` để xem cái gì; sửa anchor trong `bin/hermes-powerline`, rồi `hermes-powerline rebuild`. |
| Code/bảng về kiểu gốc nhưng thanh vẫn đẹp | Phần tuỳ chọn bị bỏ qua sau update; `doctor` sẽ in `skipped (optional): …`. |
| Không thấy sidebar | Cửa sổ < 112 cột (tự ẩn), hoặc đã tắt bằng `/hy-sidebar`, hoặc `HY_SIDEBAR=0`, hoặc mở `command hermes` (không qua powerline). |
| Thanh tab không hiện | Chỉ có 1 phiên (cố ý ẩn), hoặc chèn `liveSessions.ts` bị bỏ qua. |
| Tab có phiên "ma" | Phiên mồ côi của TUI bị kill. Đóng bằng `^X` → `Ctrl+D` (chỉ được với phiên của view đó), hoặc `hermes gateway stop` (đóng **mọi** phiên). |
| Icon thành ô vuông | Terminal/trình duyệt không dùng Nerd Font. |
| Màu nhạt/sai trong tmux | Bình thường: đã chọn mã xterm-256 để giống truecolor; nếu thêm màu mới, kiểm tra cách `chalk` làm tròn (round(v/51) cho mỗi kênh). |

---

## 9. Bản đồ file trên máy (sau khi cài)

```
~/repos/hermes-powerline/          ← repo (nguồn sự thật)
~/.local/bin/hermes-powerline      → repo/bin/hermes-powerline
~/.hermes/powerline/               ← nguồn đã link + config.json + bản build tui/ + .stage/
~/.hermes/plugins/powerline-net    → repo/plugin/powerline-net
~/.hermes/tui-widgets/hy-*.mjs     → repo/widgets/   (và ~/.hermes/profiles/*/tui-widgets/)
~/.hermes/skins/hy-jade.yaml       → repo/skins/     (và từng profile)
~/.hermes/dashboard-themes/hy-jade.yaml → repo/dashboard-themes/
~/.zshrc                           ← 1 dòng source repo/shell/hermes-powerline.zsh
~/.hermes/config.yaml              ← display.skin: hy-jade, dashboard.theme: hy-jade,
                                     display.sections.thinking: expanded (reasoning không bị gập)
```

---

## 10. Tham khảo thiết kế (đã nghiên cứu)

- Sidebar OpenCode (rộng 42 cột, Context → MCP → Todo, cwd:branch ghim đáy) và Crush (`TIÊU ĐỀ ─────`, chấm trạng thái + chữ, "…và N nữa"): github.com/anomalyco/opencode, github.com/charmbracelet/crush.
- Dracula spec: draculatheme.com/spec (bảng màu, cú pháp); markdown theo theme VS Code Dracula; mã 256 màu theo `dracula/vim`.
- Tương phản WCAG: `#6272A4` trên `#282A36` chỉ 3:1 → chỉ dùng cho kẻ vạch/gợi ý; chữ phụ dùng `#9AA5CE` (5,9:1). Trạng thái luôn kèm ký hiệu/chữ, không chỉ dựa vào màu.
- Status bar vs sidebar: thông tin chi tiết ở sidebar, thanh trạng thái chỉ giữ thứ sidebar không có — không trùng lặp.
