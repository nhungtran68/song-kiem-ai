# Song Kiếm AI

Ứng dụng Next.js/TypeScript để chọn ảnh hoặc video trên thiết bị, phân tích các khung hình bằng OpenAI, tạo và sửa kịch bản hội thoại hai nhân vật nam/nữ, nghe thử SaydiVoice và xuất kịch bản/phụ đề để ghép video bên ngoài.

## Cách dùng

Nếu đã có kịch bản: dán tối đa 20.000 ký tự vào **Ý tưởng hoặc kịch bản có sẵn**, rồi bấm **Dùng kịch bản đã nhập**. Không cần ảnh/video hoặc OpenAI. Mỗi lượt thoại nên bắt đầu bằng `NAM:` hoặc `NỮ:`; nhận cả `nu:`, `Giọng nam:`, `[NỮ]`, nhãn đứng riêng và cảm xúc như `NAM (trầm):`. Ví dụ:

```text
NAM (trầm): Xin chào.
NỮ (vui): Chào anh!
```

Có thể ghi mốc `[00:00 - 00:05] NAM: Lời thoại...`. Khi không có mốc, hệ thống ước tính theo độ dài câu, cho sửa lại trước khi tạo giọng. Đoạn dài được chia nhỏ, giữ toàn bộ lời thoại. Dòng tiếp theo dùng cùng nhân vật; văn bản không có nhãn dùng nhân vật mặc định theo chế độ giọng hiện tại. Nhãn NAM/NỮ tự chọn chế độ giọng phù hợp, vẫn giữ hai Voice ID.

Khi OpenAI trả lỗi hết credits/hạn mức, giới hạn tốc độ, lỗi truy cập hoặc tạm ngừng, ứng dụng tự tách phần chữ đã nhập và ghi rõ **Kịch bản đã nhập**, không báo đã phân tích hình ảnh. Nếu chưa có chữ hoặc định dạng sai, nội dung biên tập trước đó được giữ. Không tự gọi AI lại sau lỗi quota; có nút thử lại khi bạn muốn. Tách chữ không dùng credits OpenAI; tạo giọng vẫn tính credits SaydiVoice.

Nếu cần AI phân tích hình ảnh:

1. Chọn ảnh hoặc video. Tệp gốc chỉ được mở trong trình duyệt, không tải lên máy chủ hay kho lưu trữ.
2. Chọn phong cách, nhập ý tưởng tùy chọn rồi nhấn **Phân tích bằng OpenAI**. Trình duyệt lấy tối đa 8 khung hình JPEG thu nhỏ và gửi chúng qua `/api/analyze` tới OpenAI. Video gốc và âm thanh không được gửi. Vì AI chỉ thấy các khung hình mẫu, cần xem lại các chi tiết nằm giữa chúng.
3. Sửa tóm tắt, lời thoại, nhân vật, cảm xúc và mốc thời gian. Hai Voice ID SaydiVoice được giữ riêng. Kịch bản tự lưu trong `localStorage` của trình duyệt hiện tại; ảnh/video không được lưu.
4. Trong **Tạo âm thanh**, chọn **Hai giọng nam và nữ**, **Chỉ giọng nam** hoặc **Chỉ giọng nữ**. Khi dùng một giọng, mọi câu thoại đều được đọc bằng Voice ID đã chọn; toàn bộ nội dung và hai Voice ID vẫn được giữ để đổi lại sau. Lựa chọn này áp dụng cả nghe thử, lưu theo bản nháp và được ghi trong TXT.
5. Bấm **Tạo âm thanh toàn bộ** để ghép và tự tải **một file WAV hoàn chỉnh**. Chọn nối liên tục hoặc giữ khoảng nghỉ theo timeline. Nếu một câu đọc dài hơn dự kiến, câu sau lùi lại để giữ đủ lời. Có tiến trình và nút dừng; các đoạn đã tạo được dùng lại trong tab hiện tại khi nghe thử/tạo lại. Giới hạn 500 câu và 30 phút mỗi file; hãy giữ trang mở và tải file trước khi đóng trang.
6. Xuất **TXT** (gồm hai Voice ID, cảnh, lời thoại, thời gian) và **SRT** để ghép bằng công cụ ngoài. Ứng dụng không dựng MP4. File âm thanh được ghép trong trình duyệt, không cần kho lưu trữ hoặc tải video lên server.

## Cấu hình

Cần Node.js 24+ và pnpm 11.25+:

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Đặt các biến sau trong `.env.local` khi chạy tại máy hoặc Vercel → Project → Settings → Environment Variables. Thêm vào **Production** và **Preview**, rồi triển khai lại:

| Biến | Công dụng |
| --- | --- |
| `OPENAI_API_KEY` | Khóa OpenAI API để phân tích khung hình, chỉ đọc trên server. Đây là khóa từ OpenAI Platform, khác gói ChatGPT. |
| `OPENAI_MODEL` | Tùy chọn; mặc định `gpt-5.4-mini`. Model cần hỗ trợ ảnh và Structured Outputs. |
| `SAYDI_API_BASE_URL` | Mặc định `https://voice.saydi.ai/api`. |
| `SAYDI_API_KEY` | Khóa SaydiVoice `sv_live_...`, chỉ đọc trên server. |
| `SAYDI_MALE_VOICE_ID` / `SAYDI_FEMALE_VOICE_ID` | ID giọng lấy từ `GET /samples` hoặc giọng clone `vc_...`; sửa được trong giao diện. |

**Không** thêm tiền tố `NEXT_PUBLIC_` vào các khóa. Vercel Blob, `BLOB_READ_WRITE_TOKEN` và `AI_GATEWAY_API_KEY` không cần cho luồng này.

## API và giới hạn

- `POST /api/analyze`: nhận tối đa 8 khung hình JPEG đã thu nhỏ, phân tích bằng OpenAI và trả kịch bản JSON đã kiểm tra. Giới hạn body 3,8 MB để nằm dưới giới hạn Vercel Function 4,5 MB.
- `GET /api/config`: trạng thái biến môi trường, không trả khóa.
- `GET /api/saydi/samples` và `POST /api/saydi/speech`: proxy SaydiVoice cùng origin. Speech thành công trả bytes audio; lỗi trả JSON, xử lý `429`, `Retry-After` và `X-OV-Limit`. Nghe thử sẽ tiêu tốn credits SaydiVoice theo `X-OV-Chars`.
- Video dài tối đa 2 giờ, tệp tối đa 2 GB trong trình duyệt. Việc đọc MOV/MP4/WEBM phụ thuộc codec mà trình duyệt hỗ trợ. Ảnh/video không lưu lại sau khi tải lại trang; bản nháp lời thoại thì có.
- Deployment công khai cho phép mọi người gọi AI/TTS bằng credits của chủ dự án, theo lựa chọn của chủ dự án. Trạng thái “sẵn sàng” chỉ cho thấy có biến môi trường, không chứng minh API key còn tiền/quyền truy cập.

Kiểm tra mã nguồn:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
