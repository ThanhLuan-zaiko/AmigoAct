/**
 * Translate API failures into Vietnamese user-facing messages.
 *
 * The backend's `detail` is English diagnostics (repo language convention);
 * the UI never shows it raw — it switches on the machine `code` instead.
 * Unknown codes and non-API failures fall back to a generic message.
 *
 * Framework-free: no `next/*` or React imports.
 */
import { ApiError } from "@/lib/api";

/** Generic fallback — the only message for codes we do not know. */
export const GENERIC_ERROR_MESSAGE = "Có lỗi xảy ra, thử lại sau";

/**
 * Contract error codes → Vietnamese copy.
 *
 * The keys are pinned against the backend's domain error codes by
 * `tests/regression/api-contract.test.ts` — do not rename them.
 */
export const API_ERROR_MESSAGES: Record<string, string> = {
  missing_token: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
  token_invalid: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
  invalid_credentials: "Email hoặc mật khẩu không đúng",
  account_disabled: "Tài khoản đã bị khóa",
  email_taken: "Email này đã được đăng ký",
  invalid_email: "Email không hợp lệ",
  password_too_short: "Mật khẩu cần ít nhất 8 ký tự",
  password_too_long: "Mật khẩu không được quá 128 ký tự",
  invalid_name: "Tên không hợp lệ",
  not_found: "Không tìm thấy dữ liệu yêu cầu",
  permission_denied: "Bạn không có quyền thực hiện thao tác này",
  conflict: "Dữ liệu đã thay đổi, tải lại trang và thử lại",
  rule_violation: "Thao tác không hợp lệ",
  // Organisation and membership codes.
  org_not_found: "Không tìm thấy tổ chức với mã này",
  org_code_taken: "Mã tổ chức đã được sử dụng",
  invalid_org_code: "Mã tổ chức không hợp lệ",
  not_a_member: "Bạn chưa tham gia tổ chức này",
  already_member: "Bạn đã là thành viên của tổ chức này",
  student_code_taken: "Mã sinh viên này đã được sử dụng trong tổ chức",
  last_admin: "Tổ chức cần ít nhất một quản trị viên",
  insufficient_role: "Bạn cần quyền quản lý để thực hiện thao tác này",
  // Activity lifecycle codes.
  activity_not_found: "Không tìm thấy hoạt động",
  invalid_transition: "Không thể chuyển trạng thái hoạt động lúc này",
  invalid_window: "Khoảng thời gian không hợp lệ",
  activity_over: "Hoạt động đã kết thúc",
  capacity_below_registrations: "Sức chứa không thể nhỏ hơn số đăng ký hiện có",
  activity_full: "Hoạt động đã đủ số lượng đăng ký",
  registration_closed: "Đã hết thời gian đăng ký",
  // Registration codes.
  already_registered: "Bạn đã đăng ký hoạt động này",
  registration_rejected: "Đăng ký của bạn đã bị từ chối",
  cannot_cancel: "Không thể hủy đăng ký lúc này",
  cannot_review_checked_in: "Không thể duyệt đăng ký đã điểm danh",
  registration_not_approved: "Đăng ký chưa được duyệt hoặc không tồn tại",
  registration_not_found: "Không tìm thấy đăng ký",
  // Check-in codes.
  checkin_not_started: "Chưa đến thời gian điểm danh",
  checkin_ended: "Đã quá thời gian điểm danh",
  invalid_code: "Mã điểm danh không hợp lệ",
  wrong_checkin_code: "Mã điểm danh không đúng",
  // Member management and record codes.
  member_not_found: "Không tìm thấy thành viên",
  record_not_found: "Không tìm thấy thành tích",
  record_exists: "Thành tích đã được ghi nhận trước đó",
  invalid_evidence_url: "Đường dẫn minh chứng không hợp lệ",
  future_awarded_on: "Ngày ghi nhận không được ở tương lai",
  invalid_status: "Trạng thái không hợp lệ",
  cannot_review: "Không thể duyệt đăng ký lúc này",
  activity_not_published: "Hoạt động chưa được công bố",
  not_started: "Hoạt động chưa bắt đầu",
  terminal_state: "Dữ liệu đã ở trạng thái cuối, không thể thay đổi",
  // Local codes produced by apiFetch itself.
  validation_error: "Dữ liệu chưa hợp lệ",
  unexpected_response: "Máy chủ trả về phản hồi không hợp lệ",
  network_error: "Không kết nối được với máy chủ, vui lòng thử lại",
};

/** Describe any thrown value as a Vietnamese user-facing message. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return API_ERROR_MESSAGES[error.code] ?? GENERIC_ERROR_MESSAGE;
  }
  return GENERIC_ERROR_MESSAGE;
}
