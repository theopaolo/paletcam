const MAX_DETAIL_LENGTH = 120;

function truncate(value, maxLength) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function extractCommunityErrorDetails(error) {
  const code = error.code || "UNKNOWN";
  const cause = error.cause;

  if (!cause || typeof cause !== "object") {
    return `ERR ${code}`;
  }

  const status = cause.status ?? "";
  const path = cause.path || "";
  const reason = cause.payload?.originalError
    || cause.payload?.message
    || cause.message
    || "";

  const parts = ["ERR", code];

  if (status !== "") {
    parts.push(String(status));
  }

  if (path) {
    parts.push(path);
  }

  const prefix = parts.join(" ");

  if (!reason) {
    return prefix;
  }

  return truncate(`${prefix} — ${reason}`, MAX_DETAIL_LENGTH);
}

function extractGenericErrorDetails(error) {
  const name = error.name || "Error";
  const message = error.message || "";

  if (!message) {
    return `ERR ${name}`;
  }

  return truncate(`ERR ${name} — ${message}`, MAX_DETAIL_LENGTH);
}

export function formatErrorDetails(error) {
  if (!error || typeof error !== "object") {
    return "";
  }

  if (error.name === "CommunityServiceError") {
    return extractCommunityErrorDetails(error);
  }

  if (error.name === "CommunityApiError") {
    const status = error.status ?? "";
    const path = error.path || "";
    const reason = error.payload?.originalError || error.message || "";
    const parts = ["ERR", status !== "" ? String(status) : null, path || null]
      .filter(Boolean)
      .join(" ");

    if (!reason) {
      return parts;
    }

    return truncate(`${parts} — ${reason}`, MAX_DETAIL_LENGTH);
  }

  return extractGenericErrorDetails(error);
}
