# HỆ THỐNG ÂN NAM NHA TRANG – TÀI LIỆU TỔNG HỢP

> Cập nhật: 25/11/2026 · Phiên bản hiện tại: **giao diện 25/11/2026-c · máy chủ 2026-11-25b**
>
> File này là tài liệu gốc của hệ thống, Claude đọc đầu tiên mỗi phiên làm việc. Sửa hệ thống thì cập nhật file này luôn.

---

## 0. Repo và quy tắc làm việc

**Cấu trúc repo** (`cuongnq-9/An-Nam-NT`, repo **công khai**, giao diện chạy trên GitHub Pages)

```
index.html             ← toàn bộ giao diện (một file, ~4.300 dòng)
manifest.json          ← cấu hình PWA (tên, màu, icon)
icon-192.png, icon-512.png ← icon cài app, làm từ logo Ân Nam (PR #2)
sw.js                  ← service worker cho app mở được khi mất mạng (PR #4)
.github/workflows/deploy-apps-script.yml ← tự đẩy Code.gs lên Apps Script khi main thay đổi
apps-script/
├── README.md          ← cách đồng bộ code Apps Script (copy tay hoặc clasp) và cài Script Properties
├── TU-DONG-CAP-NHAT.md ← hướng dẫn cài tự động cập nhật (một lần) cho anh John
├── .clasp.json.example
├── .claspignore
└── src/Code.gs        ← code máy chủ (PR #1)
CLAUDE.md              ← tài liệu này
```

`config.js` (chứa `APP_API_URL`, link `/exec`) được `index.html` gọi nhưng **không nằm trong repo**. Nếu thiếu, `index.html` dùng link dự phòng trong dòng `API_URL`.

**Quy tắc bắt buộc**

- **Không viết ID Google Sheet / thư mục Drive vào repo**, kể cả trong tài liệu. `Code.gs` đọc ID từ **Script Properties** qua `cfg_('TEN_KHOA')`. ID mới thì thêm khóa mới (xem mục 2 và `apps-script/README.md`).
- Không đưa mật khẩu, token, `.clasp.json`, `.clasprc.json` lên GitHub.
- `index.html` dùng xuống dòng **CRLF**, giữ nguyên khi sửa.
- Mỗi lần sửa `index.html` phải **tăng `APP_VER`** để máy người dùng tự cập nhật. Sửa `Code.gs` thì tăng `CODE_VERSION`, và nếu giao diện cần bản máy chủ mới thì tăng `NEED_SERVER`.
- Hàm mới gọi từ giao diện phải được thêm vào `API_FUNCS` trong `Code.gs`.
- **Không sửa phần nhận diện mã QR/barcode** ở màn hình quét (đang chạy ổn).
- Chủ dự án (anh John Nguyen, quản lý logistics/vận hành) trao đổi bằng **tiếng Việt**.

**Thay đổi ngày 24/11/2026**

- Tính năng **Quản lý pallet** (giao diện `24/11/2026-b`, máy chủ `2026-11-24b`): màn hình `pallet` gồm Sơ đồ kệ, Cất hàng, Chuyển, Lấy ra (FEFO). Sheet mới `Pallet`, `Pallet Log` → chạy `setup()` một lần. Chi tiết ở mục 5.8.
- Tính năng **In tem** (giao diện `24/11/2026-a`, máy chủ `2026-11-24a`): màn hình `intem` gửi lệnh in, màn hình `tramin` chạy trên máy tính cạnh máy in tem Xprinter XP-TT426B. Sheet mới `Lenh in`, `Tem pallet` → chạy `setup()` một lần. Chi tiết ở mục 5.7.

**Thay đổi ngày 23/11/2026**

- PR #1 (đã merge): đưa `Code.gs` vào `apps-script/src/`, chuyển toàn bộ ID file/thư mục Drive sang Script Properties.
- PR #2 (đã merge): thêm `icon-192.png`, `icon-512.png` theo logo chính thức.
- PR #3 (đã merge): thêm tài liệu `CLAUDE.md` này.
- PR #4 (đã merge, giao diện `23/11/2026-d`): service worker `sw.js` để app mở được khi mất mạng.
  - `index.html`, `config.js`, `manifest.json`: tải mạng trước (chờ tối đa 6 giây), mất mạng hoặc mạng chậm thì mở bản đã lưu. Cơ chế tự cập nhật `APP_VER` vẫn chạy như cũ, **không cần sửa `sw.js` mỗi lần sửa `index.html`**.
  - Font Google và thư viện CDN được lưu sau lần tải đầu.
  - Lệnh gọi máy chủ (POST) và lệnh kiểm tra phiên bản (`?vc=`) không đi qua bộ nhớ đệm, nên hàng đợi quét QR và kiểm kê vẫn như trước.
  - Mất mạng vẫn vào được app bằng tài khoản dùng gần nhất (lưu trong `annt_last_user`), có mạng lại thì tự kiểm tra lại phiên.
  - Muốn xóa sạch bộ nhớ đệm cũ trên máy người dùng thì đổi tên `CACHE` trong `sw.js`.

---

## 1. Mục đích

Web app nội bộ cho chi nhánh **Ân Nam Group – Nha Trang** (FMCG). App gom các công cụ trước đây nằm rời rạc (web app Giao hàng, web Quét QR, Operation/Kiểm kê, DashboardCheck) vào **một ứng dụng duy nhất**, dùng được trên điện thoại và máy tính:

- Theo dõi **giao hàng** từ lúc xuất kho đến khi giao thành công và hoàn chứng từ.
- **Quét mã QR/Barcode** để ghi trạng thái đơn, không phải nhập tay.
- **Kho:** kiểm kê, báo cáo hủy hàng, soạn hàng và chụp ảnh soạn hàng.
- **Công nợ:** nhắc thu theo hạn thanh toán, trao đổi giữa Kế toán và Sale.
- **Lịch giao hàng** theo tuyến và xe, tuyến ưu tiên trong ngày.
- **Gắn kết nội bộ:** thông báo, lời nhắn, chúc mừng sinh nhật.
- **Lên đơn hàng Tết** theo chương trình (Scheme) cho Sale.

---

## 2. Kiến trúc kỹ thuật

| Thành phần | Nơi đặt | Ghi chú |
|---|---|---|
| **Máy chủ** – `Code.gs` | Apps Script gắn file Google Sheet **"AN NAM NHA TRANG"**. Bản lưu trong repo: `apps-script/src/Code.gs` | Triển khai dạng Web app. Mọi lệnh đi qua `doPost` (API dạng JSON `{ fn, args }` → `{ ok, data, error }`) |
| **Giao diện** – `index.html` | **GitHub Pages** (cùng `config.js`, `manifest.json`, `icon-192.png`, `icon-512.png`) | Gọi máy chủ bằng `fetch` POST (chờ tối đa 45 giây). Cài được lên màn hình chính như một ứng dụng (PWA) |
| **File app** | Script Property `APP_SS_ID` | User, Scheme, DonTet, Kiểm kê, Công nợ, Thông báo… |
| **File dữ liệu giao hàng** | Script Property `DATA_SS_ID` | BC Giao hang, BCGH Data, AFF/AGM/AKD, Orders, Log Detail, Hoan chung tu |
| **Ảnh soạn hàng (BCS)** | Script Property `BCS_FOLDER_ID` (thư mục Drive) | Tự tạo thư mục con theo tháng |
| **Tệp đính kèm công nợ** | Script Property `QLCN_FOLDER_ID` (thư mục "QL Cong no") | |
| **Barcode sản phẩm** | Script Property `OPS_BARCODE_SS` | File TRỢ LÝ CS, sheet Barcode |
| **File tồn kho import** | Script Property `STOCK_FOLDER_ID` (thư mục Drive) | Admin nhập tồn kho |
| **BC hủy hàng** | Script Property `WRITE_OFF_SS` | Sheet Write-off |
| **Ảnh lời chúc sinh nhật** | Thư mục "Ân Nam – Sinh nhật (ảnh lời chúc)" | `setup()` tự tạo, ID lưu trong thuộc tính `BD_FOLDER_ID` |

**ID không nằm trong code.** 7 khóa `APP_SS_ID`, `DATA_SS_ID`, `OPS_BARCODE_SS`, `STOCK_FOLDER_ID`, `WRITE_OFF_SS`, `QLCN_FOLDER_ID`, `BCS_FOLDER_ID` phải được cài trong **Apps Script → Cài đặt dự án (⚙) → Thuộc tính tập lệnh**. Thiếu khóa nào thì nhật ký thực thi báo `Thiếu Script Property "..."`. Giá trị thật chỉ xem trong Apps Script, không chép vào repo.

**Thông số chính trong Code.gs**

- `SESSION_HOURS = 8`: phiên đăng nhập giữ 8 giờ kể từ lần thao tác cuối. Mật khẩu được băm `sha256` kèm salt, 500 vòng.
- `CS_EMAIL = cs.nhatrang@annam-group.com`: nhận đơn Tết.
- `VAT_RATE = 0.08`, `SALES_AMT_FACTOR = 1.08`: số tiền nợ gần đúng = Sales amount × 1.08.
- `DEBT_START_DATE = 2026-11-01`: công nợ chỉ tính đơn giao từ ngày này. `DEBT_SYNC_MIN = 10`: tự đồng bộ tối đa 10 phút một lần.
- Kiểm tra máy chủ còn chạy không: mở `<link /exec>?ping=1`.

**Tự cập nhật phiên bản**

- Trong `index.html` có 2 dòng `APP_VER` và `NEED_SERVER`.
- Khi mở app, hoặc quay lại app ở trang chủ, app so phiên bản trên máy với file `index.html` mới nhất trên GitHub. Khác thì **tự tải lại**. Nếu người dùng đang thao tác thì hiện thanh "🔄 Đã có phiên bản mới – Cập nhật" để họ bấm. Ngoài ra cứ 10 phút app tự kiểm tra một lần.
- Khi Quản trị viên đăng nhập mà máy chủ cũ hơn `NEED_SERVER`, app hiện cảnh báo "⚠ Máy chủ chưa cập nhật".

---

## 3. Màn hình và chức năng

### 3.1 Trang chủ

- Lời chào và lưới biểu tượng lớn (khoảng 3 ô mỗi hàng trên điện thoại), màu xanh rêu theo logo.
- **Lịch hôm nay** (vuốt sang để xem ngày mai): mọi người đều thấy, trừ nhân viên giao hàng.
  - Hiện tuyến theo xe và các **tuyến ưu tiên**, có nhãn nghiêng ghi tên người phụ trách.
  - Nhân viên giao hàng thấy **kế hoạch của riêng mình**: xe máy hay xe tải, tuyến ưu tiên, buổi sáng hay buổi chiều.
- **Thẻ Sinh nhật**: chỉ hiện vào ngày có người sinh nhật.
- **Thẻ "✉️ Thông báo & lời nhắn"**: hiện vào các ngày khác.
- Nhóm ô **Chung**, nhóm **Công việc của tôi** (theo tính năng được cấp) và nhóm **Tài khoản** (Quản trị, Cài đặt, Cài ứng dụng).
- **Chuông thông báo** 🔔: kiểm tra 60 giây một lần, có âm thanh khi mở app. Bấm vào một thông báo thì mở thẳng đến đơn hoặc bài liên quan.

### 3.2 Danh sách màn hình

| Mã | Màn hình | Chức năng chính |
|---|---|---|
| `bc` | **Báo cáo giao hàng** | Lọc theo ngày/Dept/Sale. Nhóm theo trạng thái: Chưa xác nhận, Đang soạn, Đang giao, Đã giao, Hủy… |
| `update` | **Yêu cầu kiểm tra** | Đơn cần cập nhật hoặc kiểm tra dữ liệu (từ DashboardCheck cũ) |
| `lookup` | **Tra cứu đơn hàng** | Tìm theo SO, PO hoặc tên khách hàng |
| `bank` | **Thông tin tài khoản** | Thông tin tài khoản ngân hàng để gửi khách |
| `schedule` | **Lịch giao hàng** | Lịch tuần theo xe và tuyến. Admin sửa lịch và gán người phụ trách tuyến ưu tiên |
| `scan` | **Quét mã QR** | Nút: Xuất hàng / Giao hàng / Hoàn chứng từ / Bàn giao chứng từ (xem mục 5) |
| `waiting` | **Đơn chờ giao** | Đơn đã xuất kho, đang chờ giao |
| `mine` | **Đơn của tôi** | Đơn nhân viên giao hàng đã giao, KPI theo loại xe, ngày hoàn chứng từ |
| `docs` | **Chứng từ chờ hoàn trả** | Mọi nhân viên: chứng từ đang giữ hoặc được bàn giao |
| `kiemke` | **Kiểm kê** | Đếm theo vị trí, nhiều đợt kiểm kê song song, nhận khu vực, đếm lại |
| `huyhang` | **BC Hủy hàng** | Ghi nhận hàng hủy (Write-off) |
| `soanhang` | **Soạn hàng** | Soạn theo đơn và batch, xác nhận, lịch sử soạn |
| `bcsoan` | **Báo cáo soạn hàng** | Chụp ảnh đơn đã soạn bằng camera trong app, gắn vị trí CCTV, tìm lại ảnh |
| `congno` | **Công nợ** | 4 tab: Nhắc thu nợ / Khách hàng / Đơn nợ cũ / Đơn hàng (xem mục 5.4) |
| `tetnew` / `tetlist` | **Lên đơn hàng Tết / Đơn Tết đã gửi** | Lên đơn theo Scheme (GT/MTI), tự tính khuyến mãi, gửi email cho CS |
| `msg` | **Lời nhắn** | Hộp thư / Đã gửi / Soạn lời nhắn nhiều người nhận, thông báo toàn bộ (Admin) |
| `bday` | **Sinh nhật** | Bài đăng sinh nhật, dòng thời gian lời chúc kèm ảnh, bảng tin 60 ngày |
| `admin` | **Quản trị** | Người dùng (vai trò, tính năng riêng, phạm vi dữ liệu, ngày sinh, đặt lại mật khẩu), đợt kiểm kê, nhập tồn kho, CCTV |
| `intem` | **In tem** | 3 loại tem: Rã đông 35×22 (3 tem/hàng), Tem pallet 50×50 (mã ngẫu nhiên → QR), Tùy chỉnh 50×50 (3 phần 50/20/30%). Xem trước, Lệnh in của tôi (đếm ngược 5 phút, Hủy) |
| `tramin` | **Trạm in tem** | **Không có ô trên trang chủ** (từ giao diện `25/11/2026-c`), chỉ mở bằng link `<link app>#tramin` trên máy tính cạnh máy in: hỏi lệnh mỗi 5 giây, in thẳng (Chrome `--kiosk-printing`), căn khổ giấy, In thử |
| `pallet` | **Quản lý pallet** | Sơ đồ kệ R1–R4 (8 cột × 4 tầng) và khu sàn R0 (8 dãy), tô màu theo mặt hàng, lọc bằng `*`. Cất hàng, Chuyển vị trí, Lấy ra theo FEFO. Tra mã tem xem lịch sử |
| `settings` | **Cài đặt** | Tài khoản, đổi mật khẩu, ngày sinh của tôi, phiên bản giao diện và máy chủ, đăng xuất |

### 3.3 Hiển thị trên điện thoại

- Bảng nhiều cột luôn **cuộn ngang được**.
- **Danh sách đơn hàng** (BC giao hàng, Yêu cầu kiểm tra, Tra cứu, Đơn chờ giao, Đơn của tôi) hiện **dạng thẻ** khi màn hình hẹp hơn 720px:
  - **Số SO** to, màu xanh, nằm đầu thẻ. **Tên khách hàng** in đậm ngay dưới.
  - Dưới cùng là Ngày ĐH, PO, Ngày giao, NV thực hiện và **Hoàn chứng từ**: ✔ kèm ngày nếu đã hoàn, "Chưa hoàn" nếu chưa.
- **Bảng công nợ** gọn còn 10 cột. Cột Khách hàng **cố định bên trái** khi kéo ngang.
- Sau khi tải lại trang, app quay về đúng màn hình đang xem (lưu trong `annt_view`).
- Không hiển thị vai trò hay thông tin kỹ thuật cho người dùng thường.

---

## 4. Cấu trúc Google Sheet

### 4.1 File app "AN NAM NHA TRANG" (`APP_SS_ID`)

| Sheet | Cột / Nội dung |
|---|---|
| **User** (đang ở dạng *Bảng* Bảng_1) | Username · Role · Tên nhân viên · Email · Mật khẩu · Salt · Trạng thái · Đổi MK lần cuối · Tính năng riêng · Phạm vi dữ liệu · **Ngày sinh** (cột K, dd/MM, kiểu văn bản) |
| **Scheme** | Chương trình khuyến mãi Tết (GT/MTI) |
| **DonTet** | Mã đơn · Thời gian gửi · Username · Nhân viên · Nhóm KH · Mã KH · Tên KH · Ngày giao · Ghi chú · STT · Loại dòng · Mã hàng · Mô tả · Chương trình… |
| **Stock / Stock Kiem ke / Ton kho Kiem ke** | Tồn kho làm căn cứ kiểm kê. `Ton kho Kiem ke` có thêm cột **Mã đợt** (gộp mọi đợt) |
| **Chi tiet Kiem ke** | Mã đợt · Thời gian · Username · Nhân viên · Vị trí · Lần đếm · Barcode · Mã hàng · Tên hàng · Batch number · Số lượng |
| **BC Kiem ke** | Báo cáo kiểm kê: **mỗi đợt một khối** trong cùng một sheet |
| **KK Cache** | Bộ nhớ tạm (JSON chia nhỏ) giúp mở kiểm kê nhanh |
| **TFO / Order / Lich su soan hang** | Soạn hàng: Khách hàng · Item · Product · Batch · SL đặt · Đã soạn · Còn lại. Lịch sử thao tác soạn |
| **BC Soan hang** | Thời gian · Username · Nhân viên · Mã đơn · Hình thức · Số ảnh · ID ảnh · Link ảnh · Vị trí CCTV · Ghi chú |
| **CCTV** | Mã CCTV · Vị trí · Ghi chú |
| **Hand Over** | Thời gian · Người thao tác · Giao từ (username/tên) · Giao cho (username/tên) · Mã chứng từ · Yêu cầu hoàn lại · Trạng thái · Hoàn lại lúc · Ghi chú |
| **Cong no** (sổ theo dõi, 15 cột) | Mã đơn · Mã KH · Tên KH · Sale phụ trách · Payment term · Ngày giao · Số tiền · Nguồn số tiền · Hạn thu · Ngày nhắc · Trạng thái · Cập nhật bởi · Cập nhật lúc · Ghi chú · Đã thu |
| **KH Cong no** | Customer Account · Customer Name · Invoice account · Sales in charge · Payment term · Balance due (tự tính) · Cập nhật lúc/bởi |
| **Don no phai thu** | Đơn nợ cũ trước 01/11/2026 do kế toán import: Mã đơn · Mã KH · Tên KH · Sale · Ngày giao · Số tiền · Ghi chú · Thêm lúc/bởi |
| **So tien thuc te** | Mã đơn · Số tiền thực tế · Cập nhật bởi · Cập nhật lúc |
| **Cong no trao doi** | Thời gian · Mã đơn · Loại (lời nhắn / ghi chú riêng / tệp) · Username · Người · Nội dung · File ID · Tên file · Kiểu file |
| **Thong bao** | Thời gian · Người nhận · Loại (`ask` / `msg` / `bd`) · Mã đơn · Nội dung · Người gửi · Đã đọc · Đọc lúc |
| **Loi chuc** | Thời gian · Mã bài (`BD-<username>-<năm>`) · Username · Người gửi · Nội dung · ID ảnh |
| **Loi nhan** | Thời gian · Mã (`MSG-…`) · Loại (Thông báo / Lời nhắn) · Người gửi · Tên người gửi · Người nhận (`*` = tất cả) · Tên người nhận · Nội dung |
| **Loi nhan da xem** | Mã · Username · Thời gian |
| **Lenh in** | Mã lệnh (`IN-yyMMddHHmmss-nnn`) · Gửi lúc · Username · Người gửi · Loại tem (Rã đông / Pallet / Tùy chỉnh) · Khổ · Số tem · Nội dung (JSON) · Hạn in · Trạng thái (Chờ in / Đang in / Đã in / Đã hủy / Lỗi) · Trạm in · Nhận lúc · In lúc · Ghi chú |
| **Pallet** | Mã tem · Mã hàng · Tên hàng · Batch · HSD (dd/MM/yyyy) · SL cất · SL còn · Kệ · Cột · Tầng · Vị trí (`R2-05-T3` / `R0-03`) · Trạng thái (Trên kệ / Đã lấy hết) · Cất lúc · Cất bởi · Cập nhật lúc · Đóng lúc · Ghi chú |
| **Pallet Log** | Thời gian · Username · Nhân viên · Thao tác (CAT / CHUYEN / LAY / LAY_HET) · Mã tem · Mã hàng · Từ vị trí · Đến vị trí · SL thay đổi · SL còn · reqId |
| **Tem pallet** | Mã tem (`P-` + 6 ký tự, bỏ 0/O/1/I/5/S/8/B) · Lệnh in · Ngày tạo · Trạng thái (Chưa dùng / Đã hủy (không in); sau này tính năng Pallet ghi Đang dùng / Đã đóng) · Dùng lúc · Đóng lúc |

**Thuộc tính Script (PropertiesService):** `SCHEDULE_JSON` (lịch giao hàng), `KK_CAMPAIGNS` (các đợt kiểm kê), `KKLC_*`, `DEBT_SYNC_AT`, `BD_FOLDER_ID`, các khóa chống ghi trùng.

### 4.2 File dữ liệu giao hàng (`DATA_SS_ID`)

| Sheet | Vai trò |
|---|---|
| **BC Giao hang** | Báo cáo chính. Created date and time · Sales order · Customer requisition · Customer account · Customer name · Sales responsible · Dept · Status · Delivery Status · Delivery date · Delivery man · **Document** (ngày hoàn trả chứng từ). Dòng của người khác bị che bằng `***` |
| **BCGH Data** | Dữ liệu gốc của báo cáo |
| **AFF / AGM / AKD / Orders** | Lấy **Sales amount** theo tiền tố mã đơn: AFF… → AFF · AGM… → AGM · RWH… → AKD |
| **Log Detail** | Log quét: A thời gian · B user · C mã · D ghi chú · E trạng thái · F người thực hiện |
| **Hoan chung tu** | A ngày · B Sales order · C ghi chú |

**Quy ước ngày:** cột **ngày tạo đơn là kiểu Mỹ mm/dd/yyyy**, cột **ngày giao là kiểu Việt dd/mm/yyyy**. Code đọc mỗi cột theo đúng định dạng của nó, không tự đoán.

---

## 5. Quy trình nghiệp vụ

### 5.1 Giao hàng và chứng từ

```
Đặt đơn → Soạn hàng (+ chụp ảnh BC soạn hàng)
       → Quét XUẤT  → "Đang giao"     (Log Detail)
       → Quét GIAO  → "Đã giao"       (Log Detail) → vào sổ Công nợ
       → Quét HOÀN CT → "Hoàn chứng từ" (Hoan chung tu) → cột Document của BC
       ↔ Quét BÀN GIAO → chuyển chứng từ giữa nhân viên (Hand Over)
```

- Quét một đơn thì hiện 2 nút chọn. Màn hình quét dùng thư viện qr-scanner kết hợp vòng đọc barcode. **Không sửa phần nhận diện mã** vì đang chạy ổn.
- Camera tắt khi đóng cửa sổ quét. Sau mỗi lần lưu, app quay lại màn hình quét.
- Mỗi lệnh ghi mang một mã yêu cầu riêng (`reqId`), nên mạng chập chờn gửi lại cũng không bị ghi trùng.

### 5.2 Báo cáo soạn hàng (BCS)

- Chụp ảnh trực tiếp bằng camera trong app. Ảnh được nén rồi lưu vào thư mục Drive theo tháng, kèm vị trí CCTV. Chỉ Admin và Thủ kho được ghi.
- Tìm lại theo mã đơn. Ảnh đã xóa trên Drive thì không hiện nữa.
- Chế độ ghi nhận "CCTV" vẫn dùng được khi mạng yếu.

### 5.3 Kiểm kê

1. **Admin tạo đợt**: nhập tồn kho → `Ton kho Kiem ke` (cột Mã đợt). Hai đợt tạo trong cùng giây được thêm hậu tố `-2`.
2. Nhân viên thấy **mọi đợt đang mở** và tự chọn đợt.
3. Bắt buộc **quét hoặc nhập vị trí** trước khi đếm.
4. **Nhận** vị trí hoặc mã hàng để đếm: giữ 15 phút, tự nhả khi thoát. Mã đang có người khác đếm sẽ bị ẩn với người còn lại.
5. Lưu số đếm vào **hàng đợi trên máy** (`annt_kkq_<user>`), app tự gửi lên lại khi mạng có trở lại. Danh sách tự làm mới mỗi 20 giây.
6. Đếm lại: danh sách chỉ ghi số lượng, dùng dữ liệu tạm cho nhanh. Mã người khác đã đếm lại thì tự ẩn.
7. **Thủ kho chốt đợt** → ghi một khối báo cáo vào `BC Kiem ke`. Admin có thể **mở lại** đợt.
8. **Quét liên tục** (giao diện `23/11/2026-e`): ô "Hình thức nhập" chọn giữa *Nhập từng mã* (cách cũ) và *⚡ Quét mã liên tục* (ghi chú "+1 sau mỗi lần quét mã thành công"). Vẫn bắt buộc chọn đợt đang mở và có Vị trí.
   - Điện thoại: camera mở toàn màn hình, luôn chờ quét, nghỉ 1,5 giây sau mỗi lần đọc. Dùng lại `camStart`, không sửa phần nhận diện mã.
   - PC/tablet: con trỏ luôn ở ô quét (máy quét kiểu bàn phím, kết thúc bằng Enter). Chưa có Vị trí thì con trỏ ở ô Vị trí.
   - Mỗi lần quét đúng mã (khớp barcode hoặc mã hàng) = +1, batch mặc định **`Noexp`**. Sai mã thì kêu còi 2 tông (`beep('miss')`). Thẻ sản phẩm hiện 2 giây, 6 lần quét gần nhất (bấm ↶ Bỏ để xóa lần quét chưa lưu), nút Lịch sử quét mã.
   - **Không cộng dồn** (từ 25/11/2026, giao diện `25/11/2026-a`, máy chủ `2026-11-25a`): mỗi lượt quét là **1 dòng riêng SL 1** trong `Chi tiet Kiem ke`, cột Thời gian là đúng giờ quét của lượt đó (gửi qua `entries[].ts`, `kkSave` đọc bằng `scanTime_`), để xem lại thứ tự quét. Báo cáo kiểm kê vẫn cộng các dòng như cũ.
   - Các lượt quét được gom theo đợt + vị trí rồi đưa vào **cùng hàng chờ** `annt_kkq_<user>` → `kkSave`, khi ngừng quét 15 giây, bấm Lưu ngay, đủ 40 lần, đổi màn hình hoặc ẩn app. Lịch sử quét lưu trên máy ở `annt_kkcs_<user>` (tối đa 2.000 lần).

### 5.4 Công nợ

**Đưa đơn vào sổ**

- Đơn **giao từ 01/11/2026** được đưa vào sổ `Cong no`. Đơn trước ngày đó thì kế toán import vào `Don no phai thu`.
- Khách có Payment term **000** bị loại khỏi báo cáo nhắc nợ.

**Số tiền, theo thứ tự ưu tiên**

1. **Thực tế**: kế toán nhập.
2. **Danh sách nợ phải thu**: kế toán import.
3. **Sales amount × 1.08**: số tham khảo. **Không dùng Total amount** vì số trong báo cáo không đúng.

Đơn chỉ có số tham khảo thì phải nhập số chính xác trước khi nhập "Đã thu".

**Hạn thu** = ngày giao + Payment term (COD, TBD, N7, N15, N20).

**Trạng thái:** Chờ thu → **Yêu cầu thu nợ** (gửi thông báo cho Sale) → **Hoàn thành**, hoặc **Đã xóa khỏi danh sách**.

**Thao tác trên danh sách**

- Sửa số tiền, Đã thu, sau đó bấm **Lưu thay đổi**.
- Các nút theo thứ tự: Lưu thay đổi · Gửi YC thu nợ · Hoàn thành · Xóa khỏi danh sách.
- Mỗi đơn có 📎 tệp đính kèm (chụp ảnh, PDF, XML), **lời nhắn hai chiều** Kế toán ↔ Sale (Enter để gửi, 🕘 xem lịch sử) và **ghi chú riêng** chỉ người viết thấy.
- Tìm kiếm hỗ trợ `*` thay cho chuỗi bất kỳ. Xuất Excel được.

**Các tab:** Nhắc thu nợ · Khách hàng (dư nợ > 0, sửa hàng loạt, dán từ Excel) · Đơn nợ cũ · **Đơn hàng** (xem theo đơn hoặc theo khách).

**Ngày giao:**

- Đọc theo định dạng cố định của từng cột.
- Ngày giao trong tương lai bị đánh dấu.
- Không đọc được ngày thì **không tự loại đơn** để tránh sót, mà ghi chú "cần kiểm tra".
- Tên khách hàng và Sale được làm mới từ BC mỗi lần đồng bộ, kể cả dòng bị che `***`.

### 5.5 Thông báo, lời nhắn, sinh nhật

**Lời nhắn**

- Thành viên chọn **1 hoặc nhiều người nhận**. Chỉ người được chọn mới thấy.
- **Chỉ Admin** được gửi **Thông báo đến toàn bộ** người dùng.
- Khi mở app có popup hiện các tin chưa xem. Bấm "Đã xem" thì lần sau không hiện nữa, bấm "Để sau" thì lần mở app sau hiện lại. Mở Hộp thư cũng tính là đã xem.
- Tab Đã gửi hiện số người đã xem, ví dụ "👁 Đã xem 1/2".

**Sinh nhật**

- Vào ngày sinh nhật, popup có pháo giấy hiện **mỗi ngày một lần trên mỗi máy**.
- Mọi người gửi lời chúc, kèm ảnh nếu muốn. Tất cả lời chúc nằm trong **một bài đăng** theo dòng thời gian, mới nhất ở trên.
- Người có sinh nhật nhận thông báo 🎂 khi có lời chúc mới.
- Không hiện danh sách sinh nhật sắp tới.

**Thứ tự popup khi mở app:** sinh nhật trước, lời nhắn sau.

### 5.6 Đơn hàng Tết

- Sale chọn nhóm khách hàng (GT/MTI), app tính khuyến mãi theo Scheme. Cùng một hàm tính khuyến mãi chạy ở cả máy chủ và giao diện.
- Gửi đơn → ghi vào `DonTet` và email cho CS.

### 5.7 In tem

```
Người dùng (intem) ── printRequest ──▶ sheet "Lenh in" (Chờ in, hạn = gửi + 5 phút)
Máy trạm (tramin) ── printNext mỗi 5 giây ──▶ nhận lệnh cũ nhất còn hạn (Đang in) ──▶ in ──▶ printDone (Đã in / Lỗi)
```

- **Quyền:** tính năng `intem` cho Thủ kho, Customer service, Admin, Kế toán. Tính năng `tramin` (Trạm in) cho Admin, hoặc gán riêng cho một tài khoản dùng trên máy trạm (Quản trị → Tính năng riêng).
- **Quy tắc 5 phút:** lệnh chưa in sau 5 phút tự chuyển "Đã hủy", không dồn lại. "Đang in" quá 3 phút mà trạm không báo lại → "Lỗi" (không in lại tự động để tránh in trùng). Lệnh tem pallet bị hủy thì mã tem của lệnh đó chuyển "Đã hủy (không in)".
- Số tem làm tròn lên cho đủ hàng (2 hoặc 3 tem/hàng), tối đa 200 tem/lệnh. Người dùng tự kiểm tra máy đang lắp đúng cuộn giấy, app chỉ nhắc khổ giấy.
- **Máy trạm:** cài driver Xprinter XP-TT426B làm máy in mặc định, tạo 2 khổ giấy 104×50 mm và 108×22 mm. Mở Chrome bằng `chrome.exe --kiosk-printing <link app>#tramin`, đăng nhập tài khoản có `tramin`, bấm Bắt đầu. Trạm nhớ trạng thái (`annt_ts_auto`), mở lại tự chạy. Căn khổ lưu ở `annt_ts_cfg`, tên trạm ở `annt_ts_name`.
- Mỗi hàng tem in thành 1 trang (`@page` = rộng trang × cao tem). QR tạo bằng thư viện `qrcode-generator@1.4.4` (jsDelivr), mã hóa đúng chuỗi mã nên màn hình quét hiện tại đọc được.
- Máy chủ chỉ đọc 400 dòng cuối của `Lenh in`. Khi không có lệnh mới, `printNext` chỉ ghi nhịp "còn sống" vào bộ nhớ tạm và đọc sheet tối đa 60 giây một lần.

---

### 5.8 Quản lý pallet

```
In tem pallet (5.7) → tem "Chưa dùng" → CẤT HÀNG (tem + mặt hàng + batch/HSD + số thùng + vị trí) → tem "Đang dùng", pallet "Trên kệ"
                                     → CHUYỂN (quét tem → quét vị trí mới)
                                     → LẤY RA (chọn hàng → gợi ý FEFO → quét tem → số thùng). Lấy hết → pallet "Đã lấy hết", tem "Đã đóng"
```

- **Quyền:** tính năng `pallet` cho Thủ kho và Admin (gán thêm qua Tính năng riêng).
- **Vị trí:** kệ R1–R4, mỗi kệ 8 cột × 4 tầng. Tem dán trên kệ chỉ có Kệ-Cột (`R2-05`), nhân viên bấm chọn tầng T1–T4, tầng đã có pallet bị khóa. Mỗi ô kệ chứa **1 pallet**. R0 là khu sàn 8 dãy (`R0-01`…`R0-08`), không có tầng, mỗi dãy nhiều pallet. Bố cục nằm trong hằng `PL_RACKS`, `PL_COLS`, `PL_LEVELS`, `PL_LANES` của `Code.gs`.
- **Tem:** chỉ nhận tem có trong sheet `Tem pallet` ở trạng thái "Chưa dùng". Tem đã dùng hoặc đã đóng không dùng lại.
- **Tìm hàng:** quét barcode, gõ mã, hoặc gõ tên có `*` (VD `*sua*hop`), không phân biệt dấu. Dùng danh mục `getOpsMaster`.
- **FEFO:** danh sách pallet của mặt hàng xếp theo HSD gần nhất, pallet đầu có nhãn "Lấy trước". Quét tem khác mà có pallet HSD gần hơn thì app cảnh báo (vẫn cho lấy).
- Máy chủ: `plMap`, `plInfo`, `plPutaway`, `plMove`, `plPick`. Mọi lệnh ghi có `reqId` chống ghi trùng và khóa `LockService`.

## 6. Phân quyền

Vai trò chạy ngầm, **không hiển thị** cho người dùng. Admin có thể ghi đè **Tính năng riêng** và **Phạm vi dữ liệu** cho từng người.

**Tính năng chung (mọi vai trò):** Báo cáo giao hàng · Yêu cầu kiểm tra · Tra cứu · Thông tin tài khoản · Lịch giao hàng · Chứng từ chờ hoàn trả · Lời nhắn · Sinh nhật.

| Vai trò (`Role`) | Tính năng riêng | Nút quét | Ghi chú |
|---|---|---|---|
| **admin** | Tất cả | Xuất, Giao, Hoàn CT, Bàn giao | Quản trị, tạo đợt kiểm kê, gửi thông báo toàn bộ |
| **manager** | Quét, Đơn Tết, Công nợ | Giao, Bàn giao | Xem "Đơn của tôi" của mọi NV giao hàng |
| **sale** | Quét, Đơn Tết, Công nợ | Giao, Bàn giao | Phạm vi **chỉ khách hàng của mình** (`own`) |
| **deliveryman** | Quét, Đơn chờ giao, Đơn của tôi | Xuất, Giao, Bàn giao | Không thấy lịch chung, thấy kế hoạch riêng |
| **store keeper** | Quét, Đơn chờ giao, Kiểm kê, Hủy hàng, Soạn hàng, BC soạn hàng, In tem, Quản lý pallet | Xuất, Giao, Bàn giao | Chốt đợt kiểm kê, ghi ảnh soạn hàng |
| **customer service** | Quét, Đơn Tết, BC soạn hàng, In tem | Hoàn CT, Bàn giao | |
| **accountant** | Quét, Công nợ, In tem | Hoàn CT, Bàn giao | Ngang Admin trong Công nợ: sửa số tiền, import, khách hàng |

> Trong sheet User, vai trò ghi là `store keeper` và `customer service`. Trong code, khóa vai trò viết liền: `storekeeper`, `customerservice`.

---

## 7. Quy ước đặt tên

**Mã nguồn**

- Hàm nội bộ ở máy chủ có dấu gạch dưới ở cuối (`debtSync_`, `appSheet_`). Hàm gọi từ giao diện thì không có, và **phải nằm trong `API_FUNCS`**.
- Tiền tố theo module:

| Tiền tố | Module |
|---|---|
| `kk` | Kiểm kê |
| `debt` | Công nợ |
| `bcs` | Báo cáo soạn hàng |
| `pick` | Soạn hàng |
| `bd` | Sinh nhật |
| `msg` | Lời nhắn |
| `notif` | Thông báo |
| `ho` | Hand Over |
| `print` / `pt` / `ts` | In tem (máy chủ) / màn hình In tem / Trạm in |
| `pl` | Quản lý pallet |

- Hằng số tên sheet: `SH_*`. Tiêu đề cột: `*_HEADERS`.

**Sheet và mã**

- Tên sheet viết **tiếng Việt không dấu**, ví dụ `Cong no`, `Loi nhan`.
- Tiêu đề cột viết tiếng Việt có dấu, hoặc tiếng Anh theo hệ thống ERP.
- Mã đơn có tiền tố `AFFSO…`, `AGMSO…`, `RWH…`. Mã bài sinh nhật: `BD-<username>-<năm>`. Mã lời nhắn: `MSG-yyMMddHHmmss-nnn`.

**Phiên bản**

- Máy chủ: `CODE_VERSION = 'yyyy-mm-dd' + chữ cái`, ví dụ `2026-11-23b`.
- Giao diện: `APP_VER = 'dd/mm/yyyy-chữ cái'`, ví dụ `23/11/2026-c`.

**Lưu trên máy người dùng:** khóa bắt đầu bằng `annt_`, ví dụ `annt_view`, `annt_kkq_<user>`, `annt_bdpop_…`, `annt_msgpop_…`.

---

## 8. Quy trình cập nhật (mỗi lần sửa)

**Tự động (từ 25/11/2026):** GitHub Actions `Cập nhật Apps Script` chạy mỗi khi `apps-script/src/**` trên `main` thay đổi: `clasp pull` toàn bộ dự án (giữ file `index`, `appsscript.json` chỉ có trên Apps Script), thay `Code.gs` bằng bản repo, `clasp push`, `clasp deploy -i <DEPLOYMENT_ID>` (giữ link `/exec`), rồi ping kiểm tra `CODE_VERSION`. Cần 3 GitHub Secrets `CLASPRC_JSON`, `SCRIPT_ID`, `DEPLOYMENT_ID` (cài theo `apps-script/TU-DONG-CAP-NHAT.md`). Chưa có Secrets thì workflow chỉ cảnh báo và bỏ qua. Khi đã bật: **repo là bản gốc**, sửa trực tiếp trên Apps Script sẽ bị ghi đè. Vẫn phải chạy `setup()` bằng tay khi có sheet/cột mới. Khi đó chỉ cần bước 4 và 5 bên dưới cho máy chủ; bước 1 đến 3 là cách làm tay dự phòng.

1. Dán **Code.gs** vào Apps Script và lưu (Ctrl+S), hoặc `clasp push` (xem `apps-script/README.md`). Lần cập nhật nào **có sheet hoặc cột mới** thì chạy `setup()` một lần. Code có ID mới thì thêm khóa vào Script Properties trước.
2. **Triển khai → Quản lý triển khai → ✏️ → Phiên bản: "Phiên bản mới" → Triển khai.** Không chọn "Triển khai mới", vì làm vậy tạo ra link khác. (Dùng clasp: `clasp deploy -i <DEPLOYMENT_ID>`.)
3. Cập nhật bản lưu `apps-script/src/Code.gs` trong repo cho khớp với Apps Script.
4. Upload **index.html** lên GitHub → **Commit changes** → chờ tab **Actions** có dấu ✅. Máy người dùng sẽ tự cập nhật.
5. Vào **Cài đặt**, kiểm tra dòng "Phiên bản … · máy chủ …" đúng với bản vừa cập nhật.

> Báo lỗi **"Hàm không hợp lệ: X"** = máy chủ chưa triển khai Phiên bản mới.

---

## 9. Lỗi đã sửa (tóm tắt)

| Vấn đề | Nguyên nhân | Cách sửa |
|---|---|---|
| "Hàm không hợp lệ …" (nhiều lần) | Dán code nhưng chưa tạo Phiên bản mới | Hướng dẫn triển khai đúng cách. Thêm hiển thị phiên bản trong Cài đặt và cảnh báo cho Admin |
| Ngày 11/4 bị đọc thành 4/11. Đơn tháng 6 bị đọc thành 6/11 | Đoán sai kiểu ngày. Ô Date trong BCGH Data bị tự chuyển đổi sai | Cố định định dạng theo cột (ngày giao dd/mm, ngày tạo mm/dd), bỏ dùng ngày tạo làm mốc chặn dưới, đánh dấu ngày giao trong tương lai. Đã kiểm tra trên dữ liệu thật: loại đúng 36 đơn tháng 6, giữ 230 đơn |
| Công nợ vẫn hiện đơn trước 01/11 | Lỗi đọc ngày như trên, và máy chủ chưa cập nhật | `debtDecide_` và mốc `DEBT_START_DATE` |
| Dòng `***` có số tiền 0 | Báo cáo che dòng của người khác | Làm mới tên, mã KH, sale, số tiền ở mỗi lần đồng bộ |
| Ảnh đã xóa trên Drive vẫn hiện | Không kiểm tra thùng rác | Kiểm tra trạng thái trashed trước khi trả ảnh |
| Camera vẫn chạy, app không quay lại màn hình quét | Luồng camera chưa được đóng | `CAM_STREAMS` + `stopAllCams`, xử lý khi đóng cửa sổ |
| Mất số đếm kiểm kê khi mạng yếu | Gửi một lần, lỗi là mất | Hàng đợi trên máy + `kkPump` + lưu không trùng (`kkSave`) |
| Hai đợt kiểm kê trùng mã | Tạo trong cùng một giây | Thêm hậu tố `-2` |
| CSS `.pr-tag.empty` đè `.empty` | Trùng tên class | Đổi thành `pr-none` |
| GitHub "không cập nhật" | GitHub giữ bản cũ khoảng 10 phút, và trình duyệt cũng lưu bản cũ | Thêm cơ chế tự cập nhật `APP_VER` |
| `setup()` lỗi "Thao tác này không được phép ở các ô trong các cột đã nhập" | Sheet User ở dạng **Bảng** có cột định kiểu | Thêm cột "Ngày sinh" vào Bảng qua Sheets API. `setup()` bỏ qua lỗi định dạng |
| Ngày sinh nằm ở sheet riêng | Thiết kế ban đầu | Chuyển vào cột K của sheet User, tự chép dữ liệu từ sheet cũ rồi xóa sheet cũ |
| Bảng công nợ quá rộng | Ghi chú dưới mã đơn không xuống dòng, 13 cột | Gộp còn 10 cột, cho ghi chú xuống dòng, thu nhỏ ô nhập, cố định cột Khách hàng |
| Số tiền nợ sai | Lấy Total amount, chưa tính VAT | Chỉ dùng Sales amount × 1.08 |

---

## 10. Việc còn dở / đề xuất

- [ ] **Quản lý pallet** (đã làm 24/11/2026, chờ anh John chạy thử): xác nhận mỗi ô kệ chỉ 1 pallet; làm thêm loại tem **vị trí kệ** có QR (`R1-01`…`R4-08`, `R0-01`…`R0-08`) ở màn hình In tem, hiện tại nhân viên có thể gõ tay mã vị trí.
- [ ] Căn khổ in thật trên máy XP-TT426B (In thử ở màn hình Trạm in) và xác nhận Chrome chọn đúng khổ giấy theo `@page`.

- [ ] **Tích hợp GPS Gotrack365 và camera Hikvision** vào dashboard. Đã bàn bước 1 (kiểm tra API, link xem trực tiếp), **chưa làm**, đang chờ anh quyết định.
- [ ] **Đơn đang mở từng lấy số tiền từ Total amount** mà không có Sales amount: hiện vẫn giữ số cũ. Cần quyết định có tự xóa về trống hay không.
- [ ] Các bảng trong **Công nợ** (Khách hàng, Đơn nợ cũ, Đơn hàng) chưa có dạng thẻ trên điện thoại. Bảng Nhắc thu nợ mới chỉ được thu gọn.
- [ ] **Nhập ngày sinh** cho toàn bộ nhân viên (cột K sheet User). Chưa có ngày sinh thì thẻ Sinh nhật không hoạt động.
- [ ] Gộp nốt các tool cũ còn chạy riêng (web app Giao hàng cũ, Test QR, Operation) nếu còn người dùng. Sau đó tắt bản cũ.
- [ ] Sheet User dạng Bảng chỉ phủ đến dòng 22. User mới thêm từ app nằm ngoài Bảng. App vẫn chạy bình thường, nhưng nên **kéo rộng Bảng** cho đồng bộ định dạng.
- [ ] Sao lưu định kỳ hai file Google Sheet, vì sổ Công nợ được ghi lại toàn bộ mỗi lần đồng bộ.
