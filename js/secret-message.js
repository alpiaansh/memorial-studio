const STORAGE_KEY = "memoflix_secret_messages_v1";
const SECRET_SENT_KEY = "memoflix_secret_sent_v1";
const SECRET_TAG_SEEN_KEY = "memoflix_secret_tag_seen_v1";
const POLL_INTERVAL_MS = 10000;
const MESSAGE_TTL_MONTHS = 3;
const TAG_BLOCK_START = "[[TAGS]]";
const TAG_BLOCK_END = "[[/TAGS]]";

const seedMessages = [];

const composerForm = document.getElementById("composerForm");
const composerNote = document.getElementById("composerNote");
const tagUsersInput = document.getElementById("tagUsers");
const searchInput = document.getElementById("searchInput");
const messageList = document.getElementById("messageList");
const resultMeta = document.getElementById("resultMeta");
const tagAlert = document.getElementById("tagAlert");
const syncStatus = document.getElementById("syncStatus");
const songQuery = document.getElementById("songQuery");
const spotifySuggestions = document.getElementById("spotifySuggestions");
const selectedSong = document.getElementById("selectedSong");
const musicUrlInput = document.getElementById("musicUrl");
const openSpotifySearch = document.getElementById("openSpotifySearch");
const nowPlaying = document.getElementById("nowPlaying");
const nowPlayingTitle = document.getElementById("nowPlayingTitle");
const nowPlayingFrame = document.getElementById("nowPlayingFrame");
const closePlayer = document.getElementById("closePlayer");
const peekModal = document.getElementById("peekModal");
const peekTo = document.getElementById("peekTo");
const peekTitle = document.getElementById("peekTitle");
const peekMeta = document.getElementById("peekMeta");
const peekText = document.getElementById("peekText");
const closePeek = document.getElementById("closePeek");
const peekPrev = document.getElementById("peekPrev");
const peekNext = document.getElementById("peekNext");
const peekCounter = document.getElementById("peekCounter");
const peekPlayerWrap = document.getElementById("peekPlayerWrap");
const peekSongFrame = document.getElementById("peekSongFrame");
const navLinks = [...document.querySelectorAll(".nav-link")];
const loginLink = document.getElementById("loginLink");

const cfg = window.APP_CONFIG || {};
const supabaseUrl = String(cfg.SUPABASE_URL || "").trim().replace(/\/$/, "");
const supabaseAnonKey = String(cfg.SUPABASE_ANON_KEY || "").trim();
const cloudEnabled = Boolean(supabaseUrl && supabaseAnonKey);
const auth = window.MemoflixAuth || {};

let messages = [];
let selectedTrack = null;
let currentTrackMatches = [];
let visibleMessages = [];
let currentPeekIndex = -1;

const spotifyTrendingTracks = [
  { title: "Die With A Smile", artist: "Lady Gaga, Bruno Mars", url: "https://open.spotify.com/track/2plbrEY59IikOBgBGLjaoe" },
  { title: "APT.", artist: "ROSE, Bruno Mars", url: "https://open.spotify.com/track/5vNRhkKd0yEAg8suGBpjeY" },
  { title: "Espresso", artist: "Sabrina Carpenter", url: "https://open.spotify.com/track/2qSkIjg1o9h3YT9RAgYN75" },
  { title: "Birds of a Feather", artist: "Billie Eilish", url: "https://open.spotify.com/track/6dOtVTDdiauQNBQEDOtlAB" },
  { title: "Beautiful Things", artist: "Benson Boone", url: "https://open.spotify.com/track/6tNQ70jh4OwmPGpYy6R2o9" },
  { title: "Too Sweet", artist: "Hozier", url: "https://open.spotify.com/track/3xkHsmpQCBMytMJNiDf3Ii" },
  { title: "Please Please Please", artist: "Sabrina Carpenter", url: "https://open.spotify.com/track/5N3hjp1WNayUPZrA8kJmJP" },
  { title: "Greedy", artist: "Tate McRae", url: "https://open.spotify.com/track/3rUGC1vUpkDG9CZFHMur1t" }
];

const setActiveNav = () => {
  navLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    link.classList.toggle("active", href === "secret-message.html");
  });
};

const getCurrentUser = () => {
  return auth.getCurrentUser ? auth.getCurrentUser() : null;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeTagToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_.]/g, "");

const parseTagsInput = (value) => {
  const raw = String(value || "");
  if (!raw) {
    return [];
  }

  const unique = new Set();
  raw
    .split(/[,\n]/)
    .map((item) => String(item || "").trim())
    .forEach((rawTag) => {
      if (!rawTag) {
        return;
      }
      // Reject email-style tags; tagging must use username or nama.
      if (rawTag.includes("@") && !rawTag.startsWith("@")) {
        return;
      }
      const tag = normalizeTagToken(rawTag);
      if (!tag) {
        return;
      }
      unique.add(tag);
    });

  return [...unique];
};

const packMessageWithTags = (messageText, tags) => {
  const cleanText = String(messageText || "").trim();
  if (!tags || tags.length === 0) {
    return cleanText;
  }
  return `${TAG_BLOCK_START}${tags.join(",")}${TAG_BLOCK_END}${cleanText}`;
};

const unpackMessage = (rawMessageText) => {
  const source = String(rawMessageText || "");
  if (!source.startsWith(TAG_BLOCK_START)) {
    return {
      tags: [],
      cleanText: source
    };
  }

  const endIndex = source.indexOf(TAG_BLOCK_END);
  if (endIndex < 0) {
    return {
      tags: [],
      cleanText: source
    };
  }

  const rawTags = source.slice(TAG_BLOCK_START.length, endIndex);
  const tags = parseTagsInput(rawTags);
  const cleanText = source.slice(endIndex + TAG_BLOCK_END.length).trim();

  return {
    tags,
    cleanText
  };
};

const setUserNav = () => {
  if (!loginLink) {
    return;
  }
  const currentUser = getCurrentUser();
  loginLink.textContent = currentUser ? "Profil" : "Masuk";
  loginLink.href = currentUser ? "profile.html" : "login.html";
};

const recordSecretSent = (currentUser) => {
  const senderEmail = normalizeEmail(currentUser?.email);
  const senderUserId = String(currentUser?.id || "").trim();
  if (!senderEmail && !senderUserId) {
    return;
  }

  try {
    const raw = localStorage.getItem(SECRET_SENT_KEY);
    const parsed = JSON.parse(raw || "[]");
    const list = Array.isArray(parsed) ? parsed : [];
    list.push({
      sender_email: senderEmail,
      sender_user_id: senderUserId || null,
      sender_ref: senderUserId || senderEmail,
      created_at: new Date().toISOString()
    });
    localStorage.setItem(SECRET_SENT_KEY, JSON.stringify(list));
  } catch {
    // Ignore local stats write error.
  }
};

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeText = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const scoreTrackMatch = (track, query) => {
  const q = normalizeText(query);
  if (!q) {
    return 1;
  }

  const title = normalizeText(track.title);
  const artist = normalizeText(track.artist);
  const combined = `${title} ${artist}`;

  if (combined === q) return 100;
  if (title === q || artist === q) return 95;
  if (title.startsWith(q) || artist.startsWith(q)) return 85;
  if (title.includes(q)) return 75;
  if (artist.includes(q)) return 70;

  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => combined.includes(t))) {
    return 60;
  }

  return 0;
};

const addMonths = (dateString, months) => {
  const date = new Date(dateString);
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const ensureExpiry = (item) => {
  if (item.expires_at) {
    return item;
  }

  return {
    ...item,
    expires_at: addMonths(item.created_at, MESSAGE_TTL_MONTHS).toISOString()
  };
};

const isExpired = (item) => new Date(item.expires_at).getTime() <= Date.now();
const isLegacySeedMessage = (item) => {
  if (!item || typeof item !== "object") {
    return false;
  }
  const isOldId = item.id === "m1" || item.id === "m2";
  const isOldTitle =
    item.title === "Untuk Kamu di Hari Tenang" || item.title === "Satu Lagu Untuk Pulang";
  return isOldId && isOldTitle;
};

const remainingDays = (item) => {
  const diffMs = new Date(item.expires_at).getTime() - Date.now();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / 86400000);
};

const readSeenTagMap = () => {
  try {
    const raw = localStorage.getItem(SECRET_TAG_SEEN_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveSeenTagMap = (map) => {
  localStorage.setItem(SECRET_TAG_SEEN_KEY, JSON.stringify(map));
};

const toMessageKey = (item) =>
  String(item.id || `${item.created_at || ""}|${item.title || ""}|${item.to_name || ""}`);

const isTaggedForCurrentUser = (item, currentUser) => {
  const { tags } = unpackMessage(item.message_text);
  if (!tags.length || !currentUser) {
    return false;
  }

  const usernameTag = normalizeTagToken(currentUser.username);
  const nameTag = normalizeTagToken(currentUser.name);
  return (usernameTag && tags.includes(usernameTag)) || (nameTag && tags.includes(nameTag));
};

const renderTagNotifications = () => {
  if (!tagAlert) {
    return;
  }

  const currentUser = getCurrentUser();
  if (!currentUser) {
    tagAlert.textContent = "Masuk untuk menerima notifikasi tag.";
    return;
  }

  const tagged = sortByDateDesc(messages)
    .filter((item) => !isExpired(item))
    .filter((item) => isTaggedForCurrentUser(item, currentUser));

  if (tagged.length === 0) {
    tagAlert.textContent = "Tidak ada notifikasi tag baru.";
    return;
  }

  const seenMap = readSeenTagMap();
  const unseen = tagged.filter((item) => !seenMap[toMessageKey(item)]);
  tagAlert.innerHTML = `
    Kamu ditag di ${tagged.length} message (${unseen.length} belum dibaca).
    <button type="button" class="spotify-search-btn" id="markTagSeenBtn">Tandai Dibaca</button>
  `;

  const markBtn = document.getElementById("markTagSeenBtn");
  markBtn?.addEventListener("click", () => {
    const nextMap = readSeenTagMap();
    tagged.forEach((item) => {
      nextMap[toMessageKey(item)] = true;
    });
    saveSeenTagMap(nextMap);
    renderTagNotifications();
  });
};

const setSyncStatus = (text, isError = false) => {
  syncStatus.textContent = text;
  syncStatus.classList.toggle("error", isError);
};

const parseSpotify = (url) => {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("spotify.com")) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const type = parts[0];
    const id = parts[1];
    if (!type || !id || !["track", "album", "playlist"].includes(type)) {
      return null;
    }

    return {
      type,
      id,
      embedUrl: `https://open.spotify.com/embed/${type}/${id}`
    };
  } catch {
    return null;
  }
};

const localLoad = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const cleaned = parsed.filter((item) => !isLegacySeedMessage(item));
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    }

    return cleaned.map((item) => {
      const senderEmail = normalizeEmail(item.sender_user_email || item.sender_email);
      return ensureExpiry({
        ...item,
        sender_user_id: item.sender_user_id || null,
        sender_user_email: senderEmail
      });
    });
  } catch {
    return [];
  }
};

const localSave = (list) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
};

const supabaseHeaders = (accessToken = "") => ({
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${accessToken || supabaseAnonKey}`,
  "Content-Type": "application/json"
});

const readErrorBody = async (res) => {
  try {
    const data = await res.json();
    return data?.message || data?.error_description || data?.error || JSON.stringify(data);
  } catch {
    return await res.text();
  }
};

const cloudRequest = async (path, options = {}) => {
  if (auth.authorizedFetch) {
    const result = await auth.authorizedFetch(path, options);
    return result?.data ?? null;
  }

  const token = auth.getSession?.()?.access_token || "";
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(token),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    throw new Error(`Permintaan cloud gagal (${res.status}): ${await readErrorBody(res)}`);
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
};

const fetchCloudMessages = async () => {
  const data = await cloudRequest("/rest/v1/secret_messages?select=*&order=created_at.desc");
  return Array.isArray(data) ? data.map(ensureExpiry) : [];
};

const insertCloudMessage = async (payload) => {
  const cloudPayload = {
    to_name: payload.to_name,
    title: payload.title,
    from_name: payload.from_name,
    music_url: payload.music_url,
    message_text: payload.message_text,
    sender_user_id: payload.sender_user_id,
    created_at: payload.created_at,
    expires_at: payload.expires_at
  };
  const data = await cloudRequest("/rest/v1/secret_messages", {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: JSON.stringify(cloudPayload)
  });
  return Array.isArray(data) && data.length > 0 ? ensureExpiry(data[0]) : ensureExpiry(payload);
};

const purgeExpiredCloudMessages = async () => {
  const nowIso = new Date().toISOString();
  await cloudRequest(`/rest/v1/secret_messages?expires_at=lt.${encodeURIComponent(nowIso)}`, {
    method: "DELETE"
  });
};

const sortByDateDesc = (list) =>
  [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

const openOverlayPlayer = (musicUrl, label) => {
  const parsed = parseSpotify(musicUrl);
  if (!parsed) {
    return;
  }

  nowPlayingFrame.src = parsed.embedUrl;
  nowPlayingTitle.textContent = `Sedang Diputar - ${label}`;
  nowPlaying.classList.remove("hidden");
};

const closePeekModal = () => {
  peekModal.classList.add("hidden");
  document.body.style.overflow = "";
  peekSongFrame.src = "";
  peekPlayerWrap.classList.add("hidden");
  auth.setGlobalBottomNavVisible?.(true);
};

const updatePeekNavState = () => {
  const total = visibleMessages.length;
  const hasList = total > 0 && currentPeekIndex >= 0;
  if (peekCounter) {
    peekCounter.textContent = hasList ? `${currentPeekIndex + 1} / ${total}` : "0 / 0";
  }
  if (peekPrev) {
    peekPrev.disabled = total <= 1;
  }
  if (peekNext) {
    peekNext.disabled = total <= 1;
  }
};

const openPeekByIndex = (index) => {
  const total = visibleMessages.length;
  if (total === 0) {
    return;
  }

  const normalizedIndex = ((index % total) + total) % total;
  currentPeekIndex = normalizedIndex;
  const item = visibleMessages[normalizedIndex];
  const created = new Date(item.created_at).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  const daysLeft = remainingDays(item);
  const parsed = unpackMessage(item.message_text);
  const tagLabel = parsed.tags.length > 0 ? ` - Tag: ${parsed.tags.map((tag) => `@${tag}`).join(", ")}` : "";
  peekTo.textContent = `For ${item.to_name}`;
  peekTitle.textContent = item.title;
  peekMeta.textContent = `Dari ${item.from_name || "Anonim"} - ${created} - Hilang dalam ${daysLeft} hari (3 bulan)${tagLabel}`;
  peekText.textContent = parsed.cleanText;
  peekModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  auth.setGlobalBottomNavVisible?.(false);
  updatePeekNavState();

  if (item.music_url) {
    const song = parseSpotify(item.music_url);
    if (song) {
      peekSongFrame.src = song.embedUrl;
      peekPlayerWrap.classList.remove("hidden");
    } else {
      peekSongFrame.src = "";
      peekPlayerWrap.classList.add("hidden");
    }
  } else {
    peekSongFrame.src = "";
    peekPlayerWrap.classList.add("hidden");
  }
};

const createMessageCard = (item) => {
  const card = document.createElement("article");
  card.className = "message-card";
  const parsed = unpackMessage(item.message_text);
  const tagLine = parsed.tags.length > 0 ? `<p class="message-meta">Tag: ${parsed.tags.map((tag) => `@${escapeHtml(tag)}`).join(", ")}</p>` : "";

  const created = new Date(item.created_at).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  const daysLeft = remainingDays(item);

  card.innerHTML = `
    <div class="message-head">
      <h3 class="message-title">${escapeHtml(item.title)}</h3>
      <p class="message-to">For ${escapeHtml(item.to_name)}</p>
    </div>
    <p class="message-meta">Dari ${escapeHtml(item.from_name || "Anonim")} - ${created} - Hilang dalam ${daysLeft} hari (3 bulan)</p>
    ${tagLine}
    <button class="reveal-btn" type="button" data-role="toggle">Buka Pesan</button>
    ${item.music_url ? '<button class="play-overlay-btn" type="button" data-role="play">Play Song Overlay</button>' : ""}
  `;

  const toggle = card.querySelector('[data-role="toggle"]');
  const play = card.querySelector('[data-role="play"]');

  toggle.addEventListener("click", () => {
    const index = Number(card.dataset.visibleIndex || "-1");
    if (Number.isInteger(index) && index >= 0) {
      openPeekByIndex(index);
    }
  });

  if (play) {
    play.addEventListener("click", () => {
      openOverlayPlayer(item.music_url, item.title);
    });
  }

  return card;
};

const renderMessages = (query = "") => {
  const keyword = query.trim().toLowerCase();
  const filtered = sortByDateDesc(messages)
    .filter((item) => !isExpired(item))
    .filter((item) => {
      const target = `${item.to_name} ${item.title}`.toLowerCase();
      return !keyword || target.includes(keyword);
    });

  resultMeta.textContent = `Menampilkan ${filtered.length} message aktif`;
  messageList.innerHTML = "";
  visibleMessages = filtered;
  if (filtered.length === 0) {
    currentPeekIndex = -1;
    updatePeekNavState();
  } else if (currentPeekIndex >= filtered.length) {
    currentPeekIndex = filtered.length - 1;
    updatePeekNavState();
  }

  if (filtered.length === 0) {
    messageList.innerHTML = `
      <div class="empty-state">
        Tidak ada message aktif ditemukan. Coba kata kunci lain (nama penerima atau judul).
      </div>
    `;
    renderTagNotifications();
    return;
  }

  filtered.forEach((item, index) => {
    const card = createMessageCard(item);
    card.dataset.visibleIndex = String(index);
    messageList.appendChild(card);
  });
  renderTagNotifications();
};

const refreshMessages = async () => {
  if (!cloudEnabled) {
    messages = localLoad().filter((item) => !isExpired(item));
    localSave(messages);
    renderMessages(searchInput.value);
    return;
  }

  try {
    try {
      await purgeExpiredCloudMessages();
    } catch {
      // Ignore purge failures (usually because delete policy isn't enabled yet).
    }

    messages = (await fetchCloudMessages()).filter((item) => !isExpired(item));
    renderMessages(searchInput.value);
    setSyncStatus("Mode: Cloud multi-pengguna (Supabase)");
  } catch {
    setSyncStatus("Mode: Cloud bermasalah, beralih ke penyimpanan lokal", true);
    messages = localLoad().filter((item) => !isExpired(item));
    localSave(messages);
    renderMessages(searchInput.value);
  }
};

composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentUser = getCurrentUser();
  if (!currentUser) {
    composerNote.textContent = "Kamu harus masuk dulu sebelum kirim pesan rahasia.";
    window.location.href = "login.html";
    return;
  }

  const formData = new FormData(composerForm);
  const to_name = String(formData.get("toName") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const from_name = String(formData.get("fromName") || "").trim() || currentUser.name;
  const manualMusicUrl = String(formData.get("musicUrl") || "").trim();
  const music_url = selectedTrack?.url || manualMusicUrl;
  const rawMessageText = String(formData.get("messageText") || "").trim();
  const rawTagsInput = String(formData.get("tagUsers") || "").trim();
  const tags = parseTagsInput(rawTagsInput);
  const message_text = packMessageWithTags(rawMessageText, tags);

  if (!to_name || !title || !rawMessageText) {
    composerNote.textContent = "Lengkapi field wajib: Untuk, Judul, dan Isi Pesan.";
    return;
  }

  if (music_url && !parseSpotify(music_url)) {
    composerNote.textContent = "Link lagu harus dari Spotify (track/album/playlist).";
    return;
  }

  if (rawTagsInput && tags.length === 0) {
    composerNote.textContent = "Tag harus pakai username/nama, bukan email.";
    return;
  }

  const createdAt = new Date().toISOString();
  const payload = {
    to_name,
    title,
    from_name,
    music_url,
    message_text,
    sender_user_id: currentUser.id || null,
    sender_user_email: normalizeEmail(currentUser.email),
    created_at: createdAt,
    expires_at: addMonths(createdAt, MESSAGE_TTL_MONTHS).toISOString()
  };

  try {
    if (cloudEnabled) {
      const inserted = await insertCloudMessage(payload);
      messages = [inserted, ...messages];
      setSyncStatus("Mode: Cloud multi-pengguna (Supabase)");
    } else {
      const localMessage = { id: `m_${Date.now()}`, ...payload };
      messages = [localMessage, ...messages];
      localSave(messages);
      setSyncStatus("Mode: Penyimpanan browser lokal multi-pengguna");
    }

    composerForm.reset();
    selectedTrack = null;
    selectedSong.textContent = "Belum ada lagu dipilih.";
    renderTrackSuggestions(songQuery.value);
    recordSecretSent(currentUser);
    composerNote.textContent = tags.length
      ? `Pesan berhasil disimpan dan men-tag ${tags.length} pengguna.`
      : "Pesan berhasil disimpan. Pesan ini akan hilang otomatis dalam 3 bulan.";
    renderMessages(searchInput.value);
  } catch (error) {
    composerNote.textContent = "Gagal simpan message. Buka Console browser untuk detail error Supabase.";
    console.error("Insert message failed:", error);
  }
});

searchInput.addEventListener("input", () => {
  renderMessages(searchInput.value);
});

closePlayer.addEventListener("click", () => {
  nowPlayingFrame.src = "";
  nowPlaying.classList.add("hidden");
});

closePeek.addEventListener("click", closePeekModal);
peekPrev?.addEventListener("click", () => {
  openPeekByIndex(currentPeekIndex - 1);
});
peekNext?.addEventListener("click", () => {
  openPeekByIndex(currentPeekIndex + 1);
});

peekModal.addEventListener("click", (event) => {
  if (event.target === peekModal) {
    closePeekModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !peekModal.classList.contains("hidden")) {
    closePeekModal();
    return;
  }

  if (!peekModal.classList.contains("hidden") && event.key === "ArrowLeft") {
    event.preventDefault();
    openPeekByIndex(currentPeekIndex - 1);
    return;
  }

  if (!peekModal.classList.contains("hidden") && event.key === "ArrowRight") {
    event.preventDefault();
    openPeekByIndex(currentPeekIndex + 1);
  }
});

const setSelectedTrack = (track) => {
  selectedTrack = track;
  musicUrlInput.value = track.url;
  selectedSong.textContent = `Terpilih: ${track.title} - ${track.artist}`;
  openOverlayPlayer(track.url, `${track.title} - ${track.artist}`);
};

const renderTrackSuggestions = (query = "") => {
  const scored = spotifyTrendingTracks
    .map((track) => ({ track, score: scoreTrackMatch(track, query) }))
    .filter((item) => item.score > 0 || !query.trim())
    .sort((a, b) => b.score - a.score);

  const tracks = scored.map((item) => item.track);
  currentTrackMatches = tracks;

  spotifySuggestions.innerHTML = "";
  if (tracks.length === 0) {
    spotifySuggestions.innerHTML = '<button class="song-option" type="button">Tidak ada lagu cocok. Coba kata lain.</button>';
    return;
  }

  tracks.forEach((track) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "song-option";
    btn.innerHTML = `
      <span class="song-title">${escapeHtml(track.title)}</span>
      <span class="song-artist">${escapeHtml(track.artist)}</span>
    `;
    btn.addEventListener("click", () => setSelectedTrack(track));
    spotifySuggestions.appendChild(btn);
  });
};

songQuery.addEventListener("input", () => {
  renderTrackSuggestions(songQuery.value);
});

openSpotifySearch.addEventListener("click", () => {
  const query = songQuery.value.trim();
  if (query && currentTrackMatches.length > 0) {
    setSelectedTrack(currentTrackMatches[0]);
    return;
  }

  const encoded = encodeURIComponent(query || "spotify top songs");
  window.open(`https://open.spotify.com/search/${encoded}`, "_blank", "noopener,noreferrer");
});

songQuery.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  const query = songQuery.value.trim();

  if (query && currentTrackMatches.length > 0) {
    setSelectedTrack(currentTrackMatches[0]);
    return;
  }

  const encoded = encodeURIComponent(query || "spotify top songs");
  window.open(`https://open.spotify.com/search/${encoded}`, "_blank", "noopener,noreferrer");
});

musicUrlInput.addEventListener("change", () => {
  const manualUrl = musicUrlInput.value.trim();
  const parsed = parseSpotify(manualUrl);
  if (!parsed) {
    return;
  }

  selectedTrack = {
    title: "Spotify Link Manual",
    artist: "Custom",
    url: manualUrl
  };
  selectedSong.textContent = "Terpilih: Spotify Link Manual";
  openOverlayPlayer(manualUrl, "Manual Selection");
});

renderTrackSuggestions();
setActiveNav();
setUserNav();

if (cloudEnabled) {
  setSyncStatus("Mode: Menghubungkan ke cloud...");
  refreshMessages();
  setInterval(refreshMessages, POLL_INTERVAL_MS);
} else {
  setSyncStatus("Mode: Penyimpanan browser lokal multi-pengguna");
  refreshMessages();
}
