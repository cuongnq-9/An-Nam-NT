# Tự động cập nhật Apps Script từ GitHub

Sau khi cài đặt **một lần** theo hướng dẫn này, mỗi khi file `apps-script/src/Code.gs` trên nhánh `main` thay đổi (ví dụ khi anh bấm Merge một PR), GitHub sẽ **tự làm thay anh**:

1. Đưa code mới lên Apps Script (không cần dán tay nữa).
2. Cập nhật bản triển khai đang dùng lên **Phiên bản mới**. Link `/exec` **giữ nguyên**, app không phải đổi gì.
3. Mở thử `?ping=1` để chắc máy chủ đã chạy đúng bản mới.

Các file chỉ có trên Apps Script (như `index`, `appsscript.json`) được giữ nguyên, GitHub chỉ thay `Code.gs`.

---

## Cài đặt một lần (khoảng 10 phút)

Dùng **đúng tài khoản Google anh vẫn dùng để mở file Sheet "AN NAM NHA TRANG"** cho cả 6 bước.

> **Mở Apps Script như mọi khi:** mở file Google Sheet "AN NAM NHA TRANG" → menu **Tiện ích mở rộng → Apps Script**. Bước 3 và 4 làm ở trang này.

### Bước 1. Bật Apps Script API

1. Mở https://script.google.com/home/usersettings
2. Gạt **Google Apps Script API** sang **Bật (On)**.

### Bước 2. Lấy "chìa khóa" đăng nhập (CLASPRC_JSON)

Không cần cài gì trên máy, làm hoàn toàn trên trình duyệt máy tính:

1. Mở https://shell.cloud.google.com (lần đầu bấm **Đồng ý / Start** nếu được hỏi). Chờ hiện khung đen có dấu nhắc `$`.
2. Copy dòng dưới, dán vào khung đen, bấm **Enter**:
   ```
   npx -y @google/clasp@3.4.1 login --no-localhost
   ```
3. Màn hình hiện một đường link dài. Bấm vào link → chọn tài khoản Google → bấm **Cho phép (Allow)**.
4. Trình duyệt chuyển sang một trang báo lỗi kiểu *"Không thể kết nối localhost"*. **Như vậy là đúng.** Copy **toàn bộ địa chỉ** trên thanh địa chỉ của trang đó (bắt đầu bằng `http://localhost...`).
5. Quay lại khung đen, dán địa chỉ vừa copy, bấm **Enter**. Thấy chữ `You are logged in as ...` là xong.
6. Dán tiếp dòng này, bấm **Enter**:
   ```
   cat ~/.clasprc.json
   ```
7. Bôi đen và copy **toàn bộ** đoạn chữ hiện ra, từ dấu `{` đầu tiên đến dấu `}` cuối cùng. Đây là **CLASPRC_JSON**. Giữ bí mật, không gửi cho ai.

### Bước 3. Lấy Mã tập lệnh (SCRIPT_ID)

Từ file Sheet → **Tiện ích mở rộng → Apps Script** → bấm biểu tượng **⚙ (Cài đặt dự án)** ở cột bên trái → mục **Mã tập lệnh** → bấm **Sao chép**.

### Bước 4. Lấy Mã triển khai (DEPLOYMENT_ID)

Vẫn ở trang Apps Script đó → nút xanh **Triển khai** (góc trên bên phải) → **Quản lý triển khai** → chọn bản Web app đang dùng → copy **Mã triển khai**.

(Đó cũng chính là đoạn nằm giữa `/s/` và `/exec` trong link web app: `https://script.google.com/macros/s/`**`MÃ-Ở-ĐÂY`**`/exec`.)

### Bước 5. Cất 3 mã vào GitHub Secrets

1. Mở https://github.com/cuongnq-9/An-Nam-NT/settings/secrets/actions/new
2. Ô **Name** gõ `CLASPRC_JSON`, ô **Secret** dán đoạn ở Bước 2 → bấm **Add secret**.
3. Bấm **New repository secret**, làm tương tự với:
   - Name `SCRIPT_ID`, Secret là mã ở Bước 3.
   - Name `DEPLOYMENT_ID`, Secret là mã ở Bước 4.

Secrets được GitHub mã hóa, **không ai xem được**, kể cả khi repo công khai.

### Bước 6. Chạy thử

1. Mở https://github.com/cuongnq-9/An-Nam-NT/actions/workflows/deploy-apps-script.yml
2. Bấm **Run workflow** → **Run workflow** (nút xanh).
3. Chờ khoảng 1 phút. Thấy dấu **✅ xanh** là thành công. Mở app → **Cài đặt** để xem dòng "máy chủ …" đúng bản mới.

---

## Từ nay trở đi

- **Không cần** dán Code.gs và tạo Phiên bản mới bằng tay nữa.
- Anh **không phải sửa code trên GitHub**. Khi cần thay đổi, anh nhắn Claude như bình thường. Claude sửa code và gửi anh một đường link PR. Anh chỉ cần:
  1. Bấm vào link PR.
  2. Kéo xuống dưới, bấm nút xanh **Merge pull request** → **Confirm merge**.
  3. Chờ khoảng 1 phút là máy chủ tự cập nhật. Giao diện app trên điện thoại cũng tự cập nhật như trước.
- ⚠️ **Đừng sửa code trực tiếp trên trang Apps Script.** Lần cập nhật tự động sau sẽ ghi đè bằng bản trên GitHub, phần sửa tay sẽ mất. Muốn sửa thì sửa trên GitHub (hoặc nhờ Claude).
- Lần cập nhật nào **có sheet hoặc cột mới** thì vẫn phải mở Apps Script và chạy `setup()` **một lần** bằng tay (GitHub không chạy hàm thay được).
- Muốn đẩy lại bản hiện tại bất cứ lúc nào: làm như Bước 6.

## Khi thấy dấu ❌ đỏ

Bấm vào lần chạy bị đỏ để xem dòng lỗi màu đỏ:

| Lỗi | Cách xử lý |
|---|---|
| `Chưa cài Secrets: ...` (vàng, không phải đỏ) | Chưa làm Bước 5, hoặc gõ sai tên Secret |
| `User has not enabled the Apps Script API` | Làm lại Bước 1 |
| `invalid_grant` hoặc `unauthorized` | Chìa khóa hết hạn hoặc bị thu hồi. Làm lại Bước 2, rồi ở trang Secrets bấm vào `CLASPRC_JSON` → **Update** → dán đoạn mới |
| `Không có file tên 'Code'` | File chính trên Apps Script không tên là `Code`. Đổi tên về `Code`, hoặc báo Claude |
| `Requested entity was not found` | `SCRIPT_ID` hoặc `DEPLOYMENT_ID` sai, làm lại Bước 3/4 rồi Update Secret |
