# Song Kiếm AI

Ứng dụng Next.js/TypeScript tối ưu điện thoại để biến ảnh hoặc video thành kịch bản hội thoại hai nhân vật, chỉnh timeline, tạo giọng đọc và dựng MP4.

## Luồng sử dụng

1. Tải ảnh/video lên Vercel Blob. Video lớn được tải trực tiếp từ trình duyệt bằng multipart.
2. Chọn phong cách, có thể thêm ý tưởng kịch bản, rồi chạy phân tích. Workflow dùng FFmpeg lấy tối đa 12 khung hình theo timeline và gửi chúng tới model OpenAI qua Vercel AI Gateway. Kết quả có cấu trúc được kiểm tra trước khi vào trình biên tập.
3. Sửa lời thoại, nhân vật, cảm xúc và mốc thời gian. Nhập Voice ID riêng cho nam và nữ. Bản nháp lưu trong trình duyệt.
4. Nghe thử một câu qua SaydiVoice hoặc xuất MP4. Khi bật giọng đọc, ứng dụng tạo audio từng câu và trộn theo thời điểm bắt đầu. Câu dài có thể tăng tốc tối đa 2 lần để vừa mốc thời gian; nếu vẫn không vừa, job báo mốc cần kéo dài. Cũng có lựa chọn xuất phụ đề và âm thanh gốc mà không tạo TTS.

Nút nghe thử và xuất MP4 có giọng đọc dùng credits SaydiVoice theo số ký tự. Phản hồi TTS cung cấp `X-OV-Chars` và `X-OV-Voice`; ứng dụng kiểm tra ID giọng thực tế để không âm thầm dùng sai giọng. API key chỉ được đọc ở server.

## Cấu hình

Yêu cầu Node.js 24+ và pnpm 11.25+.

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Điền các biến sau vào `.env.local` khi chạy máy riêng, hoặc trong Environment Variables của project Vercel:

| Biến | Công dụng |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob cho upload media và lưu MP4. Được cấp khi kết nối Blob store. |
| `AI_GATEWAY_API_KEY` | Xác thực Vercel AI Gateway khi chạy local/ngoài Vercel. Deployment Vercel có thể dùng OIDC tự động. |
| `AI_GATEWAY_MODEL` | Model OpenAI dạng `provider/model`; mặc định `openai/gpt-5.4-mini`. |
| `SAYDI_API_BASE_URL` | Mặc định `https://voice.saydi.ai/api`. |
| `SAYDI_API_KEY` | Key `sv_live_...` từ SaydiVoice. Chỉ lưu phía server. |
| `SAYDI_MALE_VOICE_ID` / `SAYDI_FEMALE_VOICE_ID` | Voice ID ban đầu từ `GET /samples` hoặc giọng clone `vc_...`. Có thể đổi trong giao diện. |

AI Vision dùng API model OpenAI thông qua AI Gateway. Tài khoản hoặc gói ChatGPT không tự cấp quyền dùng API; [OpenAI mô tả hai hệ thống thanh toán riêng](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform). Trạng thái xanh trong giao diện chỉ phản ánh cấu hình có mặt, không xác nhận credits hay quyền truy cập model. Kiểm tra bằng một job thật sau khi kết nối Blob và Gateway.

## SaydiVoice

Ứng dụng gọi `POST /v1/audio/speech` với JSON `model`, `voice`, `input` theo [tài liệu chính thức](https://voice.saydi.ai/docs/vi/). Phản hồi thành công là audio bytes; lỗi theo envelope `error`. `429` được xử lý theo `Retry-After`, đồng thời ghi nhận `X-OV-Limit`. Không dùng tên giọng OpenAI như `alloy` để chọn giọng; cần Voice ID SaydiVoice.

`GET /api/saydi/samples` là proxy để xem catalogue. `POST /api/saydi/speech` nhận một câu và trả audio để nghe thử. Workflow xuất video gọi SaydiVoice trên server cho các câu có nội dung khi bật lựa chọn giọng đọc.

## API và kiểm tra

- `POST /api/upload`: cấp token upload trực tiếp, giới hạn 2 GB.
- `POST /api/jobs`: tạo job `analyze` hoặc `render`.
- `GET /api/jobs?runId=...`: trạng thái/kết quả; `DELETE` để hủy.
- `GET /api/config`: tình trạng cấu hình không chứa secret.
- `GET /api/saydi/samples`, `POST /api/saydi/speech`: proxy SaydiVoice cùng origin.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Giới hạn hiện tại

- Chưa có đăng nhập; các endpoint tạo AI và giọng đọc trên deployment công khai có thể tiêu hao credits của chủ tài khoản. Blob đang ở chế độ public để trình duyệt và Workflow đọc được media; không tải nội dung nhạy cảm lên deployment công khai.
- Bản dựng và unit test không xác nhận AI Gateway, SaydiVoice hay Blob có credits/permission trong tài khoản triển khai. Cần kiểm thử một luồng ảnh/video thực tế trên production.
- Tệp video rất lớn có thể vượt giới hạn đĩa tạm, bộ nhớ hoặc thời gian của Function khi FFmpeg dựng MP4. Nên bắt đầu bằng clip ngắn và kiểm tra Workflow logs.
