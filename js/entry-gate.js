(function () {
  const ENTRY_KEY = "memoflix_entry_ok_v1";
  const GUEST_KEY = "memoflix_guest_mode_v1";
  const SESSION_KEY = "memoflix_supabase_session_v1";

  const getPageName = () => {
    const path = window.location.pathname || "/";
    const last = path.split("/").filter(Boolean).pop() || "";
    return last || "index.html";
  };

  const isLoggedIn = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const parsed = JSON.parse(raw || "null");
      return Boolean(parsed?.access_token && parsed?.user?.id);
    } catch {
      return false;
    }
  };

  const redirect = (target) => {
    if (getPageName() !== target) {
      window.location.replace(target);
    }
  };

  const currentPage = getPageName();
  const publicPages = new Set(["main-menu.html", "offline.html"]);
  if (publicPages.has(currentPage)) {
    return;
  }

  const hasEntry = localStorage.getItem(ENTRY_KEY) === "1";
  if (!hasEntry) {
    redirect("main-menu.html");
    return;
  }

  const loggedIn = isLoggedIn();
  if (loggedIn) {
    localStorage.removeItem(GUEST_KEY);
    return;
  }

  const isGuest = localStorage.getItem(GUEST_KEY) === "1";
  if (!isGuest) {
    return;
  }

  const guestAllowedPages = new Set(["secret-message.html", "login.html"]);
  if (!guestAllowedPages.has(currentPage)) {
    redirect("secret-message.html");
  }
})();
