# TuTien2D Diagnostic (Read Only) 1.0.0

Bản hiện tại chỉ đọc một số trạng thái đang hiển thị trong game, ghi log cục bộ trong tab và cho phép xuất JSON. Nó không tự di chuyển, chiến đấu, làm nhiệm vụ, gieo/thu hoạch, đột phá hoặc gửi log đến dịch vụ ngoài.

## Cài trong Tampermonkey

1. Mở `dist/tutien2d.user.js` và sao chép toàn bộ nội dung.
2. Trong Tampermonkey, tạo script mới hoặc thay nội dung script cũ bằng bundle này, rồi lưu.
3. Tải lại trang game. Bảng **TuTien2D · Trạng thái** sẽ hiện nhãn **VIEW ONLY**.
4. Dùng **Copy Log** hoặc **Export JSON** nếu cần lưu chẩn đoán. Log được tạo trong tab hiện tại.

Nếu Tampermonkey còn một bản Auto cũ khác, hãy tắt hoặc gỡ bản cũ để nó không tiếp tục điều khiển nhân vật.

## API chỉ đọc

```js
TuTienAuto.status();       // Trạng thái hiện tại
TuTienAuto.report();       // Snapshot và log JSON
TuTienAuto.exportLog();    // Tải log JSON
TuTienAuto.stopAutoDebug();// Dừng ghi nhận thay đổi
TuTienAuto.dispose();      // Gỡ bảng và dừng lấy mẫu
```

Bundle được tạo từ `src/` bằng `npm run build`. Không chạy bài kiểm thử hoặc thao tác trực tiếp trong game như một phần của lệnh build.
