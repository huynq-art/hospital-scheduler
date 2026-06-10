# Hướng Dẫn Sử Dụng Admin — Hệ Thống Xếp Giường Truyền

## Tổng Quan

Hệ thống tự động xếp lịch truyền dựa trên:
- **Dữ liệu từ Google Sheet** (cố định, tự động đồng bộ mỗi 60s)
- **Quy tắc giờ hẹn** (kho quy tắc động): mỗi dịch vụ → thời gian ủ thuốc + thời gian truyền + loại giường
- **Xếp giường AI**: dựa trên giờ đến, thời gian chiếm giường, ưu tiên khách VIP, giới tính (ghép phòng), nhóm

---

## 1. Đồng Bộ Dữ Liệu Từ Google Sheet

**Luồng chính:**
- Hệ thống tự động lấy dữ liệu từ Sheet mỗi 60 giây
- Có thể chủ động bấm **"Lấy dữ liệu từ Sheet"** để đồng bộ ngay
- Chế độ **"HOẶC DÁN NHANH"**: copy nhiều dòng từ Google Sheet, paste vào → ấn "Phân tích & Đồng bộ"

**Lưu ý:** Những khách hàng đã chỉnh tay (đổi giường, giờ, thời gian truyền, khóa phòng đơn, ghép nhóm) sẽ **không bị ghi đè** khi đồng bộ lại.

---

## 2. Đăng Ký Thủ Công

Form bên trái → điền:

| Trường | Mô tả |
|--------|-------|
| Tên khách hàng | Thêm hậu tố `V`, `-V`, `VIP` → tự động gắn mác VIP; `VV`, `-VV`, `VVIP` → VVIP |
| Ngày hẹn | Chọn ngày khám |
| Giờ đến | Giờ dự kiến có mặt |
| Dịch vụ | Gõ tên dịch vụ (VD: `MSC`, `NMN 600`, `Đơn bs Vân`) |
| Ưu tiên | Thường (1) / Thân Thiết (2) / VIP (3) |
| Chế độ phòng T2 | Ghép phòng / Khóa 1 mình 1 phòng / Bao phòng Couple |

Sau khi thêm, hệ thống tự động xếp giường.

---

## 3. Quản Lý Quy Tắc Giờ Hẹn (Kho Quy Tắc)

**Mục đích:** Định nghĩa mỗi dịch vụ mất bao nhiêu phút ủ thuốc (chờ) + truyền, và có cần giường T2 không.

**Các quy tắc mặc định:**

| Keyword | Mô tả | Chờ | Truyền | T2 |
|---------|-------|-----|--------|----|
| MSC | MSC | 60p | 135p | ✅ |
| NK | NK | 20p | 135p | ✅ |
| EXO | EXO | 10p | 75p | ❌ |
| NMN | NMN | 10p | 75p | ❌ |
| SCE | SCE | 10p | 75p | ❌ |
| D/C VAN | Đơn d/c (Vân) | 10p | 105p | ❌ |
| D/C HAI | Đơn d/c (Hải) | 10p | 105p | ❌ |
| D/C DUNG | Đơn d/c (Dũng) | 10p | 180p | ❌ |
| D/C TUAN ANH | Đơn d/c (Tuấn Anh) | 10p | 180p | ❌ |
| D/C | Đơn d/c chung | 10p | 105p | ❌ |
| DON VAN | Đơn thuốc (Vân) | 10p | 90p | ❌ |
| DON HAI | Đơn thuốc (Hải) | 10p | 90p | ❌ |
| DON DUNG | Đơn thuốc (Dũng) | 10p | 90p | ❌ |
| DON TUAN ANH | Đơn thuốc (Tuấn Anh) | 10p | 90p | ❌ |
| DON | ĐƠN THUỐC | 10p | 75p | ❌ |
| *(mặc định)* | Mặc định | 10p | 60p | ❌ |

**Cách thêm/sửa/xóa:**
- Mở rộng "Kho Quy Tắc Giờ Hẹn"
- Điền: Từ khóa, Nhãn, Chờ (phút), Truyền (phút), tick T2 nếu cần, Ưu tiên
- Ấn **Thêm**
- Sửa: ấn icon ✏️ → form tự điền → sửa → ấn **Thêm**
- Xóa: ấn icon 🗑️ (không xóa được quy tắc mặc định)

**Cách keyword hoạt động:**
- Keyword viết hoa không dấu
- So khớp **tất cả từ** trong keyword (VD: `D/C VAN` sẽ khớp với dịch vụ có chứa cả "D/C" và "VAN")
- Quy tắc có priority thấp hơn được ưu tiên trước

**Tra cứu nhanh:** Gõ thử dịch vụ vào ô "Tra Cứu Quy Tắc" để xem nó khớp quy tắc nào.

---

## 4. Biểu Đồ Gantt (Xếp Giường)

Hiển thị trực quan các giường ngang theo khung giờ 08:00–17:00.

### Màu sắc khối bệnh nhân:
- **Xanh dương** → VIP (mức 3)
- **Tím nhạt** → Thân thiết (mức 2)
- **Xám/xanh lá** → Thường (mức 1)
- **Viền tím** → Khách VIP/đặc quyền
- **Viền dashed xanh lá** → Đã chỉnh tay

### Ký hiệu:
- 👑 Vàng → VVIP
- 👑 Hồng → VIP
- ⏳ → Đang chờ giường
- 🔒 → Khóa 1 mình 1 phòng
- 👫 → Couple
- Số màu (1–8) → Nhóm (ghép nhóm)

### Thao tác kéo thả (Drag & Drop):
- Kéo khối bệnh nhân sang giường/giờ khác
- Hệ thống tự động validate: không trùng giờ, VIP chỉ ở T2, tôn trọng khóa phòng
- Thả thành công → lưu ngay + Undo enable

---

## 5. Danh Sách Chi Tiết

Bảng bên dưới Gantt, hiển thị tất cả khách hàng của ngày đang chọn.

### Các cột:
- **Checkbox** → Chọn để ghép nhóm
- **Khách Hàng / Chế độ** → Tên + icon chế độ phòng
- **Hạng** → 👑 VVIP (cam) / 👑 VIP (hồng) / —
- **Dịch Vụ** → Tên dịch vụ
- **Hẹn** → Giờ đến (có thể sửa trực tiếp bằng `<input type="time">`)
- **Xếp Giường** → Giường được xếp
- **Trạng Thái** → icon trạng thái
- **Xử lý** → Nút Đè (mở modal chỉnh tay) + Xóa

### Ghép nhóm:
1. Tick checkbox nhiều khách
2. Ấn **"Ghép nhóm"** → họ được gán chung ID nhóm, Gantt ưu tiên xếp cùng phòng
3. **"Rã nhóm"** để xóa liên kết

---

## 6. Modal Chỉnh Tay (Đè Lịch)

Bấm nút "Đè" ở bảng → mở modal:

1. **Chỉ định giường:** Chọn giường cụ thể (hoặc giữ "Tự động AI")
2. **Chỉ định giờ:** Tick "Ghi đè giờ" → nhập giờ bắt đầu
3. **Số phút nằm giường:** Nhập thời gian thực tế

**"Xóa đè"** → trả về tự động AI. **"Lưu"** → áp dụng thay đổi.

---

## 7. Các Nút Chức Năng

| Nút | Chức năng |
|-----|-----------|
| **Undo** | Hoàn tác thay đổi gần nhất (tối đa 20 lần) |
| **Khôi phục mẫu** | Xóa hết dữ liệu (chỉ còn trống) |
| **Mở Sales View** | Mở tab mới cho sale xem (read-only) |
| **Cộng thời gian Chờ vào Nằm giường** | Tick → thời gian ủ thuốc được cộng vào giờ nằm giường |

---

## 8. Chọn Ngày & Thống Kê

- **Lịch tuần:** Bấm vào ngày để chọn, nút `◀ ▶` chuyển tuần, "Hôm nay" về hiện tại
- **Thống kê:** Khách / Chờ TB / Hiệu suất / Trễ — tự động cập nhật

---

## 9. Cập Nhật Phần Mềm

Sau khi sửa code:

```bash
cd D:\AI AGENT\hospital-scheduler
git add -A && git commit -m "nội dung thay đổi"
git push
```

Render tự động build lại, sau ~2–3 phút web mới.

---

## 10. Lưu Ý Quan Trọng

- Dữ liệu được đồng bộ từ Sheet mỗi 60s — **không sửa trực tiếp vào Sheet khi admin đang chỉnh tay** (sẽ bị preserve)
- WebSocket kết nối realtime: khi Admin sửa → Sales view cập nhật ngay
- Nút **"Cập nhật"** trên Sales view để refresh thủ công nếu cần
- Cần kết nối Internet để đồng bộ Sheet; không có Sheet → hệ thống trống (không data mẫu)
