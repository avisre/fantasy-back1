const REGISTER_CREDENTIALS_KEY = 'pendingRegisterCredentials';
const AUTO_LOGIN_MAX_RETRIES = 20;
const AUTO_LOGIN_DELAY_MS = 3000;

async function startSubscription(event) {
  event.preventDefault();
  const form = document.getElementById('register-form');
  const errorEl = document.getElementById('error-message');
  const successEl = document.getElementById('success-message');
  const name = document.getElementById('name')?.value?.trim() || '';
  const email = document.getElementById('email')?.value?.trim().toLowerCase() || '';
  const password = document.getElementById('password')?.value || '';

  if (!name || !email || !password) {
    if (errorEl) {
      errorEl.textContent = 'All fields are required before subscribing.';
      errorEl.style.display = '';
    }
    return;
  }

  if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }
  if (successEl) {
    successEl.textContent = '';
    successEl.style.display = 'none';
  }

  try {
    const response = await fetch(`${API_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      if (errorEl) {
        errorEl.textContent = data.message || 'Unable to start subscription.';
        errorEl.style.display = '';
      }
      return;
    }

    sessionStorage.setItem(REGISTER_CREDENTIALS_KEY, JSON.stringify({ email, password }));
    if (successEl) {
      successEl.textContent = 'Redirecting to Stripe checkout to complete your subscription…';
      successEl.style.display = '';
    }
    if (data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    console.error('Subscription creation failed:', err);
    if (errorEl) {
      errorEl.textContent = err.message || 'Something went wrong.';
      errorEl.style.display = '';
    }
  }
}

function showError(message) {
  const errorEl = document.getElementById('error-message');
  const successEl = document.getElementById('success-message');
  if (successEl) {
    successEl.textContent = '';
    successEl.style.display = 'none';
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = '';
  }
}

function showSuccess(message) {
  const successEl = document.getElementById('success-message');
  const errorEl = document.getElementById('error-message');
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }
  if (successEl) {
    successEl.textContent = message;
    successEl.style.display = '';
  }
}

async function attemptPostCheckoutLogin(retryCount = 0) {
  const params = new URLSearchParams(location.search);
  if (params.get('session') !== 'success') return;
  const credentials = sessionStorage.getItem(REGISTER_CREDENTIALS_KEY);
  if (!credentials) return;
  try {
    const { email, password } = JSON.parse(credentials);
    if (!email || !password) return;
    const loginResp = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (loginResp.ok) {
      const data = await loginResp.json();
      localStorage.setItem('token', data.token);
      sessionStorage.removeItem(REGISTER_CREDENTIALS_KEY);
      window.location.href = 'dashboard.html';
    } else if (loginResp.status === 402) {
      if (retryCount < AUTO_LOGIN_MAX_RETRIES) {
        showError('Subscription is still being activated. We will redirect you as soon as it is ready...');
        setTimeout(() => attemptPostCheckoutLogin(retryCount + 1), AUTO_LOGIN_DELAY_MS);
      } else {
        showError('Subscription is still activating. Please try logging in again shortly.');
      }
    } else {
      showError('Unable to log you in automatically. Please try logging in again.');
    }
  } catch (err) {
    console.error('Auto-login after payment failed:', err);
    if (retryCount < AUTO_LOGIN_MAX_RETRIES) {
      setTimeout(() => attemptPostCheckoutLogin(retryCount + 1), AUTO_LOGIN_DELAY_MS);
    } else {
      showError(err.message || 'Unexpected error while logging you in.');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('register-form');
  if (form) {
    form.addEventListener('submit', startSubscription);
  }
  attemptPostCheckoutLogin();
});
