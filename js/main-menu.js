const ENTRY_KEY = "memoflix_entry_ok_v1";
const GUEST_KEY = "memoflix_guest_mode_v1";

const rotatingDesc = document.getElementById("rotatingDesc");
const goLoginBtn = document.getElementById("goLoginBtn");
const goGuestBtn = document.getElementById("goGuestBtn");
const menuVideo = document.getElementById("menuVideo");

const messages = [
  "Selamat datang di Memoflix — tempat kenangan diputar kembali.",
  "Setiap momen punya cerita, dan Setiap cerita layak dikenang.",
  "Mulai jelajahi memorial dan temukan cerita di baliknya."
];

let msgIndex = 0;

const renderDesc = () => {
  if (!rotatingDesc) {
    return;
  }
  rotatingDesc.classList.remove("show");
  requestAnimationFrame(() => {
    rotatingDesc.textContent = messages[msgIndex];
    rotatingDesc.classList.add("show");
  });
};

const startRotateDesc = () => {
  renderDesc();
  setInterval(() => {
    msgIndex = (msgIndex + 1) % messages.length;
    renderDesc();
  }, 3600);
};

if (menuVideo) {
  // Enforce max 1 menit per loop.
  menuVideo.addEventListener("timeupdate", () => {
    if (menuVideo.currentTime >= 59.5) {
      menuVideo.currentTime = 0;
      menuVideo.play().catch(() => {});
    }
  });
}

goLoginBtn?.addEventListener("click", () => {
  localStorage.setItem(ENTRY_KEY, "1");
  localStorage.removeItem(GUEST_KEY);
  window.location.href = "login.html";
});

goGuestBtn?.addEventListener("click", () => {
  localStorage.setItem(ENTRY_KEY, "1");
  localStorage.setItem(GUEST_KEY, "1");
  window.location.href = "secret-message.html";
});

startRotateDesc();
