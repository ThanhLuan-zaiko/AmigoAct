# Kiểm thử

Bốn tầng, mỗi tầng trả lời một câu hỏi khác nhau. Ba tầng đầu chạy ở mỗi commit;
e2e chạy trong CI và trước khi phát hành.

| Tầng | Câu hỏi nó trả lời | Backend | Frontend |
| --- | --- | --- | --- |
| Unit | Mảnh logic này có đúng không? | `pytest -m unit` | `bun run test:unit` |
| Tích hợp | Các thành phần này có chạy được cùng nhau không? | `pytest -m integration` | `bun run test:integration` |
| Hồi quy | Tôi có làm hỏng thứ đang chạy tốt không? | `pytest -m regression` | `bun run test:regression` |
| End-to-end | Ứng dụng đã build có chạy được trên trình duyệt thật không? | — | `bun run e2e` |

Những quy tắc bắt buộc nằm ở
[AGENTS.md → Testing policy](../AGENTS.md#testing-policy). Tài liệu này giải
thích cách viết từng tầng.

## Viết test trước

Hãy viết test fail trước khi viết phần cài đặt, mỗi khi hành vi đã được đặc tả
trước. Mục đích không phải là nghi thức — mà là một test viết trước buộc phải
viết dựa trên *đặc tả*, chứ không dựa trên đoạn code bạn vừa viết, và đó là lý
do bạn nhận ra mình đã viết ra thứ không ai yêu cầu.

Với một lần sửa lỗi, thứ tự là cố định:

1. **Tái hiện.** Viết regression test fail trên `main` hiện tại.
2. **Xác nhận nó fail đúng lý do** — assertion fail, không phải typo.
3. **Sửa** lượng code sản xuất nhỏ nhất có thể.
4. **Xác nhận test pass** và phần còn lại của bộ test vẫn xanh.
5. Commit test và bản sửa cùng nhau. Một bản sửa không kèm regression test là
   chưa hoàn tất.

## 1. Unit test

**Phạm vi:** một đơn vị, cô lập. Không HTTP, không filesystem, không database,
không app instance. Nếu test của bạn cần `TestClient`, đó là integration test.

Backend — `backend/tests/unit/test_greeting.py`:

```python
@pytest.mark.parametrize(
    ("raw", "expected"),
    [("  Lan  ", "Lan"), ("Lan   Anh", "Lan Anh")],
)
def test_collapses_whitespace(raw: str, expected: str) -> None:
    assert normalize_name(raw) == expected
```

Frontend — `frontend/tests/unit/test-config.test.ts`:

```ts
it("joins a leading-slash path", () => {
  expect(apiUrl("/api/health")).toBe(`${DEFAULT_API_URL}/api/health`);
});
```

Nguyên tắc:

- Một hành vi cho mỗi test. Tên test nói ra hành vi, không phải tên hàm.
- Parametrize các ca nhàm chán (biên, chuỗi rỗng, phân biệt hoa thường) thay vì
  viết năm test gần như giống hệt nhau.
- Luôn test các biên: rỗng, một, đúng trần, trần + 1.
- Assert cả kiểu exception **lẫn** message khi message là một phần của hợp
  đồng.

## 2. Integration test

**Phạm vi:** vài thành phần thật được lắp vào nhau, kiểm tra các mối nối giữa
chúng — routing, tuần tự hoá, middleware, dependency injection.

Backend — `backend/tests/integration/test_health_api.py`:

```python
def test_invalid_name_becomes_422_not_500(self, client: TestClient) -> None:
    response = client.get("/api/greeting", params={"name": "x" * 81})

    assert response.status_code == 422
    assert "at most 80 characters" in response.json()["detail"]
```

Test đó đáng giá hơn một unit test: nó chứng minh exception của domain, handler
đã đăng ký, và error envelope cùng thống nhất với nhau.

Frontend — `frontend/tests/integration/greeting-card.test.tsx`:

```tsx
it("cập nhật lời chào khi người dùng gõ", async () => {
  const user = userEvent.setup();
  render(<GreetingCard />);

  await user.type(screen.getByLabelText("Tên của bạn"), "Lan");

  expect(screen.getByTestId("greeting-output")).toHaveTextContent("Xin chào, Lan!");
});
```

Nguyên tắc:

- Dựng app **thật**. `TestClient(app)` ở backend, `render(<Component/>)` kèm
  provider thật ở frontend.
- Điều khiển code như người dùng thật: `userEvent.type` chứ không phải
  `fireEvent.change`; một HTTP request chứ không phải gọi hàm trực tiếp.
- Assert trên bề mặt quan sát được: mã trạng thái và body, văn bản đã render và
  role trợ năng.

### Override môi trường trong integration test của backend

`Settings` được cache, nên chỉ `monkeypatch.setenv` là chưa đủ. Hãy dùng fixture
`build_app` / `build_client`, vừa đặt biến môi trường, vừa xoá cache, rồi mới
dựng app:

```python
def test_honours_a_custom_prefix(self, build_client):
    with build_client(api_prefix="/v2") as client:
        assert client.get("/v2/health").status_code == 200
        assert client.get("/api/health").status_code == 404
```

## 3. Regression test

**Phạm vi:** hành vi đã từng chạy. Regression test không khám phá hành vi; nó
**ghim** hành vi lại, để một đợt refactor sau này không thể lặng lẽ đổi nó.

Hai điều làm nên một regression test đáng viết:

- **Assert hình dạng chính xác, không phải truthiness.**
  `assert set(payload) == {"status", "app", "version", "environment"}` sẽ fail
  khi có key mới được thêm. `assert payload["status"]` thì không.
- **Assert bề mặt, không phải phần cài đặt bên trong.** Ghim hợp đồng HTTP, các
  key cấu hình, tên event được phát ra — chứ không phải hàm private tình cờ tạo
  ra nó hôm nay.

Backend — `backend/tests/regression/test_api_contract.py` ghim chính xác tập key
của mọi endpoint và chính xác tập path được đăng ký trong OpenAPI.

Frontend — `frontend/tests/regression/api-contract.test.ts` ghim các hằng số mà
hai stack dùng chung, để một thay đổi ở một phía mà quên phía kia sẽ làm CI đỏ.

### Khi một regression test fail

Regression test đỏ nghĩa là một trong hai điều:

1. **Bạn đã làm hỏng thứ gì đó.** Sửa code.
2. **Hợp đồng thực sự đã thay đổi có chủ đích.** Khi đó nó không còn là hồi quy
   nữa. Hãy nói rõ điều đó trong mô tả PR, rồi cập nhật regression test, các bên
   sử dụng, **và** tài liệu trong cùng một commit. Không bao giờ sửa regression
   test chỉ để build xanh mà không nêu lý do.

## 4. End-to-end test

`frontend/tests/e2e/*.spec.ts`, do Playwright chạy trên một bản build
**production** trong Chromium. `playwright.config.ts` tự khởi động và tắt server.

```bash
bun run e2e:install   # một lần
bun run e2e
bun run e2e:ui        # tương tác, có trình debugger time-travel
```

Nguyên tắc:

- E2E spec tốn kém. Hãy phủ những luồng mà nếu hỏng sẽ tốn tiền thật, đừng phủ
  mọi trường hợp biên — đó là việc của các tầng phía trên.
- Chọn theo role, label và text. Không bao giờ theo class CSS hay `nth-child`.
- Mỗi spec chỉ nên có một kết quả mà người dùng nhìn thấy.
- Nếu một e2e test bị flaky, hãy sửa cái flaky đó. Không thêm `test.skip` để cho
  nó xanh.

## Coverage

| | Công cụ | Ngưỡng | Lệnh |
| --- | --- | --- | --- |
| Backend | `pytest-cov` | 80% (`--cov-fail-under=80`) | `uv run pytest` |
| Frontend | `@vitest/coverage-istanbul` | 80% statement / branch / function / line | `bun run test:coverage` |

Dùng `istanbul` thay vì provider `v8` vì nó đo qua source map, nên số thứ tự
branch khớp với source thật và danh sách "dòng chưa phủ" đáng tin.

Coverage là **cổng chặn, không phải mục tiêu**. Phủ 100% những đoạn code không ai
dùng còn tệ hơn 80% phần code quan trọng. Không bao giờ hạ ngưỡng để cho PR
pass.

## Chạy một phần cụ thể

```bash
# Backend
uv run pytest -m unit                                  # một tầng
uv run pytest tests/unit/test_greeting.py              # một file
uv run pytest -k "normalize"                           # một khái niệm
uv run pytest -x -q                                    # dừng ở lỗi đầu
uv run pytest --lf                                     # các lỗi gần nhất
uv run pytest --no-cov                                 # bỏ qua cổng coverage

# Frontend
bun run test:unit
bun run test tests/unit/test-config.test.ts
bun run test -t "joins a leading-slash path"           # theo tên test
bun run test:coverage
```

## Viết một tên test tốt

Tên test là tài liệu không bao giờ lỗi thời.

```python
def test_rejects_a_name_over_the_length_limit() -> None:      # tốt
def test_normalize_name_2() -> None:                          # tệ
def test_handles_edge_cases() -> None:                        # tệ
```

Đọc danh sách tên test theo thứ tự và bạn phải dựng lại được module này làm
gì. Đó là mục tiêu.

## Ngôn ngữ trong test

- **Tên test và tên hàm:** tiếng Anh, vì chúng là mã nguồn.
- **Dữ liệu đầu vào:** dùng dữ liệu thực tế của sản phẩm, tức là tên tiếng Việt
  không dấu và có dấu (`"Lan"`, `"Lan Anh"`), vì dữ liệu biên như `"x" * 81` phải
  phản ánh đúng thứ người dùng thật nhập vào.
- **String kỳ vọng:** tiếng Việt, vì chúng là nội dung người dùng nhìn thấy.
  Xem [AGENTS.md → Language convention](../AGENTS.md#language-convention).
