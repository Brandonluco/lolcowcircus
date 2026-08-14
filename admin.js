const streamerName = document.getElementById("streamerName");
const streamerPlatform = document.getElementById("streamerPlatform");
const streamerChannel = document.getElementById("streamerChannel");
const streamerEmbedChannelId = document.getElementById("streamerEmbedChannelId");
const streamerStatus = document.getElementById("streamerStatus");
const addStreamer = document.getElementById("addStreamer");
const streamerList = document.getElementById("streamerList");
const streamerSelect = document.getElementById("streamerSelect");
const alertMessage = document.getElementById("alertMessage");
const alertType = document.getElementById("alertType");
const updateAlert = document.getElementById("updateAlert");
const clearAlert = document.getElementById("clearAlert");
const currentAlert = document.getElementById("currentAlert");
const articleTitle = document.getElementById("articleTitle");
const articleStreamer = document.getElementById("articleStreamer");
const articleDate = document.getElementById("articleDate");
const articleContentTop = document.getElementById("articleContentTop");
const articleImage = document.getElementById("articleImage");
const articleImageFile = document.getElementById("articleImageFile");
const imageUploadStatus = document.getElementById("imageUploadStatus");
const articleYoutube = document.getElementById("articleYoutube");
const articleContentBottom = document.getElementById("articleContentBottom");
const addArticle = document.getElementById("addArticle");
const articleList = document.getElementById("articleList");
const cancelEdit = document.getElementById("cancelEdit");
const editingStatus = document.getElementById("editingStatus");
const articleCommentList = document.getElementById("articleCommentList");
const bannedIpList = document.getElementById("bannedIpList");


let streamers = [];

let loadedArticles = [];

let editingArticleId = null;

articleImageFile.addEventListener("change", async function () {

    const file = articleImageFile.files[0];

    if (!file) {
        return;
    }

    imageUploadStatus.textContent = "Uploading...";

    const response = await fetch(`/api/upload-image?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: {
            "Content-Type": file.type || "application/octet-stream"
        },
        body: file
    });

    if (!response.ok) {
        imageUploadStatus.textContent = "Upload failed. Try again.";
        return;
    }

    const data = await response.json();

    articleImage.value = data.path;

    imageUploadStatus.textContent = "Uploaded: " + data.path;

});

const onlineButton = document.getElementById("onlineButton");
const awayButton = document.getElementById("awayButton");

const offlineButton = document.getElementById("offlineButton");



onlineButton.addEventListener("click", async function() {

    const id = streamerSelect.value;

    await fetch("/api/streamers", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: id,
            status: "online"
        })
    });

    await loadStreamers();

});


awayButton.addEventListener("click", async function() {

    const id = streamerSelect.value;

    await fetch("/api/streamers", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: id,
            status: "away"
        })
    });

    await loadStreamers();

});


offlineButton.addEventListener("click", async function() {

    const id = streamerSelect.value;

    await fetch("/api/streamers", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: id,
            status: "offline"
        })
    });

    await loadStreamers();

});


function displayStreamers() {

    

    streamerList.replaceChildren();

    streamers.forEach((streamer, index) => {

        const div = document.createElement("div");

        div.innerHTML = `
            <strong>${streamer.name}</strong>
            <p>Status: ${streamer.status}</p>
        `;

        if ((streamer.platform || "").toLowerCase().includes("youtube")) {

            const embedRow = document.createElement("div");

            embedRow.innerHTML = `
                <input type="text" class="embed-id-input" placeholder="YouTube Channel ID (UC...)" value="${streamer.embed_channel_id || ""}" style="width:220px;">
                <button class="save-embed-id">Save</button>
            `;

            embedRow.querySelector(".save-embed-id").addEventListener("click", async function() {

                const value = embedRow.querySelector(".embed-id-input").value;

                await fetch("/api/streamers", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: streamer.id, embedChannelId: value })
                });

                await loadStreamers();

            });

            div.appendChild(embedRow);

        }

        streamerList.appendChild(div);

    });

}

async function displayCurrentAlert() {

    const response = await fetch("/api/alert");

    const alert = await response.json();

    if (!alert) {
        currentAlert.textContent = "No active alert";
        currentAlert.style.backgroundColor = "#adadad";
        currentAlert.style.color = "black";
        return;
    }

    currentAlert.textContent = alert.message;

    if (alert.type === "news") {
        currentAlert.style.backgroundColor = "#2ecc71";
    }

    if (alert.type === "maintenance") {
        currentAlert.style.backgroundColor = "#e74c3c";
    }

    currentAlert.style.color = "white";

}

function displayArticles() {

    articleList.innerHTML = "";

    loadedArticles.forEach((article) => {

        const div = document.createElement("div");

div.classList.add("admin-article-card");

 div.innerHTML = `
    <strong>${article.title}</strong>

    ${article.streamerName ? `<p>📺 ${article.streamerName}</p>` : ""}

    <p>${article.date}</p>

    <p>${article.contentTop}</p>

    ${article.image ? "<p>🖼 Image attached</p>" : ""}

    ${article.youtube ? "<p>▶ YouTube attached</p>" : ""}

    <button onclick="editArticle(${article.id})">Edit</button>
    <button onclick="deleteArticle(${article.id})">Delete</button>
    ${article.slug ? `<button onclick="window.open('/article/${article.slug}', '_blank')">View</button>` : ""}
`;

        articleList.appendChild(div);

    });

}

async function loadArticles() {

    const response = await fetch("/api/articles");

    loadedArticles = await response.json();

    displayArticles();

}

async function deleteArticle(id) {

    const confirmDelete = confirm("Are you sure you want to delete this article?");

    if (!confirmDelete) {
        return;
    }

    await fetch("/api/articles", {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: id })
    });

    await loadArticles();

}

function editArticle(id) {

    const article = loadedArticles.find((a) => a.id === id);

    if (!article) {
        return;
    }

    articleTitle.value = article.title;
    articleStreamer.value = article.streamer_id || "";
    articleDate.value = article.date;
    articleContentTop.value = article.contentTop;
    articleImage.value = article.image;

    imageUploadStatus.textContent = article.image
        ? "Current image: " + article.image + " (choose a new file to replace it)"
        : "";
    articleYoutube.value = article.youtube;
    articleContentBottom.value = article.contentBottom;

    editingArticleId = id;

addArticle.textContent = "Save Changes";

cancelEdit.style.display = "inline-block";

editingStatus.textContent = "Currently editing: " + article.title;

editingStatus.style.display = "block";

document.getElementById("article-manager").scrollIntoView({
    behavior: "smooth"
});

}


addStreamer.addEventListener("click", async function() {

    const newStreamer = {
        name: streamerName.value,
        platform: streamerPlatform.value,
        channel: streamerChannel.value,
        embedChannelId: streamerEmbedChannelId.value,
        status: streamerStatus.value
    };


    await fetch("/api/streamers", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(newStreamer)
    });


    streamerName.value = "";
    streamerPlatform.value = "";
    streamerChannel.value = "";
    streamerEmbedChannelId.value = "";


    await loadStreamers();

});

updateAlert.addEventListener("click", async function() {

    const newAlert = {
        type: alertType.value,
        message: alertMessage.value
    };


    await fetch("/api/alert", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(newAlert)
    });


    alertMessage.value = "";

    displayCurrentAlert();

});


clearAlert.addEventListener("click", async function() {

    await fetch("/api/alert", {
        method: "DELETE"
    });


    displayCurrentAlert();

});

cancelEdit.addEventListener("click", function() {

    editingArticleId = null;

    articleTitle.value = "";
    articleStreamer.value = "";
    articleDate.value = "";
    articleContentTop.value = "";
    articleImage.value = "";
    articleImageFile.value = "";
    imageUploadStatus.textContent = "";
    articleYoutube.value = "";
    articleContentBottom.value = "";

    addArticle.textContent = "Publish Article";

    cancelEdit.style.display = "none";

    editingStatus.style.display = "none";

    editingStatus.textContent = "";

});

function loadStreamerDropdown() {

    streamerSelect.innerHTML = "";

    streamers.forEach((streamer) => {

        const option = document.createElement("option");

        option.value = streamer.id;
        option.textContent = streamer.name;

        streamerSelect.appendChild(option);

    });

    const previousValue = articleStreamer.value;

    articleStreamer.innerHTML = `<option value="">— No streamer —</option>`;

    streamers.forEach((streamer) => {

        const option = document.createElement("option");

        option.value = streamer.id;
        option.textContent = streamer.name;

        articleStreamer.appendChild(option);

    });

    articleStreamer.value = previousValue;

}

async function loadStreamers() {

    const response = await fetch("/api/streamers");

    streamers = await response.json();

    displayStreamers();

    loadStreamerDropdown();

}

addArticle.addEventListener("click", async function() {

    const newArticle = {
        title: articleTitle.value,
        streamerId: articleStreamer.value || null,
        date: articleDate.value,
        contentTop: articleContentTop.value,
        image: articleImage.value,
        youtube: articleYoutube.value,
        contentBottom: articleContentBottom.value
    };

if (editingArticleId === null) {

    await fetch("/api/articles", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(newArticle)
    });

} else {

    newArticle.id = editingArticleId;

    await fetch("/api/articles", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(newArticle)
    });

    editingArticleId = null;

    addArticle.textContent = "Publish Article";

    cancelEdit.style.display = "none";

    editingStatus.style.display = "none";
    
    editingStatus.textContent = "";

}



await loadArticles();

console.log("Article saved!");

articleTitle.value = "";
articleStreamer.value = "";
articleDate.value = "";
articleContentTop.value = "";
articleImage.value = "";
articleImageFile.value = "";
imageUploadStatus.textContent = "";
articleYoutube.value = "";
articleContentBottom.value = "";

});


async function displayArticleComments() {

    const response = await fetch("/api/article-comments/admin");

    const comments = await response.json();

    articleCommentList.innerHTML = "";

    if (comments.length === 0) {
        articleCommentList.innerHTML = "<p>No comments yet.</p>";
        return;
    }

    comments.forEach((comment) => {

        const div = document.createElement("div");

        div.classList.add("pending-comment");

        div.innerHTML = `
            <div class="comment-info">
                <strong>${comment.username}</strong>
                <span>${comment.created_at}</span>
            </div>

            ${comment.parent_id ? `<p style="font-size:0.8rem;color:#e67e22;">&#8627; reply to ${comment.reply_to_username || "a comment"}</p>` : ""}

            <p>${comment.message}</p>

            <p style="font-size:0.8rem;color:#888;">
                On: ${comment.article_title || "Unknown article"} &bull; IP: ${comment.ip_address}
            </p>

            <div class="comment-actions">
                <button class="delete-comment" onclick="deleteArticleComment(${comment.id})">Delete</button>
                <button class="approve-comment" onclick="banCommentIp('${comment.ip_address}')">Ban IP</button>
            </div>
        `;

        articleCommentList.appendChild(div);

    });

}

async function deleteArticleComment(id) {

    const confirmDelete = confirm("Delete this comment?");

    if (!confirmDelete) {
        return;
    }

    await fetch("/api/article-comments", {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ id: id })
    });

    await displayArticleComments();

}

async function banCommentIp(ip) {

    const confirmBan = confirm(`Ban IP ${ip}? They won't be able to post comments anymore.`);

    if (!confirmBan) {
        return;
    }

    await fetch("/api/banned-ips", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ ip_address: ip })
    });

    await displayBannedIps();

}

async function displayBannedIps() {

    const response = await fetch("/api/banned-ips");

    const bannedIps = await response.json();

    bannedIpList.innerHTML = "";

    if (bannedIps.length === 0) {
        bannedIpList.innerHTML = "<p>No banned IPs.</p>";
        return;
    }

    bannedIps.forEach((entry) => {

        const div = document.createElement("div");

        div.classList.add("pending-comment");

        div.innerHTML = `
            <div class="comment-info">
                <strong>${entry.ip_address}</strong>
                <span>${entry.banned_at}</span>
            </div>

            <div class="comment-actions">
                <button class="delete-comment" onclick="unbanIp('${entry.ip_address}')">Unban</button>
            </div>
        `;

        bannedIpList.appendChild(div);

    });

}

async function unbanIp(ip) {

    await fetch("/api/banned-ips", {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ ip_address: ip })
    });

    await displayBannedIps();

}

loadStreamers();
displayCurrentAlert();
loadArticles();
displayArticleComments();
displayBannedIps();