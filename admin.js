const streamerName = document.getElementById("streamerName");
const streamerPlatform = document.getElementById("streamerPlatform");
const streamerChannel = document.getElementById("streamerChannel");
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
const articleDate = document.getElementById("articleDate");
const articleContentTop = document.getElementById("articleContentTop");
const articleImage = document.getElementById("articleImage");
const articleYoutube = document.getElementById("articleYoutube");
const articleContentBottom = document.getElementById("articleContentBottom");
const addArticle = document.getElementById("addArticle");
const articleList = document.getElementById("articleList");
const cancelEdit = document.getElementById("cancelEdit");
const editingStatus = document.getElementById("editingStatus");


let streamers = [];

let loadedArticles = [];

let editingArticleId = null;

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

    <p>${article.date}</p>

    <p>${article.contentTop}</p>

    ${article.image ? "<p>🖼 Image attached</p>" : ""}

    ${article.youtube ? "<p>▶ YouTube attached</p>" : ""}

    <button onclick="editArticle(${article.id})">Edit</button>
    <button onclick="deleteArticle(${article.id})">Delete</button>
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
    articleDate.value = article.date;
    articleContentTop.value = article.contentTop;
    articleImage.value = article.image;
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
    articleDate.value = "";
    articleContentTop.value = "";
    articleImage.value = "";
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
articleDate.value = "";
articleContentTop.value = "";
articleImage.value = "";
articleYoutube.value = "";
articleContentBottom.value = "";

});


loadStreamers();
displayCurrentAlert();
loadArticles();