# Backend Google Apps Script – Ân Nam Nha Trang

Thư mục này lưu code **Google Apps Script** (backend của app `index.html`) để có lịch sử phiên bản trên GitHub.
App gọi backend qua `API_URL` (đường link `/exec`) bằng `POST` với body `{ fn, args }` và nhận lại `{ ok, data, error }`.

```
apps-script/
├── README.md              ← hướng dẫn này
├── .clasp.json.example    ← mẫu cấu hình clasp (copy thành .clasp.json)
├── .claspignore           ← chỉ đẩy file .gs/.js/.html + appsscript.json
└── src/                   ← code Apps Script (Code.gs, appsscript.json, ...)
```

## Tự động cập nhật (khuyên dùng)

GitHub Actions (`.github/workflows/deploy-apps-script.yml`) tự đẩy `src/Code.gs` lên Apps Script và cập nhật bản triển khai đang dùng (giữ link `/exec`) mỗi khi `apps-script/src/` trên `main` thay đổi. Cài một lần theo **[TU-DONG-CAP-NHAT.md](TU-DONG-CAP-NHAT.md)**. Hai cách dưới đây là cách làm tay dự phòng.

## Cách 1 – Không cần cài gì (copy tay)

1. Mở dự án Apps Script → mỗi file (`Code.gs`, `*.gs`, `*.html`) copy nội dung.
2. Trên GitHub vào thư mục `apps-script/src/` → **Add file → Create new file**, đặt đúng tên (ví dụ `Code.gs`), dán nội dung, **Commit**.
3. Muốn có `appsscript.json`: trong Apps Script vào **Cài đặt dự án (⚙)** → bật **"Hiện tệp kê khai appsscript.json"**, rồi copy file đó vào `src/` luôn.

Mỗi lần sửa code trên Apps Script, nhớ cập nhật lại file tương ứng ở đây.

## Cách 2 – Dùng clasp (đồng bộ tự động, khuyên dùng lâu dài)

`clasp` là công cụ dòng lệnh chính thức của Google để kéo/đẩy code Apps Script.

**Cài một lần trên máy tính (cần Node.js):**

```bash
npm install -g @google/clasp
clasp login            # mở trình duyệt để đăng nhập Google
```

Bật Apps Script API cho tài khoản: https://script.google.com/home/usersettings

**Liên kết với dự án:**

1. Mở dự án Apps Script → **Cài đặt dự án (⚙)** → copy **Mã tập lệnh (Script ID)**.
2. Trong thư mục `apps-script/`:
   ```bash
   cp .clasp.json.example .clasp.json
   # sửa "DAN_SCRIPT_ID_VAO_DAY" thành Script ID vừa copy
   ```
3. Kéo code về: `clasp pull` → code nằm trong `src/`.
4. Commit và push lên GitHub như bình thường.

**Quy trình hằng ngày:**

| Việc | Lệnh |
|---|---|
| Sửa trên web Apps Script → lưu về repo | `clasp pull` rồi commit |
| Sửa ở máy → đẩy lên Apps Script | `clasp push` |
| Tạo phiên bản triển khai mới (giữ nguyên link /exec) | `clasp deploy -i <DEPLOYMENT_ID> -d "mô tả"` |
| Xem danh sách triển khai | `clasp deployments` |

> Lưu ý: dùng `clasp deploy -i <DEPLOYMENT_ID>` để **cập nhật** bản triển khai cũ, nếu không link `/exec` sẽ đổi và app sẽ không gọi được.

## Cài ID file Drive (Script Properties) – bắt buộc

Để repo công khai không lộ ID file, `Code.gs` **không** viết thẳng ID Google Sheet/thư mục Drive
mà đọc từ **Script Properties**. Cài một lần trong Apps Script:
**Cài đặt dự án (⚙) → Thuộc tính tập lệnh → Thêm thuộc tính**, đủ 7 khóa sau:

| Khóa | Là gì |
|---|---|
| `APP_SS_ID` | File chứa User, Scheme, DonTet |
| `DATA_SS_ID` | File dữ liệu BC Giao hàng / BCGH Data / AFF / Ref |
| `OPS_BARCODE_SS` | File TRỢ LÝ CS – sheet Barcode |
| `STOCK_FOLDER_ID` | Thư mục lưu file tồn kho admin import |
| `WRITE_OFF_SS` | File chứa sheet Write-off (BC hủy hàng) |
| `QLCN_FOLDER_ID` | Thư mục "QL Cong no" (tệp đính kèm công nợ) |
| `BCS_FOLDER_ID` | Thư mục ảnh trưng bày (BCS) |

ID lấy từ đường link: `docs.google.com/spreadsheets/d/<ID>/edit` hoặc `drive.google.com/drive/folders/<ID>`.
Thiếu khóa nào thì nhật ký thực thi (Executions) sẽ báo `Thiếu Script Property "..."`.

## Bảo mật – không đưa lên GitHub

- File `~/.clasprc.json` (token đăng nhập clasp) – đã chặn trong `.gitignore`.
- Mật khẩu, API key, token Zalo/Telegram… trong code: chuyển sang **Script Properties**
  (`PropertiesService.getScriptProperties().getProperty('TEN_KHOA')`) thay vì viết thẳng trong code.
- ID Google Sheet và Script ID không phải mật khẩu, nhưng nếu repo để công khai thì ai cũng thấy. Nên cân nhắc để repo ở chế độ **Private**.

## Các hàm backend app đang gọi

Danh sách lấy từ `index.html` (dùng để đối chiếu khi đưa code vào):

- **Phiên đăng nhập:** `login`, `logout`, `getSession`, `changePassword`, `getMyDob`, `setMyDob`
- **Giao hàng / đơn:** `getMyDelivery`, `getWaitingOrders`, `checkOrderData`, `getFormData`, `getUpdateRequests`, `scanBatch`, `docsPending`, `getDashboardData`
- **Kiểm kê:** `kkGetState`, `kkClaim`, `kkRelease`, `kkSave`, `kkFinish`, `kkSummary`
- **Soạn hàng:** `pickOrders`, `pickSearch`, `pickConfirm`, `pickComplete`, `pickHistory`
- **Hủy hàng / kho:** `whSaveWriteOff`, `getOpsMaster`
- **Công nợ:** `debtCustList`, `debtCustSave`, `debtCustDelete`, `debtOrders`, `debtSaveRows`, `debtSaveNote`, `debtSetStatus`, `debtOpenSave`, `debtReport`, `debtThread`, `debtPostMsg`, `debtUpload`, `debtFile`
- **Đơn Tết:** `getTetInit`, `getTetOrders`, `submitTetOrder`
- **Trưng bày (BCS):** `bcsSearch`, `bcsSave`, `bcsUpload`, `bcsPhoto`
- **Sinh nhật / tin nhắn / thông báo:** `bdHome`, `bdImage`, `bdPost`, `bdWish`, `msgInbox`, `msgRead`, `msgSend`, `notifList`, `notifRead`
- **Lịch / CCTV / nhân sự:** `getSchedule`, `cctvList`, `listStaff`
- **Quản trị:** `adminListUsers`, `adminSaveUser`, `adminResetPassword`, `adminCreateCampaign`, `adminReopenCampaign`, `adminImportStock`, `adminSaveCctv`, `adminSaveSchedule`, `adminSetPrioBy`
