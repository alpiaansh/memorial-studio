(function () {
  const SESSION_KEY = "memoflix_supabase_session_v1";
  const LOCAL_SYSTEM_UPDATES_KEY = "memoflix_system_announcements_local_v1";
  const LOCAL_SECRET_MESSAGES_KEY = "memoflix_secret_messages_v1";
  const NOTIFY_SEEN_KEY = "memoflix_notify_seen_v1";
  const TAG_BLOCK_START = "[[TAGS]]";
  const TAG_BLOCK_END = "[[/TAGS]]";
  const POLL_NOTIFY_MS = 15000;
  const SESSION_REFRESH_MS = 60000;
  const SESSION_REFRESH_SKEW_SEC = 90;

  const cfg = window.APP_CONFIG || {};
  const supabaseUrl = String(cfg.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const supabaseAnonKey = String(cfg.SUPABASE_ANON_KEY || "").trim();
  const cloudEnabled = Boolean(supabaseUrl && supabaseAnonKey);

  const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
  const normalizeUsername = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.]/g, "")
      .slice(0, 24);
  const normalizeTagToken = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^@+/, "")
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9_.]/g, "");

  const authHeaders = (accessToken) => {
    const headers = {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json"
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    return headers;
  };

  const escapeHtml = (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const normalizeSessionShape = (session) => {
    if (!session || typeof session !== "object") {
      return null;
    }
    const next = { ...session };
    if (!next.expires_at && Number.isFinite(Number(next.expires_in))) {
      next.expires_at = Math.floor(Date.now() / 1000) + Number(next.expires_in);
    }
    return next;
  };

  const getSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const parsed = normalizeSessionShape(JSON.parse(raw || "null"));
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      if (!parsed.access_token || !parsed.user?.id) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const setSession = (session) => {
    const next = normalizeSessionShape(session);
    if (!next) {
      clearSession();
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
  };

  const getCurrentUser = () => {
    const session = getSession();
    if (!session?.user) {
      return null;
    }

    const username = normalizeUsername(
      session.user.user_metadata?.username ||
        session.user.user_metadata?.display_name ||
        session.user.user_metadata?.name ||
        session.user.email?.split("@")[0]
    );
    const displayName =
      session.user.user_metadata?.display_name ||
      session.user.user_metadata?.name ||
      username ||
      session.user.email;

    return {
      id: session.user.id,
      email: normalizeEmail(session.user.email),
      name: displayName,
      username
    };
  };

  const authRequest = async (path, options = {}) => {
    if (!cloudEnabled) {
      throw new Error("Supabase config belum diisi.");
    }
    const res = await fetch(`${supabaseUrl}${path}`, options);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        (data && (data.msg || data.message || data.error_description || data.error)) ||
        `Request gagal (${res.status})`;
      throw new Error(msg);
    }
    return data;
  };

  const parseResponsePayload = async (res) => {
    const text = await res.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const isSessionNearExpiry = (session, skewSec = SESSION_REFRESH_SKEW_SEC) => {
    if (!session) {
      return false;
    }
    const expiresAt = Number(session.expires_at || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      return false;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    return expiresAt - nowSec <= skewSec;
  };

  let refreshingPromise = null;
  const refreshSession = async () => {
    if (refreshingPromise) {
      return refreshingPromise;
    }

    const current = getSession();
    if (!current?.refresh_token || !cloudEnabled) {
      return current;
    }

    refreshingPromise = (async () => {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: current.refresh_token })
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        const msg = String(data?.error_description || data?.message || data?.error || "");
        if (res.status === 400 || res.status === 401 || msg.toLowerCase().includes("refresh token")) {
          clearSession();
        }
        throw new Error(msg || `Refresh session gagal (${res.status})`);
      }

      const next = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || current.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
        token_type: data.token_type || current.token_type || "bearer",
        user: data.user || current.user
      };
      setSession(next);
      return next;
    })();

    try {
      return await refreshingPromise;
    } finally {
      refreshingPromise = null;
    }
  };

  const ensureSessionFresh = async ({ force = false } = {}) => {
    const session = getSession();
    if (!session || !session.refresh_token) {
      return session;
    }
    if (!force && !isSessionNearExpiry(session)) {
      return session;
    }
    try {
      return await refreshSession();
    } catch {
      return getSession();
    }
  };

  const authorizedFetch = async (path, options = {}, retry = true) => {
    if (!cloudEnabled) {
      throw new Error("Supabase config belum diisi.");
    }

    const preparedOptions = { ...options };
    const suppliedHeaders = { ...(preparedOptions.headers || {}) };
    delete preparedOptions.headers;

    let session = await ensureSessionFresh();
    let accessToken = session?.access_token || "";
    let res = await fetch(`${supabaseUrl}${path}`, {
      ...preparedOptions,
      headers: {
        ...authHeaders(accessToken),
        ...suppliedHeaders
      }
    });

    if ((res.status === 401 || res.status === 403) && retry) {
      session = await refreshSession().catch(() => null);
      accessToken = session?.access_token || getSession()?.access_token || "";
      res = await fetch(`${supabaseUrl}${path}`, {
        ...preparedOptions,
        headers: {
          ...authHeaders(accessToken),
          ...suppliedHeaders
        }
      });
    }

    const data = await parseResponsePayload(res);
    if (!res.ok) {
      if ((res.status === 401 || res.status === 403) && !getSession()?.refresh_token) {
        clearSession();
      }
      const msg =
        (data && (data.msg || data.message || data.error_description || data.error)) ||
        `Request gagal (${res.status})`;
      throw new Error(msg);
    }

    return {
      ok: true,
      status: res.status,
      data,
      headers: res.headers
    };
  };

  const isUsernameAvailable = async (username) => {
    if (!cloudEnabled) {
      return true;
    }

    const clean = normalizeUsername(username);
    if (!/^[a-z0-9_.]{3,24}$/.test(clean)) {
      return false;
    }

    try {
      const result = await authorizedFetch(
        `/rest/v1/usernames_public?select=username&username=eq.${encodeURIComponent(clean)}&limit=1`
      );
      const data = result?.data;
      return !Array.isArray(data) || data.length === 0;
    } catch {
      throw new Error("Gagal cek username. Pastikan schema Supabase sudah terbaru.");
    }
  };

  const signUp = async ({ name, username, email, password }) => {
    const cleanEmail = normalizeEmail(email);
    const cleanUsername = normalizeUsername(username);
    const data = await authRequest("/auth/v1/signup", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email: cleanEmail,
        password,
        data: {
          display_name: String(name || "").trim() || cleanUsername,
          username: cleanUsername
        }
      })
    });
    if (data?.session) {
      setSession(data.session);
    }
    return data;
  };

  const isProfileSuspended = (flags) => {
    if (!flags?.isSuspended) {
      return false;
    }
    if (!flags?.suspendedUntil) {
      return true;
    }
    const until = new Date(flags.suspendedUntil);
    if (Number.isNaN(until.getTime())) {
      return true;
    }
    return until.getTime() > Date.now();
  };

  const signIn = async ({ email, password }) => {
    const data = await authRequest("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email: normalizeEmail(email), password })
    });
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      user: data.user
    };
    setSession(session);
    try {
      const flags = await fetchMyProfileFlags();
      if (isProfileSuspended(flags)) {
        await signOut();
        const untilLabel = flags?.suspendedUntil ? ` sampai ${new Date(flags.suspendedUntil).toLocaleString("id-ID")}` : "";
        const reasonLabel = flags?.suspendedReason ? ` (${flags.suspendedReason})` : "";
        throw new Error(`Akun sedang dipunish${untilLabel}${reasonLabel}.`);
      }
    } catch (error) {
      if (String(error?.message || "").includes("Akun sedang dipunish")) {
        throw error;
      }
    }
    return session;
  };

  const signOut = async () => {
    const session = getSession();
    if (session?.access_token) {
      try {
        await authRequest("/auth/v1/logout", {
          method: "POST",
          headers: authHeaders(session.access_token)
        });
      } catch {
        // Keep local clear even if remote logout fails.
      }
    }
    clearSession();
    profileFlagsCache = {
      userId: "",
      isAdmin: false,
      username: "",
      isSuspended: false,
      suspendedUntil: "",
      suspendedReason: "",
      at: 0
    };
  };

  const upsertProfile = async () => {
    const session = getSession();
    const user = getCurrentUser();
    if (!session?.access_token || !user?.id) {
      return;
    }

    const headers = {
      ...authHeaders(session.access_token),
      Prefer: "resolution=merge-duplicates,return=minimal"
    };
    const payload = {
      user_id: user.id,
      display_name: user.name,
      username: user.username,
      email: user.email
    };

    try {
      await authRequest("/rest/v1/user_profiles", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
    } catch (error) {
      const message = String(error?.message || "");
      const missingUsernameColumn =
        message.includes("username") && (message.includes("column") || message.includes("schema cache"));
      if (!missingUsernameColumn) {
        throw error;
      }

      await authRequest("/rest/v1/user_profiles", {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: user.id,
          display_name: user.name,
          email: user.email
        })
      });
    }
  };

  const updateMyProfile = async ({ displayName, username }) => {
    const session = getSession();
    const user = getCurrentUser();
    if (!session?.access_token || !user?.id) {
      throw new Error("Session tidak valid. Silakan login ulang.");
    }

    const cleanDisplayName = String(displayName || "").trim();
    const cleanUsername = normalizeUsername(username);

    if (!cleanDisplayName) {
      throw new Error("Nama tampilan wajib diisi.");
    }
    if (!/^[a-z0-9_.]{3,24}$/.test(cleanUsername)) {
      throw new Error("Username tidak valid.");
    }

    const currentUsername = normalizeUsername(user.username);
    if (cleanUsername !== currentUsername) {
      const available = await isUsernameAvailable(cleanUsername);
      if (!available) {
        throw new Error("Username sudah dipakai.");
      }
    }

    const updated = await authRequest("/auth/v1/user", {
      method: "PUT",
      headers: authHeaders(session.access_token),
      body: JSON.stringify({
        data: {
          display_name: cleanDisplayName,
          username: cleanUsername
        }
      })
    });

    const nextSession = {
      ...session,
      user: updated?.user || {
        ...session.user,
        user_metadata: {
          ...(session.user?.user_metadata || {}),
          display_name: cleanDisplayName,
          username: cleanUsername
        }
      }
    };
    setSession(nextSession);

    await authRequest(`/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(nextSession.access_token),
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        display_name: cleanDisplayName,
        username: cleanUsername,
        email: normalizeEmail(user.email)
      })
    });

    profileFlagsCache = {
      userId: user.id,
      isAdmin: profileFlagsCache.isAdmin,
      username: cleanUsername,
      at: Date.now()
    };

    return getCurrentUser();
  };

  const parseTagsInput = (value) => {
    const raw = String(value || "");
    if (!raw) {
      return [];
    }

    const unique = new Set();
    raw
      .split(/[,\n]/)
      .map((item) => normalizeTagToken(item))
      .filter(Boolean)
      .forEach((tag) => unique.add(tag));
    return [...unique];
  };

  const unpackMessageTags = (rawMessageText) => {
    const source = String(rawMessageText || "");
    if (!source.startsWith(TAG_BLOCK_START)) {
      return [];
    }

    const endIndex = source.indexOf(TAG_BLOCK_END);
    if (endIndex < 0) {
      return [];
    }
    return parseTagsInput(source.slice(TAG_BLOCK_START.length, endIndex));
  };

  const unpackMessageText = (rawMessageText) => {
    const source = String(rawMessageText || "");
    if (!source.startsWith(TAG_BLOCK_START)) {
      return source.trim();
    }
    const endIndex = source.indexOf(TAG_BLOCK_END);
    if (endIndex < 0) {
      return source.trim();
    }
    return source.slice(endIndex + TAG_BLOCK_END.length).trim();
  };

  const isTaggedForUser = (message, user) => {
    if (!user || !message) {
      return false;
    }
    const tags = unpackMessageTags(message.message_text);
    if (!tags.length) {
      return false;
    }

    const usernameTag = normalizeTagToken(user.username);
    const nameTag = normalizeTagToken(user.name);
    return tags.includes(usernameTag) || (nameTag && tags.includes(nameTag));
  };

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  };

  const saveJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const seenKeyForUser = (user) => String(user?.id || user?.username || "anon");
  const readSeenMapForUser = (user) => {
    const all = readJson(NOTIFY_SEEN_KEY, {});
    const key = seenKeyForUser(user);
    const arr = Array.isArray(all[key]) ? all[key] : [];
    return new Set(arr);
  };
  const writeSeenMapForUser = (user, set) => {
    const all = readJson(NOTIFY_SEEN_KEY, {});
    all[seenKeyForUser(user)] = [...set];
    saveJson(NOTIFY_SEEN_KEY, all);
  };

  let profileFlagsCache = {
    userId: "",
    isAdmin: false,
    username: "",
    isSuspended: false,
    suspendedUntil: "",
    suspendedReason: "",
    at: 0
  };
  const fetchMyProfileFlags = async () => {
    const user = getCurrentUser();
    const session = getSession();
    if (!user?.id || !session?.access_token || !cloudEnabled) {
      return {
        isAdmin: false,
        username: user?.username || "",
        isSuspended: false,
        suspendedUntil: "",
        suspendedReason: ""
      };
    }

    const now = Date.now();
    if (profileFlagsCache.userId === user.id && now - profileFlagsCache.at < 30000) {
      return {
        isAdmin: profileFlagsCache.isAdmin,
        username: profileFlagsCache.username || user.username,
        isSuspended: profileFlagsCache.isSuspended,
        suspendedUntil: profileFlagsCache.suspendedUntil || "",
        suspendedReason: profileFlagsCache.suspendedReason || ""
      };
    }

    try {
      const result = await authorizedFetch(
        `/rest/v1/user_profiles?select=username,is_admin,is_suspended,suspended_until,suspended_reason&user_id=eq.${encodeURIComponent(
          user.id
        )}&limit=1`
      );
      const data = result?.data;
      const row = Array.isArray(data) && data.length > 0 ? data[0] : {};
      profileFlagsCache = {
        userId: user.id,
        isAdmin: Boolean(row.is_admin),
        username: normalizeUsername(row.username || user.username),
        isSuspended: Boolean(row.is_suspended),
        suspendedUntil: String(row.suspended_until || ""),
        suspendedReason: String(row.suspended_reason || ""),
        at: now
      };
      return {
        isAdmin: profileFlagsCache.isAdmin,
        username: profileFlagsCache.username,
        isSuspended: profileFlagsCache.isSuspended,
        suspendedUntil: profileFlagsCache.suspendedUntil,
        suspendedReason: profileFlagsCache.suspendedReason
      };
    } catch {
      return {
        isAdmin: false,
        username: user.username,
        isSuspended: false,
        suspendedUntil: "",
        suspendedReason: ""
      };
    }
  };

  const isAdminByConfig = (user) => {
    const list = Array.isArray(cfg.ADMIN_USERNAMES) ? cfg.ADMIN_USERNAMES : [];
    if (!user?.username || list.length === 0) {
      return false;
    }
    const normalized = list.map((item) => normalizeUsername(item)).filter(Boolean);
    return normalized.includes(normalizeUsername(user.username));
  };

  const fetchTagNotifications = async (user) => {
    if (!user) {
      return [];
    }

    const mapToChat = (rows) =>
      rows
        .filter((item) => !item.expires_at || new Date(item.expires_at).getTime() > Date.now())
        .filter((item) => isTaggedForUser(item, user))
        .map((item) => ({
          id: `tag:${item.id || `${item.created_at}|${item.title}`}`,
          kind: "tag",
          sender: item.from_name || "Anonim",
          message: `men-tag akunmu: "${item.title}" - ${unpackMessageText(item.message_text).slice(0, 180) || "(pesan kosong)"}`,
          created_at: item.created_at || new Date().toISOString()
        }));

    if (!cloudEnabled) {
      const localRows = readJson(LOCAL_SECRET_MESSAGES_KEY, []);
      return Array.isArray(localRows) ? mapToChat(localRows) : [];
    }

    try {
      const result = await authorizedFetch(
        "/rest/v1/secret_messages?select=id,title,from_name,message_text,created_at,expires_at&order=created_at.desc&limit=120"
      );
      const rows = result?.data;
      return Array.isArray(rows) ? mapToChat(rows) : [];
    } catch {
      const localRows = readJson(LOCAL_SECRET_MESSAGES_KEY, []);
      return Array.isArray(localRows) ? mapToChat(localRows) : [];
    }
  };

  const fetchReplyNotifications = async (user) => {
    if (!user) {
      return [];
    }

    const mapToChat = (rows) =>
      rows.map((item) => ({
        id: `reply:${item.id || `${item.created_at}|${item.user_name}`}`,
        kind: "reply",
        sender: item.user_name || "Anonim",
        message: `membalas komentarmu: "${String(item.content || "").slice(0, 180)}"`,
        created_at: item.created_at || new Date().toISOString()
      }));

    if (!cloudEnabled) {
      const commentsByMemorial = readJson("memoflix_memorial_comments_v1", {});
      const rows = [];
      Object.values(commentsByMemorial).forEach((list) => {
        if (!Array.isArray(list)) {
          return;
        }
        list.forEach((item) => {
          if (!item || typeof item !== "object") {
            return;
          }
          if (String(item.reply_to_user_id || "") === String(user.id || "")) {
            rows.push(item);
          }
        });
      });
      return mapToChat(rows);
    }

    try {
      const uid = encodeURIComponent(String(user.id || ""));
      const result = await authorizedFetch(
        `/rest/v1/memorial_comments?select=id,content,user_name,created_at,reply_to_user_id&reply_to_user_id=eq.${uid}&order=created_at.desc&limit=120`
      );
      const rows = result?.data;
      return Array.isArray(rows) ? mapToChat(rows) : [];
    } catch {
      return [];
    }
  };

  const fetchCommentLikeNotifications = async (user) => {
    if (!user) {
      return [];
    }

    const mapToChat = (rows) =>
      rows.map((item) => ({
        id: `comment-like:${item.id || `${item.created_at}|${item.user_name}`}`,
        kind: "comment-like",
        sender: item.user_name || "Anonim",
        message: `menyukai komentarmu: "${String(item.comment_excerpt || "").slice(0, 180)}"`,
        created_at: item.created_at || new Date().toISOString()
      }));

    if (!cloudEnabled) {
      const likesByComment = readJson("memoflix_memorial_comment_likes_v1", {});
      const rows = [];
      Object.values(likesByComment).forEach((list) => {
        if (!Array.isArray(list)) {
          return;
        }
        list.forEach((item) => {
          if (!item || typeof item !== "object") {
            return;
          }
          if (
            String(item.comment_owner_user_id || "") === String(user.id || "") &&
            String(item.user_ref || "") !== String(user.id || "")
          ) {
            rows.push(item);
          }
        });
      });
      return mapToChat(rows);
    }

    try {
      const uid = encodeURIComponent(String(user.id || ""));
      const result = await authorizedFetch(
        `/rest/v1/memorial_comment_likes?select=id,user_name,created_at,comment_excerpt,comment_owner_user_id,user_id&comment_owner_user_id=eq.${uid}&user_id=neq.${uid}&order=created_at.desc&limit=120`
      );
      const rows = result?.data;
      return Array.isArray(rows) ? mapToChat(rows) : [];
    } catch {
      return [];
    }
  };

  const fetchSystemAnnouncements = async () => {
    const mapToChat = (rows) =>
      rows.map((item) => {
        const title = String(item.title || "Update Website").trim();
        const section = String(item.section || "").trim();
        const by = String(item.created_by || "admin").trim();
        const details = String(item.message || "").trim();
        const sectionText = section ? ` [${section}]` : "";
        return {
          id: `sys:${item.id || `${item.created_at}|${title}`}`,
          kind: "system",
          sender: `Admin @${by}`,
          message: `${title}${sectionText}${details ? ` - ${details}` : ""}`,
          created_at: item.created_at || new Date().toISOString()
        };
      });
    const mapAndSortDedup = (rows) => {
      const mapped = mapToChat(Array.isArray(rows) ? rows : []);
      const byId = new Map();
      mapped.forEach((item) => {
        if (!item || !item.id) return;
        byId.set(item.id, item);
      });
      return [...byId.values()]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 200);
    };

    if (!cloudEnabled) {
      const localRows = readJson(LOCAL_SYSTEM_UPDATES_KEY, []);
      return mapAndSortDedup(localRows);
    }

    try {
      const result = await authorizedFetch(
        "/rest/v1/system_announcements?select=id,title,section,message,created_by,created_at&order=created_at.desc&limit=120"
      );
      const rows = result?.data;
      const localRows = readJson(LOCAL_SYSTEM_UPDATES_KEY, []);
      return mapAndSortDedup([...(Array.isArray(rows) ? rows : []), ...(Array.isArray(localRows) ? localRows : [])]);
    } catch {
      const localRows = readJson(LOCAL_SYSTEM_UPDATES_KEY, []);
      return mapAndSortDedup(localRows);
    }
  };

  const publishSystemAnnouncement = async ({ title, section, message, createdBy }) => {
    const payload = {
      title: String(title || "").trim() || "Update Website",
      section: String(section || "").trim() || null,
      message: String(message || "").trim(),
      created_by: normalizeUsername(createdBy) || "admin"
    };
    if (!payload.message) {
      throw new Error("Pesan update tidak boleh kosong.");
    }

    if (!cloudEnabled) {
      const list = readJson(LOCAL_SYSTEM_UPDATES_KEY, []);
      const next = Array.isArray(list) ? list : [];
      next.push({
        id: `local_${Date.now()}`,
        ...payload,
        created_at: new Date().toISOString()
      });
      saveJson(LOCAL_SYSTEM_UPDATES_KEY, next);
      return;
    }

    await authorizedFetch("/rest/v1/system_announcements", {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });
    // Keep local shadow history to avoid perceived "missing" old broadcasts.
    try {
      const list = readJson(LOCAL_SYSTEM_UPDATES_KEY, []);
      const next = Array.isArray(list) ? list : [];
      next.push({
        id: `shadow_${Date.now()}`,
        ...payload,
        created_at: new Date().toISOString()
      });
      saveJson(LOCAL_SYSTEM_UPDATES_KEY, next);
    } catch {
      // ignore local shadow failure
    }
  };

  const fetchAllNotifications = async (user) => {
    const [tagItems, replyItems, commentLikeItems, systemItems] = await Promise.all([
      fetchTagNotifications(user),
      fetchReplyNotifications(user),
      fetchCommentLikeNotifications(user),
      fetchSystemAnnouncements()
    ]);
    return [...tagItems, ...replyItems, ...commentLikeItems, ...systemItems]
      .filter((item) => item && item.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 200);
  };

  const getUnreadNotificationCount = async (user = getCurrentUser()) => {
    if (!user) {
      return 0;
    }
    const latestItems = await fetchAllNotifications(user);
    const seen = readSeenMapForUser(user);
    return latestItems.filter((item) => !seen.has(item.id)).length;
  };

  const markAllNotificationsSeen = async (user = getCurrentUser()) => {
    if (!user) {
      return 0;
    }
    const latestItems = await fetchAllNotifications(user);
    const seen = readSeenMapForUser(user);
    latestItems.forEach((item) => seen.add(item.id));
    writeSeenMapForUser(user, seen);
    return latestItems.length;
  };

  const renderSystemInfoWidget = () => {
    if (!document.body || document.getElementById("systemInfoWidget")) {
      return;
    }

    const widget = document.createElement("div");
    widget.className = "system-info-widget";
    widget.id = "systemInfoWidget";
    widget.innerHTML = `
      <button type="button" class="system-info-fab" id="systemInfoToggle">
        Notif Chat <span class="system-info-badge hidden" id="systemInfoBadge">0</span>
      </button>
      <div class="system-info-panel hidden" id="systemInfoPanel">
        <div class="system-info-head">
          <p>Notifikasi Chat</p>
          <button type="button" id="systemInfoClose">Tutup</button>
        </div>
        <div class="system-chat-feed" id="systemChatFeed"></div>
        <form class="system-admin-form hidden" id="systemAdminForm">
          <p class="system-admin-title">Siaran Pembaruan (Admin)</p>
          <input id="systemUpdateTitle" type="text" placeholder="Judul update (contoh: Patch v1.3)">
          <input id="systemUpdateSection" type="text" placeholder="Bagian (contoh: Pesan Rahasia)">
          <textarea id="systemUpdateMessage" rows="3" placeholder="Isi update website..."></textarea>
          <button type="submit">Kirim Update</button>
          <p class="system-admin-status" id="systemAdminStatus"></p>
        </form>
      </div>
    `;
    document.body.appendChild(widget);

    const toggleBtn = document.getElementById("systemInfoToggle");
    const closeBtn = document.getElementById("systemInfoClose");
    const panel = document.getElementById("systemInfoPanel");
    const badge = document.getElementById("systemInfoBadge");
    const feed = document.getElementById("systemChatFeed");
    const adminForm = document.getElementById("systemAdminForm");
    const adminStatus = document.getElementById("systemAdminStatus");
    const updateTitle = document.getElementById("systemUpdateTitle");
    const updateSection = document.getElementById("systemUpdateSection");
    const updateMessage = document.getElementById("systemUpdateMessage");

    let latestItems = [];
    let isPanelOpen = false;

    const markAllSeen = () => {
      const user = getCurrentUser();
      if (!user) {
        return;
      }
      const seen = readSeenMapForUser(user);
      latestItems.forEach((item) => seen.add(item.id));
      writeSeenMapForUser(user, seen);
      updateUnreadBadge();
    };

    const sortByDateAsc = (items) =>
      [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const renderChatFeed = () => {
      if (!feed) {
        return;
      }
      if (latestItems.length === 0) {
        feed.innerHTML = `<p class="system-chat-empty">Belum ada notifikasi.</p>`;
        return;
      }

      feed.innerHTML = sortByDateAsc(latestItems)
        .map((item) => {
          const ts = new Date(item.created_at).toLocaleString("id-ID");
          const roleClass = item.kind === "system" ? "from-system" : "from-user";
          return `
            <article class="system-chat-item ${roleClass}">
              <p class="system-chat-sender">${escapeHtml(item.sender)}</p>
              <p class="system-chat-text">${escapeHtml(item.message)}</p>
              <p class="system-chat-time">${escapeHtml(ts)}</p>
            </article>
          `;
        })
        .join("");
      feed.scrollTop = feed.scrollHeight;
    };

    const updateUnreadBadge = () => {
      const user = getCurrentUser();
      if (!badge || !user) {
        if (badge) {
          badge.classList.add("hidden");
        }
        return;
      }

      const seen = readSeenMapForUser(user);
      const unread = latestItems.filter((item) => !seen.has(item.id)).length;
      if (unread <= 0) {
        badge.classList.add("hidden");
        return;
      }
      badge.textContent = String(unread > 99 ? "99+" : unread);
      badge.classList.remove("hidden");
    };

    const updateAdminFormVisibility = async () => {
      const user = getCurrentUser();
      if (!adminForm || !user) {
        adminForm?.classList.add("hidden");
        return;
      }
      const profileFlags = await fetchMyProfileFlags();
      const isAdmin = Boolean(profileFlags.isAdmin || isAdminByConfig(user));
      adminForm.classList.toggle("hidden", !isAdmin);
    };

    const refreshNotifications = async () => {
      const user = getCurrentUser();
      const [tagItems, replyItems, commentLikeItems, systemItems] = await Promise.all([
        fetchTagNotifications(user),
        fetchReplyNotifications(user),
        fetchCommentLikeNotifications(user),
        fetchSystemAnnouncements()
      ]);
      latestItems = [...tagItems, ...replyItems, ...commentLikeItems, ...systemItems]
        .filter((item) => item && item.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 200);

      renderChatFeed();
      updateUnreadBadge();
      updateAdminFormVisibility();
      if (isPanelOpen) {
        markAllSeen();
      }
    };

    const openPanel = async () => {
      isPanelOpen = true;
      panel?.classList.remove("hidden");
      await refreshNotifications();
      markAllSeen();
    };

    const closePanel = () => {
      isPanelOpen = false;
      panel?.classList.add("hidden");
    };

    toggleBtn?.addEventListener("click", async () => {
      if (panel?.classList.contains("hidden")) {
        await openPanel();
      } else {
        closePanel();
      }
    });
    closeBtn?.addEventListener("click", closePanel);
    document.addEventListener("click", (event) => {
      if (!widget.contains(event.target)) {
        closePanel();
      }
    });

    adminForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = getCurrentUser();
      const profileFlags = await fetchMyProfileFlags();
      const isAdmin = Boolean(profileFlags.isAdmin || isAdminByConfig(user));
      if (!isAdmin) {
        if (adminStatus) {
          adminStatus.textContent = "Kamu bukan admin.";
        }
        return;
      }

      try {
        await publishSystemAnnouncement({
          title: updateTitle?.value,
          section: updateSection?.value,
          message: updateMessage?.value,
          createdBy: user?.username || "admin"
        });
        if (updateTitle) updateTitle.value = "";
        if (updateSection) updateSection.value = "";
        if (updateMessage) updateMessage.value = "";
        if (adminStatus) adminStatus.textContent = "Update berhasil dikirim.";
        await refreshNotifications();
      } catch (error) {
        if (adminStatus) {
          adminStatus.textContent = `Gagal kirim update: ${error.message}`;
        }
      }
    });

    refreshNotifications();
    setInterval(refreshNotifications, POLL_NOTIFY_MS);
  };

  const registerPwaServiceWorker = async () => {
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!("serviceWorker" in navigator) || (window.location.protocol !== "https:" && !isLocalhost)) {
      return;
    }
    try {
      await navigator.serviceWorker.register("/service-worker.js");
    } catch {
      // Ignore SW registration failure in unsupported hosting configs.
    }
  };

  const setGlobalBottomNavVisible = (visible) => {
    const nav = document.getElementById("globalBottomNav");
    if (!nav) {
      return;
    }
    nav.classList.toggle("hidden", !visible);
  };

  const getBottomNavActiveKey = () => {
    const path = window.location.pathname.split("/").pop() || "index.html";
    if (path === "secret-message.html") return "secret";
    if (path === "social.html") return "social";
    if (path === "notifications.html") return "notifications";
    if (path === "profile.html" || path === "login.html") return "profile";
    return "home";
  };

  const renderGlobalBottomNav = () => {
    if (!document.body || document.getElementById("globalBottomNav")) {
      return;
    }
    const path = window.location.pathname.split("/").pop() || "index.html";
    if (path === "login.html") {
      return;
    }

    const currentUser = getCurrentUser();
    const profileHref = currentUser ? "profile.html" : "login.html";
    const profileLabel = currentUser ? "Profil" : "Masuk";
    const activeKey = getBottomNavActiveKey();

    const nav = document.createElement("nav");
    nav.className = "modal-bottom-nav";
    nav.id = "globalBottomNav";
    nav.setAttribute("aria-label", "Navigasi global");
    nav.innerHTML = `
      <a class="modal-bottom-item${activeKey === "home" ? " is-active" : ""}" href="index.html" data-nav-key="home">
        <span>&#8962;</span>
        <small>Beranda</small>
      </a>
      <a class="modal-bottom-item${activeKey === "secret" ? " is-active" : ""}" href="secret-message.html" data-nav-key="secret">
        <span>&#9835;</span>
        <small>Kirim Lagu</small>
      </a>
      <a class="modal-bottom-item modal-bottom-social${activeKey === "social" ? " is-active" : ""}" href="social.html" data-nav-key="social">
        <span>&#9787;</span>
        <small>Sosial</small>
      </a>
      <a class="modal-bottom-item modal-bottom-notif${activeKey === "notifications" ? " is-active" : ""}" href="notifications.html" data-nav-key="notif">
        <span>&#128276;&#xFE0E;</span>
        <small>Notifikasi</small>
        <em class="modal-bottom-badge hidden" id="globalBottomNotifBadge">0</em>
      </a>
      <a class="modal-bottom-item${activeKey === "profile" ? " is-active" : ""}" href="${profileHref}" data-nav-key="profile">
        <span>&#9786;</span>
        <small>${profileLabel}</small>
      </a>
    `;
    document.body.appendChild(nav);

    const notifBadge = document.getElementById("globalBottomNotifBadge");

    const syncNotifBadge = async () => {
      if (!notifBadge) return;
      const user = getCurrentUser();
      if (!user) {
        notifBadge.classList.add("hidden");
        return;
      }
      const unread = await getUnreadNotificationCount(user);
      if (unread <= 0) {
        notifBadge.classList.add("hidden");
        return;
      }
      notifBadge.textContent = String(unread > 99 ? "99+" : unread);
      notifBadge.classList.remove("hidden");
    };

    syncNotifBadge();
    setInterval(syncNotifBadge, POLL_NOTIFY_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        syncNotifBadge();
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      renderGlobalBottomNav();
      registerPwaServiceWorker();
    });
  } else {
    renderGlobalBottomNav();
    registerPwaServiceWorker();
  }

  ensureSessionFresh().catch(() => {
    // keep existing session state when refresh transiently fails
  });
  setInterval(() => {
    ensureSessionFresh().catch(() => {
      // ignore background refresh failure
    });
  }, SESSION_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      ensureSessionFresh().catch(() => {
        // ignore foreground refresh failure
      });
    }
  });

  window.MemoflixAuth = {
    cloudEnabled,
    supabaseUrl,
    supabaseAnonKey,
    authHeaders,
    getSession,
    getCurrentUser,
    isUsernameAvailable,
    signUp,
    signIn,
    signOut,
    upsertProfile,
    updateMyProfile,
    ensureSessionFresh,
    authorizedFetch,
    clearSession,
    normalizeUsername,
    setGlobalBottomNavVisible,
    fetchAllNotifications,
    getUnreadNotificationCount,
    markAllNotificationsSeen,
    publishSystemAnnouncement,
    fetchMyProfileFlags
  };
})();
