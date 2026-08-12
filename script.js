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
const chatCharCount = document.getElementById("chatCharCount");
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

let guestName = localStorage.getItem("chatUsername");

if (!guestName) {
    guestName = "Guest_" + Math.floor(Math.random() * 1000000);
    localStorage.setItem("chatUsername", guestName);
}
const currentChatName = document.getElementById("current-chat-name");

if (currentChatName) {
    currentChatName.textContent = guestName;
}


const chooseNameButton = document.getElementById("choose-name-button");
const nameChangeBox = document.getElementById("name-change-box");
const saveNameButton = document.getElementById("save-name-button");
const nameInput = document.getElementById("name-input");


if (chooseNameButton) {

    chooseNameButton.addEventListener("click", function () {

        nameChangeBox.style.display = "block";

    });

}


if (saveNameButton) {

    saveNameButton.addEventListener("click", function () {

        let newName = nameInput.value.trim();

        if (newName === "") {
            return;
        }

        guestName = newName;

        localStorage.setItem("chatUsername", guestName);

        currentChatName.textContent = guestName;

        nameInput.value = "";

        nameChangeBox.style.display = "none";

    });

}


const identityCard = document.getElementById("identity-card");
const closeIdentityCard = document.getElementById("close-identity-card");

if (closeIdentityCard) {

    closeIdentityCard.addEventListener("click", function () {

        identityCard.style.display = "none";

    });

}



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

async function sendMessage() {

    console.log("Sending to D1");

    const message = messageInput.value.trim().slice(0, 500);

    if (message === "") {
        return;
    }

    const now = new Date();

    const timestamp = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    }) + " • " + now.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
    });


    const commentData = {
        username: guestName,
        message: message,
        color: guestColor,
        created_at: timestamp
    };


    const response = await fetch("/api/comments", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(commentData)
    });


  if (response.ok) {

    socket.send(JSON.stringify(commentData));

    messageInput.value = "";

    chatCharCount.textContent = "0 / 500";


}
    
    else {

        console.error("Failed to send comment");

    }

}

   
async function loadMessages() {

    const response = await fetch("/api/comments");

    const comments = await response.json();

    chatMessages.innerHTML = "";

    comments.forEach((comment) => {

        const message = document.createElement("div");

        message.classList.add("message");

        message.innerHTML = `
            <strong style="color:${comment.color}">
                ${comment.username}:
            </strong>
            ${comment.message}
            <span class="timestamp">
                ${comment.created_at}
            </span>
        `;

        chatMessages.appendChild(message);

    });

    chatMessages.scrollTop = chatMessages.scrollHeight;

}


loadMessages();


const socket = new WebSocket(
    "wss://" + window.location.host + "/api/chat"
);

socket.onopen = () => {
    console.log("WebSocket connected");
};

socket.onmessage = (event) => {

    const comment = JSON.parse(event.data);

    const message = document.createElement("div");

    message.classList.add("message");

    message.innerHTML = `
        <strong style="color:${comment.color}">
            ${comment.username}:
        </strong>
        ${comment.message}
        <span class="timestamp">
            ${comment.created_at}
        </span>
    `;

const isAtBottom =
    chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;

chatMessages.appendChild(message);

if (isAtBottom) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
} else {
    newMessageAlert.style.display = "block";
}

};

socket.onclose = () => {
    console.log("WebSocket disconnected");
};



messageInput.addEventListener("input", function () {

    // Backstop for voice-to-text/dictation, which can bypass the HTML maxlength
    // attribute on some browsers by inserting text outside a normal keystroke or paste.
    if (messageInput.value.length > 500) {
        messageInput.value = messageInput.value.slice(0, 500);
    }

    chatCharCount.textContent = `${messageInput.value.length} / 500`;
});

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


async function loadStatusBanner() {

    statusTrack.innerHTML = "";

    const response = await fetch("/api/streamers");

    const updatedStreamers = await response.json();

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

async function loadAlert() {

    const response = await fetch("/api/alert");

    const alert = await response.json();

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
else {
    header.classList.remove("expanded");
}

    lastScroll = currentScroll;
});

async function loadArticles() {

    const container = document.getElementById("articles-container");

    container.innerHTML = "";

   const response = await fetch("/api/articles");

   const savedArticles = await response.json();

savedArticles.forEach((article) => {

        const post = document.createElement("article");

        post.classList.add("blog-post");

        post.dataset.articleId = article.id;

        post.innerHTML = `
            <header class="post-header">
                <h1 class="post-title">${article.title}</h1>

                <div class="post-meta">
                    ${article.date}
                </div>
            </header>

            <div class="post-content">

                <p class="article-text">${article.contentTop}</p>

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

<p class="article-text">${article.contentBottom}</p>

<a href="mailto:undergroundcowtube@gmail.com?subject=Article Report"
class="report-button">
    Report Article
</a>


<section class="comments-section">

    <h2>Comments</h2>

    <div class="comment-list" id="comment-list-${article.id}">

        <!-- Comments will load here -->

    </div>

    <div class="comment-input">

    <textarea 
        class="comment-textarea"
        placeholder="Write a comment..."
        maxlength="500">
    </textarea>

    <div class="comment-footer">

        <span class="character-count">
            0 / 500
        </span>

        <button class="comment-button-disabled" disabled>
            Post Comment
        </button>

    </div>

</div>

</section>



</div>
        `;

        container.appendChild(post);

        loadArticleComments(article.id);

    });

}

async function loadArticleComments(articleId) {

    const list = document.getElementById(`comment-list-${articleId}`);

    if (!list) {
        return;
    }

    const response = await fetch(`/api/article-comments?article_id=${articleId}`);

    const comments = await response.json();

    if (comments.length === 0) {
        list.innerHTML = `<p class="no-comments">No comments yet. Be the first to comment.</p>`;
        return;
    }

    list.innerHTML = "";

    comments.forEach((comment) => {

        const div = document.createElement("div");

        div.classList.add("comment");

        div.innerHTML = `
            <div class="comment-header">
                <strong style="color:${comment.color}">${comment.username}</strong>
                <span class="timestamp">${comment.created_at}</span>
            </div>
            <p>${comment.message}</p>
        `;

        list.appendChild(div);

    });

}

const articlesContainer = document.getElementById("articles-container");

// Live character count + enable/disable the post button as the user types
articlesContainer.addEventListener("input", function (event) {

    if (!event.target.classList.contains("comment-textarea")) {
        return;
    }

    const textarea = event.target;
    const footer = textarea.nextElementSibling;
    const countSpan = footer.querySelector(".character-count");
    const postButton = footer.querySelector("button");

    countSpan.textContent = `${textarea.value.length} / 500`;

    if (textarea.value.trim().length > 0) {
        postButton.disabled = false;
        postButton.classList.remove("comment-button-disabled");
    } else {
        postButton.disabled = true;
        postButton.classList.add("comment-button-disabled");
    }

});

// Handle posting a comment on any article
articlesContainer.addEventListener("click", async function (event) {

    const button = event.target.closest(".comment-input button");

    if (!button || button.disabled) {
        return;
    }

    const articlePost = button.closest("[data-article-id]");
    const articleId = articlePost.dataset.articleId;
    const textarea = button.closest(".comment-input").querySelector("textarea");
    const message = textarea.value.trim();

    if (message === "") {
        return;
    }

    const now = new Date();

    const timestamp = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    }) + " • " + now.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
    });

    const commentData = {
        article_id: articleId,
        username: guestName,
        message: message,
        color: guestColor,
        created_at: timestamp
    };

    const response = await fetch("/api/article-comments", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(commentData)
    });

    if (response.status === 403) {
        alert("You've been blocked from posting comments.");
        return;
    }

    if (response.ok) {

        textarea.value = "";

        const footer = textarea.nextElementSibling;

        footer.querySelector(".character-count").textContent = "0 / 500";

        button.disabled = true;
        button.classList.add("comment-button-disabled");

        await loadArticleComments(articleId);

    }

});

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
