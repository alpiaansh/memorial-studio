(function () {
  const auth = window.MemoflixAuth || {};

  const loginLink = document.getElementById("loginLink");
  const refreshSocialBtn = document.getElementById("refreshSocialBtn");
  const addFriendForm = document.getElementById("addFriendForm");
  const addFriendInput = document.getElementById("addFriendInput");
  const socialStatus = document.getElementById("socialStatus");
  const friendRequestsList = document.getElementById("friendRequestsList");
  const friendsList = document.getElementById("friendsList");
  const threadList = document.getElementById("threadList");
  const chatHead = document.getElementById("chatHead");
  const chatBody = document.getElementById("chatBody");
  const composerForm = document.getElementById("composerForm");
  const composerInput = document.getElementById("composerInput");

  const LOCAL_DM_KEY = "memoflix_direct_messages_v1";
  const LOCAL_FRIEND_KEY = "memoflix_friend_requests_v1";

  const state = {
    friendRequests: [],
    friends: [],
    dms: [],
    activePeer: ""
  };

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

  const saveJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const getCurrentUser = () => auth.getCurrentUser?.() || null;

  const setUserNav = () => {
    if (!loginLink) return;
    const user = getCurrentUser();
    loginLink.textContent = user ? "Profil" : "Masuk";
    loginLink.href = user ? "profile.html" : "login.html";
  };

  const setStatus = (message) => {
    if (socialStatus) socialStatus.textContent = String(message || "");
  };

  const formatTime = (ts) => {
    const d = new Date(ts || Date.now());
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  };

  const getCloudContext = () => {
    const session = auth.getSession?.();
    const user = getCurrentUser();
    if (!auth.cloudEnabled || !session?.access_token || !user?.id) return null;
    return {
      token: session.access_token,
      uid: String(user.id),
      username: normalizeUsername(user.username)
    };
  };

  const cloudFetchJson = async (path, options = {}) => {
    if (auth.authorizedFetch) {
      const result = await auth.authorizedFetch(path, options);
      return result?.data ?? null;
    }
    const cloud = getCloudContext();
    if (!cloud) {
      throw new Error("Sesi cloud tidak tersedia.");
    }
    const res = await fetch(`${auth.supabaseUrl}${path}`, {
      ...options,
      headers: {
        ...auth.authHeaders?.(cloud.token),
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

  const makeDmKey = (a, b) => [normalizeUsername(a), normalizeUsername(b)].sort().join("__");

  const listLocalDmsForUser = (username) => {
    const me = normalizeUsername(username);
    const store = readJson(LOCAL_DM_KEY, { byPair: {} });
    const byPair = store && typeof store === "object" && store.byPair && typeof store.byPair === "object" ? store.byPair : {};
    const out = [];
    Object.entries(byPair).forEach(([pair, list]) => {
      if (!pair.includes(me) || !Array.isArray(list)) return;
      list.forEach((item) => out.push(item));
    });
    return out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  };

  const appendLocalDm = (message) => {
    const store = readJson(LOCAL_DM_KEY, { byPair: {} });
    if (!store.byPair || typeof store.byPair !== "object") {
      store.byPair = {};
    }
    const key = makeDmKey(message.fromUsername, message.toUsername);
    if (!Array.isArray(store.byPair[key])) {
      store.byPair[key] = [];
    }
    store.byPair[key].push(message);
    saveJson(LOCAL_DM_KEY, store);
  };

  const resolveUserByUsername = async (username) => {
    const clean = normalizeUsername(username);
    if (!clean) return null;
    const cloud = getCloudContext();
    if (!cloud) return null;
    try {
      const rows = await cloudFetchJson(
        `/rest/v1/user_profiles?select=user_id,username&username=eq.${encodeURIComponent(clean)}&limit=1`
      );
      if (!Array.isArray(rows) || !rows.length) return null;
      return {
        userId: String(rows[0].user_id || ""),
        username: normalizeUsername(rows[0].username || clean)
      };
    } catch {
      return null;
    }
  };

  const fetchFriendRequests = async () => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    if (!me) return [];

    const cloud = getCloudContext();
    if (!cloud) {
      if (auth.cloudEnabled) {
        return [];
      }
      const local = readJson(LOCAL_FRIEND_KEY, { requests: [] });
      const rows = Array.isArray(local?.requests) ? local.requests : [];
      return rows.filter(
        (item) => normalizeUsername(item.from_username) === me || normalizeUsername(item.to_username) === me
      );
    }

    try {
      const rows = await cloudFetchJson(
        `/rest/v1/friend_requests?select=id,sender_user_id,sender_username,receiver_user_id,receiver_username,status,created_at,updated_at&or=(sender_user_id.eq.${encodeURIComponent(
          cloud.uid
        )},receiver_user_id.eq.${encodeURIComponent(cloud.uid)},sender_username.eq.${encodeURIComponent(
          me
        )},receiver_username.eq.${encodeURIComponent(me)})&order=created_at.desc&limit=600`
      );
      if (!Array.isArray(rows)) return [];
      return rows.map((row) => ({
        id: row.id || `fr:${row.created_at || Date.now()}`,
        from_user_id: String(row.sender_user_id || ""),
        from_username: normalizeUsername(row.sender_username),
        to_user_id: String(row.receiver_user_id || ""),
        to_username: normalizeUsername(row.receiver_username),
        status: String(row.status || "pending").toLowerCase(),
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || row.created_at || new Date().toISOString()
      }));
    } catch {
      return [];
    }
  };

  const sendFriendRequest = async (targetUsername) => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    const target = normalizeUsername(targetUsername);
    if (!me || !user?.id) throw new Error("Masuk dulu.");
    if (!target || target.length < 3) throw new Error("Username tujuan tidak valid.");
    if (target === me) throw new Error("Tidak bisa add diri sendiri.");

    const existsPair = state.friendRequests.some((item) => {
      const a = normalizeUsername(item.from_username);
      const b = normalizeUsername(item.to_username);
      return ((a === me && b === target) || (a === target && b === me)) && item.status !== "rejected";
    });
    if (existsPair) throw new Error("Request sudah ada / kalian sudah berteman.");

    const targetProfile = await resolveUserByUsername(target);
    const payload = {
      id: `fr_local_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      from_user_id: String(user.id),
      from_username: me,
      to_user_id: String(targetProfile?.userId || ""),
      to_username: targetProfile?.username || target,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const cloud = getCloudContext();
    if (!cloud) {
      if (auth.cloudEnabled) {
        throw new Error("Session cloud tidak valid. Silakan login ulang.");
      }
      const local = readJson(LOCAL_FRIEND_KEY, { requests: [] });
      const rows = Array.isArray(local?.requests) ? local.requests : [];
      rows.unshift(payload);
      saveJson(LOCAL_FRIEND_KEY, { requests: rows });
      return;
    }

    await cloudFetchJson("/rest/v1/friend_requests", {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        sender_user_id: payload.from_user_id,
        sender_username: payload.from_username,
        receiver_user_id: payload.to_user_id || null,
        receiver_username: payload.to_username,
        status: "pending"
      })
    });
  };

  const updateFriendRequestStatus = async (requestId, nextStatus) => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    const status = String(nextStatus || "").toLowerCase();
    if (!["accepted", "rejected"].includes(status)) throw new Error("Status invalid.");

    const cloud = getCloudContext();
    if (!cloud) {
      if (auth.cloudEnabled) {
        throw new Error("Session cloud tidak valid. Silakan login ulang.");
      }
      const local = readJson(LOCAL_FRIEND_KEY, { requests: [] });
      const rows = Array.isArray(local?.requests) ? local.requests : [];
      const next = rows.map((item) => {
        if (String(item.id) !== String(requestId)) return item;
        if (normalizeUsername(item.to_username) !== me) return item;
        return { ...item, status, updated_at: new Date().toISOString() };
      });
      saveJson(LOCAL_FRIEND_KEY, { requests: next });
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

  const fetchFriendsCloud = async () => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    const cloud = getCloudContext();
    if (!me || !cloud) return [];
    try {
      const rows = await cloudFetchJson(
        `/rest/v1/user_friendships?select=user_id,friend_user_id,user_username,friend_username&or=(user_id.eq.${encodeURIComponent(
          cloud.uid
        )},friend_user_id.eq.${encodeURIComponent(cloud.uid)},user_username.eq.${encodeURIComponent(
          me
        )},friend_username.eq.${encodeURIComponent(me)})&limit=1000`
      );
      if (!Array.isArray(rows)) return [];
      const out = new Set();
      rows.forEach((row) => {
        const userSide = normalizeUsername(row.user_username);
        const friendSide = normalizeUsername(row.friend_username);
        if (userSide === me && friendSide && friendSide !== me) out.add(friendSide);
        if (friendSide === me && userSide && userSide !== me) out.add(userSide);
      });
      return [...out].sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  };

  const deriveFriendsFromRequests = () => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    const out = new Set();
    state.friendRequests.forEach((item) => {
      if (String(item.status) !== "accepted") return;
      const from = normalizeUsername(item.from_username);
      const to = normalizeUsername(item.to_username);
      if (from === me && to) out.add(to);
      if (to === me && from) out.add(from);
    });
    return [...out];
  };

  const fetchDirectMessages = async () => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    if (!me) return [];
    const cloud = getCloudContext();
    if (!cloud) {
      if (auth.cloudEnabled) {
        return [];
      }
      return listLocalDmsForUser(me);
    }

    try {
      const rows = await cloudFetchJson(
        `/rest/v1/direct_messages?select=id,sender_user_id,sender_username,recipient_user_id,recipient_username,body,created_at&or=(sender_user_id.eq.${encodeURIComponent(
          cloud.uid
        )},recipient_user_id.eq.${encodeURIComponent(cloud.uid)},sender_username.eq.${encodeURIComponent(
          me
        )},recipient_username.eq.${encodeURIComponent(me)})&order=created_at.asc&limit=2000`
      );
      if (!Array.isArray(rows)) return [];
      return rows
        .map((row) => ({
          id: row.id || `dm:${row.created_at || Date.now()}`,
          fromUserId: String(row.sender_user_id || ""),
          fromUsername: normalizeUsername(row.sender_username),
          toUserId: String(row.recipient_user_id || ""),
          toUsername: normalizeUsername(row.recipient_username),
          body: String(row.body || "").trim(),
          created_at: row.created_at || new Date().toISOString()
        }))
        .filter((item) => item.fromUsername && item.toUsername && item.body);
    } catch {
      return [];
    }
  };

  const sendDirectMessage = async (toUsername, body) => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    const peer = normalizeUsername(toUsername);
    const text = String(body || "").trim();
    if (!me || !user?.id) throw new Error("Masuk dulu.");
    if (!peer) throw new Error("Teman invalid.");
    if (!text) throw new Error("Pesan kosong.");
    if (!state.friends.includes(peer)) throw new Error("Hanya bisa chat dengan teman.");

    const target = await resolveUserByUsername(peer);
    const payload = {
      id: `dm_local_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      fromUserId: String(user.id),
      fromUsername: me,
      toUserId: String(target?.userId || ""),
      toUsername: target?.username || peer,
      body: text,
      created_at: new Date().toISOString()
    };

    const cloud = getCloudContext();
    if (!cloud) {
      if (auth.cloudEnabled) {
        throw new Error("Session cloud tidak valid. Silakan login ulang.");
      }
      appendLocalDm(payload);
      return;
    }

    await cloudFetchJson("/rest/v1/direct_messages", {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        sender_user_id: payload.fromUserId,
        sender_username: payload.fromUsername,
        recipient_user_id: payload.toUserId || null,
        recipient_username: payload.toUsername,
        body: payload.body
      })
    });
  };

  const getThreads = () => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    const grouped = new Map();
    state.friends.forEach((peer) => grouped.set(peer, []));
    state.dms.forEach((item) => {
      const from = normalizeUsername(item.fromUsername);
      const to = normalizeUsername(item.toUsername);
      if (from !== me && to !== me) return;
      const peer = from === me ? to : from;
      if (!state.friends.includes(peer)) return;
      if (!grouped.has(peer)) grouped.set(peer, []);
      grouped.get(peer).push(item);
    });
    const threads = [...grouped.entries()].map(([peer, messages]) => {
      const sorted = [...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const last = sorted[sorted.length - 1];
      return {
        peer,
        messages: sorted,
        subtitle: last ? last.body : "Belum ada pesan.",
        updatedAt: last?.created_at || ""
      };
    });
    threads.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return threads;
  };

  const renderRequests = () => {
    const user = getCurrentUser();
    const me = normalizeUsername(user?.username);
    const incoming = state.friendRequests.filter(
      (item) => item.status === "pending" && normalizeUsername(item.to_username) === me
    );
    if (!friendRequestsList) return;
    if (!incoming.length) {
      friendRequestsList.innerHTML = `<p class="social-empty">Tidak ada request.</p>`;
      return;
    }
    friendRequestsList.innerHTML = incoming
      .map(
        (item) => `
          <article class="social-request-item" data-id="${item.id}">
            <p>@${item.from_username}</p>
            <div>
              <button type="button" data-action="accept">Terima</button>
              <button type="button" data-action="reject">Tolak</button>
            </div>
          </article>
        `
      )
      .join("");

    friendRequestsList.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".social-request-item");
        const id = card?.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        if (!id || !action) return;
        try {
          await updateFriendRequestStatus(id, action === "accept" ? "accepted" : "rejected");
          setStatus(action === "accept" ? "Request diterima." : "Request ditolak.");
          await refreshAll();
        } catch (error) {
          setStatus(`Gagal update request: ${error.message}`);
        }
      });
    });
  };

  const renderFriends = () => {
    if (!friendsList) return;
    if (!state.friends.length) {
      friendsList.innerHTML = `<p class="social-empty">Belum ada teman.</p>`;
      return;
    }
    friendsList.innerHTML = state.friends
      .map(
        (friend) => `
          <button type="button" class="social-friend-item${state.activePeer === friend ? " is-active" : ""}" data-peer="${friend}">
            <span>@${friend}</span>
            <small>Obrolan</small>
          </button>
        `
      )
      .join("");
    friendsList.querySelectorAll(".social-friend-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const peer = normalizeUsername(btn.getAttribute("data-peer"));
        if (!peer) return;
        state.activePeer = peer;
        renderAll();
      });
    });
  };

  const renderThreads = () => {
    if (!threadList) return;
    const threads = getThreads();
    if (!threads.length) {
      threadList.innerHTML = `<p class="social-empty">Belum ada thread.</p>`;
      return;
    }
    threadList.innerHTML = threads
      .map(
        (thread) => `
          <button type="button" class="social-thread-item${state.activePeer === thread.peer ? " is-active" : ""}" data-peer="${thread.peer}">
            <p class="social-thread-title">@${thread.peer}</p>
            <p class="social-thread-snippet">${thread.subtitle}</p>
            <span class="social-thread-time">${thread.updatedAt ? formatTime(thread.updatedAt) : ""}</span>
          </button>
        `
      )
      .join("");
    threadList.querySelectorAll(".social-thread-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const peer = normalizeUsername(btn.getAttribute("data-peer"));
        if (!peer) return;
        state.activePeer = peer;
        renderAll();
      });
    });
  };

  const renderChat = () => {
    const peer = state.activePeer;
    if (!chatHead || !chatBody || !composerForm || !composerInput) return;
    if (!peer) {
      chatHead.innerHTML = `<h2>Pilih teman</h2>`;
      chatBody.innerHTML = `<p class="social-empty">Pilih teman untuk mulai chat.</p>`;
      composerForm.classList.add("hidden");
      return;
    }
    chatHead.innerHTML = `<h2>@${peer}</h2>`;
    const me = normalizeUsername(getCurrentUser()?.username);
    const thread = getThreads().find((t) => t.peer === peer);
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    if (!messages.length) {
      chatBody.innerHTML = `<p class="social-empty">Belum ada pesan dengan @${peer}.</p>`;
    } else {
      chatBody.innerHTML = messages
        .map((msg) => {
          const mine = normalizeUsername(msg.fromUsername) === me;
          return `
            <article class="social-msg ${mine ? "mine" : ""}">
              <p class="social-msg-text">${msg.body}</p>
              <p class="social-msg-time">${formatTime(msg.created_at)}</p>
            </article>
          `;
        })
        .join("");
      chatBody.scrollTop = chatBody.scrollHeight;
    }
    composerInput.placeholder = `Kirim pesan ke @${peer}`;
    composerForm.classList.remove("hidden");
  };

  const renderAll = () => {
    renderRequests();
    renderFriends();
    renderThreads();
    renderChat();
  };

  const refreshAll = async () => {
    const user = getCurrentUser();
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    try {
      setStatus("Memuat sosial...");
      const [requests, cloudFriends, dms] = await Promise.all([
        fetchFriendRequests(),
        fetchFriendsCloud(),
        fetchDirectMessages()
      ]);
      state.friendRequests = Array.isArray(requests) ? requests : [];
      const fallbackFriends = deriveFriendsFromRequests();
      state.friends = [...new Set([...(cloudFriends || []), ...fallbackFriends])].sort((a, b) => a.localeCompare(b));
      state.dms = Array.isArray(dms) ? dms : [];
      if (!state.activePeer || !state.friends.includes(state.activePeer)) {
        state.activePeer = state.friends[0] || "";
      }
      renderAll();
      setStatus(`Teman: ${state.friends.length} | Request: ${state.friendRequests.filter((r) => r.status === "pending").length}`);
    } catch (error) {
      setStatus(`Gagal memuat sosial: ${error.message}`);
    }
  };

  refreshSocialBtn?.addEventListener("click", refreshAll);

  addFriendForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = normalizeUsername(addFriendInput?.value || "");
    if (!target) {
      setStatus("Masukkan username valid.");
      return;
    }
    try {
      await sendFriendRequest(target);
      if (addFriendInput) addFriendInput.value = "";
      setStatus(`Request ke @${target} terkirim.`);
      await refreshAll();
    } catch (error) {
      setStatus(`Gagal add friend: ${error.message}`);
    }
  });

  composerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const peer = state.activePeer;
    const body = String(composerInput?.value || "").trim();
    if (!peer || !body) return;
    try {
      await sendDirectMessage(peer, body);
      if (composerInput) composerInput.value = "";
      await refreshAll();
      state.activePeer = peer;
      renderAll();
    } catch (error) {
      setStatus(`Gagal kirim pesan: ${error.message}`);
    }
  });

  setUserNav();
  refreshAll();
  setInterval(refreshAll, 15000);
})();
