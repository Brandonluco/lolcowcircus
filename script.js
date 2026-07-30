// Blocks the right-click menu
document.addEventListener('contextmenu', e => e.preventDefault());

// Blocks common copy hotkeys (Ctrl+C, Ctrl+A, Ctrl+U)
document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
        if (['c', 'a', 'u'].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }
    }
});
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const chatMessages = document.getElementById("chat-messages");
const newMessageAlert = document.getElementById("new-message-alert");

const guestName = "Guest_" + Math.floor(Math.random() * 1000000);
const guestColors = [
    "#8B5A2B", // Brown
    "#A0522D", // Sienna
    "#B7410E", // Rust red
    "#6B705C", // Olive gray
    "#8A817C", // Warm gray
    "#9C6644", // Clay brown
    "#7F5539", // Dark earth brown
    "#BC6C25"  // Copper
];

const guestColor = guestColors[Math.floor(Math.random() * guestColors.length)];

function sendMessage() {
    const message = messageInput.value;
    const now = new Date();

const timestamp = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
}) + " • " + now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
});
    if (message === "") {
        return;
    }

    const newMessage = document.createElement("div");
newMessage.classList.add("message");
newMessage.innerHTML = `<strong style="color:${guestColor}">${guestName}:</strong> ${message} <span class="timestamp">${timestamp}</span>`;
chatMessages.appendChild(newMessage);

const wasAtBottom = 
    chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;

chatMessages.appendChild(newMessage);

if (wasAtBottom) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
} else {
    newMessageAlert.style.display = "block";
}

localStorage.setItem("chatMessages", chatMessages.innerHTML);
    
messageInput.value = "";
}
const savedMessages = localStorage.getItem("chatMessages");

if (savedMessages) {
    chatMessages.innerHTML = savedMessages;
    chatMessages.scrollTop = chatMessages.scrollHeight;
}




sendButton.addEventListener("click", function () {
    sendMessage();
});

messageInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});
newMessageAlert.addEventListener("click", function () {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    newMessageAlert.style.display = "none";
});
chatMessages.addEventListener("scroll", function () {
    const isAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;

    if (isAtBottom) {
        newMessageAlert.style.display = "none";
    }
});