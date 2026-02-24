(function () {
  const auth = window.MemoflixAuth || {};

  const loginLink = document.getElementById("loginLink");
  const notifyStatus = document.getElementById("notifyStatus");
  const refreshNotifyBtn = document.getElementById("refreshNotifyBtn");
  const markSeenBtn = document.getElementById("markSeenBtn");
  const notifyFilters = document.getElementById("notifyFilters");
  const notifyRecentList = document.getElementById("notifyRecentList");
  const notifyWeekList = document.getElementById("notifyWeekList");
  const notifyOlderList = document.getElementById("notifyOlderList");

  const NOTIFY_SEEN_KEY = "memoflix_notify_seen_v1";
  const LOCAL_FRIEND_KEY = "memoflix_friend_requests_v1";

  const state = {
    items: [],
    filter: "all",
    seen: new Set()
  };

  const escapeHtml = (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const normalizeUsername = (value) =>
    String(value || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_.]/g, "")
      .slice(0, 24);

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  };

  const getCurrentUser = () => auth.getCurrentUser?.() || null;

  const setUserNav = () => {
    if (!loginLink) return;
    const user = getCurrentUser();
    loginLink.textContent = user ? "Profil" : "Masuk";
    loginLink.href = user ? "profile.html" : "login.html";
  };

  const seenKeyForUser = (user) => String(user?.id || user?.username || "anon");

  const readSeenSet = (user) => {
    const map = readJson(NOTIFY_SEEN_KEY, {});
    const arr = Array.isArray(map?.[seenKeyForUser(user)]) ? map[seenKeyForUser(user)] : [];
    return new Set(arr.map(String));
  };

  const formatRelative = (value) => {
    const date = new Date(value || Date.now());
    const diff = Date.now() - date.getTime();
    if (!Number.isFinite(diff) || diff < 0) {
      return "barusan";
    }
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "barusan";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}j`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}h`;
    return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
  };

  const kindLabel = (kind) => {
    if (kind === "system") return "Sistem";
    if (kind === "friend-request") return "Pertemanan";
    if (kind === "tag") return "Tag";
    if (kind === "reply") return "Balasan";
    if (kind === "comment-like") return "Suka Komentar";
    return "Aktivitas";
  };

  const toCategory = (kind) => {
    if (kind === "system") return "system";
    if (kind === "friend-request") return "friend";
    return "interaction";
  };

  const cloudFetchJson = async (path, options = {}) => {
    if (auth.authorizedFetch) {
      const result = await auth.authorizedFetch(path, options);
      return result?.data ?? null;
    }

    const session = auth.getSession?.();
    const res = await fetch(`${auth.supabaseUrl}${path}`, {
      ...options,
      headers: {
        ...auth.authHeaders?.(session?.access_token || ""),
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(`Request gagal (${res.status})`);
    }
    return data;
  };

  const fetchPendingFriendRequests = async (user) => {
    if (!user) return [];

    if (!auth.cloudEnabled) {
      const local = readJson(LOCAL_FRIEND_KEY, { requests: [] });
      const me = normalizeUsername(user.username);
      const rows = Array.isArray(local?.requests) ? local.requests : [];
      return rows
        .filter((r) => normalizeUsername(r.to_username) === me && String(r.status || "") === "pending")
        .map((r) => ({
          id: `fr:${r.id || `${r.created_at}|${r.from_username}`}`,
          kind: "friend-request",
          sender: `@${normalizeUsername(r.from_username) || "user"}`,
          message: "mengirim permintaan pertemanan.",
          created_at: r.created_at || new Date().toISOString(),
          request_id: String(r.id || ""),
          request_pending: true
        }));
    }

    try {
      const me = normalizeUsername(user.username);
      const uid = String(user.id || "");
      const rows = await cloudFetchJson(
        `/rest/v1/friend_requests?select=id,sender_username,receiver_username,status,created_at,receiver_user_id&or=(receiver_username.eq.${encodeURIComponent(
          me
        )},receiver_user_id.eq.${encodeURIComponent(uid)})&status=eq.pending&order=created_at.desc&limit=120`,
        {}
      );
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => ({
        id: `fr:${r.id || `${r.created_at}|${r.sender_username}`}`,
        kind: "friend-request",
        sender: `@${normalizeUsername(r.sender_username) || "user"}`,
        message: "mengirim permintaan pertemanan.",
        created_at: r.created_at || new Date().toISOString(),
        request_id: String(r.id || ""),
        request_pending: String(r.status || "").toLowerCase() === "pending"
      }));
    } catch {
      return [];
    }
  };

  const respondFriendRequest = async (requestId, nextStatus) => {
    const user = getCurrentUser();
    if (!user) throw new Error("Masuk dulu.");
    const me = normalizeUsername(user.username);
    const status = String(nextStatus || "").toLowerCase();
    if (!["accepted", "rejected"].includes(status)) {
      throw new Error("Status tidak valid.");
    }

    if (!auth.cloudEnabled) {
      const local = readJson(LOCAL_FRIEND_KEY, { requests: [] });
      const rows = Array.isArray(local?.requests) ? local.requests : [];
      const next = rows.map((r) => {
        if (String(r.id) !== String(requestId)) return r;
        if (normalizeUsername(r.to_username) !== me) return r;
        return {
          ...r,
          status,
          updated_at: new Date().toISOString()
        };
      });
      localStorage.setItem(LOCAL_FRIEND_KEY, JSON.stringify({ requests: next }));
      return;
    }

    await cloudFetchJson(
      `/rest/v1/friend_requests?id=eq.${encodeURIComponent(requestId)}&status=eq.pending`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          status,
          updated_at: new Date().toISOString()
        })
      }
    );
  };

  const splitByTime = (items) => {
    const now = Date.now();
    const recent = [];
    const week = [];
    const older = [];

    items.forEach((item) => {
      const diff = now - new Date(item.created_at || now).getTime();
      if (diff <= 24 * 60 * 60 * 1000) {
        recent.push(item);
        return;
      }
      if (diff <= 7 * 24 * 60 * 60 * 1000) {
        week.push(item);
        return;
      }
      older.push(item);
    });

    return { recent, week, older };
  };

  const renderList = (target, items) => {
    if (!target) return;
    if (!items.length) {
      target.innerHTML = `<p class="ig-notify-empty">Tidak ada notifikasi.</p>`;
      return;
    }

    target.innerHTML = items
      .map((item) => {
        const senderRaw = String(item.sender || "User");
        const sender = senderRaw.startsWith("@") ? senderRaw : `@${normalizeUsername(senderRaw) || "user"}`;
        const initial = sender.replace(/^@/, "").charAt(0).toUpperCase() || "U";
        const unread = state.seen.has(String(item.id)) ? "" : " is-unread";
        const actionButtons =
          item.kind === "friend-request" && item.request_pending
            ? `
              <div class="ig-notify-item-actions">
                <button type="button" class="ghost-btn" data-action="accept" data-request-id="${escapeHtml(
                  item.request_id
                )}">Terima</button>
                <button type="button" class="ghost-btn" data-action="reject" data-request-id="${escapeHtml(
                  item.request_id
                )}">Tolak</button>
              </div>
            `
            : "";

        return `
          <article class="ig-notify-item${unread}">
            <div class="ig-notify-avatar">${escapeHtml(initial)}</div>
            <div class="ig-notify-content">
              <p class="ig-notify-text"><strong>${escapeHtml(sender)}</strong> ${escapeHtml(item.message || "")}</p>
              <div class="ig-notify-meta">
                <span>${escapeHtml(kindLabel(item.kind))}</span>
                <span>&bull;</span>
                <span>${escapeHtml(formatRelative(item.created_at))}</span>
              </div>
              ${actionButtons}
            </div>
          </article>
        `;
      })
      .join("");
  };

  const applyFilter = (items) => {
    if (state.filter === "all") return items;
    return items.filter((item) => toCategory(item.kind) === state.filter);
  };

  const renderAll = () => {
    const filtered = applyFilter(state.items);
    const grouped = splitByTime(filtered);
    renderList(notifyRecentList, grouped.recent);
    renderList(notifyWeekList, grouped.week);
    renderList(notifyOlderList, grouped.older);
  };

  const attachActions = () => {
    [notifyRecentList, notifyWeekList, notifyOlderList].forEach((container) => {
      container?.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute("data-action");
        const requestId = target.getAttribute("data-request-id");
        if (!action || !requestId) return;
        try {
          await respondFriendRequest(requestId, action === "accept" ? "accepted" : "rejected");
          notifyStatus.textContent = action === "accept" ? "Request pertemanan diterima." : "Request pertemanan ditolak.";
          await refreshNotifications();
        } catch (error) {
          notifyStatus.textContent = `Gagal update request: ${error.message}`;
        }
      });
    });
  };

  const refreshNotifications = async () => {
    const user = getCurrentUser();
    state.seen = readSeenSet(user);

    try {
      notifyStatus.textContent = "Memuat notifikasi...";
      const [baseItems, friendItems] = await Promise.all([
        auth.fetchAllNotifications?.(user) || Promise.resolve([]),
        fetchPendingFriendRequests(user)
      ]);

      const merged = [...(Array.isArray(baseItems) ? baseItems : []), ...(Array.isArray(friendItems) ? friendItems : [])]
        .filter((item) => item && item.id)
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

      state.items = merged;
      renderAll();

      const unread = merged.filter((item) => !state.seen.has(String(item.id))).length;
      notifyStatus.textContent = user
        ? `${merged.length} notifikasi, ${unread} belum dibaca.`
        : `${merged.length} notifikasi publik tersedia.`;
    } catch (error) {
      notifyStatus.textContent = `Gagal memuat notifikasi: ${error.message}`;
    }
  };

  notifyFilters?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("button[data-filter]");
    if (!button) return;
    const filter = String(button.getAttribute("data-filter") || "all");
    state.filter = filter;
    notifyFilters.querySelectorAll("button[data-filter]").forEach((el) => {
      el.classList.toggle("is-active", el === button);
    });
    renderAll();
  });

  refreshNotifyBtn?.addEventListener("click", refreshNotifications);

  markSeenBtn?.addEventListener("click", async () => {
    await auth.markAllNotificationsSeen?.(getCurrentUser());
    await refreshNotifications();
  });

  setUserNav();
  attachActions();
  refreshNotifications();
  setInterval(refreshNotifications, 20000);
})();
