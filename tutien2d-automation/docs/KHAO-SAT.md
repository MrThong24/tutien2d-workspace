# Khảo sát ngày 17/11/2026

Workspace `D:\Auto` ban đầu trống. Không tìm thấy AGENTS.md trong workspace hoặc thư mục cha trực tiếp, không có Game Debug hay Auto Farm v5.0 để sao lưu. Các mô tả trong prompt được coi là thông tin bàn giao, không phải kết quả kiểm thử của bản mới.

## Bằng chứng nguồn

Các file công khai được lấy từ URL script trong HTML `https://tutien2d.com/?choi`; không dùng cookie, token hoặc phiên đăng nhập. Đường dẫn gốc và SHA-256 nằm trong `../evidence/manifest.json`. Các file game được giữ để đối chiếu, không được nhúng vào userscript phát hành.

| Nội dung | Nguồn đã đọc | Kết quả |
| --- | --- | --- |
| Namespace | `main.9afbffc16a46.js` | Cuối file xóa `window.PNTT`; cần giữ tham chiếu trước đó. |
| Tile | `config.156107f655e5.js` | `CONFIG.TILE = 32`. Userscript vẫn đọc runtime, không hardcode 32. |
| Hitbox | Cùng file config | `PLAYER.HITBOX_W = 16`, `HITBOX_H = 12`; truyền bán kính 8 và chiều cao 12 cho Pathfinder. |
| Cổng | `tilemap.3c414ca9f1fe.js` | Kiểm tra tile mà nhân vật đứng; cổng `byHand` không tự kích hoạt khi bước vào. |
| Pixel cổng | TileMap và Pathfinder | Tâm tile là `tx*TILE + TILE/2`, `ty*TILE + TILE/2`. |
| Pixel prop/NPC | TileMap | `x = tx*TILE + TILE/2`, `y = (ty+1)*TILE`. |
| Điểm tiếp cận NPC | `world.d8cfef61c463.js`, hàm `Ze` | Với prop, điểm tương tác là `(prop.x, prop.y - TILE/2)`. |
| Tương tác | `input.4ea962762577.js`, SceneWorld | E/Enter tạo yêu cầu interact; SceneWorld xử lý mục tiêu hiện tại từ Targeting. Không được mặc định NPC gần nhất là mục tiêu hiện tại. |
| Hộp thoại | HTML trang | `#dialog`, `#dialog-title`, `#dialog-text`, `#dialog-choices`, `#dialog-action`, `#dialog-close`. |
| Tự làm Dược Công sẵn có | SceneWorld | Có `autoDCStart`, `autoDCStop`, trạng thái `autoDC`; hội thoại có lựa chọn “Tự Đi Làm Việc Dược Công” và màn xác nhận “Bắt Đầu Tự Làm”. Chưa gọi các hàm này trong bản mới. |

## Tuyến đã xác nhận trong dữ liệu nguồn

1. `tan_vien`: cổng `(7,29)` hoặc `(8,29)` sang `thanh_truc_lam`.
2. `thanh_truc_lam`: cổng `(12,29)` hoặc `(13,29)` sang `duoc_vien`.
3. `duoc_vien`: NPC `dai_phu` ở tile `(14,8)`, `r=48`, `block=true`.

Tọa độ nguồn có thể được các module mở rộng bổ sung hoặc thay đổi trong phiên bản khác. Ví dụ `map_three_maps.3fbb466c6c1e.js` bổ sung các cổng Bãi Đá vào Tản Viên. Vì vậy script lập tuyến từ toàn bộ `MapData` đang chạy, chọn cổng từ `SceneWorld.map.portals`, và lấy NPC từ props runtime. Nó không dùng danh sách nguồn tĩnh để ra lệnh cho nhân vật.

Kết quả này xác minh kết nối đồ thị và cơ chế từ mã nguồn. Nó chưa xác minh điều kiện đi qua cổng, khả năng tới từng cổng trong bản đồ collision hiện tại, phản hồi máy chủ hoặc hội thoại theo nhân vật của bạn.

## Phần cần lấy từ lần chạy thật

- Log trước khi Start và sau khi tới Đại Phu hoặc khi bị lỗi.
- Map ID sau từng cổng để xác nhận chặng thực sự thành công.
- Nhãn nút và trạng thái khóa trong hội thoại Đại Phu đang mở.
- File Auto Farm v5.0 cũ nếu cần khôi phục chính xác hành vi đã chạy ổn.

Phần Auto Quest và tích hợp Farm sẽ dựa trên các bằng chứng này. Không đánh dấu các phần đó hoàn thành trong bản 0.1.0.

## Cập nhật sau khi thao tác trực tiếp Chrome

Đã cài script và thu được log runtime thật; xem `PHIEN-CHROME.md`. Script Farm v5.0 và v3.0 đã được tìm thấy trong Tampermonkey BETA và sao lưu từ trình chỉnh sửa. Phần tiếp cận Đại Phu trong cùng map đã thành công. Hội thoại cho thấy tính năng tự làm Dược Công sẵn có đang khóa vì cần Trúc Cơ Sơ Kỳ. Các kết quả mới này bổ sung cho khảo sát nguồn, không chứng minh điều hướng xuyên map hay Auto Quest tùy chỉnh đã hoạt động.
