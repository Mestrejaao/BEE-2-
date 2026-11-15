const API_BASE = (window.BEE_API_BASE || "").replace(/\/$/, "");
const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const loginForm = document.getElementById("login-form");
const accessInput = document.getElementById("access-code");
const loginError = document.getElementById("login-error");
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const textButton = document.getElementById("mode-text");
const voiceButton = document.getElementById("mode-voice");
const textView = document.getElementById("text-view");
const voiceView = document.getElementById("voice-view");
let sessionToken = sessionStorage.getItem("bee-session") || "";
let history = [];

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a solicitação.");
  return data;
}

function addMessage(text, sender) {
  const message = document.createElement("div");
  message.classList.add("message", sender);
  message.textContent = text;
  chat.appendChild(message);
  chat.scrollTop = chat.scrollHeight;
  return message;
}

function changeMode(mode) {
  const isText = mode === "text";
  textView.classList.toggle("hidden", !isText);
  voiceView.classList.toggle("hidden", isText);
  textButton.classList.toggle("active", isText);
  voiceButton.classList.toggle("active", !isText);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const button = loginForm.querySelector("button");
  button.disabled = true;
  try {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ code: accessInput.value.trim() })
    });
    sessionToken = result.token;
    sessionStorage.setItem("bee-session", sessionToken);
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    accessInput.value = "";
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

textButton.addEventListener("click", () => changeMode("text"));
voiceButton.addEventListener("click", () => changeMode("voice"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, "user");
  history.push({ role: "user", content: text });
  history = history.slice(-12);
  input.value = "";
  input.disabled = true;
  const sendButton = form.querySelector("button");
  sendButton.disabled = true;
  const pending = addMessage("A BEE está pensando...", "assistant");

  try {
    const result = await apiRequest("/chat", {
      method: "POST",
      body: JSON.stringify({ messages: history })
    });
    pending.textContent = result.answer;
    history.push({ role: "assistant", content: result.answer });
    history = history.slice(-12);
  } catch (error) {
    pending.textContent = error.message;
    if (error.message.includes("Sessão inválida")) {
      sessionStorage.removeItem("bee-session");
      sessionToken = "";
      appView.classList.add("hidden");
      loginView.classList.remove("hidden");
    }
  } finally {
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  }
});

if (sessionToken) {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}
