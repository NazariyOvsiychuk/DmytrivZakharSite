export type EnrollmentStatus =
  | "idle"
  | "pending_pin"
  | "confirm_pin"
  | "scan_card_first"
  | "scan_card_second"
  | "scan_fingerprint"
  | "completed"
  | "cancelled";

export type EnrollmentMethod = "rfid_only" | "fingerprint_only" | "rfid_and_fingerprint";

export function enrollmentPrompt(status: EnrollmentStatus) {
  switch (status) {
    case "pending_pin":
      return {
        title: "Новий працівник",
        subtitle: "Введіть 5-значний код",
        helper: "Код стане основним PIN для входу на терміналі.",
      };
    case "confirm_pin":
      return {
        title: "Підтвердження коду",
        subtitle: "Повторіть 5-значний код",
        helper: "PIN має збігтися з попереднім введенням.",
      };
    case "scan_card_first":
      return {
        title: "RFID-картка",
        subtitle: "Прикладіть картку вперше",
        helper: "Термінал збереже UID картки для цього працівника.",
      };
    case "scan_card_second":
      return {
        title: "Підтвердження картки",
        subtitle: "Прикладіть ту саму картку ще раз",
        helper: "Потрібно підтвердити, що це саме та картка.",
      };
    case "scan_fingerprint":
      return {
        title: "Відбиток пальця",
        subtitle: "Зареєструйте відбиток",
        helper: "Після успішного запису працівник буде готовий до роботи.",
      };
    case "completed":
      return {
        title: "Готово",
        subtitle: "Працівника налаштовано",
        helper: "PIN, RFID-картка та відбиток уже збережені.",
      };
    case "cancelled":
      return {
        title: "Скасовано",
        subtitle: "Налаштування призупинено",
        helper: "Адміністратор може перезапустити enroll у кабінеті.",
      };
    case "idle":
    default:
      return {
        title: "Очікування",
        subtitle: "Немає активного enroll",
        helper: "Створіть або перезапустіть enroll в адмінці.",
      };
  }
}

export function normalizeRfidUid(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
}

export function formatEnrollmentStatus(status: string | null | undefined) {
  switch (status) {
    case "pending_pin":
      return "Очікує PIN";
    case "confirm_pin":
      return "Очікує підтвердження PIN";
    case "scan_card_first":
      return "Очікує першу RFID-картку";
    case "scan_card_second":
      return "Очікує повторну RFID-картку";
    case "scan_fingerprint":
      return "Очікує відбиток";
    case "completed":
      return "Налаштовано";
    case "cancelled":
      return "Скасовано";
    case "idle":
    default:
      return "Не запускалось";
  }
}

export function formatEnrollmentMethod(method: string | null | undefined) {
  switch (method) {
    case "rfid_only":
      return "Тільки RFID";
    case "fingerprint_only":
      return "Тільки відбиток";
    case "rfid_and_fingerprint":
    default:
      return "RFID + відбиток";
  }
}
