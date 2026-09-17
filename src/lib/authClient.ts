const AUTH_TOKEN_KEY = "omb_auth_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = (await res.json()) as { token?: string; error?: string };

    if (res.ok && data.token) {
      setAuthToken(data.token);
      return { success: true };
    }

    return { success: false, error: data.error || "ログインに失敗しました" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `接続エラー: ${message}` };
  }
}

export async function checkAuth(): Promise<boolean> {
  const token = getAuthToken();
  if (!token) return false;

  try {
    const res = await fetch("/api/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      clearAuthToken();
      return false;
    }

    return res.ok;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  const token = getAuthToken();
  if (token) {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore errors on logout
    }
  }
  clearAuthToken();
}
