const chat = document.getElementById("chat");
const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");

const textButton = document.getElementById("mode-text");
const voiceButton = document.getElementById("mode-voice");

const textView = document.getElementById("text-view");
const voiceView = document.getElementById("voice-view");

function addMessage(text, sender) {
  const message = document.createElement("div");

  message.classList.add("message", sender);
  message.textContent = text;

  chat.appendChild(message);
  chat.scrollTop = chat.scrollHeight;
}

function changeMode(mode) {
  const isText = mode === "text";

  textView.classList.toggle("hidden", !isText);
  voiceView.classList.toggle("hidden", isText);

  textButton.classList.toggle("active", isText);
  voiceButton.classList.toggle("active", !isText);
}

textButton.addEventListener("click", () => {
  changeMode("text");
});

voiceButton.addEventListener("click", () => {
  changeMode("voice");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = input.value.trim();

  if (!text) return;

  addMessage(text, "user");

  input.value = "";

  addMessage(
    "Recebi sua mensagem! Minha conexão com a inteligência artificial ainda está sendo preparada.",
    "assistant"
  );
});
