/**
 * SpendGuard — Auth Page Handlers
 * Real-time validation, password toggle, form submissions.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Check if session expired query param is set
  const urlParams = new URLSearchParams(window.location.search);
  const alertBanner = document.getElementById('auth-alert-banner');
  const alertText = document.getElementById('auth-alert-text');

  if (urlParams.get('expired') === '1' && alertBanner && alertText) {
    alertBanner.className = 'alert-banner alert-warning active';
    alertText.textContent = 'Your session has expired. Please log in again.';
  }

  // If already logged in, redirect away from login/register to index
  if (api.isAuthenticated() && (window.location.pathname.includes('login') || window.location.pathname.includes('register'))) {
    // Quick verify with getMe
    api.auth.getMe()
      .then(() => {
        window.location.href = '/index.html';
      })
      .catch(() => {
        api.clearSession();
      });
  }

  // Setup password visibility toggles
  setupPasswordToggles();

  // Initialize Login Form if present
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    initLoginForm(loginForm);
  }

  // Initialize Register Form if present
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    initRegisterForm(registerForm);
  }
});

/**
 * Configure toggle show/hide password buttons.
 */
function setupPasswordToggles() {
  const toggleButtons = document.querySelectorAll('.toggle-password');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target') || 'password';
      const input = document.getElementById(targetId);
      if (!input) return;

      if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>`;
      } else {
        input.type = 'password';
        btn.innerHTML = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
      }
    });
  });
}

/**
 * Handle Login Form logic.
 */
function initLoginForm(form) {
  const submitBtn = document.getElementById('login-btn');
  const alertBanner = document.getElementById('auth-alert-banner');
  const alertText = document.getElementById('auth-alert-text');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    const email = (emailInput?.value || '').trim();
    const password = passwordInput?.value || '';

    // Client-side quick checks
    if (!email || !password) {
      showFormAlert(alertBanner, alertText, 'Please provide both email and password.');
      return;
    }

    setButtonLoading(submitBtn, true, 'Signing in...');

    try {
      const result = await api.auth.login(email, password);
      api.showToast(`Welcome back, ${result.user.name}!`, 'success');
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 500);
    } catch (err) {
      setButtonLoading(submitBtn, false, 'Sign In');
      const msg = err.data?.error || err.message || 'Login failed. Please check your credentials.';
      showFormAlert(alertBanner, alertText, msg);
    }
  });
}

/**
 * Handle Registration Form logic.
 */
function initRegisterForm(form) {
  const submitBtn = document.getElementById('register-btn');
  const alertBanner = document.getElementById('auth-alert-banner');
  const alertText = document.getElementById('auth-alert-text');

  const passwordInput = document.getElementById('password');
  const reqLength = document.getElementById('req-length');
  const reqMax = document.getElementById('req-max');

  // Real-time password criteria feedback
  if (passwordInput && reqLength && reqMax) {
    passwordInput.addEventListener('input', () => {
      const val = passwordInput.value;
      const trimmedLen = val.trim().length;

      if (trimmedLen >= 6) {
        reqLength.classList.add('met');
      } else {
        reqLength.classList.remove('met');
      }

      if (val.length <= 72 && val.length > 0) {
        reqMax.classList.add('met');
      } else {
        reqMax.classList.remove('met');
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const name = (nameInput?.value || '').trim();
    const email = (emailInput?.value || '').trim();
    const password = passwordInput?.value || '';

    // Client-side validations (EC-1.1, EC-1.2, EC-1.3, EC-1.4)
    if (!name || name.length < 2) {
      showFormAlert(alertBanner, alertText, 'Full name must be at least 2 characters.');
      nameInput?.focus();
      return;
    }

    if (!email) {
      showFormAlert(alertBanner, alertText, 'Email address is required.');
      emailInput?.focus();
      return;
    }

    if (password.trim().length < 6) {
      showFormAlert(alertBanner, alertText, 'Password must be at least 6 non-whitespace characters.');
      passwordInput?.focus();
      return;
    }

    if (password.length > 72) {
      showFormAlert(alertBanner, alertText, 'Password cannot exceed 72 characters.');
      passwordInput?.focus();
      return;
    }

    setButtonLoading(submitBtn, true, 'Creating Account...');

    try {
      const result = await api.auth.register(name, email, password);
      api.showToast(`Account created! Welcome to SpendGuard, ${result.user.name}.`, 'success');
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 500);
    } catch (err) {
      setButtonLoading(submitBtn, false, 'Create Account');
      const msg = err.data?.error || err.message || 'Registration failed. Please try again.';
      showFormAlert(alertBanner, alertText, msg);
    }
  });
}

function showFormAlert(banner, textElem, message, type = 'danger') {
  if (!banner || !textElem) return;
  banner.className = `alert-banner alert-${type} active`;
  textElem.textContent = message;
}

function setButtonLoading(button, isLoading, text) {
  if (!button) return;
  if (isLoading) {
    button.disabled = true;
    button.innerHTML = `<div class="spinner"></div> <span>${text}</span>`;
  } else {
    button.disabled = false;
    button.innerHTML = `<span>${text}</span>`;
  }
}
