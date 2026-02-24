const memorialDataEl = document.getElementById("memorialData");
const ADMIN_MEMORIALS_KEY = "memoflix_admin_memorials_v1";
const parseBaseMemorialPhotos = () => {
  try {
    const parsed = JSON.parse(memorialDataEl?.textContent || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const normalizeMemorialItem = (item) => {
  if (!item || typeof item !== "object") return null;
  const normalized = {
    id: String(item.id || ""),
    title: String(item.title || "").trim(),
    year: String(item.year || "").trim(),
    short: String(item.short || "").trim(),
    cover: String(item.cover || "").trim(),
    story: String(item.story || "").trim(),
    gallery: Array.isArray(item.gallery) ? item.gallery : []
  };
  if (!normalized.title || !normalized.year || !normalized.cover || !normalized.story) {
    return null;
  }
  return normalized;
};
const loadAdminMemorialsLocal = () => {
  try {
    const raw = localStorage.getItem(ADMIN_MEMORIALS_KEY);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => normalizeMemorialItem(item)).filter(Boolean);
  } catch {
    return [];
  }
};
let memorialPhotos = [
  ...parseBaseMemorialPhotos().map((item) => normalizeMemorialItem(item)).filter(Boolean),
  ...loadAdminMemorialsLocal()
];

const photoGrid = document.getElementById("photoGrid");
const popularGrid = document.getElementById("popularGrid");
const timelineList = document.getElementById("timelineList");
const storyModal = document.getElementById("storyModal");
const modalPanel = document.getElementById("modalPanel");
const modalPhoto = document.getElementById("modalPhoto");
const modalPhotoVideo = document.getElementById("modalPhotoVideo");
const mediaPlayBtn = document.getElementById("mediaPlayBtn");
const mediaPrevBtn = document.getElementById("mediaPrevBtn");
const mediaNextBtn = document.getElementById("mediaNextBtn");
const mediaCounter = document.getElementById("mediaCounter");
const modalTitle = document.getElementById("modalTitle");
const modalMeta = document.getElementById("modalMeta");
const modalStory = document.getElementById("modalStory");
const modalGallery = document.getElementById("modalGallery");
const modalContent = document.querySelector(".modal-content");
const closeModalTop = document.getElementById("closeModalTop");
const closeFullscreenBtn = document.getElementById("closeFullscreenBtn");
const navLinks = [...document.querySelectorAll(".nav-link")];
const AUTO_SLIDE_MS = 2800;
const HERO_SLIDE_MS = 3500;
const heroSection = document.querySelector(".hero");
const commentList = document.getElementById("commentList");
const commentForm = document.getElementById("commentForm");
const commentInput = document.getElementById("commentInput");
const commentSubmitBtn = commentForm?.querySelector('button[type="submit"]');
const commentReplying = document.getElementById("commentReplying");
const commentReplyingText = document.getElementById("commentReplyingText");
const cancelReplyBtn = document.getElementById("cancelReplyBtn");
const commentLoginHint = document.getElementById("commentLoginHint");
const likeMemorialBtns = [...document.querySelectorAll('[data-role="like-memorial"]')];
const openCommentsPeekBtns = [...document.querySelectorAll('[data-role="open-comments"]')];
const readStoryBtn = document.getElementById("readStoryBtn");
const coverPanel = document.getElementById("coverPanel");
const readerPanel = document.getElementById("readerPanel");
const modalStoryIntro = document.getElementById("modalStoryIntro");
const readerProgress = document.getElementById("readerProgress");
const readerPrevBtn = document.getElementById("readerPrevBtn");
const readerNextBtn = document.getElementById("readerNextBtn");
const readerEnding = document.getElementById("readerEnding");
const readerSuggestions = document.getElementById("readerSuggestions");
const nextEpisodePeek = document.getElementById("nextEpisodePeek");
const nextEpisodeGrid = document.getElementById("nextEpisodeGrid");
const commentsPeek = document.getElementById("commentsPeek");
const closeCommentsPeekBtn = document.getElementById("closeCommentsPeek");
const loginLink = document.getElementById("loginLink");
const auth = window.MemoflixAuth || {};
const cloudEnabled = Boolean(auth.cloudEnabled);
const COMMENTS_KEY = "memoflix_memorial_comments_v1";
const LIKES_KEY = "memoflix_memorial_likes_v1";
const COMMENT_LIKES_KEY = "memoflix_memorial_comment_likes_v1";

const monthOrder = {
  Januari: 0,
  Februari: 1,
  Maret: 2,
  April: 3,
  Mei: 4,
  Juni: 5,
  Juli: 6,
  Agustus: 7,
  September: 8,
  Oktober: 9,
  November: 10,
  Desember: 11
};

let currentGallery = [];
let currentImageIndex = 0;
let autoSlideTimer = null;
let cinemaEligible = false;
let heroSlideTimer = null;
let currentMemorialKey = "";
let activeMemorialItem = null;
let storySlides = [];
let currentStorySlideIndex = 0;
let currentReplyTarget = null;
let commentLikeSummaryById = {};
let pageScrollY = 0;
let floatingFadeTimer = null;
let popularRefreshToken = 0;
let mediaCounterHideTimer = null;

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;
const isVideoUrl = (url) => VIDEO_EXT_RE.test(String(url || "").trim());
const toSafeUrl = (value) => String(value || "").trim();
const toCssUrl = (value) => {
  const safe = toSafeUrl(value);
  if (!safe) return "none";
  return `url('${encodeURI(safe).replace(/'/g, "%27")}')`;
};

const photoFloating = document.createElement("div");
photoFloating.className = "photo-floating";
document.body.appendChild(photoFloating);

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getCoverUrl = (item) => {
  if (!item) return "";
  if (typeof item.cover === "string") {
    return toSafeUrl(item.cover);
  }
  if (item.cover && typeof item.cover === "object") {
    return toSafeUrl(item.cover.poster || item.cover.thumb || item.cover.src);
  }
  return "";
};

const normalizeMediaEntry = (entry, fallbackCover = "") => {
  const fallback = toSafeUrl(fallbackCover);
  if (typeof entry === "string") {
    const src = toSafeUrl(entry);
    if (!src) return null;
    if (isVideoUrl(src)) {
      return { type: "video", src, poster: fallback || "", thumb: fallback || src };
    }
    return { type: "image", src, poster: src, thumb: src };
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const rawType = String(entry.type || "").toLowerCase();
  const src = toSafeUrl(entry.src || entry.url || "");
  if (!src) return null;
  const type = rawType === "video" || isVideoUrl(src) ? "video" : "image";
  const poster = toSafeUrl(entry.poster || entry.thumb || (type === "video" ? fallback : src));
  return {
    type,
    src,
    poster: poster || src,
    thumb: toSafeUrl(entry.thumb || poster || src)
  };
};

const toMemorialKey = (item) => {
  const base = `${item.title || ""}-${item.year || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "memorial-item";
};

const parseLocalDate = (label) => {
  const [monthName, year] = label.split(" ");
  return new Date(Number(year), monthOrder[monthName] ?? 0, 1).getTime();
};

const setModalImage = (index = 0) => {
  if (currentGallery.length === 0) {
    return;
  }

  currentImageIndex = Math.max(0, Math.min(index, currentGallery.length - 1));
  const media = currentGallery[currentImageIndex];
  const isVideo = media?.type === "video";
  const coverForBg = toSafeUrl(media?.poster || media?.thumb || media?.src);

  if (coverForBg) {
    modalPanel.style.setProperty("--story-bg", `url('${coverForBg}')`);
  }

  if (isVideo) {
    if (modalPhotoVideo) {
      modalPhotoVideo.src = toSafeUrl(media?.src);
      modalPhotoVideo.poster = toSafeUrl(media?.poster || "");
      modalPhotoVideo.classList.remove("hidden");
      modalPhotoVideo.pause();
      try {
        modalPhotoVideo.currentTime = 0;
      } catch {
        // Ignore seek failure on not-ready media.
      }
    }
    mediaPlayBtn?.classList.remove("hidden");
    modalPhoto.classList.remove("is-video-playing");
    modalPhoto.style.backgroundImage = coverForBg ? `url('${coverForBg}')` : "none";
    photoFloating.classList.remove("show", "faded");
  } else {
    if (modalPhotoVideo) {
      modalPhotoVideo.pause();
      modalPhotoVideo.removeAttribute("src");
      modalPhotoVideo.load();
      modalPhotoVideo.classList.add("hidden");
    }
    mediaPlayBtn?.classList.add("hidden");
    modalPhoto.classList.remove("is-video-playing");
    const imageSrc = toSafeUrl(media?.src);
    modalPhoto.style.backgroundImage = imageSrc ? `url('${imageSrc}')` : "none";
    if (imageSrc) {
      photoFloating.style.backgroundImage = `url('${imageSrc}')`;
    }
  }

  const thumbs = [...modalGallery.querySelectorAll(".modal-thumb")];
  thumbs.forEach((thumb, thumbIndex) => {
    thumb.classList.toggle("active", thumbIndex === currentImageIndex);
  });

  if (mediaCounter) {
    mediaCounter.textContent = `${currentImageIndex + 1} / ${currentGallery.length || 1}`;
    mediaCounter.classList.add("show");
    if (mediaCounterHideTimer) {
      clearTimeout(mediaCounterHideTimer);
    }
    mediaCounterHideTimer = setTimeout(() => {
      mediaCounter?.classList.remove("show");
    }, 2500);
  }
};

const showFloatingPhoto = () => {
  const media = currentGallery[currentImageIndex];
  if (media?.type === "video") {
    photoFloating.classList.remove("show", "faded");
    return;
  }
  if (!isPhotoFullscreen()) {
    photoFloating.classList.remove("show", "faded");
    return;
  }

  photoFloating.classList.add("show");
  photoFloating.classList.remove("faded");
  if (floatingFadeTimer) {
    clearTimeout(floatingFadeTimer);
  }
  floatingFadeTimer = setTimeout(() => {
    photoFloating.classList.add("faded");
  }, 1500);
};

const isPhotoFullscreen = () =>
  document.fullscreenElement === modalPhoto ||
  document.webkitFullscreenElement === modalPhoto ||
  document.fullscreenElement === modalPhotoVideo ||
  document.webkitFullscreenElement === modalPhotoVideo;

const exitPhotoFullscreen = async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } catch {
    // Ignore exit fullscreen rejection.
  }
};

const startHeroCoverSlide = () => {
  if (!heroSection) {
    return;
  }

  const heroCovers = memorialPhotos
    .map((item) => getCoverUrl(item))
    .filter((url) => typeof url === "string" && url.trim().length > 0);

  if (heroCovers.length === 0) {
    return;
  }

  let heroIndex = 0;
  heroSection.style.setProperty("--hero-image", toCssUrl(heroCovers[heroIndex]));

  if (heroSlideTimer) {
    clearInterval(heroSlideTimer);
    heroSlideTimer = null;
  }

  if (heroCovers.length === 1) {
    return;
  }

  heroSlideTimer = setInterval(() => {
    heroIndex = (heroIndex + 1) % heroCovers.length;
    heroSection.style.setProperty("--hero-image", toCssUrl(heroCovers[heroIndex]));
  }, HERO_SLIDE_MS);
};

// Initialize hero early so it still appears even if later modules throw.
startHeroCoverSlide();

const updateCinemaMode = () => {
  if (!cinemaEligible) {
    storyModal.classList.remove("cinema-mode");
    return;
  }

  const shouldEnable = modalContent.scrollTop > 70;
  storyModal.classList.toggle("cinema-mode", shouldEnable);
};

const updateNextEpisodeVisibility = () => {
  if (!nextEpisodePeek || nextEpisodePeek.classList.contains("hidden")) {
    return;
  }
  const isMobile = window.matchMedia("(max-width: 740px)").matches;
  const triggerOffset = isMobile ? 140 : 220;
  const reachedBottom =
    modalContent.scrollTop + modalContent.clientHeight >= modalContent.scrollHeight - triggerOffset;
  nextEpisodePeek.classList.toggle("is-visible", reachedBottom);
};

const stopAutoSlide = () => {
  if (autoSlideTimer) {
    clearInterval(autoSlideTimer);
    autoSlideTimer = null;
  }
};

const startAutoSlide = () => {
  // Auto-slide disabled: navigation is manual via arrow buttons.
  stopAutoSlide();
  return;
};

const lockPageScroll = () => {
  pageScrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";
};

const unlockPageScroll = () => {
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.touchAction = "";
  requestAnimationFrame(() => {
    const currentY = window.scrollY || window.pageYOffset || 0;
    if (Math.abs(currentY - pageScrollY) > 2) {
      window.scrollTo(0, pageScrollY);
    }
  });
};

const renderModalGallery = () => {
  modalGallery.innerHTML = "";
  currentGallery.forEach((media, index) => {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "modal-thumb";
    const isVideo = media?.type === "video";
    thumb.setAttribute("aria-label", `Pilih ${isVideo ? "video" : "foto"} ${index + 1}`);
    thumb.innerHTML = `
      <img src="${toSafeUrl(media?.thumb || media?.poster || media?.src)}" alt="Pilihan ${isVideo ? "video" : "foto"} ${index + 1}">
      ${isVideo ? '<span class="modal-thumb-badge">Video</span>' : ""}
    `;
    thumb.addEventListener("click", () => {
      setModalImage(index);
    });
    modalGallery.appendChild(thumb);
  });
};

const showPrevMedia = () => {
  if (!currentGallery.length) {
    return;
  }
  const prevIndex = (currentImageIndex - 1 + currentGallery.length) % currentGallery.length;
  setModalImage(prevIndex);
};

const showNextMedia = () => {
  if (!currentGallery.length) {
    return;
  }
  const nextIndex = (currentImageIndex + 1) % currentGallery.length;
  setModalImage(nextIndex);
};

const setCommentUiState = () => {
  const currentUser = getCurrentUser();
  const canComment = Boolean(currentUser);

  if (commentInput) {
    commentInput.disabled = !canComment;
    commentInput.placeholder = canComment
      ? "Tulis komentar untuk memorial ini..."
      : "Masuk dulu untuk menulis komentar.";
  }

  if (commentSubmitBtn) {
    commentSubmitBtn.disabled = !canComment;
    commentSubmitBtn.style.opacity = canComment ? "1" : "0.6";
    commentSubmitBtn.style.cursor = canComment ? "pointer" : "not-allowed";
  }

  if (commentLoginHint) {
    commentLoginHint.textContent = canComment
      ? `Masuk sebagai ${currentUser.name}`
      : "Masuk untuk berkomentar";
    commentLoginHint.href = canComment ? "profile.html" : "login.html";
  }

  if (loginLink) {
    loginLink.textContent = canComment ? "Profil" : "Masuk";
    loginLink.href = canComment ? "profile.html" : "login.html";
  }
};

const loadLocalComments = () => {
  try {
    const raw = localStorage.getItem(COMMENTS_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveLocalComments = (data) => {
  localStorage.setItem(COMMENTS_KEY, JSON.stringify(data));
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const resolveUserRef = (user) => {
  if (!user) {
    return "";
  }
  return String(user.id || "").trim() || normalizeEmail(user.email);
};

const loadLikes = () => {
  try {
    const raw = localStorage.getItem(LIKES_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveLikes = (data) => {
  localStorage.setItem(LIKES_KEY, JSON.stringify(data));
};

const loadCommentLikes = () => {
  try {
    const raw = localStorage.getItem(COMMENT_LIKES_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveCommentLikes = (data) => {
  localStorage.setItem(COMMENT_LIKES_KEY, JSON.stringify(data));
};

const getCommentStableId = (comment) =>
  String(
    comment?.id ||
      `c_${comment?.created_at || ""}_${comment?.user_id || comment?.user_name || ""}_${comment?.content || ""}`
  );

const hasLocalLike = (entries, currentUser) => {
  const userRef = resolveUserRef(currentUser);
  const email = normalizeEmail(currentUser?.email);
  return entries.some((entry) => {
    if (typeof entry === "string") {
      return normalizeEmail(entry) === email;
    }
    if (!entry || typeof entry !== "object") {
      return false;
    }
    return String(entry.user_ref || "") === userRef || normalizeEmail(entry.user_email) === email;
  });
};

const toggleLocalLike = (entries, currentUser) => {
  const userRef = resolveUserRef(currentUser);
  const email = normalizeEmail(currentUser?.email);
  const next = entries.filter((entry) => {
    if (typeof entry === "string") {
      return normalizeEmail(entry) !== email;
    }
    if (!entry || typeof entry !== "object") {
      return true;
    }
    const sameUserRef = String(entry.user_ref || "") === userRef;
    const sameEmail = normalizeEmail(entry.user_email) === email;
    return !(sameUserRef || sameEmail);
  });

  if (next.length === entries.length) {
    next.push({
      user_ref: userRef,
      user_email: email,
      created_at: new Date().toISOString()
    });
  }

  return next;
};

const getAccessToken = () => auth.getSession?.()?.access_token || "";

const restRequest = async (path, options = {}) => {
  if (!cloudEnabled || !auth.supabaseUrl) {
    throw new Error("Cloud belum aktif");
  }

  if (auth.authorizedFetch) {
    const result = await auth.authorizedFetch(path, options);
    return result?.data ?? null;
  }

  const res = await fetch(`${auth.supabaseUrl}${path}`, {
    ...options,
    headers: {
      ...(auth.authHeaders ? auth.authHeaders(getAccessToken()) : {}),
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
  if (!res.ok) throw new Error(`Request gagal (${res.status})`);
  return data;
};

const getCurrentUser = () => {
  return auth.getCurrentUser ? auth.getCurrentUser() : null;
};

const updateLikeButtonState = async () => {
  if (likeMemorialBtns.length === 0 || !currentMemorialKey) {
    return;
  }

  const setLikeUi = (hasLiked, isLogin = true) => {
    likeMemorialBtns.forEach((button) => {
      button.textContent = !isLogin ? "Suka (Masuk dulu)" : hasLiked ? "Disukai" : "Suka";
      button.classList.toggle("is-active", Boolean(hasLiked));
      button.setAttribute("aria-pressed", hasLiked ? "true" : "false");
    });
  };

  const currentUser = getCurrentUser();
  if (!currentUser) {
    setLikeUi(false, false);
    return;
  }

  if (cloudEnabled && getAccessToken() && currentUser.id) {
    try {
      const key = encodeURIComponent(currentMemorialKey);
      const uid = encodeURIComponent(currentUser.id);
      const rows = await restRequest(
        `/rest/v1/memorial_likes?select=id&memorial_key=eq.${key}&user_id=eq.${uid}&limit=1`
      );
      const hasLiked = Array.isArray(rows) && rows.length > 0;
      setLikeUi(hasLiked, true);
      return;
    } catch {
      // fallback local below
    }
  }

  const likes = loadLikes();
  const likedBy = Array.isArray(likes[currentMemorialKey]) ? likes[currentMemorialKey] : [];
  setLikeUi(hasLocalLike(likedBy, currentUser), true);
};

const renderComments = (comments) => {
  if (!commentList) {
    return;
  }

  commentList.innerHTML = "";
  if (!comments || comments.length === 0) {
    commentList.innerHTML = '<div class="comment-item"><p class="comment-text">Belum ada komentar.</p></div>';
    return;
  }

  const byParent = {};
  const roots = [];
  comments.forEach((comment) => {
    const parentId = String(comment.reply_to_comment_id || "");
    if (!parentId) {
      roots.push(comment);
      return;
    }
    if (!Array.isArray(byParent[parentId])) {
      byParent[parentId] = [];
    }
    byParent[parentId].push(comment);
  });

  const renderItem = (comment, depth = 0) => {
    const commentId = getCommentStableId(comment);
    const summary = commentLikeSummaryById[commentId] || { count: 0, likedByMe: false };
    const created = new Date(comment.created_at || Date.now()).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
    const userLabel = comment.user_name || "Anonim";
    const item = document.createElement("article");
    item.className = `comment-item${depth > 0 ? " is-reply" : ""}`;
    const replyInfo = comment.reply_to_user_name
      ? `<p class="comment-meta">Reply ke ${escapeHtml(comment.reply_to_user_name)}</p>`
      : "";
    item.innerHTML = `
      <p class="comment-meta">${escapeHtml(userLabel)} - ${created}</p>
      ${replyInfo}
      <p class="comment-text">${escapeHtml(comment.content)}</p>
      <div class="comment-actions">
        <button class="comment-action" type="button">Reply</button>
        <button class="comment-action${summary.likedByMe ? " is-active" : ""}" type="button" data-role="comment-like">&#10084; ${summary.count}</button>
      </div>
    `;

    const replyBtn = item.querySelector(".comment-action");
    const likeBtn = item.querySelector('[data-role="comment-like"]');
    replyBtn?.addEventListener("click", () => {
      currentReplyTarget = {
        commentId: comment.id || null,
        userId: comment.user_id || null,
        userName: comment.user_name || "Anonim"
      };
      if (commentReplyingText) {
        commentReplyingText.textContent = `Membalas ${currentReplyTarget.userName}`;
      }
      commentReplying?.classList.remove("hidden");
      commentInput?.focus();
    });

    likeBtn?.addEventListener("click", async () => {
      await toggleCommentLike(comment);
    });

    commentList.appendChild(item);
    const children = byParent[String(comment.id || "")] || [];
    children.forEach((child) => renderItem(child, depth + 1));
  };

  roots.forEach((comment) => renderItem(comment, 0));
};

const fetchComments = async (memorialKey) => {
  if (!memorialKey) {
    commentLikeSummaryById = {};
    renderComments([]);
    return;
  }

  const setLocalCommentLikeSummary = (comments) => {
    const map = {};
    const likesStore = loadCommentLikes();
    const currentUser = getCurrentUser();
    comments.forEach((comment) => {
      const id = getCommentStableId(comment);
      const entries = Array.isArray(likesStore[id]) ? likesStore[id] : [];
      map[id] = {
        count: countLocalLikes(entries),
        likedByMe: currentUser ? hasLocalLike(entries, currentUser) : false
      };
    });
    commentLikeSummaryById = map;
  };

  if (cloudEnabled) {
    try {
      const key = encodeURIComponent(memorialKey);
      try {
        const rows = await restRequest(
          `/rest/v1/memorial_comments?select=id,content,user_name,created_at,user_id,reply_to_comment_id,reply_to_user_id,reply_to_user_name&memorial_key=eq.${key}&order=created_at.desc`
        );
        const comments = Array.isArray(rows) ? rows : [];
        try {
          const likeRows = await restRequest(
            `/rest/v1/memorial_comment_likes?select=comment_id,user_id&memorial_key=eq.${key}`
          );
          const currentUser = getCurrentUser();
          const map = {};
          comments.forEach((comment) => {
            const id = getCommentStableId(comment);
            map[id] = { count: 0, likedByMe: false };
          });
          if (Array.isArray(likeRows)) {
            likeRows.forEach((row) => {
              const cid = String(row?.comment_id || "");
              if (!cid) return;
              if (!map[cid]) {
                map[cid] = { count: 0, likedByMe: false };
              }
              map[cid].count += 1;
              if (currentUser?.id && String(row.user_id || "") === String(currentUser.id)) {
                map[cid].likedByMe = true;
              }
            });
          }
          commentLikeSummaryById = map;
        } catch {
          setLocalCommentLikeSummary(comments);
        }
        renderComments(comments);
      } catch {
        const rows = await restRequest(
          `/rest/v1/memorial_comments?select=id,content,user_name,created_at,user_id&memorial_key=eq.${key}&order=created_at.desc`
        );
        const comments = Array.isArray(rows) ? rows : [];
        setLocalCommentLikeSummary(comments);
        renderComments(comments);
      }
      return;
    } catch {
      // fallback local below
    }
  }

  const all = loadLocalComments();
  const comments = Array.isArray(all[memorialKey]) ? all[memorialKey] : [];
  setLocalCommentLikeSummary(comments);
  renderComments(comments.slice().reverse());
};

const countLocalLikes = (entries) => {
  if (!Array.isArray(entries)) {
    return 0;
  }
  const uniq = new Set();
  entries.forEach((entry) => {
    if (typeof entry === "string") {
      uniq.add(`mail:${normalizeEmail(entry)}`);
      return;
    }
    if (!entry || typeof entry !== "object") {
      return;
    }
    const ref = String(entry.user_ref || "").trim();
    const email = normalizeEmail(entry.user_email);
    if (ref) {
      uniq.add(`ref:${ref}`);
    } else if (email) {
      uniq.add(`mail:${email}`);
    }
  });
  return uniq.size;
};

const buildLocalPopularityMap = () => {
  const likes = loadLikes();
  const comments = loadLocalComments();
  const map = {};
  memorialPhotos.forEach((item) => {
    const key = toMemorialKey(item);
    const likeCount = countLocalLikes(likes[key]);
    const commentCount = Array.isArray(comments[key]) ? comments[key].length : 0;
    map[key] = { likes: likeCount, comments: commentCount };
  });
  return map;
};

const toggleCommentLike = async (comment) => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  const commentId = getCommentStableId(comment);
  const ownerUserId = String(comment?.user_id || "").trim() || null;
  const ownerUserName = String(comment?.user_name || "").trim() || null;

  if (cloudEnabled && getAccessToken() && currentUser.id && comment?.id) {
    try {
      const cid = encodeURIComponent(String(comment.id));
      const uid = encodeURIComponent(String(currentUser.id));
      const existing = await restRequest(
        `/rest/v1/memorial_comment_likes?select=id&comment_id=eq.${cid}&user_id=eq.${uid}&limit=1`
      );
      if (Array.isArray(existing) && existing.length > 0) {
        await restRequest(
          `/rest/v1/memorial_comment_likes?comment_id=eq.${cid}&user_id=eq.${uid}`,
          { method: "DELETE" }
        );
      } else {
        const payload = {
          memorial_key: currentMemorialKey,
          comment_id: String(comment.id),
          user_id: currentUser.id,
          user_name: currentUser.name,
          comment_owner_user_id: ownerUserId,
          comment_owner_user_name: ownerUserName,
          comment_excerpt: String(comment?.content || "").slice(0, 180)
        };
        try {
          await restRequest("/rest/v1/memorial_comment_likes", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify(payload)
          });
        } catch (error) {
          const msg = String(error?.message || "");
          const missingColumns =
            msg.includes("comment_owner_user_id") ||
            msg.includes("comment_owner_user_name") ||
            msg.includes("comment_excerpt");
          if (!missingColumns) {
            throw error;
          }
          await restRequest("/rest/v1/memorial_comment_likes", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              memorial_key: currentMemorialKey,
              comment_id: String(comment.id),
              user_id: currentUser.id,
              user_name: currentUser.name
            })
          });
        }
      }
      await fetchComments(currentMemorialKey);
      return;
    } catch {
      // fallback local below
    }
  }

  const store = loadCommentLikes();
  if (!Array.isArray(store[commentId])) {
    store[commentId] = [];
  }
  store[commentId] = toggleLocalLike(store[commentId], currentUser);
  // Enrich latest record for local notifications
  const last = store[commentId][store[commentId].length - 1];
  if (last && typeof last === "object") {
    last.comment_owner_user_id = ownerUserId;
    last.comment_owner_user_name = ownerUserName;
    last.comment_excerpt = String(comment?.content || "").slice(0, 180);
    last.memorial_key = currentMemorialKey;
    last.user_name = currentUser.name;
  }
  saveCommentLikes(store);
  await fetchComments(currentMemorialKey);
};

const buildCloudPopularityMap = async () => {
  const likesRows = await restRequest("/rest/v1/memorial_likes?select=memorial_key");
  const commentRows = await restRequest("/rest/v1/memorial_comments?select=memorial_key");
  const map = {};

  const ensure = (key) => {
    if (!map[key]) {
      map[key] = { likes: 0, comments: 0 };
    }
    return map[key];
  };

  if (Array.isArray(likesRows)) {
    likesRows.forEach((row) => {
      const key = String(row?.memorial_key || "");
      if (!key) return;
      ensure(key).likes += 1;
    });
  }

  if (Array.isArray(commentRows)) {
    commentRows.forEach((row) => {
      const key = String(row?.memorial_key || "");
      if (!key) return;
      ensure(key).comments += 1;
    });
  }

  memorialPhotos.forEach((item) => {
    ensure(toMemorialKey(item));
  });
  return map;
};

const createPopularCard = (item, stats, index) => {
  const button = createCard(item, index);
  const likes = Number(stats?.likes || 0);
  const comments = Number(stats?.comments || 0);
  const score = likes * 3 + comments * 2;
  const meta = document.createElement("p");
  meta.className = "popular-meta";
  meta.textContent = `Score ${score} - ${likes} like - ${comments} komentar`;
  button.querySelector(".card-copy")?.appendChild(meta);
  return button;
};

const renderPopularMemorials = async () => {
  if (!popularGrid) {
    return;
  }

  const token = ++popularRefreshToken;
  let statsMap = buildLocalPopularityMap();

  if (cloudEnabled) {
    try {
      statsMap = await buildCloudPopularityMap();
    } catch {
      // Keep local fallback map.
    }
  }

  if (token !== popularRefreshToken) {
    return;
  }

  const ranked = memorialPhotos
    .map((item, index) => {
      const key = toMemorialKey(item);
      const stats = statsMap[key] || { likes: 0, comments: 0 };
      const score = stats.likes * 3 + stats.comments * 2;
      return { item, stats, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  popularGrid.innerHTML = "";
  const topScore = ranked.length > 0 ? ranked[0].score : 0;
  if (topScore <= 0) {
    popularGrid.innerHTML = `
      <article class="message-card">
        <p class="message-meta">Belum ada memorial populer.</p>
      </article>
    `;
    return;
  }

  const mostPopular = ranked.filter((row) => row.score === topScore);
  mostPopular.forEach(({ item, stats, index }) => {
    popularGrid.appendChild(createPopularCard(item, stats, index));
  });
};

const renderPeekPopularSuggestions = async (currentItem) => {
  if (!peekPopularGrid) {
    return;
  }

  const token = ++peekPopularRefreshToken;
  peekPopularGrid.innerHTML = `
    <article class="message-card">
      <p class="message-meta">Memuat rekomendasi...</p>
    </article>
  `;

  let statsMap = buildLocalPopularityMap();
  if (cloudEnabled) {
    try {
      statsMap = await buildCloudPopularityMap();
    } catch {
      // fallback local map
    }
  }

  if (token !== peekPopularRefreshToken) {
    return;
  }

  const currentKey = toMemorialKey(currentItem);
  const ranked = memorialPhotos
    .filter((item) => toMemorialKey(item) !== currentKey)
    .map((item, index) => {
      const key = toMemorialKey(item);
      const stats = statsMap[key] || { likes: 0, comments: 0 };
      const score = stats.likes * 3 + stats.comments * 2;
      return { item, stats, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const withScore = ranked.filter((entry) => entry.score > 0);
  const picks = (withScore.length > 0 ? withScore : ranked).slice(0, 6);

  peekPopularGrid.innerHTML = "";
  if (picks.length === 0) {
    peekPopularGrid.innerHTML = `
      <article class="message-card">
        <p class="message-meta">Belum ada rekomendasi populer.</p>
      </article>
    `;
    return;
  }

  picks.forEach(({ item, stats }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-suggestion-card peek-suggestion-card";
    btn.innerHTML = `
      <img src="${getCoverUrl(item)}" alt="${escapeHtml(item.title)}">
      <p>${escapeHtml(item.title)}</p>
      <span class="peek-suggestion-meta">${Number(stats.likes || 0)} like � ${Number(stats.comments || 0)} komentar</span>
    `;
    btn.addEventListener("click", () => {
      openStory(item);
      modalContent.scrollTop = 0;
    });
    peekPopularGrid.appendChild(btn);
  });
};

const splitStorySlides = (storyHtml) => {
  const chunkParagraph = (paragraph, maxChars = 360) => {
    const clean = String(paragraph || "").trim();
    if (!clean) {
      return [];
    }
    if (clean.length <= maxChars) {
      return [clean];
    }

    const sentenceParts = clean.match(/[^.!?]+[.!?]?/g) || [clean];
    const chunks = [];
    let current = "";

    sentenceParts.forEach((sentenceRaw) => {
      const sentence = sentenceRaw.trim();
      if (!sentence) {
        return;
      }
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxChars) {
        current = candidate;
        return;
      }
      if (current) {
        chunks.push(current);
      }
      if (sentence.length <= maxChars) {
        current = sentence;
        return;
      }
      let offset = 0;
      while (offset < sentence.length) {
        chunks.push(sentence.slice(offset, offset + maxChars).trim());
        offset += maxChars;
      }
      current = "";
    });

    if (current) {
      chunks.push(current);
    }
    return chunks.filter(Boolean);
  };

  const text = String(storyHtml || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) {
    return [];
  }
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => chunkParagraph(part));
};

const setStoryMode = (mode = "cover") => {
  const isReader = mode === "reader";
  coverPanel?.classList.toggle("hidden", isReader);
  readerPanel?.classList.toggle("hidden", !isReader);
};

const buildStorySuggestions = (currentItem) => {
  if (!readerSuggestions) {
    return;
  }
  readerSuggestions.innerHTML = "";
  const candidates = memorialPhotos.filter((item) => toMemorialKey(item) !== toMemorialKey(currentItem)).slice(0, 4);
  candidates.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-suggestion-card";
    btn.innerHTML = `
      <img src="${getCoverUrl(item)}" alt="${item.title}">
      <p>${item.title}</p>
    `;
    btn.addEventListener("click", () => openStory(item));
    readerSuggestions.appendChild(btn);
  });
};

const buildNextEpisodeSuggestions = (currentItem) => {
  if (!nextEpisodeGrid || !nextEpisodePeek) {
    return;
  }

  const currentKey = toMemorialKey(currentItem);
  const ordered = [...memorialPhotos].sort((a, b) => parseLocalDate(a.year) - parseLocalDate(b.year));
  const currentIndex = ordered.findIndex((item) => toMemorialKey(item) === currentKey);

  if (currentIndex < 0 || ordered.length <= 1) {
    nextEpisodePeek.classList.add("hidden");
    nextEpisodePeek.classList.remove("is-visible");
    nextEpisodeGrid.innerHTML = "";
    return;
  }

  const suggestions = [];
  const previousItem = ordered[(currentIndex - 1 + ordered.length) % ordered.length];
  const nextItem = ordered[(currentIndex + 1) % ordered.length];

  if (previousItem && toMemorialKey(previousItem) !== currentKey) {
    suggestions.push({ item: previousItem, label: "Episode Sebelumnya" });
  }
  if (nextItem && toMemorialKey(nextItem) !== currentKey) {
    const duplicated = suggestions.some((entry) => toMemorialKey(entry.item) === toMemorialKey(nextItem));
    if (!duplicated) {
      suggestions.push({ item: nextItem, label: "Episode Sesudahnya" });
    }
  }

  if (suggestions.length === 0) {
    nextEpisodePeek.classList.add("hidden");
    nextEpisodePeek.classList.remove("is-visible");
    nextEpisodeGrid.innerHTML = "";
    return;
  }

  nextEpisodeGrid.innerHTML = "";
  suggestions.forEach(({ item, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reader-suggestion-card";
    btn.innerHTML = `
      <img src="${getCoverUrl(item)}" alt="${escapeHtml(item.title)}">
      <p>${escapeHtml(item.title)}</p>
      <span class="peek-suggestion-meta">${escapeHtml(label)}</span>
    `;
    btn.addEventListener("click", () => openStory(item));
    nextEpisodeGrid.appendChild(btn);
  });

  nextEpisodePeek.classList.remove("hidden");
  nextEpisodePeek.classList.remove("is-visible");
};

const renderStorySlide = () => {
  if (!modalStory) {
    return;
  }

  const totalCoreSlides = storySlides.length;
  const totalSlides = totalCoreSlides > 0 ? totalCoreSlides + 1 : 1;
  const onEnding = currentStorySlideIndex >= totalCoreSlides;

  readerProgress.textContent = `Halaman ${Math.min(currentStorySlideIndex + 1, totalSlides)} / ${totalSlides}`;
  readerEnding?.classList.toggle("hidden", !onEnding);

  if (onEnding) {
    modalStory.innerHTML = `<p class="reader-ending-copy">Selesai membaca cerita ini. Lanjut ke cerita lainnya di bawah.</p>`;
    buildStorySuggestions(activeMemorialItem);
  } else {
    modalStory.innerHTML = `<p>${escapeHtml(storySlides[currentStorySlideIndex])}</p>`;
  }

  if (readerPrevBtn) {
    readerPrevBtn.disabled = currentStorySlideIndex <= 0;
  }
  if (readerNextBtn) {
    readerNextBtn.textContent = onEnding ? "Selesai" : "Berikutnya";
  }
};

const openStory = (item) => {
  activeMemorialItem = item;
  storySlides = splitStorySlides(item.story);
  currentStorySlideIndex = 0;
  const fallbackCover = getCoverUrl(item);
  const rawGallery = Array.isArray(item.gallery) && item.gallery.length > 0 ? item.gallery : [fallbackCover];
  currentGallery = rawGallery
    .map((entry) => normalizeMediaEntry(entry, fallbackCover))
    .filter(Boolean);
  if (currentGallery.length === 0 && fallbackCover) {
    currentGallery = [{ type: "image", src: fallbackCover, poster: fallbackCover, thumb: fallbackCover }];
  }
  currentMemorialKey = toMemorialKey(item);
  modalTitle.textContent = item.title;
  modalMeta.textContent = item.year;
  modalStoryIntro.textContent = item.short || "Buka cerita lengkap untuk membaca seluruh kisah memorial ini.";
  buildNextEpisodeSuggestions(item);
  setStoryMode("cover");
  renderModalGallery();
  setModalImage(0);
  storyModal.classList.remove("cinema-mode");
  modalContent.scrollTop = 0;
  updateNextEpisodeVisibility();
  storyModal.classList.add("show");
  lockPageScroll();
  cinemaEligible = false;
  renderStorySlide();
  fetchComments(currentMemorialKey);
  updateLikeButtonState();
};

const closeStory = () => {
  stopAutoSlide();
  storyModal.classList.remove("show");
  storyModal.classList.remove("cinema-mode");
  setStoryMode("cover");
  currentStorySlideIndex = 0;
  currentReplyTarget = null;
  commentReplying?.classList.add("hidden");
  commentsPeek?.classList.remove("show");
  syncCommentsPeekAria(false);
  photoFloating.classList.remove("show", "faded");
  if (floatingFadeTimer) {
    clearTimeout(floatingFadeTimer);
    floatingFadeTimer = null;
  }
  if (mediaCounterHideTimer) {
    clearTimeout(mediaCounterHideTimer);
    mediaCounterHideTimer = null;
  }
  mediaCounter?.classList.remove("show");
  modalPhoto.classList.remove("is-fullscreen");
  if (modalPhotoVideo) {
    modalPhotoVideo.pause();
    modalPhotoVideo.removeAttribute("src");
    modalPhotoVideo.load();
    modalPhotoVideo.classList.add("hidden");
  }
  mediaPlayBtn?.classList.add("hidden");
  modalPhoto.classList.remove("is-video-playing");
  if (isPhotoFullscreen()) {
    exitPhotoFullscreen();
  }
  cinemaEligible = false;
  modalContent.scrollTop = 0;
  nextEpisodePeek?.classList.add("hidden");
  nextEpisodePeek?.classList.remove("is-visible");
  unlockPageScroll();
};

const createCard = (item, index) => {
  const coverUrl = getCoverUrl(item);
  const button = document.createElement("button");
  button.className = "photo-card";
  button.type = "button";
  button.setAttribute("aria-label", "Buka cerita " + item.title);
  button.dataset.index = index;

  button.innerHTML = `
    <img src="${coverUrl}" alt="${item.title}">
    <div class="card-copy">
      <h3>${item.title}</h3>
      <p>${item.short}</p>
    </div>
  `;

  button.addEventListener("click", () => openStory(item));
  return button;
};

const createTimelineItem = (item) => {
  const row = document.createElement("article");
  row.className = "timeline-item";

  row.innerHTML = `
    <p class="timeline-date">${item.year}</p>
    <div class="timeline-copy">
      <h3 class="timeline-title">${item.title}</h3>
      <p>${item.short}</p>
    </div>
    <button class="timeline-open" type="button">Buka Cerita</button>
  `;

  row.querySelector(".timeline-open").addEventListener("click", () => openStory(item));
  return row;
};

const mergeMemorials = (...groups) => {
  const map = new Map();
  groups.flat().forEach((item) => {
    const normalized = normalizeMemorialItem(item);
    if (!normalized) return;
    const key = normalized.id || `${normalized.title}|${normalized.year}`;
    map.set(key, normalized);
  });
  return [...map.values()];
};

const renderMemorialCatalog = () => {
  if (photoGrid) {
    photoGrid.innerHTML = "";
    memorialPhotos.forEach((item, index) => {
      photoGrid.appendChild(createCard(item, index));
    });
  }

  renderPopularMemorials();

  if (timelineList) {
    timelineList.innerHTML = "";
    [...memorialPhotos]
      .sort((a, b) => parseLocalDate(a.year) - parseLocalDate(b.year))
      .forEach((item) => {
        timelineList.appendChild(createTimelineItem(item));
      });
  }

  startHeroCoverSlide();
};

const fetchCloudAdminMemorials = async () => {
  if (!cloudEnabled || !auth.supabaseUrl) {
    return [];
  }
  try {
    let rows = [];
    if (auth.authorizedFetch) {
      const result = await auth.authorizedFetch(
        "/rest/v1/memorial_catalog?select=id,title,year,short,cover,story,gallery,is_active&is_active=eq.true&order=created_at.desc&limit=500"
      );
      rows = Array.isArray(result?.data) ? result.data : [];
    } else {
      const res = await fetch(
        `${auth.supabaseUrl}/rest/v1/memorial_catalog?select=id,title,year,short,cover,story,gallery,is_active&is_active=eq.true&order=created_at.desc&limit=500`,
        {
          headers: auth.authHeaders ? auth.authHeaders(getAccessToken()) : {}
        }
      );
      if (!res.ok) {
        throw new Error("fetch memorial_catalog failed");
      }
      rows = await res.json();
    }
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.map((row) => normalizeMemorialItem(row)).filter(Boolean);
  } catch {
    return [];
  }
};

const hydrateMemorialCatalog = async () => {
  const baseItems = parseBaseMemorialPhotos().map((item) => normalizeMemorialItem(item)).filter(Boolean);
  const localItems = loadAdminMemorialsLocal();
  const cloudItems = await fetchCloudAdminMemorials();
  memorialPhotos = mergeMemorials(baseItems, localItems, cloudItems);
  renderMemorialCatalog();
};

closeModalTop?.addEventListener("click", closeStory);

const handleLikeToggle = async () => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  if (!currentMemorialKey) {
    return;
  }

  if (cloudEnabled && getAccessToken() && currentUser.id) {
    try {
      const key = encodeURIComponent(currentMemorialKey);
      const uid = encodeURIComponent(currentUser.id);
      const existing = await restRequest(
        `/rest/v1/memorial_likes?select=id&memorial_key=eq.${key}&user_id=eq.${uid}&limit=1`
      );
      if (Array.isArray(existing) && existing.length > 0) {
        await restRequest(
          `/rest/v1/memorial_likes?memorial_key=eq.${key}&user_id=eq.${uid}`,
          { method: "DELETE" }
        );
      } else {
        await restRequest("/rest/v1/memorial_likes", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            memorial_key: currentMemorialKey,
            user_id: currentUser.id
          })
        });
      }
      await updateLikeButtonState();
      renderPopularMemorials();
      return;
    } catch {
      // fallback local below
    }
  }

  const likes = loadLikes();
  if (!Array.isArray(likes[currentMemorialKey])) {
    likes[currentMemorialKey] = [];
  }
  likes[currentMemorialKey] = toggleLocalLike(likes[currentMemorialKey], currentUser);
  saveLikes(likes);
  await updateLikeButtonState();
  renderPopularMemorials();
};

likeMemorialBtns.forEach((button) => {
  button.addEventListener("click", handleLikeToggle);
});

openCommentsPeekBtns.forEach((button) => {
  button.addEventListener("click", () => {
    commentsPeek?.classList.add("show");
    syncCommentsPeekAria(true);
  });
});

readStoryBtn?.addEventListener("click", () => {
  setStoryMode("reader");
  currentStorySlideIndex = 0;
  renderStorySlide();
});

readerPrevBtn?.addEventListener("click", () => {
  if (currentStorySlideIndex <= 0) {
    return;
  }
  currentStorySlideIndex -= 1;
  renderStorySlide();
});

readerNextBtn?.addEventListener("click", () => {
  const totalCoreSlides = storySlides.length;
  if (currentStorySlideIndex >= totalCoreSlides) {
    setStoryMode("cover");
    return;
  }
  currentStorySlideIndex += 1;
  renderStorySlide();
});

const syncCommentsPeekAria = (isOpen) => {
  openCommentsPeekBtns.forEach((button) => {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "commentsPeek");
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
};
syncCommentsPeekAria(false);

closeCommentsPeekBtn?.addEventListener("click", () => {
  commentsPeek?.classList.remove("show");
  syncCommentsPeekAria(false);
});

commentsPeek?.addEventListener("click", (event) => {
  if (event.target === commentsPeek) {
    commentsPeek.classList.remove("show");
    syncCommentsPeekAria(false);
  }
});

modalPhoto.addEventListener("click", async () => {
  try {
    const activeMedia = currentGallery[currentImageIndex];
    if (activeMedia?.type === "video" && modalPhotoVideo) {
      if (!isPhotoFullscreen() && typeof modalPhotoVideo.requestFullscreen === "function") {
        await modalPhotoVideo.requestFullscreen();
      }
      return;
    }
    if (!isPhotoFullscreen()) {
      await modalPhoto.requestFullscreen();
      return;
    }
    showFloatingPhoto();
  } catch {
    // Ignore fullscreen rejection in restricted browsers.
  }
});

closeFullscreenBtn?.addEventListener("click", async (event) => {
  event.stopPropagation();
  await exitPhotoFullscreen();
});

storyModal.addEventListener("click", (event) => {
  if (event.target === storyModal) {
    closeStory();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && commentsPeek?.classList.contains("show")) {
    commentsPeek.classList.remove("show");
    syncCommentsPeekAria(false);
    return;
  }

  if (event.key === "Escape" && storyModal.classList.contains("show")) {
    closeStory();
    return;
  }

  if (!storyModal.classList.contains("show")) {
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showPrevMedia();
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    showNextMedia();
  }
});

mediaPrevBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  mediaCounter?.classList.add("show");
  showPrevMedia();
});

mediaNextBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  mediaCounter?.classList.add("show");
  showNextMedia();
});

mediaPlayBtn?.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (!modalPhotoVideo || modalPhotoVideo.classList.contains("hidden")) {
    return;
  }
  try {
    await modalPhotoVideo.play();
  } catch {
    // Ignore play rejection (browser policy/user gesture edge case).
  }
});

modalPhotoVideo?.addEventListener("play", () => {
  mediaPlayBtn?.classList.add("hidden");
  modalPhoto.classList.add("is-video-playing");
});

modalPhotoVideo?.addEventListener("pause", () => {
  modalPhoto.classList.remove("is-video-playing");
  if (!modalPhotoVideo.ended) {
    mediaPlayBtn?.classList.remove("hidden");
  }
});

modalPhotoVideo?.addEventListener("ended", () => {
  modalPhoto.classList.remove("is-video-playing");
  mediaPlayBtn?.classList.remove("hidden");
});

modalContent.addEventListener("scroll", updateCinemaMode, { passive: true });
modalContent.addEventListener("scroll", updateNextEpisodeVisibility, { passive: true });

if (commentForm) {
  commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentUser = getCurrentUser();
    if (!currentUser) {
      window.location.href = "login.html";
      return;
    }

    const content = String(commentInput?.value || "").trim();
    if (!content || !currentMemorialKey) {
      return;
    }

    if (cloudEnabled && getAccessToken() && currentUser.id) {
      try {
        const cloudPayload = {
          memorial_key: currentMemorialKey,
          content,
          user_id: currentUser.id,
          user_name: currentUser.name,
          reply_to_comment_id: currentReplyTarget?.commentId || null,
          reply_to_user_id: currentReplyTarget?.userId || null,
          reply_to_user_name: currentReplyTarget?.userName || null
        };
        try {
          await restRequest("/rest/v1/memorial_comments", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify(cloudPayload)
          });
        } catch (error) {
          const msg = String(error?.message || "");
          const schemaMissingReplyCols =
            msg.includes("reply_to_comment_id") ||
            msg.includes("reply_to_user_id") ||
            msg.includes("reply_to_user_name");
          if (!schemaMissingReplyCols) {
            throw error;
          }
          await restRequest("/rest/v1/memorial_comments", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              memorial_key: currentMemorialKey,
              content,
              user_id: currentUser.id,
              user_name: currentUser.name
            })
          });
        }
        commentInput.value = "";
        currentReplyTarget = null;
        commentReplying?.classList.add("hidden");
        await fetchComments(currentMemorialKey);
        renderPopularMemorials();
        return;
      } catch {
        // fallback local below
      }
    }

    const all = loadLocalComments();
    if (!Array.isArray(all[currentMemorialKey])) {
      all[currentMemorialKey] = [];
    }

    all[currentMemorialKey].push({
      id: `lc_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      content,
      user_name: currentUser.name,
      user_id: currentUser.id || null,
      user_email: currentUser.email,
      reply_to_comment_id: currentReplyTarget?.commentId || null,
      reply_to_user_id: currentReplyTarget?.userId || null,
      reply_to_user_name: currentReplyTarget?.userName || null,
      created_at: new Date().toISOString()
    });
    saveLocalComments(all);
    commentInput.value = "";
    currentReplyTarget = null;
    commentReplying?.classList.add("hidden");
    fetchComments(currentMemorialKey);
    renderPopularMemorials();
  });
}

cancelReplyBtn?.addEventListener("click", () => {
  currentReplyTarget = null;
  commentReplying?.classList.add("hidden");
});

const setActiveNav = (href) => {
  navLinks.forEach((link) => {
    const isActive = link.getAttribute("href") === href;
    link.classList.toggle("active", isActive);
  });
};

const detectActiveSection = () => {
  const memorySection = document.getElementById("our-memory");
  const timelineSection = document.getElementById("timeline");
  const y = window.scrollY + 140;

  if (timelineSection && y >= timelineSection.offsetTop) {
    setActiveNav("#timeline");
  } else if (memorySection && y >= memorySection.offsetTop) {
    setActiveNav("#our-memory");
  } else {
    setActiveNav("#our-memory");
  }
};

window.addEventListener("scroll", detectActiveSection, { passive: true });
window.addEventListener("hashchange", detectActiveSection);
detectActiveSection();

const handleFullscreenChange = () => {
  if (isPhotoFullscreen()) {
    modalPhoto.classList.add("is-fullscreen");
    stopAutoSlide();
    showFloatingPhoto();
    return;
  }

  modalPhoto.classList.remove("is-fullscreen");
  photoFloating.classList.remove("show", "faded");
  if (floatingFadeTimer) {
    clearTimeout(floatingFadeTimer);
    floatingFadeTimer = null;
  }
  if (storyModal.classList.contains("show")) {
    startAutoSlide();
  }
};

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

hydrateMemorialCatalog();
setCommentUiState();

