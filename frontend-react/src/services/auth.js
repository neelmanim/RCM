// Auth Utility service for token parsing and login/out

export const setToken = (token) => {
  localStorage.setItem('crm_token', token);
};

export const getToken = () => {
  // View-As mode: Super Admin impersonating another user.
  // crm_view_as_token is stored in sessionStorage by the vanilla JS app (app.js).
  // The React Dashboard must use this token so backend scoping reflects the
  // impersonated user's role/pod, not the Super Admin's.
  const viewAsToken = sessionStorage.getItem('crm_view_as_token');
  if (viewAsToken) return viewAsToken;
  return localStorage.getItem('crm_token');
};


export const removeToken = () => {
  localStorage.removeItem('crm_token');
};

export const parseJwt = (token) => {
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch (e) {
    return null;
  }
};

export const getCurrentUser = () => {
  const token = getToken();
  return token ? parseJwt(token) : null;
};

export const isAuthenticated = () => {
  const user = getCurrentUser();
  if (!user) return false;
  // Check token expiration
  if (user.exp && user.exp * 1000 < Date.now()) {
    return false;
  }
  return true;
};

export const logout = () => {
  removeToken();
  // Dispatch event so the Vanilla JS shell can handle logout/redirect.
  // Do NOT use window.location.href here — this runs inside an IIFE and
  // would redirect the entire host CRM page.
  window.dispatchEvent(new CustomEvent('crm:logout'));
};

// Role Check Helpers
export const isSuperAdmin = (user) => user?.role === 'Super Admin' || user?.role === 'Admin';
export const isPodAdmin = (user) => user?.role === 'Pod Admin';
export const isAdmin = (user) => isSuperAdmin(user) || isPodAdmin(user);
export const isSDR = (user) => user?.role === 'SDR';
