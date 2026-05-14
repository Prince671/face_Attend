let appNavigate = null;

export const setAppNavigate = (navigate) => {
  appNavigate = navigate;
};

export const navigateTo = (path, options = {}) => {
  if (appNavigate) {
    appNavigate(path, options);
    return;
  }

  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};
