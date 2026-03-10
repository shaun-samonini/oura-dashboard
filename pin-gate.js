/**
 * PIN Gate — blocks page content until correct PIN is entered.
 * PIN is validated server-side via /api/auth.
 * Auth persists in localStorage so you only enter it once per device.
 */
(function () {
  const AUTH_KEY = "oura-dashboard-auth";

  // Already authenticated
  if (localStorage.getItem(AUTH_KEY)) return;

  // Block the page
  document.documentElement.style.overflow = "hidden";

  const overlay = document.createElement("div");
  overlay.id = "pin-gate";
  overlay.innerHTML = `
    <div style="
      position: fixed; inset: 0; z-index: 99999;
      background: #1a1a2e;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div style="text-align: center; color: #e0e0e0;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
        <h2 style="margin: 0 0 8px; font-size: 20px; font-weight: 600;">Oura Dashboard</h2>
        <p style="margin: 0 0 24px; color: #888; font-size: 14px;">Enter your PIN to continue</p>
        <div style="display: flex; gap: 8px; justify-content: center; margin-bottom: 16px;">
          <input id="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6"
            placeholder="PIN"
            style="
              width: 140px; padding: 12px 16px; font-size: 24px; text-align: center;
              background: #16213e; border: 2px solid #333; border-radius: 12px;
              color: #fff; outline: none; letter-spacing: 8px;
            "
          />
        </div>
        <button id="pin-submit" style="
          padding: 10px 32px; font-size: 16px; font-weight: 600;
          background: #e67e22; color: #fff; border: none; border-radius: 8px;
          cursor: pointer;
        ">Unlock</button>
        <p id="pin-error" style="color: #e74c3c; margin-top: 12px; font-size: 14px; display: none;">
          Wrong PIN. Try again.
        </p>
      </div>
    </div>
  `;

  document.body.prepend(overlay);

  const input = document.getElementById("pin-input");
  const submit = document.getElementById("pin-submit");
  const error = document.getElementById("pin-error");

  async function checkPin() {
    const pin = input.value.trim();
    if (!pin) return;

    submit.disabled = true;
    submit.textContent = "...";

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();

      if (data.valid) {
        localStorage.setItem(AUTH_KEY, data.token);
        overlay.remove();
        document.documentElement.style.overflow = "";
      } else {
        error.style.display = "block";
        input.value = "";
        input.focus();
      }
    } catch {
      error.textContent = "Connection error. Try again.";
      error.style.display = "block";
    }

    submit.disabled = false;
    submit.textContent = "Unlock";
  }

  submit.addEventListener("click", checkPin);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkPin();
  });

  // Auto-focus after a tick (mobile keyboards)
  setTimeout(() => input.focus(), 100);
})();
