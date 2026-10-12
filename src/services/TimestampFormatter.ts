const TOKEN = /YYYY|MM|DD|HH|mm|ss/g;

const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

/**
 * Tiny date formatter for the Quick Note heading.
 * Tokens: YYYY (year), MM (month), DD (day), HH (24h hour), mm (minutes), ss (seconds), in local time.
 * Everything else is copied as it is. An empty pattern gives an empty string (no heading).
 */
export class TimestampFormatter {
  format(date: Date, pattern: string): string {
    if (pattern.length === 0) {
      return "";
    }
    return pattern.replace(TOKEN, (token) => {
      switch (token) {
        case "YYYY":
          return pad(date.getFullYear(), 4);
        case "MM":
          return pad(date.getMonth() + 1);
        case "DD":
          return pad(date.getDate());
        case "HH":
          return pad(date.getHours());
        case "mm":
          return pad(date.getMinutes());
        default:
          return pad(date.getSeconds());
      }
    });
  }
}
