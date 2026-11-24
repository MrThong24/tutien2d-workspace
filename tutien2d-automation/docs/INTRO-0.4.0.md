# Auto mở Dược Công 0.4.0

Tài khoản mới không thể nhận việc Dược Công ngay. Bộ game yêu cầu hoàn thành nhiệm vụ chính tới Giai đoạn 8; tại mốc này menu Dược Công mở ở Đại Phu. Bản 0.4.0 thêm nút **Làm nhiệm vụ mở Dược Công**.

Luồng đã kiểm chứng trên Chrome: Giai đoạn 2 hái đủ Tẩy Uế Thảo, sắc Tẩy Tuỷ Thang, tẩy tuỷ lên Luyện Khí Tầng 1, nhận và trang bị Trúc Kiếm, diệt quái Rừng Trúc, nhặt manh mối, báo công, tới Đại Phu nhận hạt và sang Giai đoạn 8. Sau đó nút **Chạy việc Dược Công** mở đúng menu “Sổ Dược Công”, chọn Linh Chi và nhận việc thành công.

Một phiên thử đã ghi nhận `stage: 8`, `seed.active: true`, `task: linh_chi`, `quests.state: TRAVEL`, HP 120/120. Số lượt Linh Chi giảm từ 3 xuống 2 sau khi nhận việc. 57 kiểm thử tự động đạt.

## Nhiệm vụ chính Giai đoạn 8

Auto nhiệm vụ chính xử lý riêng bước Giai đoạn 8 bằng tương tác luống và lựa chọn gieo/thu hoạch trong hội thoại game. Auto Vườn vẫn là luồng riêng cho chiến đấu, trồng cây và tọa thiền.

## Gom Linh Chi

Game có 10 vị trí Linh Chi và cho phép tương tác hái tiếp sau khi đủ 3 cây; 3 cây chỉ là điều kiện hoàn thành một lượt. Auto 0.4.0 giữ lượt Linh Chi đầu tiên ở khu núi cho tới khi túi có 9 cây, rồi giao 3 cây. Hai lượt còn lại dùng số cây trong túi và giao liên tiếp tại Đại Phu, nên chỉ phải đi tới núi một lần trong chuỗi 3 lượt. Nếu túi đã có nấm từ trước, Auto chỉ gom tới mốc 9 và không tự tạo thêm vật phẩm.

Nếu nhân vật bị hạ, phiên mở đầu tự dừng; hồi sinh miễn phí rồi bật lại nút này sẽ tiếp tục theo Giai đoạn hiện tại, không làm lại các bước đã hoàn thành. Chế độ dừng khi HP dưới 25% để tránh lặp lại việc bị hạ. Việc mở đầu không tự giải quyết lời mời tỉ thí của người chơi khác.
