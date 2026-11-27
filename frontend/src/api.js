const API = import.meta.env.VITE_API || "http://127.0.0.1:8000";

export function getRole() {
  return localStorage.getItem("caretrace_role") || "coordinator";
}

export function setRole(role) {
  localStorage.setItem("caretrace_role", role);
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Role": getRole(),
      "X-User": getRole() === "clinician" ? "dr-demo" : "coordinator-demo",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const payload = await res.json();
      detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
    } catch {
      /* ignore */
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const num = (x, digits = 2) => Number(x).toFixed(digits);
