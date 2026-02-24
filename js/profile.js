const auth = window.MemoflixAuth;

const profileName = document.getElementById("profileName");
const profileUsername = document.getElementById("profileUsername");
const profileEmail = document.getElementById("profileEmail");
const profileAvatarInitial = document.getElementById("profileAvatarInitial");
const profileMode = document.getElementById("profileMode");
const profileUid = document.getElementById("profileUid");
const profileJoined = document.getElementById("profileJoined");
const statComments = document.getElementById("statComments");
const statLikes = document.getElementById("statLikes");
const statMessages = document.getElementById("statMessages");
const refreshProfileBtn = document.getElementById("refreshProfileBtn");
const adminDashboardLink = document.getElementById("adminDashboardLink");
const logoutBtn = document.getElementById("logoutBtn");
const profileEditForm = document.getElementById("profileEditForm");
const editDisplayName = document.getElementById("editDisplayName");
const editUsername = document.getElementById("editUsername");
const profileEditStatus = document.getElementById("profileEditStatus");

const COMMENTS_KEY = "memoflix_memorial_comments_v1";
const LIKES_KEY = "memoflix_memorial_likes_v1";
const SECRET_MESSAGES_KEY = "memoflix_secret_messages_v1";
const SECRET_SENT_KEY = "memoflix_secret_sent_v1";
const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

const safeSetStats = (comments = "-", likes = "-", messages = "-") => {
  statComments.textContent = String(comments);
  statLikes.textContent = String(likes);
  statMessages.textContent = String(messages);
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const resolveUserRef = (user) => {
  if (!user) {
    return "";
  }
  return String(user.id || "").trim() || normalizeEmail(user.email);
};

const readLocalJson = (key, fallback) => {
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

const formatJoinDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
};

const isCommentByUser = (comment, currentUser) => {
  const userId = String(currentUser?.id || "").trim();
  const userEmail = normalizeEmail(currentUser?.email);
  if (!comment || typeof comment !== "object") {
    return false;
  }

  if (userId && String(comment.user_id || "").trim() === userId) {
    return true;
  }
  return normalizeEmail(comment.user_email) === userEmail;
};

const hasLocalLike = (entry, currentUser) => {
  const userRef = resolveUserRef(currentUser);
  const userEmail = normalizeEmail(currentUser?.email);
  if (typeof entry === "string") {
    return normalizeEmail(entry) === userEmail;
  }
  if (!entry || typeof entry !== "object") {
    return false;
  }
  return String(entry.user_ref || "") === userRef || normalizeEmail(entry.user_email) === userEmail;
};

const isSecretMessageByUser = (message, currentUser) => {
  const userId = String(currentUser?.id || "").trim();
  const userEmail = normalizeEmail(currentUser?.email);
  if (!message || typeof message !== "object") {
    return false;
  }

  if (userId && String(message.sender_user_id || "").trim() === userId) {
    return true;
  }

  const senderEmail = normalizeEmail(message.sender_user_email || message.sender_email);
  return senderEmail === userEmail;
};

const loadLocalStats = (currentUser) => {
  const allComments = readLocalJson(COMMENTS_KEY, {});
  const totalComments = Object.values(allComments).reduce((count, list) => {
    if (!Array.isArray(list)) {
      return count;
    }
    return count + list.filter((item) => isCommentByUser(item, currentUser)).length;
  }, 0);

  const allLikes = readLocalJson(LIKES_KEY, {});
  const totalLikes = Object.values(allLikes).reduce((count, list) => {
    if (!Array.isArray(list)) {
      return count;
    }
    return count + (list.some((entry) => hasLocalLike(entry, currentUser)) ? 1 : 0);
  }, 0);

  const secretMessages = readLocalJson(SECRET_MESSAGES_KEY, []);
  let totalMessages = 0;
  if (Array.isArray(secretMessages)) {
    totalMessages = secretMessages.filter((item) => isSecretMessageByUser(item, currentUser)).length;
  }

  if (totalMessages === 0) {
    const secretSentEvents = readLocalJson(SECRET_SENT_KEY, []);
    if (Array.isArray(secretSentEvents)) {
      const userRef = resolveUserRef(currentUser);
      const userEmail = normalizeEmail(currentUser?.email);
      totalMessages = secretSentEvents.filter((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        return (
          String(entry.sender_ref || "") === userRef ||
          String(entry.sender_user_id || "") === String(currentUser?.id || "") ||
          normalizeEmail(entry.sender_email) === userEmail
        );
      }).length;
    }
  }

  return {
    comments: totalComments,
    likes: totalLikes,
    messages: totalMessages
  };
};

const getCurrentUser = () => auth?.getCurrentUser?.();

const setEditStatus = (message) => {
  if (profileEditStatus) {
    profileEditStatus.textContent = String(message || "");
  }
};

const fillEditForm = (user) => {
  if (editDisplayName) {
    editDisplayName.value = String(user?.name || "").trim();
  }
  if (editUsername) {
    editUsername.value = String(user?.username || "").trim();
  }
};

const setProfileIdentity = () => {
  const currentUser = getCurrentUser();
  const session = auth?.getSession?.();

  if (profileName) {
    profileName.textContent = currentUser?.name || "-";
  }
  if (profileUsername) {
    profileUsername.textContent = currentUser?.username ? `@${currentUser.username}` : "@-";
  }
  if (profileEmail) {
    profileEmail.textContent = currentUser?.email || "-";
  }
  if (profileUid) {
    profileUid.textContent = currentUser?.id || "-";
  }
  if (profileMode) {
    profileMode.textContent = auth?.cloudEnabled ? "Cloud (Supabase)" : "Perangkat Lokal";
  }
  if (profileJoined) {
    profileJoined.textContent = formatJoinDate(session?.user?.created_at);
  }
  if (profileAvatarInitial) {
    const source = String(currentUser?.name || currentUser?.username || "M").trim();
    profileAvatarInitial.textContent = source ? source.charAt(0).toUpperCase() : "M";
  }
  fillEditForm(currentUser);
};

const apiGet = async (path) => {
  if (auth?.authorizedFetch) {
    const result = await auth.authorizedFetch(path, {
      headers: {
        Prefer: "count=exact"
      }
    });
    return Array.isArray(result?.data) ? result.data : [];
  }

  const session = auth?.getSession?.();
  const res = await fetch(`${auth.supabaseUrl}${path}`, {
    headers: {
      ...auth.authHeaders(session.access_token),
      Prefer: "count=exact"
    }
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(`Fetch gagal (${res.status})`);
  }
  return Array.isArray(data) ? data : [];
};

const loadCloudStats = async () => {
  const currentUser = getCurrentUser();
  const userId = encodeURIComponent(currentUser.id);
  const [comments, likes, messages] = await Promise.all([
    apiGet(`/rest/v1/memorial_comments?select=id&user_id=eq.${userId}`),
    apiGet(`/rest/v1/memorial_likes?select=id&user_id=eq.${userId}`),
    apiGet(`/rest/v1/secret_messages?select=id&sender_user_id=eq.${userId}`)
  ]);
  safeSetStats(comments.length, likes.length, messages.length);
};

const loadStats = async () => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  setProfileIdentity();

  const session = auth?.getSession?.();
  if (!auth?.cloudEnabled || !session?.access_token || !currentUser?.id) {
    const local = loadLocalStats(currentUser);
    safeSetStats(local.comments, local.likes, local.messages);
    return;
  }

  try {
    await loadCloudStats();
  } catch {
    const local = loadLocalStats(currentUser);
    safeSetStats(local.comments, local.likes, local.messages);
  }
};

const syncAdminAccess = async () => {
  if (!adminDashboardLink) {
    return;
  }
  const currentUser = getCurrentUser();
  const cfg = window.APP_CONFIG || {};
  const allowFromConfig = Array.isArray(cfg.ADMIN_USERNAMES)
    ? cfg.ADMIN_USERNAMES.map((item) => String(item || "").trim().toLowerCase())
    : [];
  const byConfig = allowFromConfig.includes(String(currentUser?.username || "").toLowerCase());
  let byProfileFlag = false;
  try {
    const flags = await auth?.fetchMyProfileFlags?.();
    byProfileFlag = Boolean(flags?.isAdmin);
  } catch {
    byProfileFlag = false;
  }
  adminDashboardLink.classList.toggle("hidden", !(byConfig || byProfileFlag));
};

profileEditForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }
  if (!auth?.cloudEnabled) {
    setEditStatus("Edit profile membutuhkan mode cloud Supabase.");
    return;
  }

  const nextDisplayName = String(editDisplayName?.value || "").trim();
  const nextUsername = auth?.normalizeUsername?.(editUsername?.value || "") || "";

  if (!nextDisplayName) {
    setEditStatus("Nama tampilan wajib diisi.");
    return;
  }
  if (!USERNAME_RE.test(nextUsername)) {
    setEditStatus("Username harus 3-24 karakter: huruf kecil, angka, titik, atau underscore.");
    return;
  }

  setEditStatus("Menyimpan profile...");

  try {
    const changedUsername = nextUsername !== String(currentUser.username || "").trim().toLowerCase();
    if (changedUsername) {
      const available = await auth?.isUsernameAvailable?.(nextUsername);
      if (!available) {
        throw new Error("Username sudah dipakai pengguna lain.");
      }
    }

    await auth?.updateMyProfile?.({
      displayName: nextDisplayName,
      username: nextUsername
    });

    setProfileIdentity();
    await loadStats();
    await syncAdminAccess();
    setEditStatus("Perubahan profile berhasil disimpan.");
  } catch (error) {
    setEditStatus(`Gagal simpan profile: ${error.message}`);
  }
});

refreshProfileBtn?.addEventListener("click", () => {
  safeSetStats("...", "...", "...");
  loadStats().catch(() => {
    safeSetStats("-", "-", "-");
  });
});

logoutBtn?.addEventListener("click", async () => {
  await auth?.signOut?.();
  window.location.href = "login.html";
});

if (!getCurrentUser()) {
  window.location.href = "login.html";
} else {
  loadStats().catch(() => {
    safeSetStats("-", "-", "-");
  });
  syncAdminAccess();
}
