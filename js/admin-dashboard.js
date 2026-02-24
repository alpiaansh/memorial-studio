(function () {
  const auth = window.MemoflixAuth || {};
  const ADMIN_MEMORIALS_KEY = "memoflix_admin_memorials_v1";
  const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;

  const adminShell = document.getElementById("adminShell");
  const adminAccessStatus = document.getElementById("adminAccessStatus");

  const broadcastForm = document.getElementById("adminBroadcastForm");
  const broadcastTitle = document.getElementById("broadcastTitle");
  const broadcastSection = document.getElementById("broadcastSection");
  const broadcastMessage = document.getElementById("broadcastMessage");
  const broadcastStatus = document.getElementById("broadcastStatus");

  const memorialForm = document.getElementById("adminMemorialForm");
  const memorialEditId = document.getElementById("memorialEditId");
  const memorialTitle = document.getElementById("memorialTitle");
  const memorialYear = document.getElementById("memorialYear");
  const memorialShort = document.getElementById("memorialShort");
  const assetBaseDir = document.getElementById("assetBaseDir");
  const memorialCover = document.getElementById("memorialCover");
  const memorialPoster = document.getElementById("memorialPoster");
  const memorialThumb = document.getElementById("memorialThumb");
  const memorialStory = document.getElementById("memorialStory");
  const memorialMediaPaths = document.getElementById("memorialMediaPaths");
  const memorialGallery = document.getElementById("memorialGallery");
  const memorialStatus = document.getElementById("memorialStatus");
  const memorialSubmitBtn = document.getElementById("memorialSubmitBtn");
  const memorialCancelEditBtn = document.getElementById("memorialCancelEditBtn");

  const memorialList = document.getElementById("adminMemorialList");
  const refreshAdminMemorialsBtn = document.getElementById("refreshAdminMemorialsBtn");

  const normalizeUsername = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^@+/, "");

  const getAccessToken = () => auth.getSession?.()?.access_token || "";

  const restRequest = async (path, options = {}) => {
    if (!auth.cloudEnabled || !auth.supabaseUrl) {
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
    if (!res.ok) {
      const msg =
        (data && (data.message || data.error || data.error_description)) ||
        `Request gagal (${res.status})`;
      throw new Error(msg);
    }
    return data;
  };

  const normalizeBaseDir = (value) => {
    const clean = String(value || "assets").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return clean || "assets";
  };

  const normalizeAssetPath = (inputPath, baseDir = "assets") => {
    const raw = String(inputPath || "").trim().replace(/\\/g, "/");
    if (!raw) return "";
    if (/^(https?:\/\/|data:|blob:)/i.test(raw)) {
      return raw;
    }
    if (raw.startsWith("/")) {
      return raw.slice(1);
    }
    if (raw.startsWith("assets/")) {
      return raw;
    }
    const base = normalizeBaseDir(baseDir);
    return `${base}/${raw}`.replace(/\/{2,}/g, "/");
  };

  const toMediaEntry = (path, coverPath, baseDir, defaults = {}) => {
    const src = normalizeAssetPath(path, baseDir);
    if (!src) return null;
    const isVideo = VIDEO_EXT_RE.test(src);
    const defaultPoster = normalizeAssetPath(defaults.poster || coverPath, baseDir);
    const defaultThumb = normalizeAssetPath(defaults.thumb || defaultPoster || coverPath, baseDir);
    if (isVideo) {
      return {
        type: "video",
        src,
        poster: defaultPoster || src,
        thumb: defaultThumb || defaultPoster || src
      };
    }
    return {
      type: "image",
      src,
      poster: defaultPoster || src,
      thumb: defaultThumb || src
    };
  };

  const normalizeMemorial = (item) => {
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
    if (!normalized.title || !normalized.year || !normalized.short || !normalized.cover || !normalized.story) {
      return null;
    }
    return normalized;
  };

  const readMemorialsLocal = () => {
    try {
      const raw = localStorage.getItem(ADMIN_MEMORIALS_KEY);
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.map((item) => normalizeMemorial(item)).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const saveMemorialsLocal = (items) => {
    localStorage.setItem(ADMIN_MEMORIALS_KEY, JSON.stringify(Array.isArray(items) ? items : []));
  };

  const fetchMemorialsCloud = async () => {
    if (!auth.cloudEnabled) return [];
    try {
      const rows = await restRequest(
        "/rest/v1/memorial_catalog?select=id,title,year,short,cover,story,gallery,is_active&is_active=eq.true&order=created_at.desc&limit=500"
      );
      return Array.isArray(rows) ? rows.map((item) => normalizeMemorial(item)).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const resetMemorialForm = () => {
    if (memorialEditId) memorialEditId.value = "";
    if (memorialTitle) memorialTitle.value = "";
    if (memorialYear) memorialYear.value = "";
    if (memorialShort) memorialShort.value = "";
    if (memorialCover) memorialCover.value = "";
    if (memorialPoster) memorialPoster.value = "";
    if (memorialThumb) memorialThumb.value = "";
    if (memorialStory) memorialStory.value = "";
    if (memorialMediaPaths) memorialMediaPaths.value = "";
    if (memorialGallery) memorialGallery.value = "";
    if (memorialSubmitBtn) memorialSubmitBtn.textContent = "Tambah Memorial";
    memorialCancelEditBtn?.classList.add("hidden");
  };

  const setMemorialEditMode = (item) => {
    if (!item) return;
    if (memorialEditId) memorialEditId.value = String(item.id || "");
    if (memorialTitle) memorialTitle.value = String(item.title || "");
    if (memorialYear) memorialYear.value = String(item.year || "");
    if (memorialShort) memorialShort.value = String(item.short || "");
    if (memorialCover) memorialCover.value = String(item.cover || "");
    if (memorialPoster) {
      const firstPoster = Array.isArray(item.gallery)
        ? String(item.gallery.find((entry) => String(entry?.type || "image") === "video")?.poster || "")
        : "";
      memorialPoster.value = firstPoster;
    }
    if (memorialThumb) {
      const firstThumb = Array.isArray(item.gallery)
        ? String(item.gallery.find((entry) => String(entry?.thumb || "").trim())?.thumb || "")
        : "";
      memorialThumb.value = firstThumb;
    }
    if (memorialStory) memorialStory.value = String(item.story || "");
    if (memorialMediaPaths) {
      memorialMediaPaths.value = Array.isArray(item.gallery)
        ? item.gallery.map((entry) => String(entry?.src || "").trim()).filter(Boolean).join("\n")
        : "";
    }
    if (memorialGallery) memorialGallery.value = "";
    if (memorialSubmitBtn) memorialSubmitBtn.textContent = "Simpan Perubahan";
    memorialCancelEditBtn?.classList.remove("hidden");
    memorialStatus.textContent = `Mode edit aktif: ${String(item.title || "memorial")}`;
    memorialForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const fetchTableCount = async (table, filter = "") => {
    const query = filter ? `&${filter}` : "";
    const path = `/rest/v1/${table}?select=id${query}`;
    const response = auth.authorizedFetch
      ? await auth.authorizedFetch(path, {
          headers: {
            Prefer: "count=exact",
            Range: "0-0"
          }
        })
      : await (async () => {
          const res = await fetch(`${auth.supabaseUrl}${path}`, {
            headers: {
              ...auth.authHeaders(getAccessToken()),
              Prefer: "count=exact",
              Range: "0-0"
            }
          });
          if (!res.ok) {
            throw new Error(`${table}: ${res.status}`);
          }
          const data = await res.json();
          return { data, headers: res.headers };
        })();

    const contentRange = String(response.headers?.get("content-range") || "");
    const match = contentRange.match(/\/(\d+)$/);
    if (match) {
      return Number(match[1] || 0);
    }
    return Array.isArray(response.data) ? response.data.length : 0;
  };

  const refreshAnalytics = async () => {
    // Analytics removed by request: keep function no-op to avoid side effects.
    return;
  };

  const upsertMemorialCloud = async (payload) => {
    const body = {
      id: payload.id,
      title: payload.title,
      year: payload.year,
      short: payload.short,
      cover: payload.cover,
      story: payload.story,
      gallery: payload.gallery,
      created_by: payload.created_by,
      is_active: true
    };
    await restRequest("/rest/v1/memorial_catalog", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(body)
    });
  };

  const deleteMemorialCloud = async (id) => {
    await restRequest(`/rest/v1/memorial_catalog?id=eq.${encodeURIComponent(String(id || ""))}`, {
      method: "DELETE"
    });
  };

  const canUseAdmin = async () => {
    const user = auth.getCurrentUser?.();
    if (!user) return false;

    const cfg = window.APP_CONFIG || {};
    const allowed = Array.isArray(cfg.ADMIN_USERNAMES)
      ? cfg.ADMIN_USERNAMES.map((item) => normalizeUsername(item))
      : [];
    const byConfig = allowed.includes(normalizeUsername(user.username));

    try {
      const flags = await auth.fetchMyProfileFlags?.();
      return byConfig || Boolean(flags?.isAdmin);
    } catch {
      return byConfig;
    }
  };

  const guardAdmin = async () => {
    const user = auth.getCurrentUser?.();
    if (!user) {
      window.location.replace("login.html");
      return false;
    }

    const ok = await canUseAdmin();
    if (!ok) {
      adminAccessStatus.textContent =
        "Akses ditolak. Set user ini jadi admin (user_profiles.is_admin=true), lalu refresh halaman.";
      adminShell?.classList.add("is-locked");
      return false;
    }

    adminAccessStatus.textContent = `Masuk sebagai admin @${user.username || "admin"}.`;
    adminShell?.classList.remove("is-locked");
    return true;
  };

  const parseGalleryJsonInput = (raw, baseDir) => {
    const text = String(raw || "").trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Gallery JSON wajib array.");
      }
      const normalized = parsed
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const type = String(entry.type || "").toLowerCase() === "video" ? "video" : "image";
          const src = normalizeAssetPath(entry.src || entry.url || "", baseDir);
          if (!src) return null;
          if (type === "video") {
            const poster = normalizeAssetPath(entry.poster || entry.thumb || "", baseDir);
            return {
              type,
              src,
              poster: poster || src,
              thumb: normalizeAssetPath(entry.thumb || poster || src, baseDir)
            };
          }
          return {
            type,
            src,
            poster: src,
            thumb: src
          };
        })
        .filter(Boolean);
      if (!normalized.length) {
        throw new Error("Gallery JSON tidak memiliki item valid.");
      }
      return normalized;
    } catch {
      throw new Error("Format Gallery JSON tidak valid.");
    }
  };

  const parseMediaLinesInput = (raw, coverPath, baseDir, defaults) => {
    const lines = String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];
    return lines.map((line) => toMediaEntry(line, coverPath, baseDir, defaults)).filter(Boolean);
  };

  const buildGallery = (baseDir, coverPath, mediaLinesRaw, galleryJsonRaw, defaults) => {
    const fromJson = parseGalleryJsonInput(galleryJsonRaw, baseDir);
    if (fromJson) return fromJson;
    const fromLines = parseMediaLinesInput(mediaLinesRaw, coverPath, baseDir, defaults);
    if (fromLines.length) return fromLines;
    return [toMediaEntry(coverPath, coverPath, baseDir, defaults)].filter(Boolean);
  };

  const renderMemorialList = (items) => {
    if (!memorialList) return;
    if (!items.length) {
      memorialList.innerHTML = '<p class="admin-empty">Belum ada memorial tambahan dari admin.</p>';
      return;
    }
    const activeEditId = String(memorialEditId?.value || "").trim();
    memorialList.innerHTML = items
      .map((item) => {
        const itemId = String(item.id || "");
        const isEditing = Boolean(activeEditId && itemId && activeEditId === itemId);
        return `
          <article class="admin-memorial-item${isEditing ? " is-editing" : ""}" data-id="${itemId}">
            <div>
              <div class="admin-memorial-title-row">
                <p class="admin-memorial-title">${String(item.title || "-")}</p>
                ${isEditing ? '<span class="admin-editing-badge">Sedang diedit</span>' : ""}
              </div>
              <p class="admin-memorial-meta">${String(item.year || "-")} | ${String(item.short || "")}</p>
              <p class="admin-memorial-path">${String(item.cover || "")}</p>
            </div>
            <div class="profile-actions">
              <button type="button" class="ghost-btn admin-edit-btn" data-id="${itemId}">Edit</button>
              <button type="button" class="ghost-btn admin-delete-btn" data-id="${itemId}">Hapus</button>
            </div>
          </article>
        `
      })
      .join("");

    const mergedItems = items.map((item) => normalizeMemorial(item)).filter(Boolean);

    memorialList.querySelectorAll(".admin-edit-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const id = String(button.getAttribute("data-id") || "");
        if (!id) return;
        const target = mergedItems.find((item) => String(item.id || "") === id);
        if (!target) return;
        setMemorialEditMode(target);
        renderMemorialList(mergedItems);
      });
    });

    memorialList.querySelectorAll(".admin-delete-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = String(button.getAttribute("data-id") || "");
        if (!id) return;
        try {
          if (auth.cloudEnabled) {
            await deleteMemorialCloud(id);
          }
        } catch {
          // ignore, fallback local
        }
        const next = readMemorialsLocal().filter((item) => String(item.id || "") !== id);
        saveMemorialsLocal(next);
        if (String(memorialEditId?.value || "") === id) {
          resetMemorialForm();
        }
        await refreshMemorialList();
      });
    });
  };

  const refreshMemorialList = async () => {
    const local = readMemorialsLocal();
    const cloud = await fetchMemorialsCloud();
    const map = new Map();
    [...local, ...cloud].forEach((item) => {
      const normalized = normalizeMemorial(item);
      if (!normalized) return;
      const key = normalized.id || `${normalized.title}|${normalized.year}`;
      map.set(key, normalized);
    });
    renderMemorialList([...map.values()]);
  };

  broadcastForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await guardAdmin())) return;

    try {
      await auth.publishSystemAnnouncement?.({
        title: broadcastTitle?.value,
        section: broadcastSection?.value,
        message: broadcastMessage?.value,
        createdBy: auth.getCurrentUser?.()?.username || "admin"
      });
      if (broadcastTitle) broadcastTitle.value = "";
      if (broadcastSection) broadcastSection.value = "";
      if (broadcastMessage) broadcastMessage.value = "";
      broadcastStatus.textContent = "Siaran berhasil dikirim ke semua pengguna.";
    } catch (error) {
      broadcastStatus.textContent = `Gagal kirim broadcast: ${error.message}`;
    }
  });

  memorialForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await guardAdmin())) return;

    try {
      const baseDir = normalizeBaseDir(assetBaseDir?.value || "assets");
      const cover = normalizeAssetPath(memorialCover?.value, baseDir);
      const galleryDefaults = {
        poster: normalizeAssetPath(memorialPoster?.value || cover, baseDir),
        thumb: normalizeAssetPath(memorialThumb?.value || memorialPoster?.value || cover, baseDir)
      };
      const gallery = buildGallery(
        baseDir,
        cover,
        memorialMediaPaths?.value,
        memorialGallery?.value,
        galleryDefaults
      );
      const payload = {
        id:
          String(memorialEditId?.value || "").trim() ||
          `admin_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        title: String(memorialTitle?.value || "").trim(),
        year: String(memorialYear?.value || "").trim(),
        short: String(memorialShort?.value || "").trim(),
        cover,
        story: String(memorialStory?.value || "").trim(),
        gallery,
        created_by: auth.getCurrentUser?.()?.username || "admin"
      };

      if (!payload.title || !payload.year || !payload.short || !payload.cover || !payload.story) {
        throw new Error("Semua field utama wajib diisi.");
      }

      const local = readMemorialsLocal();
      const nextLocal = [
        payload,
        ...local.filter((item) => String(item.id || "") !== String(payload.id))
      ];
      saveMemorialsLocal(nextLocal);

      let cloudSaved = false;
      if (auth.cloudEnabled) {
        try {
          await upsertMemorialCloud(payload);
          cloudSaved = true;
        } catch {
          cloudSaved = false;
        }
      }

      const wasEdit = Boolean(String(memorialEditId?.value || "").trim());
      resetMemorialForm();

      memorialStatus.textContent = cloudSaved
        ? wasEdit
          ? "Memorial berhasil diupdate permanen di database."
          : "Memorial tersimpan permanen di database."
        : wasEdit
          ? "Memorial berhasil diupdate lokal. Jalankan schema memorial_catalog agar permanen cloud."
          : "Memorial tersimpan lokal. Jalankan schema memorial_catalog agar permanen cloud.";
      await refreshMemorialList();
    } catch (error) {
      memorialStatus.textContent = `Gagal simpan memorial: ${error.message}`;
    }
  });

  memorialCancelEditBtn?.addEventListener("click", async () => {
    resetMemorialForm();
    memorialStatus.textContent = "Mode edit dibatalkan.";
    await refreshMemorialList();
  });

  refreshAdminMemorialsBtn?.addEventListener("click", refreshMemorialList);

  (async () => {
    const ok = await guardAdmin();
    if (!ok) return;
    resetMemorialForm();
    await refreshMemorialList();
  })();
})();
