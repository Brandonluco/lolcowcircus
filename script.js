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
const bannerBush = document.querySelector(".banner-bush");
const bannerFox = document.querySelector(".banner-fox");

console.log("Bush found:", bannerBush);
console.log("Fox found:", bannerFox);

bannerBush.addEventListener("click", function () {
    console.log("Bush clicked!");

    bannerFox.classList.add("show");

    setTimeout(function () {
        bannerFox.classList.remove("show");
    }, 3000);
});

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
    

    if (chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50) {
        newMessageAlert.style.display = "none";
    }
});

// =================
// STATUS BANNER
// =================

const statusBanner = document.querySelector(".status-banner");
const statusTrack = document.querySelector(".status-track");

let isDragging = false;
let startX;
let scrollLeft;

statusBanner.addEventListener("mousedown", (event) => {
    isDragging = true;
    statusBanner.classList.add("dragging");

    startX = event.pageX;
    scrollLeft = statusBanner.scrollLeft;
});

statusBanner.addEventListener("mouseleave", () => {
    isDragging = false;
});

statusBanner.addEventListener("mouseup", () => {
    isDragging = false;
});

statusBanner.addEventListener("mousemove", (event) => {
    if (!isDragging) return;

    event.preventDefault();

    const distance = event.pageX - startX;
    statusBanner.scrollLeft = scrollLeft - distance;
});

// Touch support for tablets and phones

statusBanner.addEventListener("touchstart", (event) => {
    isDragging = true;

    startX = event.touches[0].pageX;
    scrollLeft = statusBanner.scrollLeft;
});

statusBanner.addEventListener("touchmove", (event) => {
    if (!isDragging) return;

    const distance = event.touches[0].pageX - startX;

    statusBanner.scrollLeft = scrollLeft - distance;
});

statusBanner.addEventListener("touchend", () => {
    isDragging = false;
});

let autoScrollSpeed = 1;

function moveStatusBanner() {
    if (!isDragging) {
        statusBanner.scrollLeft += autoScrollSpeed;

        if (statusBanner.scrollLeft >= statusTrack.scrollWidth - statusBanner.clientWidth) {
   statusBanner.scrollLeft -= statusTrack.scrollWidth / 2;
}
    }

    requestAnimationFrame(moveStatusBanner);
}

moveStatusBanner();


function loadStatusBanner() {

    statusTrack.innerHTML = "";

    const updatedStreamers = getStreamers();

    for (let i = 0; i < 3; i++) {

        updatedStreamers.forEach((streamer) => {

            const item = document.createElement("span");

            let dot = "⚫";

            if (streamer.status === "online") {
                dot = "🟢";
            }

            if (streamer.status === "away") {
                dot = "🟡";
            }

            item.textContent =
                `${dot} ${streamer.name} • ${streamer.platform} • ${streamer.channel}   `;

            statusTrack.appendChild(item);

        });

    }

}

loadStatusBanner();

function loadAlert() {

    const alert = getAlert();

    const alertBox = document.getElementById("alertBox");

    if (!alert) {
    alertBox.style.display = "none";
    return;
}

alertBox.style.display = "block";

    alertBox.textContent = alert.message;

    if (alert.type === "news") {
        alertBox.style.backgroundColor = "#2ecc71";
    }

    if (alert.type === "maintenance") {
        alertBox.style.backgroundColor = "#e74c3c";
    }

}


loadAlert();


const header = document.querySelector(".site-header");

let lastScroll = window.scrollY;

window.addEventListener("scroll", () => {
    const currentScroll = window.scrollY;

    if (currentScroll <= 10) {
        header.classList.add("expanded");
    } 
    else if (currentScroll > lastScroll) {
    header.classList.remove("expanded");
}
    else {
    header.classList.add("expanded");
}

    lastScroll = currentScroll;
});

function loadArticles() {

    const container = document.getElementById("articles-container");

    container.innerHTML = "";

   const savedArticles = getArticles();

savedArticles.forEach((article) => {

        const post = document.createElement("article");

        post.classList.add("blog-post");

        post.innerHTML = `
            <header class="post-header">
                <h1 class="post-title">${article.title}</h1>

                <div class="post-meta">
                    ${article.date}
                </div>
            </header>

            <div class="post-content">

                <p>${article.contentTop}</p>

                ${article.image ? `<img src="${article.image}" class="article-image">` : ""}

${article.youtube ? `
<div class="video-container">
    <iframe 
        src="${article.youtube}"
        title="${article.title}"
        frameborder="0"
        allowfullscreen>
    </iframe>
</div>
` : ""}

<p>${article.contentBottom}</p>

<a href="mailto:undergroundcowtube@gmail.com?subject=Article Report"
class="report-button">
    Report Article
</a>


<section class="comments-section">

    <h2>Comments</h2>

    <div class="comment-list" id="comment-list">

        <!-- Comments will load here later -->

    </div>

    <div class="comment-input">

        <textarea placeholder="Write a comment..."></textarea>

        <button>
            Post Comment
        </button>

    </div>

</section>


</div>
        `;

        container.appendChild(post);

    });

}

loadArticles();

function testComment() {

    const now = new Date();

    const timestamp = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    }) + " • " + now.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
    });


    console.log("Comment Guest:", guestName);
    console.log("Comment Color:", guestColor);
    console.log("Comment Time:", timestamp);

}

testComment();