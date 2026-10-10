/**
 * SpendGuard — API Client & Session Manager
 * Handles:
 * - Token management with localStorage
 * - Bearer authorization header injection (EC-1.5)
 * - Session expiry interception and redirect (EC-1.6)
 * - Toast notification system
 */

const TOKEN_KEY = 'spendguard_token';
const USER_KEY = 'spendguard_user';

const api = {
  // -------------------------------------------------------------
  // Token & Session Storage Helpers
  // -------------------------------------------------------------
  getToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || token === 'undefined' || token === 'null') {
      return null;
    }
    return token;
  },

  getUser() {
    try {
      const userStr = localStorage.getItem(USER_KEY);
      return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      return null;
    }
  },

  setSession(token, user) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  },

  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  isAuthenticated() {
    return !!api.getToken();
  },

  // -------------------------------------------------------------
  // Base Fetch Request Wrapper
  // -------------------------------------------------------------
  async request(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : endpoint;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = api.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json().catch(() => ({}));

      // Handle 401 Unauthorized / Expired Token (EC-1.6)
      if (response.status === 401) {
        if (data.code === 'TOKEN_EXPIRED') {
          api.clearSession();
          const currentPath = window.location.pathname;
          if (!currentPath.includes('login.html') && !currentPath.includes('register.html')) {
            window.location.href = `/login.html?expired=1`;
          }
        }
        const error = new Error(data.error || 'Authentication required');
        error.status = 401;
        error.code = data.code;
        error.data = data;
        throw error;
      }

      if (!response.ok) {
        const error = new Error(data.error || `HTTP error ${response.status}`);
        error.status = response.status;
        error.code = data.code;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      throw err;
    }
  },

  // -------------------------------------------------------------
  // Authentication API Endpoints
  // -------------------------------------------------------------
  auth: {
    async register(name, email, password) {
      const data = await api.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
      });
      if (data.token) {
        api.setSession(data.token, data.user);
      }
      return data;
    },

    async login(email, password) {
      const data = await api.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (data.token) {
        api.setSession(data.token, data.user);
      }
      return data;
    },

    async getMe() {
      return api.request('/api/auth/me', {
        method: 'GET'
      });
    },

    async deleteAccount(password) {
      const data = await api.request('/api/auth/me', {
        method: 'DELETE',
        body: JSON.stringify({ password })
      });
      api.clearSession();
      return data;
    },

    logout() {
      api.clearSession();
      window.location.href = '/login.html';
    }
  },

  // -------------------------------------------------------------
  // Import API Endpoints (Module 2)
  // -------------------------------------------------------------
  import: {
    async preview(file) {
      const formData = new FormData();
      formData.append('file', file);

      const token = api.getToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/import/preview', {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to preview CSV');
      }
      return data;
    },

    async process(file, columnMapping, dateFormat = 'DD/MM/YYYY') {
      const formData = new FormData();
      formData.append('file', file);
      if (columnMapping) {
        formData.append('columnMapping', JSON.stringify(columnMapping));
      }
      formData.append('dateFormat', dateFormat);

      const token = api.getToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/import/process', {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to process CSV import');
      }
      return data;
    },

    async getHistory(limit = 10) {
      return api.request(`/api/import/history?limit=${limit}`);
    }
  },

  // -------------------------------------------------------------
  // Transactions & Categories API (Module 3)
  // -------------------------------------------------------------
  transactions: {
    async list(params = {}) {
      const query = new URLSearchParams();
      if (params.page) query.set('page', params.page);
      if (params.limit) query.set('limit', params.limit);
      if (params.search) query.set('search', params.search);
      if (params.category) query.set('category', params.category);
      if (params.needsReview) query.set('needsReview', params.needsReview);
      if (params.startDate) query.set('startDate', params.startDate);
      if (params.endDate) query.set('endDate', params.endDate);

      return api.request(`/api/transactions?${query.toString()}`);
    },

    async update(id, payload) {
      return api.request(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
    },

    async getCategories() {
      return api.request('/api/categories');
    }
  },

  // -------------------------------------------------------------
  // Custom Merchant Rules API (Module 3)
  // -------------------------------------------------------------
  rules: {
    async list() {
      return api.request('/api/merchant-rules');
    },

    async create(pattern, canonicalMerchant, category) {
      return api.request('/api/merchant-rules', {
        method: 'POST',
        body: JSON.stringify({ pattern, canonicalMerchant, category })
      });
    },

    async delete(id) {
      return api.request(`/api/merchant-rules/${id}`, {
        method: 'DELETE'
      });
    }
  },

  // -------------------------------------------------------------
  // Toast Notification System
  // -------------------------------------------------------------
  showToast(message, type = 'info', title = null) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: `<svg class="toast-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`,
      error: `<svg class="toast-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`,
      warning: `<svg class="toast-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
      info: `<svg class="toast-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
    };

    const titles = {
      success: title || 'Success',
      error: title || 'Error',
      warning: title || 'Notice',
      info: title || 'Info'
    };

    toast.innerHTML = `
      ${icons[type] || icons.info}
      <div class="toast-content">
        <div class="toast-title">${titles[type]}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" aria-label="Close">&times;</button>
    `;

    container.appendChild(toast);

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
      toast.style.animation = 'fadeOut 0.2s ease-in forwards';
      setTimeout(() => toast.remove(), 200);
    });

    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.animation = 'fadeOut 0.2s ease-in forwards';
        setTimeout(() => toast.remove(), 200);
      }
    }, 4000);
  }
};

// Global export
window.api = api;
