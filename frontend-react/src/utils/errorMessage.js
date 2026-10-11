// FastAPI sends `detail` as a string, or (validation errors) an array of {msg,...}
// objects — rendering that array directly crashed an error banner once (React #31).
export function errorMessage(e, fallback = 'Something went wrong') {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
  return e?.message || fallback;
}
