const messageInput = document.getElementById("message-input");

// Pulls the video ID out of a YouTube URL regardless of which format got
// pasted into the article's YouTube field — embed link (the one we ask
// for), a regular watch link, or a shortened youtu.be link. Used to build
// a thumbnail image for the homepage feed without needing a second field
// or a heavy iframe on every excerpt card.
function getYoutubeVideoId(url) {

    if (!url) {
        return null;
    }

    const match = url.match(
        /(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );

    return match ? match[1] : null;

}

function getYoutubeThumbnailUrl(embedUrl) {

    const videoId = getYoutubeVideoId(embedUrl);

    return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;

}
const sendButton = document.getElementById("send-button");
const chatMessages = document.getElementById("chat-messages");
const newMessageAlert = document.getElementById("new-message-alert");
const chatCharCount = document.getElementById("chatCharCount");
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


  if (response.status === 429) {

    chatCharCount.textContent = "Slow down a bit — try again in a few seconds";

    setTimeout(function () {
        chatCharCount.textContent = `${messageInput.value.length} / 500`;
    }, 3000);

    return;

  }

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
                ${escapeForDisplay(comment.username)}:
            </strong>
            ${escapeForDisplay(comment.message)}
            <span class="timestamp">
                ${escapeForDisplay(comment.created_at)}
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
            ${escapeForDisplay(comment.username)}:
        </strong>
        ${escapeForDisplay(comment.message)}
        <span class="timestamp">
            ${escapeForDisplay(comment.created_at)}
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

async function loadFeaturedVideos() {

    const response = await fetch("/api/featured-videos");

    const videos = await response.json();

    const list = document.getElementById("featured-videos-list");

    if (!list) {
        return;
    }

    if (!videos || videos.length === 0) {

        list.innerHTML = `<p class="featured-videos-empty">No featured videos right now.</p>`;

        return;

    }

    list.innerHTML = videos.map(video => `
        <div class="featured-video-item">
            <div class="video-container">
                <iframe src="${video.embed_url}"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen></iframe>
            </div>
            ${video.title ? `<p class="featured-video-title">${video.title}</p>` : ""}
        </div>
    `).join("");

}

loadFeaturedVideos();


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

function attachArticleSearch(container, placeholder) {

    const wrapper = document.createElement("div");
    wrapper.className = "article-search-wrapper";

    wrapper.innerHTML = `
        <input
            type="text"
            class="article-search-input"
            placeholder="${placeholder}"
        >
        <p class="article-search-empty" style="display:none;">No articles match your search.</p>
    `;

    container.appendChild(wrapper);

    const input = wrapper.querySelector(".article-search-input");
    const emptyMessage = wrapper.querySelector(".article-search-empty");

    input.addEventListener("input", () => {

        const query = input.value.trim().toLowerCase();
        const posts = container.querySelectorAll(".blog-post");

        let visibleCount = 0;

        posts.forEach((post) => {

            const matches = !query || (post.dataset.searchText || "").includes(query);

            post.style.display = matches ? "" : "none";

            if (matches) {
                visibleCount++;
            }

        });

        emptyMessage.style.display = (query && visibleCount === 0) ? "" : "none";

    });

    return wrapper;

}

function renderArticleSkeletons(container, count) {

    for (let i = 0; i < count; i++) {

        const skeleton = document.createElement("div");
        skeleton.className = "skeleton-post";

        skeleton.innerHTML = `
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-meta"></div>
            <div class="skeleton-block skeleton-image"></div>
            <div class="skeleton-line skeleton-text"></div>
            <div class="skeleton-line skeleton-text"></div>
            <div class="skeleton-line skeleton-text" style="width:70%;"></div>
        `;

        container.appendChild(skeleton);

    }

}

function renderCommentSkeletons(list, count) {

    list.innerHTML = "";

    for (let i = 0; i < count; i++) {

        const skeleton = document.createElement("div");
        skeleton.className = "skeleton-comment";

        skeleton.innerHTML = `
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
        `;

        list.appendChild(skeleton);

    }

}

// Only YouTube (real video ID from the cron check) and Kick have anything
// embeddable — Instagram's live flag is self-reported with no video source
// to actually show, so it's never eligible to be featured here even while
// marked live.
function isEmbeddableLive(streamer) {

    const platform = (streamer.platform || "").toLowerCase();

    if (platform.includes("kick") && Number(streamer.kick_is_live) === 1) {
        return true;
    }

    if (platform.includes("youtube") && streamer.youtube_live_video_id) {
        return true;
    }

    return false;

}

async function loadFeaturedStreamer() {

    const container = document.getElementById("featured-streamer-container");

    if (!container) {
        return;
    }

    try {

        const response = await fetch("/api/streamers");
        const streamers = await response.json();

        const eligible = streamers.filter(isEmbeddableLive);

        if (eligible.length === 0) {
            container.innerHTML = "";
            return;
        }

        // A manual pin wins, but only while that streamer is actually live —
        // otherwise it falls back to whoever's live, lowest streamer ID first.
        const pinned = eligible.find((streamer) => Number(streamer.featured_pinned) === 1);

        const featured = pinned || eligible.sort((a, b) => a.id - b.id)[0];

        container.innerHTML = `
            <section class="featured-streamer">
                <div class="featured-streamer-header">
                    <span class="featured-streamer-label">🔴 Featured Now</span>
                    <a href="/streamer/${featured.slug}" class="featured-streamer-name">${escapeForDisplay(featured.name)}</a>
                </div>
                ${renderFeaturedStreamerEmbed(featured)}
            </section>
        `;

    } catch (err) {

        console.log("Failed to load featured streamer:", err.message);
        container.innerHTML = "";

    }

}

// Separate from renderStreamerWatchBlock (used on a streamer's own page)
// because autoplay only makes sense here — nobody wants a stream on
// someone's dedicated page blasting sound the moment it loads, but the
// whole point of the homepage banner is that it plays without a click.
// Muted autoplay is the only kind browsers reliably allow.
function renderFeaturedStreamerEmbed(streamer) {

    const platform = (streamer.platform || "").toLowerCase();

    if (platform.includes("kick")) {

        const kickUsername = streamer.kick_channel || streamer.channel;

        return `
            <div class="video-container">
                <iframe src="https://player.kick.com/${encodeURIComponent(kickUsername)}"
                    frameborder="0" scrolling="no" allowfullscreen></iframe>
            </div>
        `;

    }

    if (platform.includes("youtube") && streamer.youtube_live_video_id) {

        return `
            <div class="video-container">
                <iframe src="https://www.youtube.com/embed/${encodeURIComponent(streamer.youtube_live_video_id)}?autoplay=1&mute=1"
                    frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
            </div>
            <p class="featured-mute-note">🔇 Playing muted — click the video to unmute.</p>
        `;

    }

    return "";

}

async function loadArticles() {

    const container = document.getElementById("articles-container");

    container.innerHTML = "";

    if (window.SHOW_STREAMER_DIRECTORY) {
        renderArticleSkeletons(container, 2);
        await renderStreamerDirectory(container);
        return;
    }

    if (window.SINGLE_STREAMER_SLUG) {
        renderArticleSkeletons(container, 2);
        await renderStreamerArticles(container, window.SINGLE_STREAMER_SLUG);
        return;
    }

    const singleArticleSlug = window.SINGLE_ARTICLE_SLUG || null;

    // The featured streamer banner is homepage-only — this same template is
    // reused for article/streamer pages via injected window globals, so
    // this branch is the one true "nothing else claimed this page" case.
    if (!singleArticleSlug) {
        loadFeaturedStreamer();
    }

    renderArticleSkeletons(container, singleArticleSlug ? 1 : 3);

    let savedArticles;

    if (singleArticleSlug) {

        const response = await fetch(`/api/articles/${encodeURIComponent(singleArticleSlug)}`);

        if (!response.ok) {
            container.innerHTML = `<p>Article not found. <a href="/">Back to homepage</a></p>`;
            return;
        }

        savedArticles = [await response.json()];

        container.innerHTML = "";

        const backLink = document.createElement("a");
        backLink.href = "/";
        backLink.className = "back-to-articles";
        backLink.textContent = "← Back to all articles";
        container.appendChild(backLink);

    } else {

        const response = await fetch("/api/articles");
        savedArticles = await response.json();

        container.innerHTML = "";

        if (savedArticles.length > 0) {
            attachArticleSearch(container, "Search articles by title or streamer...");
        }

    }

savedArticles.forEach((article) => {

        const post = createArticleCard(article, { excerpt: !singleArticleSlug });

        container.appendChild(post);

        // In excerpt mode the comments section isn't rendered at all, so
        // there's nothing to load into — and no point spending a fetch on it.
        if (singleArticleSlug) {
            loadArticleComments(article.id);
        }

    });

}

function truncateText(text, maxLength) {

    if (!text || text.length <= maxLength) {
        return text || "";
    }

    const cut = text.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(" ");

    return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";

}

function createArticleCard(article, options = {}) {

        const excerpt = Boolean(options.excerpt);

        const post = document.createElement("article");

        post.classList.add("blog-post");

        if (excerpt) {
            post.classList.add("blog-post-excerpt");
        }

        post.dataset.articleId = article.id;

        post.dataset.searchText = `${article.title || ""} ${article.streamerName || ""}`.toLowerCase();

        // Feed views (homepage, streamer pages) show a trimmed preview with a
        // Read More link instead of the full article — image included, since
        // that's what actually catches a scrolling eye, but no video embed,
        // bottom paragraph, or comments until someone clicks through.
        if (excerpt) {

            post.innerHTML = `
                <header class="post-header">
                    <h1 class="post-title">
                        <a href="/article/${article.slug}" class="post-title-link">${article.title}</a>
                    </h1>

                    ${article.streamerSlug ? `
                    <a href="/streamer/${article.streamerSlug}" class="streamer-badge">
                        📺 ${article.streamerName}
                    </a>
                    ` : ""}

                    <div class="post-meta">
                        ${article.date}
                    </div>
                </header>

                <div class="post-content">

                    ${(() => {
                        const thumbnailUrl = getYoutubeThumbnailUrl(article.youtube);

                        if (thumbnailUrl) {
                            return `
                                <a href="/article/${article.slug}" class="article-video-thumbnail-link">
                                    <img src="${thumbnailUrl}" class="article-image article-image-excerpt">
                                    <span class="play-button-overlay">▶</span>
                                </a>
                            `;
                        }

                        if (article.image) {
                            return `<img src="${article.image}" class="article-image article-image-excerpt">`;
                        }

                        return "";
                    })()}

                    <p class="article-text">${truncateText(article.contentTop, 220)}</p>

                    <div class="excerpt-footer">
                        <a href="/article/${article.slug}" class="read-more-link">Read More →</a>
                        <a href="/article/${article.slug}#comments-section-${article.id}" class="excerpt-comment-count">
                            💬 ${article.commentCount || 0} comment${article.commentCount === 1 ? "" : "s"}
                        </a>
                    </div>

                </div>
            `;

            return post;

        }

        post.innerHTML = `
            <header class="post-header">
                <h1 class="post-title">
                    <a href="/article/${article.slug}" class="post-title-link">${article.title}</a>
                </h1>

                ${article.streamerSlug ? `
                <a href="/streamer/${article.streamerSlug}" class="streamer-badge">
                    📺 ${article.streamerName}
                </a>
                ` : ""}

                <div class="post-meta">
                    ${article.date}
                </div>
            </header>

            <div class="post-content">

                <p class="article-text">${article.contentTop}</p>

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

${article.image ? `<img src="${article.image}" class="article-image">` : ""}

<p class="article-text">${article.contentBottom}</p>

<a href="mailto:undergroundcowtube@gmail.com?subject=Article Report"
class="report-button">
    Report Article
</a>


<section class="comments-section" id="comments-section-${article.id}">

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

        return post;

}

function formatTimeAgo(isoString) {

    if (!isoString) {
        return null;
    }

    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) {
        return "just now";
    }
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) {
        return `${diffDays}d ago`;
    }

    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;

}

async function renderStreamerDirectory(container) {

    const response = await fetch("/api/streamers");
    const streamers = await response.json();

    container.innerHTML = "";

    const heading = document.createElement("h1");
    heading.className = "post-title";
    heading.textContent = "Streamers";
    container.appendChild(heading);

    container.insertAdjacentHTML(
        "beforeend",
        `<p class="live-badge-disclaimer">🔴 LIVE badges (Kick, YouTube) are checked automatically and should be accurate. 🟠 LIVE badges are reported manually for platforms with no way to check automatically (like Instagram) and clear themselves after a few hours.</p>`
    );

    if (streamers.length === 0) {
        container.insertAdjacentHTML("beforeend", `<p>No streamers yet.</p>`);
        return;
    }

    const grid = document.createElement("div");
    grid.className = "streamer-grid";

    streamers.forEach((streamer) => {

        const card = document.createElement("a");
        card.className = "streamer-directory-card";
        card.href = `/streamer/${streamer.slug}`;

        const statusIcon = streamer.status === "online" ? "🟢"
            : streamer.status === "away" ? "🟡"
            : "⚫";

        // Real "currently broadcasting" state (checked server-side every 5 min),
        // separate from the manual online/away/offline status above.
        const isAutoLive = Boolean(streamer.youtube_live_video_id) || Number(streamer.kick_is_live) === 1;

        // Instagram has no API to verify this — it's a manual, self-reported
        // toggle, so it gets its own amber badge rather than the same red
        // one used for the platforms we actually check.
        const isManualLive = Number(streamer.instagram_is_live) === 1;

        const isLive = isAutoLive || isManualLive;

        // Only show "last live" when they're NOT live right now — the LIVE
        // badge already covers that case, and repeating it would be noise.
        const lastLiveAgo = !isLive ? formatTimeAgo(streamer.last_live_at) : null;

        let liveBadgeHtml = "";

        if (isAutoLive) {
            liveBadgeHtml = `<span class="live-badge">🔴 LIVE</span>`;
        } else if (isManualLive) {
            liveBadgeHtml = `<span class="live-badge live-badge-manual">🟠 LIVE</span>`;
        }

        card.innerHTML = `
            <strong>${streamer.name}</strong>
            <span class="streamer-directory-meta">${statusIcon} ${streamer.platform || ""}</span>
            ${lastLiveAgo ? `<span class="streamer-last-live">Last live ${lastLiveAgo}</span>` : ""}
            ${liveBadgeHtml}
        `;

        grid.appendChild(card);

    });

    container.appendChild(grid);

}

function buildStreamerProfileUrl(streamer) {

    const platform = (streamer.platform || "").toLowerCase();
    const channel = streamer.channel || "";
    const handle = channel.startsWith("@") ? channel.slice(1) : channel;

    if (platform.includes("kick")) {
        return `https://kick.com/${handle}`;
    }
    if (platform.includes("youtube")) {
        return `https://youtube.com/@${handle}`;
    }
    if (platform.includes("tiktok")) {
        return `https://tiktok.com/@${handle}`;
    }
    if (platform.includes("vaughnlive") || platform.includes("vaughn live")) {
        return `https://vaughnlive.tv/${handle}`;
    }
    if (platform.includes("instagram")) {
        return `https://instagram.com/${handle}`;
    }

    return null;

}

function renderStreamerWatchBlock(streamer) {

    const platform = (streamer.platform || "").toLowerCase();
    const profileUrl = buildStreamerProfileUrl(streamer);

    // Kick: fully reliable embed, no extra setup needed for Kick-only streamers.
    // Dual-platform streamers (e.g. "YouTube/Kick") need kick_channel set explicitly,
    // since their "channel" field usually holds their handle for the other platform.
    if (platform.includes("kick")) {

        const kickUsername = streamer.kick_channel || streamer.channel;

        return `
            <div class="video-container">
                <iframe src="https://player.kick.com/${encodeURIComponent(kickUsername)}"
                    frameborder="0" scrolling="no" allowfullscreen></iframe>
            </div>
        `;
    }

    // YouTube: the worker checks each channel's live status on a schedule and
    // caches the actual video ID (youtube_live_video_id) in D1. Embedding that
    // real video ID is the officially-supported, reliable method — unlike the
    // old /embed/live_stream?channel= redirect, which YouTube can silently
    // break at any time since it was never a documented endpoint.
    if (platform.includes("youtube") && streamer.youtube_live_video_id) {
        return `
            <div class="video-container">
                <iframe src="https://www.youtube.com/embed/${encodeURIComponent(streamer.youtube_live_video_id)}"
                    frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
            </div>
            <p class="embed-reliability-note">Live status updates roughly every 5 minutes. If this looks wrong, try refreshing the page.</p>
        `;
    }

    // Everything else: no reliable embed, so link out instead of showing something broken.
    if (profileUrl) {
        return `
            <a class="watch-live-button" href="${profileUrl}" target="_blank" rel="noopener">
                ▶ Watch ${escapeForDisplay(streamer.name)} live on ${escapeForDisplay(streamer.platform || "their channel")}
            </a>
        `;
    }

    return "";

}

function escapeForDisplay(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

async function renderStreamerArticles(container, slug) {

    const response = await fetch(`/api/streamers/${encodeURIComponent(slug)}/articles`);

    if (!response.ok) {
        container.innerHTML = `<p>Streamer not found. <a href="/streamers">Back to streamers</a></p>`;
        return;
    }

    const { streamer, articles } = await response.json();

    container.innerHTML = "";

    const backLink = document.createElement("a");
    backLink.href = "/streamers";
    backLink.className = "back-to-articles";
    backLink.textContent = "← Back to all streamers";
    container.appendChild(backLink);

    const heading = document.createElement("h1");
    heading.className = "post-title";
    heading.textContent = streamer.name;
    container.appendChild(heading);

    container.insertAdjacentHTML("beforeend", renderStreamerWatchBlock(streamer));

    if (articles.length === 0) {
        container.insertAdjacentHTML("beforeend", `<p class="no-comments">No articles about ${escapeForDisplay(streamer.name)} yet — check back soon.</p>`);
        return;
    }

    if (articles.length > 3) {
        attachArticleSearch(container, `Search ${streamer.name}'s articles...`);
    }

    articles.forEach((article) => {
        const post = createArticleCard(article, { excerpt: true });
        container.appendChild(post);
    });

}

function renderReplyHTML(reply) {

    return `
        <div class="comment reply" data-comment-id="${reply.id}">
            <div class="comment-header">
                <strong style="color:${reply.color}">${escapeForDisplay(reply.username)}</strong>
                <span class="timestamp">${escapeForDisplay(reply.created_at)}</span>
            </div>
            <p>${escapeForDisplay(reply.message)}</p>
        </div>
    `;

}

function renderCommentHTML(comment, replies) {

    const firstReply = replies[0];
    const restReplies = replies.slice(1);

    const repliesBlock = replies.length > 0 ? `
        <div class="replies">
            ${renderReplyHTML(firstReply)}
            <div class="replies-extra" id="replies-extra-${comment.id}" style="display:none;">
                ${restReplies.map(renderReplyHTML).join("")}
            </div>
            ${restReplies.length > 0 ? `
                <div class="replies-toggle-wrap">
                    <button class="replies-toggle" data-comment-id="${comment.id}" data-count="${restReplies.length}">
                        ▼ Show ${restReplies.length} more repl${restReplies.length === 1 ? "y" : "ies"}
                    </button>
                </div>
            ` : ""}
        </div>
    ` : "";

    return `
        <div class="comment" data-comment-id="${comment.id}">
            <div class="comment-header">
                <strong style="color:${comment.color}">${escapeForDisplay(comment.username)}</strong>
                <span class="timestamp">${escapeForDisplay(comment.created_at)}</span>
            </div>
            <p>${escapeForDisplay(comment.message)}</p>

            <button class="reply-toggle" data-comment-id="${comment.id}">Reply</button>

            <div class="reply-form" id="reply-form-${comment.id}" style="display:none;">
                <textarea class="reply-textarea" maxlength="500" placeholder="Write a reply..."></textarea>
                <div class="reply-footer">
                    <span class="character-count">0 / 500</span>
                    <button class="reply-submit comment-button-disabled" disabled data-parent-id="${comment.id}">Post Reply</button>
                </div>
            </div>

            ${repliesBlock}
        </div>
    `;

}

async function loadArticleComments(articleId) {

    const list = document.getElementById(`comment-list-${articleId}`);

    if (!list) {
        return;
    }

    renderCommentSkeletons(list, 2);

    const response = await fetch(`/api/article-comments?article_id=${articleId}`);

    const comments = await response.json();

    if (comments.length === 0) {
        list.innerHTML = `<p class="no-comments">No comments yet. Be the first to comment.</p>`;
        return;
    }

    const topLevel = comments.filter((c) => !c.parent_id);

    const repliesByParent = {};

    comments.forEach((c) => {
        if (c.parent_id) {
            if (!repliesByParent[c.parent_id]) {
                repliesByParent[c.parent_id] = [];
            }
            repliesByParent[c.parent_id].push(c);
        }
    });

    list.innerHTML = topLevel
        .map((comment) => renderCommentHTML(comment, repliesByParent[comment.id] || []))
        .join("");

}

const articlesContainer = document.getElementById("articles-container");

// Live character count + enable/disable the post button as the user types
articlesContainer.addEventListener("input", function (event) {

    const isTopLevel = event.target.classList.contains("comment-textarea");
    const isReply = event.target.classList.contains("reply-textarea");

    if (!isTopLevel && !isReply) {
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

    // Show/hide the inline reply box under a comment
    const replyToggle = event.target.closest(".reply-toggle");

    if (replyToggle) {

        const form = document.getElementById(`reply-form-${replyToggle.dataset.commentId}`);

        form.style.display = form.style.display === "none" ? "block" : "none";

        return;

    }

    // Expand/collapse the rest of a comment's replies
    const repliesToggle = event.target.closest(".replies-toggle");

    if (repliesToggle) {

        const extra = document.getElementById(`replies-extra-${repliesToggle.dataset.commentId}`);
        const isHidden = extra.style.display === "none" || extra.style.display === "";
        const count = repliesToggle.dataset.count;

        extra.style.display = isHidden ? "block" : "none";

        repliesToggle.textContent = isHidden
            ? "▲ Hide replies"
            : `▼ Show ${count} more repl${count === "1" ? "y" : "ies"}`;

        return;

    }

    // Submit a reply
    const replySubmit = event.target.closest(".reply-submit");

    if (replySubmit) {

        if (replySubmit.disabled) {
            return;
        }

        const parentId = replySubmit.dataset.parentId;
        const articlePost = replySubmit.closest("[data-article-id]");
        const articleId = articlePost.dataset.articleId;
        const textarea = replySubmit.closest(".reply-form").querySelector(".reply-textarea");
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

        const replyData = {
            article_id: articleId,
            parent_id: parentId,
            username: guestName,
            message: message,
            color: guestColor,
            created_at: timestamp
        };

        const replyResponse = await fetch("/api/article-comments", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(replyData)
        });

        if (replyResponse.status === 403) {
            alert("You've been blocked from posting comments.");
            return;
        }

        if (replyResponse.status === 429) {
            alert("You're posting too fast — wait a few seconds and try again.");
            return;
        }

        if (replyResponse.ok) {
            await loadArticleComments(articleId);
        }

        return;

    }

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

    if (response.status === 429) {
        alert("You're posting too fast — wait a few seconds and try again.");
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
