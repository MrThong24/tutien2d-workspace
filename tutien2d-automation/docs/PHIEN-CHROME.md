# Phiên thao tác trực tiếp Chrome — 17/11/2026

Người dùng đã yêu cầu tự mở Tampermonkey và hoàn tất thao tác cài đặt. Đã dùng PowerShell, Windows UI Automation và thao tác chuột/phím trên đúng cửa sổ Chrome đang chơi game. Không cài thêm plugin, không truy cập cookie/token hoặc cơ sở dữ liệu profile Chrome.

## Kết quả

- Tampermonkey thường v5.5.1: tạo mới và bật `TuTien2D Diagnostic + Navigation` v0.1.0. Script Debug Test cũ vẫn giữ nguyên trạng thái tắt.
- Tampermonkey BETA: tìm thấy Farm & Meditation v3.0, Farm Return Home v5.0 và Game Debug. Cả ba đang tắt; không thay đổi nội dung hoặc trạng thái của chúng.
- Sao chép mã nguồn hai script Farm từ trình chỉnh sửa vào `backups/`, kèm SHA-256 trong `backups/manifest.json`. Đây là bản sao nội dung trình chỉnh sửa, không phải bản export nguyên gói dữ liệu của Tampermonkey.
- Tải lại game và xác nhận script mới đã lấy được namespace/runtime. Map hiện tại: `duoc_vien`, tile 32, Auto chiến đấu và Auto Dược Công đều tắt, HP đầy.
- Bấm Start từ vị trí `(400,351)`. Script dùng Pathfinder runtime tiếp cận Đại Phu và kết thúc với `DONE` tại khoảng `(462.40,305.17)`, vẫn đủ HP.
- Nút tương tác của game đã xác định đúng Đại Phu. Mở hội thoại và thu log nhãn nút thật.
- Mở danh sách việc để khảo sát. Chưa nhận nhiệm vụ mới. Đóng thoại và bấm Stop khi kiểm tra xong.

## Điều kiện nhiệm vụ quan sát được

- Nhân vật: Luyện Khí Tầng 12, nhiệm vụ chính giai đoạn 21.
- Tự Đi Làm Việc Dược Công: nút disabled, nhãn điều kiện `Cần đạt Trúc Cơ Sơ Kỳ`.
- Linh Chi, câu cá, đưa người về làng, Trúc Tâm, Dược Mộc: mỗi loại còn 3/3 lượt trong lần khảo sát.
- Đại Hội: còn 1/1; Tán Tu Chiến Bảng: còn 3/3.
- Vận Tiêu: khóa do chưa đạt Trúc Cơ Sơ Kỳ.

Đây là trạng thái của lần khảo sát; tiến độ và lượt có thể thay đổi sau đó. Không gọi hàm tự làm đang khóa hoặc sửa điều kiện nhân vật.

## Bằng chứng

- `../evidence/live-initial.json`: snapshot ban đầu.
- `../evidence/live-navigation-npc.json`: chuyển trạng thái FIND_ROUTE → MOVE_TO_NPC → DONE và tọa độ.
- `../evidence/live-dai-phu-dialog.json`: hội thoại chính, điều kiện khóa tính năng tự làm.
- `../evidence/live-duoc-cong-menu.json`: danh sách việc đang khả dụng.
- Các ảnh `tampermonkey-installed.png`, `tampermonkey-beta-dashboard.png` và `live-ready.png` trong `evidence/`.

## Chưa kiểm chứng

Chưa đi xuyên cổng map trên nhân vật thật. Chưa nhận/làm/trả nhiệm vụ, chưa bật Farm cũ và chưa có Auto Quest tùy chỉnh hoặc tích hợp Farm. Script mới được để ở trạng thái STOPPED, diagnostic vẫn bật.
